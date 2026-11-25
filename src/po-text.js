import { reviewExtraction } from './po-import.js';
import { readPoNumber } from './po-reference.js';

function textRows(items) {
  const rows = [];
  for (const item of items.filter(item => item.str?.trim()).sort((a, b) => b.transform[5] - a.transform[5])) {
    const y = item.transform[5];
    let row = rows.at(-1);
    if (!row || row.y - y > 2) rows.push(row = { y, cells: [] });
    row.cells.push({ x: item.transform[4], text: item.str.trim() });
  }
  return rows.map(row => row.cells.sort((a, b) => a.x - b.x));
}

const columns = {
  lineNo: /^(?:line|line no\.?|#)$/, articleNo: /^(?:style|article|style no\.?|article no\.?)$/,
  articleName: /^(?:description|item|item description)$/, color: /^colou?r$/, size: /^size$/,
  qty: /^(?:qty\.?|quantity|pieces)$/, price: /^(?:unit price|price|rate|[a-z]{3}\s*\/\s*pc)$/,
  delivery: /^(?:delivery|delivery date)$/,
};
const sizeHeader = /^(?:X{0,3}[SL]|M|[2-5]XL|\d{1,2})$/;
const asNumber = text => typeof text === 'string' && /^\d[\d,]*(?:\.\d+)?$/.test(text) ? Number(text.replaceAll(',', '')) : null;
const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function asDate(text = '') {
  const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (iso) return iso[0];
  const parts = text.match(/\b(\d{1,2})[- /]([a-z]{3,9})[- ,/]+(\d{4})\b/i);
  if (!parts) return '';
  const month = monthNames.indexOf(parts[2].slice(0, 3).toLowerCase()) + 1;
  return month ? [parts[3], String(month).padStart(2, '0'), parts[1].padStart(2, '0')].join('-') : '';
}

const labels = {
  po: /^(?:purchase order (?:number|no\.?)|p\.?o\.? (?:number|no\.?|#))$/i,
  buyer: /^(?:buyer(?:\s*\/\s*purchaser)?|purchaser|ordered by|bill to)$/i,
  date: /^(?:p\.?o\.? date|order date)$/i, shipDate: /^(?:requested delivery|ship by|ship date|delivery date)$/i,
  shipTo: /^ship[\s-]to$/i, terms: /^payment terms$/i, currency: /^currency$/i,
  totalPieces: /^total (?:pieces|pcs|quantity)$/i,
};
function readHeader(rows, order) {
  for (const [i, row] of rows.entries()) {
    for (const [j, cell] of row.entries()) {
      const [label, ...inline] = cell.text.split(/:\s*/);
      const key = Object.keys(labels).find(key => labels[key].test(label));
      if (!key || key === 'po' || order[key]) continue;
      let value = inline.join(': ').trim();
      if (!value && key === 'totalPieces') value = row[j + 1]?.text;
      const sameColumn = next => next?.find(other => Math.abs(other.x - cell.x) < 18)?.text;
      if (!value) value = sameColumn(rows[i + 1]);
      const isLabel = value => Object.values(labels).some(pattern => pattern.test(value || ''));
      if (key === 'buyer' && (!value || isLabel(value))) {
        for (let k = i - 1; k >= Math.max(i - 3, 0); k--) {
          value = sameColumn(rows[k]);
          if (value && !isLabel(value)) break;
        }
      }
      if (!value || isLabel(value)) continue;
      order[key] = key === 'totalPieces' ? asNumber(value) : ['date', 'shipDate'].includes(key) ? asDate(value) : value;
    }
  }
  const text = rows.map(row => row.map(cell => cell.text).join(' ')).join('\n');
  order.currency ||= text.match(/\b(?:INR|USD|EUR|GBP|CAD|AUD|JPY|CHF)\b/)?.[0];
  const dateWithCurrency = text.split('\n').find(row => /\d{4}\s*\/\s*[A-Z]{3}\b/.test(row));
  if (!order.date && dateWithCurrency) order.date = asDate(dateWithCurrency);
}
function readLines(rows, source) {
  let header, article;
  const lines = [];
  for (const row of rows) {
    const printed = row.map(cell => cell.text).join(' ');
    const match = printed.match(/^Article\s+(\S+)\s*\/\s*(.+)$/i);
    if (match) { article = { articleNo: match[1], articleName: match[2] }; continue; }
    const mapped = row.map(cell => ({
      ...cell, key: Object.keys(columns).find(key => columns[key].test(cell.text.toLowerCase())),
      matrixSize: sizeHeader.test(cell.text) ? cell.text : '',
    }));
    if (mapped.some(cell => cell.key === 'color') &&
        mapped.some(cell => cell.key === 'qty' || cell.matrixSize)) { header = mapped; continue; }
    if (!header) continue;
    if (/^(?:total\b|subtotal\b|po total\b|payment terms\b)/i.test(printed)) { header = null; continue; }
    const values = {};
    for (const cell of row) {
      const column = header.reduce((best, h) => Math.abs(h.x - cell.x) < Math.abs(best.x - cell.x) ? h : best);
      const key = column.key || column.matrixSize;
      if (key) values[key] = values[key] ? values[key] + ' ' + cell.text : cell.text;
    }
    const sizes = header.filter(cell => cell.matrixSize);
    const choices = sizes.length ? sizes.map(cell => [cell.matrixSize, asNumber(values[cell.matrixSize])])
      : [[values.size, asNumber(values.qty)]];
    for (const [size, qty] of choices) {
      if (qty == null || !size || !values.color) continue;
      const articleNo = values.articleNo || article?.articleNo || '';
      const articleName = values.articleName || article?.articleName || '';
      lines.push({ articleNo, articleName, style: articleNo || articleName, description: articleName,
        lineNo: values.lineNo, color: values.color, size, qty, price: asNumber(values.price),
        delivery: asDate(values.delivery), source });
    }
  }
  return lines;
}

export async function readPoPages(pdf, filename) {
  const order = {}, lines = [], pages = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const rows = textRows((await page.getTextContent()).items);
    pages.push({ page: pageNo, rows, method: 'PDF text' });
    readHeader(rows, order);
    lines.push(...readLines(rows, filename + ' p. ' + pageNo));
  }
  const poNumber = readPoNumber(pages);
  order.po = poNumber.status === 'matched' ? poNumber.value : '';
  if (!lines.length) {
    const error = new Error('No readable size and quantity table was found. Use a text PDF with labelled columns, or enter the order manually.');
    error.header = order;
    throw error;
  }
  const draft = reviewExtraction({ order, lines, specifications: [], details: [], review: [] });
  return { ...draft, poNumber };
}
