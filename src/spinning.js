// Spinning mill on the shared batch engine. A spin lot runs one count plan from issued fibre
// through blow room, carding, drawing, optional comber preparation and combing, roving (ring only),
// spinning and winding. Yarn packing posts yarn lots with their cone identifiers.
import { EPS, key, req, clean, choice, number, decimal, quantity, date, id, ref, record, ensure, norm, round, sum } from './model.js';
import { newLot, lotKey, post, stockMove, lotAllocations } from './stock.js';
import { location } from './commerce.js';
import { checkHistory } from './standards.js';
import {
  engine, readRates, openBatch, batchWork, postingDate, batchReference, track, standardCheck, reconcile, consumeWip, parentLinks,
  spreadCosts, wipKg, wipMove, ALLOCATION_BASIS,
} from './process-batch.js';

export const SPINNING = 'Spinning';
export const SPIN_SYSTEMS = ['Ring', 'Rotor'];
export const COUNT_SYSTEMS = ['Ne', 'Nm', 'tex', 'den'];
export const SPIN_STEPS = ['Blow room', 'Carding', 'Breaker drawing', 'Lap forming', 'Combing', 'Finisher drawing', 'Roving', 'Ring spinning', 'Rotor spinning', 'Winding'];
export const SPIN_ROUTES = {
  'Carded ring': { system: 'Ring', combed: false, steps: ['Blow room', 'Carding', 'Breaker drawing', 'Finisher drawing', 'Roving', 'Ring spinning', 'Winding'] },
  'Combed ring': { system: 'Ring', combed: true, steps: ['Blow room', 'Carding', 'Breaker drawing', 'Lap forming', 'Combing', 'Finisher drawing', 'Roving', 'Ring spinning', 'Winding'] },
  'Carded rotor': { system: 'Rotor', combed: false, steps: ['Blow room', 'Carding', 'Breaker drawing', 'Finisher drawing', 'Rotor spinning'] },
  'Combed rotor': { system: 'Rotor', combed: true, steps: ['Blow room', 'Carding', 'Breaker drawing', 'Lap forming', 'Combing', 'Finisher drawing', 'Rotor spinning'] },
};
export const SPIN_INPUTS = ['Prepared fibre', 'Cotton bale', 'Cotton fibre', 'Other fibre'];
export const spinSettings = s => ({ systems: ['Ring'], version: '', ...(s.settings.spinning ?? {}) });
export const countLabel = p => p ? p.count + 's ' + p.countSystem + ' ' + p.route.toLowerCase() : '';

export function spinConfig(s, x, ctx) {
  const systems = SPIN_SYSTEMS.filter(name => x[name.toLowerCase()] === 'yes');
  ensure(systems.length, 'Enable ring spinning, rotor spinning or both.');
  s.settings.spinning = { systems, version: req(x.version, 'Configuration revision', 40), effective: date(x.effective),
    reference: req(x.reference, 'Approval reference'), actor: ctx.actor, at: ctx.at };
  return { id: 'spinning-settings' };
}

export function spinSetup(s, x, ctx) {
  const code = key(x.code, 'Count plan code');
  const version = req(x.version, 'Plan revision', 40);
  ensure(!s.processSetups.some(r => r.process === SPINNING && norm(r.code) === norm(code) && norm(r.version) === norm(version)), 'Count plan ' + code + ' revision ' + version + ' already exists.');
  const route = choice(x.route, Object.keys(SPIN_ROUTES), 'spinning route');
  ensure(spinSettings(s).systems.includes(SPIN_ROUTES[route].system), SPIN_ROUTES[route].system + ' spinning is not configured for this mill.');
  const row = {
    id: id(s, 'SPP'), process: SPINNING, code, version, route, effective: date(x.effective),
    count: number(x.count, 'Nominal count', 0.1, 2000), countSystem: choice(x.countSystem || 'Ne', COUNT_SYSTEMS, 'count system'),
    countTolerancePct: number(x.countTolerancePct || '2', 'Count tolerance ± %', 0, 20), composition: req(x.composition, 'Composition', 200),
    twist: clean(x.twist, 60), coneKg: decimal(x.coneKg || '0', 'Nominal cone weight kg'),
    yieldPct: number(x.yieldPct || '100', 'Planned yarn yield %', 1, 100), noilPct: SPIN_ROUTES[route].combed ? number(x.noilPct || '0', 'Planned noil %', 0, 40) : 0,
    wastePct: number(x.wastePct || '0', 'Planned waste %', 0, 40), ...readRates(x),
    reference: req(x.reference, 'Plan approval reference'), status: 'Approved', actor: ctx.actor, at: ctx.at,
  };
  s.processSetups.push(row);
  return row;
}

