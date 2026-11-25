import { STAGES, WASH_STAGES, DISCRETE, clean, req, choice, key, date, decimal, quantity, id, norm,
  ref, record, unique, ensure, round, sum, csvLines } from './model.js';
import { location, party, schemesOf } from './commerce.js';
import { checkHistory, checkLotClaims } from './standards.js';
import { checkRouteStep } from './routes.js';
import { lotKey, usable, takeStock, newLot, post, stockMove, inUnit } from './stock.js';
import { kgBasis, batchWork, openBatch, postingDate, batchReference, track, lineRemaining, lineRemainingKg, wipKg } from './process-batch.js';
import { checkProcessScope, processStockMove, readProcessChemicals, issueProcessChemicals, verifyProcessEvidence } from './process-materials.js';

const PROCESS = 'Washing';
const outputs = [['usable', 'Released'], ['rewash', 'Rework'], ['rejected', 'Rejected']];
const resourceUnits = { water: 'Water (L)', steam: 'Steam (kg)', electricity: 'Electricity (kWh)' };
const optional = (value, label, min = 0) => String(value ?? '').trim() ? decimal(value, label, min) : null;
const temperature = value => optional(value, 'Wash temperature (°C)');
const batchFields = b => ({ process: PROCESS, stage: b.stage, batchId: b.id, workOrderId: b.workOrderId, jobId: b.jobId,
  lineId: b.lineId, lineRevision: b.lineRevision, site: b.site });

export function washRecipe(s, x, ctx) {
  const code = key(x.code, 'Recipe code');
  const version = req(x.version, 'Recipe revision', 40);
  ensure(!s.processSetups.some(row => row.process === PROCESS && norm(row.code) === norm(code) && norm(row.version) === norm(version)),
    'This wash recipe revision already exists.');
  const row = {
    id: id(s, 'WRC'), process: PROCESS, code, version, stage: choice(x.stage, WASH_STAGES, 'washing operation'),
    washType: req(x.washType, 'Washing type', 100), method: req(x.method, 'Recipe instructions', 6000),
    minutes: decimal(x.minutes, 'Recipe cycle minutes', 0.000001), temperatureC: temperature(x.temperatureC),
    effective: date(x.effective), reference: req(x.reference, 'Recipe approval reference'), status: 'Approved',
    actor: ctx.actor, at: ctx.at,
  };
  s.processSetups.push(row);
  return row;
}

