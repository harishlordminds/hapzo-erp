// Knitting mill on the shared batch engine. A knit run produces greige rolls from undyed yarn
// (route C: knitting → fabric dyeing → finishing) or yarn-dyed rolls from dyed yarn (route A:
// yarn dyeing → knitting → finishing). Body, rib and other components run on separate work orders.
import { EPS, key, req, clean, choice, number, decimal, date, id, ref, record, ensure, norm, round, sum, csvLines, genealogy } from './model.js';
import { newLot, lotKey, post, stockMove } from './stock.js';
import { location } from './commerce.js';
import { checkHistory } from './standards.js';
import { same } from './claim-scope.js';
import {
  engine, readRates, openBatch, batchWork, postingDate, batchReference, track, standardCheck, reconcile, consumeWip, parentLinks,
  spreadCosts, wipKg, wipMove, ALLOCATION_BASIS,
} from './process-batch.js';

export const KNITTING = 'Knitting';
export const MACHINE_PROFILE = 'Knitting machine';
export const KNIT_COMPONENTS = ['Body', 'Rib', 'Collar', 'Cuff', 'Placket', 'Other'];
export const KNIT_STRUCTURES = ['Single jersey', 'Rib 1x1', 'Rib 2x2', 'Interlock', 'Pique', 'Fleece', 'Flat knit collar', 'Other'];
export const MACHINE_TYPES = ['Circular single jersey', 'Circular double jersey (rib/interlock)', 'Flat knitting', 'Warp knitting'];
export const KNIT_STEPS = ['Yarn creel loading', 'Machine setting', 'Knitting', 'Doffing', 'Roll weighing', 'Machine stoppage'];
const ROUTE_FOR = { A: true, C: false };

export const machineProfile = (s, machineId, on = '9999-12-31') => s.processSetups
  .filter(r => r.process === MACHINE_PROFILE && r.machineId === machineId && r.effective <= on).sort((a, b) => b.effective.localeCompare(a.effective) || b.at.localeCompare(a.at))[0] || null;

export function knitMachine(s, x, ctx) {
  const machine = record(s.machines, x.machineId, 'machine');
  const row = {
    id: id(s, 'KMP'), process: MACHINE_PROFILE, machineId: machine.id, machine: machine.code + ' · ' + machine.name, code: machine.code,
    version: String(s.processSetups.filter(r => r.process === MACHINE_PROFILE && r.machineId === machine.id).length + 1),
    type: choice(x.type, MACHINE_TYPES, 'machine type'), gauge: number(x.gauge, 'Gauge (needles per inch)', 1, 60),
    diameter: x.diameter ? number(x.diameter, 'Diameter inch', 1, 60) : null, feeders: x.feeders ? number(x.feeders, 'Feeders', 1, 400) : null,
    effective: date(x.effective), reference: req(x.reference, 'Machine setting or audit reference'), status: 'Approved', actor: ctx.actor, at: ctx.at,
  };
  s.processSetups.push(row);
  return row;
}

