// Shared batch engine for process modules (yarn dyeing, ginning, fibre preparation).
// A batch holds work in progress between material issue and output. Every stock change posts
// through the shared action path (store.post → execute) with its genealogy in one SQLite transaction.
import {
  EPS, clean, req, choice, decimal, quantity, number, date, id, ref, record, ensure, round, sum, close, csvLines, norm,
} from './model.js';
import { usable, lotKey, takeStock, newLot, post, stockMove, inUnit, checkDate } from './stock.js';
import { location, schemesOf, party } from './commerce.js';
import { checkEvidence, checkLotClaims, checkHistory } from './standards.js';
import { checkClaimRules, chemicalCodes, componentCodes } from './claim-scope.js';
import { checkRouteStep } from './routes.js';
import { useAssignments } from './yarn-allocation.js';

export const RATE_KEYS = { labour: 'INR per labour hour', machine: 'INR per machine hour', electricity: 'INR per kWh', water: 'INR per kL', steam: 'INR per kg steam', waste: 'INR per kg waste disposal' };
export const RESOURCES = ['electricity', 'water', 'steam', 'labourHours', 'machineHours'];
export const ALLOCATION_BASIS = 'Share of batch WIP kg consumed at each output posting';
const OPEN = ['Open', 'In process'];
const registry = new Map();
export const money = n => Math.round(n * 100) / 100;

export const wipLabel = b => 'WIP · ' + b.number + (b.floorLine ? ' · ' + b.floorLine : '');
export const kgPerUnit = l => l.issued ? l.issuedKg / l.issued : 1;
export const lineRemaining = l => round(l.issued - l.consumed - l.returned);
export const lineRemainingKg = l => round(l.issuedKg - l.consumedKg - l.returnedKg);
export const wipKg = b => round(sum(b.lines, lineRemainingKg));
export const wipMove = (b, lotId, qty, unit) => ({ lotId, qty, unit, locationId: '', location: wipLabel(b), custody: 'Work in progress' });
export const processConfig = name => registry.get(name);
export const batchSummary = (s, b) => registry.get(b.process).summary(s, b);
export const latestActive = b => b.postings.filter(p => !p.reversed && p.kind !== 'Reversal').at(-1);

export function readRates(x) {
  const rates = Object.fromEntries(Object.keys(RATE_KEYS).map(k => [k, decimal(x[k + 'Rate'] || '0', 'Rate ' + RATE_KEYS[k])]));
  const priced = Object.values(rates).some(Boolean);
  return { rates, rateRef: priced ? req(x.rateRef, 'Approved cost rate card reference') : clean(x.rateRef) };
}

export function openBatch(s, batchId, process) {
  const b = record(s.processBatches, batchId, process.toLowerCase() + ' batch');
  ensure(b.process === process && OPEN.includes(b.status), 'Batch ' + b.number + ' is ' + b.status.toLowerCase() + '. Choose an open ' + process.toLowerCase() + ' batch.');
  return b;
}
export function batchWork(s, b) {
  const wo = record(s.workOrders, b.workOrderId, 'work order');
  ensure(['Released', 'In progress', 'Completed'].includes(wo.status), 'Work order ' + wo.number + ' is ' + wo.status.toLowerCase() + '.');
  return wo;
}
export function postingDate(b, input) {
  const day = date(input);
  ensure(day >= b.lastDate, 'Posting date precedes the latest activity on batch ' + b.number + ' (' + b.lastDate + ').');
  return day;
}
export function batchReference(s, b, input, label) {
  const reference = req(input, label);
  ensure(!s.events.some(e => e.batchId === b.id && e.kind !== 'Reversal' && !e.reversedBy && norm(e.reference) === norm(reference)),
    'Reference ' + reference + ' is already posted on batch ' + b.number + '. Use the existing posting or reverse it first.', 409, 'duplicate');
  return reference;
}
export function track(b, e, kind, day) {
  b.postings.push({ eventId: e.id, kind, reversed: false });
  b.lastDate = day;
}

// Standard Lock for a process. Every channel (form, import, API) posts through the same action,
// so the same check applies. Quality status is never consulted here.
export function standardCheck(s, cfg, wo, b, day, { consume = false, amount = null, chemicals = [], lots = [] } = {}) {
  const needs = schemesOf(wo);
  const subject = ref(s.lines, wo.lineId)?.sku || '';
  const evidence = checkEvidence(s, {
    schemes: needs, role: 'Processor', name: s.settings.name, site: b.site, operation: cfg.process, material: cfg.outputMaterial,
    on: day, amount, unit: 'kg', consume, planning: !consume, subject,
  });
  const scoped = checkClaimRules(s, { lineIds: [wo.lineId], operation: cfg.process, holder: s.settings.name, site: b.site, on: day,
    subject, chemicals, components: componentCodes(s, lots) });
  const usage = consume ? evidence.flatMap(d => d.evidence).filter(e => ref(s.evidence, e.id)?.capacity != null).map(e => ({ id: e.id, amount })) : [];
  return { checks: [...evidence, ...scoped], usage };
}

export function kgBasis(lot, qty, measured, reference) {
  if (lot.unit === 'kg') return { kg: qty, basis: 'Stock unit kg', basisRef: '' };
  if (lot.unit === 'g') return { kg: round(qty / 1000), basis: 'Stock unit g', basisRef: '' };
  if (measured) return { kg: decimal(measured, 'Measured kg for ' + lot.id, 0.000001), basis: 'Weighed at issue', basisRef: req(reference, 'Weighing slip for measured kg') };
  ensure(lot.netKg, 'Lot ' + lot.id + ' is stocked in ' + lot.unit + ' without a measured kg basis. Weigh the issue and enter measured kg with the weighing slip.', 422, 'conversion');
  return { kg: inUnit(lot, qty, 'kg'), basis: 'Measured net kg at lot intake', basisRef: lot.eventId || lot.id };
}

