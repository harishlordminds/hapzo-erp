import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { KINDS, ROLES, blank, req, clean, choice, ensure, norm, ref, DomainError } from './model.js';
import { execute, permitted } from './actions.js';
import { checkHistory } from './standards.js';
import { PO_IMPORT_ACTION } from './po-import.js';

export const DATABASE_PATH = resolve(process.env.HAPZO_DATA_DIR || 'data', 'hapzo.sqlite');
const SESSION_LIFETIME = 12 * 60 * 60 * 1000;
const defaultBuckets = ['buyer-po', 'tech-pack', 'evidence', 'stock', 'quality', 'production', 'logistics', 'invoice', 'cost', 'passport'];
const internalDocs = {
  'buyer-po': ['Merchandising'], 'tech-pack': ['Merchandising'], evidence: ['Compliance'], stock: ['Stores'], quality: ['Quality', 'Compliance'],
  production: ['Production'], logistics: ['Logistics', 'Stores', 'Production', 'Finance'],
  invoice: ['Finance'], cost: ['Finance'], passport: ['Compliance'],
};
export const digest = input => createHash('sha256').update(Buffer.isBuffer(input) ? input : JSON.stringify(input)).digest('hex');
const token = (bytes = 24) => randomBytes(bytes).toString('base64url');
const secretHash = value => createHash('sha256').update(value).digest('hex');
const ownerRole = row => row.role === 'Admin';