// Approved fabric construction for one component: structure, yarn feed, colour sequence, machine type and gauge.
export function knitSetup(s, x, ctx) {
  const code = key(x.code, 'Construction code');
  const version = req(x.version, 'Revision', 40);
  ensure(!s.processSetups.some(r => r.process === KNITTING && norm(r.code) === norm(code) && norm(r.version) === norm(version)), 'Construction ' + code + ' revision ' + version + ' already exists.');
  const yarnDyed = x.yarnDyed === 'yes';
  const feeds = csvLines(x.feeds, 'Yarn feed', 3, 4).map(([role, count, system, colour]) => ({
    role: req(role, 'Feed role', 40), count: number(count, 'Yarn count for ' + role, 0.1, 2000), countSystem: choice(system, ['Ne', 'Nm', 'tex', 'den'], 'count system'),
    colour: clean(colour, 60),
  }));
  ensure(feeds.length, 'Enter the yarn feed: role, count, count system and colour for yarn-dyed fabric.');
  const stripe = csvLines(x.stripe, 'Colour sequence', 2).map(([colour, courses]) => ({ colour: req(colour, 'Stripe colour', 60), courses: number(courses, 'Courses of ' + colour, 1, 10000) }));
  ensure(!stripe.length || yarnDyed, 'A colour sequence needs yarn-dyed fabric.');
  ensure(!yarnDyed || feeds.every(f => f.colour) || stripe.length, 'Give each feed of a yarn-dyed construction its colour, or enter the colour sequence.');
  const colours = [...new Map([...feeds.map(f => f.colour), ...stripe.map(c => c.colour)].filter(Boolean).map(c => [norm(c), c])).values()];
  const revises = x.revises ? record(s.processSetups, x.revises, 'construction being revised') : null;
  ensure(!revises || revises.process === KNITTING && norm(revises.code) === norm(code) && revises.status === 'Approved', 'Revise the current approved revision of ' + code + '.');
  const row = {
    id: id(s, 'KNC'), process: KNITTING, code, version, effective: date(x.effective),
    component: choice(x.component, KNIT_COMPONENTS, 'component'), bomCode: clean(x.bomCode, 64).toUpperCase(),
    structure: choice(x.structure, KNIT_STRUCTURES, 'structure'), yarnDyed, feeds, stripe, colours,
    repeatCourses: stripe.length ? sum(stripe, c => c.courses) : null,
    machineType: choice(x.machineType, MACHINE_TYPES, 'machine type'), gauge: number(x.gauge, 'Gauge', 1, 60),
    diameter: x.diameter ? number(x.diameter, 'Diameter inch', 1, 60) : null, stitchLength: x.stitchLength ? number(x.stitchLength, 'Stitch length mm', 0.5, 20) : null,
    gsm: x.gsm ? number(x.gsm, 'Target GSM', 20, 1500) : null, width: clean(x.width, 60),
    yieldPct: number(x.yieldPct || '100', 'Planned yield %', 1, 100), ...readRates(x),
    reference: req(x.reference, 'Construction approval reference'), status: 'Approved', actor: ctx.actor, at: ctx.at,
    revises: revises?.id || '', revisionReason: revises ? req(x.revisionReason, 'Reason for the revision', 400) : '',
  };
  if (revises) {
    revises.status = 'Superseded';
    revises.supersededBy = row.id;
  }
  s.processSetups.push(row);
  return row;
}

// The nearest recorded count on the lot or its ancestors (spinning records count on yarn lots).
export function lotCount(s, lot) {
  const found = [lot, ...genealogy(s, lot.id)].find(l => l.yarn?.count);
  return found ? { count: found.yarn.count.nominal, measured: found.yarn.count.actual, system: found.yarn.count.system, source: found.id } : null;
}

const done = (s, b) => new Set(s.events.filter(e => e.batchId === b.id && e.kind === 'Process entry' && !e.reversedBy).map(e => e.step));

