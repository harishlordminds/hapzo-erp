import {
  UNITS, CURRENCIES, ROUTES, STAGES, WASH_STAGES, PRINT_STAGES, MATERIALS, FULFILMENT, SCHEMES,
  clean, req, key, choice, decimal, number, quantity, id, date, norm, ref, record,
  unique, ensure, csvLines, freeStock, sum, round,
} from './model.js';
import { fabricSpecification, fabricSpecInput } from './fabric.js';
import { garmentPayload, garmentSpecification, materialRequirements } from './garment.js';
import { editedTechDraft, importedTechPack, poAnnexIds, poSourceDetails, PO_IMPORT_MAX_LINES, PO_NUMBER_READERS } from './po-import.js';

export const PARTY_TYPES = ['Buyer', 'Supplier', 'Processor'];
export const MASTER_LABELS = Object.freeze({ parties: 'party', items: 'material', locations: 'factory location', machines: 'machine', routes: 'route' });
export const masterLabel = (kind, row) => kind === 'parties' ? norm(row.type) : MASTER_LABELS[kind];

const masterIdFields = {
  parties: ['buyerId', 'partyId', 'ownerId', 'supplierId', 'processorId'],
  items: ['itemId'], locations: ['locationId'], machines: ['machineId'], routes: ['routeId'],
};
const masterLinkLabels = {
  machines: 'machines', orders: 'buyer orders', lines: 'PO lines', requisitions: 'requisitions', purchases: 'supplier purchase orders',
  lots: 'stock lots', events: 'transaction history', workOrders: 'work orders', jobs: 'outside jobs', shipments: 'shipments',
  invoices: 'invoices', evidence: 'compliance evidence', costs: 'cost records', vouchers: 'accounting vouchers',
  readings: 'meter readings', maintenance: 'maintenance records', quotes: 'quotations',
  claimRules: 'claim requirements', claimReleases: 'claim releases', processBatches: 'process batches', processSetups: 'process setups',
};

function master(s, rows, input, prefix, fields, context) {
  const code = key(input.code);
  const existing = rows.find(r => norm(r.code) === norm(code));
  if (existing) {
    const previous = { ...existing };
    delete previous.history;
    Object.assign(existing, fields, {
      history: [...(existing.history ?? []), { ...previous, changedAt: context.at, changedBy: context.actor }],
    });
    return existing;
  }
  const row = { id: id(s, prefix), code, ...fields };
  rows.push(row);
  return row;
}

export function saveParty(s, x, ctx) {
  const type = choice(x.type, PARTY_TYPES, 'party type');
  const existing = s.parties.find(p => norm(p.code) === norm(x.code));
  ensure(!existing || existing.type === type, 'An existing party code retains its original type.');
  return master(s, s.parties, x, 'PTY', {
    type, name: req(x.name, 'Legal name'), address: clean(x.address), shipTo: clean(x.shipTo),
    country: clean(x.country, 80), email: clean(x.email, 150), contact: clean(x.contact, 150),
    gstin: clean(x.gstin, 30), terms: clean(x.terms, 300), currency: choice(x.currency, CURRENCIES, 'currency'),
  }, ctx);
}

function linksMaster(value, fields, id) {
  return value && typeof value === 'object' && Object.entries(value).some(([key, entry]) =>
    (fields.includes(key) && entry === id) || linksMaster(entry, fields, id));
}

function hasNamedReceivableOrPayable(s, party) {
  const names = new Set([party, ...(party.history ?? [])].map(row => norm(row.name)));
  const ledger = party.type === 'Buyer' ? 'AR' : 'AP';
  return s.vouchers.some(row => !row.partyId && names.has(norm(row.party)) && row.lines?.some(line => line.a === ledger));
}

function routeUsedByPo(s, route) {
  // PO snapshots store the route name and revision. A master can have earlier definitions.
  const definitions = [route, ...(route.history ?? [])];
  return s.lines.some(line => [line, ...(line.revisions ?? [])].some(snapshot => snapshot.route &&
    definitions.some(definition => norm(snapshot.route) === norm(definition.name) &&
      (!snapshot.routeVersion || snapshot.routeVersion === definition.version))));
}

export function deleteMaster(s, x, ctx) {
  const { kind } = x;
  ensure(Object.hasOwn(MASTER_LABELS, kind), 'Choose a company master record.');
  const rows = s[kind];
  const master = record(rows, x.id, MASTER_LABELS[kind]);
  const fields = masterIdFields[kind];
  const linked = new Set();
  for (const [collection, label] of Object.entries(masterLinkLabels)) {
    if (s[collection].some(row => linksMaster(row, fields, master.id))) linked.add(label);
  }
  if (kind === 'parties') {
    if (hasNamedReceivableOrPayable(s, master)) linked.add(masterLinkLabels.vouchers);
    if (master.type === 'Buyer' && ctx.hasBuyerPortalAccess(master.id)) linked.add('buyer portal access');
  }
  if (kind === 'locations' && s.purchases.some(row => row.shipTo === master.id)) linked.add(masterLinkLabels.purchases);
  if (kind === 'routes' && routeUsedByPo(s, master)) linked.add(masterLinkLabels.lines);
  if (kind === 'items') {
    const scopedToItem = row => ['Chemical', 'Component', 'Product'].includes(row.scope) && norm(row.subject) === norm(master.code);
    if (s.claimRules.some(scopedToItem)) linked.add(masterLinkLabels.claimRules);
    if (s.claimReleases.some(scopedToItem)) linked.add(masterLinkLabels.claimReleases);
    if (s.evidence.some(row => ['Chemical', 'Component', 'Product'].includes(row.scopeType) &&
      row.scopeRefs?.some(code => norm(code) === norm(master.code)))) linked.add(masterLinkLabels.evidence);
  }
  ensure(!linked.size, 'This ' + masterLabel(kind, master) + ' is linked to ' + [...linked].join(', ') + '.', 409, 'master-in-use');
  rows.splice(rows.indexOf(master), 1);
  return master;
}

