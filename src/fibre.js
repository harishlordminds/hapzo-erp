// Ginning and fibre preparation on the shared batch engine.
// Two inward entry points: seed cotton by weighbridge, and purchased lint bales.
import {
  EPS, key, req, clean, choice, number, decimal, date, id, ref, record, ensure, norm, round, sum, csvLines, today, genealogy,
} from './model.js';
import { receive, newLot, lotKey, post, stockMove, usable } from './stock.js';
import { schemesOf, location } from './commerce.js';
import { checkLotClaims, checkHistory } from './standards.js';
import { same } from './claim-scope.js';
import {
  engine, readRates, openBatch, batchWork, postingDate, batchReference, track, standardCheck, reconcile, consumeWip, parentLinks,
  spreadCosts, wipKg, wipMove, ALLOCATION_BASIS,
} from './process-batch.js';

export const GINNING = 'Ginning';
export const PREPARATION = 'Fibre preparation';
export const GIN_STEPS = ['Pre-cleaning', 'Ginning', 'Lint cleaning', 'Pressing', 'Bale weighing'];
export const PREP_STEPS = ['Bale selection', 'Laydown', 'Opening', 'Cleaning', 'Blending', 'Fine opening', 'Chute feed to carding'];
export const BALE_TRACKING = ['Each bale', 'Bale lot'];
export const HANDOFF = ['Blend lot', 'Shift lot', 'Each can / lap'];
export const LINT_MATERIALS = ['Cotton bale', 'Cotton fibre', 'Other fibre'];
export const fibreSettings = s => ({ baleTracking: 'Each bale', handoff: 'Blend lot', version: '', ...(s.settings.fibre ?? {}) });

// ---------- Mill configuration ----------
export function fibreConfig(s, x, ctx) {
  const used = s.processBatches.filter(b => b.process === PREPARATION && ['Open', 'In process'].includes(b.status));
  const handoff = choice(x.handoff, HANDOFF, 'handoff granularity');
  ensure(!used.length || used.every(b => b.handoff === handoff) || x.confirm === 'yes', 'Open blends keep the granularity they were opened with. Confirm to apply the new setting to new blends only.');
  s.settings.fibre = { baleTracking: choice(x.baleTracking, BALE_TRACKING, 'bale tracking'), handoff,
    version: req(x.version, 'Configuration revision', 40), effective: date(x.effective), reference: req(x.reference, 'Approval reference'), actor: ctx.actor, at: ctx.at };
  return { id: 'fibre-settings' };
}

// ---------- Seed cotton inward (weighbridge) ----------
export function seedInward(s, x, ctx) {
  const item = record(s.items, x.itemId, 'seed cotton item');
  ensure(item.type === 'Seed cotton' && item.unit === 'kg', 'Use a seed cotton item stocked in kg.');
  const gross = decimal(x.grossKg, 'Weighbridge gross kg', 0.000001);
  const tare = decimal(x.tareKg, 'Weighbridge tare kg');
  ensure(gross > tare, 'Gross weight must exceed tare.');
  const net = round(gross - tare);
  const ticket = req(x.weighbridgeRef, 'Weighbridge ticket');
  const intake = {
    kind: 'Seed cotton', grower: req(x.grower, 'Grower, farmer group or supplier name', 200), farmId: clean(x.farmId, 120),
    variety: clean(x.variety, 80), cropYear: clean(x.cropYear, 20), vehicle: clean(x.vehicle, 40),
    grossKg: gross, tareKg: tare, netKg: net, moisture: x.moisture ? number(x.moisture, 'Moisture %', 0, 100) : null,
    trash: x.trash ? number(x.trash, 'Trash %', 0, 100) : null, basis: 'Weighbridge gross − tare', ticket,
  };
  const lot = receive(s, { ...x, qty: String(net), netKg: '', grossKg: String(gross), mode: x.purchaseId ? undefined : 'Direct inward',
    reference: x.reference || ticket, origin: req(x.origin, 'Origin (village, district, state)') }, ctx);
  lot.intake = intake;
  lot.variety = intake.variety;
  Object.assign(ref(s.events, lot.eventId), { intake, measurementBasis: intake.basis });
  return lot;
}

