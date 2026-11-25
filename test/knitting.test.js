import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { demo } from '../src/demo.js';
import { execute } from '../src/actions.js';
import { genealogy, today, ref, round, sum } from '../src/model.js';
import { wipKg } from '../src/process-batch.js';

const day = today();
const ctx = { role: 'Admin', actor: 'test', at: new Date().toISOString(), document: () => null,
  publicToken: () => randomBytes(24).toString('base64url'), digest: o => createHash('sha256').update(JSON.stringify(o)).digest('hex') };
const fails = (fn, pattern, code) => assert.throws(fn, error => (!code || error.code === code) && pattern.test(error.message), 'expected ' + pattern);
const ownSiteBalance = (s, lotId) => round(sum(s.events.flatMap(e => e.moves ?? []).filter(m => m.lotId === lotId && m.custody === 'Own site')));

function fresh() {
  const s = demo();
  const run = (action, input) => execute(s, action, { date: day, ...input }, ctx);
  const loc = s.locations.find(l => l.code === 'MAIN');
  const spec = code => s.processSetups.find(r => r.code === code && r.status === 'Approved');
  const route = component => s.componentRoutes.find(r => r.component === component && r.status === 'Approved');
  const machine = code => s.machines.find(m => m.code === code);
  const wo = (number, stage, r, qty) => run('work-order', { number, stage, componentRouteId: r?.id || '', plannedQty: String(qty), unit: 'kg', locationId: loc.id });
  const knitStep = (b, step = 'Knitting') => run('knit-entry', { batchId: b.id, step, start: day + 'T08:00', end: day + 'T10:00', operator: 'K', shift: 'A', reference: b.number + '-' + step });
  return { s, run, loc, spec, route, machine, wo, knitStep };
}

test('striped yarn-dyed roll goes to finishing; undyed greige roll goes to fabric dyeing; each traces to its yarn lots and route', () => {
  const { s } = fresh();
  // Separate production orders for body and rib, each pinned to its component route.
  const bodyWo = s.workOrders.find(w => w.number === 'WO-KNT-BODY-01');
  const ribWo = s.workOrders.find(w => w.number === 'WO-KNT-RIB-01');
  assert.deepEqual([bodyWo.componentRoute.component, bodyWo.componentRoute.template, bodyWo.componentRoute.stages], ['KF-BODY-STR', 'A', ['Yarn dyeing', 'Knitting', 'Fabric finishing']]);
  assert.deepEqual([ribWo.componentRoute.component, ribWo.componentRoute.template, ribWo.componentRoute.stages], ['KF-RIB-STR', 'C', ['Knitting', 'Fabric dyeing', 'Fabric finishing']]);
  // Striped roll: actual dyed yarn lots in both colours, then finishing.
  const striped = ref(s.lots, 'KR-STR-001');
  assert.deepEqual(striped.parents.map(p => p.id), ['DYR-01', 'DYN-01']);
  assert.deepEqual(striped.parents.map(p => ref(s.lots, p.id).colour), ['Red', 'Navy']);
  assert.equal(round(sum(striped.parents, p => p.kg)), round(222.55 * 55.2 / 220));
  assert.deepEqual([striped.knit.yarnDyed, striped.knit.colours, striped.lengthM, striped.knit.gauge], [true, ['Red', 'Navy'], 142, 24]);
  const finished = ref(s.lots, 'FF-STR-001');
  assert.equal(finished.stage, 'Fabric finishing');
  assert.equal(ref(s.workOrders, finished.workOrderId).componentRoute.id, bodyWo.componentRoute.id);
  const back = genealogy(s, 'FF-STR-001').map(l => l.id);
  for (const id of ['KR-STR-001', 'DYR-01', 'DYN-01', 'YRN-UD-01']) assert.ok(back.includes(id), id);
  // Greige rib roll: undyed 30s Ne spun yarn, then fabric dyeing.
  const greige = ref(s.lots, 'KR-RIB-001');
  assert.deepEqual(greige.parents.map(p => [p.id, ref(s.lots, p.id).material]), [['YRN-30C-B', 'Yarn']]);
  assert.equal(greige.lengthM, null);
  const dyed = ref(s.lots, 'FD-RIB-001');
  assert.equal(dyed.stage, 'Fabric dyeing');
  assert.equal(ref(s.workOrders, dyed.workOrderId).componentRoute.id, ribWo.componentRoute.id);
  const ribBack = genealogy(s, 'FD-RIB-001').map(l => l.id);
  for (const id of ['KR-RIB-001', 'YRN-30C-B', 'PF-BL-26-01', 'LINT-A', 'LINT-B']) assert.ok(ribBack.includes(id), id);
  // Cone issue and return, and stock balances.
  const run = s.processBatches.find(b => b.number === 'KNR-BODY-01');
  assert.deepEqual(run.lines.map(l => [l.lotId, l.issued, l.returned]), [['DYR-01', 110, 3], ['DYN-01', 76, 2]]);
  assert.equal(wipKg(run), 0);
  for (const id of ['DYR-01', 'DYN-01', 'KR-STR-002', 'KR-RIB-002', 'FF-STR-001', 'FD-RIB-001']) assert.equal(ownSiteBalance(s, id), ref(s.lots, id).qty, id);
});