export function saveLocation(s, x, ctx) {
  const site = req(x.site, 'Factory / site');
  const existing = s.locations.find(r => norm(r.code) === norm(x.code));
  ensure(!existing || existing.site === site ||
    !s.lots.some(l => l.locationId === existing.id) && !s.workOrders.some(w => w.locationId === existing.id),
  'Create a new location code to move a used location to another factory.');
  return master(s, s.locations, x, 'LOC', {
    site, warehouse: req(x.warehouse, 'Warehouse or department'),
    bin: clean(x.bin, 100), address: clean(x.address), gstin: clean(x.gstin, 30),
  }, ctx);
}

export function saveItem(s, x, ctx) {
  const type = choice(x.type, MATERIALS, 'material type');
  const unit = choice(x.unit, UNITS, 'stock unit');
  const existing = s.items.find(i => norm(i.code) === norm(x.code));
  ensure(!existing || (existing.type === type && existing.unit === unit), 'Create a new item code to change the physical type or stock unit.');
  return master(s, s.items, x, 'ITM', { name: req(x.name, 'Item name'), type, unit, hs: clean(x.hs, 15), composition: clean(x.composition) }, ctx);
}

export function saveMachine(s, x, ctx) {
  return master(s, s.machines, x, 'MAC', {
    name: req(x.name, 'Machine name'), locationId: record(s.locations, x.locationId, 'machine location').id,
    device: clean(x.device, 100), description: clean(x.description), status: choice(x.status, ['In service', 'Down', 'Retired'], 'machine status'),
  }, ctx);
}

export function saveRoute(s, x, ctx) {
  const stages = clean(x.stages, 1200).split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  ensure(stages.length > 0 && new Set(stages).size === stages.length && stages.every(step => Object.hasOwn(STAGES, step)), 'Enter distinct operation names from the catalogue in execution order.');
  return master(s, s.routes, x, 'RTE', {
    name: req(x.name, 'Route name'), stages, version: req(x.version, 'Route revision', 80),
  }, ctx);
}

export function saveSettings(s, x) {
  s.settings = {
    ...s.settings, name: req(x.name, 'Company name'), address: clean(x.address),
    gstin: clean(x.gstin, 30), contact: clean(x.contact, 150), identifier: clean(x.identifier, 100),
  };
  return { id: 'company' };
}

export function savePoNumberReader(s, x) {
  s.settings.poNumberReader = choice(x.reader, Object.keys(PO_NUMBER_READERS), 'buyer PO number reader');
  return { id: 'company' };
}

export function party(s, id, type) {
  const row = record(s.parties, id, type.toLowerCase());
  ensure(row.type === type, 'Select a ' + type.toLowerCase() + ' record.');
  return row;
}

export function location(s, key) {
  return record(s.locations, key, 'stock location');
}

export function locationName(loc) {
  return [loc.site, loc.warehouse, loc.bin].filter(Boolean).join(' / ');
}

function sameOrderBuyer(order, buyerId, buyerName) {
  return buyerId ? order.buyerId === buyerId : !order.buyerId && norm(order.buyer) === norm(buyerName);
}

export function newOrder(s, x, ctx) {
  const buyer = x.buyerId ? party(s, x.buyerId, 'Buyer') : null;
  const buyerName = buyer?.name || clean(x.buyerName, 200);
  const po = req(x.po, 'Buyer PO number');
  ensure(!s.orders.some(o => sameOrderBuyer(o, buyer?.id, buyerName) && norm(o.po) === norm(po)), 'This buyer PO already exists.');
  const row = {
    id: id(s, 'PO'), po, buyerId: buyer?.id || '', buyer: buyerName,
    date: date(x.date), currency: choice(x.currency || buyer?.currency || s.settings.currency, CURRENCIES, 'PO currency'),
    clientOrderNo: clean(x.clientOrderNo, 100), client: clean(x.client, 200), division: clean(x.division, 120),
    shipDate: x.shipDate ? date(x.shipDate) : '', totalPieces: x.totalPieces ? quantity(x.totalPieces, 'Printed piece total', 'pcs') : null,
    billingAddress: buyer?.address || '', shipTo: clean(x.shipTo) || buyer?.shipTo || '', terms: clean(x.terms) || buyer?.terms || '',
    document: ctx.document(x.document, ['buyer-po']), revisions: [], kind: choice(x.kind || 'Goods', ['Goods', 'Service'], 'order type'),
  };
  s.orders.push(row);
  return row;
}