function baleRows(input) {
  const rows = csvLines(input, 'Bale', 2, 6).map(([no, net, gross, mic, staple, strength]) => ({
    no: key(no, 'Bale number'), netKg: decimal(net, 'Net kg of bale ' + no, 0.000001), grossKg: gross ? decimal(gross, 'Gross kg of bale ' + no, 0.000001) : null,
    mic: mic ? number(mic, 'Micronaire', 0, 10) : null, staple: staple ? number(staple, 'Staple length mm', 0, 80) : null, strength: strength ? number(strength, 'Strength g/tex', 0, 60) : null,
  }));
  ensure(rows.length, 'Enter at least one bale with its net weight.');
  ensure(new Set(rows.map(r => norm(r.no))).size === rows.length, 'Each bale number must be unique.');
  for (const r of rows) ensure(r.grossKg == null || r.grossKg >= r.netKg, 'Gross weight of bale ' + r.no + ' must be at least its net weight.');
  return rows;
}

// ---------- Purchased lint bale inward ----------
export function baleInward(s, x, ctx) {
  const item = record(s.items, x.itemId, 'lint item');
  ensure(LINT_MATERIALS.includes(item.type) && item.unit === 'kg', 'Use a lint bale item stocked in kg.');
  const bales = baleRows(x.bales);
  const tracking = fibreSettings(s).baleTracking;
  const fibre = { ginner: req(x.ginner, 'Ginner or press factory', 200), lotMark: clean(x.lotMark, 80), variety: clean(x.variety, 80),
    cropYear: clean(x.cropYear, 20), tracking, basis: 'Bale tag net weight checked at receipt', check: req(x.weighRef, 'Receipt weighing or tag check reference') };
  const make = (lotId, rows) => {
    const lot = receive(s, { ...x, lotId, qty: String(round(sum(rows, r => r.netKg))), netKg: '', grossKg: rows.every(r => r.grossKg) ? String(round(sum(rows, r => r.grossKg))) : '' }, ctx);
    lot.fibre = { ...fibre, bales: rows, baleCount: rows.length };
    lot.variety = fibre.variety;
    Object.assign(ref(s.events, lot.eventId), { fibre: lot.fibre });
    return lot;
  };
  const lots = tracking === 'Each bale' ? bales.map(b => make(b.no, [b])) : [make(x.lotId, bales)];
  return { id: lots.map(l => l.id).join(', '), lots };
}

// ---------- Setup: gin plan and blend plan ----------
export function fibreSetup(s, x, ctx) {
  const process = choice(x.process, [GINNING, PREPARATION], 'plan type');
  const code = key(x.code, 'Plan code');
  const version = req(x.version, 'Plan revision', 40);
  ensure(!s.processSetups.some(r => r.process === process && norm(r.code) === norm(code) && norm(r.version) === norm(version)), process + ' plan ' + code + ' revision ' + version + ' already exists.');
  const base = { id: id(s, process === GINNING ? 'GNP' : 'BLP'), process, code, version, effective: date(x.effective), ...readRates(x),
    reference: req(x.reference, 'Plan approval reference'), status: 'Approved', actor: ctx.actor, at: ctx.at };
  let row;
  if (process === GINNING) {
    const lintPct = number(x.lintPct, 'Planned lint outturn %', 1, 100);
    const seedPct = number(x.seedPct || '0', 'Planned seed %', 0, 100);
    const wastePct = number(x.wastePct || '0', 'Planned gin waste %', 0, 100);
    ensure(lintPct + seedPct + wastePct <= 100 + EPS, 'Lint, seed and waste percentages cannot exceed 100.');
    row = { ...base, variety: clean(x.variety, 80), lintPct, seedPct, wastePct };
  } else {
    const components = csvLines(x.components, 'Blend component', 2).map(([k, pct]) => ({ key: req(k, 'Component', 80), pct: number(pct, 'Share of ' + k, 0.01, 100) }));
    ensure(!components.length || Math.abs(sum(components, c => c.pct) - 100) < 0.01, 'Blend component shares must add up to 100%.');
    ensure(new Set(components.map(c => norm(c.key))).size === components.length, 'List each blend component once.');
    row = { ...base, blendName: req(x.blendName, 'Blend name', 120), components, tolerancePct: number(x.tolerancePct || '0', 'Blend tolerance ± %', 0, 50),
      wastePct: number(x.wastePct || '0', 'Planned blowroom waste %', 0, 50) };
  }
  s.processSetups.push(row);
  return row;
}

