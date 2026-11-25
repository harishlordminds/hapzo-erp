import { positionText, readDocumentPages } from './document-text.js';
import { norm } from './model.js';
import { readPoNumber, referenceCandidates } from './po-reference.js';

const hostedEndpoint = 'https://free-oxr.somark.ai/api/v1/parse/sync';
const textBlocks = new Set(['Title', 'Text', 'Page-header', 'Page-footer', 'Table', 'Caption', 'Footnote']);
const extensions = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg' };
const pendingReads = new Map();
function oxrPageText(blocks) {
  return blocks.filter(block => textBlocks.has(block?.type) && typeof block.content === 'string').map(block => {
    if (block.format !== 'html') return block.content;
    return block.content.replace(/<\/t[dh]\s*>/gi, '\t').replace(/<\/(?:tr|p)\s*>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replace(/&#(?:35|x23);/gi, '#')
      .replace(/&amp;/gi, '&').replace(/&colon;|&#58;/gi, ':');
  }).join('\n');
}

function localOXR() {
  const base = new URL(process.env.HAPZO_OXR_URL || 'http://127.0.0.1:8000/v1');
  if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
    base.username || base.password || base.search || base.hash) throw new Error('Invalid local OXR address');
  return base.toString().replace(/\/+$/, '') + '/parse/sync';
}

async function oxrPages(doc, hosted) {
  const extension = extensions[doc.mime];
  const filename = /\.(?:pdf|jpe?g|png)$/i.test(doc.label) ? doc.label : doc.label + extension;
  const form = new FormData();
  form.set('file', new Blob([doc.bytes], { type: doc.mime }), filename);
  form.set('api_key', 'dummy');
  form.set('output_formats', 'json');
  form.set('feature_config', JSON.stringify({ keep_header_footer: true }));
  form.set('element_formats', JSON.stringify({ image: 'none', table: 'html' }));
  const response = await fetch(hosted ? hostedEndpoint : localOXR(), {
    method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error('OXR request failed');
  const result = await response.json();
  const pages = result?.data?.result?.outputs?.json?.pages;
  if (result?.code !== 0 || !Array.isArray(pages) || !pages.length || !pages.every(page => Array.isArray(page?.blocks))) {
    throw new Error('OXR returned no pages');
  }
  return pages.map((row, index) => ({
    page: Number.isInteger(row.page_num) && row.page_num >= 0 ? row.page_num + 1 : index + 1,
    text: oxrPageText(row.blocks), method: hosted ? 'Hosted SoMark OXR' : 'Local SoMark OXR',
  }));
}

export async function readLocalDocumentLayout(doc) {
  if (!Object.hasOwn(extensions, doc.mime)) return [];
  try {
    const layout = await oxrPages(doc, false);
    if (layout.some(page => page.text.trim())) return layout;
  } catch {}
  try {
    const pages = await readDocumentPages(doc, { formatText: positionText });
    return pages.map(({ page, text, method }) => ({ page, text, method }));
  } catch { return []; }
}

async function readPdfOrImage(doc, reader) {
  let notice = '';
  let suggestion;
  let layout = [];
  if (reader !== 'local-ocr') {
    try {
      layout = await oxrPages(doc, reader === 'hosted-oxr');
      const result = readPoNumber(layout);
      if (['matched', 'ambiguous'].includes(result.status)) return { number: result, layout };
      if (result.status === 'review') suggestion = result;
      notice = 'OXR could not confirm the buyer PO number. HAPZO checked with its built-in reader.';
    } catch (error) {
      if (reader === 'local-oxr') {
        notice = error.cause?.code === 'ECONNREFUSED' ? 'The local OXR service is offline. HAPZO used its built-in reader.' :
          'The local OXR service could not read this file. HAPZO used its built-in reader.';
      } else notice = 'Hosted OXR could not read this file. HAPZO used its built-in reader.';
    }
  }
  try {
    const pages = await readDocumentPages(doc, {
      formatText: positionText,
      needsOcr: (text, page) => !referenceCandidates({ text }).some(row => row.priority > 0) && (page <= 2 || text.trim().length < 60),
      refineOcr: page => page.confidence < 70 || !referenceCandidates(page).some(row => row.priority > 0),
    });
    const result = readPoNumber(pages);
    if (!layout.some(page => page.text.trim())) layout = pages.map(({ page, text, method }) => ({ page, text, method }));
    return { number: { ...(result.status === 'missing' && suggestion ? suggestion : result), notice }, layout };
  } catch {
    const number = suggestion ? { ...suggestion, notice } : { status: 'unreadable', notice: 'The document could not be read. Check the file or enter the PO number.' };
    return { number, layout };
  }
}

export function inspectPoDocument(doc, reader) {
  if (!Object.hasOwn(extensions, doc.mime)) return Promise.resolve({ number: { status: 'unsupported' }, layout: [] });
  if (!doc.sha256) return readPdfOrImage(doc, reader);
  const key = [doc.company_id, doc.sha256, reader].join('|');
  const cached = pendingReads.get(key);
  if (cached && cached.until > Date.now()) return cached.result;
  if (pendingReads.size >= 60) pendingReads.delete(pendingReads.keys().next().value);
  const entry = { until: Infinity };
  entry.result = readPdfOrImage(doc, reader).then(result => {
    entry.until = Date.now() + (result.number.notice ? 30_000 : 10 * 60_000);
    return result;
  });
  pendingReads.set(key, entry);
  return entry.result;
}

export async function inspectPoNumber(doc, reader) {
  return (await inspectPoDocument(doc, reader)).number;
}

export function applyPoNumber(extracted, recognition) {
  const previous = extracted.order.po;
  if (recognition.status === 'matched') {
    extracted.order.po = recognition.value;
    if (previous && norm(previous) !== norm(recognition.value)) {
      extracted.review.unshift('The AI draft suggested PO ' + previous + '. Check the number read from the buyer document.');
    }
  } else if (recognition.status === 'ambiguous' || recognition.status === 'review') {
    extracted.order.po = '';
  } else if (previous && ['missing', 'unreadable'].includes(recognition.status)) {
    return { ...extracted, poNumber: { ...recognition, status: 'suggested', value: previous } };
  }
  return { ...extracted, poNumber: recognition };
}
