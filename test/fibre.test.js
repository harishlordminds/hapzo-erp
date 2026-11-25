import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { demo } from '../src/demo.js';
import { execute } from '../src/actions.js';
import { genealogy, today, ref, round, sum } from '../src/model.js';
import { batchSummary, wipKg } from '../src/process-batch.js';
import { scanRecord } from '../src/fibre.js';
import { runActivity } from '../src/passports.js';
import { lotCost } from '../src/fulfilment.js';

const day = today();
const ctx = { role: 'Admin', actor: 'test', at: new Date().toISOString(), document: () => null,
  publicToken: () => randomBytes(24).toString('base64url'), digest: o => createHash('sha256').update(JSON.stringify(o)).digest('hex') };
const fails = (fn, pattern, code) => assert.throws(fn, error => (!code || error.code === code) && pattern.test(error.message), 'expected ' + pattern);
const ownSiteBalance = (s, lotId) => round(sum(s.events.flatMap(e => e.moves ?? []).filter(m => m.lotId === lotId && m.custody === 'Own site')));

function fresh() {
  const s = demo();
  const run = (action, input) => execute(s, action, { date: day, ...input }, ctx);
  const loc = s.locations.find(l => l.code === 'MAIN');
  const lint = s.items.find(i => i.code === 'LINT-BALE');
  const ginner = s.parties.find(p => p.code === 'DEMO-GIN');
  const plan = s.processSetups.find(r => r.code === 'BP-30C');
  const blowroom = s.machines.find(m => m.code === 'BR-1');
  const inward = (lotId, variety, bales, more = {}) => {
    const out = run('bale-inward', { lotId, itemId: lint.id, supplierId: ginner.id, origin: 'Test origin ' + lotId, ginner: 'Test ginner', variety, locationId: loc.id,
      bales, weighRef: 'BW-' + lotId, reference: 'GRN-' + lotId, ...more });
    for (const lot of out.lots) if (!lot.standardHold) run('quality', { lotId: lot.id, decision: 'Released', reference: 'QC-' + lot.id });
    return out.lots;
  };
  const blendFor = (number, planned = '400') => {
    const wo = run('work-order', { number: 'WO-' + number, stage: 'Fibre preparation', plannedQty: planned, unit: 'kg', locationId: loc.id });
    return run('blend-open', { workOrderId: wo.id, number, machineId: blowroom.id, recipeId: plan.id, plannedKg: planned });
  };
  const entry = (b, step = 'Opening', more = {}) => run('blend-entry', { batchId: b.id, step, start: day + 'T08:00', end: day + 'T09:00', operator: 'Op', shift: 'A', reference: 'LOG-' + b.number + '-' + step, ...more });
  return { s, run, loc, lint, ginner, inward, blendFor, entry };
}

test('two lint bale lots enter one blend; the blend traces back to both sources and their issued weights', () => {
  const { s } = fresh();
  const blend = s.processBatches.find(b => b.number === 'BL-26-01');
  assert.equal(blend.status, 'Closed');
  const issue = s.events.find(e => e.batchId === blend.id && e.kind === 'Process issue');
  assert.deepEqual(issue.inputs.map(i => [i.id, i.kg, i.component]), [['LINT-B', 510, 'Shankar-6'], ['LINT-A', 340, 'MCU-5']]);
  const pf = ref(s.lots, 'PF-BL-26-01');
  assert.deepEqual(pf.parents.map(p => [p.id, p.kg]), [['LINT-B', 510], ['LINT-A', 340]]);
  const back = genealogy(s, 'YRN-30C-A').map(l => l.id);
  for (const id of ['PF-BL-26-01', 'LINT-A', 'LINT-B', 'SC-26-001']) assert.ok(back.includes(id), id);
  // Each source keeps its own origin and supplier: purchased lint and ginned seed cotton.
  assert.equal(ref(s.lots, 'LINT-A').origin, 'Akola district, Maharashtra');
  assert.equal(ref(s.lots, 'SC-26-001').intake.grower, 'Example FPO member group 4');
  assert.equal(ref(s.lots, 'LINT-B').origin, 'Rajkot district, Gujarat');
  // Forward from the seed cotton reaches lint, seed, blend and yarn.
  const forward = genealogy(s, 'SC-26-001', true).map(l => l.id);
  for (const id of ['LINT-B', 'CSEED-26-01', 'PF-BL-26-01', 'YRN-30C-A', 'YRN-30C-B']) assert.ok(forward.includes(id), id);
  for (const id of ['SC-26-001', 'LINT-A', 'LINT-B', 'CSEED-26-01', 'PF-BL-26-01', 'YRN-30C-B']) assert.equal(ownSiteBalance(s, id), ref(s.lots, id).qty, id);
  assert.equal(ref(s.lots, 'LINT-A').qty, 510);
  assert.equal(ref(s.lots, 'LINT-B').qty, 850);
});