test('blocked cases: machine gauge, route and construction, yarn material, colour, count, doffing order and route skip', () => {
  const { s, run, spec, route, machine, wo, knitStep } = fresh();
  const body = spec('KC-STR-SJ');
  const rib = spec('KC-RIB-11');
  // Construction on a machine of the wrong type and gauge.
  fails(() => run('knit-open', { workOrderId: wo('WO-T1', 'Knitting', route('KF-BODY-STR'), 50).id, number: 'KNR-T1', machineId: machine('KNT-RIB-01').id, recipeId: body.id, plannedKg: '50' }),
    /needs a circular single jersey at 24 gauge.*is circular double jersey/, 'machine');
  // Greige construction on a yarn-dyed route.
  fails(() => run('knit-open', { workOrderId: wo('WO-T2', 'Knitting', route('KF-BODY-STR'), 50).id, number: 'KNR-T2', machineId: machine('KNT-RIB-01').id, recipeId: rib.id, plannedKg: '50' }),
    /Route A knits dyed yarn\. Construction KC-RIB-11 is greige/, 'route-skip');
  const b = run('knit-open', { workOrderId: wo('WO-T3', 'Knitting', route('KF-BODY-STR'), 60).id, number: 'KNR-T3', machineId: machine('KNT-SJ-01').id, recipeId: body.id, plannedKg: '60' });
  fails(() => run('knit-issue', { batchId: b.id, lines: 'YRN-UD-01,10', reference: 'I1' }), /knits dyed yarn\. Lot YRN-UD-01 is yarn/);
  ref(s.lots, 'DYN-02').colour = 'Green';
  fails(() => run('knit-issue', { batchId: b.id, lines: 'DYN-02,5', reference: 'I2' }), /DYN-02 is Green\. The colour sequence uses Red, Navy/);
  run('knit-issue', { batchId: b.id, lines: 'DYR-01,10', reference: 'I3' });
  fails(() => run('knit-output', { batchId: b.id, rolls: 'KR-T3,24', waste: '1', reference: 'D1' }), /Record the knitting step/, 'route-skip');
  knitStep(b);
  fails(() => run('knit-output', { batchId: b.id, rolls: 'KR-T3,24', waste: '1', reference: 'D1' }), /Issue Navy yarn before knitting the colour sequence/);
  // Count recorded on the yarn lot must match the feed.
  const ribRun = run('knit-open', { workOrderId: wo('WO-T4', 'Knitting', route('KF-RIB-STR'), 40).id, number: 'KNR-T4', machineId: machine('KNT-RIB-01').id, recipeId: rib.id, plannedKg: '40' });
  ref(s.lots, 'YRN-30C-B').yarn.count.nominal = 20;
  fails(() => run('knit-issue', { batchId: ribRun.id, lines: 'YRN-30C-B,20', reference: 'I4' }), /YRN-30C-B is 20 Ne .*needs 30 Ne/, 'yarn-count');
  // Route skip: a route C greige roll cannot go straight to finishing without fabric dyeing.
  run('quality', { lotId: 'KR-RIB-002', decision: 'Released', reference: 'QC-KR-RIB-002' });
  fails(() => run('production', { workOrderId: wo('WO-T5', 'Fabric finishing', route('KF-RIB-STR'), 25).id, inputs: 'KR-RIB-002,20.5', outputId: 'FF-T5', outputQty: '20', waste: '0.5', reference: 'R5' }),
    /fabric dye batch before finishing|Route skip/);
});

test('rolls reverse as one posting and cones return to their lots', () => {
  const { s, run, spec, route, machine, wo, knitStep } = fresh();
  const b = run('knit-open', { workOrderId: wo('WO-T6', 'Knitting', route('KF-BODY-STR'), 60).id, number: 'KNR-T6', machineId: machine('KNT-SJ-01').id, recipeId: spec('KC-STR-SJ').id, plannedKg: '60' });
  const redBefore = ref(s.lots, 'DYR-01').qty;
  run('knit-issue', { batchId: b.id, lines: 'DYR-01,10\nDYN-01,14', reference: 'I6' });
  knitStep(b);
  const roll = run('knit-output', { batchId: b.id, rolls: 'KR-T6A,14,36\nKR-T6B,14.3', waste: '0.5', reference: 'D6' });
  assert.equal(round(wipKg(b)), round(12.5 + 16.8 - 28.8));
  run('knit-reverse', { batchId: b.id, eventId: roll.eventId, reason: 'Wrong roll weights' });
  assert.deepEqual([ref(s.lots, 'KR-T6A').qty, ref(s.lots, 'KR-T6B').qty, round(wipKg(b))], [0, 0, 29.3]);
  run('knit-return', { batchId: b.id, lines: 'DYR-01,10\nDYN-01,14', reference: 'R6' });
  assert.equal(wipKg(b), 0);
  assert.equal(ref(s.lots, 'DYR-01').qty, redBefore);
});