function stamp(value, label) {
  const text = String(value ?? '').trim();
  ensure(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text) && Number.isFinite(Date.parse(text)), 'Enter a valid ' + label.toLowerCase() + '.');
  return text.length === 16 ? text + ':00' : text;
}

function proportional(b, consumedKg, before) {
  const open = b.lines.filter(l => lineRemainingKg(l) > EPS);
  let left = consumedKg;
  return open.map((l, i) => {
    const kg = i === open.length - 1 ? Math.min(lineRemainingKg(l), round(left)) : round(lineRemainingKg(l) * consumedKg / before);
    left = round(left - kg);
    return { line: l, kg };
  }).filter(d => d.kg > 0);
}

function explicitDraws(b, rows, consumedKg) {
  const draws = [];
  for (const [lotId, amount] of rows) {
    let left = decimal(amount, 'Consumed kg for ' + lotId, 0.000001);
    const lines = b.lines.filter(l => l.lotId === lotId && lineRemainingKg(l) > EPS);
    ensure(lines.length, 'Invalid lot link · ' + lotId + ' has no work in progress on batch ' + b.number + '.', 422, 'lot-link');
    ensure(left <= sum(lines, lineRemainingKg) + EPS, 'Consumption of ' + lotId + ' exceeds its work in progress.');
    for (const line of lines) {
      const kg = Math.min(left, lineRemainingKg(line));
      if (kg > 0) draws.push({ line, kg: round(kg) });
      left = round(left - kg);
    }
  }
  ensure(close(sum(draws, d => d.kg), consumedKg), 'The listed lot consumption must add up to the WIP consumed.');
  return draws;
}

// Reads the reconciliation fields common to output postings.
export function reconcile(x, outputKg, before) {
  const waste = decimal(x.waste || '0', 'Waste kg');
  const rejects = decimal(x.rejects || '0', 'Rejects kg');
  const adjustment = x.adjustment ? number(x.adjustment, 'Measured gain or loss kg', -1e8, 1e8) : 0;
  const adjustmentRef = adjustment ? req(x.adjustmentRef, 'Basis for the measured gain or loss') : '';
  const consumedKg = decimal(x.consumedKg || String(round(outputKg + waste + rejects - adjustment)), 'WIP consumed kg', 0.000001);
  ensure(close(round(consumedKg + adjustment), round(outputKg + waste + rejects)),
    'Reconcile ' + consumedKg + ' kg consumed' + (adjustment ? ' with ' + adjustment + ' kg adjustment' : '') + ' against ' + outputKg + ' kg output, ' + waste + ' kg waste and ' + rejects + ' kg rejects.');
  ensure(consumedKg <= before + EPS, 'WIP consumed (' + consumedKg + ' kg) exceeds batch work in progress (' + before + ' kg).');
  return { waste, rejects, adjustment, adjustmentRef, consumedKg };
}

// Consumes WIP across issued lots (recorded or proportional) and absorbs chemicals and utilities by the same share.
export function consumeWip(s, b, consumedKg, consumptionText) {
  const before = wipKg(b);
  const explicit = csvLines(consumptionText, 'Lot consumption', 2);
  const draws = explicit.length ? explicitDraws(b, explicit, consumedKg) : proportional(b, consumedKg, before);
  const share = consumedKg >= before - EPS ? 1 : consumedKg / before;
  const consumption = draws.map(d => ({ key: d.line.key, lotId: d.line.lotId, kg: d.kg, qty: round(d.kg / kgPerUnit(d.line)), unit: d.line.unit }));
  for (const c of consumption) {
    const line = b.lines.find(l => l.key === c.key);
    line.consumedKg = round(line.consumedKg + c.kg);
    line.consumed = Math.min(line.issued - line.returned, round(line.consumed + c.qty));
  }
  const chemicals = [];
  for (const c of b.load.chemicals) {
    const open = round(c.qty - c.absorbed);
    const take = share === 1 ? open : round(open * share);
    if (take <= 0) continue;
    c.absorbed = round(c.absorbed + take);
    chemicals.push({ lotId: c.lotId, code: c.code, qty: take, unit: c.unit, entryEvent: c.entryEvent });
  }
  const resources = {};
  for (const k of RESOURCES) {
    const open = round(b.load[k] - b.absorbed[k]);
    resources[k] = share === 1 ? open : round(open * share);
    b.absorbed[k] = round(b.absorbed[k] + resources[k]);
  }
  const sources = [...new Set(consumption.map(c => c.lotId))].map(lotId => record(s.lots, lotId, 'issued lot'));
  return { consumption, chemicals, resources, share, sources, explicit: explicit.length > 0 };
}

// Genealogy links for one output that takes `fraction` of this posting's consumption.
export function parentLinks(consumption, chemicals, sources, fraction = 1) {
  const part = n => round(n * fraction);
  return [
    ...sources.map(lot => {
      const rows = consumption.filter(c => c.lotId === lot.id);
      return { id: lot.id, qty: part(sum(rows)), unit: lot.unit, kg: part(sum(rows, r => r.kg)), role: 'Primary', allocations: [] };
    }),
    ...[...new Set(chemicals.map(c => c.lotId))].map(lotId => {
      const rows = chemicals.filter(c => c.lotId === lotId);
      return { id: lotId, qty: part(sum(rows)), unit: rows[0].unit, role: 'Process input' };
    }),
  ].filter(p => p.qty > 0);
}