test('ginning records weighbridge basis, outturn, lint bales, seed and waste', () => {
  const { s } = fresh();
  const seed = ref(s.lots, 'SC-26-001');
  assert.deepEqual([seed.intake.grossKg, seed.intake.tareKg, seed.intake.netKg, seed.initialQty], [5400, 1400, 4000, 4000]);
  assert.equal(seed.intake.basis, 'Weighbridge gross − tare');
  const run = s.processBatches.find(b => b.number === 'GR-26-01');
  const out = s.events.find(e => e.batchId === run.id && e.kind === 'Production');
  assert.deepEqual(out.outputs, ['LINT-B', 'CSEED-26-01']);
  assert.deepEqual(out.outturn, { lintPct: 34, seedPct: 62.75, wastePct: 3.25 });
  assert.equal(ref(s.lots, 'LINT-B').fibre.baleCount, 8);
  assert.equal(ref(s.lots, 'LINT-B').fibre.tracking, 'Bale lot');
  // Lint and seed share the seed cotton by mass, so inputs, energy and cost are not double counted.
  const lintShare = ref(s.lots, 'LINT-B').parents[0].kg;
  const seedShare = ref(s.lots, 'CSEED-26-01').parents[0].kg;
  // All 4000 kg consumed is carried by the two products; waste has no lot.
  assert.equal(round(lintShare + seedShare), 4000);
  assert.equal(lintShare, round(4000 * 1360 / 3870));
  assert.ok(sum(s.costs.filter(c => c.source?.id === out.id), c => c.landed) > 0);
  assert.ok(lotCost(s, ref(s.lots, 'LINT-B')) > 0 && lotCost(s, ref(s.lots, 'CSEED-26-01')) > 0);
  const energy = runActivity(s, ref(s.lots, 'YRN-30C-B')).filter(r => r.stage === 'Ginning');
  assert.ok(energy.length && energy[0].electricity > 0 && energy[0].electricity < 320);
  const summary = batchSummary(s, run);
  assert.equal(summary.byProductKg, 2510);
});

test('blocked cases: weighbridge, gin reconciliation, blend mix, handoff granularity and lot links', () => {
  const { s, run, loc, inward, blendFor, entry } = fresh();
  const seedItem = s.items.find(i => i.code === 'SEED-COT');
  const fpo = s.parties.find(p => p.code === 'DEMO-FPO');
  fails(() => run('seed-inward', { lotId: 'SC-X', itemId: seedItem.id, supplierId: fpo.id, grower: 'G', origin: 'O', locationId: loc.id, grossKg: '1000', tareKg: '1000', weighbridgeRef: 'WB-X' }), /Gross weight must exceed tare/);
  // Gin output that does not reconcile with seed cotton consumed.
  const seed = run('seed-inward', { lotId: 'SC-T1', itemId: seedItem.id, supplierId: fpo.id, grower: 'G', origin: 'O', locationId: loc.id, grossKg: '1300', tareKg: '300', weighbridgeRef: 'WB-T1', variety: 'Shankar-6' });
  run('quality', { lotId: seed.id, decision: 'Released', reference: 'QC-SC-T1' });
  const ginWo = run('work-order', { number: 'WO-GIN-T1', stage: 'Ginning', plannedQty: '400', unit: 'kg', locationId: loc.id });
  const gr = run('gin-run', { workOrderId: ginWo.id, number: 'GR-T1', machineId: s.machines.find(m => m.code === 'GIN-1').id, plannedKg: '1000' });
  run('gin-issue', { batchId: gr.id, lines: 'SC-T1,1000', reference: 'GI-T1' });
  run('gin-entry', { batchId: gr.id, step: 'Ginning', start: day + 'T06:00', end: day + 'T08:00', operator: 'Op', shift: 'A', reference: 'GL-T1' });
  fails(() => run('gin-output', { batchId: gr.id, lotId: 'LINT-T1', bales: 'T1-1,170\nT1-2,170', seedLotId: 'SEED-T1', seedKg: '620', waste: '30', consumedKg: '1000', reference: 'P-T1' }), /Reconcile 1000 kg consumed/);
  run('gin-output', { batchId: gr.id, lotId: 'LINT-T1', bales: 'T1-1,170\nT1-2,170', seedLotId: 'SEED-T1', seedKg: '630', waste: '30', reference: 'P-T1' });
  assert.equal(wipKg(gr), 0);
  // Blend mix outside the approved tolerance is blocked at handoff.
  inward('LINT-S6', 'Shankar-6', 'S6-1,170\nS6-2,170');
  inward('LINT-M5', 'MCU-5', 'M5-1,170\nM5-2,170');
  const b = blendFor('BL-T1', '500');
  run('blend-issue', { batchId: b.id, lines: 'LINT-S6,300\nLINT-M5,100', reference: 'BI-T1' });
  entry(b);
  fails(() => run('blend-output', { batchId: b.id, outputId: 'PF-T1', outputQty: '390', waste: '10', reference: 'BO-T1' }), /deviates from plan BP-30C: Shankar-6 is 75%/, 'blend-plan');
  run('blend-issue', { batchId: b.id, lines: 'LINT-M5,100', reference: 'BI-T1B' });
  // Blend lot granularity: one output must take the whole blend.
  fails(() => run('blend-output', { batchId: b.id, outputId: 'PF-T1', outputQty: '200', waste: '5', reference: 'BO-T1' }), /one prepared fibre lot per blend/, 'granularity');
  run('blend-output', { batchId: b.id, outputId: 'PF-T1', outputQty: '488', waste: '12', reference: 'BO-T1' });
  // A bale that is not part of the plan, and a laydown listing a lot not issued to the blend.
  inward('LINT-DCH', 'DCH-32', 'D-1,170');
  const b2 = blendFor('BL-T2');
  fails(() => run('blend-issue', { batchId: b2.id, lines: 'LINT-DCH,170', reference: 'BI-T2' }), /not a component of blend plan BP-30C/, 'blend-plan');
  run('blend-issue', { batchId: b2.id, lines: 'LINT-S6,40', reference: 'BI-T2' });
  fails(() => entry(b2, 'Laydown', { laydownNo: 'LD-T2', laydown: 'LINT-A' }), /Invalid lot link · LINT-A/, 'lot-link');
  fails(() => run('blend-issue', { batchId: b2.id, lines: 'LINT-S6,500', reference: 'BI-T2B' }), /Over-issue/);
});

