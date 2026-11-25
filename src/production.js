import {
  STAGES, UNITS, ROUTES, WASH_STAGES, PRINT_STAGES, choice, clean, csvLines, id, date, quantity, decimal, number, round, sum, req, unique, ref, record, ensure, close, genealogy,
} from './model.js';
import { location, schemesOf, party, extraSchemes } from './commerce.js';
import { checkEvidence, checkLotClaims, checkHistory, schemeNames } from './standards.js';
import { usable, lotKey, takeStock, newLot, lotAllocations, post, stockMove, measures, inUnit, checkDate } from './stock.js';
import { checkClaimRules, chemicalCodes, componentCodes, declaredChemicals } from './claim-scope.js';
import { checkRouteStep, routeSnapshot } from './routes.js';
import { useAssignments } from './yarn-allocation.js';

const balanceUnits = ['kg', 'g', 'm', 'cm', 'pcs', 'bale', 'roll', 'cone', 'L'];

export function releaseWork(s, x, ctx) {
  const number = req(x.number, 'Work order number');
  unique(s.workOrders, 'number', number, 'This work order number already exists.');
  const routeLine = x.componentRouteId ? ref(s.componentRoutes, x.componentRouteId)?.lineId : '';
  const line = x.lineId || routeLine ? record(s.lines, x.lineId || routeLine, 'PO line') : null;
  const stage = choice(x.stage, Object.keys(STAGES), 'operation');
  const artwork = x.printArtworkId ? record(s.processSetups, x.printArtworkId, 'approved artwork') : null;
  ensure(!PRINT_STAGES.includes(stage) || artwork, 'Release printing work orders from Manufacturing → Printing with approved artwork.');
  ensure(!WASH_STAGES.includes(stage) || line, 'Select the approved buyer PO line for washing.');
  // A component route pins the approved fabric route and BOM revision for this component.
  const componentRoute = x.componentRouteId ? record(s.componentRoutes, x.componentRouteId, 'approved component route') : null;
  if (componentRoute) {
    ensure(line && componentRoute.lineId === line.id, 'Choose a component route approved for the selected PO line.');
    ensure(componentRoute.status === 'Approved', 'Route ' + componentRoute.id + ' is ' + componentRoute.status.toLowerCase() + '. Use the current approved route.');
    ensure(line.status === 'Approved' && componentRoute.stages.includes(stage), 'Select an operation on approved route ' + componentRoute.template + ' for ' + componentRoute.component + '.');
  } else if (line) ensure(line.status === 'Approved' && line.stages.includes(stage), 'Approve the PO line and select an operation on its route.');
  const techComponent = componentRoute ? componentRoute.component : clean(x.techComponent, 64).toUpperCase();
  if (techComponent && !componentRoute) {
    const component = line?.garmentSpec?.fabrics.find(row => row.code === techComponent);
    ensure(component, 'Select a fabric component from the approved tech pack.');
    ensure(['Weaving', 'Knitting', 'Fabric dyeing', 'Fabric washing', 'Fabric printing', 'Fabric finishing', 'Fabric inspection', 'Cutting'].includes(stage), 'Choose a fabric operation for this component.');
    const requiredType = { Weaving: 'Woven', Knitting: 'Knitted' }[stage];
    ensure(!requiredType || component.construction?.type === requiredType, 'Use a ' + requiredType?.toLowerCase() + ' component for ' + stage + '.');
  }
  const unit = artwork ? choice(x.unit || (stage === 'Fabric printing' ? 'm' : 'pcs'),
    stage === 'Fabric printing' ? ['kg', 'g', 'm', 'cm', 'roll'] : ['Printing', 'Embroidery'].includes(stage) ? ['pcs', 'bundle'] : ['pcs'], 'embellishment stock unit')
    : STAGES[stage].count ? 'pcs' : choice(x.unit, UNITS, 'planned output unit');
  const dest = location(s, x.locationId);
  const day = date(x.date);
  ensure(!artwork || ['Printing', 'Embroidery'].includes(artwork.process) && artwork.stage === stage && artwork.status === 'Approved' &&
    artwork.lineId === line?.id && artwork.lineRevision === line.revision && artwork.effective <= day &&
    (artwork.componentRoute?.id || '') === (componentRoute?.id || ''), 'Use the approved artwork for this PO revision, placement and route.');
  const finishPlan = x.finishPlanId ? record(s.processSetups, x.finishPlanId, 'approved finishing plan') : null;
  ensure(!finishPlan || stage === 'Fabric finishing' && finishPlan.process === stage && finishPlan.status === 'Approved' &&
    finishPlan.effective <= day && finishPlan.lineId === line?.id && finishPlan.lineRevision === line.revision &&
    finishPlan.component === techComponent && (finishPlan.route.componentRoute?.id || '') === (componentRoute?.id || ''),
  'Use an approved finishing plan for this PO revision, route and component.');
  const due = date(x.due, day);
  ensure(due >= day, 'Due date must follow release date.');
  const scheme = line?.scheme ?? choice(x.scheme || 'Conventional', schemeNames(s), 'work order standard');
  const row = {
    id: id(s, 'WO'), number, stage, plannedQty: quantity(x.plannedQty, 'Planned output quantity', unit), unit,
    lineId: line?.id || '', lineRevision: line?.revision ?? null,
    route: componentRoute ? componentRoute.legacy : line?.route || '', stages: componentRoute ? [...componentRoute.stages] : line?.stages || [], techComponent,
    componentRoute: componentRoute ? routeSnapshot(componentRoute) : null,
    revisionPins: line ? { spec: line.specRev, bom: componentRoute?.bomRev ?? line.bomRev, costing: line.costRev } : null,
    locationId: dest.id, site: dest.site, date: day, due, status: 'Released', completedQty: 0,
    scheme, additionalSchemes: line?.additionalSchemes ?? extraSchemes(s, x.additionalSchemes, scheme),
    ...(finishPlan ? { finishPlanId: finishPlan.id } : {}),
    ...(artwork ? { printArtworkId: artwork.id } : {}),
    rework: x.rework === 'yes', recipe: clean(x.recipe), notes: clean(x.notes),
    document: ctx.document(x.document, ['production']),
  };
  s.workOrders.push(row);
  return row;
}

