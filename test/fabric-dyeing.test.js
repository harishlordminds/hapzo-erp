import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { demo } from '../src/demo.js';
import { execute } from '../src/actions.js';
import { genealogy, today, ref, round, sum } from '../src/model.js';
import { wipKg } from '../src/process-batch.js';
import { commissionBalance } from '../src/fabric-dyeing.js';

const day = today();
const ctx = { role: 'Admin', actor: 'test', at: new Date().toISOString(), document: () => null,
  publicToken: () => randomBytes(24).toString('base64url'), digest: o => createHash('sha256').update(JSON.stringify(o)).digest('hex') };
const fails = (fn, pattern, code) => assert.throws(fn, error => (!code || error.code === code) && pattern.test(error.message), 'expected ' + pattern);
const ownSiteBalance = (s, lotId) => round(sum(s.events.flatMap(e => e.moves ?? []).filter(m => m.lotId === lotId && m.custody === 'Own site')));

function fresh() {
  const s = demo();
  const run = (action, input) => execute(s, action, { date: day, ...input }, ctx);
  const loc = s.locations.find(l => l.code === 'MAIN');
  const machine = code => s.machines.find(m => m.code === code);
  const recipe = (code, version = '1') => s.processSetups.find(r => r.code === code && r.version === version);
  const wo = (number, qty, more = {}) => run('work-order', { number, stage: 'Fabric dyeing', plannedQty: String(qty), unit: 'kg', locationId: loc.id, ...more });
  const steps = (b, list) => list.forEach((step, i) => run('fdye-entry', { batchId: b.id, step, start: day + 'T2' + i + ':00', end: day + 'T2' + i + ':30', operator: 'Op', shift: 'C', reference: b.number + '-' + step }));
  const wovenRecipe = (pretreatment, code) => run('fdye-setup', { code, version: '1', effective: day, colour: 'Navy', shade: 'Navy 19-3923', fabricKind: 'Woven', pretreatment,
    pretreatmentSpec: pretreatment === 'None' ? '' : 'Enzyme desize 60 °C, scour and bleach 98 °C', chemicals: 'FDYE-RED,0.02', reference: 'LD-' + code });
  return { s, run, loc, machine, recipe, wo, steps, wovenRecipe };
}

test('three greige rolls combined in one dye batch and returned in two receipts; batch and commission balance reconcile', () => {
  const { s } = fresh();
  const batch = s.processBatches.find(b => b.number === 'FDB-CUS-01');
  const issue = s.events.find(e => e.batchId === batch.id && e.kind === 'Process issue');
  assert.deepEqual(issue.inputs.map(i => [i.id, i.kg]), [['CG-001', 120.4], ['CG-002', 118.9], ['CG-003', 121.1]]);
  const receipts = s.events.filter(e => e.batchId === batch.id && e.kind === 'Production');
  assert.deepEqual(receipts.map(e => e.outputs), [['CD-001', 'CD-002'], ['CD-003', 'CD-003L']]);
  // Roll-to-roll genealogy, wet and dry-equivalent weights kept apart, leftover flagged.
  const primary = id => ref(s.lots, id).parents.filter(p => p.role === 'Primary').map(p => p.id);
  assert.deepEqual([primary('CD-001'), primary('CD-002'), primary('CD-003'), primary('CD-003L')], [['CG-001'], ['CG-002'], ['CG-003'], ['CG-003']]);
  const cd1 = ref(s.lots, 'CD-001');
  assert.deepEqual([cd1.initialQty, cd1.netKg, cd1.dyed.wetKg, cd1.dyed.dryKg, cd1.dyed.basis, cd1.lengthM], [116.5, 116.5, 186.4, 116.5, 'Conditioned weighing', 302]);
  assert.equal(round(cd1.dyed.moisturePct), 37.5);
  assert.equal(ref(s.lots, 'CD-003L').dyed.leftover, true);
  assert.ok(cd1.parents.some(p => p.id === 'CHEM-FD-R1') && cd1.parents.some(p => p.id === 'CHEM-PX-01'), 'dyes and pretreatment chemical lots link to the roll');
  assert.equal(cd1.dyed.recipe, 'FD-RED-K r1');
  // Process machine, shift and a verified meter reading on the dyeing step.
  const dyeing = s.events.find(e => e.batchId === batch.id && e.step === 'Dyeing');
  assert.ok(dyeing.readingId && ref(s.readings, dyeing.readingId).eventId === dyeing.id);
  assert.deepEqual([dyeing.machineName, dyeing.shift, dyeing.electricity], ['Soft-flow jet dyeing machine 1', 'B', 180]);
  // Batch reconciles to zero work in progress.
  assert.equal(wipKg(batch), 0);
  assert.equal(batch.status, 'Closed');
  // Commission balance for the customer job.
  const customer = s.parties.find(p => p.code === 'DEMO-CUS2');
  const bal = commissionBalance(s, customer.id, 'CJO-F-001');
  assert.equal(bal.receivedKg, 360.4);
  assert.equal(bal.consumedKg, round(bal.dyedKg + bal.wasteKg));
  assert.equal(round(bal.receivedKg - bal.consumedKg), bal.greigeDeliveredKg);
  assert.deepEqual(bal.deliveries.map(d => d.reference), ['DC-F-001', 'DC-F-002']);
  assert.equal(bal.reconciled, true);
  assert.equal(bal.dyedHeldKg, 0);
  for (const id of ['CG-001', 'CD-001', 'CD-003L']) assert.equal(ownSiteBalance(s, id), ref(s.lots, id).qty, id);
  assert.ok(genealogy(s, 'CD-002').every(l => !l.ownerId || l.ownerId === customer.id));
});

