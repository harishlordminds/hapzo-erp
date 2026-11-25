import { clean, date, decimal, ensure, genealogy, id, key, norm, record, ref, req, round, sum, csvLines } from './model.js';
import { location } from './commerce.js';
import { checkHistory } from './standards.js';
import { lotAllocations, lotKey, newLot, post, stockMove } from './stock.js';
import { checkRouteStep, FABRIC_ROUTE_TEMPLATES, routeSnapshot } from './routes.js';
import { fabricKind } from './fabric-dyeing.js';
import { engine, openBatch, batchWork, postingDate, batchReference, track, standardCheck, reconcile,
  consumeWip, wipKg, wipMove, parentLinks } from './process-batch.js';

export const FABRIC_FINISHING = 'Fabric finishing';
export const FINISH_OPERATIONS = ['Drying', 'Stentering', 'Compacting', 'Calendering', 'Heat setting', 'Sanforising'];

export function finishPlan(s, x, ctx) {
  const route = x.componentRouteId ? record(s.componentRoutes, x.componentRouteId, 'approved component route') : null;
  const line = record(s.lines, x.lineId || route?.lineId, 'approved buyer PO line');
  ensure(line.status === 'Approved', 'Approve the buyer PO line before approving its finishing plan.');
  const effective = date(x.effective);
  ensure(!route || route.status === 'Approved' && route.lineId === line.id && route.effective <= effective,
    'Choose an approved component route for this PO line effective on the plan date.');
  const stages = route?.stages ?? line.stages;
  ensure(stages.includes(FABRIC_FINISHING), 'The approved route must include Fabric finishing.');
  const fabrics = line.garmentSpec?.fabrics ?? [];
  const componentCode = route?.component || clean(x.component, 64).toUpperCase() || (fabrics.length === 1 ? fabrics[0].code : '');
  const component = fabrics.find(f => f.code === componentCode);
  ensure(!fabrics.length && (!componentCode || route) || component, 'Choose the fabric component from this PO line’s approved tech pack.');
  const spec = component?.construction ?? line.fabricSpec;
  const type = spec?.type || FABRIC_ROUTE_TEMPLATES[route?.template]?.type || '';
  ensure(!route || !type || FABRIC_ROUTE_TEMPLATES[route.template].type === type, 'The approved fabric construction does not match this component route.');
  const code = key(x.code, 'Finishing plan code');
  const version = req(x.version, 'Finishing plan revision', 40);
  ensure(!s.processSetups.some(r => r.process === FABRIC_FINISHING && norm(r.code) === norm(code) && norm(r.version) === norm(version)),
    'This finishing plan revision already exists.');
  const steps = clean(x.steps, 10000).split(/\r?\n/).map(raw => raw.trim()).filter(Boolean).map(raw => {
    const [name, ...settings] = raw.split('|');
    const operation = req(name, 'Finishing operation', 80);
    return { operation: FINISH_OPERATIONS.find(entry => norm(entry) === norm(operation)) || operation,
      settings: clean(settings.join('|'), 500) };
  });
  ensure(steps.length && steps.length <= 40, 'Enter one to forty finishing operations in the approved order.');
  const row = {
    id: id(s, 'FFP'), process: FABRIC_FINISHING, code, version, lineId: line.id, lineRevision: line.revision, component: componentCode,
    effective, steps, status: 'Approved', reference: req(x.reference, 'Approval reference'), actor: ctx.actor, at: ctx.at,
    specification: { revision: line.specRev, approvedSpec: line.approvedSpec, type, structure: component?.structure || spec?.structure || '',
      instructions: component?.finish || '', widthMode: component?.widthMode || '', widthCm: component?.grossWidth ?? null,
      usableWidthCm: component?.usableWidth ?? null, widthLimits: component?.grossTolerance?.limits ?? null,
      gsm: spec?.condition === 'Finished' ? spec.values?.gsm ?? null : !spec ? component?.gsm ?? null : null,
      gsmLimits: spec?.condition === 'Finished' ? spec.ranges?.gsm ?? null : null, itemId: component?.item?.itemId || '' },
    route: { name: route?.legacy || line.route, version: route?.version || line.routeVersion, stages: [...stages],
      componentRoute: route ? routeSnapshot(route) : null },
  };
  s.processSetups.push(row);
  return row;
}

