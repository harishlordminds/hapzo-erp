import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { demo } from '../src/demo.js';
import { execute } from '../src/actions.js';
import { genealogy, today, ref, round, sum } from '../src/model.js';

const day = today();
const ctx = { role: 'Admin', actor: 'test', at: new Date().toISOString(), document: () => null,
  publicToken: () => randomBytes(24).toString('base64url'), digest: o => createHash('sha256').update(JSON.stringify(o)).digest('hex') };
const fails = (fn, pattern, code) => assert.throws(fn, error => (!code || error.code === code) && pattern.test(error.message), 'expected ' + pattern);
const ownSiteBalance = (s, lotId) => round(sum(s.events.flatMap(e => e.moves ?? []).filter(m => m.lotId === lotId && m.custody === 'Own site')));

function fresh() {
  const s = demo();
  const run = (action, input) => execute(s, action, { date: day, ...input }, ctx);
  const loc = s.locations.find(l => l.code === 'MAIN');
  const route = component => s.componentRoutes.find(r => r.component === component && r.status === 'Approved');
  const spec = code => s.processSetups.find(r => r.code === code && r.status === 'Approved');
  const machine = code => s.machines.find(m => m.code === code);
  const wo = (number, stage, r, qty) => run('work-order', { number, stage, componentRouteId: r.id, plannedQty: String(qty), unit: 'kg', locationId: loc.id });
  const step = (b, name, more = {}) => run('loom-entry', { batchId: b.id, step: name, start: day + 'T20:00', end: day + 'T21:00', operator: 'W', shift: 'C', reference: b.number + '-' + name + (more.ref || ''), ...more });
  return { s, run, loc, route, spec, machine, wo, step };
}

test('warp path: allocated warp lots → warper’s beams → sizing with size chemical lots → loom beam drawn in', () => {
  const { s } = fresh();
  for (const id of ['WB-061-1', 'WB-061-2', 'WB-061-3', 'WB-061-4']) {
    const beam = ref(s.lots, id);
    assert.deepEqual([beam.weave.beamType, beam.weave.ends, beam.lengthM, beam.parents.map(p => p.id)], ['Warper beam', 1200, 1000, ['YRN-WP-01']], id);
  }
  const loomBeam = ref(s.lots, 'LB-061-1');
  assert.deepEqual(loomBeam.parents.map(p => p.id), ['WB-061-1', 'WB-061-2', 'WB-061-3', 'WB-061-4', 'CHEM-SZ-01']);
  assert.deepEqual([loomBeam.weave.beamType, loomBeam.weave.ends, loomBeam.weave.sized, loomBeam.stage], ['Loom beam', 4800, true, 'Sizing']);
  assert.deepEqual([loomBeam.dressing.method, loomBeam.dressing.loom, loomBeam.dressing.ends], ['Drawing-in', 'LOOM-R1', 4800]);
  const sizingOut = s.events.find(e => e.process === 'Sizing' && e.kind === 'Production');
  assert.equal(sizingOut.reconciliation.adjustment, 40);
  assert.ok(ref(s.lots, 'YRN-WP-01').assignments.some(a => a.role === 'Warp' && a.used === 400));
  // The yarn-dyed check is unsized, so the warping beam is the loom beam and carries the warp colour sequence.
  const check = ref(s.lots, 'YB-062-1');
  assert.deepEqual([check.weave.beamType, check.stage, check.weave.warpSequence.map(c => c.colour + c.ends).join('/')], ['Loom beam', 'Warping', 'Red24/Navy24']);
});