const schema = [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, salt TEXT NOT NULL, secret TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, settings TEXT NOT NULL, next INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS members (company_id TEXT NOT NULL REFERENCES companies(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, buyer_id TEXT NOT NULL DEFAULT '', PRIMARY KEY(company_id,user_id))",
  "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), company_id TEXT NOT NULL REFERENCES companies(id), expires INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS records (company_id TEXT NOT NULL REFERENCES companies(id), kind TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(company_id,kind,id))",
  "CREATE INDEX IF NOT EXISTS company_records ON records (company_id,kind,position)",
  "CREATE INDEX IF NOT EXISTS passport_link ON records (json_extract(body,'$.token')) WHERE kind='passports'",
  "CREATE TABLE IF NOT EXISTS documents (company_id TEXT NOT NULL REFERENCES companies(id), id TEXT NOT NULL, label TEXT NOT NULL, bucket TEXT NOT NULL, mime TEXT NOT NULL, sha256 TEXT NOT NULL, added_by TEXT NOT NULL REFERENCES users(id), added_at TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(company_id,id))",
  "CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), actor TEXT NOT NULL, action TEXT NOT NULL, state TEXT NOT NULL, target TEXT NOT NULL, details TEXT NOT NULL, at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS company_audit ON audit (company_id,seq DESC)",
  "CREATE TABLE IF NOT EXISTS operations (company_id TEXT NOT NULL REFERENCES companies(id), user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, reference TEXT NOT NULL, result_revision INTEGER NOT NULL, PRIMARY KEY(company_id,user_id,request_id))",
];

function credential(password, salt = randomBytes(16).toString('hex')) {
  return { salt, secret: scryptSync(password, salt, 64).toString('hex') };
}
function verifyPassword(password, user) {
  const expected = user?.secret || '0'.repeat(128);
  const actual = credential(password, user?.salt || 'hapzo-unregistered-account').secret;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex')) && Boolean(user);
}
function passwordRules(input) {
  const pass = String(input ?? '');
  ensure(pass.length >= 12 && pass.length <= 256, 'Use a password between 12 and 256 characters.');
  return pass;
}
function loginName(input) {
  const name = norm(req(input, 'Login', 100));
  ensure(/^[a-z0-9][a-z0-9_.@+-]*$/.test(name), 'Use a login with letters, numbers or email punctuation.');
  return name;
}

export class Store {
  constructor(path = DATABASE_PATH) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.db.exec(schema.join(';') + ';');
  }
  query(sql, ...params) { return this.db.prepare(sql).all(...params); }
  get(sql, ...params) { return this.db.prepare(sql).get(...params); }
  run(sql, ...params) { return this.db.prepare(sql).run(...params); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const output = fn();
      this.db.exec('COMMIT');
      return output;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  initialized() { return Boolean(this.get('SELECT 1 FROM users LIMIT 1')); }
  createUser(login, label, password) {
    const user = { id: token(12), login: loginName(login), display_name: req(label, 'User name', 100), ...credential(passwordRules(password)) };
    this.run('INSERT INTO users(id,login,display_name,salt,secret) VALUES(?,?,?,?,?)', user.id, user.login, user.display_name, user.salt, user.secret);
    return user;
  }
  newCompany(user, name, initial) {
    name = req(name, 'Company name', 120);
    const cid = token(12);
    const s = initial?.() ?? blank({ name });
    s.settings.name = name;
    this.run('INSERT INTO companies(id,name,settings,next,revision) VALUES(?,?,?,?,0)', cid, name, JSON.stringify(s.settings), s.next);
    this.run("INSERT INTO members(company_id,user_id,role) VALUES(?,?,'Admin')", cid, user.id);
    this.saveRecords(cid, s, null);
    this.writeAudit(cid, user.login, 'company-create', 'Posted', cid, initial ? 'Sample workspace' : '');
    return cid;
  }
  bootstrap(data) {
    return this.transaction(() => {
      ensure(!this.initialized(), 'Setup is already complete. Sign in.', 409, 'setup');
      const user = this.createUser(data.login, data.displayName, data.password);
      const companyId = this.newCompany(user, data.companyName);
      return this.mint(user.id, companyId);
    });
  }
  mint(userId, companyId) {
    const raw = token(32);
    this.run('DELETE FROM sessions WHERE expires < ?', Date.now());
    this.run('INSERT INTO sessions VALUES(?,?,?,?)', secretHash(raw), userId, companyId, Date.now() + SESSION_LIFETIME);
    return raw;
  }
  signIn(data) {
    const login = loginName(data.login);
    const pass = String(data.password ?? '');
    ensure(pass.length <= 256, 'Incorrect login or password.', 401, 'login');
    const user = this.get('SELECT * FROM users WHERE login=?', login);
    ensure(verifyPassword(pass, user), 'Incorrect login or password.', 401, 'login');
    const member = this.get('SELECT company_id FROM members JOIN companies ON companies.id=members.company_id WHERE user_id=? ORDER BY companies.rowid LIMIT 1', user.id);
    ensure(member, 'This account needs a workspace assignment.', 403, 'role');
    return this.mint(user.id, member.company_id);
  }
  session(raw) {
    if (typeof raw !== 'string' || !/^[\w-]{43}$/.test(raw)) return null;
    return this.get([
      'SELECT sessions.user_id, sessions.company_id, sessions.token_hash, users.login, users.display_name, members.role, members.buyer_id',
      'FROM sessions JOIN users ON users.id=sessions.user_id JOIN members ON members.user_id=sessions.user_id AND members.company_id=sessions.company_id',
      'WHERE token_hash=? AND expires>?',
    ].join(' '), secretHash(raw), Date.now()) ?? null;
  }
  removeSession(raw) {
    if (raw) this.run('DELETE FROM sessions WHERE token_hash=?', secretHash(raw));
  }
  companies(userId) {
    return this.query('SELECT companies.id, companies.name, members.role FROM members JOIN companies ON companies.id=members.company_id WHERE user_id=? ORDER BY name', userId);
  }
  switchCompany(session, cid) {
    ensure(this.get('SELECT 1 FROM members WHERE company_id=? AND user_id=?', String(cid ?? ''), session.user_id), 'You do not have access to this company.', 403, 'company');
    this.run('UPDATE sessions SET company_id=? WHERE token_hash=?', cid, session.token_hash);
  }
  changePassword(session, data) {
    return this.transaction(() => {
      const user = this.get('SELECT * FROM users WHERE id=?', session.user_id);
      const current = String(data.current ?? '');
      ensure(current.length <= 256 && verifyPassword(current, user), 'The current password is incorrect.', 403, 'credential');
      const next = credential(passwordRules(data.password));
      this.run('UPDATE users SET salt=?,secret=? WHERE id=?', next.salt, next.secret, session.user_id);
      this.run('DELETE FROM sessions WHERE user_id=?', session.user_id);
      return this.mint(session.user_id, session.company_id);
    });
  }
  requireAdmin(session) { ensure(ownerRole(session), 'This action requires the workspace admin role.', 403, 'role'); }
  listMembers(session) {
    this.requireAdmin(session);
    return this.query('SELECT users.login,users.display_name AS name,members.role,members.buyer_id AS buyerId FROM members JOIN users ON users.id=members.user_id WHERE company_id=? ORDER BY users.login', session.company_id);
  }
  assignMember(session, data) {
    this.requireAdmin(session);
    return this.transaction(() => {
      const cid = session.company_id;
      const login = loginName(data.login);
      const role = choice(data.role, [...ROLES, 'Remove access'], 'workspace role');
      let user = this.get('SELECT id,login FROM users WHERE login=?', login);
      if (!user) {
        ensure(role !== 'Remove access', 'Select an existing workspace user.');
        user = this.createUser(login, data.name, data.password);
      } else {
        ensure(!data.password, 'Use the existing user’s login and leave the initial password blank.');
      }
      ensure(user.id !== session.user_id, 'Use another admin account to change your own membership.');
      const buyerId = role === 'Buyer' ? req(data.buyerId, 'Linked buyer', 60) : '';
      if (buyerId) {
        const buyer = this.get("SELECT body FROM records WHERE company_id=? AND kind='parties' AND id=?", cid, buyerId);
        ensure(buyer && JSON.parse(buyer.body).type === 'Buyer', 'Choose a buyer master record for this login.');
      }
      if (role === 'Remove access') {
        this.run('DELETE FROM members WHERE company_id=? AND user_id=?', cid, user.id);
        this.run('DELETE FROM sessions WHERE company_id=? AND user_id=?', cid, user.id);
      } else {
        this.run('INSERT INTO members VALUES(?,?,?,?) ON CONFLICT(company_id,user_id) DO UPDATE SET role=excluded.role,buyer_id=excluded.buyer_id', cid, user.id, role, buyerId);
      }
      this.writeAudit(cid, session.login, 'workspace-membership', 'Posted', login, role);
      return { login, role };
    });
  }
  readState(cid) {
    const header = this.get('SELECT * FROM companies WHERE id=?', cid);
    ensure(header, 'Company does not exist.', 404, 'not-found');
    const s = blank(JSON.parse(header.settings));
    s.next = header.next;
    s.revision = header.revision;
    for (const row of this.query('SELECT kind,body FROM records WHERE company_id=? ORDER BY kind,position', cid)) {
      if (KINDS.includes(row.kind)) s[row.kind].push(JSON.parse(row.body));
    }
    return s;
  }
  saveRecords(cid, state, before) {
    const upsert = this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(company_id,kind,id) DO UPDATE SET position=excluded.position,body=excluded.body');
    const del = this.db.prepare('DELETE FROM records WHERE company_id=? AND kind=? AND id=?');
    for (const kind of KINDS) {
      const old = new Map((before?.[kind] ?? []).map((r, index) => [r.id, { index, data: JSON.stringify(r) }]));
      state[kind].forEach((row, index) => {
        const data = JSON.stringify(row);
        const prior = old.get(row.id);
        if (!prior || prior.data !== data || prior.index !== index) upsert.run(cid, kind, row.id, index, data);
        old.delete(row.id);
      });
      for (const removed of old.keys()) del.run(cid, kind, removed);
    }
  }
  writeAudit(cid, actor, action, result, target, details = '', at = new Date().toISOString()) {
    this.run('INSERT INTO audit(company_id,actor,action,state,target,details,at) VALUES(?,?,?,?,?,?,?)', cid, actor, action, result, target, details, at);
  }
  readAudit(cid) {
    return this.query('SELECT actor,action,state,target,details,at FROM audit WHERE company_id=? ORDER BY seq DESC LIMIT 200', cid);
  }
  context(session, at = new Date().toISOString()) {
    return {
      role: session.role, actor: session.login, at, digest, publicToken: () => token(),
      hasBuyerPortalAccess: id => Boolean(this.get('SELECT 1 FROM members WHERE company_id=? AND buyer_id=? LIMIT 1', session.company_id, id)),
      document: (key, buckets, required = false) => {
        if (!key && !required) return null;
        const row = this.get('SELECT id,label,bucket,mime,sha256 FROM documents WHERE company_id=? AND id=?', session.company_id, String(key || ''));
        ensure(row && buckets.includes(row.bucket), 'Select an uploaded document in the correct category.');
        return row;
      },
    };
  }
  post(session, data) {
    const cid = session.company_id;
    ensure(data.companyId === cid, 'The selected workspace changed. Reload this page before posting.', 409, 'workspace-changed');
    ensure(Number.isSafeInteger(data.revision) && /^[\w-]{12,80}$/.test(data.requestId ?? ''), 'A workspace revision and request ID are required.');
    const action = req(data.action, 'Transaction', 50);
    ensure(permitted(session.role).includes(action), 'Your workspace role cannot post this transaction.', 403, 'role');
    const hashed = digest([action, data.input]);
    try {
      return this.transaction(() => {
        const sent = this.get('SELECT * FROM operations WHERE company_id=? AND user_id=? AND request_id=?', cid, session.user_id, data.requestId);
        if (sent) {
          ensure(sent.payload_hash === hashed, 'This request ID has already been used for a different submission.', 409, 'request-id');
          return { id: sent.reference, revision: sent.result_revision, replayed: true };
        }
        const state = this.readState(cid);
        ensure(data.revision === state.revision, 'Another user posted a change. The latest data is loaded. Review the form before posting again.', 409, 'stale');
        const before = structuredClone(state);
        const ctx = this.context(session);
        const record = execute(state, action, data.input, ctx);
        const reference = String(record.id);
        const revision = state.revision + 1;
        this.saveRecords(cid, state, before);
        this.run('UPDATE companies SET name=?,settings=?,next=?,revision=? WHERE id=?', state.settings.name, JSON.stringify(state.settings), state.next, revision, cid);
        this.writeAudit(cid, session.login, action, 'Posted', reference, '', ctx.at);
        this.run('INSERT INTO operations VALUES(?,?,?,?,?,?)', cid, session.user_id, data.requestId, hashed, reference, revision);
        return { id: reference, revision };
      });
    } catch (error) {
      if (error.code === 'standard-lock') this.writeAudit(cid, session.login, action, 'Blocked', clean(data.input?.lotId || data.input?.workOrderId, 150), error.message);
      throw error;
    }
  }
  documentMeta(session, row) {
    return { id: row.id, label: row.label, mime: row.mime, size: row.bytes.length, sha256: row.sha256, bucket: row.bucket };
  }
  addDocument(session, { name, mime, bucket, content }) {
    ensure(ownerRole(session) || internalDocs[bucket]?.includes(session.role), 'Your role cannot upload this document type.', 403, 'role');
    choice(bucket, defaultBuckets, 'document category');
    const label = req(name, 'File name', 220).replace(/[\r\n\/\\]/g, '_');
    ensure(typeof content === 'string' && content.length <= 14_000_000 && /^[\w+\/]*={0,2}$/.test(content), 'Choose a supported file up to 10 MB.');
    const bytes = Buffer.from(content, 'base64');
    ensure(bytes.length > 0 && bytes.length <= 10_000_000, 'Choose a document up to 10 MB.');
    const matches = {
      'application/pdf': bytes.subarray(0, 5).toString() === '%PDF-',
      'image/png': bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
      'image/jpeg': bytes.subarray(0, 3).toString('hex') === 'ffd8ff',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['buyer-po', 'tech-pack'].includes(bucket) &&
        /\.xlsx$/i.test(label) && bytes.subarray(0, 4).toString('hex') === '504b0304' && bytes.includes('xl/workbook.xml') && bytes.includes('[Content_Types].xml'),
    };
    ensure(Object.hasOwn(matches, mime) && matches[mime] === true, 'Upload a supported PDF, PNG, JPEG or buyer PO Excel file.');
    const row = { id: token(16), label, bucket, mime, sha256: digest(bytes), bytes };
    this.run('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)', session.company_id, row.id, label, bucket, mime, row.sha256, session.user_id, new Date().toISOString(), bytes);
    return this.documentMeta(session, row);
  }
  ownedDocument(session, id) {
    const row = this.get('SELECT * FROM documents WHERE company_id=? AND id=?', session.company_id, id);
    ensure(row && this.canReadDocument(session, row), 'Document not found.', 404, 'not-found');
    return { ...row, bytes: Buffer.from(row.bytes) };
  }
  canReadDocument(session, row) {
    if (row.bucket === 'tech-pack' && ['Production', 'Quality', 'Stores'].includes(session.role)) return true;
    if (ownerRole(session) || internalDocs[row.bucket]?.includes(session.role)) return true;
    if (session.role !== 'Buyer' || !session.buyer_id) return false;
    const s = this.readState(session.company_id);
    const owned = [...s.orders, ...s.shipments, ...s.invoices].filter(doc => doc.buyerId === session.buyer_id);
    return owned.some(doc => [doc.document, doc.deliveryDocument, ...(doc.revisions ?? []).map(r => r.document)].some(x => x?.id === row.id));
  }
  publicPassport(link) {
    const row = this.get([
      "SELECT company_id,body FROM records WHERE kind='passports' AND json_extract(body,'$.token')=?",
      "AND json_extract(body,'$.status') IN ('Published','Suspended') ORDER BY CAST(json_extract(body,'$.version') AS INTEGER) DESC LIMIT 1",
    ].join(' '), link);
    if (!row) return null;
    const p = JSON.parse(row.body);
    const s = this.readState(row.company_id);
    const lot = ref(s.lots, p.lotId);
    try {
      if (p.status === 'Published' && lot?.qualityStatus === 'Released') {
        checkHistory(s, lot);
        const valid = (p.claimChecks ?? []).every(check => check.evidence.every(e => ref(s.evidence, e.id)?.status === 'Verified'));
        if (valid) return p.publicSnapshot;
      }
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
    return { state: 'Suspended' };
  }
  view(session) {
    const s = this.readState(session.company_id);
    if (session.role === 'Buyer') return this.buyerView(session, s);
    if (permitted(session.role).includes(PO_IMPORT_ACTION)) {
      s.buyerPoUploads = this.query(`SELECT id,label,added_at AS addedAt FROM (
        SELECT id,label,added_at,row_number() OVER (PARTITION BY sha256 ORDER BY added_at DESC,id DESC) AS copy
        FROM documents WHERE company_id=? AND bucket='buyer-po'
      ) WHERE copy=1 ORDER BY added_at DESC,id DESC LIMIT 50`, session.company_id);
    } else {
      s.lines = s.lines.map(({ garmentDraft, ...line }) => line);
    }
    if (!['Admin', 'Finance'].includes(session.role)) {
      s.costs = [];
      s.accounts = [];
      s.vouchers = [];
      s.invoices = s.invoices.map(({ id, number, date, shipmentId, serviceOrderId, status }) => ({ id, number, date, shipmentId, serviceOrderId, status }));
    }
    if (!['Admin', 'Compliance'].includes(session.role)) {
      s.evidence = s.evidence.map(({ id, scheme, kind, role, party, site, number, operations, materials, from, until, status }) =>
        ({ id, scheme, kind, role, party, site, number, operations, materials, from, until, status }));
      s.passports = s.passports.filter(p => p.status === 'Published')
        .map(({ id, lotId, version, status, token, publicSnapshot }) => ({ id, lotId, version, status, token, publicSnapshot }));
    }
    if (ownerRole(session)) s.audit = this.readAudit(session.company_id);
    return s;
  }
  buyerView(session, s) {
    const owned = row => row.buyerId && row.buyerId === session.buyer_id;
    const orders = s.orders.filter(owned).map(({ poDetails, ...order }) => order);
    const ids = new Set(orders.map(o => o.id));
    const lines = s.lines.filter(l => ids.has(l.orderId) && l.status === 'Approved').map(
      ({ id, orderId, lineNo, style, articleNo, articleName, clientOrderNo, color, colorCode, size, qty, unit, price, delivery, schedule, status }) =>
        ({ id, orderId, lineNo, style, articleNo, articleName, clientOrderNo, color, colorCode, size, qty, unit, price, delivery, schedule, status }));
    const shipments = s.shipments.filter(owned);
    const shipped = new Set(shipments.flatMap(sh => sh.lotIds));
    const passports = s.passports.filter(p => p.status === 'Published' && shipped.has(p.lotId))
      .map(({ id, lotId, token, version, status }) => ({ id, lotId, token, version, status }));
    return {
      settings: { name: s.settings.name }, revision: s.revision, orders, lines, passports,
      shipments: shipments.map(({ claimDecisions, claims, packingList, ...sh }) => ({
        ...sh, packingList: (packingList ?? []).map(({ contents, ...carton }) => ({
          ...carton, contents: contents.map(({ lotId, ...sku }) => sku),
        })),
      })),
      invoices: s.invoices.filter(owned),
    };
  }
}