export function releaseFinishWork(s, x, ctx) {
  const plan = record(s.processSetups, x.recipeId, 'approved finishing plan');
  ensure(plan.process === 'Fabric finishing', 'Choose an approved finishing plan.');
  return releaseWork(s, { ...x, stage: 'Fabric finishing', unit: 'kg', lineId: plan.lineId, techComponent: plan.component,
    componentRouteId: plan.route.componentRoute?.id || '', finishPlanId: plan.id, recipe: plan.code + ' r' + plan.version }, ctx);
}

export function releasePrintWork(s, x, ctx) {
  const artwork = record(s.processSetups, x.artworkId, 'approved print artwork');
  ensure(['Printing', 'Embroidery'].includes(artwork.process), 'Choose approved artwork for this embellishment work order.');
  return releaseWork(s, { ...x, stage: artwork.stage, lineId: artwork.lineId, componentRouteId: artwork.componentRoute?.id || '',
    printArtworkId: artwork.id, recipe: artwork.code + ' r' + artwork.version }, ctx);
}

export function closeWork(s, x, ctx) {
  const wo = record(s.workOrders, x.workOrderId, 'work order');
  ensure(['Released', 'In progress'].includes(wo.status), 'Choose an open work order.');
  ensure(!s.processBatches.some(b => b.process === 'Washing' && b.workOrderId === wo.id && b.remainingQty > 0),
    'Reconcile the outstanding stock on this work order’s wash batches before closing.');
  ensure(!s.processBatches.some(b => ['Printing', 'Embroidery'].includes(b.process) && b.workOrderId === wo.id && b.remainingQty > 0),
    'Reconcile embellishment stock in the batch or at the processor before closing.');
  ensure(!s.processBatches.some(b => ['Cutting', 'Stitching', 'Garment finishing'].includes(b.process) && b.workOrderId === wo.id &&
    b.lines.some(line => round(line.issued - line.consumed - line.returned) > 0)), 'Reconcile stock still held in production before closing the work order.');
  ensure(!s.processBatches.some(b => b.process === 'Fabric finishing' && b.workOrderId === wo.id && b.lines.some(line =>
    round(line.issuedKg - line.consumedKg - line.returnedKg) > 0)), 'Reconcile the fabric still held in the finishing batches before closing.');
  wo.status = wo.completedQty > 0 ? 'Closed short' : 'Cancelled';
  wo.closeReason = req(x.notes, 'Closure reason');
  wo.closedBy = ctx.actor;
  return wo;
}