export const knitting = engine({
  process: KNITTING, prefix: 'KNR', batchLabel: 'Knit run', setupLabel: 'fabric construction', setupRequired: true,
  workUnits: ['kg'], inputs: ['Yarn', 'Dyed yarn'], outputMaterial: 'Greige fabric', outputUnits: ['kg'], steps: KNIT_STEPS, method: 'HZ-KNT-MASS-1',
  setupSnapshot: r => ({ code: r.code, version: r.version, component: r.component, structure: r.structure, yarnDyed: r.yarnDyed, colours: r.colours,
    variety: r.component + ' · ' + r.structure + (r.yarnDyed ? ' · yarn-dyed ' + r.colours.join('/') : ' · greige') }),
  batchFields: (s, x) => {
    const spec = record(s.processSetups, x.recipeId, 'fabric construction');
    const wo = record(s.workOrders, x.workOrderId, 'work order');
    const day = date(x.date);
    const profile = machineProfile(s, x.machineId, day);
    ensure(profile, 'Record the knitting machine type and gauge for this machine before opening a run.');
    ensure(profile.type === spec.machineType && profile.gauge === spec.gauge && (!spec.diameter || profile.diameter === spec.diameter),
      'Construction ' + spec.code + ' needs a ' + spec.machineType.toLowerCase() + ' at ' + spec.gauge + ' gauge' + (spec.diameter ? ', ' + spec.diameter + ' inch' : '') +
      '. ' + profile.machine + ' is ' + profile.type.toLowerCase() + ' at ' + profile.gauge + ' gauge' + (profile.diameter ? ', ' + profile.diameter + ' inch' : '') + '.', 422, 'machine');
    const route = wo.componentRoute;
    if (route) {
      ensure(Object.hasOwn(ROUTE_FOR, route.template), 'Knitting runs on route A or C. Work order ' + wo.number + ' uses route ' + route.template + '.');
      ensure(ROUTE_FOR[route.template] === spec.yarnDyed, 'Route ' + route.template + ' ' + (spec.yarnDyed ? 'knits undyed yarn' : 'knits dyed yarn') +
        '. Construction ' + spec.code + ' is ' + (spec.yarnDyed ? 'yarn-dyed' : 'greige') + '.', 422, 'route-skip');
      ensure(!spec.bomCode || same(spec.bomCode, route.component), 'Construction ' + spec.code + ' is for component ' + spec.bomCode + ', not ' + route.component + '.');
    }
    return { component: spec.component, bomComponent: route?.component || spec.bomCode, machineProfile: profile.id, gauge: profile.gauge, machineType: profile.type };
  },
  issueLine: (s, b, lot) => {
    const spec = ref(s.processSetups, b.recipeId);
    if (spec.yarnDyed) {
      ensure(lot.material === 'Dyed yarn', 'Construction ' + spec.code + ' knits dyed yarn. Lot ' + lot.id + ' is ' + lot.material.toLowerCase() + '.');
      ensure(spec.colours.some(c => same(c, lot.colour)), 'Lot ' + lot.id + ' is ' + (lot.colour || 'an unrecorded colour') + '. The colour sequence uses ' + spec.colours.join(', ') + '.');
    } else ensure(lot.material === 'Yarn', 'Construction ' + spec.code + ' knits undyed yarn into greige fabric. Lot ' + lot.id + ' is ' + lot.material.toLowerCase() + '.');
    const count = lotCount(s, lot);
    const feed = spec.feeds.find(f => !spec.yarnDyed || !f.colour || same(f.colour, lot.colour)) || spec.feeds[0];
    if (count) ensure(count.system === feed.countSystem && Math.abs(count.count - feed.count) < EPS,
      'Lot ' + lot.id + ' is ' + count.count + ' ' + count.system + ' (from ' + count.source + '). The ' + feed.role.toLowerCase() + ' feed needs ' + feed.count + ' ' + feed.countSystem + '.', 422, 'yarn-count');
    return { colour: lot.colour || '', feed: feed.role, countBasis: count ? count.count + ' ' + count.system + ' recorded on ' + count.source : 'Count not recorded on lot; feed specifies ' + feed.count + ' ' + feed.countSystem };
  },
  outputLabel: b => 'Knitted fabric · ' + b.recipe.variety,
  recipeText: b => b.recipe.code + ' r' + b.recipe.version + ' · ' + b.recipe.variety,
  planRows: (s, b, { setup, consumedKg, acceptedKg, waste }) => [
    ['Fabric', setup ? round(consumedKg * setup.yieldPct / 100) : null, acceptedKg, 'kg', (setup?.yieldPct ?? '—') + '% planned yield'],
    ['Knitting loss', setup ? round(consumedKg * (100 - setup.yieldPct) / 100) : null, waste, 'kg', 'Fly, ends and cut-offs'],
    ...(setup?.colours ?? []).map(colour => {
      const issued = round(sum(b.lines.filter(l => same(l.colour, colour)), l => l.issuedKg - l.returnedKg));
      const share = setup.stripe.length ? setup.stripe.find(c => same(c.colour, colour))?.courses / setup.repeatCourses : null;
      return [colour + ' yarn', share != null ? round(share * sum(b.lines, l => l.issuedKg - l.returnedKg)) : null, issued, 'kg', share != null ? 'Course share ' + round(share * 100) + '% of the repeat' : 'Feed colour'];
    }),
  ],
});