export function linkOrderBuyer(s, x) {
  const order = record(s.orders, x.orderId, 'buyer PO');
  const buyer = party(s, x.buyerId, 'Buyer');
  ensure(!order.buyerId, 'This PO already has a linked buyer.');
  ensure(!s.orders.some(other => other.buyerId === buyer.id && norm(other.po) === norm(order.po)), 'This buyer already has a PO with this number.');
  order.buyerId = buyer.id;
  order.buyer = buyer.name;
  order.billingAddress ||= buyer.address;
  order.shipTo ||= buyer.shipTo;
  order.terms ||= buyer.terms;
  return order;
}

export function orderRevision(s, x, ctx) {
  const o = record(s.orders, x.orderId, 'buyer PO');
  const revision = req(x.revision, 'Buyer PO revision', 80);
  unique(o.revisions, 'revision', revision, 'This PO revision already exists.');
  o.revisions.push({
    revision, date: date(x.date), notes: req(x.notes, 'Revision note', 1000),
    document: ctx.document(x.document, ['buyer-po'], true), actor: ctx.actor, at: ctx.at,
  });
  return o;
}

function routeSnapshot(s, selected, product) {
  const route = Object.hasOwn(ROUTES, selected) ? { name: selected, version: 'Built-in 1', stages: ROUTES[selected] }
    : record(s.routes, selected, 'route');
  if (product !== 'Traded goods' && route.stages.length) {
    ensure(route.stages.some(step => STAGES[step].output === product || [...WASH_STAGES, ...PRINT_STAGES].includes(step) &&
      STAGES[step].preserve && STAGES[step].primary.includes(product)),
      'The selected route does not produce ' + product + '.');
  }
  return { route: route.name, routeVersion: route.version, stages: [...route.stages] };
}

function specification(s, x, previous = null, deferRoute = false) {
  const unit = choice(x.unit, UNITS, 'order unit');
  const qty = quantity(x.qty, 'Ordered quantity', unit);
  const scheme = choice(x.scheme || 'Conventional', [...Object.keys(SCHEMES), ...s.policies.map(p => p.scheme)], 'standard');
  const product = choice(x.product, FULFILMENT, 'fulfilment material');
  const route = deferRoute && !x.route ? { route: '', routeVersion: '', stages: [] } : routeSnapshot(s, x.route, product);
  const bom = csvLines(x.bom, 'BOM', 2).map(([code, qty]) => {
    const item = s.items.find(i => norm(i.code) === norm(code));
    ensure(item, 'Unknown BOM item ' + code + '. Create it in Masters first.');
    return { itemId: item.id, code: item.code, label: item.name, unit: item.unit, per: decimal(qty, 'BOM usage per ordered unit', 0.000001) };
  });
  ensure(new Set(bom.map(b => b.itemId)).size === bom.length, 'Each BOM item must appear once.');
  const delivery = date(x.delivery);
  const schedule = csvLines(x.schedule, 'Delivery schedule', 2).map(([day, amount]) => ({
    date: date(day), qty: quantity(amount, 'Scheduled quantity', unit),
  }));
  if (schedule.length) ensure(sum(schedule) === qty && new Set(schedule.map(row => row.date)).size === schedule.length, 'Use distinct delivery dates that add up to the ordered quantity.');
  const gsm = x.gsm === undefined ? previous?.gsm ?? null : x.gsm == null || x.gsm === '' ? null : decimal(x.gsm, 'GSM', 0.000001);
  const fabricInput = x.fabricType === undefined ? { ...fabricSpecInput(previous?.fabricSpec), ...x } : x;
  const fabricSpec = fabricSpecification({ ...fabricInput, gsm }, { stages: route.stages });
  const buyerReferences = Object.fromEntries(Object.entries({ articleNo: 100, articleName: 200, clientOrderNo: 100, colorCode: 100, lot: 100 })
    .map(([key, max]) => [key, clean(x[key] ?? previous?.[key], max)]));
  return {
    style: req(x.style, 'Style'), color: req(x.color, 'Colour', 80), size: req(x.size, 'Size / variant', 80),
    sku: clean(x.sku, 100), ...buyerReferences, qty, unit, price: decimal(x.price || '0', 'Unit selling price'),
    delivery, schedule: schedule.length ? schedule : [{ date: delivery, qty }],
    scheme, additionalSchemes: extraSchemes(s, x.additionalSchemes, scheme), product, ...route,
    specRev: req(x.specRev, 'Specification revision', 80), approvedSpec: req(x.approvedSpec, 'Specification', 8000),
    composition: clean(x.composition), gsm, fabricSpec,
    bomRev: req(x.bomRev || '1', 'BOM revision', 80), bom,
    costRev: req(x.costRev || '1', 'Cost revision', 80),
    plannedCosts: Object.fromEntries(['materials', 'labour', 'processing', 'overhead'].map(k => [k, decimal(x[k] || '0', 'Planned ' + k)])),
  };
}

