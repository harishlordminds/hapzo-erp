import { STAGES, PRINT_STAGES, ROUTES, DISCRETE, choice, clean, csvLines, date, decimal, ensure, id, key, norm, number, quantity,
  record, ref, req, round, sum, unique } from './model.js';
import { location, party, schemesOf } from './commerce.js';
import { checkHistory, checkLotClaims } from './standards.js';
import { checkRouteStep, routeSnapshot } from './routes.js';
import { inUnit, lotAllocations, lotKey, measures, newLot, post, stockMove, takeStock, usable } from './stock.js';
import { batchReference, batchWork, lineRemaining, openBatch, parentLinks, postingDate, track } from './process-batch.js';
import { checkProcessScope, issueProcessChemicals, processStockMove, readProcessChemicals, verifyProcessEvidence } from './process-materials.js';

export const PRINTING = 'Printing';
export const EMBROIDERY = 'Embroidery';
export const decorationOf = lot => lot.printing ?? lot.embroidery;
const workTypes = [...PRINT_STAGES, EMBROIDERY];
const decorationKey = b => b.process === EMBROIDERY ? 'embroidery' : 'printing';
export const PRINT_FINISHES = {
  None: [], Curing: ['Curing'], Washing: ['Washing'], 'Curing then washing': ['Curing', 'Washing'], 'Washing then curing': ['Washing', 'Curing'],
};
const dispositions = { Accepted: 'Released', Misprint: 'Rework', Rejected: 'Rejected', Unused: 'Released' };
const outputMaterial = (stage, source) => STAGES[stage].preserve || stage === EMBROIDERY && !['Cut bundle', 'Printed bundle', 'Embroidered bundle'].includes(source.material)
  ? source.material : STAGES[stage].output;
const eventBatch = b => ({ batchId: b.id, process: b.process, stage: b.stage, workOrderId: b.workOrderId, lineId: b.lineId,
  lineRevision: b.lineRevision, jobId: b.jobId, site: b.site });
const documentBucket = b => b.jobId ? 'logistics' : 'production';
const activeQty = (b, lotId) => sum(b.runs.filter(run => run.lotId === lotId), run => run.remaining);
export const unprintedQty = (b, line) => round(lineRemaining(line) - activeQty(b, line.lotId));

export function approvePrintArtwork(s, x, ctx) {
  const stage = choice(x.stage, workTypes, 'embellishment placement on the route');
  const process = stage === EMBROIDERY ? EMBROIDERY : PRINTING;
  const route = x.componentRouteId ? record(s.componentRoutes, x.componentRouteId, 'approved component route') : null;
  const line = record(s.lines, x.lineId || route?.lineId, 'buyer PO line');
  const effective = date(x.effective);
  ensure(line.status === 'Approved' && (route?.stages ?? line.stages).includes(stage), 'Approve the PO line and choose a printing placement on its route.');
  ensure(!route || route.lineId === line.id && route.status === 'Approved' && route.effective <= effective, 'Choose an approved component route for this PO line and artwork date.');
  const code = key(x.code, 'Artwork code');
  const version = req(x.version, 'Artwork revision', 40);
  ensure(!s.processSetups.some(a => a.process === process && a.lineId === line.id && norm(a.code) === norm(code) && norm(a.version) === norm(version)),
    'This artwork revision already exists on the PO line.');
  const finish = choice(x.finish || 'None', Object.keys(PRINT_FINISHES), 'post-print treatment');
  const artwork = {
    id: id(s, 'ART'), process, stage, code, version, status: 'Approved', lineId: line.id, lineRevision: line.revision, specRev: line.specRev,
    componentRoute: route ? routeSnapshot(route) : null, effective, method: req(x.method, 'Print method', 100),
    design: req(x.design, 'Design or artwork reference', 500), placement: req(x.placement, 'Print placement', 300),
    designFile: process === EMBROIDERY ? req(x.designFile, 'Embroidery design file reference') : '',
    aftercare: process === EMBROIDERY ? [] : [...PRINT_FINISHES[finish]], instructions: clean(x.instructions, 4000), reference: req(x.reference, 'Artwork approval reference'),
    document: ctx.document(x.document, ['tech-pack', 'production']), actor: ctx.actor, at: ctx.at,
  };
  s.processSetups.push(artwork);
  return artwork;
}

