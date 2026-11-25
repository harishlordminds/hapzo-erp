import { readDocumentPages } from './document-text.js';
import { ensure, MATERIALS, STAGES, validDate } from './model.js';

let busy = false;

const labels = {
  number: /(?:scope\s+certificate|certificate|registration|licen[cs]e|product)\s*(?:no\.?|number|id|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9 /._-]{3,40})/i,
  issuer: /(?:issued by|certification body|certifying body|certificate issuer)\s*[:\-]?\s*([^\n]{3,100})/i,
  party: /(?:certificate holder|certified (?:company|organisation|organization)|issued to)\s*[:\-]?\s*([^\n]{3,100})/i,
  site: /(?:facility address|site address|covered site)\s*[:\-]?\s*([^\n]{3,100})/i,
  issue: /(?:date of issue|issue date|issued on|date issued)\s*[:\-]?\s*([^\n]{5,45})/i,
  from: /(?:valid from|effective date)\s*[:\-]?\s*([^\n]{5,45})/i,
  until: /(?:expiration date|expiry date|valid until|valid to|valid through|expires on)\s*[:\-]?\s*([^\n]{5,45})/i,
  programmeVersion: /(?:standard version|scheme version|criteria version|version)\s*[:\-]?\s*(\d+(?:\.\d+){0,3}(?:\s*\([\w -]{3,22}\))?)/i,
  criteria: /(?:product group|criteria reference|MRSL version)\s*[:\-]\s*([^\n]{2,100})/i,
  txSeller: /(?:certified seller|seller name|seller)\s*[:\-]\s*([^\n]{2,100})/i,
  txBuyer: /(?:certified buyer|buyer name|buyer)\s*[:\-]\s*([^\n]{2,100})/i,
  txShipment: /(?:shipment reference|shipment number|shipment no\.?|bill of lading)\s*[:\-]\s*([^\n]{2,100})/i,
  txMaterial: /(?:material code|article code|product code)\s*[:\-]\s*([^\n]{2,100})/i,
};
const schemes = [
  ['GOTS', /\bGOTS\b|global organic textile standard/i], ['OCS', /\bOCS\b|organic content standard/i],
  ['GRS', /\bGRS\b|global recycled standard/i], ['RCS', /\bRCS\b|recycled claim standard/i],
  ['OEKO-TEX STANDARD 100', /OEKO[\s-]*TEX[^\n]{0,40}STANDARD\s*100|STANDARD\s*100[^\n]{0,40}OEKO[\s-]*TEX/i],
  ['OEKO-TEX MADE IN GREEN', /\bMADE\s+IN\s+GREEN\b/i], ['OEKO-TEX STeP', /\bOEKO[\s-]*TEX[^\n]{0,20}\bSTeP\b/i],
  ['OEKO-TEX ECO PASSPORT', /\bECO\s+PASSPORT\b/i], ['OEKO-TEX RESPONSIBLE BUSINESS', /\bOEKO[\s-]*TEX[^\n]{0,20}RESPONSIBLE\s+BUSINESS\b/i],
  ['OEKO-TEX ORGANIC COTTON', /\bOEKO[\s-]*TEX[^\n]{0,20}ORGANIC\s+COTTON\b/i],
  ['OEKO-TEX LEATHER STANDARD', /\bLEATHER\s+STANDARD\b/i],
  ['bluesign / bluepass', /\b(?:bluesign|bluepass)\b/i], ['ZDHC', /\bZDHC\b/i],
  ['EU Ecolabel for textile products', /\bEU\s+ECOLABEL\b/i], ['Nordic Swan Ecolabel', /\bNORDIC\s+SWAN\b/i],
  ['Cradle to Cradle Certified Material Health', /(?:Cradle\s+to\s+Cradle|C2C)[^\n]{0,30}Material\s+Health|\bMaterial\s+Health\s+Certificate\b/i],
  ['Cradle to Cradle Certified', /(?:Cradle\s+to\s+Cradle|C2C)\s+Certified\b(?![^\n]{0,30}Material\s+Health)/i],
  ['CMiA Traceable', /(?:CMiA|cotton made in africa)[^\n]{0,30}(?:traceable|HIP)/i],
  ['CMiA Mass Balance', /(?:CMiA|cotton made in africa)[^\n]{0,30}mass balance/i],
  ['BCI', /\bBCI\b|Better Cotton/i],
  ['SA8000', /\bSA\s*8000\b/i], ['WRAP', /\bWorldwide Responsible Accredited Production\b|\bWRAP certification\b/i],
  ['SMETA', /\bSMETA\b/i], ['amfori BSCI', /\bBSCI\b/i], ['SLCP', /\bSLCP\b/i],
  ['Higg FEM', /\bHigg\s+FEM\b/i], ['Higg FSLM', /\bHigg\s+FSLM\b/i], ['ISO certification', /\bISO\s+\d{4,5}\b/i],
];

