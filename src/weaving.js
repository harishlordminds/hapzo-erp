// Weaving mill with separate warp and weft paths on the shared batch engine.
// Warp path: warping set (allocated warp lots → warper's beams) → sizing set (beams + size chemical lots →
// loom beam) when the construction specifies sizing → drawing-in or tying-in on a loom.
// Weft path: weft allocation → preparation → feeders and package changes at the loom.
// Loom run: rolls are cut into segments at each weft change so every segment keeps its actual weft lots.
import { EPS, key, req, clean, choice, number, decimal, quantity, date, id, ref, record, ensure, norm, round, sum, csvLines, genealogy } from './model.js';
import { newLot, lotKey, post, stockMove, usable } from './stock.js';
import { location } from './commerce.js';
import { checkHistory } from './standards.js';
import { same } from './claim-scope.js';
import { openAssignments } from './yarn-allocation.js';
import { lotCount } from './knitting.js';
import {
  engine, readRates, openBatch, batchWork, postingDate, batchReference, track, standardCheck, reconcile, consumeWip, parentLinks,
  spreadCosts, wipKg, wipMove, lineRemainingKg, ALLOCATION_BASIS,
} from './process-batch.js';

export const WEAVE = 'Weave construction';
export const LOOM = 'Loom';
export const WEAVES = ['Plain', 'Twill 2/1', 'Twill 3/1', 'Satin', 'Oxford', 'Dobby', 'Jacquard', 'Other'];
export const LOOM_TYPES = ['Rapier', 'Air-jet', 'Projectile', 'Water-jet', 'Shuttle'];
export const WEFT_PREP = ['None', 'Rewinding to weft cones', 'Pirn winding', 'Conditioning / steaming', 'Waxing'];
export const DRESSING = ['Drawing-in', 'Tying-in'];
const ROUTE_FOR = { B: true, D: false };
const YARN = ['Yarn', 'Dyed yarn'];

const latestSetup = (s, process, machineId, on = '9999-12-31') => s.processSetups.filter(r => r.process === process && r.machineId === machineId && r.effective <= on)
  .sort((a, b) => b.effective.localeCompare(a.effective) || b.at.localeCompare(a.at))[0] || null;
export const loomProfile = (s, machineId, on) => latestSetup(s, LOOM, machineId, on);
const sequence = (input, label, unitLabel) => csvLines(input, label, 2).map(([colour, n]) => ({ colour: req(colour, label + ' colour', 60), [unitLabel]: number(n, unitLabel + ' of ' + colour, 1, 100000) }));
const colours = rows => [...new Map(rows.map(r => [norm(r.colour), r.colour])).values()];

export function loomSetup(s, x, ctx) {
  const machine = record(s.machines, x.machineId, 'loom');
  const row = {
    id: id(s, 'LMP'), process: LOOM, machineId: machine.id, machine: machine.code + ' · ' + machine.name, code: machine.code,
    version: String(s.processSetups.filter(r => r.process === LOOM && r.machineId === machine.id).length + 1),
    type: choice(x.type, LOOM_TYPES, 'loom type'), widthCm: number(x.widthCm, 'Reed width cm', 10, 600), selectors: number(x.selectors || '1', 'Weft selectors', 1, 16),
    shedding: clean(x.shedding, 60), effective: date(x.effective), reference: req(x.reference, 'Loom setting or audit reference'), status: 'Approved', actor: ctx.actor, at: ctx.at,
  };
  s.processSetups.push(row);
  return row;
}

