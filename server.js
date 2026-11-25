import { createServer } from 'node:http';
import { passportPage } from './frontend/public-passport.js';
import { readFile } from 'node:fs/promises';

import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { Store, DATABASE_PATH } from './src/store.js';
import { DomainError, ensure, ref, req as requiredText } from './src/model.js';
import { permitted } from './src/actions.js';
import { demo } from './src/demo.js';
import { analyseEvidence } from './src/certificates.js';
import { matchPoBuyer, PO_IMPORT_ACTION, poAnnexIds, poNumberReader } from './src/po-import.js';
import { extractBuyerPo, extractFabricTechPack, extractPoBuyer, geminiCatalogue, geminiModels, poAiStatus, setPoAiKey } from './src/po-ai.js';
import { saveGeminiModel } from './src/po-ai-env.js';
import { inspectPoNumber } from './src/po-number.js';

const local = '127.0.0.1';
const port = Number(process.env.HAPZO_PORT || '5173');
ensure(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Choose a port between 1024 and 65535.');
const origin = 'http://' + local + ':' + port;
const publishedOrigin = process.env.HAPZO_PUBLIC_URL ? new URL(process.env.HAPZO_PUBLIC_URL).origin : origin;
ensure(/^https?:\/\//.test(publishedOrigin), 'Use an HTTP or HTTPS origin in HAPZO_PUBLIC_URL.');
const acceptedHosts = new Set([new URL(origin).host, 'localhost:' + port, new URL(publishedOrigin).host]);
const assetTypes = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', pdf: 'application/pdf', wasm: 'application/wasm', json: 'application/json; charset=utf-8' };

function localShell(html) {
  return html.replace('<html lang="en">', '<html lang="en" data-runtime="node">').replace('HAPZO Frontend Preview', 'HAPZO Local');
}
const store = new Store();
const attempts = new Map();
const activeImports = new Map();

function readCookie(req) {
  return req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('hapzo_session='))?.slice(14) || '';
}
function sessionCookie(response, req, content, age = 43200) {
  const secure = publishedOrigin.startsWith('https:') && req.headers.host === new URL(publishedOrigin).host;
  response.setHeader('Set-Cookie', 'hapzo_session=' + content + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + (secure ? '; Secure' : ''));
}
function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
}
function reply(res, status, type, data) {
  res.writeHead(status, { 'Content-Type': type });
  res.end(data);
}
function json(res, status, body) { reply(res, status, 'application/json; charset=utf-8', JSON.stringify(body)); }
function sessionInfo(session) {
  const companies = store.companies(session.user_id);
  const actions = permitted(session.role);
  return {
    login: session.login, name: session.display_name, role: session.role, companyId: session.company_id,
    companies, actions, publishedOrigin, ...(actions.includes(PO_IMPORT_ACTION) ? { poAi: poAiStatus(session) } : {}),
  };
}
function configuredPoReader(session, expected) {
  const settings = store.readState(session.company_id).settings;
  const reader = poNumberReader(settings);
  // Tabs opened before the built-in reader became the default still send the old local default.
  const previousDefault = !settings.poNumberReader && expected === 'local-oxr';
  ensure(expected === reader || previousDefault || expected === undefined && reader !== 'hosted-oxr',
    'The buyer PO reader changed. Review the current reader before uploading again.', 409, 'po-reader-changed');
  return reader;
}

function checkPoSession(token, session) {
  const signed = store.session(token);
  ensure(signed && signed.company_id === session.company_id && permitted(signed.role).includes(PO_IMPORT_ACTION),
    'The workspace changed during the document read. Open the original workspace and retry.', 409, 'workspace-changed');
}