export function extraSchemes(s, list, primary) {
  const names = clean(list, 500).split(',').map(v => v.trim()).filter(v => v && v !== primary && v !== 'Conventional');
  return [...new Set(names)].map(name => choice(name, [...Object.keys(SCHEMES), ...s.policies.map(p => p.scheme)], 'additional standard'));
}

export const schemesOf = row => [...new Set([row.scheme, ...(row.additionalSchemes ?? [])].filter(name => name && name !== 'Conventional'))].sort();

export function newLine(s, x) {
  return createDraftLine(s, x, false);
}

function createDraftLine(s, x, deferRoute) {
  const order = record(s.orders, x.orderId, 'buyer PO');
  const lineNo = req(x.lineNo || String(s.lines.filter(l => l.orderId === order.id).length + 1), 'PO line number', 40);
  ensure(!s.lines.some(l => l.orderId === order.id && norm(l.lineNo) === norm(lineNo)), 'Line number already exists on this PO.');
  const row = { id: id(s, 'LINE'), orderId: order.id, lineNo, status: 'Draft', revision: 0, revisions: [], ...specification(s, x, null, deferRoute) };
  s.lines.push(row);
  return row;
}

function addRevision(row, ctx, note) {
  const snapshot = { ...row };
  delete snapshot.revisions;
  delete snapshot.garmentDraft;
  row.revisions.push({ ...snapshot, actor: ctx.actor, at: ctx.at, reason: note });
}

export function approveLine(s, x, ctx) {
  const line = record(s.lines, x.lineId, 'PO line');
  ensure(line.status === 'Draft', 'Only draft lines can be approved here.');
  if (!line.route) {
    ensure(x.route, 'Choose a production route before approving this PO line.');
    Object.assign(line, routeSnapshot(s, x.route, line.product));
  }
  line.status = 'Approved';
  line.revision = 1;
  addRevision(line, ctx, clean(x.notes));
  return line;
}

export function reviseLine(s, x, ctx) {
  const line = record(s.lines, x.lineId, 'PO line');
  ensure(line.status === 'Approved', 'Approve this PO line before releasing a new revision.');
  const spec = specification(s, x, line);
  ensure(spec.qty >= shippedQty(s, line.id), 'Revised quantity cannot be lower than shipped quantity.');
  const committed = s.workOrders.some(w => w.lineId === line.id) ||
    s.lots.some(l => l.allocations?.some(a => a.lineId === line.id)) || shippedQty(s, line.id) > 0;
  const identity = ['style', 'color', 'size', 'sku', 'unit', 'product', 'scheme', 'additionalSchemes', 'stages'];
  ensure(!committed || identity.every(k => JSON.stringify(line[k]) === JSON.stringify(spec[k])), 'Use a separate PO line to change the product, route, claims or variant after work has been released.');
  const reason = req(x.notes, 'Reason for approval of this revision', 1000);
  Object.assign(line, spec, { revision: line.revision + 1 });
  addRevision(line, ctx, reason);
  return line;
}

export function saveGarmentSpec(s, x, ctx) {
  const line = record(s.lines, x.lineId, 'buyer PO line');
  const order = record(s.orders, line.orderId, 'buyer PO');
  ensure(order.kind === 'Goods' && line.unit === 'pcs', 'Choose a goods PO line ordered in pieces.');
  const input = garmentPayload(x.techPack, 'garment specification');
  const spec = garmentSpecification(s, input);
  const draft = x.draftToken ? activeImportDraft(line, x.draftToken) : null;
  const previous = line.garmentSpec;
  const document = x.document ? ctx.document(x.document, ['tech-pack'], true) : draft?.attachment ?? previous?.document ?? null;
  const specRev = req(x.specRev || line.specRev, 'Specification revision', 80);
  const approved = line.status === 'Approved';
  const reason = approved ? req(x.notes, 'Reason and buyer approval reference for this revision', 1000) : '';
  const importSource = draft ? { documents: draft.documents, source: draft.source, lineSource: draft.lineSource } : previous?.importSource;
  line.garmentSpec = { ...spec, document, ...(importSource ? { importSource } : {}) };
  if (draft) delete line.garmentDraft;
  line.specRev = specRev;
  if (approved) {
    line.revision++;
    addRevision(line, ctx, reason);
  }
  return line;
}

function activeImportDraft(line, token) {
  ensure(line.garmentDraft && line.garmentDraft.token === token, 'This imported draft changed. Open the PO line again before saving.', 409, 'draft-changed');
  return line.garmentDraft;
}

export function saveImportDraft(s, x, ctx) {
  const line = record(s.lines, x.lineId, 'buyer PO line');
  const pending = activeImportDraft(line, x.draftToken);
  line.garmentDraft = { ...pending, token: ctx.publicToken(),
    specRev: clean(x.specRev, 80) || pending.specRev,
    pack: editedTechDraft(garmentPayload(x.techPack, 'imported draft')),
    attachment: x.document ? ctx.document(x.document, ['tech-pack'], true) : pending.attachment,
  };
  return line;
}