const pct = (a, b) => b ? round(100 * a / b) : 0;
const stepEvents = (s, b) => s.events.filter(e => e.batchId === b.id && e.kind === 'Process entry' && !e.reversedBy);

// ---------- Ginning ----------
export const ginning = engine({
  process: GINNING, prefix: 'GIN', batchLabel: 'Gin run', setupLabel: 'gin plan', setupRequired: false,
  workUnits: ['kg'], inputs: ['Seed cotton'], outputMaterial: 'Cotton bale', outputUnits: ['kg'], steps: GIN_STEPS, method: 'HZ-GIN-MASS-1',
  setupSnapshot: r => r ? { code: r.code, version: r.version, variety: r.variety } : { code: '', version: '', variety: '' },
  outputLabel: () => 'Lint', recipeText: b => b.recipe.code ? b.recipe.code + ' r' + b.recipe.version : 'No gin plan',
  planRows: (s, b, { setup, consumedKg, acceptedKg, byProductKg, waste }) => [
    ['Lint outturn', setup ? round(consumedKg * setup.lintPct / 100) : null, acceptedKg, 'kg', setup ? setup.lintPct + '% planned · ' + pct(acceptedKg, consumedKg) + '% actual' : 'No gin plan'],
    ['Cotton seed', setup ? round(consumedKg * setup.seedPct / 100) : null, byProductKg, 'kg', setup ? setup.seedPct + '% planned · ' + pct(byProductKg, consumedKg) + '% actual' : ''],
    ['Gin waste', setup ? round(consumedKg * setup.wastePct / 100) : null, waste, 'kg', setup ? setup.wastePct + '% planned · ' + pct(waste, consumedKg) + '% actual' : ''],
    ['Electricity', null, b.load.electricity, 'kWh', 'Recorded at run steps'],
  ],
});