// Internal absorption. Kept out of GST and supplier bills. External charges use the Finance cost form.
export function internalCost(s, lot, day, reference, category, amount, basis, eventId) {
  const row = {
    id: id(s, 'CST'), lot, date: day, currency: 'INR', rate: 1, rateRef: 'Base', reference, net: amount, taxable: 0, capitalized: amount,
    cgst: 0, sgst: 0, utgst: 0, igst: 0, cess: 0, gst: 0, credit: 0, taxToCost: 0, landed: amount, itcStatus: 'Not applicable', payable: 0,
    taxRef: '', supplierId: '', supplier: '', category, basis, internal: true, source: { type: 'Process absorption', id: eventId }, document: null,
  };
  s.costs.push(row);
  return row;
}

export function charges(setup, resources, wasteKg) {
  const rates = setup?.rates ?? {};
  return [
    ['Labour', resources.labourHours, 'h', rates.labour], ['Machine', resources.machineHours, 'machine h', rates.machine],
    ['Energy', resources.electricity, 'kWh', rates.electricity], ['Water', round(resources.water / 1000), 'kL', rates.water],
    ['Steam', resources.steam, 'kg steam', rates.steam], ['Waste', wasteKg, 'kg', rates.waste],
  ].filter(([, amount, , rate]) => amount > 0 && rate > 0).map(([category, amount, per, rate]) => ({
    category, amount: money(amount * rate), basis: amount + ' ' + per + ' × ' + rate + ' INR · rate card ' + setup.code + ' r' + setup.version + ' (' + setup.rateRef + ')',
  }));
}

// Spreads posting costs over several output lots by mass.
export function spreadCosts(s, e, lots, day, reference, setup, resources, wasteKg) {
  const total = sum(lots, l => l.netKg);
  for (const c of charges(setup, resources, wasteKg)) {
    let left = c.amount;
    lots.forEach((lot, i) => {
      const amount = i === lots.length - 1 ? money(left) : money(c.amount * lot.netKg / total);
      left = money(left - amount);
      if (amount) e.costIds.push(internalCost(s, lot.id, day, reference + ' · ' + c.category + (lots.length > 1 ? ' · ' + lot.id : ''), c.category, amount,
        c.basis + (lots.length > 1 ? ' · mass share ' + round(lot.netKg / total) : ''), e.id).id);
    });
  }
}

// Returns commission-processed goods to their owner on a delivery challan. Ownership never changed;
// custody moves from this mill to the customer.
export function deliverToOwner(process) {
  return (s, x, ctx) => {
    const customer = party(s, x.customerId, 'Buyer');
    const number = req(x.number, 'Delivery challan number');
    ensure(!s.events.some(e => e.kind === 'Commission delivery' && norm(e.reference) === norm(number)), 'Delivery challan ' + number + ' is already posted.', 409, 'duplicate');
    const day = date(x.date);
    const rows = csvLines(x.lines, 'Delivered lot', 2);
    ensure(rows.length, 'List the lots and quantities delivered.');
    const moves = [];
    const inputs = [];
    for (const [lotId, amount] of rows) {
      const lot = record(s.lots, lotId, 'delivered lot ' + lotId);
      ensure(lot.ownerId === customer.id, 'Lot ' + lot.id + ' is not owned by ' + customer.name + '. Deliver only the customer’s own goods on a commission challan.');
      usable(s, lot, day);
      const qty = quantity(amount, 'Delivered quantity for ' + lot.id, lot.unit);
      ensure(qty <= lot.qty, 'Delivery exceeds ' + lot.id + ' on hand.');
      takeStock(lot, qty, day);
      moves.push(stockMove(lot, -qty), { lotId: lot.id, qty, unit: lot.unit, locationId: '', location: customer.name, custody: 'Customer' });
      inputs.push({ id: lot.id, qty, unit: lot.unit, kg: lot.netKg ? round(lot.netKg * qty / lot.initialQty) : null, commissionRef: lot.commissionRef || '' });
    }
    return post(s, 'Commission delivery', ctx, {
      date: day, process, reference: number, customerId: customer.id, customer: customer.name, inputs, lotIds: inputs.map(i => i.id),
      from: s.settings.name, to: customer.name, carrier: clean(x.carrier, 120), moves, notes: clean(x.notes), document: ctx.document(x.document, ['logistics']),
    });
  };
}