function validateRoute(wo, actual, s) {
  if (!wo.stages.length || wo.rework) return;
  const primary = actual.filter(a => a.primary);
  const yarn = wo.route.startsWith('Yarn-dyed') ? 'Dyed yarn' : wo.route.startsWith('Fabric-dyed') ? 'Yarn' : null;
  if (yarn && ['Knitting', 'Weaving', 'Warping'].includes(wo.stage)) {
    for (const { lot } of primary) {
      ensure(lot.material === 'Warp beam' || lot.material === yarn, wo.route + ' requires ' + yarn + ' at ' + wo.stage + '.');
      if (lot.material === 'Warp beam' && lot.parents.length) {
        ensure(lot.parents.map(p => ref(s.lots, p.id)).filter(l => ['Yarn', 'Dyed yarn'].includes(l?.material)).every(l => l.material === yarn), 'Warp beam yarn is incompatible with the route.');
      }
    }
  }
  if (wo.stage === 'Fabric finishing' && wo.route.startsWith('Fabric-dyed')) {
    ensure(primary.every(a => a.lot.material === 'Dyed fabric'), 'The fabric-dyed route requires a posted fabric dye batch before finishing.');
  }
  if (wo.stage === 'Fabric finishing' && wo.route.startsWith('Yarn-dyed')) {
    ensure(primary.every(a => a.lot.material === 'Greige fabric'), 'Use fabric made from the approved dyed yarns on this route.');
  }
  const formingStage = wo.route.endsWith('woven') ? 'Weaving' : wo.route.endsWith('knitted') ? 'Knitting' : '';
  if (formingStage && ['Fabric dyeing', 'Fabric finishing', 'Fabric inspection', 'Cutting'].includes(wo.stage)) {
    for (const { lot } of primary) {
      const formation = [lot, ...genealogy(s, lot.id)].filter(n => ['Weaving', 'Knitting'].includes(n.stage));
      ensure(formation.every(n => n.stage === formingStage), 'The recorded fabric formation for ' + lot.id + ' does not match the work order route.');
    }
  }
}

function balance(sources, output, x, lossOnly = false) {
  const unit = choice(x.balanceUnit || sources[0].lot.unit, balanceUnits, 'reconciliation unit');
  const input = sum(sources, a => inUnit(a.lot, a.qty, unit));
  const waste = quantity(x.waste || '0', 'Waste', unit, true);
  const rejects = quantity(x.rejects || '0', 'Rejects', unit, true);
  const adjustment = x.adjustment ? number(x.adjustment, 'Measured adjustment', -1e8, 1e8) : 0;
  const reference = adjustment ? req(x.adjustmentRef, 'Measured adjustment basis or reference') : '';
  const accepted = lossOnly ? 0 : inUnit(output, output.initialQty, unit);
  ensure(!adjustment || unit === 'kg' || unit === 'm' || unit === 'g' || unit === 'cm', 'Use a continuous unit for measured adjustments.');
  ensure(close(round(input + adjustment), round(accepted + waste + rejects)), 'Reconcile ' + input + ' ' + unit + ' issued with ' + accepted + ' ' + unit + ' accepted, waste and rejects.');
  return { unit, input, accepted, waste, rejects, adjustment, reference };
}

function allocationGuard(s, wo, rows, used, out) {
  const needs = schemesOf(wo);
  const ownerId = out.ownerId;
  for (const row of rows) {
    const line = record(s.lines, row.lineId, 'PO line');
    ensure((line.stages.includes(wo.stage) || line.id === wo.lineId && wo.componentRoute?.stages.includes(wo.stage)) && JSON.stringify(schemesOf(line)) === JSON.stringify(needs), 'The operation route or claim does not match PO line ' + line.id + '.');
    if (ownerId) ensure(record(s.orders, line.orderId, 'buyer PO').buyerId === ownerId, 'The material belongs to another customer.');
  }
  const main = used.filter(row => row.primary);
  if (main.some(row => row.lot.unit !== out.unit)) return;
  let unallocated = sum(main, row => row.qty - sum(row.allocations));
  for (const row of rows) {
    const carried = sum(main.flatMap(x => x.allocations).filter(a => a.lineId === row.lineId));
    unallocated = round(unallocated - Math.max(0, row.qty - carried));
    ensure(unallocated >= 0, 'Issued units do not cover the output allocated to ' + row.lineId + '.');
  }
  // An order-specific input must carry through all accepted units that cannot come from general stock.
  const issuedFree = sum(main, row => row.qty - sum(row.allocations));
  ensure(out.qty - sum(rows) <= issuedFree, 'Allocate the remaining output to the same PO lines carried by the inputs.');
}

