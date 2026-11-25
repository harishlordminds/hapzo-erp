import { choice, clean, csvLines, date, decimal, ensure, id, key, norm, quantity, record, ref, req, round, sum } from './model.js';
import { location } from './commerce.js';
import { checkHistory } from './standards.js';
import { checkProcessScope, verifyProcessEvidence } from './process-materials.js';
import { lotAllocations, lotKey, newLot, post, stockMove } from './stock.js';
import { batchReference, batchWork, lineRemaining, openBatch, postingDate, track, wipMove } from './process-batch.js';
import { startGarmentBatch, garmentEvent, readGarmentIssue, issueGarmentStock, stageDraws, drawGarmentStock, returnGarmentStock } from './garment-stock.js';

export const GARMENT_PROCESSES = ['Stitching', 'Garment finishing'];
const supplies = ['Thread', 'Trim', 'Chemical', 'Zip', 'Button', 'Label', 'Interlining', 'Hangtag'];
const panelKey = (component, position) => JSON.stringify([norm(component), norm(position)]);
const outputType = b => b.process === 'Stitching' ? 'Sewn garment' : 'Finished garment';
const componentRows = pack => (pack?.fabrics ?? []).flatMap(f => f.pattern.map(p => ({
  component: f.code, position: p.name, repeats: p.repeats,
})));

export function approveGarmentPlan(s, x, ctx) {
  const process = choice(x.process, GARMENT_PROCESSES, 'garment operation');
  const line = record(s.lines, x.lineId, 'approved buyer PO line');
  ensure(line.status === 'Approved' && line.stages.includes(process) && line.unit === 'pcs', 'Select an approved pieces PO line with this operation.');
  const code = key(x.code, 'Operation plan code');
  const version = req(x.version, 'Plan revision', 40);
  ensure(!s.processSetups.some(r => r.process === process && r.lineId === line.id && norm(r.code) === norm(code) && norm(r.version) === norm(version)),
    'This operation plan revision already exists.');
  let steps = clean(x.steps, 10000).split(/\r?\n/).map(raw => raw.trim()).filter(Boolean);
  if (!steps.length && process === 'Stitching') steps = (line.garmentSpec?.operations ?? []).map(op => [op.operation, op.notes].filter(Boolean).join(' | '));
  ensure(steps.length && steps.length <= 80, 'Enter the approved operation breakdown in order.');
  let components = [];
  if (process === 'Stitching') {
    const spec = componentRows(line.garmentSpec);
    components = csvLines(x.components, 'Assembly component requirement', 3, 4).map(([component, position, qty, decoration]) => ({
      component: req(component, 'Fabric component').toUpperCase(), position: req(position, 'Panel position'),
      repeats: quantity(qty, 'Panels per garment', 'pcs'), decoration: decoration ? choice(decoration, ['Printing', 'Embroidery'], 'required embellishment') : '',
    }));
    if (!components.length) components = spec;
    ensure(components.length && new Set(components.map(p => panelKey(p.component, p.position))).size === components.length,
      'Record the distinct approved panel positions and pieces per garment.');
    ensure(!spec.length || spec.length === components.length && spec.every(p => components.some(c =>
      panelKey(c.component, c.position) === panelKey(p.component, p.position) && c.repeats === p.repeats)),
    'Assembly must use the panel positions and counts in the approved tech pack.');
  }
  const row = {
    id: id(s, 'GAP'), process, code, version, lineId: line.id, lineRevision: line.revision, specRev: line.specRev,
    status: 'Approved', effective: date(x.effective), reference: req(x.reference, 'Plan approval reference'), components,
    steps: steps.map(raw => { const [operation, ...settings] = raw.split('|'); return { operation: req(operation, 'Operation name'), settings: clean(settings.join('|')) }; }),
    actor: ctx.actor, at: ctx.at, document: ctx.document(x.document, ['production', 'tech-pack']),
  };
  s.processSetups.push(row);
  return row;
}