const types = [
  ['Transaction certificate', /\btransaction certificate\b/i], ['Subcontractor annex', /\bsubcontractor annex\b/i],
  ['Scope certificate', /\bscope certificate\b/i], ['Facility certificate', /\bfacility certificate\b/i],
  ['Material Health certificate', /\bmaterial health certificate\b/i], ['Wastewater report', /\bwastewater (?:test )?report\b/i],
  ['Sludge report', /\bsludge (?:test )?report\b/i], ['Article certificate', /\barticle certificate\b/i],
  ['Product certificate', /\bproduct certificate\b/i], ['Product ID', /\bproduct id\s*[:#-]/i],
  ['Licence', /\blicen[cs]e\s*(?:number|no\.|#)/i], ['Audit report', /\baudit report\b/i],
];
const coverage = /^(?:(?:covered|certified|listed)\s+)?(?:products?|articles?|components?|materials?|operations?|process(?:es)?|scope of certification|facilit(?:y|ies)(?: (?:address|list|addresses))?|subcontractors?|sites?|annex|appendix)\b/i;
const identifiers = /^\s*(?:SKU|article code|component code|chemical code|item code|product code)\s*[:#-]\s*([^\n]{2,100})/gim;

function scopeLines(page) {
  const lines = page.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.flatMap((line, index) => {
    if (!coverage.test(line)) return [];
    const next = lines[index + 1];
    const labelledValue = /[:\-]\s*\S/.test(line);
    return [{ value: labelledValue || !next || coverage.test(next) ? line : line + ' · ' + next, page: page.page }];
  });
}

function isoDate(value) {
  const iso = value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (iso && validDate(iso)) return iso;
  const parts = value.match(/\b(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})\b/);
  if (parts) {
    const [, a, b, yyyy] = parts;
    if (Number(a) <= 12 && Number(b) <= 12 && a !== b) return '';
    const day = Number(b) > 12 ? b : a;
    const month = Number(b) > 12 ? a : b;
    const normalized = yyyy + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0');
    return validDate(normalized) ? normalized : '';
  }
  const named = value.match(/\b(?:\d{1,2}[- .][A-Za-z]{3,9}[- ,.]+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/);
  const millis = named && Date.parse(named[0] + ' UTC');
  return millis && Number.isFinite(millis) ? new Date(millis).toISOString().slice(0, 10) : '';
}

export async function analyseEvidence(doc) {
  ensure(doc.bucket === 'evidence', 'Choose a certificate or annex from Evidence.');
  ensure(!busy, 'Another certificate is being processed. Try again in a moment.', 409, 'busy');
  busy = true;
  try {
    const pages = await readDocumentPages(doc);
    const suggestions = {};
    const warnings = [];
    const coverageRows = [];
    const exactCodes = new Map();
    for (const page of pages) {
      if (page.confidence != null && page.confidence < 80) warnings.push('Page ' + page.page + ' has low OCR confidence (' + page.confidence + '%). Compare the suggestions with the original.');
      for (const [k, regex] of Object.entries(labels)) {
        const value = page.text.match(regex)?.[1]?.trim();
        if (!value) continue;
        const resolved = ['issue', 'from', 'until'].includes(k) ? isoDate(value) : value;
        if (!resolved) warnings.push('Page ' + page.page + ': confirm ' + k + ' date manually (' + value + ').');
        else if (suggestions[k] && suggestions[k].value !== resolved) warnings.push('Page ' + page.page + ': multiple possible values for ' + k + '.');
        else suggestions[k] ??= { value: resolved, page: page.page };
      }
      for (const [name, regex] of schemes) if (regex.test(page.text)) {
        if (suggestions.scheme && suggestions.scheme.value !== name) warnings.push('Page ' + page.page + ': found another programme (' + name + ').');
        else suggestions.scheme ??= { value: name, page: page.page };
      }
      const type = types.find(([, regex]) => regex.test(page.text))?.[0];
      if (type && !suggestions.kind) suggestions.kind = { value: type, page: page.page };
      coverageRows.push(...scopeLines(page));
      for (const [, code] of page.text.matchAll(identifiers)) if (!exactCodes.has(code.trim())) exactCodes.set(code.trim(), page.page);
    }
    const coverageText = coverageRows.map(row => row.value).join('\n');
    const matches = (heading, options) => {
      const rows = coverageRows.filter(row => heading.test(row.value));
      const pattern = new RegExp('\\b(?:' + options.slice().sort((a, b) => b.length - a.length).join('|') + ')\\b', 'gi');
      const hits = new Set();
      const sources = new Set();
      for (const row of rows) for (const [matched] of row.value.matchAll(pattern)) {
        hits.add(matched.toLowerCase());
        sources.add(row.page);
      }
      if (hits.size) {
        const pages = [...sources];
        return { value: options.filter(name => hits.has(name.toLowerCase())).join(', '), page: pages[0], pages };
      }
      return null;
    };
    const op = matches(/operations?|process/i, ['Supply', ...Object.keys(STAGES)]);
    const material = matches(/material|product|article/i, MATERIALS);
    if (op) suggestions.operations = op;
    if (material) suggestions.materials = material;
    if (exactCodes.size) suggestions.scopeRefs = { value: [...exactCodes.keys()].join('\n').slice(0, 7900),
      page: exactCodes.values().next().value, pages: [...new Set(exactCodes.values())] };
    if (coverageText) suggestions.scopeText = { value: coverageText.slice(0, 7900), page: coverageRows[0].page, pages: [...new Set(coverageRows.map(row => row.page))] };
    const text = pages.map(page => page.text).join('\n');
    const annexExpected = /\b(?:see|refer to|listed in|specified in)\s+(?:the\s+)?(?:annex|appendix)\b/i.test(text) &&
      !/^\s*(?:annex|appendix)\s+[A-Z0-9]+\b/im.test(text);
    return { suggestions, warnings, annexExpected, pages: pages.map(p => ({ ...p, text: p.text.slice(0, 15000) })) };
  } finally {
    busy = false;
  }
}