export function weaveSetup(s, x, ctx) {
  const code = key(x.code, 'Construction code');
  const version = req(x.version, 'Revision', 40);
  ensure(!s.processSetups.some(r => r.process === WEAVE && norm(r.code) === norm(code) && norm(r.version) === norm(version)), 'Construction ' + code + ' revision ' + version + ' already exists.');
  const yarnDyed = x.yarnDyed === 'yes';
  const warpSequence = sequence(x.warpSequence, 'Warp colour sequence', 'ends');
  const weftSequence = sequence(x.weftSequence, 'Weft insertion sequence', 'picks');
  ensure(yarnDyed || !warpSequence.length && !weftSequence.length, 'Colour sequences apply to yarn-dyed constructions.');
  ensure(!yarnDyed || warpSequence.length && weftSequence.length, 'Enter the warp colour sequence (colour, ends) and the weft insertion sequence (colour, picks).');
  const revises = x.revises ? record(s.processSetups, x.revises, 'construction being revised') : null;
  ensure(!revises || revises.process === WEAVE && norm(revises.code) === norm(code) && revises.status === 'Approved', 'Revise the current approved revision of ' + code + '.');
  const row = {
    id: id(s, 'WVC'), process: WEAVE, code, version, effective: date(x.effective), bomCode: clean(x.bomCode, 64).toUpperCase(),
    weave: choice(x.weave, WEAVES, 'weave'), yarnDyed,
    ends: quantity(x.ends, 'Total warp ends', 'pcs'), reedDents: x.reedDents ? number(x.reedDents, 'Reed dents per inch', 1, 400) : null,
    endsPerDent: x.endsPerDent ? quantity(x.endsPerDent, 'Ends per dent', 'pcs') : null, reedSpaceCm: number(x.reedSpaceCm, 'Reed space cm', 5, 600),
    picksPerCm: number(x.picksPerCm, 'Picks per cm', 1, 200), warpCount: number(x.warpCount, 'Warp count', 0.1, 2000), weftCount: number(x.weftCount, 'Weft count', 0.1, 2000),
    countSystem: choice(x.countSystem || 'Ne', ['Ne', 'Nm', 'tex', 'den'], 'count system'),
    warpCrimp: number(x.warpCrimp || '0', 'Warp crimp %', 0, 40), weftCrimp: number(x.weftCrimp || '0', 'Weft crimp %', 0, 40),
    warpSequence, weftSequence, warpColours: colours(warpSequence), weftColours: colours(weftSequence),
    sizing: x.sizing === 'yes', sizeRecipe: clean(x.sizeRecipe, 300), weftPrep: choice(x.weftPrep || 'None', WEFT_PREP, 'weft preparation'),
    loomType: choice(x.loomType, LOOM_TYPES, 'loom type'), widthCm: x.widthCm ? number(x.widthCm, 'Greige width cm', 5, 600) : null, gsm: x.gsm ? number(x.gsm, 'Target GSM', 10, 1500) : null,
    yieldPct: number(x.yieldPct || '100', 'Planned yield %', 1, 100), ...readRates(x),
    reference: req(x.reference, 'Construction approval reference'), status: 'Approved', actor: ctx.actor, at: ctx.at,
    revises: revises?.id || '', revisionReason: revises ? req(x.revisionReason, 'Reason for the revision', 400) : '',
  };
  ensure(!row.sizing || row.sizeRecipe, 'Record the size recipe for a sized warp.');
  ensure(!warpSequence.length || row.ends % sum(warpSequence, r => r.ends) === 0, 'Total ends must be a whole number of warp colour repeats (' + sum(warpSequence, r => r.ends) + ' ends per repeat).');
  if (revises) {
    revises.status = 'Superseded';
    revises.supersededBy = row.id;
  }
  s.processSetups.push(row);
  return row;
}

function routeMatch(s, spec, wo) {
  const route = wo.componentRoute;
  if (!route) return;
  ensure(Object.hasOwn(ROUTE_FOR, route.template), 'Woven fabric runs on route B or D. Work order ' + wo.number + ' uses route ' + route.template + '.');
  ensure(ROUTE_FOR[route.template] === spec.yarnDyed, 'Route ' + route.template + ' weaves ' + (ROUTE_FOR[route.template] ? 'yarn-dyed' : 'greige') + ' fabric. Construction ' + spec.code + ' is ' + (spec.yarnDyed ? 'yarn-dyed' : 'greige') + '.', 422, 'route-skip');
  ensure(spec.sizing === route.stages.includes('Sizing'), spec.sizing ? 'Construction ' + spec.code + ' specifies a sized warp. Use a route that includes Sizing and Desizing.' : 'Route ' + route.template + ' includes Sizing but construction ' + spec.code + ' does not specify it.', 422, 'route-skip');
  ensure(!spec.bomCode || same(spec.bomCode, route.component), 'Construction ' + spec.code + ' is for component ' + spec.bomCode + ', not ' + route.component + '.');
}

function yarnChecks(s, spec, lot, role) {
  const wantColours = role === 'Warp' ? spec.warpColours : spec.weftColours;
  if (spec.yarnDyed) {
    ensure(lot.material === 'Dyed yarn', 'Construction ' + spec.code + ' is yarn-dyed. ' + role + ' lot ' + lot.id + ' is ' + lot.material.toLowerCase() + '.');
    ensure(wantColours.some(c => same(c, lot.colour)), role + ' lot ' + lot.id + ' is ' + (lot.colour || 'an unrecorded colour') + '. The ' + role.toLowerCase() + ' sequence uses ' + wantColours.join(', ') + '.');
  } else ensure(lot.material === 'Yarn', 'Construction ' + spec.code + ' weaves greige from undyed yarn. Lot ' + lot.id + ' is ' + lot.material.toLowerCase() + '.');
  const count = lotCount(s, lot);
  const want = role === 'Warp' ? spec.warpCount : spec.weftCount;
  if (count) ensure(count.system === spec.countSystem && Math.abs(count.count - want) < EPS, role + ' lot ' + lot.id + ' is ' + count.count + ' ' + count.system + '. The construction needs ' + want + ' ' + spec.countSystem + '.', 422, 'yarn-count');
  return count ? count.count + ' ' + count.system + ' recorded on ' + count.source : 'Count not recorded on lot; construction specifies ' + want + ' ' + spec.countSystem;
}