// A gin output posting presses lint bales and weighs seed and waste from the same consumed seed cotton.
export function ginOutput(s, x, ctx) {
  const b = openBatch(s, x.batchId, GINNING);
  const wo = batchWork(s, b);
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Pressing or output reference');
  ensure(b.entryCount > 0, 'Record the gin run entry before posting lint bales.');
  const before = wipKg(b);
  ensure(before > 0, 'Gin run ' + b.number + ' has no seed cotton in process.');
  const bales = baleRows(x.bales);
  const lintKg = round(sum(bales, r => r.netKg));
  const seedKg = decimal(x.seedKg || '0', 'Cotton seed kg');
  const r = reconcile({ ...x, rejects: '0' }, round(lintKg + seedKg), before);
  ensure(round(wo.completedQty + lintKg) <= wo.plannedQty, 'Lint exceeds work order ' + wo.number + '. Release another work order for the excess.');
  const tracking = fibreSettings(s).baleTracking;
  const groups = (tracking === 'Each bale' ? bales.map(bale => [bale.no, [bale]]) : [[x.lotId, bales]]).map(([lotId, rows]) => [lotKey(s, lotId), rows]);
  const seedId = seedKg > 0 ? lotKey(s, x.seedLotId) : '';
  ensure(!seedId || !groups.some(([lotId]) => lotId.toLowerCase() === seedId.toLowerCase()), 'Use a seed lot ID different from the lint lot IDs.');
  const item = x.itemId ? record(s.items, x.itemId, 'lint item') : null;
  ensure(!item || item.type === 'Cotton bale' && item.unit === 'kg', 'The lint item must be a cotton bale item in kg.');
  const dest = location(s, x.locationId || b.locationId);
  ensure(dest.site === b.site, 'Post output at ' + b.site + '.');
  const used = consumeWip(s, b, r.consumedKg, x.consumption);
  for (const lot of used.sources) checkHistory(s, lot);
  const { checks, usage } = standardCheck(s, ginning.cfg, wo, b, day, { consume: true, amount: lintKg, lots: used.sources });
  const total = round(lintKg + seedKg);
  const variety = [...new Set(used.sources.map(l => l.variety).filter(Boolean))].join(' / ');
  const origin = [...new Set(used.sources.map(l => l.origin).filter(Boolean))].join(' / ');
  const growers = [...new Set(used.sources.map(l => l.intake?.grower).filter(Boolean))].join(' / ');
  const common = (kg) => ({
    ownerId: b.ownerId || '', stage: GINNING, workOrderId: wo.id, batchId: b.id, scheme: wo.scheme, additionalSchemes: wo.additionalSchemes, checks,
    composition: '100% cotton', netKg: kg, lengthM: null, origin, variety, parents: parentLinks(used.consumption, used.chemicals, used.sources, kg / total),
    resources: Object.fromEntries(['electricity', 'water', 'steam'].map(k => [k, round(used.resources[k] * kg / total)])),
  });
  const fibre = { ginner: s.settings.name, ginRun: b.number, variety, growers, tracking, basis: 'Bale weighed at press' };
  const lintLots = groups.map(([lotId, rows]) => {
    const kg = round(sum(rows, row => row.netKg));
    return newLot(s, lotId, kg, 'kg', day, dest, { ...common(kg), material: 'Cotton bale', itemId: item?.id || '', label: item?.name || 'Lint · ' + b.number,
      qualityStatus: 'Pending inspection', grossKg: rows.every(row => row.grossKg) ? round(sum(rows, row => row.grossKg)) : null,
      fibre: { ...fibre, bales: rows, baleCount: rows.length }, conversionBasis: 'Stock unit kg' });
  });
  const outs = [...lintLots];
  if (seedKg > 0) {
    outs.push(newLot(s, seedId, seedKg, 'kg', day, dest, { ...common(seedKg), material: 'Cotton seed', label: 'Cotton seed · ' + b.number,
      qualityStatus: 'Released', conversionBasis: 'Weighed at gin' }));
  }
  const setup = ref(s.processSetups, b.recipeId);
  const e = post(s, 'Production', ctx, {
    date: day, stage: GINNING, process: GINNING, type: 'Run', workOrderId: wo.id, batchId: b.id, lineRevision: wo.lineRevision,
    inputs: parentLinks(used.consumption, used.chemicals, used.sources), output: lintLots[0].id, outputs: outs.map(l => l.id), qty: lintKg, unit: 'kg', site: b.site,
    allocations: [], reconciliation: { unit: 'kg', input: r.consumedKg, accepted: lintKg, byProduct: seedKg, waste: r.waste, rejects: 0, adjustment: r.adjustment, reference: r.adjustmentRef, basis: 'Measured kg' },
    outturn: { lintPct: pct(lintKg, r.consumedKg), seedPct: pct(seedKg, r.consumedKg), wastePct: pct(r.waste, r.consumedKg) },
    reference, recipe: ginning.cfg.recipeText(b), shift: clean(x.shift, 40), operator: clean(x.operator, 100), machineId: b.machineId, machineName: b.machineName, readingId: '',
    ...used.resources, chemicals: used.chemicals, consumption: used.consumption, share: round(used.share),
    allocationBasis: 'Mass share of lint and seed; ' + ALLOCATION_BASIS.toLowerCase(), methodVersion: 'HZ-GIN-MASS-1',
    completedAdd: lintKg, evidenceUsage: usage, processCost: [], costIds: [], checks,
    moves: [...used.consumption.map(c => wipMove(b, c.lotId, -c.qty, c.unit)), ...outs.map(l => stockMove(l, l.qty))],
    document: ctx.document(x.document, ['production']),
  });
  spreadCosts(s, e, outs, day, reference, setup, used.resources, r.waste);
  for (const lot of outs) lot.eventId = e.id;
  b.outputs.push(...outs.map(l => l.id));
  wo.completedQty = round(wo.completedQty + lintKg);
  wo.status = wo.completedQty >= wo.plannedQty ? 'Completed' : 'In progress';
  track(b, e, 'Output', day);
  return lintLots[0];
}