function requireCuttingRelease(s, lot) {
  if (lot.material !== 'Finished fabric') return;
  const released = [lot, ...genealogy(s, lot.id)].some(row => row.material === 'Finished fabric' &&
    ref(s.events, row.inspectionId)?.decision === 'Released');
  ensure(released && lot.qualityStatus === 'Released', 'Release finished roll ' + lot.id + ' through Quality before issuing it to cutting.');
}

function requireApprovedPrinting(s, wo, lot, day) {
  const operationIndex = wo.stages.indexOf(wo.stage);
  if (operationIndex < 1 || wo.rework) return;
  const placements = wo.stages.slice(0, operationIndex).filter(stage => PRINT_STAGES.includes(stage));
  let trail;
  for (const stage of placements) {
    const approvals = s.processSetups.filter(a => a.process === 'Printing' && a.stage === stage && a.lineId === wo.lineId &&
      a.lineRevision <= wo.lineRevision && a.effective <= day);
    if (stage === 'Printing' && Object.hasOwn(ROUTES, wo.route) && !approvals.length) continue;
    trail ??= [lot, ...genealogy(s, lot.id)];
    const matched = trail.some(row => row.stage === stage && (row.printing ? row.printing.disposition === 'Accepted' &&
      (!approvals.length || approvals.some(a => a.id === row.printing.artworkId)) : !approvals.length));
    ensure(matched && !['Misprint', 'Rejected'].includes(lot.printing?.disposition),
      'Post accepted ' + (stage === 'Printing' ? 'cut-panel printing' : stage.toLowerCase()) + ' for ' + lot.id + ' before ' + wo.stage + '.', 422, 'route-skip');
  }
}