function allocated(lot, wo, role) {
  ensure((lot.assignments ?? []).some(a => a.workOrderId === wo.id && a.role === role && a.qty - a.used > EPS),
    'Allocate lot ' + lot.id + ' as ' + role.toLowerCase() + ' to ' + wo.number + ' before issuing it.', 422, 'yarn-allocation');
}

const steps = (s, b) => s.events.filter(e => e.batchId === b.id && e.kind === 'Process entry' && !e.reversedBy);
const snapshot = r => ({ code: r.code, version: r.version, weave: r.weave, yarnDyed: r.yarnDyed, ends: r.ends,
  variety: r.weave + (r.yarnDyed ? ' yarn-dyed ' + [...new Set([...r.warpColours, ...r.weftColours])].join('/') : ' greige') + ' · ' + r.ends + ' ends' });

// ---------- Warp path ----------
export const warping = engine({
  process: 'Warping', prefix: 'WRS', batchLabel: 'Warp set', setupLabel: 'weave construction', setupRequired: true, setupProcess: WEAVE,
  workUnits: ['kg'], inputs: YARN, outputMaterial: 'Warp beam', outputUnits: ['kg'], steps: ['Creel loading', 'Warping', 'Beam doffing'], method: 'HZ-WRP-MASS-1',
  setupSnapshot: snapshot,
  batchFields: (s, x) => {
    const spec = record(s.processSetups, x.recipeId, 'weave construction');
    routeMatch(s, spec, record(s.workOrders, x.workOrderId, 'work order'));
    return { construction: spec.code + ' r' + spec.version, beamsEnds: 0 };
  },
  issueLine: (s, b, lot) => {
    const spec = ref(s.processSetups, b.recipeId);
    allocated(lot, ref(s.workOrders, b.workOrderId), 'Warp');
    return { colour: lot.colour || '', countBasis: yarnChecks(s, spec, lot, 'Warp') };
  },
  outputLabel: () => 'Warp beam', recipeText: b => b.recipe.code + ' r' + b.recipe.version + ' · ' + b.recipe.variety,
  planRows: (s, b, { consumedKg, acceptedKg, waste }) => [['Beams', null, acceptedKg, 'kg', 'Warper’s or weaver’s beams'], ['Warping waste', null, waste, 'kg', 'Of ' + consumedKg + ' kg consumed']],
});

export const sizing = engine({
  process: 'Sizing', prefix: 'SZS', batchLabel: 'Sizing set', setupLabel: 'weave construction', setupRequired: true, setupProcess: WEAVE,
  workUnits: ['kg'], inputs: ['Warp beam'], outputMaterial: 'Warp beam', outputUnits: ['kg'], steps: ['Size preparation', 'Creel loading', 'Sizing', 'Drying', 'Beaming'], method: 'HZ-SZ-MASS-1',
  setupSnapshot: snapshot,
  batchFields: (s, x) => {
    const spec = record(s.processSetups, x.recipeId, 'weave construction');
    ensure(spec.sizing, 'Construction ' + spec.code + ' does not specify sizing.');
    routeMatch(s, spec, record(s.workOrders, x.workOrderId, 'work order'));
    return { construction: spec.code + ' r' + spec.version };
  },
  issueLine: (s, b, lot) => {
    ensure(lot.weave?.beamType === 'Warper beam' && lot.weave.construction === b.construction, 'Beam ' + lot.id + ' is not a warper’s beam of construction ' + b.construction + '.');
    return { ends: lot.weave.ends };
  },
  outputLabel: () => 'Loom beam', recipeText: b => b.recipe.code + ' r' + b.recipe.version + ' · ' + b.recipe.variety,
  planRows: (s, b, { consumedKg, acceptedKg, waste }) => [['Loom beams', null, acceptedKg, 'kg', 'Including size add-on'], ['Sizing waste', null, waste, 'kg', 'Of ' + consumedKg + ' kg warp consumed'],
    ...b.load.chemicals.map(c => [c.code, null, c.qty, c.unit, 'Size chemical lot ' + c.lotId])],
});

