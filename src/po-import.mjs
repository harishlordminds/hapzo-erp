import { CURRENCIES, DomainError, ensure, norm, round, validDate } from './model.mjs';
import { FABRIC_CONDITIONS, FABRIC_INPUTS, FABRIC_METRICS, FABRIC_TYPES, YARN_COUNT_UNITS, toleranceField } from './fabric.mjs';

export const PO_IMPORT_MAX_LINES = 50;
export const PO_IMPORT_ACTION = 'import-buyer-po';
export const PO_AI_PROVIDERS = { gemini: 'Gemini', openai: 'OpenAI' };
export const PO_NUMBER_READERS = { 'local-oxr': 'Local SoMark OXR', 'hosted-oxr': 'Hosted SoMark OXR', 'local-ocr': 'Local PDF text and OCR' };
export const poNumberReader = settings => settings?.poNumberReader || 'local-ocr';

export function poAnnexIds(value) {
  ensure(value == null || typeof value === 'string', 'Choose uploaded technical sheets or annexes.');
  return [...new Set((value || '').split(',').map(id => id.trim()).filter(Boolean))];
}

const scalar = type => ({ type: [type, 'null'] });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = items => ({ type: 'array', items });
const fields = (type, keys) => Object.fromEntries(keys.split(' ').map(key => [key, scalar(type)]));

const construction = object({
  ...fields('string', 'fabricType fabricStructure fabricCondition countUnit'),
  ...fields('number', ['gsm', 'countSpanIn', ...Object.values(FABRIC_INPUTS).flat().map(([key]) => key)].join(' ')),
  ...fields('string', Object.keys(FABRIC_METRICS).map(toleranceField).join(' ')),
});
const fabric = object({
  ...fields('string', 'code role description millRef colourRef labDip widthMode structure blend warpGround weftPlating yarnSystems machine grainRepeat dyePrint finish notes areaBasis markerBasis pattern washMethod grossTolerance usableTolerance'),
  ...fields('number', 'grossWidth usableWidth yarnRepeatCells markerEfficiency markerLength markerPieces extraLoss lengthShrink lengthShrinkBefore lengthShrinkAfter widthShrink widthShrinkBefore widthShrinkAfter'),
  construction,
});
const pomFields = {
  ...fields('string', 'code name method tolerance'), ...fields('number', 'target base grade'),
};
const garmentFields = {
  ...fields('string', 'category fit patternRef sampleRef measurementUnit baseSize measurementStage assembly artwork care packaging'),
  ...fields('number', 'sizeSteps garmentLoss cartonCapacity'),
  fabrics: array(fabric),
  poms: array(object({ ...pomFields, sizeTargets: array(object({ size: scalar('string'), target: scalar('number') })) })),
  operations: array(object({ ...fields('string', 'operation seam stitch thread notes'), ...fields('number', 'allowance stitches span length ratio') })),
  trims: array(object({ ...fields('string', 'itemCode description basis'), ...fields('number', 'per loss') })),
  tests: array(object({ ...fields('string', 'code scope name method unit condition'), ...fields('number', 'min max') })),
};
const orderFields = {
  ...fields('string', 'po clientOrderNo buyer buyerCode buyerTaxId client division date shipDate currency shipTo terms source'),
  ...fields('number', 'totalPieces'),
};
const lineFields = {
  ...fields('string', 'lineNo articleNo articleName clientOrderNo style color colorCode size sku lot delivery specRev description specKey source'),
  ...fields('number', 'qty price'),
};
const poDetailFields = array(object(fields('string', 'label value source')));
export const extractionSchema = object({ order: object(orderFields), lines: array(object(lineFields)),
  specifications: array(object({ key: scalar('string'), source: scalar('string'), ...garmentFields })),
  details: poDetailFields, review: array(scalar('string')),
});
export const buyerIdentitySchema = object(fields('string', 'name code taxId country currency source'));
export const fabricExtractionSchema = object({ fabrics: array(object({
  ...fields('string', 'code role description source yarnSystems'),
  ...fields('number', 'measuredGsm swatchMassG swatchAreaCm2 yarnRepeatCells'),
  construction,
})), review: array(scalar('string')) });

const isRecord = input => input && typeof input === 'object' && !Array.isArray(input);
const visibleText = (value, max = 1200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const finiteNumber = value => {
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= 1e10 ? round(n) : null;
};

function valuesFrom(input, schema) {
  if (schema.type === 'array') return (Array.isArray(input) ? input : []).filter(x => x != null).slice(0, 150).map(row => valuesFrom(row, schema.items));
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties)
    .map(([key, field]) => [key, valuesFrom(isRecord(input) && Object.hasOwn(input, key) ? input[key] : null, field)]));
  return schema.type[0] === 'number' ? finiteNumber(input) : visibleText(input, 4000);
}