export function issuePrintBatch(s, x, ctx) {
  const wo = record(s.workOrders, x.workOrderId, 'printing work order');
  ensure(workTypes.includes(wo.stage) && wo.stages.includes(wo.stage) && ['Released', 'In progress'].includes(wo.status),
    'Choose an open embellishment work order on an approved route.');
  const artwork = record(s.processSetups, wo.printArtworkId, 'approved artwork on the work order');
  const day = date(x.date);
  ensure(day >= wo.date, 'The input issue cannot precede work order release.');
  const number = req(x.number, 'Print batch number');
  unique(s.processBatches, 'number', number, 'This batch number already exists.');
  const mode = choice(x.mode, ['In-house', 'Commission'], 'printing mode');
  const processor = mode === 'Commission' ? party(s, x.processorId, 'Processor') : null;
  const site = processor ? req(x.site, 'Actual processor facility') : wo.site;
  const challan = processor ? req(x.challan, 'Printing outward challan') : '';
  if (processor) unique(s.jobs, 'number', challan, 'An outside job already uses this challan.');
  const buyer = ref(s.orders, ref(s.lines, wo.lineId)?.orderId)?.buyerId;
  const needs = schemesOf(wo);
  const loads = csvLines(x.inputs, 'Print input lot and quantity', 2).map(([lotId, amount]) => {
    const lot = record(s.lots, lotId, 'input lot ' + lotId);
    ensure(lot.unit === wo.unit && lot.site === wo.site, 'Use the work order unit and issue lot ' + lot.id + ' from the work order site.');
    ensure(!lot.ownerId || lot.ownerId === buyer, 'Lot ' + lot.id + ' belongs to another buyer.');
    usable(s, lot, day, wo.rework);
    checkLotClaims(s, lot, needs);
    if (wo.rework) {
      const prior = artwork.process === EMBROIDERY ? lot.embroidery : lot.printing;
      ensure(['Misprint', 'Rework'].includes(prior?.disposition) && prior.artworkId === artwork.id && lot.stage === wo.stage,
        'Rework requires stock from this operation and the same approved artwork revision.');
    } else {
      ensure(STAGES[wo.stage].primary.includes(lot.material), 'Lot ' + lot.id + ' is incompatible with this print placement.');
      const optional = wo.stage === 'Printing' ? 'Embroidery' : 'Printing';
      const stages = Object.hasOwn(ROUTES, wo.route) && lot.stage !== optional ? wo.stages.filter(stage => stage !== optional) : wo.stages;
      checkRouteStep({ ...wo, componentRoute: wo.componentRoute || { name: wo.route, template: wo.route, stages } }, [lot]);
    }
    return { lot, qty: quantity(amount, 'Issued quantity for ' + lot.id, wo.unit) };
  });
  ensure(loads.length && new Set(loads.map(row => row.lot.id)).size === loads.length, 'Enter one row per distinct input lot.');
  ensure(new Set(loads.map(({ lot }) => JSON.stringify([lot.material, lot.ownerId]))).size === 1, 'Use one material type and stock owner per print batch.');
  const b = {
    id: id(s, artwork.process === EMBROIDERY ? 'EMB' : 'PRB'), process: artwork.process, stage: wo.stage, number, artwork: structuredClone(artwork), workOrderId: wo.id,
    lineId: wo.lineId, lineRevision: wo.lineRevision, route: wo.route, stages: [...wo.stages], rework: wo.rework,
    site, locationId: wo.locationId, mode, challan, processorId: processor?.id || '', processor: processor?.name || '', jobId: '',
    ownerId: loads[0].lot.ownerId, unit: wo.unit, date: day, lastDate: day, status: 'Open',
    issuedQty: sum(loads), remainingQty: sum(loads), acceptedQty: 0, misprintQty: 0, rejectedQty: 0, wasteQty: 0, returnedQty: 0,
    unusedQty: 0, lines: [], runs: [], postings: [], notes: clean(x.notes),
  };
  b.checks = checkProcessScope(s, wo, b, loads, day, { consume: Boolean(processor), material: lot => outputMaterial(b.stage, lot) });
  const inputs = loads.map(({ lot, qty }) => ({ id: lot.id, qty, unit: wo.unit, allocations: takeStock(lot, qty, day, new Set([wo.lineId])) }));
  b.lines = inputs.map(row => ({ lotId: row.id, issued: row.qty, consumed: 0, returned: 0 }));
  const document = ctx.document(x.document, [processor ? 'logistics' : 'production']);
  if (processor) {
    const job = {
      id: id(s, 'JOB'), number: challan, lotId: inputs[0].id, inputs, processorId: processor.id, processor: processor.name, site,
      stage: wo.stage, lineId: wo.lineId, lineRevision: wo.lineRevision, workOrderId: wo.id,
      [b.process === EMBROIDERY ? 'embroideryBatchId' : 'printBatchId']: b.id,
      date: day, lastDate: day, sent: b.issuedQty, qty: b.issuedQty, unit: wo.unit,
      processed: 0, unused: 0, loss: 0, acceptedQty: 0, misprintQty: 0, rejectedQty: 0, returnedQty: 0,
      status: 'With processor', checks: b.checks, allocations: inputs.flatMap(row => row.allocations), carrier: clean(x.carrier), document,
    };
    b.jobId = job.id;
    s.jobs.push(job);
  }
  s.processBatches.push(b);
  const e = post(s, processor ? 'Commission outward' : 'Process issue', ctx, {
    ...eventBatch(b), date: day, reference: challan || b.number, inputs, lotIds: inputs.map(row => row.id), output: inputs[0].id,
    qty: b.issuedQty, unit: b.unit, from: loads[0].lot.location, to: b.site, checks: b.checks, document,
    moves: loads.flatMap(({ lot, qty }) => [stockMove(lot, -qty), processStockMove(b, lot.id, qty)]),
  });
  track(b, e, 'Issue', day);
  wo.status = 'In progress';
  return b;
}