test('claimed outward issue to a site approved only for yarn dyeing is blocked', () => {
  const { s, run } = fresh();
  const dyeHouse = s.parties.find(p => p.code === 'DEMO-JOB');
  const send = () => run('job-out', { lotId: 'OG-001', processorId: dyeHouse.id, site: 'Example dye site', stage: 'Fabric dyeing', qty: '150', number: 'CH-FD-001' });
  fails(send, /GOTS requires verified .* Example Dye House at Example dye site \/ Fabric dyeing .* GOTS-DYEHOUSE-01 for this site covers Yarn dyeing but not Fabric dyeing/, 'standard-lock');
  assert.equal(ref(s.lots, 'OG-001').qty, 150);
  const ev = run('evidence', { scheme: 'GOTS', kind: 'Scope certificate', role: 'Processor', partyId: dyeHouse.id, site: 'Example dye site', number: 'GOTS-DYEHOUSE-02',
    issuer: 'Example certification body', issue: day, until: day, operations: 'Yarn dyeing, Fabric dyeing', materials: '*' });
  run('review-evidence', { evidenceId: ev.id, status: 'Verified', source: 'Test lookup', scopeConfirmed: 'yes' });
  const job = send();
  assert.equal(job.processor, 'Example Dye House');
  assert.equal(ref(s.lots, 'OG-001').qty, 0);
});