function planMatches(plan, wo) {
  return plan.lineId === wo.lineId && plan.lineRevision === wo.lineRevision && plan.component === wo.techComponent &&
    (plan.route.componentRoute?.id || '') === (wo.componentRoute?.id || '') && plan.route.stages.join('|') === wo.stages.join('|');
}


export const finishEntries = (s, b) => b.postings.filter(p => !p.reversed && p.kind === 'Entry')
  .map(p => ref(s.events, p.eventId)).filter(Boolean);

export const finishing = engine({
  process: FABRIC_FINISHING, prefix: 'FFB', batchLabel: 'Finishing batch', setupLabel: 'approved finishing plan', setupRequired: true,
  workUnits: ['kg'], inputs: ['Greige fabric', 'Dyed fabric'], outputMaterial: 'Finished fabric', outputUnits: ['kg'],
  batchSteps: b => b.recipe.steps.map(row => row.operation),
  setupSnapshot: plan => structuredClone(plan),
  batchFields: (s, x) => {
    const wo = record(s.workOrders, x.workOrderId, 'finishing work order');
    const plan = record(s.processSetups, x.recipeId, 'finishing plan');
    ensure(planMatches(plan, wo) && (!wo.finishPlanId || wo.finishPlanId === plan.id),
      'Use the finishing plan for this work order’s pinned PO revision, fabric component and route.');
    wo.finishPlanId = plan.id;
    return { lineId: wo.lineId, lineRevision: wo.lineRevision };
  },
  issueLine: (s, b, lot) => {
    const wo = batchWork(s, b);
    ensure(lot.unit === 'kg', 'Issue fabric rolls stocked in weighed kg.');
    const kind = fabricKind(s, lot);
    const expected = b.recipe.specification.type;
    ensure(!expected || !kind || expected === kind, 'Roll ' + lot.id + ' is ' + kind.toLowerCase() + ' and does not match the approved ' + expected?.toLowerCase() + ' specification.');
    if (!wo.rework) {
      const route = wo.componentRoute || { name: wo.route, template: wo.route, stages: wo.stages };
      checkRouteStep({ ...wo, componentRoute: route }, [lot]);
      const ancestors = [lot, ...genealogy(s, lot.id)];
      if (wo.stages.includes('Fabric dyeing')) ensure(lot.material === 'Dyed fabric' && ancestors.some(row => row.stage === 'Fabric dyeing'),
        'The approved route requires a posted fabric dye run before finishing ' + lot.id + '.', 422, 'route-skip');
      if (expected && wo.stages.some(stage => ['Knitting', 'Weaving'].includes(stage))) {
        const forming = expected === 'Knitted' ? 'Knitting' : 'Weaving';
        ensure(ancestors.some(row => row.stage === forming), 'Roll ' + lot.id + ' must trace to ' + forming.toLowerCase() + ' on the approved route.', 422, 'route-skip');
      }
    }
    return { kind, metres: lot.lengthM };
  },
  entryFields: (s, x, b, { start }) => {
    const entries = finishEntries(s, b);
    const step = b.recipe.steps[entries.length];
    ensure(step, 'All approved operations have been recorded for this batch.');
    ensure(x.step === step.operation, 'Record ' + step.operation + ' next on ' + b.number + '.', 422, 'route-skip');
    ensure(!entries.length || start >= entries.at(-1).end, 'This operation must start after the preceding finishing operation ends.');
    return { operationNo: entries.length + 1, settings: clean(x.settings, 1000) };
  },
  recipeText: b => b.recipe.code + ' r' + b.recipe.version,
  planRows: (_s, _b, { acceptedKg, returnedKg, waste, rejects }) => [
    ['Finished rolls and retained remnants', null, acceptedKg, 'kg', 'Measured finished net weight'],
    ['Unused fabric returned', null, returnedKg, 'kg', 'From the original issue'],
    ['Waste and rejects', null, round(waste + rejects), 'kg', 'Recorded during reconciliation'],
  ],
});

export function finishIssue(s, x, ctx) {
  const b = openBatch(s, x.batchId, FABRIC_FINISHING);
  ensure(!finishEntries(s, b).length, 'Issue all rolls before starting the finishing sequence. Use a new batch for additional rolls.');
  return finishing.issue(s, x, ctx);
}

