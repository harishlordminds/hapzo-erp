// Fabric dyeing for knitted and woven greige rolls, own or customer material, on the shared batch engine.
// Rolls are received roll-wise, combined in a dye batch, and unloaded as dyed rolls. Each dyed roll names
// the greige rolls it came from, and carries its wet weight and its dry-equivalent weight separately.
import { EPS, key, req, clean, choice, number, decimal, date, id, ref, record, ensure, norm, round, sum, csvLines, genealogy } from './model.js';
import { receive, newLot, lotKey, post, stockMove } from './stock.js';
import { location, party } from './commerce.js';
import { checkHistory } from './standards.js';
import {
  engine, readRates, openBatch, batchWork, postingDate, batchReference, track, standardCheck, reconcile, consumeWip,
  spreadCosts, wipKg, wipMove, lineRemainingKg, deliverToOwner, ALLOCATION_BASIS,
} from './process-batch.js';

export const FABRIC_DYEING = 'Fabric dyeing';
export const FABRIC_KINDS = ['Knitted', 'Woven', 'Any'];
export const FD_PRETREATMENTS = ['None', 'Scouring', 'Scouring and bleaching', 'Desizing, scouring and bleaching', 'Mercerising and scouring'];
export const FD_STEPS = ['Loading', 'Pre-treatment', 'Dyeing', 'Shade correction', 'Washing / soaping', 'Fixing / softening', 'Unloading', 'Re-dye (rework)'];
export const DRY_BASIS = ['Conditioned weighing', 'Moisture meter', 'Standard regain'];

export function fdRequiredSteps(recipe, rework = false) {
  if (!recipe) return [];
  return rework ? ['Re-dye (rework)', 'Washing / soaping', 'Unloading'] : ['Loading', ...(recipe.pretreatment !== 'None' ? ['Pre-treatment'] : []), 'Dyeing', 'Washing / soaping', 'Unloading'];
}

// Knitted or woven, from the roll record or the route it was made on.
export function fabricKind(s, lot) {
  const node = [lot, ...genealogy(s, lot.id)].find(l => l.fabric?.kind || l.knit || l.weave?.segments || ['Knitting', 'Weaving'].includes(l.stage));
  if (!node) return '';
  return node.fabric?.kind || (node.knit || node.stage === 'Knitting' ? 'Knitted' : 'Woven');
}
// A roll woven from a sized warp needs desizing, either as a route step before dyeing or in the batch pretreatment.
export function needsDesizing(s, lot) {
  const chain = [lot, ...genealogy(s, lot.id)];
  return chain.some(l => l.weave?.sized) && !chain.some(l => l.stage === 'Desizing');
}

export function fdSetup(s, x, ctx) {
  const code = key(x.code, 'Recipe code');
  const version = req(x.version, 'Recipe revision', 40);
  ensure(!s.processSetups.some(r => r.process === FABRIC_DYEING && norm(r.code) === norm(code) && norm(r.version) === norm(version)), 'Recipe ' + code + ' revision ' + version + ' already exists.');
  const chemicals = csvLines(x.chemicals, 'Recipe chemical', 2).map(([itemCode, per]) => {
    const item = s.items.find(i => i.type === 'Chemical' && norm(i.code) === norm(itemCode));
    ensure(item, 'Recipe chemical ' + itemCode + ' must be a chemical item in Company masters.');
    return { itemId: item.id, code: item.code, unit: item.unit, per: decimal(per, 'Dose of ' + item.code + ' per kg fabric', 0.000001) };
  });
  const revises = x.revises ? record(s.processSetups, x.revises, 'recipe being revised') : null;
  ensure(!revises || revises.process === FABRIC_DYEING && norm(revises.code) === norm(code) && revises.status === 'Approved', 'Revise the current approved revision of recipe ' + code + '.');
  const row = {
    id: id(s, 'FDR'), process: FABRIC_DYEING, code, version, effective: date(x.effective), colour: clean(x.colour, 80), shade: req(x.shade, 'Shade', 120),
    fabricKind: choice(x.fabricKind || 'Any', FABRIC_KINDS, 'fabric kind'), pretreatment: choice(x.pretreatment || 'None', FD_PRETREATMENTS, 'pretreatment'),
    pretreatmentSpec: clean(x.pretreatmentSpec, 400), machineType: clean(x.machineType, 80), liquorRatio: decimal(x.liquorRatio || '0', 'Liquor ratio'), chemicals,
    waterPerKg: decimal(x.waterPerKg || '0', 'Planned water L per kg'), steamPerKg: decimal(x.steamPerKg || '0', 'Planned steam kg per kg'),
    electricityPerKg: decimal(x.electricityPerKg || '0', 'Planned electricity kWh per kg'), yieldPct: number(x.yieldPct || '100', 'Planned yield %', 1, 100), ...readRates(x),
    reference: req(x.reference, 'Recipe approval or lab dip reference'), status: 'Approved', actor: ctx.actor, at: ctx.at,
    revises: revises?.id || '', revisionReason: revises ? req(x.revisionReason, 'Reason for the revision', 400) : '',
  };
  ensure(row.pretreatment === 'None' || row.pretreatmentSpec, 'Record the pretreatment specification (bath, temperature, time).');
  row.requiredSteps = fdRequiredSteps(row);
  if (revises) {
    revises.status = 'Superseded';
    revises.supersededBy = row.id;
  }
  s.processSetups.push(row);
  return row;
}

