import { choice, clean, date, ensure, genealogy, id, lock, norm, record, ref, req, STAGES } from './model.js';

export const CLAIM_SCOPES = ['Product', 'Component', 'Chemical', 'Facility', 'Company'];
export const CLAIM_POINTS = ['Supply', ...Object.keys(STAGES), 'Transfer', 'Dispatch', 'Passport', 'Label release'];
export const CLAIM_KINDS = [
  'Product certificate', 'Facility certificate', 'Supply-chain confirmation', 'Product ID', 'Material approval',
  'Label eligibility', 'Due diligence evidence', 'MRSL conformance', 'Facility assessment', 'Wastewater report',
  'Sludge report', 'Licence', 'Criteria evidence', 'Material Health certificate', 'Audit report', 'Buyer approval',
];

const oekoCheck = 'https://www.oeko-tex.com/en/label-check';
const oekoInstitutes = 'https://www.oeko-tex.com/en/about-us/offices';
export const CLAIM_PROGRAMMES = {
  'OEKO-TEX STANDARD 100': { source: oekoCheck, issuers: oekoInstitutes, label: { Product: ['Article certificate'], Component: ['Article certificate'] } },
  'OEKO-TEX MADE IN GREEN': { source: oekoCheck, issuers: oekoInstitutes, label: { Product: ['Supply-chain confirmation', 'Product ID'] } },
  'OEKO-TEX ORGANIC COTTON': { source: oekoCheck, issuers: oekoInstitutes },
  'OEKO-TEX LEATHER STANDARD': { source: oekoCheck, issuers: oekoInstitutes },
  'OEKO-TEX STeP': { source: oekoCheck, issuers: oekoInstitutes },
  'OEKO-TEX ECO PASSPORT': { source: oekoCheck, issuers: oekoInstitutes },
  'OEKO-TEX RESPONSIBLE BUSINESS': { source: oekoCheck, issuers: oekoInstitutes },
  'bluesign / bluepass': { source: 'https://www.bluesign.com/verify', label: {
    Product: ['Product certificate', 'Label eligibility'], Component: ['Material approval'], Chemical: ['Chemical approval'],
  } },
  ZDHC: { source: 'https://gateway.roadmaptozero.com/' },
  'EU Ecolabel for textile products': { source: 'https://environment.ec.europa.eu/topics/circular-economy-topics/oldeu-ecolabel/eu-ecolabel-product-groups-and-criteria_en',
    criteria: true, label: { Product: ['Licence', 'Criteria evidence', 'Label eligibility'] } },
  'Nordic Swan Ecolabel': { source: 'https://www.svanemaerket.dk/en/criteria/manufacturing-of-textiles-hidesskins-and-leather-039',
    criteria: true, label: { Product: ['Licence', 'Criteria evidence', 'Label eligibility'] } },
  'Cradle to Cradle Certified': { source: 'https://c2ccertified.org/certified-products', label: { Product: ['Product certificate'] } },
  'Cradle to Cradle Certified Material Health': { source: 'https://c2ccertified.org/material-health-certificate', label: { Product: ['Material Health certificate'] } },
  SA8000: { source: 'https://sa-intl.org/sa8000-search/' }, WRAP: {}, SMETA: {}, 'amfori BSCI': {}, SLCP: {},
  'Higg FEM': {}, 'Higg FSLM': {}, 'ISO certification': {}, 'Buyer code': {},
};
export const productClaimNames = Object.keys(CLAIM_PROGRAMMES).filter(name => CLAIM_PROGRAMMES[name].label);
export const CLAIM_REVIEW_METHODS = ['Official lookup', 'Issuer confirmation', 'Buyer acceptance', 'Details review'];

export const same = (a, b) => norm(a).replace(/\s+/g, ' ') === norm(b).replace(/\s+/g, ' ');
const distinct = values => [...new Map(values.filter(Boolean).map(value => [norm(value), value])).values()];
export const scopeRefs = value => distinct(clean(value, 8000).split(/\r?\n/).map(line => line.trim()));