export function finishReturn(s, x, ctx) {
  const rows = csvLines(x.lines, 'Return remnant', 2, 3).map(([lotId, kg, metres]) => ({
    lotId, kg: decimal(kg, 'Returned kg from ' + lotId, 0.000001), metres: metres ? decimal(metres, 'Measured returned metres', 0.000001) : null,
  }));
  ensure(new Set(rows.map(row => row.lotId)).size === rows.length, 'Enter each remnant source roll once in a return.');
  const event = finishing.returnUnused(s, { ...x, lines: rows.map(row => row.lotId + ',' + row.kg).join('\n') }, ctx);
  event.remnants = rows;
  return event;
}

export function finishRolls(s, x, ctx) {
  const b = openBatch(s, x.batchId, FABRIC_FINISHING);
  const wo = batchWork(s, b);
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Roll posting reference');
  const steps = finishEntries(s, b);
  ensure(steps.length === b.recipe.steps.length, 'Record ' + b.recipe.steps.slice(steps.length).map(row => row.operation).join(', ') + ' before posting finished rolls.',
    422, 'route-skip');
  ensure(day >= steps.at(-1).end.slice(0, 10), 'The roll posting date cannot precede completion of the finishing sequence.');
  const before = wipKg(b);
  const draws = new Map();
  const rows = csvLines(x.rolls, 'Finished roll', 7, 8).map(([rollId, sourceId, input, output, length, width, mass, flag]) => {
    const code = lotKey(s, rollId);
    const source = record(s.lots, sourceId, 'source roll ' + sourceId);
    ensure(b.lines.some(line => line.lotId === source.id), 'Source roll ' + source.id + ' was not issued to batch ' + b.number + '.', 422, 'lot-link');
    const inputKg = decimal(input, 'Input kg for ' + code, 0.000001);
    draws.set(sourceId, round((draws.get(sourceId) || 0) + inputKg));
    ensure(!flag || norm(flag) === 'remnant', 'Use Remnant to mark a retained finished piece.');
    return { code, source, inputKg, netKg: decimal(output, 'Finished kg for ' + code, 0.000001),
      metres: decimal(length, 'Finished length (m) for ' + code, 0.000001),
      widthCm: decimal(width, 'Measured width (cm) for ' + code, 0.000001), gsm: decimal(mass, 'Measured GSM for ' + code, 0.000001),
      remnant: Boolean(flag) };
  });
  ensure(rows.length && new Set(rows.map(r => norm(r.code))).size === rows.length, 'Enter each new finished roll or remnant once.');
  const netKg = sum(rows, row => row.netKg);
  const balance = reconcile({ ...x, consumedKg: sum(rows, row => row.inputKg) }, netKg, before);
  const completed = round(wo.completedQty + netKg);
  ensure(completed <= wo.plannedQty, 'Finished kg exceeds the work order plan.');
  const dest = location(s, x.locationId || b.locationId);
  ensure(dest.site === b.site, 'Post finished rolls at the finishing site.');
  const pinnedItem = ref(s.items, b.recipe.specification.itemId);
  const item = x.itemId ? record(s.items, x.itemId, 'finished fabric item') : pinnedItem?.type === 'Finished fabric' ? pinnedItem : null;
  ensure(!item || item.type === 'Finished fabric' && item.unit === 'kg', 'Select a Finished fabric item stocked in kg.');
  const sources = [...draws.keys()].map(lotId => record(s.lots, lotId, 'source roll'));
  for (const lot of sources) checkHistory(s, lot);
  const chemicalLots = [...new Set(b.load.chemicals.map(row => row.lotId))].map(lotId => record(s.lots, lotId, 'finishing chemical lot'));
  for (const lot of chemicalLots) checkHistory(s, lot);
  const used = consumeWip(s, b, balance.consumedKg, [...draws].map(([lotId, kg]) => lotId + ',' + kg).join('\n'));
  const { checks, usage } = standardCheck(s, finishing.cfg, wo, b, day, {
    consume: true, amount: netKg, lots: sources, chemicals: b.load.chemicals.map(row => row.code),
  });
  const outs = rows.map(row => {
    const share = row.inputKg / balance.consumedKg;
    const fractionOfSource = row.inputKg / draws.get(row.source.id);
    const sourceDraws = used.consumption.filter(c => c.lotId === row.source.id);
    const parents = [
      ...parentLinks(sourceDraws, [], [row.source], fractionOfSource),
      ...parentLinks([], used.chemicals, [], share),
    ];
    const allocations = lotAllocations(s, '', 'kg', row.netKg, wo.lineId);
    const measurements = { widthCm: row.widthCm, gsm: row.gsm, lengthM: row.metres, netKg: row.netKg };
    const kind = b.recipe.specification.type || fabricKind(s, row.source);
    return newLot(s, row.code, row.netKg, 'kg', day, dest, {
      material: 'Finished fabric', stage: FABRIC_FINISHING, itemId: item?.id || '', label: (row.remnant ? 'Finished remnant' : 'Finished fabric') +
        (b.recipe.specification.structure ? ' · ' + b.recipe.specification.structure : ''),
      ownerId: row.source.ownerId, composition: row.source.composition, scheme: wo.scheme, additionalSchemes: wo.additionalSchemes,
      workOrderId: wo.id, batchId: b.id, checks, qualityStatus: 'Pending inspection', netKg: row.netKg, lengthM: row.metres,
      allocations, allocationBalance: structuredClone(allocations), parents,
      fabric: { kind, construction: b.recipe.specification.structure, colour: row.source.fabric?.colour || '', shade: row.source.fabric?.shade || '',
        widthCm: row.widthCm, gsm: row.gsm },
      finishing: { ...measurements, widthMode: b.recipe.specification.widthMode || '', remnant: row.remnant, sourceLotId: row.source.id,
        inputKg: row.inputKg, stepIds: steps.map(event => event.id) },
      resources: Object.fromEntries(Object.entries(used.resources).map(([k, value]) => [k, round(value * share)])),
    });
  });
  const e = post(s, 'Production', ctx, {
    date: day, stage: FABRIC_FINISHING, process: FABRIC_FINISHING, type: 'Run', batchId: b.id, workOrderId: wo.id, lineRevision: wo.lineRevision,
    site: b.site, reference, recipe: finishing.cfg.recipeText(b), machineName: steps.at(-1).machineName, machineId: steps.at(-1).machineId,
    inputs: [...draws].map(([lotId, kg]) => ({ id: lotId, qty: kg, unit: 'kg', role: 'Primary' })),
    output: outs[0].id, outputs: outs.map(lot => lot.id), qty: netKg, unit: 'kg', allocations: lotAllocations(s, '', 'kg', netKg, wo.lineId),
    reconciliation: { unit: 'kg', input: balance.consumedKg, accepted: netKg, waste: balance.waste, rejects: balance.rejects,
      adjustment: balance.adjustment, reference: balance.adjustmentRef },
    completedAdd: netKg, consumption: used.consumption, chemicals: used.chemicals, ...used.resources, evidenceUsage: usage, checks,
    moves: [...used.consumption.map(c => wipMove(b, c.lotId, -c.qty, c.unit)), ...outs.map(lot => stockMove(lot, lot.qty))],
    document: ctx.document(x.document, ['production']),
  });
  for (const lot of outs) lot.eventId = e.id;
  b.outputs.push(...e.outputs);
  wo.completedQty = completed;
  wo.status = completed === wo.plannedQty ? 'Completed' : 'In progress';
  track(b, e, 'Output', day);
  return e;
}

export function finishedRollTrace(s, lot) {
  const ancestors = genealogy(s, lot.id);
  const roll = [lot, ...ancestors].find(row => row.finishing);
  const batch = ref(s.processBatches, roll?.batchId);
  if (!batch) return null;
  const upstream = genealogy(s, roll.id);
  const dye = upstream.filter(row => ['Yarn dyeing', 'Fabric dyeing'].includes(row.stage))
    .map(row => ({ lot: row, batch: ref(s.processBatches, row.batchId), event: ref(s.events, row.eventId) }));
  const yarn = upstream.filter(row => ['Yarn', 'Dyed yarn'].includes(row.material));
  return { roll, batch, route: batch.recipe.route, steps: roll.finishing.stepIds.map(key => ref(s.events, key)).filter(Boolean), dye, yarn };
}