async function trackAiRead(session, input, read) {
  const company = session.company_id;
  ensure(!activeImports.has(company), 'An AI document read is already running for this workspace.', 409, 'ai-busy');
  const job = { id: /^[\w-]{12,80}$/.test(input.aiRequestId ?? '') ? input.aiRequestId : '', retry: null };
  activeImports.set(company, job);
  try {
    return await read({ geminiModel: input.geminiModel, onRetry: retry => { job.retry = retry; } });
  } catch (error) {
    if (job.retry && error instanceof DomainError) error.retry = job.retry;
    throw error;
  } finally {
    activeImports.delete(company);
  }
}
async function body(req, limit = 250_000) {
  ensure(req.headers['content-type']?.split(';')[0].trim() === 'application/json', 'Use a JSON request.', 415, 'media-type');
  ensure(!req.headers.origin || [origin, 'http://localhost:' + port, publishedOrigin].includes(req.headers.origin), 'Cross origin posting is not supported.', 403, 'origin');
  if (req.headers['sec-fetch-site']) ensure(['same-origin', 'none'].includes(req.headers['sec-fetch-site']), 'Cross origin posting is not supported.', 403, 'origin');
  ensure(Number(req.headers['content-length'] || 0) <= limit, 'Request is too large.', 413, 'size');
  const data = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    ensure(size <= limit, 'Request is too large.', 413, 'size');
    data.push(chunk);
  }
  let result;
  try { result = JSON.parse(Buffer.concat(data).toString('utf8')); } catch { throw new DomainError('Invalid JSON.', 400, 'json'); }
  ensure(result && typeof result === 'object' && !Array.isArray(result), 'Use a JSON object.', 400, 'json');
  return result;
}
function throttle(key) {
  for (const [k, v] of attempts) if (v.until <= Date.now()) attempts.delete(k);
  const count = attempts.get(key) ?? { n: 0, until: Date.now() + 5 * 60 * 1000 };
  ensure(count.n < 25, 'Too many sign-in attempts. Try again in five minutes.', 429, 'rate');
  count.n++;
  attempts.set(key, count);
}
function filename(label) {
  return encodeURIComponent(label).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function download(res, name) {
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + filename(name));
}

