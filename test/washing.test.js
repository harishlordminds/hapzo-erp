import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { genealogy, ref, sum, today } from '../src/model.js';
import { orderWorkflow } from '../src/commerce.js';
import { runActivity } from '../src/passports.js';

const day = today();

function setup(t) {
  const store = new Store(':memory:');
  t.after(() => store.db.close());
  const token = store.bootstrap({ companyName: 'Wash test', login: 'test', displayName: 'Test', password: 'wash-test-only-2026' });
  const session = store.session(token);
  const state = () => store.readState(session.company_id);
  const run = (action, input, requestId = randomUUID()) => store.post(session, {
    companyId: session.company_id, revision: state().revision, requestId, action, input: { date: day, ...input },
  }).id;
  const loc = run('location-master', { code: 'MAIN', site: 'Main factory', warehouse: 'Stores' });
  const buyer = run('party-master', { code: 'BUY', type: 'Buyer', name: 'Sample buyer', currency: 'INR' });
  const processor = run('party-master', { code: 'PRO', type: 'Processor', name: 'Sample processor', currency: 'INR' });
  const machine = run('machine-master', { code: 'DRUM', name: 'Drum washer 1', status: 'In service', locationId: loc });
  const stock = (code, type, unit, qty, netKg) => {
    const itemId = run('item-master', { code, name: code, type, unit });
    run('receipt', { lotId: code, itemId, qty, netKg, mode: 'Opening stock', origin: 'Test intake', locationId: loc, reference: code + '-GRN' });
    run('quality', { lotId: code, decision: 'Released', reference: code + '-QC' });
    return itemId;
  };
  const plan = (stage, unit, qty, steps, product = 'Traded goods') => {
    const route = run('route-master', { code: 'WASH-ROUTE', name: 'Wash route', version: '1', stages: steps });
    const orderId = run('buyer-order', { po: 'WASH-PO', buyerId: buyer, currency: 'INR' });
    const lineId = run('po-line', { orderId, route, unit, qty, product, style: 'Style', color: 'Natural', size: 'M',
      specRev: '1', approvedSpec: 'Wash as approved', delivery: day });
    run('approve-line', { lineId });
    const release = (number, plannedQty = qty, rework = '') => run('work-order', { number, stage, unit, plannedQty, lineId, locationId: loc, rework });
    const recipeId = run('wash-recipe', { code: 'RINSE', version: '1', stage, washType: 'Rinse', method: 'Wash, rinse and extract.',
      minutes: 25, temperatureC: 40, effective: day, reference: 'RECIPE-1' });
    return { orderId, lineId, recipeId, release };
  };
  return { state, run, loc, processor, machine, stock, plan };
}

