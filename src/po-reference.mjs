import { norm } from './model.mjs';

const label = /\b(?:(?:buyer|customer|client)(?:['’]s)?[ ]+)?(?:purchase[ ]+order|(?:buyer|customer)[ ]+order|p[. /]*o\.?)(?![\p{L}\p{N}])[ ]*(?:number\b|no\b\.?|ref(?:erence)?\b\.?|id\b|#)/giu;
const issuerLabel = /\b([A-Z]{2,8})[ ]+order[ ]*(?:number\b|no\b\.?|#)/gi;
const clientLabel = /\border[ ]*(?:number\b|no\b\.?)[ ]+(?:cli[eë]nt|customer)\b/gi;
const title = /^(?:(?:buyer|customer|client)(?:['’]s)?[ ]+)?(?:purchase[ ]+order|p[. /]*o\.?)(?:[ ]*[:#][ ]*|[ ]+)(?=\S)/i;
const headerTitle = /^(?:(?:buyer|customer|client)(?:['’]s)?\s+)?(?:purchase\s+order|p\.?\s*o\.?)\s*[:#]?$/i;
const headerCode = /^(?:[a-z0-9]+[-/])?PO[-/](?=[a-z0-9./-]*\d)[a-z0-9]+(?:[-./][a-z0-9]+)*$/i;
const otherReference = /\b(?:invoice|supplier|vendor|internal|previous|prior|quotation|sku|style|article|item|client order)\b/i;
const valueStart = /^[\s:#=–—-]*/u;
const identifier = /^[\p{L}\p{N}][\p{L}\p{N}._/‐‑‒–−-]{0,79}(?=$|[\s,;|])/u;
const spacedIdentifier = /^[A-Z]{1,8}[ ]+\d[\p{L}\p{N}._/‐‑‒–−-]{0,65}(?=$|[\s,;|])/u;
const unrelated = /^(?:date|dated|order|number|invoice|currency|terms|line|page|revision|rev|customer|buyer|supplier|vendor|delivery|ship|reference|ref|subtotal|total|details|pending|none|n\/a)$/i;
const dateCode = /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/](?:\d{2}|\d{4}))$/;

function candidate(value, explicit, adjacent = false) {
  const text = value.replace(valueStart, '').replace(/(?<=\w)[ ]*([/‐‑–-])[ ]*(?=\w)/g, '$1');
  const match = text.match(spacedIdentifier) ?? text.match(identifier);
  if (!match || unrelated.test(match[0]) || (adjacent || !explicit) && dateCode.test(match[0])) return '';
  const code = match[0];
  const tail = text.slice(code.length);
  if (/^,\d/.test(tail) || adjacent && tail.trim()) return '';
  if (/\p{N}/u.test(code)) return explicit || code.length >= 3 ? code.replace(/ +/g, ' ') : '';
  return explicit && code.length >= 3 && code === code.toUpperCase() && code === text.trim() ? code : '';
}

function labelledValue(cell, end, following) {
  const remainder = cell.text.slice(end);
  const given = candidate(remainder, true);
  if (given) return { value: given, confidence: cell.confidence };
  if (remainder.replace(valueStart, '').trim()) return null;
  for (const next of following) {
    const value = next && candidate(next.text, true, true);
    if (value) return { value, confidence: next.confidence };
  }
  return null;
}

export function referenceCandidates({ text, rows: positioned }) {
  const rows = positioned ?? text.replace(/[\u00A0\u202F]/g, ' ').replace(/\*\*/g, '').split(/\r?\n/)
    .map(line => line.split(/\t| {3,}/).map(cell => ({ text: cell.trim() }))).filter(cells => cells.some(cell => cell.text));
  const found = [];
  const titleRow = rows.slice(0, 12).findIndex(cells => cells.some(cell => headerTitle.test(cell.text)));
  const itemTable = rows.findIndex(cells => cells.some(cell => /^(?:qty\.?|quantity|unit price)$/i.test(cell.text)));
  rows.forEach((cells, rowIndex) => {
    const nearTitle = titleRow >= 0 && Math.abs(titleRow - rowIndex) <= 3 && (itemTable < 0 || rowIndex < itemTable);
    cells.forEach((cell, column) => {
      const nextRow = rows[rowIndex + 1];
      const below = cell.x === undefined ? nextRow?.[column] : nextRow?.find(other => Math.abs(other.x - cell.x) < 18);
      const following = [cells[column + 1], below];
      for (const match of cell.text.matchAll(label)) {
        if (/\b(?:supplier|vendor|internal|previous|prior)[ ]*$/i.test(cell.text.slice(0, match.index))) continue;
        const number = labelledValue(cell, match.index + match[0].length, following);
        if (number) found.push({ ...number, priority: 3 });
      }
      for (const match of cell.text.matchAll(issuerLabel)) {
        const issuer = match[1];
        if (issuer !== issuer.toUpperCase() || unrelated.test(issuer) || /^(?:INTERNAL|PREVIOUS|PRIOR)$/i.test(issuer)) continue;
        const number = labelledValue(cell, match.index + match[0].length, following);
        if (number && norm(number.value.slice(0, issuer.length)) === norm(issuer) && /^[ ._/-]*\d/.test(number.value.slice(issuer.length))) {
          found.push({ ...number, priority: 3 });
        }
      }
      for (const match of cell.text.matchAll(clientLabel)) {
        const number = labelledValue(cell, match.index + match[0].length, following);
        if (number) found.push({ ...number, priority: 0 });
      }
      const heading = cell.text.match(title);
      const value = heading && candidate(cell.text.slice(heading[0].length), false);
      if (value) found.push({ value, confidence: cell.confidence, priority: 2 });
      if (nearTitle && cell.text.length <= 80 && headerCode.test(cell.text) &&
          !cells.some(other => otherReference.test(other.text)) && !otherReference.test(rows[rowIndex - 1]?.[column]?.text || '')) {
        found.push({ value: cell.text, confidence: cell.confidence, priority: 1 });
      }
    });
  });
  return found;
}

export function readPoNumber(pages) {
  const numbers = pages.flatMap(page => referenceCandidates(page).map(row => ({ ...row, page: page.page, method: page.method, confidence: row.confidence ?? page.confidence })));
  const priority = numbers.reduce((max, row) => Math.max(max, row.priority), -1);
  const unique = new Map();
  for (const item of numbers.filter(row => row.priority === priority)) {
    const { value, page, method, confidence } = item;
    const key = norm(value).replaceAll(' ', '');
    const previous = unique.get(key);
    if (!previous || (confidence ?? 100) > (previous.confidence ?? 100)) unique.set(key, { value, page, method, confidence });
  }
  const candidates = [...unique.values()];
  if (candidates.length !== 1) return { status: candidates.length ? 'ambiguous' : 'missing', candidates: candidates.slice(0, 10) };
  const [number] = candidates;
  return priority === 0 || number.confidence != null && number.confidence < 70 ?
    { status: 'review', candidates } : { status: 'matched', ...number };
}