export function createPoBuyer(s, x, ctx) {
  const name = req(x.buyer, 'Buyer legal name');
  ensure(!s.parties.some(p => p.type === 'Buyer' && norm(p.name) === norm(name)),
    'This buyer already exists. Select the buyer from the list.');
  let code;
  do { code = id(s, 'BUY'); } while (s.parties.some(p => norm(p.code) === norm(code)));
  return saveParty(s, { type: 'Buyer', code, name, currency: req(x.currency, 'Buyer currency'), country: x.country, gstin: x.gstin }, ctx);
}

function allocateBuyerLineNo(lines, requested, size) {
  const used = new Set(lines.map(row => norm(row.lineNo)));
  if (!requested) {
    let n = lines.length + 1;
    while (used.has(String(n))) n++;
    return String(n);
  }
  if (!used.has(norm(requested))) return requested;
  const base = requested.slice(0, 20) + ' / ' + size.slice(0, 10);
  let label = base;
  let suffix = 2;
  while (used.has(norm(label))) label = base + '-' + suffix++;
  return label;
}

function matchingImportedLine(lines, candidate) {
  return lines.filter(line => ['style', 'color', 'size'].every(key => norm(line[key]) === norm(candidate[key])) &&
    ['sku', 'articleNo', 'clientOrderNo', 'colorCode', 'lot'].every(key => !line[key] || !candidate[key] || norm(line[key]) === norm(candidate[key])) &&
    (!candidate.lineNo || norm(line.buyerLineNo || line.lineNo) === norm(candidate.lineNo)));
}

export function importBuyerPo(s, x, ctx) {
  const input = garmentPayload(x.importData, 'buyer PO import');
  ensure(Array.isArray(input.lines) && input.lines.length > 0 && input.lines.length <= PO_IMPORT_MAX_LINES &&
    input.lines.every(row => row && typeof row === 'object' && !Array.isArray(row)), 'Select at least one valid buyer PO line.');
  ensure(Array.isArray(input.specifications) && input.specifications.length <= PO_IMPORT_MAX_LINES, 'Select valid technical specifications.');
  const po = req(x.po, 'Buyer PO number');
  const buyerId = x.buyerId === 'new' ? createPoBuyer(s, x, ctx).id : x.buyerId;
  if (buyerId) party(s, buyerId, 'Buyer');
  const document = ctx.document(x.document, ['buyer-po'], true);
  const annexes = poAnnexIds(x.annex).map(key => ctx.document(key, ['tech-pack'], true));
  const documents = [document, ...annexes];
  const buyerName = clean(x.buyerName, 200);
  const sameNumber = s.orders.filter(row => norm(row.po) === norm(po));
  const sameSource = row => row.document?.id === document.id || Boolean(document.sha256 && row.document?.sha256 === document.sha256);
  let order = sameNumber.find(row => sameOrderBuyer(row, buyerId, buyerName));
  if (!order && buyerId) {
    const unlinked = sameNumber.filter(row => !row.buyerId && sameSource(row));
    if (unlinked.length === 1) order = linkOrderBuyer(s, { orderId: unlinked[0].id, buyerId });
  }
  if (order && !buyerId && !buyerName) {
    ensure(sameSource(order),
      'Another unassigned PO has this number. Enter the buyer name to distinguish the two orders.');
  }
  ensure(!order || order.kind === 'Goods', 'Select a goods PO for a garment import.');
  if (!order) order = newOrder(s, { ...x, po, buyerId, buyerName, kind: 'Goods', date: req(x.poDate, 'Buyer PO date', 10) }, ctx);
  if (!order.document) order.document = document;
  const details = poSourceDetails(input.details);
  if (!order.poDetails?.length && details.length) order.poDetails = details;
  const imported = [];
  const existing = s.lines.filter(line => line.orderId === order.id && line.unit === 'pcs');
  const review = Array.isArray(input.review) ? input.review.filter(value => typeof value === 'string')
    .slice(0, 30).map(value => value.trim().slice(0, 600)).filter(Boolean) : [];
  for (const row of input.lines) {
    const variant = { style: req(row.style || row.articleName || row.articleNo, 'Style'), color: req(row.color || row.colorCode, 'Colour', 80),
      size: req(row.size, 'Size', 80), lineNo: clean(row.lineNo, 40), sku: clean(row.sku, 100),
      articleNo: clean(row.articleNo, 100), articleName: clean(row.articleName, 200), clientOrderNo: clean(row.clientOrderNo, 100),
      colorCode: clean(row.colorCode, 100), lot: clean(row.lot, 100) };
    const matches = matchingImportedLine(existing, variant);
    ensure(matches.length <= 1, 'Multiple PO lines match ' + [variant.style, variant.color, variant.size].join(' / ') + '. Enter its buyer line number.');
    let line = matches[0];
    ensure(!line || !imported.includes(line.id), 'Select only one row for each buyer PO variant and line number.');
    ensure(!line?.garmentDraft || x.replaceDraft === 'yes', 'A matching PO line already has an imported draft. Review it or choose Replace matching AI drafts.');
    const specRev = clean(row.specRev, 80) || line?.specRev || 'AI draft';
    if (!line) {
      const occupied = s.lines.filter(candidate => candidate.orderId === order.id);
      const { lineNo: buyerLineNo, ...identity } = variant;
      line = createDraftLine(s, { ...identity, lineNo: allocateBuyerLineNo(occupied, buyerLineNo, variant.size), orderId: order.id, unit: 'pcs',
        qty: row.qty, price: row.price, delivery: req(row.delivery || x.shipDate, 'Delivery or ship-by date for ' + variant.size, 10),
        route: x.route, product: x.product, specRev,
        approvedSpec: clean(row.description, 4000) || 'Imported buyer PO. Review the garment tech pack.' }, true);
      if (buyerLineNo) line.buyerLineNo = buyerLineNo;
      existing.push(line);
    } else if (line.status === 'Draft') {
      if (!line.route && x.route) Object.assign(line, routeSnapshot(s, x.route, line.product));
      for (const key of ['articleNo', 'articleName', 'clientOrderNo', 'colorCode', 'lot']) line[key] ||= variant[key];
    }
    const { draft, source } = importedTechPack(input.specifications, row.specKey, variant.size);
    line.garmentDraft = { token: ctx.publicToken(), pack: draft, specRev, documents, source,
      lineSource: clean(row.source, 600), review, attachment: annexes[0] ?? null, at: ctx.at, actor: ctx.actor };
    imported.push(line.id);
  }
  return ref(s.lines, imported[0]);
}