// Roll-wise inward of greige fabric, own or customer-owned. Each roll is its own lot.
export function fabricInward(s, x, ctx) {
  const item = record(s.items, x.itemId, 'greige fabric item');
  ensure(item.type === 'Greige fabric' && item.unit === 'kg', 'Use a greige fabric item stocked in kg.');
  const customer = x.mode === 'Customer inward';
  const rows = csvLines(x.rolls, 'Greige roll', 2, 4).map(([rollId, kg, metres, customerRoll]) => ({ rollId, kg: decimal(kg, 'Roll kg for ' + rollId, 0.000001),
    metres: metres ? decimal(metres, 'Metres for ' + rollId, 0.000001) : null, customerRoll: clean(customerRoll, 60) }));
  ensure(rows.length && new Set(rows.map(r => norm(r.rollId))).size === rows.length, 'Enter each roll once: roll ID, kg, metres where measured, and the customer’s roll number.');
  const fabric = { kind: choice(x.fabricKind, ['Knitted', 'Woven'], 'fabric kind'), construction: req(x.construction, 'Fabric construction', 200),
    gsm: x.gsm ? number(x.gsm, 'GSM', 10, 1500) : null, width: clean(x.width, 60), sized: x.sized === 'yes', commissionRef: customer ? req(x.commissionRef, 'Customer job order', 120) : '' };
  const lots = rows.map(r => {
    const lot = receive(s, { ...x, lotId: r.rollId, qty: String(r.kg), netKg: '', grossKg: '', lengthM: r.metres == null ? '' : String(r.metres),
      mode: customer ? 'Customer inward' : x.purchaseId ? undefined : 'Direct inward' }, ctx);
    lot.fabric = { ...fabric, customerRoll: r.customerRoll };
    if (customer) lot.commissionRef = fabric.commissionRef;
    if (fabric.sized) lot.weave = { sized: true, beamType: 'Received greige' };
    return lot;
  });
  return { id: lots.map(l => l.id).join(', '), lots };
}

const done = (s, b) => new Set(s.events.filter(e => e.batchId === b.id && e.kind === 'Process entry' && !e.reversedBy).map(e => e.step));