export function coveredSites(input) {
  return scopeRefs(input).map(row => {
    const fields = row.split('|').map(value => value.trim());
    ensure(fields.length >= 2 && fields.length <= 3 && fields[0] && fields[1], 'Enter covered sites as holder | exact site | operation (optional).');
    return { holder: fields[0], site: fields[1], operation: fields[2] ? choice(fields[2], CLAIM_POINTS, 'site operation') : '' };
  });
}

export function addClaimRule(s, x, ctx) {
  const scheme = req(x.scheme, 'Programme', 100);
  const scope = choice(x.scopeType, CLAIM_SCOPES, 'required evidence scope');
  const operation = choice(x.operation, CLAIM_POINTS, 'lock point');
  const effective = date(x.effective);
  const line = x.lineId ? record(s.lines, x.lineId, 'PO line') : null;
  const order = x.orderId ? record(s.orders, x.orderId, 'buyer PO') : null;
  ensure(!line || !order || line.orderId === order.id, 'Select a line belonging to the selected buyer PO.');
  const site = clean(x.site, 400);
  const orderId = order?.id || line?.orderId || '';
  const subject = clean(x.subject, 300);
  ensure(orderId || site, 'Tie this requirement to a buyer PO, PO line or exact site.');
  ensure(scope !== 'Component' || subject, 'Enter the exact component code for this requirement.');
  if (scope === 'Chemical') {
    ensure(!subject || s.items.some(item => item.type === 'Chemical' && same(item.code, subject)), 'Use the exact chemical item code from Company masters.');
  }
  const kinds = distinct(clean(x.kinds, 700).split(',').map(value => value.trim()));
  const allowed = ['Article certificate', 'Scope certificate', 'Subcontractor annex', 'Chemical approval', 'Registration / tracker', 'Details only', ...CLAIM_KINDS];
  ensure(kinds.length && kinds.every(value => allowed.includes(value)), 'Enter one or more accepted evidence types from the evidence catalogue.');
  const criteria = clean(x.criteria, 300);
  const holder = clean(x.holder, 300);
  ensure(!s.claimRules.some(r => r.scheme === scheme && r.scope === scope && r.operation === operation && r.effective === effective &&
    r.orderId === orderId && r.lineId === (line?.id || '') && same(r.site, site) && same(r.subject, subject) && same(r.holder, holder) && same(r.criteria, criteria)),
  'A requirement with this scope and effective date already exists.');
  const row = { id: id(s, 'REQ-C'), scheme, scope, operation, effective, site, orderId, lineId: line?.id || '',
    subject, holder, criteria, kinds, independent: x.independent === 'yes', version: req(x.version, 'Rule revision', 100),
    source: req(x.source, 'Buyer requirement or programme source', 600), actor: ctx.actor };
  s.claimRules.push(row);
  return row;
}

function validEvidence(e, { programmes, kinds, scope, subject, site, holder, operation, criteria, on, independent }) {
  return e.status === 'Verified' && e.scoped && programmes.includes(e.scheme) && kinds.includes(e.kind) && e.scopeType === scope &&
    e.scopeRefs.some(value => same(value, subject)) && (!site || same(e.site, site)) && (!holder || same(e.party, holder)) &&
    (!operation || !e.operations.length && !['Facility', 'Chemical'].includes(scope) || e.operations.includes(operation)) &&
    (!criteria || same(e.criteria, criteria)) && (!e.from || e.from <= on) && (!e.until || e.until >= on) &&
    (!independent || ['Official lookup', 'Issuer confirmation'].includes(e.reviewHistory.at(-1)?.method));
}

export function evidenceDecision(e) {
  const review = e.reviewHistory.at(-1);
  return { id: e.id, number: e.number, verifiedAt: review?.at, verifiedOn: review?.on, reviewer: review?.actor,
    method: review?.method, source: e.source, issuer: e.issuer, programmeVersion: e.programmeVersion };
}

function matchingEvidence(s, query) {
  const evidence = s.evidence.find(row => validEvidence(row, query));
  lock(evidence, query.programmes.join(' / ') + ' requires verified ' + query.kinds.join(' or ') + ' covering ' +
    query.subject + (query.site ? ' at ' + query.site : '') + (query.operation ? ' for ' + query.operation : '') + ' on ' + query.on + '.');
  return evidence;
}

