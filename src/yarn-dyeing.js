// Yarn dyeing process module on the shared batch engine.
// Own material and commission work: a commission batch holds yarn owned by one customer, and the
// dyed lots stay in that customer's ownership while in this mill's custody until delivered back.
import { key, req, clean, choice, number, decimal, date, id, ref, record, ensure, norm, round, csvLines } from './model.js';
import { party } from './commerce.js';
import { engine, readRates, deliverToOwner } from './process-batch.js';

export { RATE_KEYS, ALLOCATION_BASIS, wipKg, wipLabel, kgPerUnit, lineRemaining, lineRemainingKg, batchSummary } from './process-batch.js';
export const PROCESS = 'Yarn dyeing';
export const DYE_STEPS = ['Package winding', 'Loading', 'Pre-treatment', 'Dyeing', 'Shade correction', 'Soaping / washing', 'Fixing / softening',
  'Hydro-extraction', 'Drying', 'Rewinding', 'Unloading', 'Re-dye (rework)'];
export const PRETREATMENTS = ['None', 'Scouring', 'Scouring and bleaching', 'Mercerised yarn rinse', 'Other as specified'];
export const METHOD_VERSION = 'HZ-YD-ALLOC-1';
export const colourShade = r => r.colour && !String(r.shade).toLowerCase().startsWith(r.colour.toLowerCase()) ? r.colour + ' ' + r.shade : r.shade;

// Steps a recipe requires, in order. Recipes approved before step control have none.
export function requiredSteps(recipe, rework = false) {
  if (!recipe?.pretreatment) return [];
  const finish = ['Soaping / washing', 'Drying', ...(recipe.rewind ? ['Rewinding'] : [])];
  return rework ? ['Re-dye (rework)', ...finish] : ['Package winding', ...(recipe.pretreatment !== 'None' ? ['Pre-treatment'] : []), 'Dyeing', ...finish];
}

export function dyeSetup(s, x, ctx) {
  const code = key(x.code, 'Recipe code');
  const version = req(x.version, 'Recipe revision', 40);
  ensure(!s.processSetups.some(r => r.process === PROCESS && norm(r.code) === norm(code) && norm(r.version) === norm(version)), 'Recipe ' + code + ' revision ' + version + ' already exists.');
  const chemicals = csvLines(x.chemicals, 'Recipe chemical', 2).map(([itemCode, per]) => {
    const item = s.items.find(i => i.type === 'Chemical' && norm(i.code) === norm(itemCode));
    ensure(item, 'Recipe chemical ' + itemCode + ' must be a chemical item in Company masters.');
    return { itemId: item.id, code: item.code, unit: item.unit, per: decimal(per, 'Dose of ' + item.code + ' per kg yarn', 0.000001) };
  });
  ensure(new Set(chemicals.map(c => c.itemId)).size === chemicals.length, 'List each recipe chemical once.');
  const revises = x.revises ? record(s.processSetups, x.revises, 'recipe being revised') : null;
  ensure(!revises || revises.process === PROCESS && norm(revises.code) === norm(code) && revises.status === 'Approved', 'Revise the current approved revision of recipe ' + code + '.');
  const row = {
    id: id(s, 'DYS'), process: PROCESS, code, version, shade: req(x.shade, 'Shade', 120), colour: clean(x.colour, 80), effective: date(x.effective),
    pretreatment: x.pretreatment ? choice(x.pretreatment, PRETREATMENTS, 'pretreatment') : '', pretreatmentSpec: clean(x.pretreatmentSpec, 400),
    rewind: x.rewind === 'yes', liquorRatio: decimal(x.liquorRatio || '0', 'Liquor ratio'), chemicals,
    waterPerKg: decimal(x.waterPerKg || '0', 'Planned water L per kg'), steamPerKg: decimal(x.steamPerKg || '0', 'Planned steam kg per kg'),
    electricityPerKg: decimal(x.electricityPerKg || '0', 'Planned electricity kWh per kg'),
    yieldPct: number(x.yieldPct || '100', 'Planned yield %', 1, 100), ...readRates(x),
    reference: req(x.reference, 'Recipe approval reference'), status: 'Approved', actor: ctx.actor, at: ctx.at, notes: clean(x.notes),
    revises: revises?.id || '', revisionReason: revises ? req(x.revisionReason, 'Reason for the recipe revision', 400) : '',
  };
  ensure(!row.pretreatment || row.pretreatment === 'None' || row.pretreatmentSpec, 'Record the pretreatment specification (bath, temperature, time).');
  row.requiredSteps = requiredSteps(row);
  if (revises) {
    revises.status = 'Superseded';
    revises.supersededBy = row.id;
  }
  s.processSetups.push(row);
  return row;
}