export function issueGarmentBatch(s, x, ctx) {
  const plan = record(s.processSetups, x.planId, 'approved garment operation plan');
  const process = choice(plan.process, GARMENT_PROCESSES, 'garment operation');
  const { wo, b, day } = startGarmentBatch(s, x, process, process === 'Stitching' ? 'SEW' : 'GFB');
  ensure(plan.status === 'Approved' && plan.effective <= day && plan.lineId === wo.lineId && plan.lineRevision === wo.lineRevision,
    'Use the operation plan pinned to the approved PO revision.');
  const assembly = process === 'Stitching' && !wo.rework;
  const issued = readGarmentIssue(s, wo, x.inputs, day, lot => {
    if (supplies.includes(lot.material)) return { auxiliary: true };
    if (assembly) {
      const p = lot.panel;
      ensure(p?.lineId === wo.lineId && ['Cut bundle', 'Printed bundle', 'Embroidered bundle'].includes(lot.material) && lot.unit === 'pcs',
        'Issue an approved and numbered cut-bundle component allocated to this PO line.');
      const required = plan.components.find(c => panelKey(c.component, c.position) === panelKey(p.component, p.position));
      ensure(required, 'This panel position is outside the approved assembly plan.');
      const decoration = required.decoration === 'Embroidery' ? lot.embroidery : lot.printing;
      ensure(!required.decoration || decoration?.disposition === 'Accepted', 'Release the required ' + required.decoration + ' for ' + lot.id + ' before stitching.');
      return { positionKey: panelKey(p.component, p.position) };
    }
    const allowed = process === 'Stitching' ? ['Sewn garment'] : wo.rework ? ['Finished garment', 'Released garment'] : ['Sewn garment', 'QC-passed garment'];
    const prior = ref(s.workOrders, lot.workOrderId);
    ensure(allowed.includes(lot.material) && lot.unit === 'pcs' && (prior?.lineId === wo.lineId || lot.allocations.some(a => a.lineId === wo.lineId)),
      'Use garment stock from the correct operation and buyer PO line.');
    if (lot.material === 'Sewn garment' && !wo.rework) ensure(ref(s.events, lot.inspectionId)?.decision === 'Released', 'Release sewn garments through Quality before finishing.');
    return { rework: wo.rework, inspectionId: lot.inspectionId || '' };
  });
  const primary = issued.filter(row => !row.auxiliary);
  ensure(primary.length, 'Issue the actual garment or bundle lots for this batch.');
  const capacity = assembly ? Math.min(...plan.components.map(p => Math.floor(
    sum(issued.filter(row => row.positionKey === panelKey(p.component, p.position))) / p.repeats))) : sum(primary);
  const plannedQty = quantity(x.plannedQty, 'Batch plan in garment pieces', 'pcs');
  ensure(plannedQty <= capacity && plannedQty + wo.completedQty <= wo.plannedQty, 'This batch exceeds the issued component sets or remaining work order plan.');
  Object.assign(b, { plan: structuredClone(plan), floorLine: req(x.floorLine, 'Actual production line'), plannedQty, capacity, rework: wo.rework,
    completedQty: 0, entries: [], outputIds: [] });
  const checks = checkProcessScope(s, wo, b, primary, day, { material: () => outputType(b) });
  return issueGarmentStock(s, ctx, b, issued, day, req(x.reference, 'Bundle or garment issue slip'), checks);
}

function openGarmentBatch(s, id) {
  return openBatch(s, id, choice(ref(s.processBatches, id)?.process, GARMENT_PROCESSES, 'garment production batch'));
}