test('commission wash keeps pcs and kg separate across partial returns and links the service voucher', t => {
  const { state, run, processor, stock, plan } = setup(t);
  const { orderId, lineId, recipeId, release } = plan('Garment washing', 'pcs', 100,
    'Garment washing,Garment QC,Garment finishing,Final inspection', 'Released garment');
  stock('SEWN-A', 'Sewn garment', 'pcs', 70, 16.8);
  stock('SEWN-B', 'Sewn garment', 'pcs', 30, 7.2);
  stock('DETERGENT', 'Chemical', 'kg', 5, 5);
  const workOrderId = release('WO-WASH');
  const batchId = run('wash-load', { workOrderId, recipeId, number: 'WASH-01', mode: 'Commission', processorId: processor,
    site: 'Processor site', challan: 'WC-01', inputs: 'SEWN-A,70\nSEWN-B,30', maxKg: 25 });
  assert.throws(() => run('work-close', { workOrderId, notes: 'Close test' }), /outstanding stock/);
  run('wash-cycle', { batchId, reference: 'CYCLE-01', machine: 'P-01', minutes: 25, loadKg: 24,
    water: 450, steam: 5.2, electricity: 3.6, chemicals: 'DETERGENT,PROC-DET-LOT,0.45' });
  const receipt = { batchId, reference: 'IN-01', lotId: 'SEWN-A', used: 60, beforeKg: 14.4, usableId: 'GOOD-A', usableQty: 58,
    usableKg: 13.68, rewashId: 'REWASH-A', rewashQty: 1, rewashKg: 0.235, rejectedId: 'REJECT-A', rejectedQty: 1, rejectedKg: 0.235,
    measurements: 'Body length,cm,70,68.6', notes: 'Review shade on one piece. Reject damaged seam.' };
  assert.throws(() => run('wash-output', { ...receipt, usableQty: 57 }), /Reconcile 60 pcs/);
  const requestId = randomUUID();
  run('wash-output', receipt, requestId);
  run('wash-output', receipt, requestId);
  let s = state();
  const batch = ref(s.processBatches, batchId);
  const job = ref(s.jobs, batch.jobId);
  assert.deepEqual([job.sent, job.sentKg, job.returnedQty, job.returnedKg, job.qty, job.remainingKg, job.status],
    [100, 24, 60, 14.15, 40, 9.6, 'Part returned']);
  assert.deepEqual(batch.lines.map(row => [row.lotId, row.issued - row.consumed]), [['SEWN-A', 10], ['SEWN-B', 30]]);
  const custody = s.events.flatMap(e => e.moves ?? []).filter(move => move.custody === job.processor);
  assert.equal(sum(custody), 40);
  assert.equal(ref(s.lots, 'DETERGENT').qty, 5, 'reported processor chemical is outside own stock');
  assert.deepEqual(['GOOD-A', 'REWASH-A', 'REJECT-A'].map(id => {
    const lot = ref(s.lots, id);
    assert.equal(lot.washBatchId, batchId);
    assert.equal(lot.parents[0].id, 'SEWN-A');
    return [lot.qty, lot.qualityStatus];
  }), [[58, 'Released'], [1, 'Rework'], [1, 'Rejected']]);
  assert.ok(orderWorkflow(s, orderId, lineId).lots.some(lot => lot.id === 'SEWN-B'));
  assert.equal(ref(s.workOrders, workOrderId).completedQty, 58);
  assert.equal(s.events.filter(e => e.batchId === batchId && e.kind === 'Processed return').length, 1);
  assert.equal(runActivity(s, ref(s.lots, 'GOOD-A'))[0].steam, 3.016);
  assert.throws(() => run('wash-output', { ...receipt, reference: 'IN-02', usableId: 'EXCESS' }), /outstanding 10 pcs/);
  assert.throws(() => run('job-return', { jobId: job.id }), /actual wash return/);
  const costId = run('cost', { lotId: 'GOOD-A', reference: 'BILL-01', category: 'Job work', net: 900 });
  const voucherId = run('account-erp-purchase', { sourceId: costId });
  s = state();
  assert.deepEqual([ref(s.costs, costId).supplierId, ref(s.costs, costId).washBatchId, ref(s.costs, costId).challan], [processor, batchId, 'WC-01']);
  assert.equal(ref(s.vouchers, voucherId).source.returnEventId, ref(s.lots, 'GOOD-A').eventId);
  run('wash-output', { batchId, reference: 'IN-01', lotId: 'SEWN-B', used: 30, usableId: 'GOOD-B', usableQty: 30, usableKg: 7.1 });
  run('wash-output', { batchId, reference: 'IN-02', lotId: 'SEWN-A', used: 10, usableId: 'GOOD-A2', usableQty: 10, usableKg: 2.35 });
  s = state();
  assert.equal(ref(s.jobs, job.id).status, 'Reconciled');
  assert.deepEqual([ref(s.processBatches, batchId).remainingQty, ref(s.processBatches, batchId).remainingKg], [0, 0]);
});