function safeCode(input, fallback) {
  return /^[\p{L}\d][\p{L}\d._/-]{0,63}$/u.test(input) ? input.toUpperCase() : fallback;
}

function coded(rows, prefix, reserved = []) {
  const codes = new Set(reserved);
  return rows.map((row, index) => {
    const fallback = prefix + '-' + (index + 1);
    let code = safeCode(row.code, fallback);
    const prior = code;
    while (codes.has(code)) code = (code === prior ? fallback : code) + '-X';
    codes.add(code);
    return { ...row, code };
  });
}

const calendarDate = value => validDate(value) ? value : '';

export function poSourceDetails(rows) {
  return valuesFrom(rows, poDetailFields).filter(row => row.label && row.value).slice(0, 100).map(row => ({
    label: row.label.slice(0, 150), value: row.value.slice(0, 2000), source: row.source.slice(0, 300),
  }));
}

export function readBuyerIdentity(raw) {
  ensure(isRecord(raw), 'Gemini returned an unreadable buyer identity.', 502, 'ai-result');
  const { name, code, taxId, country, currency, source } = valuesFrom(raw, buyerIdentitySchema);
  return { name: name.slice(0, 200), code: code.slice(0, 100), taxId: taxId.slice(0, 30), country: country.slice(0, 80),
    currency: CURRENCIES.includes(currency.toUpperCase()) ? currency.toUpperCase() : '', source: source.slice(0, 300) };
}