export function production(s, x, ctx) {
  const wo = record(s.workOrders, x.workOrderId, 'work order');
  ensure(['Released', 'In progress'].includes(wo.status), 'Choose an open work order.');
  ensure(!WASH_STAGES.includes(wo.stage), 'Post wash activity in Manufacturing → Washing.');
  ensure(!PRINT_STAGES.includes(wo.stage), 'Post print runs and outputs in Manufacturing → Printing.');
  ensure(!(wo.stage === 'Embroidery' && (wo.printArtworkId || s.processSetups.some(p => p.process === 'Embroidery' && p.lineId === wo.lineId))),
    'Post embroidery jobs under Manufacturing → Embroidery.');
  ensure(!['Cutting', 'Stitching', 'Garment finishing', 'Packing'].includes(wo.stage) ||
    !s.processSetups.some(p => p.process === wo.stage && (p.lineId === wo.lineId || wo.stage === 'Packing' && p.orderId === ref(s.lines, wo.lineId)?.orderId)),
  'Use the approved ' + wo.stage.toLowerCase() + ' plan to post this operation.');
  ensure(!wo.finishPlanId, 'Post the approved finishing sequence and rolls in Manufacturing → Fabric finishing.');
  const config = STAGES[wo.stage];
  const day = date(x.date);
  ensure(day >= wo.date, 'Production cannot precede work order release.');
  const dest = location(s, x.locationId || wo.locationId);
  ensure(dest.site === wo.site, 'Post output at the work order site.');
  const code = lotKey(s, x.outputId);
  const rows = csvLines(x.inputs, 'Issued lot', 2);
  ensure(rows.length > 0, 'Enter the actual input lot IDs and quantities.');
  const outQty = quantity(x.outputQty, 'Accepted output', wo.unit);
  ensure(round(wo.completedQty + outQty) <= wo.plannedQty, 'Output exceeds the work order plan. Release another work order for the excess.');
  const needs = schemesOf(wo);
  const actual = rows.map(([lotId, amount]) => {
    const lot = record(s.lots, lotId, 'input lot ' + lotId);
    const primary = config.primary.includes(lot.material) || wo.rework;
    ensure(primary || config.auxiliary?.includes(lot.material), 'Lot ' + lot.id + ' is incompatible with ' + wo.stage + '.');
    if (wo.stage === 'Cutting' && !wo.rework) requireCuttingRelease(s, lot);
    usable(s, lot, day, wo.rework);
    ensure(lot.site === wo.site, 'Transfer lot ' + lot.id + ' to ' + wo.site + ' before issuing.');
    checkLotClaims(s, lot, needs, !primary);
    if (primary) requireApprovedPrinting(s, wo, lot, day);
    return { lot, qty: quantity(amount, 'Issued quantity for ' + lot.id, lot.unit), primary };
  });
  ensure(new Set(actual.map(a => a.lot.id)).size === actual.length && actual.some(a => a.primary), 'Use unique lots and include a primary material input.');
  validateRoute(wo, actual, s);
  const primary = actual.filter(a => a.primary);
  checkRouteStep(wo, primary.map(a => a.lot));
  if (!wo.componentRoute && !wo.rework && WASH_STAGES.includes(wo.stages[wo.stages.indexOf(wo.stage) - 1])) {
    for (const { lot } of primary) checkRouteStep({ ...wo, componentRoute: { name: wo.route, template: wo.route, stages: wo.stages } }, [lot]);
  }
  if (config.preserve && !wo.rework) ensure(new Set(primary.map(a => a.lot.material)).size === 1, wo.stage + ' keeps the input material. Issue one material type per run.');
  if (wo.rework) {
    ensure(new Set(primary.map(a => a.lot.material)).size === 1 && new Set(primary.map(a => a.lot.stage)).size === 1, 'Rework requires lots of the same material and prior stage.');
  } else if (wo.stage === 'Weaving') {
    ensure(primary.some(a => a.lot.material === 'Warp beam') && primary.some(a => ['Yarn', 'Dyed yarn'].includes(a.lot.material)), 'Weaving needs a warp beam and actual weft yarn.');
  } else if (wo.stage === 'Packing') {
    ensure(sum(actual.filter(a => a.lot.material === 'Carton' && ['carton', 'pcs'].includes(a.lot.unit))) === 1, 'Issue exactly one carton from packaging stock for each carton lot.');
  }
  const ownerIds = new Set(primary.map(a => a.lot.ownerId));
  ensure(ownerIds.size === 1 && actual.every(a => !a.lot.ownerId || ownerIds.has(a.lot.ownerId)), 'Keep different customer and company owned stock in separate lots.');
  const ownerId = primary[0].lot.ownerId;
  if (ownerId && wo.lineId) {
    ensure(record(s.orders, record(s.lines, wo.lineId, 'PO line').orderId, 'buyer PO').buyerId === ownerId, 'The linked order does not own the supplied material.');
  }
  const item = x.itemId ? record(s.items, x.itemId, 'output item') : null;
  const material = wo.rework || config.preserve ? primary[0].lot.material : config.output;
  ensure(!item || (item.type === material && item.unit === wo.unit), 'The output item must match the operation’s material and unit.');
  const allocated = lotAllocations(s, x.allocations, wo.unit, outQty, wo.lineId);
  if (wo.stage === 'Packing') ensure(sum(allocated) === outQty, 'Allocate the entire carton to approved PO lines at packing.');
  const lineIds = [wo.lineId, ...allocated.map(row => row.lineId)].filter(Boolean);
  const issuedLots = actual.map(row => row.lot);
  const scoped = checkClaimRules(s, { lineIds, operation: wo.stage, itemId: item?.id, holder: s.settings.name, site: wo.site, on: day,
    chemicals: chemicalCodes(s, issuedLots), components: componentCodes(s, issuedLots) });
  const checks = [...checkEvidence(s, {
    schemes: needs, role: 'Processor', name: s.settings.name, site: wo.site, operation: wo.stage,
    material, on: day, amount: outQty, unit: wo.unit, consume: true, subject: item?.code || ref(s.lines, wo.lineId)?.sku,
  }), ...scoped];
  const machine = x.machineId ? record(s.machines, x.machineId, 'machine') : null;
  ensure(!machine || (machine.status === 'In service' && location(s, machine.locationId).site === wo.site), 'Select an active machine at this site.');
  const reading = x.readingId ? record(s.readings, x.readingId, 'meter reading') : null;
  ensure(!reading || (machine && reading.machineId === machine.id && !reading.eventId && reading.verified && reading.date === day), 'Use a verified, unused reading for the same machine and run date.');
  const out = newLot(s, code, outQty, wo.unit, day, dest, {
    material, label: clean(x.label, 120) || item?.name || material, itemId: item?.id || '', ownerId,
    stage: wo.rework ? primary[0].lot.stage : wo.stage, workOrderId: wo.id,
    scheme: wo.scheme, additionalSchemes: wo.additionalSchemes, checks,
    qualityStatus: config.inspection || wo.rework || x.inspect === 'yes' ? 'Pending inspection' : 'Released',
    allocations: allocated, allocationBalance: structuredClone(allocated),
    composition: clean(x.composition) || item?.composition || primary[0].lot.composition || '',
    ...measures(x, outQty, wo.unit),
  });
  const reconciliation = balance(primary, out, x);
  for (const row of primary) useAssignments(s, wo, row.lot, row.qty);
  const eligible = new Set([wo.lineId, ...allocated.map(a => a.lineId)].filter(Boolean));
  for (const row of actual) {
    row.allocations = takeStock(row.lot, row.qty, day, eligible, allocated.map(a => a.lineId));
  }
  allocationGuard(s, wo, allocated, actual, out);
  const parents = actual.map(({ lot, qty, allocations, primary }) => ({ id: lot.id, qty, unit: lot.unit, allocations, role: primary ? 'Primary' : 'Process input' }));
  out.parents = parents;
  const e = post(s, 'Production', ctx, {
    date: day, stage: wo.stage, type: wo.rework ? 'Rework' : 'Run', workOrderId: wo.id, lineRevision: wo.lineRevision,
    inputs: parents, output: out.id, qty: outQty, unit: wo.unit, site: wo.site,
    allocations: allocated, reconciliation, reference: req(x.reference, 'Production run or job sheet reference'),
    recipe: clean(x.recipe) || wo.recipe, shift: clean(x.shift, 80), operator: clean(x.operator, 100),
    machineId: machine?.id || '', machineName: machine?.name || '', readingId: reading?.id || '',
    labourHours: decimal(x.labourHours || '0', 'Labour hours'), machineHours: decimal(x.machineHours || '0', 'Machine hours'),
    electricity: reading?.unit === 'kWh' ? reading.qty : decimal(x.electricity || '0', 'Electricity kWh'),
    water: reading?.unit === 'L' ? reading.qty : decimal(x.water || '0', 'Water litres'),
    checks, moves: [...actual.map(a => stockMove(a.lot, -a.qty)), stockMove(out, outQty)],
    document: ctx.document(x.document, ['production']),
  });
  if (reading) reading.eventId = e.id;
  out.eventId = e.id;
  wo.completedQty = round(wo.completedQty + outQty);
  wo.status = wo.completedQty === wo.plannedQty ? 'Completed' : 'In progress';
  return out;
}