// ---------- Fibre preparation (blend, laydown, opening, cleaning, handoff) ----------
function componentFor(s, plan, lot) {
  if (!plan?.components?.length) return '';
  const keys = [lot.variety, lot.origin, lot.fibre?.lotMark, ref(s.items, lot.itemId)?.code].filter(Boolean);
  const match = plan.components.find(c => keys.some(k => same(k, c.key)));
  ensure(match, 'Lot ' + lot.id + ' (' + (keys.join(' · ') || 'no variety or origin') + ') is not a component of blend plan ' + plan.code + '.', 422, 'blend-plan');
  return match.key;
}

function componentKg(b) {
  const out = new Map();
  for (const l of b.lines) out.set(l.component || '—', round((out.get(l.component || '—') || 0) + l.issuedKg - l.returnedKg));
  return out;
}

export const preparation = engine({
  process: PREPARATION, prefix: 'BLD', batchLabel: 'Blend', setupLabel: 'blend plan', setupRequired: true,
  workUnits: ['kg'], inputs: LINT_MATERIALS, outputMaterial: 'Prepared fibre', outputUnits: ['kg'], steps: PREP_STEPS, method: 'HZ-FP-ALLOC-1',
  releaseOutput: true,
  setupSnapshot: r => ({ code: r.code, version: r.version, blend: r.blendName }),
  batchFields: s => ({ handoff: fibreSettings(s).handoff, trackingVersion: fibreSettings(s).version }),
  issueLine: (s, b, lot) => ({ component: componentFor(s, ref(s.processSetups, b.recipeId), lot) }),
  entryFields: (s, x, b) => {
    if (!['Bale selection', 'Laydown'].includes(x.step)) return {};
    const lots = [...new Set(clean(x.laydown, 4000).split(/[\s,]+/).map(v => v.replace(/^HZ:LOT:/i, '').trim()).filter(Boolean))];
    ensure(lots.length, 'List the bale lots in this ' + x.step.toLowerCase() + '.');
    for (const lotId of lots) ensure(b.lines.some(l => same(l.lotId, lotId)), 'Invalid lot link · ' + lotId + ' was not issued to blend ' + b.number + '.', 422, 'lot-link');
    return { laydown: { number: req(x.laydownNo, x.step + ' number', 40), lots } };
  },
  outputGuard: (s, b, { consumedKg, before, x, day }) => {
    if (b.handoff === 'Blend lot') ensure(!b.outputs.length && consumedKg >= before - EPS,
      'Mill tracking hands off one prepared fibre lot per blend. Post the whole blend (' + before + ' kg in process) in one output.', 422, 'granularity');
    if (b.handoff === 'Shift lot') {
      const shift = req(x.shift, 'Shift');
      ensure(!s.events.some(e => e.batchId === b.id && e.kind === 'Production' && !e.reversedBy && e.date === day && norm(e.shift) === norm(shift)),
        'Mill tracking hands off one lot per blend and shift. Shift ' + shift + ' on ' + day + ' is already posted.', 422, 'granularity');
    }
    if (b.handoff === 'Each can / lap') req(x.canNo, 'Can or lap number');
    const plan = ref(s.processSetups, b.recipeId);
    if (plan?.components?.length) {
      const kg = componentKg(b);
      const total = sum([...kg.values()], v => v);
      for (const c of plan.components) {
        const actual = pct(kg.get(c.key) || 0, total);
        ensure(Math.abs(actual - c.pct) <= plan.tolerancePct + EPS, 'Blend ' + b.number + ' deviates from plan ' + plan.code + ': ' + c.key + ' is ' + actual + '% of issued weight against ' + c.pct + '% ± ' + plan.tolerancePct + '%.', 422, 'blend-plan');
      }
    }
  },
  outputFields: (b, x) => ({ blend: b.number, canNo: clean(x.canNo, 40), handoff: b.handoff }),
  outputEvent: (b, x) => ({ handoff: b.handoff, canNo: clean(x.canNo, 40) }),
  outputLabel: b => 'Prepared fibre · ' + b.recipe.blend, recipeText: b => b.recipe.code + ' r' + b.recipe.version + ' · ' + b.recipe.blend,
  planRows: (s, b, { setup, netKg, consumedKg, waste, rejects }) => {
    const kg = componentKg(b);
    const rows = (setup?.components ?? []).map(c => [c.key, round(netKg * c.pct / 100), kg.get(c.key) || 0, 'kg', c.pct + '% ± ' + setup.tolerancePct + '% · actual ' + pct(kg.get(c.key) || 0, netKg) + '%']);
    const droppings = round(sum(stepEvents(s, b), e => e.droppings || 0));
    return [...rows,
      ['Blowroom waste', setup ? round(consumedKg * setup.wastePct / 100) : null, round(waste + rejects), 'kg', (setup?.wastePct ?? 0) + '% of consumed'],
      ['Droppings recorded at steps', null, droppings, 'kg', 'Measured at opening and cleaning']];
  },
});