function planRows(s, b, { recipe, netKg, acceptedKg }) {
  const chemicalRows = new Map();
  for (const c of recipe?.chemicals ?? []) chemicalRows.set(c.itemId, { code: c.code, unit: c.unit, planned: round(c.per * netKg), actual: 0 });
  for (const c of b.load.chemicals) {
    const row = chemicalRows.get(c.itemId) ?? { code: c.code + ' (not in recipe)', unit: c.unit, planned: 0, actual: 0 };
    row.actual = round(row.actual + c.qty);
    chemicalRows.set(c.itemId, row);
  }
  return [
    ['Accepted output', recipe ? round(netKg * recipe.yieldPct / 100) : null, acceptedKg, 'kg', 'Planned yield ' + (recipe?.yieldPct ?? '—') + '%'],
    ['Water', recipe ? round(recipe.waterPerKg * netKg) : null, b.load.water, 'L', recipe?.waterPerKg + ' L/kg'],
    ['Steam', recipe ? round(recipe.steamPerKg * netKg) : null, b.load.steam, 'kg', recipe?.steamPerKg + ' kg/kg'],
    ['Electricity', recipe ? round(recipe.electricityPerKg * netKg) : null, b.load.electricity, 'kWh', recipe?.electricityPerKg + ' kWh/kg'],
    ...[...chemicalRows.values()].map(c => [c.code, c.planned, c.actual, c.unit, 'Recipe dose × net kg issued']),
  ];
}

const stepsDone = (s, b) => new Set(s.events.filter(e => e.batchId === b.id && e.kind === 'Process entry' && !e.reversedBy).map(e => e.step));
export const batchSteps = (s, b) => b.requiredSteps ?? [];
export function missingSteps(s, b) {
  const done = stepsDone(s, b);
  return batchSteps(s, b).filter(step => !done.has(step));
}

export const yarnDyeing = engine({
  process: PROCESS, prefix: 'DYB', batchLabel: 'Batch', setupLabel: 'dye recipe', setupRequired: true,
  workUnits: ['kg', 'cone'], inputs: ['Yarn'], outputMaterial: 'Dyed yarn', outputUnits: ['kg', 'cone'], steps: DYE_STEPS, method: METHOD_VERSION,
  setupSnapshot: r => ({ code: r.code, version: r.version, shade: r.shade, colour: r.colour || '', pretreatment: r.pretreatment || '' }),
  batchFields: (s, x) => {
    const customer = x.customerId ? party(s, x.customerId, 'Buyer') : null;
    const wo = ref(s.workOrders, x.workOrderId);
    return { customerId: customer?.id || '', customer: customer?.name || '', commission: Boolean(customer),
      commissionRef: customer ? req(x.commissionRef, 'Customer job order or challan reference', 120) : '',
      requiredSteps: requiredSteps(ref(s.processSetups, x.recipeId), wo?.rework) };
  },
  issueLine: (s, b, lot) => {
    ensure((lot.ownerId || '') === (b.customerId || ''), b.commission
      ? 'Commission batch ' + b.number + ' takes only yarn owned by ' + b.customer + '. Lot ' + lot.id + ' belongs to ' + (ref(s.parties, lot.ownerId)?.name || s.settings.name) + '.'
      : 'Batch ' + b.number + ' is for own material. Open a commission batch for customer-owned lot ' + lot.id + '.');
    return {};
  },
  entryFields: (s, x, b) => {
    const steps = batchSteps(s, b);
    const at = steps.indexOf(x.step);
    if (at > 0) ensure(stepsDone(s, b).has(steps[at - 1]), 'Route skip · record ' + steps[at - 1] + ' before ' + x.step + ' on batch ' + b.number + '.', 422, 'route-skip');
    return {};
  },
  outputGuard: (s, b) => {
    const missing = missingSteps(s, b);
    ensure(!missing.length, 'Record ' + missing.join(', ') + ' before posting dyed yarn from batch ' + b.number + '.', 422, 'route-skip');
  },
  outputLabel: b => 'Dyed yarn · ' + colourShade(b.recipe),
  outputFields: b => ({ shade: b.recipe.shade, colour: b.recipe.colour || '', recipeRef: b.recipe.code + ' r' + b.recipe.version, ...(b.commission ? { commissionRef: b.commissionRef } : {}) }),
  outputEvent: b => (b.commission ? { customerId: b.customerId, customer: b.customer, commissionRef: b.commissionRef } : {}),
  recipeText: b => b.recipe.code + ' r' + b.recipe.version + ' · ' + colourShade(b.recipe), planRows,
});

// Returns commission-dyed yarn to its owner. Ownership never changed; custody moves to the customer.
export const dyeDeliver = deliverToOwner(PROCESS);

export const dyeBatch = yarnDyeing.open;
export const dyeIssue = yarnDyeing.issue;
export const dyeEntry = yarnDyeing.entry;
export const dyeOutput = yarnDyeing.output;
export const dyeReturn = yarnDyeing.returnUnused;
export const dyeClose = yarnDyeing.close;
export const dyeReverse = yarnDyeing.reverse;