test('route-specific pretreatment, ownership, roll links, wet and dry rules, and re-dyeing', () => {
  const { s, run, machine, recipe, wo, steps, wovenRecipe } = fresh();
  // Knitted recipe on woven rolls; woven roll from a sized warp needs desizing in the recipe.
  const knitBatch = run('fdye-open', { workOrderId: wo('WO-FD-T1', 200).id, number: 'FDB-T1', machineId: machine('JET-01').id, recipeId: recipe('FD-RED-K').id, plannedKg: '150' });
  fails(() => run('fdye-issue', { batchId: knitBatch.id, lines: 'OG-001,150', reference: 'I1' }), /Recipe FD-RED-K is for knitted fabric\. Roll OG-001 is woven/);
  const plain = wovenRecipe('Scouring and bleaching', 'FD-NVY-W');
  const plainBatch = run('fdye-open', { workOrderId: wo('WO-FD-T2', 200).id, number: 'FDB-T2', machineId: machine('JET-01').id, recipeId: plain.id, plannedKg: '150' });
  fails(() => run('fdye-issue', { batchId: plainBatch.id, lines: 'OG-001,150', reference: 'I2' }), /woven from a sized warp and has not been desized/, 'route-skip');
  // Mill-woven greige from the weaving sample: GR-061-01 traces to sized beam LB-061-1.
  fails(() => run('fdye-issue', { batchId: plainBatch.id, lines: 'GR-061-01,163', reference: 'I3' }), /GR-061-01 is woven from a sized warp/, 'route-skip');
  // Customer roll in an own batch.
  run('fabric-inward', { mode: 'Customer inward', ownerId: s.parties.find(p => p.code === 'DEMO-CUS2').id, itemId: s.items.find(i => i.code === 'GRG-SJ-CUS').id, fabricKind: 'Woven',
    construction: 'Twill', commissionRef: 'CJO-F-002', rolls: 'CG-T9,50', origin: 'Customer', locationId: s.locations[0].id, reference: 'CH-T9' });
  run('quality', { lotId: 'CG-T9', decision: 'Released', reference: 'QC-T9' });
  fails(() => run('fdye-issue', { batchId: plainBatch.id, lines: 'CG-T9,50', reference: 'I4' }), /Open a commission batch for customer-owned roll CG-T9/);
  // Desizing recipe accepts the sized woven roll; steps follow the recipe.
  const desize = wovenRecipe('Desizing, scouring and bleaching', 'FD-NVY-WD');
  const b = run('fdye-open', { workOrderId: wo('WO-FD-T3', 300).id, number: 'FDB-T3', machineId: machine('JET-01').id, recipeId: desize.id, plannedKg: '150' });
  run('fdye-issue', { batchId: b.id, lines: 'OG-001,150', reference: 'I5' });
  fails(() => steps(b, ['Dyeing']), /record Pre-treatment before Dyeing/, 'route-skip');
  steps(b, ['Loading', 'Pre-treatment', 'Dyeing']);
  fails(() => run('fdye-rolls', { batchId: b.id, rolls: 'DW-1,140,220,370,OG-001', waste: '2', reference: 'U1' }), /Record Washing \/ soaping, Unloading before unloading/, 'route-skip');
  steps(b, ['Washing / soaping', 'Unloading']);
  fails(() => run('fdye-rolls', { batchId: b.id, rolls: 'DW-1,140,130,370,OG-001', waste: '2', reference: 'U1' }), /Wet weight of DW-1 cannot be below/);
  fails(() => run('fdye-rolls', { batchId: b.id, rolls: 'DW-1,140,220,370,OG-002', waste: '2', reference: 'U1' }), /Invalid lot link · OG-002 is not a roll in batch FDB-T3/, 'lot-link');
  // Shade-off roll goes to rework, then a re-dye batch.
  run('fdye-rolls', { batchId: b.id, rolls: 'DW-1,140,221,370,OG-001', waste: '2', result: 'Rework', reference: 'U1' });
  assert.equal(ref(s.lots, 'DW-1').qualityStatus, 'Rework');
  const redye = run('fdye-open', { workOrderId: wo('WO-FD-RD', 150, { rework: 'yes' }).id, number: 'FDB-RD', machineId: machine('JET-01').id, recipeId: desize.id, plannedKg: '140' });
  assert.deepEqual(redye.requiredSteps, ['Re-dye (rework)', 'Washing / soaping', 'Unloading']);
  run('fdye-issue', { batchId: redye.id, lines: 'DW-1,140', reference: 'I6' });
  steps(redye, ['Re-dye (rework)', 'Washing / soaping', 'Unloading']);
  run('fdye-rolls', { batchId: redye.id, rolls: 'DW-1R,139,219,368,DW-1', waste: '1', reference: 'U2' });
  assert.deepEqual(genealogy(s, 'DW-1R').filter(l => l.material !== 'Chemical').map(l => l.id), ['DW-1', 'OG-001']);
});