// ---------- Scan: retrieves a record, never changes stock ----------
export function scanRecord(s, payload, targetBatchId = '') {
  const text = String(payload ?? '').trim();
  ensure(text, 'Scan a bale or blend label, or type its ID.');
  const code = text.replace(/^HZ:(LOT|BLEND):/i, '');
  const lot = s.lots.find(l => same(l.id, code)) || s.lots.find(l => l.fibre?.bales?.some(bl => same(bl.no, code)));
  const batch = s.processBatches.find(b => same(b.number, code) || same(b.id, code));
  const target = ref(s.processBatches, targetBatchId);
  const wo = target ? ref(s.workOrders, target.workOrderId) : null;
  if (lot) return { kind: 'lot', lot, bales: baleHistory(s, lot), bale: lot.fibre?.bales?.find(bl => same(bl.no, code)) || null, ...lotEvidence(s, lot, wo, target) };
  if (batch) {
    const bwo = ref(s.workOrders, batch.workOrderId);
    return { kind: 'batch', batch, workOrder: bwo, lines: batch.lines.map(l => ({ line: l, lot: ref(s.lots, l.lotId), ...lotEvidence(s, ref(s.lots, l.lotId), bwo, null) })) };
  }
  ensure(false, 'No bale, lot or blend matches ' + code + ' in this company.', 404, 'not-found');
}

