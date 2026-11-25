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
  const recipe = (code, version) => s.processSetups.find(r => r.code === code && r.version === version);
  const machine = code => s.machines.find(m => m.code === code);
  const wo = (number, stage, qty, more = {}) => run('work-order', { number, stage, plannedQty: String(qty), unit: 'kg', locationId: loc.id, ...more });
  return { s, run, loc, recipe, machine, wo };
}

test('one yarn lot splits into two colours; every dyed lot links to its dye run and source yarn', () => {
  const { s } = fresh();
  const issues = s.events.filter(e => e.kind === 'Process issue' && e.inputs.some(i => i.id === 'YRN-UD-01'));
  assert.deepEqual(issues.map(e => [ref(s.processBatches, e.batchId).number, e.inputs[0].qty]), [['DYB-RED-01', 500], ['DYB-NAVY-01', 450]]);
  assert.equal(ref(s.lots, 'YRN-UD-01').qty, 55);
  assert.equal(ownSiteBalance(s, 'YRN-UD-01'), 55);
  for (const [id, colour, batch, recipe] of [['DYR-01', 'Red', 'DYB-RED-01', 'RED-R2 r1'], ['DYR-02', 'Red', 'DYB-RED-01', 'RED-R2 r1'],
    ['DYN-01', 'Navy', 'DYB-NAVY-01', 'NAVY-R1 r1'], ['DYN-02', 'Navy', 'DYB-NAVY-RD1', 'NAVY-R1 r2']]) {
    const lot = ref(s.lots, id);
    const run = ref(s.events, lot.eventId);
    assert.equal(lot.colour, colour, id);
    assert.equal(lot.recipeRef, recipe, id);
    assert.equal(ref(s.processBatches, run.batchId).number, batch, id);
    assert.ok(genealogy(s, id).some(l => l.id === 'YRN-UD-01'), id + ' traces to source yarn');
    assert.ok(run.inputs.some(i => i.role === 'Process input'), id + ' records chemical lots');
  }
  // Re-dye: the shade-off lot is the direct input of the re-dyed lot.
  assert.deepEqual(ref(s.lots, 'DYN-02').parents.filter(p => p.role === 'Primary').map(p => p.id), ['DYN-RW']);
  assert.equal(ref(s.lots, 'DYN-RW').qualityStatus, 'Rework');
  // Batch split: two dyed lots from one red batch, with the unused yarn returned to its lot.
  const red = s.processBatches.find(b => b.number === 'DYB-RED-01');
  assert.deepEqual(red.outputs, ['DYR-01', 'DYR-02']);
  assert.equal(red.lines[0].returned, 5);
  // Recipe revision supersedes the earlier revision and pins the batch to the revision used.
  assert.equal(s.processSetups.find(r => r.code === 'NAVY-R1' && r.version === '1').status, 'Superseded');
  assert.equal(s.processBatches.find(b => b.number === 'DYB-NAVY-01').recipe.version, '1');
});

test('dyed cones go to knitting; warp and weft are allocated and used separately for weaving', () => {
  const { s, run, wo } = fresh();
  assert.deepEqual(ref(s.lots, 'KNT-YD-01').parents.map(p => [p.id, p.qty, p.unit]), [['DYR-02', 90, 'cone']]);
  assert.deepEqual(ref(s.lots, 'BEAM-YD-02').parents.map(p => p.id), ['DYR-01']);
  assert.deepEqual(ref(s.lots, 'GRG-YD-01').parents.map(p => p.id), ['BEAM-YD-02', 'DYN-01']);
  const firstUse = id => ref(s.lots, id).assignments.filter(a => ['WO-WRP-YD-01', 'WO-WV-YD-01'].includes(a.workOrder)).map(a => [a.role, a.qty, a.used]);
  assert.deepEqual(firstUse('DYR-01'), [['Warp', 160, 160]]);
  assert.deepEqual(firstUse('DYN-01'), [['Weft', 200, 200]]);
  const back = genealogy(s, 'GRG-YD-01').map(l => l.id);
  for (const id of ['BEAM-YD-02', 'DYR-01', 'DYN-01', 'YRN-UD-01']) assert.ok(back.includes(id), id);
  // Weft yarn cannot be allocated to warping; allocated warp yarn is held from other work orders.
  // Later samples use some red cones, so the quantities follow the stock on hand.
  const red = ref(s.lots, 'DYR-01').qty;
  const free = red - 6;
  const kg = n => String(Math.round(n * 1.25 * 100) / 100);
  const warp2 = wo('WO-WRP-T', 'Warping', 60);
  fails(() => run('yarn-assign', { lotId: 'DYN-01', workOrderId: warp2.id, role: 'Weft', qty: '10', reference: 'X' }), /Weft yarn goes to Weaving/);
  run('yarn-assign', { lotId: 'DYR-01', workOrderId: warp2.id, role: 'Warp', qty: '6', reference: 'WARP-T' });
  const knit2 = wo('WO-KNT-T', 'Knitting', 200);
  fails(() => run('production', { workOrderId: knit2.id, inputs: 'DYR-01,' + (free + 1), outputId: 'KNT-T', outputQty: kg(free + 1), waste: '0', balanceUnit: 'kg', reference: 'K-T' }),
    new RegExp('DYR-01 is allocated to WO-WRP-T \\(warp\\)\\. Only ' + free + ' cone is free'), 'yarn-allocation');
  run('production', { workOrderId: knit2.id, inputs: 'DYR-01,' + free, outputId: 'KNT-T2', outputQty: kg(free), waste: '0', balanceUnit: 'kg', reference: 'K-T' });
  run('production', { workOrderId: warp2.id, inputs: 'DYR-01,6', outputId: 'BEAM-T', outputQty: '7.5', waste: '0', balanceUnit: 'kg', reference: 'W-T' });
  assert.equal(ref(s.lots, 'DYR-01').qty, 0);
});