export function washLoad(s, x, ctx) {
  const wo = record(s.workOrders, x.workOrderId, 'washing work order');
  ensure(WASH_STAGES.includes(wo.stage) && wo.lineId && wo.stages.includes(wo.stage), 'Release a washing work order on an approved PO or component route.');
  ensure(['Released', 'In progress'].includes(wo.status), 'Choose an open washing work order.');
  const day = date(x.date);
  ensure(day >= wo.date, 'Wash issue cannot precede work order release.');
  const recipe = record(s.processSetups, x.recipeId, 'wash recipe');
  ensure(recipe.process === PROCESS && recipe.status === 'Approved' && recipe.stage === wo.stage && recipe.effective <= day,
    'Choose an approved recipe effective for this operation on the issue date.');
  const batchNumber = req(x.number, 'Wash batch number');
  unique(s.processBatches.filter(b => b.process === PROCESS), 'number', batchNumber, 'This wash batch number already exists.');
  const mode = choice(x.mode, ['In-house', 'Commission'], 'washing mode');
  const processor = mode === 'Commission' ? party(s, x.processorId, 'Processor') : null;
  const site = processor ? req(x.site, 'Actual processor site') : wo.site;
  const machine = processor ? null : record(s.machines, x.machineId, 'washing machine');
  ensure(!machine || (machine.status === 'In service' && location(s, machine.locationId).site === wo.site), 'Choose an in-service machine at the work order site.');
  const challan = processor ? req(x.challan, 'Outward challan') : '';
  if (processor) unique(s.jobs, 'number', challan, 'An outside job already uses this challan.');
  const weighRef = clean(x.weighRef);
  const needs = schemesOf(wo);
  const buyerId = ref(s.orders, ref(s.lines, wo.lineId)?.orderId)?.buyerId;
  const route = wo.componentRoute || { stages: wo.stages, name: wo.route, template: wo.route };
  const issued = csvLines(x.inputs, 'Wash input (lot ID, quantity, optional measured kg)', 2, 3).map(([lotId, amount, measured]) => {
    const lot = record(s.lots, lotId, 'input lot ' + lotId);
    ensure(STAGES[wo.stage].primary.includes(lot.material) && lot.unit === wo.unit, 'Lot ' + lot.id + ' must match the washing material and work order unit.');
    ensure(lot.site === wo.site, 'Transfer lot ' + lot.id + ' to ' + wo.site + ' before issuing.');
    ensure(!lot.ownerId || lot.ownerId === buyerId, 'Lot ' + lot.id + ' belongs to another buyer.');
    usable(s, lot, day, wo.rework);
    checkLotClaims(s, lot, needs);
    if (wo.rework) {
      const prior = ref(s.processBatches, lot.washBatchId);
      ensure(prior?.process === PROCESS && prior.stage === wo.stage && prior.lineId === wo.lineId, 'Re-wash requires a lot from this PO line and washing operation.');
    }
    checkRouteStep({ ...wo, componentRoute: route }, [lot]);
    const qty = quantity(amount, 'Issued quantity for ' + lot.id, lot.unit);
    const basis = kgBasis(lot, qty, measured, weighRef);
    ensure(basis.kg > 0, 'Record a positive issue weight for ' + lot.id + '.');
    return { lot, qty, ...basis };
  });
  ensure(issued.length && new Set(issued.map(row => row.lot.id)).size === issued.length, 'Enter one row per distinct wash input lot.');
  ensure(new Set(issued.map(({ lot }) => JSON.stringify([lot.ownerId, lot.material]))).size === 1,
    'Use one material type and one stock owner per wash batch.');
  const maxKg = optional(x.maxKg, 'Machine load limit (kg)', 0.000001);
  const b = {
    id: id(s, 'WSH'), process: PROCESS, number: batchNumber, workOrderId: wo.id, lineId: wo.lineId, lineRevision: wo.lineRevision,
    stage: wo.stage, mode, site, locationId: wo.locationId, unit: wo.unit, ownerId: issued[0].lot.ownerId,
    jobId: '', challan, processorId: processor?.id || '', processor: processor?.name || '', machineId: machine?.id || '',
    machineName: machine?.name || '', maxKg, recipe: structuredClone(recipe), rework: wo.rework,
    date: day, lastDate: day, status: 'Open', issuedQty: sum(issued), issuedKg: sum(issued, row => row.kg),
    usableQty: 0, rewashQty: 0, rejectedQty: 0, lossQty: 0, unusedQty: 0, returnedQty: 0, returnedKg: 0, unusedKg: 0,
    cycle: null, lines: [], postings: [], notes: clean(x.notes),
  };
  ensure(maxKg == null || b.issuedKg <= maxKg, 'Issued weight exceeds the machine load limit.');
  const checks = checkProcessScope(s, wo, b, issued, day, { consume: Boolean(processor) });
  const eligible = new Set([wo.lineId]);
  b.lines = issued.map(({ lot, qty, kg, basis, basisRef }) => ({
    lotId: lot.id, issued: qty, issuedKg: kg, basis, basisRef, consumed: 0, consumedKg: 0, returned: 0, returnedKg: 0,
    allocations: takeStock(lot, qty, day, eligible),
  }));
  b.remainingQty = b.issuedQty;
  b.remainingKg = b.issuedKg;
  b.checks = checks;
  const inputs = b.lines.map(line => ({ id: line.lotId, qty: line.issued, unit: wo.unit, netKg: line.issuedKg, allocations: line.allocations }));
  const document = ctx.document(x.document, [processor ? 'logistics' : 'production']);
  if (processor) {
    const job = {
      id: id(s, 'JOB'), number: challan, lotId: inputs[0].id, inputs, processorId: processor.id, processor: processor.name, site,
      stage: wo.stage, lineId: wo.lineId, lineRevision: wo.lineRevision, workOrderId: wo.id, washBatchId: b.id,
      date: day, lastDate: day, sent: b.issuedQty, qty: b.issuedQty, unit: wo.unit, sentKg: b.issuedKg, remainingKg: b.issuedKg,
      processed: 0, unused: 0, loss: 0, usableQty: 0, rewashQty: 0, rejectedQty: 0, returnedQty: 0, returnedKg: 0,
      status: 'With processor', checks, allocations: inputs.flatMap(row => row.allocations), carrier: clean(x.carrier),
      route: clean(x.transitRef), document,
    };
    b.jobId = job.id;
    s.jobs.push(job);
  }
  s.processBatches.push(b);
  const e = post(s, processor ? 'Commission outward' : 'Process issue', ctx, {
    ...batchFields(b), date: day, inputs, lotIds: inputs.map(row => row.id), output: inputs[0].id, qty: b.issuedQty, unit: b.unit, netKg: b.issuedKg,
    reference: challan || batchNumber, checks, from: issued[0].lot.location, to: site, document,
    moves: issued.flatMap(({ lot, qty }) => [stockMove(lot, -qty), processStockMove(b, lot.id, qty)]),
  });
  track(b, e, 'Issue', day);
  wo.status = 'In progress';
  return b;
}