export function engine(cfg) {
  const label = cfg.batchLabel;

  function openNew(s, x, ctx) {
    const wo = record(s.workOrders, x.workOrderId, 'work order');
    ensure(wo.stage === cfg.process && ['Released', 'In progress'].includes(wo.status), 'Choose an open ' + cfg.process.toLowerCase() + ' work order.');
    ensure(cfg.workUnits.includes(wo.unit), 'Release ' + cfg.process.toLowerCase() + ' work orders in ' + cfg.workUnits.join(' or ') + '.');
    const number = req(x.number, label + ' number', 80);
    ensure(!s.processBatches.some(b => norm(b.number) === norm(number)), label + ' number ' + number + ' already exists.');
    const day = date(x.date);
    ensure(day >= wo.date, 'The ' + label.toLowerCase() + ' cannot precede work order release.');
    const setup = x.recipeId || cfg.setupRequired ? record(s.processSetups, x.recipeId, cfg.setupLabel) : null;
    ensure(!setup || setup.process === (cfg.setupProcess || cfg.process) && setup.status === 'Approved' && setup.effective <= day, 'Use an approved ' + cfg.setupLabel + ' effective on ' + day + '.');
    const machine = record(s.machines, x.machineId, 'machine');
    ensure(machine.status === 'In service' && location(s, machine.locationId).site === wo.site, 'Select an in-service machine at ' + wo.site + '.');
    const row = {
      id: id(s, cfg.prefix), number, process: cfg.process, workOrderId: wo.id, site: wo.site, locationId: wo.locationId,
      machineId: machine.id, machineName: machine.name, recipeId: setup?.id || '', recipe: cfg.setupSnapshot(setup),
      date: day, lastDate: day, plannedKg: decimal(x.plannedKg, 'Planned ' + label.toLowerCase() + ' kg', 0.000001), ownerId: null, status: 'Open',
      lines: [], load: { electricity: 0, water: 0, steam: 0, labourHours: 0, machineHours: 0, chemicals: [] },
      absorbed: { electricity: 0, water: 0, steam: 0, labourHours: 0, machineHours: 0 },
      postings: [], outputs: [], entryCount: 0, notes: clean(x.notes), actor: ctx.actor, ...(cfg.batchFields?.(s, x) ?? {}),
    };
    s.processBatches.push(row);
    return row;
  }

  function issue(s, x, ctx) {
    const b = openBatch(s, x.batchId, cfg.process);
    const wo = batchWork(s, b);
    ensure(wo.status !== 'Completed', 'Work order ' + wo.number + ' is complete. Release another work order for more input.');
    const day = postingDate(b, x.date);
    const reference = batchReference(s, b, x.reference, 'Issue slip reference');
    const rows = csvLines(x.lines, 'Issued lot', 2, 3);
    ensure(rows.length, 'Enter the lot IDs and quantities issued.');
    const needs = schemesOf(wo);
    const picked = rows.map(([lotId, amount, measured]) => {
      const lot = record(s.lots, lotId, 'input lot ' + lotId);
      ensure(cfg.inputs.includes(lot.material) || wo.rework && lot.material === cfg.outputMaterial, 'Lot ' + lot.id + ' (' + lot.material + ') cannot be issued to ' + cfg.process.toLowerCase() + '.');
      const extra = cfg.issueLine?.(s, b, lot) ?? {};
      usable(s, lot, day, wo.rework);
      ensure(lot.site === b.site, 'Transfer lot ' + lot.id + ' to ' + b.site + ' before issuing it.');
      checkLotClaims(s, lot, needs);
      const qty = quantity(amount, 'Issued quantity for ' + lot.id, lot.unit);
      ensure(qty <= lot.qty, 'Over-issue · ' + lot.id + ' has ' + lot.qty + ' ' + lot.unit + ' on hand.');
      return { lot, qty, ...kgBasis(lot, qty, measured, x.conversionRef), component: extra.component || '', lineExtra: extra };
    });
    ensure(new Set(picked.map(p => p.lot.id)).size === picked.length, 'List each lot once per issue.');
    checkRouteStep(wo, picked.map(p => p.lot));
    const owners = new Set(picked.map(p => p.lot.ownerId || ''));
    const owner = [...owners][0];
    ensure(owners.size === 1 && (b.ownerId === null || b.ownerId === owner), 'Keep customer-owned and company-owned material in separate batches.');
    if (owner && wo.lineId) ensure(record(s.orders, record(s.lines, wo.lineId, 'PO line').orderId, 'buyer PO').buyerId === owner, 'The work order’s buyer does not own this material.');
    const { checks } = standardCheck(s, cfg, wo, b, day, { lots: picked.map(p => p.lot) });
    const eligible = new Set([wo.lineId].filter(Boolean));
    const moves = [];
    for (const p of picked) useAssignments(s, wo, p.lot, p.qty);
    for (const p of picked) {
      p.allocations = takeStock(p.lot, p.qty, day, eligible);
      moves.push(stockMove(p.lot, -p.qty), wipMove(b, p.lot.id, p.qty, p.lot.unit));
    }
    const e = post(s, 'Process issue', ctx, {
      date: day, process: cfg.process, stage: cfg.process, batchId: b.id, workOrderId: wo.id, site: b.site, reference,
      inputs: picked.map(p => ({ id: p.lot.id, qty: p.qty, unit: p.lot.unit, kg: p.kg, basis: p.basis, basisRef: p.basisRef, component: p.component || '' })),
      from: picked[0].lot.location, to: wipLabel(b), checks, moves, document: ctx.document(x.document, ['production']),
    });
    for (const p of picked) {
      b.lines.push({ key: 'L' + (b.lines.length + 1), lotId: p.lot.id, unit: p.lot.unit, issued: p.qty, consumed: 0, returned: 0,
        issuedKg: p.kg, consumedKg: 0, returnedKg: 0, basis: p.basis, basisRef: p.basisRef, allocations: p.allocations, issueEvent: e.id,
        ...Object.fromEntries(Object.entries(p.lineExtra).filter(([, v]) => v !== '' && v != null)) });
    }
    b.ownerId = owner;
    b.checks = checks;
    track(b, e, 'Issue', day);
    return e;
  }

  function entry(s, x, ctx) {
    const b = openBatch(s, x.batchId, cfg.process);
    const wo = batchWork(s, b);
    const step = choice(x.step, cfg.batchSteps?.(b) ?? cfg.steps, 'process step');
    const start = stamp(x.start, 'Start time');
    const end = stamp(x.end, 'End time');
    ensure(end >= start, 'End time must follow start time.');
    const day = postingDate(b, start.slice(0, 10));
    ensure(wipKg(b) > 0, 'Issue material to batch ' + b.number + ' before recording process steps.');
    const reference = batchReference(s, b, x.reference, 'Process log reference');
    const machine = x.machineId ? record(s.machines, x.machineId, 'machine') : record(s.machines, b.machineId, 'machine');
    ensure(machine.status === 'In service' && location(s, machine.locationId).site === b.site, 'Select an in-service machine at ' + b.site + '.');
    const reading = x.readingId ? record(s.readings, x.readingId, 'meter reading') : null;
    ensure(!reading || reading.machineId === machine.id && reading.verified && !reading.eventId && reading.date === day, 'Use a verified, unused reading for the same machine and date.');
    const measured = (unit, field, text) => reading?.unit === unit ? reading.qty : decimal(x[field] || '0', text);
    const resources = {
      electricity: measured('kWh', 'electricity', 'Electricity kWh'), water: measured('L', 'water', 'Water litres'),
      steam: measured('kg steam', 'steam', 'Steam kg'), labourHours: decimal(x.labourHours || '0', 'Labour hours'),
      machineHours: round((Date.parse(end) - Date.parse(start)) / 3.6e6),
    };
    const needs = schemesOf(wo);
    const chemicals = csvLines(x.chemicals, 'Chemical consumption', 2).map(([lotId, amount]) => {
      const lot = record(s.lots, lotId, 'chemical lot ' + lotId);
      ensure(lot.material === 'Chemical', 'Lot ' + lot.id + ' is not a chemical.');
      usable(s, lot, day);
      ensure(lot.site === b.site, 'Transfer chemical lot ' + lot.id + ' to ' + b.site + ' first.');
      checkLotClaims(s, lot, needs, true);
      const qty = quantity(amount, 'Chemical quantity for ' + lot.id, lot.unit);
      ensure(qty <= lot.qty, 'Over-issue · ' + lot.id + ' has ' + lot.qty + ' ' + lot.unit + ' on hand.');
      return { lot, qty };
    });
    ensure(new Set(chemicals.map(c => c.lot.id)).size === chemicals.length, 'List each chemical lot once per entry.');
    const entryFields = cfg.entryFields?.(s, x, b, { start, end }) ?? {};
    const lots = chemicals.map(c => c.lot);
    const { checks } = standardCheck(s, cfg, wo, b, day, { chemicals: chemicalCodes(s, lots), lots });
    for (const c of chemicals) takeStock(c.lot, c.qty, day);
    const e = post(s, 'Process entry', ctx, {
      date: day, process: cfg.process, stage: cfg.process, step, batchId: b.id, workOrderId: wo.id, site: b.site, reference,
      start, end, machineId: machine.id, machineName: machine.name, operator: req(x.operator, 'Operator', 100), shift: req(x.shift, 'Shift', 40),
      temperature: x.temperature ? number(x.temperature, 'Temperature °C', -20, 200) : null,
      liquorRatio: x.liquorRatio ? decimal(x.liquorRatio, 'Actual liquor ratio') : null, ph: x.ph ? number(x.ph, 'pH', 0, 14) : null,
      moisture: x.moisture ? number(x.moisture, 'Moisture %', 0, 100) : null,
      droppings: x.droppings ? decimal(x.droppings, 'Measured waste removed at this step kg') : null,
      readingId: reading?.id || '', ...resources, ...entryFields,
      inputs: chemicals.map(c => ({ id: c.lot.id, qty: c.qty, unit: c.lot.unit, role: 'Process input' })), checks,
      moves: chemicals.map(c => stockMove(c.lot, -c.qty)), notes: clean(x.notes), document: ctx.document(x.document, ['production']),
    });
    if (reading) reading.eventId = e.id;
    for (const k of RESOURCES) b.load[k] = round(b.load[k] + resources[k]);
    for (const c of chemicals) {
      b.load.chemicals.push({ lotId: c.lot.id, itemId: c.lot.itemId, code: ref(s.items, c.lot.itemId)?.code || c.lot.id, unit: c.lot.unit, qty: c.qty, absorbed: 0, entryEvent: e.id });
    }
    b.entryCount++;
    b.status = 'In process';
    track(b, e, 'Entry', day);
    return e;
  }

  // One output lot per posting (partial postings allowed unless the configured granularity says otherwise).
  function output(s, x, ctx) {
    const b = openBatch(s, x.batchId, cfg.process);
    const wo = batchWork(s, b);
    const day = postingDate(b, x.date);
    const reference = batchReference(s, b, x.reference, 'Output reference');
    ensure(b.entryCount > 0, 'Record the process entry before posting output.');
    const before = wipKg(b);
    ensure(before > 0, 'Batch ' + b.number + ' has no material in process.');
    const result = choice(x.result || 'Accepted', ['Accepted', 'Rework'], 'output result');
    const unit = choice(x.unit || 'kg', cfg.outputUnits, 'output unit');
    const qty = quantity(x.outputQty, 'Output quantity', unit);
    const outputKg = unit === 'kg' ? qty : decimal(x.netKg, 'Measured net kg of the output', 0.000001);
    const r = reconcile(x, outputKg, before);
    cfg.outputGuard?.(s, b, { ...r, before, x, day });
    const add = result === 'Accepted' ? (wo.unit === unit ? qty : wo.unit === 'kg' ? outputKg : null) : 0;
    ensure(add !== null, 'Post output in ' + wo.unit + ' for work order ' + wo.number + '.');
    ensure(round(wo.completedQty + add) <= wo.plannedQty, 'Output exceeds work order ' + wo.number + '. Release another work order for the excess.');
    const outId = lotKey(s, x.outputId);
    const item = x.itemId ? record(s.items, x.itemId, 'output item') : null;
    ensure(!item || item.type === cfg.outputMaterial && item.unit === unit, 'The output item must be ' + cfg.outputMaterial.toLowerCase() + ' stocked in ' + unit + '.');
    const dest = location(s, x.locationId || b.locationId);
    ensure(dest.site === b.site, 'Post output at ' + b.site + '.');
    const used = consumeWip(s, b, r.consumedKg, x.consumption);
    for (const lot of used.sources) checkHistory(s, lot);
    const chemicalLots = b.load.chemicals.map(c => ref(s.lots, c.lotId)).filter(Boolean);
    const { checks, usage } = standardCheck(s, cfg, wo, b, day, { consume: true, amount: outputKg, chemicals: chemicalCodes(s, chemicalLots), lots: used.sources });
    const parents = parentLinks(used.consumption, used.chemicals, used.sources);
    const composition = [...new Set(used.sources.map(l => l.composition).filter(Boolean))];
    const out = newLot(s, outId, qty, unit, day, dest, {
      material: cfg.outputMaterial, label: clean(x.label, 120) || item?.name || cfg.outputLabel(b), itemId: item?.id || '',
      ownerId: b.ownerId || '', stage: cfg.process, workOrderId: wo.id, batchId: b.id, ...(cfg.outputFields?.(b, x) ?? {}),
      scheme: wo.scheme, additionalSchemes: wo.additionalSchemes, checks,
      qualityStatus: result === 'Rework' ? 'Rework' : cfg.releaseOutput && x.inspect !== 'yes' ? 'Released' : 'Pending inspection',
      composition: composition.length === 1 ? composition[0] : composition.join(' / '),
      netKg: outputKg, lengthM: null, grossKg: x.grossKg ? decimal(x.grossKg, 'Gross kg', 0.000001) : null,
      conversionBasis: unit === 'kg' ? 'Stock unit kg' : 'Measured net kg at output', parents,
    });
    const setup = ref(s.processSetups, b.recipeId);
    const e = post(s, 'Production', ctx, {
      date: day, stage: cfg.process, process: cfg.process, type: result === 'Rework' ? 'Rework output' : 'Run', workOrderId: wo.id, batchId: b.id,
      lineRevision: wo.lineRevision, inputs: parents, output: out.id, qty, unit, site: b.site, allocations: [],
      reconciliation: { unit: 'kg', input: r.consumedKg, accepted: outputKg, waste: r.waste, rejects: r.rejects, adjustment: r.adjustment, reference: r.adjustmentRef, basis: 'Measured kg' },
      reference, recipe: cfg.recipeText(b), shift: clean(x.shift, 40), operator: clean(x.operator, 100), machineId: b.machineId, machineName: b.machineName, readingId: '',
      ...used.resources, chemicals: used.chemicals, consumption: used.consumption, share: round(used.share),
      allocationBasis: used.explicit ? 'Recorded lot consumption; resources by ' + ALLOCATION_BASIS.toLowerCase() : ALLOCATION_BASIS,
      methodVersion: cfg.method, completedAdd: add, evidenceUsage: usage, processCost: charges(setup, used.resources, round(r.waste + r.rejects)), costIds: [], checks,
      ...(cfg.outputEvent?.(b, x) ?? {}),
      moves: [...used.consumption.map(c => wipMove(b, c.lotId, -c.qty, c.unit)), stockMove(out, qty)],
      document: ctx.document(x.document, ['production']),
    });
    for (const c of e.processCost) e.costIds.push(internalCost(s, out.id, day, reference + ' · ' + c.category, c.category, c.amount, c.basis, e.id).id);
    out.eventId = e.id;
    b.outputs.push(out.id);
    wo.completedQty = round(wo.completedQty + add);
    wo.status = wo.completedQty >= wo.plannedQty ? 'Completed' : 'In progress';
    track(b, e, 'Output', day);
    return out;
  }

  function returnUnused(s, x, ctx) {
    const b = openBatch(s, x.batchId, cfg.process);
    const day = postingDate(b, x.date);
    const reference = batchReference(s, b, x.reference, 'Return slip reference');
    const rows = csvLines(x.lines, 'Unused return', 2);
    ensure(rows.length, 'Enter the lot IDs and unused quantities returned.');
    const moves = [];
    const returns = [];
    for (const [lotId, amount] of rows) {
      const lot = record(s.lots, lotId, 'returned lot ' + lotId);
      const lines = b.lines.filter(l => l.lotId === lot.id && lineRemaining(l) > EPS);
      ensure(lines.length, 'Invalid lot link · ' + lot.id + ' has no unused quantity on batch ' + b.number + '.', 422, 'lot-link');
      const qty = quantity(amount, 'Returned quantity for ' + lot.id, lot.unit);
      ensure(qty <= round(sum(lines, lineRemaining)) + EPS, 'Return of ' + lot.id + ' exceeds its unused work in progress (' + round(sum(lines, lineRemaining)) + ' ' + lot.unit + ').');
      checkDate(lot, day);
      let left = qty;
      for (const line of lines) {
        const take = Math.min(left, lineRemaining(line));
        if (take <= 0) continue;
        const kg = close(take, lineRemaining(line)) ? lineRemainingKg(line) : round(take * kgPerUnit(line));
        line.returned = round(line.returned + take);
        line.returnedKg = round(line.returnedKg + kg);
        let back = take;
        const restored = [];
        for (const a of line.allocations) {
          const give = Math.min(back, round(a.qty - (a.restored || 0)));
          if (give <= 0) continue;
          a.restored = round((a.restored || 0) + give);
          back = round(back - give);
          const bucket = lot.allocationBalance.find(row => row.lineId === a.lineId);
          if (bucket) bucket.qty = round(bucket.qty + give); else lot.allocationBalance.push({ lineId: a.lineId, qty: give });
          restored.push({ lineId: a.lineId, qty: give });
        }
        returns.push({ key: line.key, lotId: lot.id, qty: take, kg, unit: lot.unit, restored });
        left = round(left - take);
      }
      lot.qty = round(lot.qty + qty);
      lot.lastDate = day;
      moves.push(wipMove(b, lot.id, -qty, lot.unit), stockMove(lot, qty));
    }
    const e = post(s, 'Process return', ctx, {
      date: day, process: cfg.process, stage: cfg.process, batchId: b.id, workOrderId: b.workOrderId, site: b.site, reference,
      inputs: returns.map(r => ({ id: r.lotId, qty: r.qty, unit: r.unit, kg: r.kg })), returns, from: wipLabel(b), to: 'Original lot location', moves,
      notes: clean(x.notes),
    });
    track(b, e, 'Return', day);
    return e;
  }

  function closeBatch(s, x, ctx) {
    const b = openBatch(s, x.batchId, cfg.process);
    const day = postingDate(b, x.date);
    const reason = req(x.reason, 'Closure reason');
    const left = wipKg(b);
    const moves = [];
    const loss = [];
    if (left > EPS) {
      ensure(x.lossConfirmed === 'yes', left + ' kg remains in process. Return unused material, or confirm the remainder as measured process loss.');
      req(x.lossRef, 'Measured loss reference');
      for (const line of b.lines.filter(l => lineRemainingKg(l) > EPS)) {
        const qty = lineRemaining(line);
        loss.push({ key: line.key, lotId: line.lotId, qty, kg: lineRemainingKg(line), unit: line.unit });
        moves.push(wipMove(b, line.lotId, -qty, line.unit));
        line.consumedKg = round(line.consumedKg + lineRemainingKg(line));
        line.consumed = round(line.consumed + qty);
      }
    }
    const unabsorbed = Object.fromEntries(RESOURCES.map(k => [k, round(b.load[k] - b.absorbed[k])]));
    const chemicals = b.load.chemicals.filter(c => c.qty > c.absorbed).map(c => ({ lotId: c.lotId, qty: round(c.qty - c.absorbed), unit: c.unit }));
    const e = post(s, 'Process close', ctx, {
      date: day, process: cfg.process, stage: cfg.process, batchId: b.id, workOrderId: b.workOrderId, site: b.site,
      reference: clean(x.lossRef) || 'CLOSE-' + b.number, reason, loss, unabsorbed: { ...unabsorbed, chemicals }, moves,
    });
    b.status = 'Closed';
    b.closedBy = ctx.actor;
    track(b, e, 'Close', day);
    return e;
  }

  function reverse(s, x, ctx) {
    const b = openBatch(s, x.batchId, cfg.process);
    const reason = req(x.reason, 'Reversal reason', 1000);
    const last = latestActive(b);
    ensure(last, 'Batch ' + b.number + ' has no posting to reverse.');
    ensure(last.eventId === x.eventId, 'Reverse the latest active posting on batch ' + b.number + ' first (' + last.eventId + ').');
    const e = record(s.events, x.eventId, 'posting');
    const day = date(x.date);
    ensure(day >= e.date, 'The reversal cannot precede the original posting.');
    const moves = [];
    if (e.kind === 'Process issue') {
      const lines = b.lines.filter(l => l.issueEvent === e.id);
      ensure(lines.every(l => l.consumed === 0 && l.returned === 0), 'Issued material has been consumed or returned. Reverse those postings first.');
      for (const line of lines) {
        const lot = record(s.lots, line.lotId, 'issued lot');
        lot.qty = round(lot.qty + line.issued);
        for (const a of line.allocations) {
          const bucket = lot.allocationBalance.find(row => row.lineId === a.lineId);
          if (bucket) bucket.qty = round(bucket.qty + a.qty); else lot.allocationBalance.push({ lineId: a.lineId, qty: a.qty });
        }
        moves.push(wipMove(b, lot.id, -line.issued, line.unit), stockMove(lot, line.issued));
      }
      b.lines = b.lines.filter(l => l.issueEvent !== e.id);
      if (!b.lines.length) b.ownerId = null;
    } else if (e.kind === 'Process entry') {
      const used = b.load.chemicals.filter(c => c.entryEvent === e.id);
      ensure(used.every(c => c.absorbed === 0), 'Chemicals from this entry were absorbed into output. Reverse the output first.');
      for (const c of used) {
        const lot = record(s.lots, c.lotId, 'chemical lot');
        lot.qty = round(lot.qty + c.qty);
        moves.push(stockMove(lot, c.qty));
      }
      b.load.chemicals = b.load.chemicals.filter(c => c.entryEvent !== e.id);
      for (const k of RESOURCES) b.load[k] = round(b.load[k] - (e[k] || 0));
      if (e.readingId) ref(s.readings, e.readingId).eventId = '';
      b.entryCount--;
    } else if (e.kind === 'Production') {
      const outs = (e.outputs ?? [e.output]).map(lotId => record(s.lots, lotId, 'output lot'));
      for (const out of outs) {
        ensure(close(out.qty, out.initialQty) && !s.lots.some(l => l.parents?.some(p => p.id === out.id)) &&
          !s.passports.some(p => p.lotId === out.id) && !s.shipments.some(sh => sh.lotIds?.includes(out.id)),
        'Output ' + out.id + ' has been used, moved or shipped. Reverse the downstream postings first.');
      }
      for (const c of e.consumption) {
        const line = b.lines.find(l => l.key === c.key);
        line.consumedKg = round(line.consumedKg - c.kg);
        line.consumed = Math.max(0, round(line.consumed - c.qty));
        moves.push(wipMove(b, c.lotId, c.qty, c.unit));
      }
      for (const c of e.chemicals) {
        const row = b.load.chemicals.find(r => r.lotId === c.lotId && r.entryEvent === c.entryEvent);
        row.absorbed = round(row.absorbed - c.qty);
      }
      for (const k of RESOURCES) b.absorbed[k] = round(b.absorbed[k] - (e[k] || 0));
      for (const u of e.evidenceUsage ?? []) {
        const ev = ref(s.evidence, u.id);
        if (ev) ev.used = round(ev.used - u.amount);
      }
      for (const costId of e.costIds ?? []) {
        const c = ref(s.costs, costId);
        internalCost(s, c.lot, day, c.reference + ' · reversal', c.category, -c.landed, 'Reversal of ' + c.id + ' · ' + reason, e.id);
      }
      const wo = record(s.workOrders, e.workOrderId, 'work order');
      wo.completedQty = round(wo.completedQty - (e.completedAdd || 0));
      if (wo.status === 'Completed' || wo.status === 'In progress') wo.status = wo.completedQty ? 'In progress' : 'Released';
      for (const out of outs) {
        moves.push(stockMove(out, -out.qty));
        out.qty = 0;
        out.qualityStatus = 'Reversed';
        out.reversedBy = e.id;
      }
      const removed = new Set(outs.map(o => o.id));
      b.outputs = b.outputs.filter(idOut => !removed.has(idOut));
    } else if (e.kind === 'Process return') {
      for (const r of e.returns) {
        const lot = record(s.lots, r.lotId, 'returned lot');
        const line = b.lines.find(l => l.key === r.key);
        ensure(lot.qty >= r.qty - EPS, 'Lot ' + lot.id + ' no longer holds the returned quantity.');
        for (const a of r.restored) {
          const bucket = lot.allocationBalance.find(row => row.lineId === a.lineId);
          ensure(bucket && bucket.qty >= a.qty - EPS, 'The PO allocation restored to ' + lot.id + ' has since been used.');
          bucket.qty = round(bucket.qty - a.qty);
          const taken = line.allocations.find(row => row.lineId === a.lineId);
          taken.restored = round(taken.restored - a.qty);
        }
        lot.allocationBalance = lot.allocationBalance.filter(row => row.qty > 0);
        lot.qty = round(lot.qty - r.qty);
        line.returned = round(line.returned - r.qty);
        line.returnedKg = round(line.returnedKg - r.kg);
        moves.push(stockMove(lot, -r.qty), wipMove(b, lot.id, r.qty, r.unit));
      }
    } else ensure(false, 'This posting type cannot be reversed here.');
    const rev = post(s, 'Reversal', ctx, {
      date: day, process: cfg.process, stage: cfg.process, batchId: b.id, workOrderId: b.workOrderId, site: b.site,
      reverses: e.id, reversedKind: e.kind, reference: 'REV-' + e.reference, reason, output: e.kind === 'Production' ? e.output : '', moves,
    });
    e.reversedBy = rev.id;
    last.reversed = true;
    b.postings.push({ eventId: rev.id, kind: 'Reversal', reversed: false, of: e.id });
    return rev;
  }

  function summary(s, b) {
    const setup = ref(s.processSetups, b.recipeId);
    const outputs = s.events.filter(e => e.batchId === b.id && e.kind === 'Production' && !e.reversedBy);
    const issuedKg = round(sum(b.lines, l => l.issuedKg));
    const returnedKg = round(sum(b.lines, l => l.returnedKg));
    const netKg = round(issuedKg - returnedKg);
    const consumedKg = round(sum(b.lines, l => l.consumedKg));
    const acceptedKg = round(sum(outputs.filter(e => e.type === 'Run'), e => e.reconciliation.accepted));
    const reworkKg = round(sum(outputs.filter(e => e.type !== 'Run'), e => e.reconciliation.accepted));
    const byProductKg = round(sum(outputs, e => e.reconciliation.byProduct || 0));
    const waste = round(sum(outputs, e => e.reconciliation.waste));
    const rejects = round(sum(outputs, e => e.reconciliation.rejects));
    const base = { setup, recipe: setup, issuedKg, returnedKg, netKg, consumedKg, wipKg: wipKg(b), acceptedKg, reworkKg, byProductKg, waste, rejects, outputs,
      yieldPct: consumedKg ? round(100 * acceptedKg / consumedKg) : null };
    return { ...base, rows: [['Batch quantity', b.plannedKg, issuedKg, 'kg', 'Planned batch / issued'], ...cfg.planRows(s, b, base)] };
  }

  const api = { cfg, open: openNew, issue, entry, output, returnUnused, close: closeBatch, reverse, summary };
  registry.set(cfg.process, api);
  return api;
}