export function shippedQty(s, lineId) {
  return sum(s.shipments.flatMap(sh => sh.allocations ?? []).filter(a => a.lineId === lineId));
}

export function lineProgress(s, line) {
  const produced = s.events.filter(e => e.kind === 'Production' && e.stage === 'Stitching').flatMap(e => e.allocations ?? []);
  const forLine = rows => sum(rows.filter(a => a.lineId === line.id));
  const shipped = shippedQty(s, line.id);
  const staged = s.lots.filter(l => !l.standardHold && l.qualityStatus === 'Released');
  return {
    planned: sum(s.workOrders.filter(w => w.lineId === line.id && w.unit === line.unit && STAGES[w.stage]?.output === line.product), w => w.plannedQty),
    produced: forLine(produced),
    released: forLine(staged.filter(l => ['Released garment', line.product].includes(l.material)).flatMap(l => l.allocationBalance ?? [])),
    packed: forLine(staged.filter(l => l.material === 'Packed carton').flatMap(l => l.allocationBalance ?? [])),
    shipped, open: round(line.qty - shipped),
  };
}

export function planning(s) {
  const index = new Map();
  for (const line of s.lines.filter(l => l.status === 'Approved')) {
    const remaining = Math.max(0, line.qty - shippedQty(s, line.id));
    if (!remaining) continue;
    for (const row of materialRequirements(line, remaining)) {
      const item = record(s.items, row.itemId, 'BOM item');
      const group = [item.id, ...schemesOf(line)].join('|');
      const entry = index.get(group) ?? { ...row, schemes: schemesOf(line), demand: 0, reserved: 0, free: 0, onOrder: 0, lines: [] };
      const lots = s.lots.filter(l => l.itemId === item.id && !l.standardHold && l.qualityStatus === 'Released' && l.custody === 'Own site' && !l.ownerId &&
        JSON.stringify(schemesOf(l)) === JSON.stringify(entry.schemes));
      const target = row.qty;
      const reserved = sum(lots.flatMap(l => l.reservations ?? []).filter(r => r.lineId === line.id));
      entry.demand = round(entry.demand + target);
      entry.reserved = round(entry.reserved + Math.min(target, reserved));
      entry.free = sum(lots, freeStock);
      entry.onOrder = sum(s.purchases.filter(po => JSON.stringify(schemesOf(po)) === JSON.stringify(entry.schemes))
        .flatMap(po => po.lines).filter(l => l.itemId === item.id), l => l.qty - l.received);
      entry.lines.push(line.id);
      index.set(group, entry);
    }
  }
  return [...index.values()].map(row => ({ ...row, shortage: Math.max(0, round(row.demand - row.reserved - row.free - row.onOrder)) }));
}

export function requisition(s, x) {
  const item = record(s.items, x.itemId, 'item');
  const line = x.lineId ? record(s.lines, x.lineId, 'PO line') : null;
  const row = {
    id: id(s, 'REQ'), itemId: item.id, label: item.name, unit: item.unit,
    qty: quantity(x.qty, 'Requested quantity', item.unit), ordered: 0, lineRevision: line?.status === 'Approved' ? line.revision : null,
    required: date(x.required), lineId: line?.id || '', notes: clean(x.notes),
  };
  s.requisitions.push(row);
  return row;
}