export function openJob(s, x, ctx) {
  const lot = record(s.lots, x.lotId, 'lot');
  const processor = party(s, x.processorId, 'Processor');
  const site = req(x.site, 'Processor site');
  const stage = choice(x.stage, Object.keys(STAGES), 'outside operation');
  ensure(!WASH_STAGES.includes(stage), 'Send commission wash batches in Manufacturing → Washing.');
  ensure(!PRINT_STAGES.includes(stage), 'Send commission print batches in Manufacturing → Printing.');
  ensure(STAGES[stage].primary.includes(lot.material), 'The source material does not match the outside operation.');
  if (stage === 'Cutting') requireCuttingRelease(s, lot);
  const day = date(x.date);
  usable(s, lot, day);
  const qty = quantity(x.qty, 'Sent quantity', lot.unit);
  const number = req(x.number, 'Outward challan');
  unique(s.jobs, 'number', number, 'An outside job already uses this challan.');
  const line = x.lineId ? record(s.lines, x.lineId, 'PO line') : null;
  if (line) {
    ensure(line.status === 'Approved' && line.stages.includes(stage), 'The PO line must be approved for the outside operation.');
    ensure(stage !== 'Embroidery' || !s.processSetups.some(p => p.process === 'Embroidery' && p.lineId === line.id), 'Issue this commission job under Manufacturing → Embroidery.');
    requireApprovedPrinting(s, { ...line, lineId: line.id, lineRevision: line.revision, stage }, lot, day);
  }
  const scoped = checkClaimRules(s, { lineIds: [line?.id], operation: stage, holder: processor.name, itemId: lot.itemId, site, on: day,
    chemicals: chemicalCodes(s, [lot]), components: componentCodes(s, [lot]) });
  const checks = [...checkEvidence(s, {
    schemes: schemesOf(lot), role: 'Processor', partyId: processor.id, name: processor.name, site, operation: stage,
    material: STAGES[stage].output, on: day, amount: qty, unit: lot.unit, consume: true, subject: line?.sku || ref(s.items, lot.itemId)?.code,
    tx: { seller: s.settings.name, buyer: processor.name, shipment: number },
  }), ...scoped];
  if (line) checkLotClaims(s, lot, schemesOf(line));
  const eligible = new Set(line ? [line.id] : []);
  const allocated = takeStock(lot, qty, day, eligible);
  const job = {
    id: id(s, 'JOB'), number, lotId: lot.id, processorId: processor.id, processor: processor.name, site, stage,
    date: day, lastDate: day, sent: qty, qty, unit: lot.unit, processed: 0, unused: 0, loss: 0,
    status: 'With processor', lineId: line?.id || '', lineRevision: line?.revision ?? null, checks, allocations: allocated,
    carrier: clean(x.carrier), route: clean(x.route), document: ctx.document(x.document, ['logistics']),
  };
  s.jobs.push(job);
  const outside = { lotId: lot.id, qty, unit: lot.unit, location: site, custody: processor.name };
  post(s, 'Commission outward', ctx, {
    date: day, jobId: job.id, output: lot.id, qty, unit: lot.unit, from: lot.location, to: site,
    reference: number, checks, moves: [stockMove(lot, -qty), outside],
  });
  return job;
}