test('loom run with a weft lot change: each affected roll segment keeps its actual weft history', () => {
  const { s } = fresh();
  const seg = id => ref(s.lots, id).weave.segments.map(g => [g.fromM, g.toM, g.weft.map(w => w.feeder + ':' + w.lotId).join(' ')]);
  assert.deepEqual(seg('GR-061-01'), [[0, 300, 'F1:YRN-WF-01']]);
  assert.deepEqual(seg('GR-061-02'), [[300, 450, 'F1:YRN-WF-01'], [450, 600, 'F1:YRN-WF-02']]);
  assert.deepEqual(seg('GR-061-03'), [[600, 900, 'F1:YRN-WF-02']]);
  const roll2 = ref(s.lots, 'GR-061-02');
  assert.deepEqual(roll2.parents.map(p => p.id), ['LB-061-1', 'YRN-WF-01', 'YRN-WF-02']);
  const [a, b] = roll2.weave.segments.map(g => g.weft[0].kg);
  assert.ok(Math.abs(a - b) < 0.00001, 'equal metres carry equal weft');
  assert.equal(round(roll2.weave.warpKg + roll2.weave.weftKg), 164);
  // Forward from each weft lot reaches exactly the rolls it was woven into.
  const forward = id => genealogy(s, id, true).filter(l => l.weave).map(l => l.id).sort();
  assert.deepEqual(forward('YRN-WF-01'), ['GR-061-01', 'GR-061-02']);
  assert.deepEqual(forward('YRN-WF-02'), ['GR-061-02', 'GR-061-03']);
  // Backward from the dyed fabric reaches warp yarn, size chemicals and both weft lots.
  const back = genealogy(s, 'FD-061-02').map(l => l.id);
  for (const id of ['DS-061-02', 'GR-061-02', 'LB-061-1', 'WB-061-1', 'YRN-WP-01', 'CHEM-SZ-01', 'YRN-WF-01', 'YRN-WF-02']) assert.ok(back.includes(id), id);
  const change = s.events.find(e => e.weftChange);
  assert.deepEqual([change.weftChange.fromLot, change.weftChange.toLot, change.weftChange.atMetre, change.weftChange.packages], ['YRN-WF-01', 'YRN-WF-02', 450, 8]);
  // Beam remnant and unused weft returned; balances agree with the ledger.
  for (const id of ['LB-061-1', 'YRN-WF-01', 'YRN-WF-02', 'GR-061-01', 'GR-061-03']) assert.equal(ownSiteBalance(s, id), ref(s.lots, id).qty, id);
  assert.ok(ref(s.lots, 'LB-061-1').qty > 0);
});

test('greige output goes through desizing to fabric dyeing; yarn-dyed output follows its finishing route', () => {
  const { s, run, route, wo } = fresh();
  assert.deepEqual(route('WF-PL-DYED').stages, ['Warping', 'Sizing', 'Weaving', 'Desizing', 'Fabric dyeing', 'Fabric finishing']);
  assert.equal(ref(s.lots, 'DS-061-02').stage, 'Desizing');
  assert.equal(ref(s.lots, 'FD-061-02').material, 'Dyed fabric');
  assert.deepEqual(route('WF-YD-CHK').stages, ['Yarn dyeing', 'Warping', 'Weaving', 'Fabric finishing']);
  const check = ref(s.lots, 'YC-062-01');
  assert.deepEqual(check.weave.segments[0].weft.map(w => [w.lotId, w.colour]), [['DYN-01', 'Navy'], ['DYR-01', 'Red']]);
  assert.equal(ref(s.lots, 'FF-YC-062-01').stage, 'Fabric finishing');
  assert.ok(genealogy(s, 'FF-YC-062-01').some(l => l.id === 'YRN-UD-01'), 'yarn-dyed check traces to the undyed yarn behind its dyed lots');
  // Desizing is required: a sized greige roll cannot go straight to fabric dyeing.
  fails(() => run('production', { workOrderId: wo('WO-FD-T', 'Fabric dyeing', route('WF-PL-DYED'), 170).id, inputs: 'GR-061-01,163', outputId: 'FD-T', outputQty: '160', waste: '3', reference: 'R-T' }),
    /Route skip · post Desizing before Fabric dyeing/, 'route-skip');
  // And a route with sizing must include desizing.
  const line = s.lines.find(l => l.sku === 'POP-WV-NVY-M');
  fails(() => run('component-route', { lineId: line.id, component: 'WF-PL-DYED', template: 'D', conditional: 'Sizing', effective: day, reference: 'X' }), /must be desized/);
});

