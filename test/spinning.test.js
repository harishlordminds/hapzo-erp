import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { demo } from '../src/demo.js';
import { execute } from '../src/actions.js';
import { genealogy, today, ref, round, sum } from '../src/model.js';
import { wipKg, batchSummary } from '../src/process-batch.js';
import { scanRecord } from '../src/fibre.js';

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
  const spinLot = (number, planId, kg = '300') => {
    const wo = run('work-order', { number: 'WO-' + number, stage: 'Spinning', plannedQty: kg, unit: 'kg', locationId: loc.id });
    return run('spin-open', { workOrderId: wo.id, number, machineId: machine('RF-01').id, recipeId: planId, plannedKg: kg });
  };
  const step = (b, stepName, more = {}) => run('spin-entry', { batchId: b.id, step: stepName, start: day + 'T08:00', end: day + 'T09:00', operator: 'Team', shift: 'A',
    reference: b.number + '-' + stepName, ...more });
  return { s, run, loc, machine, spinLot, step };
}

test('one blend produces two yarn lots with separate good output, noil and waste', () => {
  const { s } = fresh();
  const lot = s.processBatches.find(b => b.number === 'SPL-26-01');
  assert.equal(lot.status, 'Closed');
  assert.equal(wipKg(lot), 0);
  assert.equal(lot.lines[0].lotId, 'PF-BL-26-01');
  assert.equal(lot.lines[0].blend, 'BL-26-01');
  const outputs = s.events.filter(e => e.batchId === lot.id && e.kind === 'Production');
  assert.deepEqual(outputs.map(e => [e.output, e.reconciliation.input, e.reconciliation.accepted, e.reconciliation.byProduct, e.reconciliation.waste]),
    [['YRN-30C-A', 425, 330, 70, 25], ['YRN-30C-B', 391, 310, 60, 21]]);
  assert.deepEqual(outputs.map(e => e.outputs), [['YRN-30C-A', 'NOIL-26-01'], ['YRN-30C-B', 'NOIL-26-02']]);
  const a = ref(s.lots, 'YRN-30C-A');
  assert.deepEqual([a.yarn.count.actual, a.yarn.count.system, a.yarn.packages.cones, a.yarn.packages.first, a.yarn.packages.last], [30.2, 'Ne', 264, 'A-0001', 'A-0264']);
  assert.equal(a.yarn.route, 'Combed ring');
  assert.equal(ref(s.lots, 'NOIL-26-01').material, 'Fibre waste');
  // Sale and transfer: lot A shipped against the yarn order, lot B moved to the weaving preparatory store.
  assert.equal(a.qty, 0);
  assert.ok(s.shipments.some(sh => sh.number === 'SHP-26040-01' && sh.lotIds.includes('YRN-30C-A')));
  assert.equal(ref(s.lots, 'YRN-30C-B').location, 'Decaste Mill / Weaving preparatory / WP01');
  for (const id of ['PF-BL-26-01', 'YRN-30C-B', 'NOIL-26-01', 'NOIL-26-02']) assert.equal(ownSiteBalance(s, id), ref(s.lots, id).qty, id);
  const summary = batchSummary(s, lot);
  assert.equal(summary.acceptedKg, 640);
  assert.equal(summary.byProductKg, 130);
  assert.equal(s.workOrders.find(w => w.number === 'WO-SPN-26-01').completedQty, 640);
});

test('scanning a yarn lot retrieves its input bale history', () => {
  const { s } = fresh();
  const before = JSON.stringify(s.lots);
  const r = scanRecord(s, 'HZ:LOT:YRN-30C-A');
  assert.equal(r.kind, 'lot');
  const byLot = Object.fromEntries(r.bales.map(b => [b.lot.id, b]));
  assert.deepEqual(Object.keys(byLot).sort(), ['LINT-A', 'LINT-B']);
  assert.equal(byLot['LINT-B'].bales.length, 8);
  assert.equal(byLot['LINT-A'].bales.length, 5);
  assert.deepEqual(byLot['LINT-B'].blendIssues.map(i => [i.blend, i.kg]), [['BL-26-01', 510]]);
  assert.deepEqual(byLot['LINT-A'].blendIssues.map(i => [i.blend, i.kg]), [['BL-26-01', 340]]);
  assert.equal(byLot['LINT-B'].origin, 'Rajkot district, Gujarat');
  assert.equal(byLot['LINT-A'].ginner, 'Example Ginning and Pressing, Akola');
  // The share attributable to lot A follows actual consumption: 425 of 816 kg, split between yarn and noil by mass.
  const yarnShareOfBlend = ref(s.lots, 'YRN-30C-A').parents[0].kg / 816;
  assert.equal(round(byLot['LINT-B'].kg), round(510 * yarnShareOfBlend));
  assert.equal(round(byLot['LINT-A'].kg), round(340 * yarnShareOfBlend));
  assert.ok(r.sources.some(x => x.id === 'SC-26-001' && x.grower === 'Example FPO member group 4'));
  assert.equal(JSON.stringify(s.lots), before);
});