const stepsDone = (s, b) => new Set([...s.events.filter(e => e.batchId === b.id && e.kind === 'Process entry' && !e.reversedBy).map(e => e.step),
  ...(b.lines.length && b.lines.every(l => l.preparedBy) ? ['Blow room'] : [])]);

// The fibre-preparation record for a prepared fibre lot, pulled forward to the spin lot.
export function preparationRecord(s, lot) {
  const blend = ref(s.processBatches, lot?.batchId);
  if (!blend || blend.process !== 'Fibre preparation') return null;
  const steps = s.events.filter(e => e.batchId === blend.id && e.kind === 'Process entry' && !e.reversedBy);
  return {
    blend, plan: ref(s.processSetups, blend.recipeId), handoff: s.events.find(e => e.kind === 'Production' && e.output === lot.id),
    issued: blend.lines.map(l => ({ lotId: l.lotId, kg: round(l.issuedKg - l.returnedKg), consumedKg: l.consumedKg, component: l.component || '' })),
    steps: steps.map(e => ({ step: e.step, date: e.date, start: e.start, end: e.end, machine: e.machineName, operator: e.operator, shift: e.shift, droppings: e.droppings, laydown: e.laydown })),
  };
}

function planRows(s, b, { setup, consumedKg, acceptedKg, byProductKg, waste, outputs }) {
  const counts = outputs.filter(e => e.count?.actual).map(e => e.count.actual);
  return [
    ['Yarn', setup ? round(consumedKg * setup.yieldPct / 100) : null, acceptedKg, 'kg', setup ? setup.yieldPct + '% planned yield' : ''],
    ['Comber noil', setup ? round(consumedKg * setup.noilPct / 100) : null, byProductKg, 'kg', setup?.noilPct ? setup.noilPct + '% planned noil' : 'Carded route'],
    ['Waste', setup ? round(consumedKg * setup.wastePct / 100) : null, waste, 'kg', (setup?.wastePct ?? 0) + '% planned'],
    ['Count', setup?.count ?? null, counts.length ? round(sum(counts, c => c) / counts.length) : 0, setup?.countSystem || '', '± ' + (setup?.countTolerancePct ?? '—') + '% · mean of tested lots'],
  ];
}

export const spinning = engine({
  process: SPINNING, prefix: 'SPL', batchLabel: 'Spin lot', setupLabel: 'count plan', setupRequired: true,
  workUnits: ['kg'], inputs: SPIN_INPUTS, outputMaterial: 'Yarn', outputUnits: ['kg'], steps: SPIN_STEPS, method: 'HZ-SPN-MASS-1',
  setupSnapshot: r => ({ code: r.code, version: r.version, route: r.route, count: r.count, countSystem: r.countSystem, variety: countLabel(r) }),
  batchFields: (s, x) => {
    const plan = ref(s.processSetups, x.recipeId);
    ensure(spinSettings(s).systems.includes(SPIN_ROUTES[plan.route].system), SPIN_ROUTES[plan.route].system + ' spinning is not configured for this mill.');
    return { route: plan.route, steps: [...SPIN_ROUTES[plan.route].steps] };
  },
  issueLine: (s, b, lot) => {
    const prep = preparationRecord(s, lot);
    return prep ? { preparedBy: prep.blend.id, blend: prep.blend.number } : {};
  },
  entryFields: (s, x, b) => {
    ensure(b.steps.includes(x.step), x.step + ' is not on the ' + b.route + ' route for spin lot ' + b.number + '.', 422, 'route-skip');
    const done = stepsDone(s, b);
    if (x.step === 'Blow room') ensure(!b.lines.some(l => l.preparedBy) || b.lines.some(l => !l.preparedBy), 'Blow room is already recorded on the issued blend. Record carding next.');
    const at = b.steps.indexOf(x.step);
    if (at > 0) ensure(done.has(b.steps[at - 1]), 'Route skip · record ' + b.steps[at - 1] + ' before ' + x.step + ' on spin lot ' + b.number + '.', 422, 'route-skip');
    return {
      stepKg: x.stepKg ? decimal(x.stepKg, 'Production at this step kg') : null,
      hank: x.hank ? number(x.hank, 'Measured hank', 0, 1000) : null, hankUnit: x.hank ? choice(x.hankUnit || 'Ne', ['Ne', 'ktex', 'g/m'], 'hank unit') : '',
      deliveries: x.deliveries ? quantity(x.deliveries, 'Deliveries, spindles or rotors running', 'pcs') : null,
    };
  },
  outputLabel: b => 'Yarn · ' + b.recipe.variety, recipeText: b => b.recipe.code + ' r' + b.recipe.version + ' · ' + b.recipe.variety, planRows,
});