export function washCycle(s, x, ctx) {
  const b = openBatch(s, x.batchId, PROCESS);
  const wo = batchWork(s, b);
  ensure(!b.cycle, 'This batch already has a recorded machine cycle. Load a new batch for the next cycle.');
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Cycle record reference');
  const machineName = b.jobId ? req(x.machine, 'Processor machine ID or name') : b.machineName;
  const loadKg = optional(x.loadKg, 'Actual machine load (kg)', 0.000001) ?? b.remainingKg;
  ensure(b.maxKg == null || loadKg <= b.maxKg, 'Actual load exceeds the machine load limit.');
  const noChemicals = x.noChemicals === 'yes';
  const needs = schemesOf(wo);
  const chemicals = readProcessChemicals(s, b, x, day, needs);
  const inputs = b.lines.filter(line => lineRemaining(line) > 0).map(line => ({
    lot: record(s.lots, line.lotId, 'wash input lot'), qty: lineRemaining(line),
  }));
  for (const { lot } of inputs) checkLotClaims(s, lot, needs);
  verifyProcessEvidence(s, b.checks);
  const checks = checkProcessScope(s, wo, b, inputs, day, { consume: !b.jobId, chemicals: chemicals.map(row => row.code), noChemicals, requireChemicalDeclaration: true });
  const resources = Object.fromEntries(Object.entries(resourceUnits).map(([k, label]) => [k, optional(x[k], label)]));
  const cycle = {
    date: day, reference, machineName, loadKg, basisKg: b.remainingKg, minutes: decimal(x.minutes, 'Actual cycle minutes', 0.000001),
    temperatureC: temperature(x.temperatureC), resources, chemicals, noChemicals, notes: clean(x.notes), checks,
  };
  const movements = issueProcessChemicals(s, chemicals, day, wo.lineId);
  const e = post(s, 'Wash cycle', ctx, {
    ...batchFields(b), ...cycle, qty: loadKg, unit: 'kg', checks, moves: movements, lotIds: b.lines.map(row => row.lotId),
    document: ctx.document(x.document, [b.jobId ? 'logistics' : 'production']),
  });
  b.cycle = { ...cycle, eventId: e.id };
  b.status = 'In process';
  track(b, e, 'Cycle', day);
  return b;
}

function washDispositions(s, b, x) {
  return outputs.flatMap(([kind, status]) => {
    if (![x[kind + 'Id'], x[kind + 'Qty'], x[kind + 'Kg']].some(value => String(value ?? '').trim())) return [];
    const qty = quantity(x[kind + 'Qty'], kind + ' output quantity', b.unit);
    const code = lotKey(s, x[kind + 'Id']);
    const kg = b.unit === 'kg' ? qty : b.unit === 'g' ? round(qty / 1000) : decimal(x[kind + 'Kg'], 'Measured ' + kind + ' output kg', 0.000001);
    ensure(!String(x[kind + 'Kg'] ?? '').trim() || decimal(x[kind + 'Kg'], 'Output kg', 0.000001) === kg,
      'Measured output kg must agree with stock quantity when the unit is kg or g.');
    return [{ kind, status, qty, code, kg }];
  });
}