export function recordPrintOperation(s, x, ctx) {
  const b = openBatch(s, x.batchId, choice(ref(s.processBatches, x.batchId)?.process, [PRINTING, EMBROIDERY], 'embellishment batch'));
  const embroidery = b.process === EMBROIDERY;
  const wo = batchWork(s, b);
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Production log reference');
  const run = x.runId ? record(b.runs, x.runId, 'print run') : null;
  const line = b.lines.find(row => row.lotId === (run?.lotId || x.lotId));
  ensure(line, 'Choose an input lot on this batch.');
  const op = run ? b.artwork.aftercare[run.aftercare.length] : embroidery ? EMBROIDERY : 'Print';
  ensure(op && (!x.operation || x.operation === op), op ? 'Record ' + op + ' next for this run.' : 'This print run has completed its post-print treatments.');
  const qty = run?.qty ?? quantity(x.qty, 'Quantity printed in stock units', b.unit);
  ensure(run || qty <= unprintedQty(b, line), 'Quantity exceeds the unprinted balance of ' + unprintedQty(b, line) + ' ' + b.unit + ' on ' + line.lotId + '.');
  const lot = record(s.lots, line.lotId, 'source lot');
  const needs = schemesOf(wo);
  checkLotClaims(s, lot, needs);
  verifyProcessEvidence(s, [...b.checks, ...(run?.checks ?? []), ...(run?.aftercare ?? []).flatMap(step => step.checks)]);
  const machine = b.jobId ? null : record(s.machines, x.machineId, 'operation machine');
  ensure(!machine || machine.status === 'In service' && location(s, machine.locationId).site === b.site, 'Choose an in-service machine at the work order site.');
  const machineName = machine?.name || req(x.machine, 'Processor machine ID or name');
  const inkBatch = embroidery ? '' : run?.inkBatch || req(x.inkBatch, 'Ink, paste or transfer batch');
  const chemicals = embroidery ? [] : readProcessChemicals(s, b, x, day, needs, !run);
  const supplies = embroidery ? readProcessChemicals(s, b, { chemicals: x.supplies }, day, needs, false, ['Thread', 'Backing', 'Trim']) : [];
  ensure(!embroidery || supplies.some(row => row.material === 'Thread'), 'Record the actual embroidery thread lot.');
  const heads = embroidery ? quantity(x.heads, 'Active embroidery heads', 'pcs') : null;
  const stitches = embroidery && x.stitches ? quantity(x.stitches, 'Stitch count per piece', 'pcs') : null;
  const checks = checkProcessScope(s, wo, b, [{ lot, qty }], day, {
    consume: !b.jobId && !run, material: source => outputMaterial(b.stage, source), chemicals: chemicals.map(c => c.code),
    noChemicals: !chemicals.length, requireChemicalDeclaration: true,
  });
  const settings = run ? req(x.settings, 'Actual ' + op.toLowerCase() + ' conditions or cycle reference', 1000) : clean(x.settings, 1000);
  const moves = issueProcessChemicals(s, [...chemicals, ...supplies], day, wo.lineId);
  const e = post(s, embroidery ? 'Embroidery run' : run ? 'Print treatment' : 'Print run', ctx, {
    ...eventBatch(b), date: day, operation: op, runId: run?.id || '', reference, inkBatch, qty, unit: b.unit, lotIds: [lot.id], machineName,
    machineId: machine?.id || '', settings, chemicals, supplies, heads, stitches, checks, moves, document: ctx.document(x.document, [documentBucket(b)]),
  });
  const logged = { id: e.id, operation: op, date: day, reference, lotId: lot.id, machineName, machineId: e.machineId, settings, chemicals, supplies, heads, stitches, checks };
  if (run) run.aftercare.push(logged);
  else {
    e.runId = e.id;
    b.runs.push({ ...logged, inkBatch, qty, remaining: qty, aftercare: [] });
  }
  b.status = 'In process';
  track(b, e, op, day);
  return b;
}