const codeFor = (s, itemId) => ref(s.items, itemId)?.code;
export const chemicalCodes = (s, lots) => distinct(lots.filter(lot => lot.material === 'Chemical').map(lot => codeFor(s, lot.itemId) || lot.id));
export const componentCodes = (s, lots) => distinct(lots.map(lot => codeFor(s, lot.itemId)));
export function declaredChemicals(s, input) {
  return distinct(clean(input, 2000).split(',').map(code => code.trim())).map(code => {
    const item = s.items.find(row => row.type === 'Chemical' && same(row.code, code));
    ensure(item, 'Chemical code ' + code + ' must match a chemical item in Company masters.');
    return item.code;
  });
}

function subjectsFor(s, rule, context, lines) {
  switch (rule.scope) {
    case 'Chemical': return (context.chemicals ?? []).filter(code => !rule.subject || same(code, rule.subject));
    case 'Facility': return [context.site];
    case 'Company': return [context.holder];
    case 'Component': return (context.components ?? []).some(code => same(code, rule.subject)) ? [rule.subject] : [];
    default: {
      const skus = distinct(lines.map(line => line.sku));
      const itemCodes = distinct([context.subject, codeFor(s, context.itemId)]);
      return rule.subject ? distinct([...skus, ...itemCodes]).filter(code => same(code, rule.subject)) : skus.length ? skus : itemCodes;
    }
  }
}

export function checkClaimRules(s, context) {
  if (!s.claimRules.length) return [];
  const { site, operation, on } = context;
  const lines = [...new Set(context.lineIds ?? [])].map(key => ref(s.lines, key)).filter(Boolean);
  const effective = new Map();
  for (const rule of s.claimRules) {
    if (rule.operation !== operation || rule.effective > on || (rule.site && !same(rule.site, site)) ||
      (rule.orderId && !lines.some(line => line.orderId === rule.orderId)) || (rule.lineId && !lines.some(line => line.id === rule.lineId))) continue;
    const key = JSON.stringify([rule.scheme, rule.scope, rule.lineId, rule.orderId, norm(rule.site), norm(rule.subject), norm(rule.holder), norm(rule.criteria)]);
    if (!effective.has(key) || effective.get(key).effective < rule.effective) effective.set(key, rule);
  }
  const results = [];
  for (const rule of effective.values()) {
    const relevant = lines.filter(line => (!rule.lineId || rule.lineId === line.id) && (!rule.orderId || rule.orderId === line.orderId));
    const subjects = subjectsFor(s, rule, context, relevant);
    if (rule.scope === 'Chemical' && context.requireChemicalDeclaration) {
      lock(context.chemicals.length || context.noChemicals, 'Record the exact chemicals used or confirm no chemicals were used for ' + rule.scheme + ' at ' + operation + '.');
    }
    if (rule.scope !== 'Chemical') {
      lock(subjects.some(Boolean), 'Identify the actual ' + rule.scope.toLowerCase() + ' for ' + rule.scheme + ' at ' + operation + '.');
    }
    for (const subject of subjects) {
      const evidence = matchingEvidence(s, { programmes: [rule.scheme], kinds: rule.kinds, scope: rule.scope, subject,
        site: rule.scope === 'Facility' ? site : '',
        holder: rule.holder || (['Facility', 'Company'].includes(rule.scope) ? context.holder : ''),
        operation: ['Facility', 'Chemical'].includes(rule.scope) ? operation : '', criteria: rule.criteria, on, independent: rule.independent });
      results.push({ scheme: rule.scheme, scope: rule.scope, subject, site, operation, on, rule: rule.id, version: rule.version,
        ruleSource: rule.source, evidence: [evidenceDecision(evidence)] });
    }
  }
  return results;
}

export function claimContextForLot(s, lot, lineId = '') {
  const ancestry = [lot, ...genealogy(s, lot.id)];
  const origin = ancestry.find(node => node.material === lot.material && node.stage === lot.stage && (node.workOrderId || node.jobId));
  const workLine = ref(s.workOrders, origin?.workOrderId)?.lineId || ref(s.jobs, origin?.jobId)?.lineId;
  const usedChemicals = ancestry.flatMap(node => node.scopedClaimTrigger?.chemicals ?? []);
  return { lot, ancestry, site: lot.site, itemId: lot.itemId,
    lineIds: lineId ? [lineId] : distinct([workLine, ...(lot.allocations ?? []).map(row => row.lineId)]),
    chemicals: distinct([...chemicalCodes(s, ancestry), ...usedChemicals]), components: componentCodes(s, ancestry) };
}