const server = createServer(async (req, res) => {
  headers(res);
  try {
    ensure(acceptedHosts.has(req.headers.host), 'Open the configured HAPZO address.', 403, 'host');
    const url = new URL(req.url, origin);
    const path = url.pathname;
    if (vite && !path.startsWith('/api/') && !path.startsWith('/p/')) {
      // Vite injects the React refresh preamble and development styles on this local listener.
      res.setHeader('Content-Security-Policy', res.getHeader('Content-Security-Policy')
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"));
      return vite.middlewares(req, res, () => json(res, 404, { error: 'Page not found.' }));
    }
    if (['GET', 'HEAD'].includes(req.method) && (path === '/' || path === '/index.html' || path === '/style.css' || path === '/demo-state.json' ||
        /^\/assets\/[\w.-]+\.(?:m?js|css|wasm)$/.test(path) || /^\/sample-orders\/[\w-]+\.pdf$/.test(path))) {
      const file = path === '/' ? 'index.html' : path.slice(1);
      let bytes;
      try { bytes = await readFile(new URL('./build/' + file, import.meta.url)); }
      catch (error) {
        if (error.code === 'ENOENT') return json(res, 404, { error: 'File not found.' });
        throw error;
      }
      return reply(res, 200, assetTypes[file.split('.').at(-1)], file === 'index.html' ? localShell(bytes.toString('utf8')) : bytes);
    }
    if (req.method === 'GET' && path === '/api/health') return json(res, 200, { service: 'hapzo-local', ready: true });
    if (req.method === 'GET' && /^\/p\/[\w-]{32}$/.test(path)) {
      const p = store.publicPassport(path.slice(3));
      return reply(res, p ? 200 : 404, 'text/html; charset=utf-8', passportPage(p));
    }
    if (req.method === 'GET' && /^\/api\/public\/[\w-]{32}$/.test(path)) {
      const p = store.publicPassport(path.slice(12));
      return json(res, p ? 200 : 404, p || { state: 'Unpublished' });
    }
    const cookie = readCookie(req);
    let session = store.session(cookie);
    if (req.method === 'GET' && path === '/api/session') {
      return json(res, 200, { initialized: store.initialized(), user: session ? sessionInfo(session) : null });
    }
    if (req.method === 'POST' && ['/api/setup', '/api/login'].includes(path)) {
      const data = await body(req);
      const key = path + ':' + req.socket.remoteAddress;
      throttle(key);
      const signed = path === '/api/setup' ? store.bootstrap(data) : store.signIn(data);
      attempts.delete(key);
      sessionCookie(res, req, signed);
      return json(res, 200, { user: sessionInfo(store.session(signed)) });
    }
    ensure(session, 'Sign in to your HAPZO workspace.', 401, 'session');
    if (req.method === 'GET' && path === '/api/state') {
      return json(res, 200, { user: sessionInfo(session), data: store.view(session) });
    }
    if (req.method === 'GET' && path === '/api/gemini-models') {
      ensure(permitted(session.role).includes(PO_IMPORT_ACTION), 'This action requires the merchandising role.', 403, 'role');
      const job = activeImports.get(session.company_id);
      const requestId = url.searchParams.get('request');
      if (requestId) return json(res, 200, { models: geminiModels(session), retry: job?.id === requestId ? job.retry : null });
      const canManage = session.role === 'Admin' && [new URL(origin).host, 'localhost:' + port].includes(req.headers.host);
      return json(res, 200, { ...await geminiCatalogue(session, url.searchParams.has('refresh')), canManage });
    }
    if (req.method === 'GET' && path === '/api/members') return json(res, 200, { members: store.listMembers(session) });
    if (req.method === 'GET' && path === '/api/export') {
      store.requireAdmin(session);
      download(res, 'HAPZO-company-records.json');
      return json(res, 200, { format: 'hapzo-local-data-1', ...store.readState(session.company_id), audit: store.readAudit(session.company_id) });
    }
    if (req.method === 'GET' && /^\/api\/documents\/[\w-]{22}$/.test(path)) {
      const doc = store.ownedDocument(session, path.slice(15));
      download(res, doc.label);
      return reply(res, 200, doc.mime, doc.bytes);
    }
    if (req.method === 'GET' && path === '/api/qr') {
      const state = store.view(session);
      const lotId = url.searchParams.get('lot');
      const passportId = url.searchParams.get('passport');
      let value;
      if (passportId) {
        const p = ref(state.passports, passportId);
        ensure(p?.status === 'Published', 'Published passport not found.', 404, 'not-found');
        value = publishedOrigin + '/p/' + p.token;
      } else {
        const lot = ref(state.lots ?? [], lotId);
        ensure(lot, 'Lot not found.', 404, 'not-found');
        value = 'HZ:LOT:' + lot.id;
      }
      return reply(res, 200, 'image/png', await QRCode.toBuffer(value, { errorCorrectionLevel: 'M', width: 240, margin: 4 }));
    }
    if (req.method === 'POST') {
      const data = await body(req, path === '/api/documents' ? 14_200_000 : undefined);
      session = store.session(cookie);
      ensure(session, 'Sign in to your HAPZO workspace.', 401, 'session');
      if (path === '/api/logout') {
        store.removeSession(cookie);
        sessionCookie(res, req, '', 0);
        return json(res, 200, { ok: true });
      }
      if (path === '/api/switch') {
        store.switchCompany(session, data.companyId);
        const switched = store.session(cookie);
        return json(res, 200, { user: sessionInfo(switched), data: store.view(switched) });
      }
      // A second tab may switch the selected workspace during a document upload.
      ensure(data.companyId === session.company_id, 'The selected workspace changed. Reload before posting.', 409, 'workspace-changed');
      if (path === '/api/actions') return json(res, 200, store.post(session, data));
      if (path === '/api/documents') return json(res, 201, store.addDocument(session, data));
      if (path === '/api/po-ai-key' || path === '/api/gemini-model') {
        store.requireAdmin(session);
        ensure([new URL(origin).host, 'localhost:' + port].includes(req.headers.host), 'Configure the AI provider key on this computer at ' + origin + '.', 403, 'host');
        if (path === '/api/po-ai-key') return json(res, 200, { poAi: setPoAiKey(session, data) });
        ensure(geminiModels(session).some(model => model.id === data.model), 'Choose a listed Gemini model.');
        saveGeminiModel(data.model);
        return json(res, 200, { defaultModel: data.model, models: geminiModels(session) });
      }
      if (path === '/api/po-number') {
        ensure(permitted(session.role).includes('buyer-order'), 'This action requires the merchandising role.', 403, 'role');
        const reader = configuredPoReader(session, data.poNumberReader);
        const original = store.ownedDocument(session, requiredText(data.document, 'Buyer PO document', 100));
        ensure(original.bucket === 'buyer-po', 'Choose the original buyer PO.');
        const recognition = await inspectPoNumber(original, reader);
        checkPoSession(cookie, session);
        return json(res, 200, recognition);
      }
      if (path === '/api/po-buyer') {
        ensure(permitted(session.role).includes('buyer-order'), 'This action requires the merchandising role.', 403, 'role');
        const original = store.ownedDocument(session, requiredText(data.document, 'Buyer PO document', 100));
        ensure(original.bucket === 'buyer-po', 'Choose the original buyer PO.');
        const result = await trackAiRead(session, data, options => extractPoBuyer(session, original, options));
        checkPoSession(cookie, session);
        return json(res, 200, { ...result, mapping: matchPoBuyer(store.readState(session.company_id).parties, result.buyer) });
      }
      if (path === '/api/po-ai-extract') {
        ensure(permitted(session.role).includes(PO_IMPORT_ACTION), 'This action requires the merchandising role.', 403, 'role');
        const reader = configuredPoReader(session, data.poNumberReader);
        const original = store.ownedDocument(session, requiredText(data.document || data.savedDocument, 'Buyer PO document', 100));
        ensure(original.bucket === 'buyer-po', 'Choose the original buyer PO.');
        const annexes = [];
        const documents = [{ doc: original, name: 'Buyer purchase order' }];
        let bytes = original.bytes.length;
        for (const id of poAnnexIds(data.annex)) {
          const annex = store.ownedDocument(session, requiredText(id, 'Technical annex', 100));
          ensure(annex.bucket === 'tech-pack', 'Choose uploaded technical sheets or annexes.');
          bytes += annex.bytes.length;
          ensure(bytes <= 50_000_000, 'Choose a buyer PO and supporting files up to 50 MB combined.', 413, 'ai-files-size');
          documents.push({ doc: annex, name: 'Buyer technical annex' });
          annexes.push(store.documentMeta(session, annex));
        }
        const extracted = await trackAiRead(session, data, options => extractBuyerPo(session, documents, data.provider, reader, options));
        checkPoSession(cookie, session);
        return json(res, 200, { ...extracted,
          document: store.documentMeta(session, original), annex: annexes[0] ?? null, annexes });
      }
      if (path === '/api/fabric-ai-extract') {
        ensure(permitted(session.role).includes(PO_IMPORT_ACTION), 'This action requires the merchandising role.', 403, 'role');
        const original = store.ownedDocument(session, requiredText(data.document, 'Garment tech pack', 100));
        ensure(original.bucket === 'tech-pack', 'Choose a garment tech pack.');
        const extracted = await trackAiRead(session, data, options => extractFabricTechPack(session, original, data.provider, options));
        checkPoSession(cookie, session);
        return json(res, 200, { ...extracted, document: store.documentMeta(session, original) });
      }
      if (path === '/api/certificate-analysis') {
        ensure(['Admin', 'Compliance'].includes(session.role), 'This action requires the compliance role.', 403, 'role');
        const doc = store.ownedDocument(session, requiredText(data.document, 'Document', 100));
        return json(res, 200, await analyseEvidence(doc));
      }
      if (path === '/api/company') {
        store.requireAdmin(session);
        const cid = store.transaction(() => store.newCompany({ id: session.user_id, login: session.login }, data.name, data.demo === 'yes' ? demo : null));
        return json(res, 201, { id: cid, companies: store.companies(session.user_id) });
      }
      if (path === '/api/members') return json(res, 200, store.assignMember(session, data));
      if (path === '/api/password') {
        sessionCookie(res, req, store.changePassword(session, data));
        return json(res, 200, { ok: true });
      }
    }
    return json(res, 404, { error: 'Page or action not found.' });
  } catch (error) {
    if (res.destroyed || res.headersSent) return;
    if (error instanceof DomainError) return json(res, error.status, { error: error.message, code: error.code, retry: error.retry });
    console.error(error);
    return json(res, 500, { error: 'HAPZO could not complete this request. See the local server log.', code: 'internal' });
  }
});

// Share one HTTP server so API sessions, document uploads and Vite HMR use the same origin.
const vite = process.argv.includes('--dev') ? await (await import('vite')).createServer({
  server: { port, middlewareMode: true, ws: { server } },
  appType: 'mpa',
  plugins: [{ name: 'hapzo-local-shell', transformIndexHtml: localShell }],
}) : null;
server.requestTimeout = 120_000;
server.listen(port, local, () => {
  console.log('HAPZO Local · ' + origin);
  console.log('Database · ' + DATABASE_PATH);
  if (process.argv.includes('--open')) {
    const browser = process.platform === 'win32'
      ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', origin], { windowsHide: true, detached: true, stdio: 'ignore' })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [origin], { detached: true, stdio: 'ignore' });
    browser.on('error', () => console.log('Open ' + origin + ' in your browser.'));
    browser.unref();
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await vite?.close();
  server.close(() => { store.db.close(); process.exit(0); });
});