// Beam output for warping and sizing: one or more beams with ends, metres and kg.
function beamOutput(api, kind) {
  return (s, x, ctx) => {
    const cfg = api.cfg;
    const b = openBatch(s, x.batchId, cfg.process);
    const wo = batchWork(s, b);
    const day = postingDate(b, x.date);
    const reference = batchReference(s, b, x.reference, 'Beam doffing reference');
    const spec = record(s.processSetups, b.recipeId, 'weave construction');
    ensure(steps(s, b).some(e => e.step === (kind === 'Sizing' ? 'Sizing' : 'Warping')), 'Record the ' + kind.toLowerCase() + ' step before doffing beams from ' + b.number + '.', 422, 'route-skip');
    const before = wipKg(b);
    ensure(before > 0, b.number + ' has nothing in process.');
    const beams = csvLines(x.beams, 'Beam', 4).map(([beamId, ends, metres, kg]) => ({ id: lotKey(s, beamId), ends: quantity(ends, 'Ends on ' + beamId, 'pcs'),
      metres: decimal(metres, 'Metres on ' + beamId, 0.000001), kg: decimal(kg, 'Net kg on ' + beamId, 0.000001) }));
    ensure(beams.length && new Set(beams.map(r => norm(r.id))).size === beams.length, 'Enter each beam once: beam ID, ends, metres and kg.');
    const loomBeam = kind === 'Sizing' || !spec.sizing;
    if (loomBeam) for (const beam of beams) ensure(beam.ends === spec.ends, 'Loom beam ' + beam.id + ' must carry all ' + spec.ends + ' ends of ' + spec.code + '.');
    if (kind === 'Warping') {
      ensure(!spec.warpColours.length || spec.warpColours.every(c => b.lines.some(l => same(l.colour, c))), 'Issue every warp colour (' + spec.warpColours.join(', ') + ') before doffing beams.');
      ensure(round(b.beamsEnds + sum(beams, r => r.ends)) <= spec.ends || loomBeam, 'Warper’s beams in set ' + b.number + ' exceed the ' + spec.ends + ' ends of the construction.');
    } else {
      const ends = sum(b.lines.filter(l => l.issued - l.returned > 0), l => l.ends);
      ensure(ends === spec.ends, 'Issue warper’s beams carrying all ' + spec.ends + ' ends before sizing (issued ' + ends + ').', 422, 'genealogy');
      ensure(b.load.chemicals.length, 'Record the size chemical lots used on the sizing step before doffing the loom beam.', 422, 'genealogy');
    }
    const outKg = round(sum(beams, r => r.kg));
    const r = reconcile(x, outKg, before);
    ensure(round(wo.completedQty + outKg) <= wo.plannedQty, 'Beams exceed work order ' + wo.number + '.');
    const dest = location(s, x.locationId || b.locationId);
    ensure(dest.site === b.site, 'Post beams at ' + b.site + '.');
    const used = consumeWip(s, b, r.consumedKg, x.consumption);
    for (const lot of used.sources) checkHistory(s, lot);
    const { checks, usage } = standardCheck(s, cfg, wo, b, day, { consume: true, amount: outKg, lots: used.sources });
    const outs = beams.map(beam => newLot(s, beam.id, beam.kg, 'kg', day, dest, {
      material: 'Warp beam', label: (loomBeam ? 'Loom beam' : 'Warper’s beam') + ' · ' + spec.code + ' · ' + beam.ends + ' ends', stage: cfg.process,
      ownerId: b.ownerId || '', workOrderId: wo.id, batchId: b.id, scheme: wo.scheme, additionalSchemes: wo.additionalSchemes, checks, qualityStatus: 'Released',
      netKg: beam.kg, lengthM: beam.metres, conversionBasis: 'Beam weighed and metre counter at doffing',
      weave: { construction: b.construction, beamType: loomBeam ? 'Loom beam' : 'Warper beam', ends: beam.ends, sized: kind === 'Sizing', set: b.number,
        warpSequence: spec.warpSequence, sizeRecipe: kind === 'Sizing' ? spec.sizeRecipe : '' },
      parents: parentLinks(used.consumption, used.chemicals, used.sources, beam.kg / outKg),
      resources: Object.fromEntries(['electricity', 'water', 'steam'].map(k => [k, round(used.resources[k] * beam.kg / outKg)])),
    }));
    if (kind === 'Warping') b.beamsEnds = round(b.beamsEnds + sum(beams, beam => beam.ends));
    const e = post(s, 'Production', ctx, {
      date: day, stage: cfg.process, process: cfg.process, type: 'Run', workOrderId: wo.id, batchId: b.id, lineRevision: wo.lineRevision,
      inputs: parentLinks(used.consumption, used.chemicals, used.sources), output: outs[0].id, outputs: outs.map(l => l.id), qty: outKg, unit: 'kg', site: b.site, allocations: [],
      reconciliation: { unit: 'kg', input: r.consumedKg, accepted: outKg, waste: r.waste, rejects: r.rejects, adjustment: r.adjustment, reference: r.adjustmentRef, basis: 'Measured kg' },
      beams, reference, recipe: cfg.recipeText(b), shift: clean(x.shift, 40), operator: clean(x.operator, 100), machineId: b.machineId, machineName: b.machineName, readingId: '',
      ...used.resources, chemicals: used.chemicals, consumption: used.consumption, share: round(used.share), allocationBasis: 'Beam mass share; ' + ALLOCATION_BASIS.toLowerCase(),
      methodVersion: cfg.method, completedAdd: outKg, evidenceUsage: usage, processCost: [], costIds: [], checks,
      moves: [...used.consumption.map(c => wipMove(b, c.lotId, -c.qty, c.unit)), ...outs.map(l => stockMove(l, l.qty))], document: ctx.document(x.document, ['production']),
    });
    spreadCosts(s, e, outs, day, reference, spec, used.resources, round(r.waste + r.rejects));
    for (const lot of outs) lot.eventId = e.id;
    b.outputs.push(...outs.map(l => l.id));
    wo.completedQty = round(wo.completedQty + outKg);
    wo.status = wo.completedQty >= wo.plannedQty ? 'Completed' : 'In progress';
    track(b, e, 'Output', day);
    return outs[0];
  };
}
export const warpBeams = beamOutput(warping, 'Warping');
export const sizeBeams = beamOutput(sizing, 'Sizing');