// Yarn packing: posts a yarn lot (with cones) and, on combed routes, the comber noil from the same consumption.
export function spinOutput(s, x, ctx) {
  const b = openBatch(s, x.batchId, SPINNING);
  const wo = batchWork(s, b);
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Packing slip reference');
  const done = stepsDone(s, b);
  const missing = b.steps.filter(step => !done.has(step));
  ensure(!missing.length, 'Record ' + missing.join(', ') + ' before packing yarn from spin lot ' + b.number + '.', 422, 'route-skip');
  const before = wipKg(b);
  ensure(before > 0, 'Spin lot ' + b.number + ' has no fibre in process.');
  const plan = record(s.processSetups, b.recipeId, 'count plan');
  const yarnKg = decimal(x.outputQty, 'Yarn net kg', 0.000001);
  const cones = quantity(x.cones, 'Cones', 'pcs');
  const noilKg = decimal(x.noilKg || '0', 'Comber noil kg');
  ensure(!noilKg || SPIN_ROUTES[b.route].combed, 'Noil only arises on a combed route.');
  const r = reconcile(x, round(yarnKg + noilKg), before);
  ensure(round(wo.completedQty + yarnKg) <= wo.plannedQty, 'Yarn exceeds work order ' + wo.number + '. Release another work order for the excess.');
  const actual = number(x.actualCount, 'Measured count', 0.1, 2000);
  const deviation = round(100 * (actual - plan.count) / plan.count);
  const count = { nominal: plan.count, system: plan.countSystem, actual, cv: x.countCv ? number(x.countCv, 'Count CV %', 0, 20) : null,
    deviation, test: req(x.countTest, 'Count test report'), within: Math.abs(deviation) <= plan.countTolerancePct + EPS };
  const allocations = lotAllocations(s, x.allocations, 'kg', yarnKg, wo.lineId);
  for (const a of allocations) ensure(record(s.lines, a.lineId, 'PO line').product === 'Yarn', 'Allocate yarn only to PO lines ordering yarn (' + a.lineId + ').');
  const dest = location(s, x.locationId || b.locationId);
  ensure(dest.site === b.site, 'Post output at ' + b.site + '.');
  const item = x.itemId ? record(s.items, x.itemId, 'yarn item') : null;
  ensure(!item || item.type === 'Yarn' && item.unit === 'kg', 'The yarn item must be yarn stocked in kg.');
  const packages = { cones, coneKg: round(yarnKg / cones), first: clean(x.coneFrom, 40), last: clean(x.coneTo, 40), ids: clean(x.coneIds, 4000),
    cartons: x.cartons ? quantity(x.cartons, 'Cartons or bags', 'pcs') : null, packing: clean(x.packing, 80) };
  ensure(packages.ids || packages.first && packages.last, 'Enter the cone identifiers: a first and last cone number, or the list of cone IDs.');
  const yarnId = lotKey(s, x.outputId);
  const noilId = noilKg > 0 ? lotKey(s, x.noilLotId) : '';
  ensure(!noilId || noilId.toLowerCase() !== yarnId.toLowerCase(), 'Use different lot IDs for the yarn and the noil.');
  const used = consumeWip(s, b, r.consumedKg, x.consumption);
  for (const lot of used.sources) checkHistory(s, lot);
  const { checks, usage } = standardCheck(s, spinning.cfg, wo, b, day, { consume: true, amount: yarnKg, lots: used.sources });
  const total = round(yarnKg + noilKg);
  const blends = [...new Set(b.lines.map(l => l.blend).filter(Boolean))];
  const common = kg => ({ ownerId: b.ownerId || '', stage: SPINNING, workOrderId: wo.id, batchId: b.id, scheme: wo.scheme, additionalSchemes: wo.additionalSchemes, checks,
    netKg: kg, lengthM: null, parents: parentLinks(used.consumption, used.chemicals, used.sources, kg / total),
    resources: Object.fromEntries(['electricity', 'water', 'steam'].map(k => [k, round(used.resources[k] * kg / total)])) });
  const yarn = newLot(s, yarnId, yarnKg, 'kg', day, dest, {
    ...common(yarnKg), material: 'Yarn', itemId: item?.id || '', label: item?.name || countLabel(plan), composition: plan.composition,
    qualityStatus: count.within ? 'Pending inspection' : 'Hold', qualityNote: count.within ? '' : 'Measured count ' + actual + ' ' + plan.countSystem + ' is ' + deviation + '% from nominal.',
    yarn: { count, route: b.route, system: SPIN_ROUTES[b.route].system, twist: plan.twist, plan: plan.code + ' r' + plan.version, blends, spinLot: b.number, packages, shift: clean(x.shift, 40) },
    allocations, allocationBalance: structuredClone(allocations), conversionBasis: 'Net kg weighed at packing',
  });
  const outs = [yarn];
  if (noilKg > 0) outs.push(newLot(s, noilId, noilKg, 'kg', day, dest, { ...common(noilKg), material: 'Fibre waste', label: 'Comber noil · ' + b.number,
    composition: plan.composition, qualityStatus: 'Released', conversionBasis: 'Weighed at combing' }));
  const setup = plan;
  const e = post(s, 'Production', ctx, {
    date: day, stage: SPINNING, process: SPINNING, type: 'Run', workOrderId: wo.id, batchId: b.id, lineRevision: wo.lineRevision,
    inputs: parentLinks(used.consumption, used.chemicals, used.sources), output: yarn.id, outputs: outs.map(l => l.id), qty: yarnKg, unit: 'kg', site: b.site,
    allocations, reconciliation: { unit: 'kg', input: r.consumedKg, accepted: yarnKg, byProduct: noilKg, waste: r.waste, rejects: r.rejects, adjustment: r.adjustment, reference: r.adjustmentRef, basis: 'Measured kg' },
    count, packages, reference, recipe: spinning.cfg.recipeText(b), shift: clean(x.shift, 40), operator: clean(x.operator, 100), machineId: b.machineId, machineName: b.machineName, readingId: '',
    ...used.resources, chemicals: used.chemicals, consumption: used.consumption, share: round(used.share),
    allocationBasis: 'Mass share of yarn and noil; ' + ALLOCATION_BASIS.toLowerCase(), methodVersion: 'HZ-SPN-MASS-1',
    completedAdd: yarnKg, evidenceUsage: usage, processCost: [], costIds: [], checks,
    moves: [...used.consumption.map(c => wipMove(b, c.lotId, -c.qty, c.unit)), ...outs.map(l => stockMove(l, l.qty))],
    document: ctx.document(x.document, ['production']),
  });
  spreadCosts(s, e, outs, day, reference, setup, used.resources, round(r.waste + r.rejects));
  for (const lot of outs) lot.eventId = e.id;
  b.outputs.push(...outs.map(l => l.id));
  wo.completedQty = round(wo.completedQty + yarnKg);
  wo.status = wo.completedQty >= wo.plannedQty ? 'Completed' : 'In progress';
  track(b, e, 'Output', day);
  return yarn;
}

export const spinOpen = spinning.open;