const partyName = value => norm(value).normalize('NFKD').replace(/\p{M}/gu, '').replaceAll('&', ' and ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const legalSuffix = / (?:private limited|pvt ltd|co ltd|company limited|limited|ltd|llp|llc|l l c|incorporated|inc|gmbh|sarl|b v|bv|n v|nv|pte ltd)$/;
const baseName = value => partyName(value).replace(legalSuffix, '');
const taxNumber = value => norm(value).replace(/[^a-z0-9]/g, '');

export function matchPoBuyer(parties, identity) {
  const { name, code, taxId } = identity;
  const buyers = parties.filter(party => party.type === 'Buyer');
  const nameKey = partyName(name);
  const codeKey = norm(code);
  const taxKey = taxNumber(taxId);
  const exactName = nameKey ? buyers.filter(party => partyName(party.name) === nameKey) : [];
  const byName = exactName.length ? exactName : buyers.filter(party => nameKey && baseName(party.name) === baseName(name));
  const byCode = buyers.filter(party => codeKey ? norm(party.code) === codeKey : nameKey && partyName(party.code) === nameKey);
  const byTax = buyers.filter(party => taxKey && taxNumber(party.gstin) === taxKey);
  const signals = [byTax, byCode, byName].filter(matches => matches.length);
  const choices = new Set(signals.flat().map(party => party.id));
  const confirmed = buyers.filter(party => choices.has(party.id) && signals.every(rows => rows.includes(party)));
  const candidates = confirmed.length ? confirmed : buyers.filter(party => choices.has(party.id));
  return { status: confirmed.length === 1 ? 'matched' : candidates.length ? 'ambiguous' : nameKey || codeKey || taxKey ? 'unmatched' : 'missing',
    candidates: candidates.map(({ id, name, code, currency }) => ({ id, name, code, currency })) };
}

export function reviewExtraction(raw) {
  ensure(isRecord(raw) && isRecord(raw.order) && Array.isArray(raw.lines) && Array.isArray(raw.specifications),
    'The AI provider returned an unreadable buyer PO draft. Retry the import.', 502, 'ai-result');
  const { order, lines, specifications, review } = valuesFrom(raw, extractionSchema);
  order.date = calendarDate(order.date);
  order.shipDate = calendarDate(order.shipDate);
  order.currency = CURRENCIES.includes(order.currency.toUpperCase()) ? order.currency.toUpperCase() : '';
  if (!Number.isSafeInteger(order.totalPieces) || order.totalPieces <= 0) order.totalPieces = null;
  for (const line of lines) {
    line.delivery = calendarDate(line.delivery);
    line.style ||= line.articleName || line.articleNo;
    line.color ||= line.colorCode;
    if (!Number.isSafeInteger(line.qty) || line.qty < 0) line.qty = null;
    if (line.price < 0) line.price = null;
  }
  ensure(lines.length, 'No garment PO lines could be read. Try the item and size pages of the order or enter the PO manually.', 422, 'ai-no-lines');
  const variants = lines.slice(0, PO_IMPORT_MAX_LINES);
  if (raw.lines.length > PO_IMPORT_MAX_LINES) review.unshift('Only the first ' + PO_IMPORT_MAX_LINES + ' variants are shown. Read the remaining pages in smaller files.');
  if (order.totalPieces != null) {
    const extractedPieces = variants.reduce((sum, line) => sum + (line.qty ?? 0), 0);
    if (extractedPieces !== order.totalPieces || variants.some(line => line.qty == null)) {
      review.unshift('The extracted size quantities add to ' + extractedPieces + ' pieces. Check them against the printed total of ' + order.totalPieces + ' pieces.');
    }
  }
  return { order, lines: variants, specifications, details: poSourceDetails(raw.details), review: review.filter(Boolean).slice(0, 30) };
}

export function reviewFabricExtraction(raw) {
  ensure(isRecord(raw) && Array.isArray(raw.fabrics), 'The AI provider returned unreadable fabric specifications. Retry reading the tech pack.', 502, 'ai-result');
  const { fabrics, review } = valuesFrom(raw, fabricExtractionSchema);
  const match = (options, value) => options.find(option => norm(option) === norm(value)) || '';
  const rows = fabrics.slice(0, 24).map((row, index) => {
    const { construction: x } = row;
    x.fabricType = match(FABRIC_TYPES, x.fabricType);
    x.fabricCondition = match(FABRIC_CONDITIONS, x.fabricCondition);
    x.countUnit = match(YARN_COUNT_UNITS, x.countUnit);
    const counts = ['warpCount', 'weftCount', 'yarnCount'];
    if (!x.countUnit && counts.some(key => x[key] > 0)) {
      review.push('Check the yarn count unit for ' + (row.description || row.role || row.code || 'fabric ' + (index + 1)) + ' before entering its count.');
      for (const key of counts) x[key] = null;
    }
    for (const key of ['gsm', 'countSpanIn', ...Object.values(FABRIC_INPUTS).flat().map(([key]) => key)]) {
      if (x[key] == null) continue;
      if ((x[key] < 0.000001 && !(key.endsWith('Crimp') && x[key] === 0)) ||
        (['repeatCells', 'needlePositions'].includes(key) && !Number.isSafeInteger(x[key]))) x[key] = null;
    }
    for (const key of ['measuredGsm', 'swatchMassG', 'swatchAreaCm2']) if (!(row[key] > 0)) row[key] = null;
    if (!Number.isSafeInteger(row.yarnRepeatCells) || row.yarnRepeatCells <= 0) row.yarnRepeatCells = null;
    return row;
  }).filter(row => Object.values(row.construction).some(value => value != null && value !== '') ||
    row.measuredGsm || row.swatchMassG || row.swatchAreaCm2 || row.yarnSystems);
  ensure(rows.length, 'No fabric specifications could be read. Choose the fabric construction or materials pages of the tech pack.', 422, 'ai-no-fabrics');
  if (raw.fabrics.length > 24) review.unshift('Review the first 24 fabric components. Read any remaining components in a separate file.');
  return { fabrics: rows, review: review.filter(Boolean).slice(0, 30) };
}

export function importedTechPack(specifications, specKey, size) {
  const specs = specifications.filter(row => row && norm(row.key) && norm(row.key) === norm(specKey));
  const source = specs.length === 1 ? specs[0] : {};
  const draft = valuesFrom(source, object(garmentFields));
  draft.fabrics = coded(draft.fabrics.slice(0, 24), 'FAB', ['GARMENT']);
  draft.poms = coded(draft.poms, 'POM').map(({ sizeTargets, target, ...row }) => {
    const targets = sizeTargets.filter(point => norm(point.size) && norm(point.size) === norm(size));
    return { ...row, target: sizeTargets.length ? (targets.length === 1 ? targets[0].target : null) : target };
  });
  draft.tests = coded(draft.tests, 'TEST').map(row => ({ ...row, scope: row.scope.toUpperCase() }));
  return { draft, source: visibleText(source.source, 300) };
}

export function editedTechDraft(input) {
  const draft = valuesFrom(input, object(garmentFields));
  return { ...draft,
    fabrics: draft.fabrics.slice(0, 24).map((row, i) => ({ ...row, itemId: visibleText(input.fabrics?.[i]?.itemId, 100),
      preparePurchase: input.fabrics?.[i]?.preparePurchase === 'yes' ? 'yes' : '' })),
    trims: draft.trims.map((row, i) => ({ ...row, itemId: visibleText(input.trims?.[i]?.itemId, 100),
      preparePurchase: input.trims?.[i]?.preparePurchase === 'yes' ? 'yes' : '' })),
  };
}