// Drawing-in or tying-in makes a loom beam ready on one loom.
export function dressBeam(s, x, ctx) {
  const beam = record(s.lots, x.lotId, 'loom beam');
  ensure(beam.material === 'Warp beam' && beam.weave?.beamType === 'Loom beam', 'Choose a loom beam (a sized beam, or an unsized beam carrying all ends).');
  const day = date(x.date);
  usable(s, beam, day);
  const loom = record(s.machines, x.loomId, 'loom');
  const profile = loomProfile(s, loom.id, day);
  ensure(profile, 'Record the loom type and width for ' + loom.code + ' first.');
  ensure(!beam.dressing || beam.dressing.reversed, 'Beam ' + beam.id + ' is already dressed on ' + beam.dressing?.loom + '.');
  const method = choice(x.method, DRESSING, 'dressing method');
  const previous = method === 'Tying-in' ? record(s.lots, x.previousBeamId, 'beam being replaced') : null;
  ensure(!previous || previous.dressing?.loomId === loom.id, 'Tying-in knots onto the beam running on ' + loom.code + '. ' + (previous?.id || '') + ' is not on that loom.');
  const ends = quantity(x.ends, 'Ends drawn or tied', 'pcs');
  ensure(ends === beam.weave.ends, 'Ends drawn or tied (' + ends + ') must equal the ends on beam ' + beam.id + ' (' + beam.weave.ends + ').');
  beam.dressing = { method, loomId: loom.id, loom: loom.code, previousBeamId: previous?.id || '', ends, healds: clean(x.healds, 120), reed: clean(x.reed, 80),
    operator: req(x.operator, 'Drawer or tier', 100), date: day, reference: req(x.reference, 'Drawing-in or tying-in reference') };
  beam.lastDate = day;
  return post(s, 'Beam ' + method.toLowerCase(), ctx, { date: day, output: beam.id, qty: beam.qty, unit: beam.unit, reference: beam.dressing.reference, loom: loom.code, method, previousBeamId: previous?.id || '' });
}

// ---------- Weft path ----------
export function prepareWeft(s, x, ctx) {
  const lot = record(s.lots, x.lotId, 'weft lot');
  ensure(YARN.includes(lot.material), 'Prepare yarn or dyed yarn lots only.');
  const day = date(x.date);
  usable(s, lot, day);
  ensure(openAssignments(lot).some(a => a.role === 'Weft'), 'Allocate lot ' + lot.id + ' as weft to a weaving work order before preparing it.', 422, 'yarn-allocation');
  const method = choice(x.method, WEFT_PREP.filter(m => m !== 'None'), 'weft preparation');
  const qty = quantity(x.qty, 'Packages prepared in lot unit', lot.unit);
  ensure(qty <= lot.qty, 'Preparation exceeds lot ' + lot.id + ' on hand.');
  lot.weftPrep ??= [];
  lot.weftPrep.push({ method, qty, packages: x.packages ? quantity(x.packages, 'Packages produced', 'pcs') : null, date: day,
    machine: x.machineId ? record(s.machines, x.machineId, 'machine').code : '', reference: req(x.reference, 'Preparation reference') });
  return post(s, 'Weft preparation', ctx, { date: day, output: lot.id, qty, unit: lot.unit, method, reference: x.reference });
}

// Weft state at a loom metre: the feeder plan from the weaving step, then package changes in metre order.
export function weftState(s, b, atMetre) {
  const entries = steps(s, b);
  const feed = entries.find(e => e.weftFeed?.length);
  if (!feed) return null;
  const state = new Map(feed.weftFeed.map(f => [f.feeder, { ...f }]));
  for (const change of entries.filter(e => e.weftChange && e.weftChange.atMetre <= atMetre).sort((p, q) => p.weftChange.atMetre - q.weftChange.atMetre)) {
    state.set(change.weftChange.feeder, { ...state.get(change.weftChange.feeder), lotId: change.weftChange.toLot, since: change.weftChange.atMetre, changeEvent: change.id });
  }
  return state;
}
const postedMetres = (s, b) => round(sum(s.events.filter(e => e.batchId === b.id && e.kind === 'Production' && !e.reversedBy), e => e.roll.metres));