export const fabricDyeing = engine({
  process: FABRIC_DYEING, prefix: 'FDB', batchLabel: 'Dye batch', setupLabel: 'fabric dye recipe', setupRequired: true,
  workUnits: ['kg'], inputs: ['Greige fabric'], outputMaterial: 'Dyed fabric', outputUnits: ['kg'], steps: FD_STEPS, method: 'HZ-FD-ROLL-1',
  setupSnapshot: r => ({ code: r.code, version: r.version, colour: r.colour, shade: r.shade, pretreatment: r.pretreatment, fabricKind: r.fabricKind,
    variety: [r.colour && !r.shade.toLowerCase().startsWith(r.colour.toLowerCase()) ? r.colour : '', r.shade].filter(Boolean).join(' ') + ' · ' + r.fabricKind.toLowerCase() }),
  batchFields: (s, x) => {
    const customer = x.customerId ? party(s, x.customerId, 'Buyer') : null;
    const wo = ref(s.workOrders, x.workOrderId);
    return { customerId: customer?.id || '', customer: customer?.name || '', commission: Boolean(customer),
      commissionRef: customer ? req(x.commissionRef, 'Customer job order', 120) : '', requiredSteps: fdRequiredSteps(ref(s.processSetups, x.recipeId), wo?.rework) };
  },
  issueLine: (s, b, lot) => {
    ensure((lot.ownerId || '') === (b.customerId || ''), b.commission
      ? 'Commission batch ' + b.number + ' takes only rolls owned by ' + b.customer + '. Roll ' + lot.id + ' belongs to ' + (ref(s.parties, lot.ownerId)?.name || s.settings.name) + '.'
      : 'Batch ' + b.number + ' is for own material. Open a commission batch for customer-owned roll ' + lot.id + '.');
    ensure(!b.commission || !lot.commissionRef || same(lot.commissionRef, b.commissionRef), 'Roll ' + lot.id + ' belongs to job ' + lot.commissionRef + ', not ' + b.commissionRef + '.');
    const recipe = ref(s.processSetups, b.recipeId);
    const kind = fabricKind(s, lot);
    ensure(recipe.fabricKind === 'Any' || kind === recipe.fabricKind, 'Recipe ' + recipe.code + ' is for ' + recipe.fabricKind.toLowerCase() + ' fabric. Roll ' + lot.id + ' is ' + (kind || 'of unknown construction').toLowerCase() + '.');
    ensure(!needsDesizing(s, lot) || recipe.pretreatment.startsWith('Desizing'), 'Roll ' + lot.id + ' is woven from a sized warp and has not been desized. Use a recipe whose pretreatment includes desizing, or desize the roll first.', 422, 'route-skip');
    return { kind, metres: lot.lengthM ? round(lot.lengthM * lot.qty / lot.initialQty) : null };
  },
  entryFields: (s, x, b) => {
    const steps = b.requiredSteps ?? [];
    const at = steps.indexOf(x.step);
    if (at > 0) ensure(done(s, b).has(steps[at - 1]), 'Route skip · record ' + steps[at - 1] + ' before ' + x.step + ' on batch ' + b.number + '.', 422, 'route-skip');
    return {};
  },
  outputLabel: b => 'Dyed fabric · ' + b.recipe.variety, recipeText: b => b.recipe.code + ' r' + b.recipe.version + ' · ' + b.recipe.variety,
  planRows: (s, b, { recipe, netKg, consumedKg, acceptedKg, waste }) => {
    const chem = new Map();
    for (const c of recipe?.chemicals ?? []) chem.set(c.itemId, { code: c.code, unit: c.unit, planned: round(c.per * netKg), actual: 0 });
    for (const c of b.load.chemicals) {
      const row = chem.get(c.itemId) ?? { code: c.code + ' (not in recipe)', unit: c.unit, planned: 0, actual: 0 };
      row.actual = round(row.actual + c.qty);
      chem.set(c.itemId, row);
    }
    const outs = s.lots.filter(l => l.batchId === b.id && l.dyed);
    return [
      ['Dyed fabric (dry equivalent)', recipe ? round(consumedKg * recipe.yieldPct / 100) : null, acceptedKg, 'kg', (recipe?.yieldPct ?? '—') + '% planned yield'],
      ['Dyed fabric (wet, as unloaded)', null, round(sum(outs, l => l.dyed.wetKg)), 'kg', 'Measured wet weight, not stock'],
      ['Waste', null, waste, 'kg', 'Selvedge, ends and lint'],
      ['Water', recipe ? round(recipe.waterPerKg * netKg) : null, b.load.water, 'L', recipe?.waterPerKg + ' L/kg'],
      ['Steam', recipe ? round(recipe.steamPerKg * netKg) : null, b.load.steam, 'kg', recipe?.steamPerKg + ' kg/kg'],
      ['Electricity', recipe ? round(recipe.electricityPerKg * netKg) : null, b.load.electricity, 'kWh', recipe?.electricityPerKg + ' kWh/kg'],
      ...[...chem.values()].map(c => [c.code, c.planned, c.actual, c.unit, 'Recipe dose × net kg loaded']),
    ];
  },
});
const same = (a, b) => norm(a) === norm(b);