export function receivePrintOutput(s, x, ctx) {
  const b = openBatch(s, x.batchId, choice(ref(s.processBatches, x.batchId)?.process, [PRINTING, EMBROIDERY], 'embellishment batch'));
  const field = decorationKey(b);
  const embroidery = b.process === EMBROIDERY;
  const wo = batchWork(s, b);
  const day = postingDate(b, x.date);
  const unused = x.unused === 'yes';
  const run = unused ? null : record(b.runs, x.runId, 'print run for this return');
  const line = b.lines.find(row => row.lotId === (run?.lotId || x.lotId));
  ensure(line, 'Choose the original input lot on this batch.');
  const reference = req(x.reference, b.jobId ? 'Inward challan or loss reference' : 'Output reference');
  ensure(!s.events.some(e => e.batchId === b.id && e[field] && e[field].runId === (run?.id || '') &&
    e.inputs[0].id === line.lotId && norm(e.reference) === norm(reference)), 'This reference is already posted for this print run or unused lot.', 409, 'duplicate');
  ensure(!run || run.aftercare.length === b.artwork.aftercare.length, 'Record ' + b.artwork.aftercare.slice(run?.aftercare.length).join(' and ') + ' before receiving these prints.');
  const outstanding = run?.remaining ?? unprintedQty(b, line);
  const used = quantity(x.used, 'Quantity reconciled in ' + b.unit, b.unit);
  ensure(used <= outstanding && used <= lineRemaining(line), 'Quantity exceeds the outstanding ' + outstanding + ' ' + b.unit + ' on this run or unprinted lot.');
  const source = record(s.lots, line.lotId, 'original input lot');
  const dest = location(s, x.locationId || b.locationId);
  ensure(dest.site === wo.site, 'Post returned stock at the work order site.');
  const waste = unused ? 0 : quantity(x.waste || '0', 'Print waste', b.unit, true);
  const parts = unused ? [{ kind: 'Unused', code: lotKey(s, x.unusedId), qty: used }]
    : csvLines(x.outputs, 'Print output lot', 3, 5).map(([kind, lotId, qty, netKg, lengthM]) => ({
      kind: choice(kind, ['Accepted', embroidery ? 'Rework' : 'Misprint', 'Rejected'], 'embellishment disposition'), code: lotKey(s, lotId),
      qty: quantity(qty, 'Output quantity for ' + lotId, b.unit), netKg, lengthM,
    }));
  ensure(new Set(parts.map(part => norm(part.code))).size === parts.length, 'Use a different lot ID for each print output.');
  const received = sum(parts);
  const adjustment = unused || !x.adjustment ? 0 : number(x.adjustment, 'Measured stock-unit adjustment', -1e8, 1e8);
  ensure(waste <= used && (!adjustment || received > 0 && used > waste && !DISCRETE.includes(b.unit)) &&
    round(used + adjustment) === round(received + waste), 'Reconcile issued ' + b.unit + ' with returned quantities and waste. Changes in count require a waste quantity.');
  const reason = adjustment || waste || parts.some(part => ['Misprint', 'Rework', 'Rejected'].includes(part.kind)) ? req(x.notes, 'Disposition or variance reason') : clean(x.notes);
  const accepted = sum(parts.filter(part => part.kind === 'Accepted'));
  const completed = round(wo.completedQty + accepted);
  ensure(completed <= wo.plannedQty, 'Accepted output exceeds the printing work order plan.');
  const checks = run ? [...b.checks, ...run.checks, ...run.aftercare.flatMap(step => step.checks)] : source.checks ?? [];
  const chemicals = run ? [...run.chemicals, ...(run.supplies ?? []), ...run.aftercare.flatMap(step => step.chemicals)].filter(row => row.lotId) : [];
  let holdReason = '';
  try {
    checkLotClaims(s, source, schemesOf(wo));
    for (const c of chemicals) checkHistory(s, record(s.lots, c.lotId, 'chemical lot'));
    verifyProcessEvidence(s, checks);
  } catch (error) {
    if (error.code !== 'standard-lock') throw error;
    holdReason = error.message;
  }
  let inputLeft = round(used - waste);
  const lots = parts.map((part, i) => {
    const parentQty = i === parts.length - 1 ? inputLeft : Math.min(inputLeft, round((used - waste) * part.qty / received));
    inputLeft = round(inputLeft - parentQty);
    const material = unused ? source.material : outputMaterial(b.stage, source);
    const allocation = lotAllocations(s, '', b.unit, part.qty, wo.lineId);
    const weights = measures({ netKg: part.netKg || (source.netKg ? inUnit(source, parentQty, 'kg') : ''), lengthM: part.lengthM ||
      (source.lengthM ? inUnit(source, parentQty, 'm') : '') }, part.qty, b.unit);
    const printing = unused && source[field] ? { ...source[field], unusedReturnBatchId: b.id, unusedReturnRef: reference }
      : { artworkId: b.artwork.id, artworkRevision: b.artwork.version, batchId: b.id, runId: run?.id || '', sourceLotId: source.id,
      disposition: part.kind, reference, inkBatch: run?.inkBatch || '' };
    return newLot(s, part.code, part.qty, b.unit, day, dest, {
      material, itemId: material === source.material ? source.itemId : '',
      label: unused ? source.label : (part.kind === 'Accepted' ? embroidery ? 'Embroidered' : 'Printed' : part.kind) + ' · ' + (source.label || source.material),
      stage: unused ? source.stage : b.stage, ownerId: source.ownerId, composition: source.composition,
      origin: unused ? source.origin : b.site, originCountry: source.originCountry,
      workOrderId: wo.id, batchId: b.id, [embroidery ? 'embroideryBatchId' : 'printBatchId']: printing.batchId, jobId: b.jobId, processorId: b.processorId,
      scheme: unused ? source.scheme : wo.scheme, additionalSchemes: unused ? source.additionalSchemes : wo.additionalSchemes,
      qualityStatus: unused ? source.qualityStatus : part.kind === 'Rework' ? 'Rework' : dispositions[part.kind], checks, standardHold: Boolean(holdReason), holdReason,
      allocations: allocation, allocationBalance: structuredClone(allocation), ...weights,
      parents: [{ id: source.id, qty: parentQty, unit: b.unit, role: embroidery ? 'Embroidery input' : 'Print input' },
        ...parentLinks([], chemicals, [], run ? parentQty / run.qty : 0)],
      ...(source.panel ? { panel: { ...source.panel, ...(part.qty === source.initialQty && parentQty === source.initialQty ? {} : {
        sourceFirst: source.panel.first ?? source.panel.sourceFirst, sourceLast: source.panel.last ?? source.panel.sourceLast, first: null, last: null,
      }) } } : {}),
      ...(source.printing && embroidery ? { printing: source.printing, printBatchId: source.printBatchId } : {}),
      ...(source.embroidery && !embroidery ? { embroidery: source.embroidery, embroideryBatchId: source.embroideryBatchId } : {}),
      [field]: printing,
    });
  });
  if (run) {
    run.remaining = round(run.remaining - used);
    line.consumed = round(line.consumed + used);
    b.acceptedQty = round(b.acceptedQty + accepted);
    b.misprintQty = round(b.misprintQty + sum(parts.filter(row => ['Misprint', 'Rework'].includes(row.kind))));
    b.rejectedQty = round(b.rejectedQty + sum(parts.filter(row => row.kind === 'Rejected')));
    b.wasteQty = round(b.wasteQty + waste);
    b.returnedQty = round(b.returnedQty + received);
    wo.completedQty = completed;
    wo.status = completed === wo.plannedQty ? 'Completed' : 'In progress';
  } else {
    line.returned = round(line.returned + used);
    b.unusedQty = round(b.unusedQty + used);
  }
  b.remainingQty = sum(b.lines, lineRemaining);
  const job = ref(s.jobs, b.jobId);
  if (job) Object.assign(job, {
    qty: b.remainingQty, processed: round(b.issuedQty - b.remainingQty - b.unusedQty - b.wasteQty),
    returnedQty: b.returnedQty, acceptedQty: b.acceptedQty, misprintQty: b.misprintQty, rejectedQty: b.rejectedQty,
    unused: b.unusedQty, loss: b.wasteQty, status: b.remainingQty ? 'Part returned' : 'Reconciled', lastDate: day,
  });
  const kind = unused ? 'Unused return' : job ? received ? 'Processed return' : 'Process loss' : 'Production';
  const e = post(s, kind, ctx, {
    ...eventBatch(b), date: day, type: b.rework ? 'Rework' : 'Run', reference, qty: unused || job ? received || used : accepted, unit: b.unit,
    output: lots.find(lot => lot[field].disposition === 'Accepted')?.id || lots[0]?.id || '', lotIds: lots.map(lot => lot.id),
    inputs: [{ id: source.id, qty: used, unit: b.unit }], [field]: { runId: run?.id || '', outputs: parts, reason, outstanding: b.remainingQty },
    reconciliation: { input: used, accepted, waste, rejects: sum(parts.filter(row => row.kind === 'Rejected')),
      misprints: sum(parts.filter(row => row.kind === 'Misprint')), rework: sum(parts.filter(row => row.kind === 'Rework')), adjustment, reference: reason, unit: b.unit },
    allocations: accepted ? lotAllocations(s, '', b.unit, accepted, wo.lineId) : [],
    machineName: run?.machineName || '', checks, document: ctx.document(x.document, [documentBucket(b)]),
    moves: [processStockMove(b, source.id, -used), ...lots.map(lot => stockMove(lot, lot.qty))],
  });
  for (const lot of lots) lot.eventId = e.id;
  track(b, e, unused ? 'Unused return' : 'Output', day);
  if (!b.remainingQty) b.status = 'Closed';
  return b;
}