export function transferGarmentLine(s, x, ctx) {
  const b = openGarmentBatch(s, x.batchId);
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Line transfer slip');
  const from = b.floorLine;
  const to = req(x.floorLine, 'Receiving production line');
  ensure(norm(from) !== norm(to), 'Choose a different line.');
  const moves = b.lines.filter(row => lineRemaining(row) > 0).flatMap(row => [
    wipMove(b, row.lotId, -lineRemaining(row), row.unit),
    wipMove({ ...b, floorLine: to }, row.lotId, lineRemaining(row), row.unit),
  ]);
  ensure(moves.length, 'There is no work in progress to transfer.');
  const e = post(s, 'Line transfer', ctx, { ...garmentEvent(b), date: day, reference, from, to, moves, reason: req(x.notes, 'Reason for line transfer') });
  b.floorLine = to;
  track(b, e, 'Line transfer', day);
  return b;
}

export function recordGarmentOperation(s, x, ctx) {
  const b = openGarmentBatch(s, x.batchId);
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Operation log reference');
  const n = quantity(x.step, 'Operation number', 'pcs');
  const step = b.plan.steps[n - 1];
  ensure(step, 'Select an approved operation on this job.');
  ensure(b.lines.some(line => !line.auxiliary && lineRemaining(line) > 0), 'There is no garment stock on this batch.');
  const total = number => sum(b.entries.filter(e => e.step === number));
  const max = n === 1 ? b.plannedQty : total(n - 1);
  const qty = quantity(x.qty, 'Pieces completed at this operation', 'pcs');
  ensure(qty + total(n) <= max, 'Operation output exceeds the available output of the previous step or the batch plan.');
  const defects = quantity(x.defects || '0', 'Defect observations', 'pcs', true);
  ensure(defects <= qty, 'Reported defective pieces cannot exceed the recorded operation output.');
  const machine = x.machineId ? record(s.machines, x.machineId, 'operation machine') : null;
  ensure(!machine || location(s, machine.locationId).site === b.site && machine.status === 'In service', 'Use an in-service machine at this site.');
  const resources = {
    electricity: x.electricity ? decimal(x.electricity, 'Measured electricity kWh') : null,
    water: x.water ? decimal(x.water, 'Measured water L') : null,
    steam: x.steam ? decimal(x.steam, 'Measured steam kg') : null,
  };
  const entry = {
    step: n, operation: step.operation, qty, defects, floorLine: b.floorLine, shift: req(x.shift, 'Shift'),
    operator: req(x.operator, 'Operator or employee reference'), machineId: machine?.id || '', machineName: machine?.name || '',
    settings: clean(x.settings), resources, payrollEligible: b.process === 'Stitching' && !b.rework,
  };
  const e = post(s, 'Garment operation', ctx, { ...garmentEvent(b), ...entry, date: day, reference, unit: 'pcs', document: ctx.document(x.document, ['production']) });
  b.entries.push({ ...entry, eventId: e.id, date: day, reference });
  b.status = 'In process';
  track(b, e, 'Operation', day);
  return b;
}