export function purchaseOrder(s, x, ctx) {
  const supplier = party(s, x.supplierId, 'Supplier');
  const dest = location(s, x.locationId);
  const number = req(x.number, 'Supplier PO number');
  unique(s.purchases, 'number', number, 'Supplier PO number already exists.');
  const scheme = choice(x.scheme || 'Conventional', [...Object.keys(SCHEMES), ...s.policies.map(p => p.scheme)], 'standard');
  const supplierSite = req(x.supplierSite, 'Supplier facility');
  const day = date(x.date);
  const rows = csvLines(x.lines, 'Purchase order', 3, 4);
  ensure(rows.length, 'Add at least one purchase line.');
  const lines = rows.map(([code, qty, price, reqId]) => {
    const item = s.items.find(r => norm(r.code) === norm(code));
    ensure(item, 'Unknown item ' + code + '.');
    const amount = quantity(qty, 'Ordered quantity', item.unit);
    if (reqId) {
      const pr = record(s.requisitions, reqId, 'requisition');
      ensure(pr.itemId === item.id && round(pr.ordered + amount) <= pr.qty, 'Purchase line exceeds or does not match requisition ' + reqId + '.');
      pr.ordered = round(pr.ordered + amount);
    }
    ctx.checkSupply(s, scheme, supplier, supplierSite, item.type, day, item.code);
    return { id: id(s, 'POL'), itemId: item.id, label: item.name, qty: amount, received: 0, unit: item.unit, price: decimal(price, 'Purchase unit price'), reqId: reqId || '' };
  });
  const row = {
    id: id(s, 'PUR'), number, supplierId: supplier.id, supplier: supplier.name, supplierSite, shipTo: dest.id,
    date: day, due: date(x.due, day), currency: choice(x.currency || supplier.currency, CURRENCIES, 'purchase currency'),
    scheme, lines, notes: clean(x.notes),
  };
  ensure(row.due >= day, 'Expected delivery cannot precede PO date.');
  s.purchases.push(row);
  return row;
}

export function quotation(s, x) {
  const partyType = x.kind === 'Supplier quotation' ? 'Supplier' : 'Buyer';
  const p = party(s, x.partyId, partyType);
  const number = req(x.number, 'Quotation reference');
  unique(s.quotes, 'number', number, 'Quotation reference already exists.');
  const row = {
    id: id(s, 'QTN'), number, kind: choice(x.kind, ['Supplier quotation', 'Sales quotation'], 'quotation type'),
    partyId: p.id, party: p.name, itemId: record(s.items, x.itemId, 'item').id,
    requisitionId: x.requisitionId ? record(s.requisitions, x.requisitionId, 'requisition').id : '',
    date: date(x.date), validUntil: x.validUntil ? date(x.validUntil) : '',
    qty: decimal(x.qty, 'Quotation quantity', 0.000001), price: decimal(x.price, 'Unit price'),
    currency: choice(x.currency || p.currency, CURRENCIES, 'currency'), terms: clean(x.terms),
  };
  ensure(!row.validUntil || row.validUntil >= row.date, 'Quotation expiry cannot precede its date.');
  s.quotes.push(row);
  return row;
}

export function orderRoute(line) {
  const stages = line.stages ?? [];
  if (!Object.hasOwn(ROUTES, line.route)) return stages;
  const finish = stages.findIndex(stage => STAGES[stage]?.output === line.product);
  return finish < 0 ? stages : stages.slice(0, finish + 1);
}