export function jobReturn(s, x, ctx) {
  const job = record(s.jobs, x.jobId, 'commission job');
  ensure(!job.washBatchId, 'Post the actual wash return in Manufacturing → Washing.');
  ensure(!job.printBatchId, 'Post the actual print return in Manufacturing → Printing.');
  ensure(!job.embroideryBatchId, 'Post the actual return in Manufacturing → Embroidery.');
  ensure(job.qty > 0, 'This job is fully reconciled.');
  const source = record(s.lots, job.lotId, 'sent lot');
  const day = date(x.date);
  ensure(day >= job.lastDate, 'Return date precedes the latest movement for this job.');
  const dest = location(s, x.locationId);
  const kind = choice(x.kind, ['Processed return', 'Unused return', 'Process loss'], 'return type');
  const used = quantity(x.used, 'Quantity reconciled in the sent unit', job.unit);
  ensure(used <= job.qty, 'Return, usage or loss exceeds the outstanding processor quantity.');
  const reference = req(x.reference, 'Processor return or loss reference');
  const moves = [{ lotId: source.id, qty: -used, unit: job.unit, location: job.site, custody: job.processor }];
  let output;
  let waste = 0;
  if (kind !== 'Process loss') {
    const code = lotKey(s, x.outputId);
    const unit = kind === 'Unused return' ? job.unit : choice(x.unit || job.unit, UNITS, 'returned unit');
    const qty = kind === 'Unused return' ? used : quantity(x.outputQty, 'Returned output quantity', unit);
    const material = kind === 'Unused return' ? source.material : STAGES[job.stage].output;
    const snapshot = {
      material, label: clean(x.label, 120) || material, itemId: kind === 'Unused return' ? source.itemId : '',
      stage: kind === 'Unused return' ? source.stage : job.stage, ownerId: source.ownerId,
      scheme: source.scheme, additionalSchemes: source.additionalSchemes, origin: job.site, processorId: job.processorId,
      parents: [{ id: source.id, qty: used, unit: job.unit }], jobId: job.id, composition: source.composition,
      ...measures(x, qty, unit),
    };
    if (kind === 'Unused return') {
      snapshot.netKg = source.netKg ? inUnit(source, used, 'kg') : null;
      snapshot.lengthM = source.lengthM ? inUnit(source, used, 'm') : null;
    }
    output = newLot(s, code, qty, unit, day, dest, snapshot);
    if (kind === 'Processed return') {
      const reconciled = balance([{ lot: source, qty: used }], output, x);
      ensure(reconciled.unit === job.unit, 'Reconcile commission returns in the unit used on the outward challan.');
      waste = round(reconciled.waste + reconciled.rejects);
    }
    if (job.lineId && ref(s.lines, job.lineId)?.unit === unit && job.allocations.length) {
      const link = job.allocations.find(a => a.lineId === job.lineId);
      const assigned = Math.min(link?.qty || 0, used);
      if (link) link.qty = round(link.qty - assigned);
      output.allocations = assigned ? [{ lineId: job.lineId, qty: Math.min(assigned, qty) }] : [];
      output.allocationBalance = structuredClone(output.allocations);
    }
    const trigger = { schemes: schemesOf(source), role: 'Processor', partyId: job.processorId, name: job.processor, site: job.site,
      operation: job.stage, material: STAGES[job.stage].output, on: day, planning: true,
      subject: ref(s.lines, job.lineId)?.sku || ref(s.items, source.itemId)?.code };
    const reportedChemicals = declaredChemicals(s, x.chemicalItems);
    const scoped = { lineIds: [job.lineId], operation: job.stage, holder: job.processor, itemId: source.itemId, site: job.site, on: day,
      chemicals: [...new Set([...chemicalCodes(s, [source]), ...reportedChemicals])], components: componentCodes(s, [source]),
      requireChemicalDeclaration: kind === 'Processed return', noChemicals: x.noChemicals === 'yes' };
    ensure(!scoped.noChemicals || !scoped.chemicals.length, 'Record the chemical codes or confirm no chemicals were used.');
    output.claimTrigger = trigger;
    output.scopedClaimTrigger = scoped;
    try {
      checkHistory(s, source);
      const outwardChecks = job.checks ?? [];
      for (const decision of outwardChecks) for (const evidence of decision.evidence) {
        ensure(ref(s.evidence, evidence.id)?.status === 'Verified', 'Evidence ' + evidence.number + ' on this challan is no longer verified.', 422, 'standard-lock');
      }
      output.checks = [...outwardChecks, ...checkEvidence(s, trigger), ...checkClaimRules(s, scoped)];
    } catch (error) {
      if (error.code !== 'standard-lock') throw error;
      output.standardHold = true;
      output.holdReason = error.message;
    }
    moves.push(stockMove(output, qty));
  }
  if (kind === 'Unused return') job.unused = round(job.unused + used);
  else if (kind === 'Processed return') {
    job.processed = round(job.processed + used - waste);
    job.loss = round(job.loss + waste);
  } else {
    job.loss = round(job.loss + used);
  }
  job.qty = round(job.qty - used);
  job.lastDate = day;
  job.status = job.qty ? 'Part returned' : 'Reconciled';
  const e = post(s, kind, ctx, {
    jobId: job.id, date: day, reference, from: job.site, to: output?.location || '',
    input: source.id, output: output?.id || source.id, qty: used, unit: job.unit, moves, notes: clean(x.notes),
    document: ctx.document(x.document, ['logistics']), chemicals: output?.scopedClaimTrigger?.chemicals ?? [], checks: output?.checks ?? [],
  });
  if (output) output.eventId = e.id;
  return output || job;
}