for (const [stage, material, unit] of [
  ['Yarn washing', 'Dyed yarn', 'cone'], ['Fabric washing', 'Finished fabric', 'roll'], ['Cut bundle washing', 'Printed bundle', 'bundle'],
]) {
  test('in-house wash retains ' + unit + ' stock, chemical usage and lineage through re-wash', t => {
    const { state, run, machine, stock, plan } = setup(t);
    const { recipeId, release } = plan(stage, unit, 10, stage);
    const workOrderId = release('WASH-IN');
    stock('SOURCE', material, unit, 10, 20);
    stock('CHEMICAL', 'Chemical', 'kg', 5, 5);
    const issue = { workOrderId, number: 'LOAD-01', recipeId, machineId: machine, mode: 'In-house', inputs: 'SOURCE,10' };
    assert.throws(() => run('wash-load', { ...issue, maxKg: 15 }), /machine load limit/);
    assert.equal(ref(state().lots, 'SOURCE').qty, 10);
    const batchId = run('wash-load', { ...issue, maxKg: 20 });
    run('wash-output', { batchId, lotId: 'SOURCE', used: 2, unused: 'yes', usableId: 'UNUSED', reference: 'UNUSED-01' });
    run('wash-cycle', { batchId, reference: 'CYC-1', minutes: 25, chemicals: 'CHEMICAL,0.8', water: 160 });
    run('wash-output', { batchId, lotId: 'SOURCE', used: 8, usableId: 'GOOD', usableQty: 5, usableKg: 10.1,
      rewashId: 'REWASH', rewashQty: 2, rewashKg: 4.1, rejectedId: 'REJECT', rejectedQty: 1, rejectedKg: 2,
      notes: 'Inspect shade and surface damage.', reference: 'OUTPUT-1' });
    assert.equal(ref(state().workOrders, workOrderId).completedQty, 5);
    assert.equal(ref(state().processBatches, batchId).status, 'Closed');
    const rewash = release('WASH-REWORK', 2, 'yes');
    const rewashBatchId = run('wash-load', { ...issue, workOrderId: rewash, number: 'REWORK-01', inputs: 'REWASH,2' });
    run('wash-cycle', { batchId: rewashBatchId, reference: 'CYC-2', minutes: 25, noChemicals: 'yes', water: 80 });
    run('wash-output', { batchId: rewashBatchId, lotId: 'REWASH', used: 2, usableId: 'REWASH-GOOD', usableQty: 2,
      usableKg: 4, reference: 'OUTPUT-2' });
    const s = state();
    assert.deepEqual(genealogy(s, 'REWASH-GOOD').map(lot => lot.id).sort(), ['CHEMICAL', 'REWASH', 'SOURCE']);
    assert.deepEqual([ref(s.lots, 'REWASH-GOOD').material, ref(s.lots, 'REWASH-GOOD').unit, ref(s.lots, 'CHEMICAL').qty], [material, unit, 4.2]);
    assert.equal(ref(s.lots, 'UNUSED').netKg, 4);
  });
}

test('a wash can only be released and loaded through the approved operation sequence', t => {
  const { state, run, machine, stock, plan, loc } = setup(t);
  const { recipeId, release, lineId } = plan('Garment washing', 'pcs', 10, 'Stitching,Garment washing,Garment QC');
  assert.throws(() => run('work-order', { number: 'YARN-WASH', stage: 'Yarn washing', plannedQty: 10, unit: 'kg', locationId: loc, lineId }),
    /operation on its route/);
  stock('STITCH', 'Sewn garment', 'pcs', 10, 2.4);
  const workOrderId = release('WASH-AFTER-STITCH');
  assert.throws(() => run('wash-load', { workOrderId, number: 'LOAD', recipeId, machineId: machine, mode: 'In-house', inputs: 'STITCH,10' }),
    /requires Stitching before Garment washing/);
  assert.equal(ref(state().lots, 'STITCH').qty, 10);
});