export function postGarmentOutput(s, x, ctx) {
  const b = openGarmentBatch(s, x.batchId);
  const wo = batchWork(s, b);
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Garment output reference');
  const code = lotKey(s, x.outputId);
  const qty = quantity(x.qty, 'Output garments', 'pcs');
  const last = sum(b.entries.filter(row => row.step === b.plan.steps.length));
  ensure(qty + b.completedQty <= last && qty + wo.completedQty <= wo.plannedQty, 'Garment output exceeds the recorded final operation or work order plan.');
  const draws = stageDraws(s, b, x.inputs);
  const primary = draws.filter(r => !r.line.auxiliary);
  if (b.process === 'Stitching' && !b.rework) {
    for (const p of b.plan.components) ensure(sum(primary.filter(row => row.line.positionKey === panelKey(p.component, p.position))) === qty * p.repeats,
      'Actual ' + p.component + ' / ' + p.position + ' usage must match the approved quantity for ' + qty + ' garments.');
  } else ensure(sum(primary) === qty, 'Issue the actual garment pieces for this output quantity.');
  for (const { lot } of draws) checkHistory(s, lot);
  verifyProcessEvidence(s, b.checks);
  const checks = checkProcessScope(s, wo, b, [{ lot: primary[0].lot, qty }], day, { consume: true, material: () => outputType(b),
    chemicals: draws.filter(d => d.lot.material === 'Chemical').map(d => ref(s.items, d.lot.itemId)?.code || d.lot.id) });
  const measurements = csvLines(x.measurements, 'Finishing measurement', 3).map(([name, unit, amount]) => ({
    name: req(name, 'Measurement'), unit: req(unit, 'Measurement unit'), value: decimal(amount, 'Actual measurement'),
  }));
  const allocations = lotAllocations(s, '', 'pcs', qty, wo.lineId);
  const inspectionHistory = [...new Set(primary.map(row => row.line.inspectionId).filter(Boolean))];
  const parents = draws.map(({ lot, qty: used, line }) => ({ id: lot.id, qty: used, unit: line.unit,
    role: line.auxiliary ? 'Trim or process input' : 'Primary', ...(lot.panel ? { component: lot.panel.component, position: lot.panel.position } : {}) }));
  const offsets = new Map();
  const operations = b.entries.flatMap(row => {
    const start = offsets.get(row.step) || 0;
    const end = start + row.qty;
    offsets.set(row.step, end);
    const pieces = Math.min(end, b.completedQty + qty) - Math.max(start, b.completedQty);
    return pieces > 0 ? [{ row, pieces }] : [];
  });
  const resources = Object.fromEntries(['electricity', 'water', 'steam'].map(k => {
    const measured = operations.filter(({ row }) => row.resources[k] != null);
    return [k, measured.length ? round(sum(measured, ({ row, pieces }) => row.resources[k] * pieces / row.qty)) : null];
  }));
  const operationAllocations = operations.map(({ row, pieces }) => ({ eventId: row.eventId, pieces }));
  const lot = newLot(s, code, qty, 'pcs', day, location(s, b.locationId), {
    material: outputType(b), label: outputType(b), stage: b.stage, scheme: wo.scheme, additionalSchemes: wo.additionalSchemes, ownerId: b.ownerId,
    batchId: b.id, workOrderId: wo.id, qualityStatus: 'Pending inspection', checks, parents, resources,
    composition: clean(x.composition) || [...new Set(primary.map(row => row.lot.composition).filter(Boolean))].join(' / '),
    netKg: x.netKg ? decimal(x.netKg, 'Measured garment net kg', 0.000001) : null, allocations, allocationBalance: structuredClone(allocations),
    [b.process === 'Stitching' ? 'assembly' : 'garmentFinish']: { planId: b.plan.id, operations: operationAllocations.map(row => row.eventId),
      operationAllocations, measurements, inspectionHistory, rework: b.rework },
  });
  const event = post(s, 'Production', ctx, {
    ...garmentEvent(b), date: day, reference, type: b.rework ? 'Rework' : 'Run', output: lot.id, qty, unit: 'pcs', inputs: parents,
    allocations, checks, resources, inspectionHistory, details: operationAllocations.map(row => row.eventId), operationAllocations,
    reconciliation: { unit: 'pcs', input: qty, accepted: qty, waste: 0, rejects: 0 },
    moves: [...drawGarmentStock(b, draws), stockMove(lot, qty)],
  });
  lot.eventId = event.id;
  b.completedQty += qty;
  b.outputIds.push(lot.id);
  wo.completedQty += qty;
  wo.status = wo.completedQty === wo.plannedQty ? 'Completed' : 'In progress';
  track(b, event, 'Output', day);
  if (b.lines.every(line => !lineRemaining(line))) b.status = 'Closed';
  return b;
}

export function returnGarmentInputs(s, x, ctx) {
  const b = openGarmentBatch(s, x.batchId);
  return returnGarmentStock(s, x, ctx, b.process);
}