// Doffing: posts one or more rolls from the run, each with its ID, kg and metres when measured.
export function knitOutput(s, x, ctx) {
  const b = openBatch(s, x.batchId, KNITTING);
  const wo = batchWork(s, b);
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Doffing or roll slip reference');
  ensure(done(s, b).has('Knitting'), 'Record the knitting step (machine, shift, operator) before doffing rolls from ' + b.number + '.', 422, 'route-skip');
  const before = wipKg(b);
  ensure(before > 0, 'Knit run ' + b.number + ' has no yarn in process.');
  const spec = record(s.processSetups, b.recipeId, 'fabric construction');
  const missing = spec.colours.filter(c => !b.lines.some(l => same(l.colour, c)));
  ensure(!missing.length, 'Issue ' + missing.join(', ') + ' yarn before knitting the colour sequence of ' + spec.code + '.');
  const rolls = csvLines(x.rolls, 'Roll', 2, 3).map(([rollId, kg, metres]) => ({ id: lotKey(s, rollId), kg: decimal(kg, 'Roll kg for ' + rollId, 0.000001),
    metres: metres ? decimal(metres, 'Measured metres for ' + rollId, 0.000001) : null }));
  ensure(rolls.length && new Set(rolls.map(r => norm(r.id))).size === rolls.length, 'Enter each roll ID once with its kg.');
  const result = choice(x.result || 'Accepted', ['Accepted', 'Rework'], 'roll result');
  const fabricKg = round(sum(rolls, r => r.kg));
  const r = reconcile(x, fabricKg, before);
  const add = result === 'Accepted' ? fabricKg : 0;
  ensure(round(wo.completedQty + add) <= wo.plannedQty, 'Rolls exceed work order ' + wo.number + '. Release another work order for the excess.');
  const dest = location(s, x.locationId || b.locationId);
  ensure(dest.site === b.site, 'Post rolls at ' + b.site + '.');
  const used = consumeWip(s, b, r.consumedKg, x.consumption);
  for (const lot of used.sources) checkHistory(s, lot);
  const { checks, usage } = standardCheck(s, knitting.cfg, wo, b, day, { consume: true, amount: fabricKg, lots: used.sources });
  const knit = { construction: spec.code + ' r' + spec.version, component: spec.component, bomComponent: b.bomComponent || '', structure: spec.structure,
    yarnDyed: spec.yarnDyed, colours: spec.colours, stripe: spec.stripe, repeatCourses: spec.repeatCourses, machineType: b.machineType, gauge: b.gauge,
    machine: b.machineName, run: b.number, route: wo.componentRoute ? wo.componentRoute.template + ' · ' + wo.componentRoute.stages.join(' → ') : wo.route || 'Stock knitting',
    shift: clean(x.shift, 40), operator: clean(x.operator, 100) };
  const outs = rolls.map((roll, i) => newLot(s, roll.id, roll.kg, 'kg', day, dest, {
    material: 'Greige fabric', label: (spec.yarnDyed ? 'Yarn-dyed ' : 'Greige ') + spec.structure.toLowerCase() + ' · ' + spec.component.toLowerCase() + (spec.colours.length ? ' · ' + spec.colours.join('/') : ''),
    ownerId: b.ownerId || '', stage: KNITTING, workOrderId: wo.id, batchId: b.id, scheme: wo.scheme, additionalSchemes: wo.additionalSchemes, checks,
    qualityStatus: result === 'Rework' ? 'Rework' : 'Pending inspection', composition: [...new Set(used.sources.map(l => l.composition).filter(Boolean))].join(' / '),
    netKg: roll.kg, lengthM: roll.metres, conversionBasis: roll.metres ? 'Roll weighed and measured at doffing' : 'Roll weighed at doffing',
    knit: { ...knit, roll: i + 1 + ' of ' + rolls.length }, parents: parentLinks(used.consumption, used.chemicals, used.sources, roll.kg / fabricKg),
    resources: Object.fromEntries(['electricity', 'water', 'steam'].map(k => [k, round(used.resources[k] * roll.kg / fabricKg)])),
  }));
  const setup = spec;
  const e = post(s, 'Production', ctx, {
    date: day, stage: KNITTING, process: KNITTING, type: result === 'Rework' ? 'Rework output' : 'Run', workOrderId: wo.id, batchId: b.id, lineRevision: wo.lineRevision,
    inputs: parentLinks(used.consumption, used.chemicals, used.sources), output: outs[0].id, outputs: outs.map(l => l.id), qty: fabricKg, unit: 'kg', site: b.site, allocations: [],
    reconciliation: { unit: 'kg', input: r.consumedKg, accepted: fabricKg, waste: r.waste, rejects: r.rejects, adjustment: r.adjustment, reference: r.adjustmentRef, basis: 'Measured kg' },
    rolls: rolls.map(roll => ({ id: roll.id, kg: roll.kg, metres: roll.metres })), knit, reference, recipe: knitting.cfg.recipeText(b),
    shift: knit.shift, operator: knit.operator, machineId: b.machineId, machineName: b.machineName, readingId: '',
    ...used.resources, chemicals: used.chemicals, consumption: used.consumption, share: round(used.share),
    allocationBasis: 'Roll mass share; ' + ALLOCATION_BASIS.toLowerCase(), methodVersion: 'HZ-KNT-MASS-1',
    completedAdd: add, evidenceUsage: usage, processCost: [], costIds: [], checks,
    moves: [...used.consumption.map(c => wipMove(b, c.lotId, -c.qty, c.unit)), ...outs.map(l => stockMove(l, l.qty))],
    document: ctx.document(x.document, ['production']),
  });
  spreadCosts(s, e, outs, day, reference, setup, used.resources, round(r.waste + r.rejects));
  for (const lot of outs) lot.eventId = e.id;
  b.outputs.push(...outs.map(l => l.id));
  wo.completedQty = round(wo.completedQty + add);
  wo.status = wo.completedQty >= wo.plannedQty ? 'Completed' : 'In progress';
  track(b, e, 'Output', day);
  return outs[0];
}