test('roll posting is blocked when warp or weft genealogy is missing', () => {
  const { s, run, route, spec, machine, wo, step } = fresh();
  const routeD = route('WF-PL-DYED');
  const greige = spec('GW-PL-40');
  // A run with a beam but no feeder plan cannot post a roll.
  const wo2 = wo('WO-WV-T2', 'Weaving', routeD, 50);
  const r2 = run('loom-open', { workOrderId: wo2.id, number: 'LR-T2', machineId: machine('LOOM-R1').id, recipeId: greige.id, plannedKg: '50' });
  run('loom-issue', { batchId: r2.id, lines: 'LB-061-1,' + ref(s.lots, 'LB-061-1').qty, reference: 'I-T4' });
  step(r2, 'Weaving');
  fails(() => run('loom-roll', { batchId: r2.id, rollId: 'GR-T2', metres: '1', kg: '0.6', reference: 'D-T2' }), /Weft genealogy missing · record the weft feeder plan/, 'genealogy');
  run('loom-return', { batchId: r2.id, lines: 'LB-061-1,' + r2.lines[0].issued, reference: 'RET-T2' });
  const loomWo = wo('WO-WV-T', 'Weaving', routeD, 100);
  run('yarn-assign', { lotId: 'YRN-WF-01', workOrderId: loomWo.id, role: 'Weft', qty: '5', reference: 'WEFT-T' });
  const r = run('loom-open', { workOrderId: loomWo.id, number: 'LR-T', machineId: machine('LOOM-R1').id, recipeId: greige.id, plannedKg: '100' });
  // No beam: a weft-only issue is allowed, but the roll cannot be posted.
  run('loom-issue', { batchId: r.id, lines: 'YRN-WF-01,1', reference: 'I-T1' });
  step(r, 'Weaving', { weftFeed: 'F1,YRN-WF-01' });
  fails(() => run('loom-roll', { batchId: r.id, rollId: 'GR-T1', metres: '10', kg: '5.5', reference: 'D-T1' }), /Warp genealogy missing · issue the drawn-in loom beam/, 'genealogy');
  // A warper's beam is not a loom beam; an undrawn beam is not on this loom.
  fails(() => run('loom-issue', { batchId: r.id, lines: 'WB-061-1,1', reference: 'I-T2' }), /not available|not a loom beam|quantity|usable|exceeds|on hand/i);
  // The remnant loom beam is drawn in on LOOM-R1, so it can be gaited.
  run('loom-issue', { batchId: r.id, lines: 'LB-061-1,' + ref(s.lots, 'LB-061-1').qty, reference: 'I-T3' });
  // Weft genealogy: the roll needs more weft than the lots on its feeders hold in the run.
  fails(() => run('loom-roll', { batchId: r.id, rollId: 'GR-T1', metres: '10', kg: '7', reference: 'D-T1' }), /Weft genealogy missing · the roll needs [\d.]+ kg of YRN-WF-01 but only 1 kg/, 'genealogy');
  const roll = run('loom-roll', { batchId: r.id, rollId: 'GR-T1', metres: '10', kg: '5.5', reference: 'D-T1' });
  assert.deepEqual(roll.weave.segments.map(g => [g.fromM, g.toM, g.weft[0].lotId]), [[0, 10, 'YRN-WF-01']]);
  // A weft change cannot be back-dated into a posted roll, and needs a lot issued to the run.
  fails(() => step(r, 'Weft package change', { feeder: 'F1', toLot: 'YRN-WF-02', atMetre: '12', ref: 'X' }), /Weft lot YRN-WF-02 is not issued to loom run LR-T/, 'genealogy');
  fails(() => step(r, 'Weft package change', { feeder: 'F1', toLot: 'YRN-WF-01', atMetre: '5', ref: 'Y' }), /falls inside rolls already posted/);
  // Weft must be allocated to the weaving order before it is issued.
  fails(() => run('loom-issue', { batchId: r.id, lines: 'YRN-WF-02,1', reference: 'I-T5' }), /Allocate lot YRN-WF-02 as weft to WO-WV-T/, 'yarn-allocation');
});