export function meterReading(s, x, ctx) {
  const machine = record(s.machines, x.machineId, 'machine');
  const reference = req(x.reference, 'Device receipt or meter reference');
  ensure(!s.readings.some(r => r.machineId === machine.id && r.reference === reference), 'This meter source was already recorded for the machine.');
  const row = {
    id: id(s, 'MTR'), machineId: machine.id, device: machine.device, date: date(x.date),
    unit: choice(x.unit, ['kWh', 'L', 'kg steam'], 'reading unit'), qty: decimal(x.qty, 'Measured activity'),
    reference, time: clean(x.time, 80), method: req(x.method, 'Allocation method or meter boundary'),
    verified: false, actor: ctx.actor, eventId: '',
  };
  s.readings.push(row);
  return row;
}

export function verifyReading(s, x, ctx) {
  const reading = record(s.readings, x.readingId, 'meter reading');
  ensure(!reading.verified, 'This reading is already verified.');
  reading.verification = req(x.reference, 'Attribution or calibration evidence');
  reading.verified = true;
  reading.verifiedBy = ctx.actor;
  return reading;
}

export function maintenance(s, x, ctx) {
  const machine = record(s.machines, x.machineId, 'machine');
  const row = {
    id: id(s, 'MNT'), machineId: machine.id, date: date(x.date), actor: ctx.actor,
    kind: choice(x.kind, ['Scheduled service', 'Breakdown', 'Repair completed', 'Inspection'], 'maintenance type'),
    reference: req(x.reference, 'Maintenance reference'), notes: req(x.notes, 'Work or findings'), due: x.due ? date(x.due) : '',
  };
  if (row.kind === 'Breakdown') machine.status = 'Down';
  if (row.kind === 'Repair completed') machine.status = 'In service';
  s.maintenance.push(row);
  return row;
}