// Unloads dyed rolls. Each row: roll ID, dry-equivalent kg, wet kg, metres, source greige rolls (joined with +), L for a leftover piece.
export function fdRolls(s, x, ctx) {
  const b = openBatch(s, x.batchId, FABRIC_DYEING);
  const wo = batchWork(s, b);
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Unloading reference');
  const missing = (b.requiredSteps ?? []).filter(step => !done(s, b).has(step));
  ensure(!missing.length, 'Record ' + missing.join(', ') + ' before unloading rolls from ' + b.number + '.', 422, 'route-skip');
  const before = wipKg(b);
  ensure(before > 0, 'Batch ' + b.number + ' has no fabric in process.');
  const basis = choice(x.dryBasis || 'Conditioned weighing', DRY_BASIS, 'dry-equivalent basis');
  const rows = csvLines(x.rolls, 'Dyed roll', 3, 6).map(([rollId, dry, wet, metres, sources, flag]) => {
    const dryKg = decimal(dry, 'Dry-equivalent kg for ' + rollId, 0.000001);
    const wetKg = decimal(wet, 'Wet kg for ' + rollId, 0.000001);
    ensure(wetKg >= dryKg, 'Wet weight of ' + rollId + ' cannot be below its dry-equivalent weight.');
    const from = clean(sources, 400).split('+').map(v => v.trim()).filter(Boolean).map(src => {
      const line = b.lines.find(l => same(l.lotId, src));
      ensure(line, 'Invalid lot link · ' + src + ' is not a roll in batch ' + b.number + '.', 422, 'lot-link');
      return line.lotId;
    });
    return { id: lotKey(s, rollId), dryKg, wetKg, metres: metres ? decimal(metres, 'Metres for ' + rollId, 0.000001) : null, from, leftover: norm(flag) === 'l' };
  });
  ensure(rows.length && new Set(rows.map(r => norm(r.id))).size === rows.length, 'Enter each dyed roll once.');
  const result = choice(x.result || 'Accepted', ['Accepted', 'Rework'], 'result');
  const outKg = round(sum(rows, r => r.dryKg));
  const r = reconcile({ ...x, rejects: x.rejects || '0' }, outKg, before);
  // Roll-to-roll draw plan on the dry basis: each output takes its dry kg plus its share of waste from its source rolls.
  const remaining = new Map();
  for (const l of b.lines) remaining.set(l.lotId, round((remaining.get(l.lotId) || 0) + lineRemainingKg(l)));
  const lossShare = round(r.consumedKg - outKg);
  let lossLeft = lossShare;
  const plans = rows.map((row, i) => {
    const need = round(row.dryKg + (i === rows.length - 1 ? lossLeft : round(lossShare * row.dryKg / outKg)));
    lossLeft = round(lossLeft - (need - row.dryKg));
    const pool = (row.from.length ? row.from : [...remaining.keys()]).filter(lotId => (remaining.get(lotId) || 0) > EPS);
    const available = round(sum(pool, lotId => remaining.get(lotId)));
    ensure(need <= available + EPS, 'Dyed roll ' + row.id + ' needs ' + need + ' kg but its source rolls (' + (row.from.join(', ') || 'batch') + ') hold ' + available + ' kg.', 422, 'lot-link');
    let left = need;
    const draws = pool.map((lotId, j) => {
      const take = j === pool.length - 1 ? left : Math.min(left, round(need * remaining.get(lotId) / available));
      left = round(left - take);
      remaining.set(lotId, round(remaining.get(lotId) - take));
      return { lotId, kg: take };
    }).filter(d => d.kg > 0);
    return { ...row, need, draws };
  });
  ensure(round(wo.completedQty + (result === 'Accepted' ? outKg : 0)) <= wo.plannedQty, 'Rolls exceed work order ' + wo.number + '.');
  const dest = location(s, x.locationId || b.locationId);
  ensure(dest.site === b.site, 'Post rolls at ' + b.site + '.');
  const totals = new Map();
  for (const p of plans) for (const d of p.draws) totals.set(d.lotId, round((totals.get(d.lotId) || 0) + d.kg));
  const used = consumeWip(s, b, r.consumedKg, [...totals].map(([lotId, kg]) => lotId + ',' + kg).join('\n'));
  for (const lot of used.sources) checkHistory(s, lot);
  const { checks, usage } = standardCheck(s, fabricDyeing.cfg, wo, b, day, { consume: true, amount: outKg, lots: used.sources });
  const outs = plans.map(p => {
    const fraction = p.dryKg / outKg;
    const chemicals = [...new Set(used.chemicals.map(c => c.lotId))].map(lotId => {
      const rowsFor = used.chemicals.filter(c => c.lotId === lotId);
      return { id: lotId, qty: round(sum(rowsFor) * fraction), unit: rowsFor[0].unit, role: 'Process input' };
    }).filter(c => c.qty > 0);
    const parents = [...p.draws.map(d => ({ id: d.lotId, qty: d.kg, unit: 'kg', kg: d.kg, role: 'Primary', allocations: [] })), ...chemicals];
    return newLot(s, p.id, p.dryKg, 'kg', day, dest, {
      material: 'Dyed fabric', label: (p.leftover ? 'Leftover · ' : '') + 'Dyed ' + b.recipe.variety, ownerId: b.ownerId || '', stage: FABRIC_DYEING, workOrderId: wo.id, batchId: b.id,
      scheme: wo.scheme, additionalSchemes: wo.additionalSchemes, checks, qualityStatus: result === 'Rework' ? 'Rework' : 'Pending inspection',
      composition: [...new Set(used.sources.map(l => l.composition).filter(Boolean))].join(' / '), netKg: p.dryKg, lengthM: p.metres,
      conversionBasis: 'Stock in dry-equivalent kg (' + basis.toLowerCase() + '); wet weight held separately', commissionRef: b.commissionRef || '',
      fabric: { kind: [...new Set(used.sources.map(l => fabricKind(s, l)))].join('/'), colour: b.recipe.colour, shade: b.recipe.shade },
      dyed: { wetKg: p.wetKg, dryKg: p.dryKg, moisturePct: round(100 * (p.wetKg - p.dryKg) / p.wetKg), basis, recipe: b.recipe.code + ' r' + b.recipe.version,
        sources: p.draws.map(d => d.lotId), leftover: p.leftover, batch: b.number, shift: clean(x.shift, 40) },
      parents, resources: Object.fromEntries(['electricity', 'water', 'steam'].map(k => [k, round(used.resources[k] * fraction)])),
    });
  });
  const e = post(s, 'Production', ctx, {
    date: day, stage: FABRIC_DYEING, process: FABRIC_DYEING, type: result === 'Rework' ? 'Rework output' : 'Run', workOrderId: wo.id, batchId: b.id, lineRevision: wo.lineRevision,
    inputs: [...totals].map(([lotId, kg]) => ({ id: lotId, qty: kg, unit: 'kg', kg, role: 'Primary' })), output: outs[0].id, outputs: outs.map(l => l.id), qty: outKg, unit: 'kg', site: b.site, allocations: [],
    reconciliation: { unit: 'kg', input: r.consumedKg, accepted: outKg, waste: r.waste, rejects: r.rejects, adjustment: r.adjustment, reference: r.adjustmentRef, basis: 'Dry-equivalent kg (' + basis + ')' },
    wetKg: round(sum(plans, p => p.wetKg)), rolls: plans.map(p => ({ id: p.id, dryKg: p.dryKg, wetKg: p.wetKg, metres: p.metres, sources: p.draws, leftover: p.leftover })),
    reference, recipe: fabricDyeing.cfg.recipeText(b), shift: clean(x.shift, 40), operator: clean(x.operator, 100), machineId: b.machineId, machineName: b.machineName, readingId: '',
    ...used.resources, chemicals: used.chemicals, consumption: used.consumption, share: round(used.share), allocationBasis: 'Roll-to-roll sources by dry kg; ' + ALLOCATION_BASIS.toLowerCase(),
    methodVersion: 'HZ-FD-ROLL-1', completedAdd: result === 'Accepted' ? outKg : 0, evidenceUsage: usage, processCost: [], costIds: [], checks,
    ...(b.commission ? { customerId: b.customerId, customer: b.customer, commissionRef: b.commissionRef } : {}),
    moves: [...used.consumption.map(c => wipMove(b, c.lotId, -c.qty, c.unit)), ...outs.map(l => stockMove(l, l.qty))], document: ctx.document(x.document, ['production']),
  });
  spreadCosts(s, e, outs, day, reference, ref(s.processSetups, b.recipeId), used.resources, round(r.waste + r.rejects));
  for (const lot of outs) lot.eventId = e.id;
  b.outputs.push(...outs.map(l => l.id));
  if (result === 'Accepted') wo.completedQty = round(wo.completedQty + outKg);
  wo.status = wo.completedQty >= wo.plannedQty ? 'Completed' : 'In progress';
  track(b, e, 'Output', day);
  return outs[0];
}