function lotEvidence(s, lot, wo, target) {
  const source = [lot, ...genealogy(s, lot.id)].filter(l => l.claimSource === 'receipt');
  const evidence = [...new Map((lot.checks ?? []).flatMap(c => c.evidence ?? []).map(e => [e.id, e])).values()].map(e => {
    const now = ref(s.evidence, e.id);
    return { number: e.number, scheme: now?.scheme, kind: now?.kind, status: now?.status || 'Not visible', until: now?.until || '', party: now?.party };
  });
  const needs = wo ? schemesOf(wo) : schemesOf(lot);
  let standard = { ok: true, reason: needs.length ? 'Eligible for ' + needs.join(', ') : 'No standard claim required' };
  try {
    if (wo) checkLotClaims(s, lot, needs); else checkHistory(s, lot);
  } catch (error) {
    if (error.code !== 'standard-lock') throw error;
    standard = { ok: false, reason: error.message };
  }
  let blend = null;
  if (target?.process === PREPARATION) {
    try { blend = { ok: true, component: componentFor(s, ref(s.processSetups, target.recipeId), lot) || 'Any' }; } catch (error) { blend = { ok: false, reason: error.message }; }
  }
  let physical = { ok: true, reason: 'Released in own custody' };
  try { usable(s, lot, today(s.settings.timeZone)); } catch (error) { physical = { ok: false, reason: error.message }; }
  return { sources: source.map(l => ({ id: l.id, origin: l.origin, party: l.party, grower: l.intake?.grower, ginner: l.fibre?.ginner, variety: l.variety, date: l.date })),
    evidence, standard, blend, physical };
}

// Share of each ancestor lot that ended up in this lot, following actual consumption links.
export function contributions(s, lot) {
  const byId = new Map(s.lots.map(l => [l.id, l]));
  const graph = [lot, ...genealogy(s, lot.id)];
  const waiting = new Map(graph.map(l => [l.id, 0]));
  for (const child of graph) for (const p of child.parents ?? []) if (waiting.has(p.id)) waiting.set(p.id, waiting.get(p.id) + 1);
  const fraction = new Map([[lot.id, 1]]);
  const queue = graph.filter(l => waiting.get(l.id) === 0);
  for (let i = 0; i < queue.length; i++) {
    const l = queue[i];
    for (const p of l.parents ?? []) {
      const parent = byId.get(p.id);
      if (!parent?.initialQty || !waiting.has(p.id)) continue;
      fraction.set(p.id, (fraction.get(p.id) || 0) + (fraction.get(l.id) || 0) * p.qty / parent.initialQty);
      waiting.set(p.id, waiting.get(p.id) - 1);
      if (waiting.get(p.id) === 0) queue.push(parent);
    }
  }
  return graph.slice(1).map(l => ({ lot: l, share: round(fraction.get(l.id) || 0),
    kg: round((fraction.get(l.id) || 0) * (l.netKg ?? (l.unit === 'kg' ? l.initialQty : 0))) }));
}

// Input bale history for any downstream lot (yarn, prepared fibre, fabric): each bale lot, the
// blend issues that drew on it and the weight attributable to this lot.
export function baleHistory(s, lot) {
  return contributions(s, lot).filter(c => LINT_MATERIALS.includes(c.lot.material)).map(c => ({
    ...c, bales: c.lot.fibre?.bales ?? [], origin: c.lot.origin, supplier: c.lot.party, ginner: c.lot.fibre?.ginner, variety: c.lot.variety,
    ginRun: c.lot.fibre?.ginRun || '', growers: c.lot.fibre?.growers || '',
    blendIssues: s.events.filter(e => e.kind === 'Process issue' && e.process === PREPARATION && !e.reversedBy && e.inputs.some(i => i.id === c.lot.id))
      .map(e => ({ blend: ref(s.processBatches, e.batchId)?.number, date: e.date, kg: e.inputs.find(i => i.id === c.lot.id).kg, reference: e.reference })),
    evidence: [...new Map((c.lot.checks ?? []).flatMap(d => d.evidence ?? []).map(e => [e.id, e])).values()].map(e => ({ number: e.number, status: ref(s.evidence, e.id)?.status || 'Not visible' })),
  }));
}

export const ginOpen = ginning.open;
export const blendOpen = preparation.open;