test('route rules: pulled-forward blow room, step order, packing gate, configured systems, noil and count', () => {
  const { s, run, spinLot, step } = fresh();
  const plan = s.processSetups.find(r => r.code === 'SP-30CR');
  // Lint issued without a posted blend must go through blow room on the spin lot.
  const b = spinLot('SPL-T1', plan.id, '400');
  run('spin-issue', { batchId: b.id, lines: 'LINT-B,200\nLINT-A,140', reference: 'ISS-T1' });
  fails(() => step(b, 'Carding'), /record Blow room before Carding/, 'route-skip');
  step(b, 'Blow room', { droppings: '8' });
  step(b, 'Carding');
  step(b, 'Breaker drawing');
  fails(() => step(b, 'Combing'), /record Lap forming before Combing/, 'route-skip');
  fails(() => run('spin-output', { batchId: b.id, outputId: 'Y-T1', outputQty: '100', cones: '80', coneFrom: '1', coneTo: '80', actualCount: '30', countTest: 'CT', reference: 'P-T1' }),
    /Record Lap forming, Combing, Finisher drawing, Roving, Ring spinning, Winding before packing/, 'route-skip');
  for (const name of ['Lap forming', 'Combing', 'Finisher drawing', 'Roving', 'Ring spinning', 'Winding']) step(b, name);
  // Count outside tolerance is held for quality; it is still posted with its measurements.
  const held = run('spin-output', { batchId: b.id, outputId: 'Y-T1', outputQty: '200', cones: '160', coneFrom: 'T-001', coneTo: 'T-160', actualCount: '31.5',
    countTest: 'CT-T1', noilLotId: 'N-T1', noilKg: '50', waste: '10', reference: 'P-T1' });
  assert.equal(held.qualityStatus, 'Hold');
  assert.match(held.qualityNote, /5% from nominal/);
  fails(() => run('spin-output', { batchId: b.id, outputId: 'Y-T2', outputQty: '50', cones: '40', actualCount: '30', countTest: 'CT', reference: 'P-T2' }), /cone identifiers/);
  // Reverse the latest output: yarn and noil lots return to WIP together.
  const reversed = run('spin-reverse', { batchId: b.id, eventId: held.eventId, reason: 'Count re-test' });
  assert.equal(reversed.reversedKind, 'Production');
  assert.deepEqual([ref(s.lots, 'Y-T1').qty, ref(s.lots, 'N-T1').qty, wipKg(b)], [0, 0, 340]);
  // Rotor route has no roving; a carded route has no noil; rotor needs to be configured.
  const rotorPlan = run('spin-setup', { code: 'SP-20KR', version: '1', route: 'Carded rotor', effective: day, count: '20', composition: '100% cotton', reference: 'CP-20' });
  const r = spinLot('SPL-T2', rotorPlan.id);
  run('spin-issue', { batchId: r.id, lines: 'LINT-B,100', reference: 'ISS-T2' });
  fails(() => step(r, 'Roving'), /Roving is not on the Carded rotor route/, 'route-skip');
  for (const name of ['Blow room', 'Carding', 'Breaker drawing', 'Finisher drawing', 'Rotor spinning']) step(r, name);
  fails(() => run('spin-output', { batchId: r.id, outputId: 'Y-R1', outputQty: '80', cones: '40', coneFrom: 'R1', coneTo: 'R40', actualCount: '20', countTest: 'CT',
    noilLotId: 'N-R1', noilKg: '5', waste: '15', reference: 'P-R1' }), /Noil only arises on a combed route/);
  run('spin-config', { ring: 'yes', version: '2', effective: day, reference: 'Ring only' });
  fails(() => run('spin-setup', { code: 'SP-20KR', version: '2', route: 'Carded rotor', effective: day, count: '20', composition: '100% cotton', reference: 'CP-20b' }),
    /Rotor spinning is not configured/);
  // A carded ring lot from the posted blend skips blow room because it was recorded on the blend.
});

test('stock yarn can be sold or transferred to yarn dyeing; allocation only to yarn orders', () => {
  const { s, run, spinLot, step, loc } = fresh();
  const plan = s.processSetups.find(r => r.code === 'SP-30CR');
  const b = spinLot('SPL-T3', plan.id, '400');
  run('spin-issue', { batchId: b.id, lines: 'LINT-B,300', reference: 'ISS-T3' });
  for (const name of plan && ['Blow room', 'Carding', 'Breaker drawing', 'Lap forming', 'Combing', 'Finisher drawing', 'Roving', 'Ring spinning', 'Winding']) step(b, name);
  const fabricLine = s.lines.find(l => l.sku === 'POP-NVY-M');
  fails(() => run('spin-output', { batchId: b.id, outputId: 'Y-T3', outputQty: '230', cones: '184', coneFrom: '1', coneTo: '184', actualCount: '30', countTest: 'CT',
    noilLotId: 'N-T3', noilKg: '50', waste: '20', allocations: fabricLine.id + ',100', reference: 'P-T3' }), /same unit|ordering yarn/);
  const yarn = run('spin-output', { batchId: b.id, outputId: 'Y-T3', outputQty: '230', cones: '184', coneFrom: '1', coneTo: '184', actualCount: '30', countTest: 'CT',
    noilLotId: 'N-T3', noilKg: '50', waste: '20', reference: 'P-T3' });
  run('quality', { lotId: yarn.id, decision: 'Released', reference: 'QC-Y-T3' });
  // Issue the stock yarn to a yarn dyeing batch.
  const wo = run('work-order', { number: 'WO-YD-SPN', stage: 'Yarn dyeing', plannedQty: '200', unit: 'kg', locationId: loc.id });
  const dye = run('dye-batch', { workOrderId: wo.id, number: 'DYB-SPN', machineId: s.machines.find(m => m.code === 'HTHP-1').id, recipeId: s.processSetups.find(r => r.code === 'RED-R1').id, plannedKg: '200' });
  run('dye-issue', { batchId: dye.id, lines: 'Y-T3,200', reference: 'ISS-DYE-SPN' });
  assert.equal(ref(s.lots, 'Y-T3').qty, 30);
  assert.ok(genealogy(s, 'LINT-B', true).some(l => l.id === 'Y-T3'));
});