test('mill configuration: each-bale tracking and can-level handoff', () => {
  const { s, run, inward, blendFor, entry } = fresh();
  run('fibre-config', { baleTracking: 'Each bale', handoff: 'Each can / lap', version: '2', effective: day, reference: 'MTP-02' });
  const lots = inward('IGNORED', 'Shankar-6', 'EB-1,170\nEB-2,171');
  assert.deepEqual(lots.map(l => [l.id, l.qty, l.fibre.baleCount]), [['EB-1', 170, 1], ['EB-2', 171, 1]]);
  inward('IGNORED2', 'MCU-5', 'EB-3,227');
  const b = blendFor('BL-CAN', '568');
  assert.equal(b.handoff, 'Each can / lap');
  run('blend-issue', { batchId: b.id, lines: 'EB-1,170\nEB-2,171\nEB-3,227', reference: 'BI-CAN' });
  entry(b);
  fails(() => run('blend-output', { batchId: b.id, outputId: 'CAN-1', outputQty: '100', reference: 'C1' }), /Can or lap number is required/);
  run('blend-output', { batchId: b.id, outputId: 'CAN-1', outputQty: '100', canNo: 'C-01', reference: 'C1' });
  run('blend-output', { batchId: b.id, outputId: 'CAN-2', outputQty: '100', canNo: 'C-02', reference: 'C2' });
  assert.equal(wipKg(b), 368);
  const back = genealogy(s, 'CAN-2').map(l => l.id).sort();
  assert.deepEqual(back, ['EB-1', 'EB-2', 'EB-3']);
});

test('scan retrieves bale and blend records with evidence and standard eligibility, without changing stock', () => {
  const { s, run, ginner, lint, loc } = fresh();
  const before = JSON.stringify(s.lots);
  const target = s.processBatches.find(b => b.number === 'BL-26-01').id;
  const bale = scanRecord(s, 'HZ:LOT:PB-102', target);
  assert.equal(bale.lot.id, 'LINT-A');
  assert.equal(bale.bale.netKg, 169);
  assert.ok(bale.standard.ok && bale.blend.ok && bale.blend.component === 'MCU-5');
  const held = scanRecord(s, 'PB-201', target);
  assert.equal(held.standard.ok, false);
  assert.match(held.standard.reason, /OCS requires verified/);
  const blend = scanRecord(s, 'HZ:BLEND:BL-26-01');
  assert.deepEqual(blend.lines.map(l => [l.lot.id, l.line.issuedKg]), [['LINT-B', 510], ['LINT-A', 340]]);
  assert.equal(JSON.stringify(s.lots), before);
  // Standard Lock on a claimed blend: OCS lint is blocked at issue until supplier and processor evidence is verified.
  const ev = run('evidence', { scheme: 'OCS', kind: 'Scope certificate', role: 'Supplier', partyId: ginner.id, site: 'Akola district, Maharashtra',
    number: 'OCS-GIN-1', issuer: 'Example CB', issue: day, until: day, operations: 'Supply', materials: 'Cotton bale' });
  run('review-evidence', { evidenceId: ev.id, status: 'Verified', source: 'Test lookup', scopeConfirmed: 'yes' });
  run('release-standard', { lotId: 'LINT-C' });
  run('quality', { lotId: 'LINT-C', decision: 'Released', reference: 'QC-LINT-C' });
  const wo = run('work-order', { number: 'WO-OCS', stage: 'Fibre preparation', plannedQty: '300', unit: 'kg', locationId: loc.id, scheme: 'OCS' });
  const b = run('blend-open', { workOrderId: wo.id, number: 'BL-OCS', machineId: s.machines.find(m => m.code === 'BR-1').id, recipeId: s.processSetups.find(r => r.code === 'BP-30C').id, plannedKg: '300' });
  fails(() => run('blend-issue', { batchId: b.id, lines: 'LINT-C,200', reference: 'BI-OCS' }), /OCS requires verified .* for HAPZO Training Mill .* Fibre preparation/, 'standard-lock');
  void lint;
});