export const fdDeliver = deliverToOwner(FABRIC_DYEING);

// Commission balance for one customer job: greige received = consumed + greige still held or returned undyed,
// and consumed = dyed output + waste + rejects − measured adjustment; dyed output = delivered + still held.
export function commissionBalance(s, customerId, jobRef) {
  const isJob = l => l.ownerId === customerId && same(l.commissionRef, jobRef);
  const received = s.lots.filter(l => isJob(l) && l.claimSource === 'receipt');
  const batches = s.processBatches.filter(b => b.process === FABRIC_DYEING && b.customerId === customerId && same(b.commissionRef, jobRef));
  const outputs = s.events.filter(e => e.kind === 'Production' && !e.reversedBy && batches.some(b => b.id === e.batchId));
  const dyed = s.lots.filter(l => isJob(l) && l.dyed && l.qualityStatus !== 'Reversed');
  const deliveries = s.events.filter(e => e.kind === 'Commission delivery' && e.customerId === customerId && e.inputs.some(i => dyed.some(l => l.id === i.id) || received.some(l => l.id === i.id)));
  const deliveredOf = list => round(sum(deliveries.flatMap(e => e.inputs).filter(i => list.some(l => l.id === i.id)), i => i.qty));
  const closeLoss = round(sum(s.events.filter(e => e.kind === 'Process close' && batches.some(b => b.id === e.batchId)), e => sum(e.loss ?? [], l => l.kg)));
  const r = {
    receivedKg: round(sum(received, l => l.initialQty)), receivedRolls: received.length,
    consumedKg: round(sum(outputs, e => e.reconciliation.input)), inProcessKg: round(sum(batches, wipKg)), closeLossKg: closeLoss,
    greigeHeldKg: round(sum(received, l => l.qty)), greigeDeliveredKg: deliveredOf(received),
    dyedKg: round(sum(outputs, e => e.reconciliation.accepted)), wetKg: round(sum(outputs, e => e.wetKg || 0)),
    wasteKg: round(sum(outputs, e => e.reconciliation.waste + e.reconciliation.rejects)), adjustmentKg: round(sum(outputs, e => e.reconciliation.adjustment)),
    dyedDeliveredKg: deliveredOf(dyed), dyedHeldKg: round(sum(dyed, l => l.qty)), deliveries, batches, received, dyed,
  };
  r.greigeBalance = round(r.receivedKg - r.consumedKg - r.inProcessKg - r.closeLossKg - r.greigeHeldKg - r.greigeDeliveredKg);
  r.processBalance = round(r.consumedKg + r.adjustmentKg - r.dyedKg - r.wasteKg);
  r.dyedBalance = round(r.dyedKg - r.dyedDeliveredKg - r.dyedHeldKg);
  r.reconciled = Math.abs(r.greigeBalance) < EPS && Math.abs(r.processBalance) < EPS && Math.abs(r.dyedBalance) < EPS;
  return r;
}