// ---------- Loom run ----------
export const weaving = engine({
  process: 'Weaving', prefix: 'LMR', batchLabel: 'Loom run', setupLabel: 'weave construction', setupRequired: true, setupProcess: WEAVE,
  workUnits: ['kg'], inputs: ['Warp beam', ...YARN], outputMaterial: 'Greige fabric', outputUnits: ['kg'],
  steps: ['Beam gaiting', 'Weaving', 'Weft package change', 'Loom stoppage', 'Doffing'], method: 'HZ-WV-SEG-1',
  setupSnapshot: snapshot,
  batchFields: (s, x) => {
    const spec = record(s.processSetups, x.recipeId, 'weave construction');
    const day = date(x.date);
    const profile = loomProfile(s, x.machineId, day);
    ensure(profile, 'Record the loom type and width for this machine before opening a run.', 422, 'machine');
    ensure(profile.type === spec.loomType && profile.widthCm >= spec.reedSpaceCm && profile.selectors >= Math.max(1, spec.weftColours.length),
      'Construction ' + spec.code + ' needs a ' + spec.loomType.toLowerCase() + ' loom of at least ' + spec.reedSpaceCm + ' cm reed width' + (spec.weftColours.length > 1 ? ' with ' + spec.weftColours.length + ' weft selectors' : '') +
      '. ' + profile.machine + ' is a ' + profile.type.toLowerCase() + ' loom, ' + profile.widthCm + ' cm, ' + profile.selectors + ' selector(s).', 422, 'machine');
    routeMatch(s, spec, record(s.workOrders, x.workOrderId, 'work order'));
    return { construction: spec.code + ' r' + spec.version, loomType: profile.type };
  },
  issueLine: (s, b, lot) => {
    const spec = ref(s.processSetups, b.recipeId);
    if (lot.material === 'Warp beam') {
      ensure(lot.weave?.beamType === 'Loom beam' && lot.weave.construction === b.construction, 'Beam ' + lot.id + ' is not a loom beam of construction ' + b.construction + '.');
      ensure(lot.dressing && lot.dressing.loomId === b.machineId, 'Beam ' + lot.id + ' is not drawn in or tied in on ' + b.machineName + '.', 422, 'genealogy');
      ensure(!b.lines.some(l => ref(s.lots, l.lotId)?.material === 'Warp beam' && lineRemainingKg(l) > EPS), 'A loom run weaves one beam. Close this run before gaiting the next beam.');
      return { role: 'Warp', ends: lot.weave.ends };
    }
    allocated(lot, ref(s.workOrders, b.workOrderId), 'Weft');
    if (spec.weftPrep !== 'None') ensure((lot.weftPrep ?? []).some(p => p.method === spec.weftPrep), 'Construction ' + spec.code + ' requires ' + spec.weftPrep.toLowerCase() + ' before weft lot ' + lot.id + ' is inserted.', 422, 'genealogy');
    return { role: 'Weft', colour: lot.colour || '', countBasis: yarnChecks(s, spec, lot, 'Weft') };
  },
  entryFields: (s, x, b) => {
    const issued = lotId => b.lines.some(l => same(l.lotId, lotId) && ref(s.lots, l.lotId)?.material !== 'Warp beam');
    const spec = ref(s.processSetups, b.recipeId);
    const colourOf = lotId => ref(s.lots, b.lines.find(l => same(l.lotId, lotId))?.lotId)?.colour || '';
    if (x.step === 'Weaving' && x.weftFeed) {
      ensure(!steps(s, b).some(e => e.weftFeed?.length), 'The feeder plan is already recorded. Record a weft package change instead.');
      const feed = csvLines(x.weftFeed, 'Weft feeder', 2).map(([feeder, lotId]) => {
        ensure(issued(lotId), 'Weft lot ' + lotId + ' is not issued to loom run ' + b.number + '.', 422, 'genealogy');
        const lot = b.lines.find(l => same(l.lotId, lotId)).lotId;
        return { feeder: req(feeder, 'Feeder', 20), lotId: lot, colour: colourOf(lot), since: 0 };
      });
      ensure(new Set(feed.map(f => f.feeder)).size === feed.length, 'List each feeder once.');
      ensure(!spec.weftColours.length || spec.weftColours.every(c => feed.some(f => same(f.colour, c))), 'The feeder plan must carry every weft colour: ' + spec.weftColours.join(', ') + '.');
      return { weftFeed: feed, insertion: spec.weftSequence };
    }
    if (x.step === 'Weft package change') {
      const atMetre = decimal(x.atMetre, 'Loom metre counter at the change');
      ensure(atMetre >= postedMetres(s, b), 'The change at ' + atMetre + ' m falls inside rolls already posted (to ' + postedMetres(s, b) + ' m).');
      const state = weftState(s, b, atMetre);
      ensure(state, 'Record the feeder plan on the weaving step first.', 422, 'genealogy');
      const feeder = req(x.feeder, 'Feeder', 20);
      ensure(state.has(feeder), 'Feeder ' + feeder + ' is not in the feeder plan.');
      const toLot = req(x.toLot, 'New weft lot', 64);
      ensure(issued(toLot), 'Weft lot ' + toLot + ' is not issued to loom run ' + b.number + '.', 422, 'genealogy');
      const to = b.lines.find(l => same(l.lotId, toLot)).lotId;
      ensure(!state.get(feeder).colour || same(colourOf(to), state.get(feeder).colour), 'Feeder ' + feeder + ' inserts ' + state.get(feeder).colour + '. Lot ' + to + ' is ' + (colourOf(to) || 'uncoloured') + '.');
      ensure(to !== state.get(feeder).lotId, 'Feeder ' + feeder + ' already runs lot ' + to + '.');
      return { weftChange: { feeder, fromLot: state.get(feeder).lotId, toLot: to, atMetre, packages: x.packages ? quantity(x.packages, 'Packages changed', 'pcs') : null } };
    }
    return {};
  },
  outputLabel: () => 'Greige fabric', recipeText: b => b.recipe.code + ' r' + b.recipe.version + ' · ' + b.recipe.variety,
  planRows: (s, b, { setup, consumedKg, acceptedKg, waste }) => [['Fabric', setup ? round(consumedKg * setup.yieldPct / 100) : null, acceptedKg, 'kg', (setup?.yieldPct ?? '—') + '% planned yield'],
    ['Loom waste', null, waste, 'kg', 'Selvedge, fringe and weft waste'], ['Metres woven', null, postedMetres(s, b), 'm', 'Sum of posted rolls']],
});