test('recipe steps are enforced in order, including the specified pretreatment', () => {
  const { s, run, recipe, machine, wo } = fresh();
  const b = run('dye-batch', { workOrderId: wo('WO-YD-T1', 'Yarn dyeing', 50).id, number: 'DYB-T1', machineId: machine('HTHP-2').id, recipeId: recipe('RED-R2', '1').id, plannedKg: '50' });
  assert.deepEqual(b.requiredSteps, ['Package winding', 'Pre-treatment', 'Dyeing', 'Soaping / washing', 'Drying', 'Rewinding']);
  run('dye-issue', { batchId: b.id, lines: 'YRN-UD-01,50', reference: 'I-T1' });
  const entry = (step, ref2 = step) => run('dye-entry', { batchId: b.id, step, start: day + 'T08:00', end: day + 'T09:00', operator: 'Op', shift: 'A', reference: 'T1-' + ref2 });
  entry('Package winding');
  fails(() => entry('Dyeing'), /record Pre-treatment before Dyeing/, 'route-skip');
  entry('Pre-treatment');
  entry('Dyeing');
  fails(() => run('dye-output', { batchId: b.id, outputId: 'DY-T1', outputQty: '48', waste: '1', reference: 'O-T1' }), /Record Soaping \/ washing, Drying, Rewinding before posting dyed yarn/, 'route-skip');
  // A superseded recipe revision cannot start new batches.
  fails(() => run('dye-batch', { workOrderId: wo('WO-YD-T2', 'Yarn dyeing', 50).id, number: 'DYB-T2', machineId: machine('HTHP-2').id, recipeId: recipe('NAVY-R1', '1').id, plannedKg: '50' }),
    /approved dye recipe/);
});

test('commission work keeps customer ownership; the claimed commission issue is blocked when the verified site scope lacks yarn dyeing', () => {
  const { s, run, recipe, machine, wo } = fresh();
  const customer = s.parties.find(p => p.code === 'DEMO-CUS');
  const delivered = ref(s.lots, 'DYC-01');
  assert.equal(delivered.ownerId, customer.id);
  const delivery = s.events.find(e => e.kind === 'Commission delivery');
  assert.deepEqual(delivery.moves.map(m => m.custody), ['Own site', 'Customer']);
  assert.ok(genealogy(s, 'DYC-01').some(l => l.id === 'YRN-CUS-01' && l.ownerId === customer.id));
  // Ownership boundaries.
  const own = run('dye-batch', { workOrderId: wo('WO-YD-T3', 'Yarn dyeing', 50).id, number: 'DYB-T3', machineId: machine('HTHP-2').id, recipeId: recipe('RED-R2', '1').id, plannedKg: '50' });
  fails(() => run('dye-issue', { batchId: own.id, lines: 'YRN-CUS-GOTS,10', reference: 'I-T3' }), /Open a commission batch for customer-owned lot YRN-CUS-GOTS/);
  const gotsBatch = s.processBatches.find(b => b.number === 'DYB-CUS-GOTS');
  fails(() => run('dye-issue', { batchId: gotsBatch.id, lines: 'YRN-UD-01,10', reference: 'I-T4' }), /takes only yarn owned by Example Knit Brand/);
  fails(() => run('dye-deliver', { customerId: customer.id, number: 'DC-T', lines: 'DYN-02,1' }), /not owned by Example Knit Brand/);
  // The blocked case: GOTS customer yarn into a GOTS commission batch, while the verified mill scope covers knitting and weaving only.
  const issue = () => run('dye-issue', { batchId: gotsBatch.id, lines: 'YRN-CUS-GOTS,300', reference: 'ISS-CUS-GOTS' });
  fails(issue, /GOTS requires verified .* HAPZO Training Mill at Decaste Mill \/ Yarn dyeing \/ Dyed yarn .* GOTS-MILL-01 for this site covers Knitting, Weaving but not Yarn dyeing/, 'standard-lock');
  assert.equal(ref(s.lots, 'YRN-CUS-GOTS').qty, 300);
  // Pending verification still blocks; a verified scope that includes yarn dyeing releases it.
  const ev = run('evidence', { scheme: 'GOTS', kind: 'Scope certificate', role: 'Processor', party: 'HAPZO Training Mill', site: 'Decaste Mill',
    number: 'GOTS-MILL-02', issuer: 'Example certification body', issue: day, until: day, operations: 'Knitting, Weaving, Yarn dyeing', materials: '*' });
  fails(issue, /Standard Lock/, 'standard-lock');
  run('review-evidence', { evidenceId: ev.id, status: 'Verified', source: 'Test lookup', scopeConfirmed: 'yes' });
  issue();
  assert.equal(ref(s.lots, 'YRN-CUS-GOTS').qty, 0);
});