export function orderWorkflow(s, orderId, lineId = '') {
  const lines = s.lines.filter(l => l.orderId === orderId && (!lineId || l.id === lineId));
  const lineIds = new Set(lines.map(l => l.id));
  const belongs = rows => rows?.some(row => lineIds.has(row.lineId));
  const shipments = s.shipments.filter(shipment => belongs(shipment.allocations));
  const shipmentIds = new Set(shipments.map(shipment => shipment.id));
  const contents = shipments.flatMap(shipment => shipment.contents.filter(row => lineIds.has(row.lineId)));
  const shippedLots = new Set(contents.map(row => row.lotId));
  const returns = s.events.filter(event => event.kind === 'Customer return' && lineIds.has(event.lineId) && shipmentIds.has(event.shipmentId));

  const jobs = s.jobs.filter(job => lineIds.has(job.lineId) || belongs(job.allocations));
  const jobIds = new Set(jobs.map(job => job.id));
  const workIds = new Set(s.workOrders.filter(work => lineIds.has(work.lineId)).map(work => work.id));
  const production = s.events.filter(event => event.kind === 'Production');
  const allocated = s.lots.filter(lot => belongs(lot.allocations));
  const reserved = s.lots.flatMap(lot => (lot.reservations ?? [])
    .filter(row => lineIds.has(row.lineId)).map(row => ({ lot, ...row, unit: lot.unit })));
  const reservations = s.events.filter(event => ['Reserve', 'Release reservation'].includes(event.kind) && lineIds.has(event.lineId));
  const directRuns = production.filter(run => run.allocations?.length ? belongs(run.allocations) :
    workIds.has(run.workOrderId) || run.inputs?.some(input => belongs(input.allocations)));

  // Follow actual inputs from allocated or posted outputs. Following descendants of raw stock
  // would include other orders that consumed a portion of the same material.
  const lotById = new Map(s.lots.map(lot => [lot.id, lot]));
  const lotIds = new Set();
  const queue = [
    ...shippedLots, ...allocated.map(lot => lot.id), ...reserved.map(row => row.lot.id),
    ...returns.map(event => event.output), ...directRuns.flatMap(run => run.lotIds ?? run.outputs ?? [run.output]),
    ...jobs.flatMap(job => job.inputs?.map(input => input.id) ?? [job.lotId]),
    ...s.events.filter(event => jobIds.has(event.jobId) && ['Processed return', 'Unused return', 'Process loss'].includes(event.kind))
      .flatMap(event => event.lotIds ?? [event.output]),
  ];
  for (let i = 0; i < queue.length; i++) {
    const lot = lotById.get(queue[i]);
    if (!lot || lotIds.has(lot.id)) continue;
    lotIds.add(lot.id);
    for (const parent of lot.parents ?? []) queue.push(parent.id);
    if (lot.jobId) jobIds.add(lot.jobId);
  }
  const runs = production.filter(run => (run.lotIds ?? run.outputs ?? [run.output]).some(lotId => lotIds.has(lotId)));
  for (const run of runs) workIds.add(run.workOrderId);

  const requisitions = s.requisitions.filter(row => lineIds.has(row.lineId));
  const reqIds = new Set(requisitions.map(row => row.id));
  const quotes = s.quotes.filter(row => reqIds.has(row.requisitionId));
  const receipts = s.events.filter(event => event.kind === 'Goods receipt');
  const purchasedThroughLots = new Set(receipts.filter(event => lotIds.has(event.output)).map(event => event.purchaseLineId).filter(Boolean));
  const purchases = s.purchases.flatMap(po => {
    const matching = po.lines.filter(row => reqIds.has(row.reqId) || purchasedThroughLots.has(row.id));
    return matching.length ? [{ ...po, lines: matching }] : [];
  });
  const dedicatedPurchaseLines = new Set(purchases.flatMap(po => po.lines.filter(row => reqIds.has(row.reqId)).map(row => row.id)));
  const received = receipts.filter(event => lotIds.has(event.output) || dedicatedPurchaseLines.has(event.purchaseLineId));
  for (const receipt of received) if (lotById.has(receipt.output)) lotIds.add(receipt.output);
  const lots = s.lots.filter(lot => lotIds.has(lot.id));
  const linkedJobs = s.jobs.filter(job => jobIds.has(job.id));
  const jobEvents = s.events.filter(event => jobIds.has(event.jobId));
  const inspections = s.events.filter(event => event.kind === 'Quality inspection' && lotIds.has(event.output));
  const movements = s.events.filter(event => ['Internal transfer', 'Stock count adjustment', 'Scrap', 'Supplier return'].includes(event.kind) && lotIds.has(event.output));
  const evidence = new Map(s.evidence.map(row => [row.id, row]));
  const claimHolds = lots.flatMap(lot => {
    const inactiveEvidence = (lot.checks ?? []).flatMap(check => check.evidence ?? []).filter(row => evidence.get(row.id)?.status !== 'Verified');
    if (lot.standardHold) return [{ lot, reason: lot.holdReason || 'Standard Hold' }];
    if (inactiveEvidence.length) return [{ lot, reason: 'Verification missing or withdrawn for ' + inactiveEvidence.map(row => row.number).join(', ') }];
    return [];
  });
  const qualityHolds = lots.filter(lot => lot.qty > 0 && ['Hold', 'Rejected', 'Rework'].includes(lot.qualityStatus));

  const invoices = s.invoices.filter(invoice => shipmentIds.has(invoice.shipmentId) || invoice.serviceOrderId === orderId);
  const costs = s.costs.filter(cost => lotIds.has(cost.lot));
  const sourceIds = {
    'Sales invoice': new Set(invoices.map(invoice => invoice.id)),
    'Receipt cost': new Set(costs.map(cost => cost.id)),
    'Wash service': new Set(costs.filter(cost => cost.washBatchId).map(cost => cost.id)),
    'Embroidery service': new Set(costs.filter(cost => cost.embroideryBatchId).map(cost => cost.id)),
    'Shipment valuation': shipmentIds,
  };
  const vouchers = s.vouchers.filter(voucher => Object.hasOwn(sourceIds, voucher.source?.type) && sourceIds[voucher.source.type].has(voucher.source.id));
  const matched = new Set(vouchers.map(voucher => voucher.id));
  // Vouchers are stored in posting order. Receipts, payments and reversals reference a prior voucher.
  for (const voucher of s.vouchers) {
    if (!matched.has(voucher.id) && (matched.has(voucher.against) || matched.has(voucher.reverses) ||
      voucher.allocations?.some(row => matched.has(row.billId)))) {
      matched.add(voucher.id);
      vouchers.push(voucher);
    }
  }
  const passports = s.passports.filter(passport => lotIds.has(passport.lotId));
  const workOrders = s.workOrders.filter(work => workIds.has(work.id));
  const finishedLots = lots.filter(lot => shippedLots.has(lot.id) ||
    lines.some(line => lot.material === line.product &&
      (lot.allocations?.some(row => row.lineId === line.id) || workOrders.some(work => work.id === lot.workOrderId && work.lineId === line.id))));
  return {
    lines, shipments, contents, shippedLots, returns, workOrders, runs, lotById, lots, finishedLots,
    requisitions, quotes, purchases, receipts: received, reserved, reservations, inspections, movements,
    jobs: linkedJobs, jobEvents, claimHolds, qualityHolds, invoices, costs, vouchers, passports,
  };
}