// Doffs one roll. The roll's metres on the loom counter are cut into segments at each weft change; the warp is
// drawn from the beam by length with crimp, and the weft is the measured roll weight less the warp, by segment.
export function loomRoll(s, x, ctx) {
  const b = openBatch(s, x.batchId, 'Weaving');
  const wo = batchWork(s, b);
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Doffing reference');
  const spec = record(s.processSetups, b.recipeId, 'weave construction');
  ensure(steps(s, b).some(e => e.step === 'Weaving'), 'Record the weaving step before doffing a roll.', 422, 'route-skip');
  const rollId = lotKey(s, x.rollId);
  const metres = decimal(x.metres, 'Woven metres', 0.000001);
  const kg = decimal(x.kg, 'Measured roll kg', 0.000001);
  const waste = decimal(x.waste || '0', 'Loom waste kg');
  // Warp genealogy: a dressed loom beam in the run that traces to warp yarn.
  const beamLines = b.lines.filter(l => ref(s.lots, l.lotId)?.material === 'Warp beam' && lineRemainingKg(l) > EPS);
  ensure(beamLines.length === 1, 'Warp genealogy missing · issue the drawn-in loom beam to run ' + b.number + ' before doffing.', 422, 'genealogy');
  const beam = ref(s.lots, beamLines[0].lotId);
  ensure(beam.dressing?.loomId === b.machineId, 'Warp genealogy missing · beam ' + beam.id + ' is not dressed on ' + b.machineName + '.', 422, 'genealogy');
  ensure(genealogy(s, beam.id).some(l => YARN.includes(l.material)), 'Warp genealogy missing · beam ' + beam.id + ' does not trace to warp yarn lots.', 422, 'genealogy');
  ensure(beam.lengthM, 'Beam ' + beam.id + ' has no measured length.', 422, 'genealogy');
  const warpKg = round(metres * (1 + spec.warpCrimp / 100) * beam.netKg / beam.lengthM);
  ensure(warpKg <= lineRemainingKg(beamLines[0]) + EPS, 'The roll needs ' + warpKg + ' kg of warp; beam ' + beam.id + ' has ' + lineRemainingKg(beamLines[0]) + ' kg left in the run.', 422, 'genealogy');
  const weftKg = round(kg + waste - warpKg);
  ensure(weftKg > 0, 'Measured roll kg (' + kg + ') plus waste is not more than the warp drawn (' + warpKg + ' kg). Check the roll weight or metres.');
  // Weft genealogy: the feeder plan and every change inside the roll.
  const from = postedMetres(s, b);
  const to = round(from + metres);
  ensure(weftState(s, b, from), 'Weft genealogy missing · record the weft feeder plan on the weaving step.', 422, 'genealogy');
  const changes = [...new Set(steps(s, b).filter(e => e.weftChange && e.weftChange.atMetre > from && e.weftChange.atMetre < to).map(e => e.weftChange.atMetre))].sort((p, q) => p - q);
  const cuts = [from, ...changes, to];
  const picks = new Map(spec.weftSequence.map(w => [norm(w.colour), w.picks]));
  const segments = [];
  const need = new Map();
  let left = weftKg;
  cuts.slice(1).forEach((end, i) => {
    const start = cuts[i];
    const state = [...weftState(s, b, start).values()];
    const total = sum(state, f => picks.get(norm(f.colour)) ?? 1);
    const segKg = i === cuts.length - 2 ? left : round(weftKg * (end - start) / metres);
    left = round(left - segKg);
    let segLeft = segKg;
    const weft = state.map((f, j) => {
      const share = j === state.length - 1 ? segLeft : round(segKg * (picks.get(norm(f.colour)) ?? 1) / total);
      segLeft = round(segLeft - share);
      need.set(f.lotId, round((need.get(f.lotId) || 0) + share));
      return { feeder: f.feeder, lotId: f.lotId, colour: f.colour, kg: share, since: f.since };
    });
    segments.push({ seq: i + 1, fromM: start, toM: end, metres: round(end - start), warpBeam: beam.id, warpKg: round(warpKg * (end - start) / metres), weft });
  });
  for (const [lotId, kgNeeded] of need) {
    const line = b.lines.filter(l => l.lotId === lotId);
    ensure(line.length, 'Weft genealogy missing · lot ' + lotId + ' on a feeder is not issued to run ' + b.number + '.', 422, 'genealogy');
    ensure(kgNeeded <= sum(line, lineRemainingKg) + EPS, 'Weft genealogy missing · the roll needs ' + kgNeeded + ' kg of ' + lotId + ' but only ' + round(sum(line, lineRemainingKg)) +
      ' kg is issued to the run. Issue more of the lot or record the package change.', 422, 'genealogy');
  }
  const consumedKg = round(kg + waste);
  ensure(round(wo.completedQty + kg) <= wo.plannedQty, 'Roll exceeds work order ' + wo.number + '. Release another work order for the excess.');
  const dest = location(s, x.locationId || b.locationId);
  ensure(dest.site === b.site, 'Post rolls at ' + b.site + '.');
  const consumption = [[beam.id, warpKg], ...need].map(([lotId, n]) => lotId + ',' + n).join('\n');
  const used = consumeWip(s, b, consumedKg, consumption);
  for (const lot of used.sources) checkHistory(s, lot);
  const { checks, usage } = standardCheck(s, weaving.cfg, wo, b, day, { consume: true, amount: kg, lots: used.sources });
  const seq = s.events.filter(e => e.batchId === b.id && e.kind === 'Production' && !e.reversedBy).length + 1;
  const weave = { construction: b.construction, weave: spec.weave, yarnDyed: spec.yarnDyed, loom: b.machineName, loomType: b.loomType, run: b.number, rollSeq: seq,
    fromM: from, toM: to, metres, warpBeam: beam.id, warpKg, weftKg, segments, remnant: x.remnant === 'yes', ends: spec.ends, picksPerCm: spec.picksPerCm,
    route: wo.componentRoute ? wo.componentRoute.template + ' · ' + wo.componentRoute.stages.join(' → ') : wo.route || 'Stock weaving', shift: clean(x.shift, 40), weaver: clean(x.operator, 100) };
  const roll = newLot(s, rollId, kg, 'kg', day, dest, {
    material: 'Greige fabric', label: (x.remnant === 'yes' ? 'Remnant · ' : '') + (spec.yarnDyed ? 'Yarn-dyed ' : 'Greige ') + spec.weave.toLowerCase() + ' · ' + spec.code,
    ownerId: b.ownerId || '', stage: 'Weaving', workOrderId: wo.id, batchId: b.id, scheme: wo.scheme, additionalSchemes: wo.additionalSchemes, checks,
    qualityStatus: 'Pending inspection', composition: [...new Set(used.sources.map(l => l.composition).filter(Boolean))].join(' / '),
    netKg: kg, lengthM: metres, conversionBasis: 'Loom metre counter and roll weighed at doffing', weave, parents: parentLinks(used.consumption, used.chemicals, used.sources),
  });
  const e = post(s, 'Production', ctx, {
    date: day, stage: 'Weaving', process: 'Weaving', type: 'Run', workOrderId: wo.id, batchId: b.id, lineRevision: wo.lineRevision,
    inputs: roll.parents, output: roll.id, qty: kg, unit: 'kg', site: b.site, allocations: [], roll: { id: roll.id, seq, fromM: from, toM: to, metres },
    reconciliation: { unit: 'kg', input: consumedKg, accepted: kg, waste, rejects: 0, adjustment: 0, reference: '', basis: 'Warp by beam length with crimp; weft by measured roll weight less warp' },
    segments, reference, recipe: weaving.cfg.recipeText(b), shift: weave.shift, operator: weave.weaver, machineId: b.machineId, machineName: b.machineName, readingId: '',
    ...used.resources, chemicals: used.chemicals, consumption: used.consumption, share: round(used.share), allocationBasis: 'Warp by length; weft by segment metres and insertion picks',
    methodVersion: 'HZ-WV-SEG-1', completedAdd: kg, evidenceUsage: usage, processCost: [], costIds: [], checks,
    moves: [...used.consumption.map(c => wipMove(b, c.lotId, -c.qty, c.unit)), stockMove(roll, kg)], document: ctx.document(x.document, ['production']),
  });
  spreadCosts(s, e, [roll], day, reference, spec, used.resources, waste);
  roll.eventId = e.id;
  b.outputs.push(roll.id);
  wo.completedQty = round(wo.completedQty + kg);
  wo.status = wo.completedQty >= wo.plannedQty ? 'Completed' : 'In progress';
  track(b, e, 'Output', day);
  return roll;
}