export function washOutput(s, x, ctx) {
  const b = openBatch(s, x.batchId, PROCESS);
  const wo = batchWork(s, b);
  const unused = x.unused === 'yes';
  ensure(unused ? !b.cycle : b.cycle, unused ? 'Return unwashed stock before recording the cycle.' : 'Record the actual cycle before posting washed outputs.');
  const day = postingDate(b, x.date);
  const reference = req(x.reference, unused ? 'Unused return reference' : 'Wash output or inward challan');
  const dest = location(s, x.locationId || wo.locationId);
  ensure(dest.site === wo.site, 'Return stock to the work order site.');
  const line = b.lines.find(row => row.lotId === x.lotId);
  ensure(line, 'Choose an original input lot on this batch.');
  ensure(!s.events.some(e => e.batchId === b.id && e.wash && e.inputs[0].id === line.lotId && norm(e.reference) === norm(reference)),
    'This reference already reconciles lot ' + line.lotId + ' on the wash batch.', 409, 'duplicate');
  const source = record(s.lots, line.lotId, 'original input lot');
  const used = quantity(x.used, 'Quantity reconciled', b.unit);
  const outstanding = lineRemaining(line);
  ensure(used <= outstanding, 'Quantity exceeds the outstanding ' + outstanding + ' ' + b.unit + ' for ' + source.id + '.');
  const openKg = lineRemainingKg(line);
  // Keep an issued weight balance even when the post-wash scale reading is different.
  const basisKg = used === outstanding ? openKg : round(openKg * used / outstanding);
  const before = optional(x.beforeKg, 'Measured before-wash kg', 0.000001);
  const loss = unused ? 0 : quantity(x.loss || '0', 'Process loss', b.unit, true);
  ensure(loss <= used, 'Process loss exceeds quantity reconciled.');
  const parts = unused ? [{ kind: 'unused', status: source.qualityStatus, code: lotKey(s, x.usableId), qty: used, kg: basisKg }]
    : washDispositions(s, b, x);
  ensure(new Set(parts.map(row => norm(row.code))).size === parts.length, 'Use a different lot ID for each output.');
  const received = sum(parts);
  const adjustment = round(received + loss - used);
  ensure(!adjustment || (!DISCRETE.includes(b.unit) && received > 0 && used > loss),
    'Reconcile ' + used + ' ' + b.unit + ' with the usable, re-wash, rejected and loss quantities.');
  const reason = adjustment || loss || parts.some(row => ['rewash', 'rejected'].includes(row.kind))
    ? req(x.notes, 'Disposition and variance reason') : clean(x.notes);
  const good = sum(parts.filter(row => row.kind === 'usable'));
  ensure(round(wo.completedQty + good) <= wo.plannedQty, 'Usable output exceeds the work order plan.');
  const measurements = unused ? [] : csvLines(x.measurements, 'Before/after measurement', 4).map(([name, unit, from, to]) => {
    const before = decimal(from, 'Before-wash measurement');
    const after = decimal(to, 'After-wash measurement');
    return { name: req(name, 'Measurement name'), unit: req(unit, 'Measurement unit', 30), before, after,
      changePct: before ? round((after - before) / before * 100) : null };
  });
  const checks = unused ? source.checks : [...b.checks, ...b.cycle.checks];
  let holdReason = '';
  try {
    checkLotClaims(s, source, schemesOf(wo));
    for (const row of b.cycle?.chemicals ?? []) if (row.lotId) checkHistory(s, record(s.lots, row.lotId, 'wash chemical lot'));
    verifyProcessEvidence(s, checks);
  } catch (error) {
    if (error.code !== 'standard-lock') throw error;
    holdReason = error.message;
  }
  let inputLeft = round(used - loss);
  const receivedKg = sum(parts, row => row.kg);
  const created = parts.map((part, i) => {
    const fraction = part.qty / received;
    const parentQty = i === parts.length - 1 ? inputLeft : Math.min(inputLeft, round((used - loss) * fraction));
    inputLeft = round(inputLeft - parentQty);
    const cycleShare = unused ? 0 : (b.cycle.basisKg ? basisKg / b.cycle.basisKg : 0) * fraction;
    const resources = unused ? {} : Object.fromEntries(Object.entries(b.cycle.resources).map(([k, n]) => [k, n == null ? null : round(n * cycleShare)]));
    const chemicalParents = unused ? [] : b.cycle.chemicals.filter(row => row.lotId).map(row => ({
      id: row.lotId, qty: round(row.qty * cycleShare), unit: row.unit, role: 'Wash chemical',
    })).filter(row => row.qty > 0);
    const allocations = ref(s.lines, wo.lineId)?.unit === b.unit ? [{ lineId: wo.lineId, qty: part.qty }] : [];
    const length = b.unit === 'm' ? part.qty : b.unit === 'cm' ? round(part.qty / 100) : unused && source.lengthM ? inUnit(source, used, 'm') : null;
    return newLot(s, part.code, part.qty, b.unit, day, dest, {
      material: source.material, itemId: source.itemId, label: source.label, ownerId: source.ownerId, composition: source.composition,
      origin: unused ? source.origin : b.site, originCountry: source.originCountry, stage: unused ? source.stage : b.stage,
      workOrderId: wo.id, batchId: b.id, washBatchId: b.id, jobId: b.jobId, processorId: b.processorId, netKg: part.kg, lengthM: length,
      qualityStatus: part.status, scheme: unused ? source.scheme : wo.scheme, additionalSchemes: unused ? source.additionalSchemes : wo.additionalSchemes,
      allocations, allocationBalance: structuredClone(allocations), parents: [
        { id: source.id, qty: parentQty, unit: b.unit, role: 'Wash input' }, ...chemicalParents,
      ],
      checks, standardHold: Boolean(holdReason), holdReason, resources,
      wash: { disposition: part.kind, cycleId: b.cycle?.eventId || '', reference, measurements },
    });
  });
  if (unused) {
    line.returned = round(line.returned + used);
    line.returnedKg = round(line.returnedKg + basisKg);
    b.unusedQty = round(b.unusedQty + used);
    b.unusedKg = round(b.unusedKg + basisKg);
  } else {
    line.consumed = round(line.consumed + used);
    line.consumedKg = round(line.consumedKg + basisKg);
    for (const [kind] of outputs) b[kind + 'Qty'] = round(b[kind + 'Qty'] + sum(parts.filter(part => part.kind === kind)));
    b.lossQty = round(b.lossQty + loss);
    b.returnedQty = round(b.returnedQty + received);
    b.returnedKg = round(b.returnedKg + receivedKg);
    wo.completedQty = round(wo.completedQty + good);
    wo.status = wo.completedQty === wo.plannedQty ? 'Completed' : 'In progress';
  }
  b.remainingQty = sum(b.lines, lineRemaining);
  b.remainingKg = wipKg(b);
  const job = ref(s.jobs, b.jobId);
  if (job) Object.assign(job, {
    qty: b.remainingQty, remainingKg: b.remainingKg, processed: round(b.issuedQty - b.remainingQty - b.unusedQty - b.lossQty),
    unused: b.unusedQty, unusedKg: b.unusedKg, loss: b.lossQty,
    usableQty: b.usableQty, rewashQty: b.rewashQty, rejectedQty: b.rejectedQty, returnedQty: b.returnedQty, returnedKg: b.returnedKg,
    status: b.remainingQty ? 'Part returned' : 'Reconciled', lastDate: day,
  });
  const kind = unused ? 'Unused return' : job ? 'Processed return' : 'Production';
  const e = post(s, kind, ctx, {
    ...batchFields(b), date: day, type: b.rework ? 'Rework' : 'Run', reference, qty: unused || job ? received : good, unit: b.unit,
    output: created.find(lot => lot.wash.disposition === 'usable')?.id || created[0]?.id || '', lotIds: created.map(lot => lot.id),
    inputs: [{ id: source.id, qty: used, unit: b.unit, netKg: basisKg }], checks, note: reason,
    wash: { issuedKg: basisKg, beforeKg: before ?? basisKg, beforeMeasured: before != null, afterKg: receivedKg,
      changeKg: round(receivedKg - (before ?? basisKg)), measurements, outputs: parts },
    reconciliation: { unit: b.unit, input: used, accepted: good, waste: loss, rejects: sum(parts.filter(row => row.kind === 'rejected')),
      rewash: sum(parts.filter(row => row.kind === 'rewash')), adjustment, reference: reason },
    machineName: b.cycle?.machineName || b.machineName, allocations: good && ref(s.lines, wo.lineId)?.unit === b.unit ? [{ lineId: wo.lineId, qty: good }] : [],
    moves: [processStockMove(b, source.id, -used), ...created.map(lot => stockMove(lot, lot.qty))],
    document: ctx.document(x.document, [job ? 'logistics' : 'production']),
  });
  for (const lot of created) lot.eventId = e.id;
  track(b, e, unused ? 'Unused return' : 'Output', day);
  if (!b.remainingQty) b.status = 'Closed';
  return b;
}