export function releaseProductClaim(s, x, ctx) {
  const scheme = choice(x.scheme, productClaimNames, 'product claim programme');
  const profile = CLAIM_PROGRAMMES[scheme];
  const scope = choice(x.scopeType, Object.keys(profile.label), 'claim scope for this programme');
  const lot = record(s.lots, x.lotId, 'claim lot');
  const line = x.lineId ? record(s.lines, x.lineId, 'buyer PO line') : null;
  const context = claimContextForLot(s, lot);
  ensure(!line || line.status === 'Approved' && context.lineIds.includes(line.id), 'Select an approved PO line actually allocated to this lot.');
  ensure(!line || scope !== 'Product' || line.product === lot.material || line.product === 'Traded goods', 'Select a lot of the deliverable named on the PO line.');
  lock(lot.qualityStatus === 'Released', 'Quality must release the selected lot before a product claim.');
  ctx.checkHistory(s, lot);
  const on = date(x.date);
  ensure(on >= lot.date, 'Claim release cannot precede creation of the lot.');
  const choices = scope === 'Product' ? distinct([line?.sku, codeFor(s, lot.itemId)]) : scope === 'Chemical' ? context.chemicals : context.components;
  const subject = clean(x.subject, 300) || (choices.length === 1 ? choices[0] : '');
  lock(subject && choices.some(code => same(code, subject)), 'Match the claim to the exact SKU, item or component code on this lot and its records.');
  const criteria = clean(x.criteria, 300);
  ensure(!profile.criteria || criteria, 'Enter the textile product group and applicable criteria reference.');
  const query = { programmes: [scheme], scope, subject, on, criteria, independent: true };
  const matches = profile.label[scope].map(kind => matchingEvidence(s, { ...query, kinds: [kind] }));
  if (scheme === 'OEKO-TEX MADE IN GREEN') {
    const product = matchingEvidence(s, { ...query, programmes: ['OEKO-TEX STANDARD 100', 'OEKO-TEX ORGANIC COTTON', 'OEKO-TEX LEATHER STANDARD'],
      kinds: ['Article certificate', 'Product certificate'] });
    matches.push(product);
    const chain = matches.find(e => e.kind === 'Supply-chain confirmation');
    const productId = matches.find(e => e.kind === 'Product ID');
    lock(chain.requiredSites.length && productId.number, 'Confirm the supply-chain sites and the MADE IN GREEN Product ID.');
    const makingUp = context.ancestry.filter(row => ['Cutting', 'Stitching'].includes(row.stage));
    const facilities = [...chain.requiredSites];
    for (const node of makingUp) {
      const event = ref(s.events, node.eventId);
      const site = (event?.kind === 'Processed return' ? event.from : event?.site) || node.site;
      const facility = chain.requiredSites.find(row => same(row.site, site));
      lock(facility, 'The confirmed supply chain does not include making-up site ' + site + '.');
      if (!facilities.some(row => same(row.site, site) && row.operation === node.stage)) facilities.push({ ...facility, operation: node.stage });
    }
    for (const { holder, site, operation } of facilities) {
      const evidence = matchingEvidence(s, { programmes: ['OEKO-TEX STeP'], kinds: ['Facility certificate'], scope: 'Facility',
        subject: site, site, holder, operation, on, independent: true });
      if (!matches.some(row => row.id === evidence.id)) matches.push(evidence);
    }
  }
  const controls = checkClaimRules(s, { ...context, lineIds: line ? [line.id] : context.lineIds,
    subject, holder: s.settings.name, operation: 'Label release', on });
  const row = { id: id(s, 'CLAIM'), scheme, scope, subject, criteria, lotId: lot.id, lineId: line?.id || '', on,
    number: matches.find(e => e.kind === 'Product ID')?.number || matches[0].number, rule: scheme, ruleSource: profile.source,
    evidence: matches.map(evidenceDecision), controls, actor: ctx.actor, at: ctx.at };
  s.claimReleases.push(row);
  return row;
}
