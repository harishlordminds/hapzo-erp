import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { genealogy, ref, sum, today } from '../src/model.js';
import { orderWorkflow } from '../src/commerce.js';

const day = today();

function setup(t) {
  const store = new Store(':memory:');
  t.after(() => store.db.close());
  const token = store.bootstrap({ companyName: 'Print factory', login: 'test', displayName: 'Test', password: 'printing-test-only-2026' });
  const session = store.session(token);
  const state = () => store.readState(session.company_id);
  const run = (action, input, requestId = randomUUID()) => store.post(session, {
    companyId: session.company_id, revision: state().revision, requestId, action, input: { date: day, ...input },
  }).id;
  const loc = run('location-master', { code: 'MAIN', site: 'Print mill', warehouse: 'Stores' });
  const buyer = run('party-master', { code: 'BUY', type: 'Buyer', name: 'Sample buyer', currency: 'INR' });
  const processor = run('party-master', { code: 'PRO', type: 'Processor', name: 'Panel processor', currency: 'INR' });
  const machineId = run('machine-master', { code: 'PRESS', name: 'Screen press', status: 'In service', locationId: loc });
  const stock = (lotId, type, unit, qty, netKg = '') => {
    const itemId = run('item-master', { code: lotId, name: lotId, type, unit });
    run('receipt', { lotId, itemId, qty, netKg, mode: 'Opening stock', origin: 'Sample source', locationId: loc, reference: lotId + '-IN' });
    run('quality', { lotId, decision: 'Released', reference: lotId + '-QC' });
  };
  const plan = (stage, stages, unit, qty, product, finish) => {
    const route = run('route-master', { code: 'PRINT-ROUTE', name: 'Approved print route', version: '1', stages });
    const orderId = run('buyer-order', { po: 'PRINT-PO', buyerId: buyer, currency: 'INR' });
    const lineId = run('po-line', { orderId, route, unit, qty, product, style: 'Printed style', color: 'Navy', size: 'M', specRev: '1',
      approvedSpec: 'Print using the approved artwork and placement.', delivery: day });
    run('approve-line', { lineId });
    const art = (version = '2') => run('print-artwork', { lineId, stage, code: 'DESIGN', version, effective: day, method: 'Screen printing',
      design: 'Logo', placement: 'Front centre', finish, reference: 'ART-APP-' + version });
    const artworkId = art();
    const release = (number, plannedQty = qty, rework = '', artwork = artworkId) =>
      run('print-order', { number, artworkId: artwork, unit, plannedQty, locationId: loc, rework });
    return { orderId, lineId, artworkId, art, release };
  };
  const facility = (name, site, partyId = '') => {
    const evidenceId = run('evidence', { scheme: 'Buyer code', kind: 'Buyer approval', scopeType: 'Facility', role: 'Processor',
      ...(partyId ? { partyId } : { party: name }), site, number: 'BUY-APP-' + site, operations: 'Printing' });
    run('review-evidence', { evidenceId, status: 'Verified', source: 'Sample buyer approval', method: 'Buyer acceptance', scopeConfirmed: 'yes' });
    return evidenceId;
  };
  return { state, run, loc, processor, machineId, stock, plan, facility };
}

test('commission panel printing checks site, reconciles the partial return and rework, and feeds only accepted panels to sewing', t => {
  const { state, run, loc, processor, machineId, stock, plan, facility } = setup(t);
  const { orderId, lineId, release, art, artworkId } = plan('Printing', 'Cutting,Printing,Stitching,Packing', 'pcs', 100, 'Packed carton', 'Curing');
  stock('FABRIC', 'Inspected fabric', 'kg', 30);
  stock('INK', 'Chemical', 'kg', 5);
  stock('UNPRINTED', 'Cut bundle', 'pcs', 5);
  const cut = run('work-order', { stage: 'Cutting', lineId, locationId: loc, plannedQty: 100, number: 'CUT-1' });
  run('production', { workOrderId: cut, inputs: 'FABRIC,30', outputId: 'CUT-BUNDLE', outputQty: 100, netKg: 29,
    waste: 1, balanceUnit: 'kg', reference: 'CUT-FABRIC' });
  run('claim-rule', { scheme: 'Buyer code', scopeType: 'Facility', operation: 'Printing', lineId, effective: day,
    kinds: 'Buyer approval', version: '1', source: 'Buyer site list' });
  const outsideApproval = facility('', 'Approved press site', processor);
  facility('Print factory', 'Print mill');
  const workOrderId = release('PRINT-WO');
  const issue = { workOrderId, mode: 'Commission', number: 'BATCH-1', processorId: processor, site: 'Approved press site',
    challan: 'OUT-1', inputs: 'CUT-BUNDLE,100' };
  assert.throws(() => run('print-issue', { ...issue, site: 'Other press site' }), /requires verified Buyer approval covering Other press site/);
  assert.equal(ref(state().lots, 'CUT-BUNDLE').qty, 100);
  const batchId = run('print-issue', issue);
  assert.ok(ref(state().processBatches, batchId).checks.flatMap(c => c.evidence).some(e => e.id === outsideApproval));
  const print = { batchId, lotId: 'CUT-BUNDLE', qty: 70, reference: 'SCREEN-1', machine: 'Press 6', inkBatch: 'PASTE-1', chemicals: 'INK,EXT-INK-6,0.65' };
  run('print-operation', print);
  assert.throws(() => run('print-operation', { ...print, qty: 31, reference: 'EXCESS-RUN' }), /unprinted balance of 30 pcs/);
  const runId = ref(state().processBatches, batchId).runs[0].id;
  const partial = { batchId, runId, reference: 'IN-1', used: 70, outputs: 'Accepted,GOOD,60\nMisprint,MISPRINT,6',
    waste: 4, notes: 'Wrong registration on six panels. Four panels unusable.' };
  assert.throws(() => run('print-output', partial), /Record Curing/);
  run('print-operation', { batchId, runId, reference: 'CURE-1', operation: 'Curing', machine: 'Tunnel 6', settings: 'Recorded curing profile' });
  assert.throws(() => run('print-output', { ...partial, waste: 3 }), /Reconcile issued pcs/);
  const requestId = randomUUID();
  run('print-output', partial, requestId);
  run('print-output', partial, requestId);
  let s = state();
  const b = ref(s.processBatches, batchId);
  const job = ref(s.jobs, b.jobId);
  assert.deepEqual([job.sent, job.returnedQty, job.acceptedQty, job.misprintQty, job.loss, job.qty, job.status],
    [100, 66, 60, 6, 4, 30, 'Part returned']);
  assert.equal(sum(s.events.flatMap(e => e.moves ?? []).filter(m => m.custody === job.processor && m.lotId === 'CUT-BUNDLE')), 30);
  assert.equal(ref(s.lots, 'INK').qty, 5);
  assert.equal(ref(s.lots, 'MISPRINT').qualityStatus, 'Rework');
  assert.equal(ref(s.lots, 'GOOD').printing.artworkId, artworkId);
  assert.equal(s.events.filter(e => e.jobId === job.id && e.kind === 'Processed return').length, 1);
  assert.throws(() => run('job-return', { jobId: job.id }), /actual print return/);
  const otherArtwork = art('3');
  const wrongWork = release('OTHER-REV', 6, 'yes', otherArtwork);
  const reissue = { number: 'BATCH-RW', inputs: 'MISPRINT,6', mode: 'In-house' };
  assert.throws(() => run('print-issue', { ...reissue, workOrderId: wrongWork }), /same approved artwork revision/);
  const reworkOrder = release('REWORK-WO', 6, 'yes');
  const reworkBatch = run('print-issue', { ...reissue, workOrderId: reworkOrder });
  run('print-operation', { batchId: reworkBatch, lotId: 'MISPRINT', qty: 6, reference: 'RW-PRESS', inkBatch: 'PASTE-RW-1', machineId, chemicals: 'INK,0.15' });
  const reworkRun = ref(state().processBatches, reworkBatch).runs[0].id;
  run('print-operation', { batchId: reworkBatch, runId: reworkRun, operation: 'Curing', machineId, reference: 'RW-CURE', settings: 'Rework cure verified' });
  run('print-output', { batchId: reworkBatch, runId: reworkRun, used: 6, outputs: 'Accepted,RECOVERED,5\nRejected,IRRECOVERABLE,1',
    reference: 'RW-OUT', notes: 'One panel could not be corrected.' });
  const sew = run('work-order', { stage: 'Stitching', lineId, locationId: loc, plannedQty: 100, number: 'SEW-1' });
  const sewInputs = { workOrderId: sew, outputId: 'SEWN-GOOD', reference: 'SEW-RUN' };
  assert.throws(() => run('production', { ...sewInputs, inputs: 'UNPRINTED,5', outputQty: 5 }), /Post accepted cut-panel printing/);
  assert.throws(() => run('production', { ...sewInputs, inputs: 'IRRECOVERABLE,1', outputQty: 1 }), /quality status Rejected/);
  run('production', { ...sewInputs, inputs: 'GOOD,60\nRECOVERED,5', outputQty: 65 });
  s = state();
  assert.equal(ref(s.jobs, job.id).qty, 30);
  assert.equal(ref(s.workOrders, sew).completedQty, 65);
  assert.ok(genealogy(s, 'SEWN-GOOD').some(lot => lot.id === 'CUT-BUNDLE'));
  assert.ok(genealogy(s, 'SEWN-GOOD').some(lot => lot.id === 'MISPRINT'));
  assert.equal(ref(s.lots, 'INK').qty, 4.85);
  assert.ok(orderWorkflow(s, orderId, lineId).lots.some(lot => lot.id === 'RECOVERED'));
});

for (const [stage, material, unit, qty] of [
  ['Fabric printing', 'Finished fabric', 'm', 80], ['Garment printing', 'Sewn garment', 'pcs', 12],
]) {
  test(stage + ' keeps the native stock unit, source identity and approved treatment order', t => {
    const { state, run, machineId, stock, plan } = setup(t);
    const { release } = plan(stage, stage, unit, qty, material === 'Finished fabric' ? material : 'Traded goods', 'Washing then curing');
    const workOrderId = release('PRINT-TEST');
    stock('SOURCE', material, unit, qty);
    const batchId = run('print-issue', { workOrderId, number: 'IN-HOUSE', mode: 'In-house', inputs: 'SOURCE,' + qty });
    run('print-operation', { batchId, lotId: 'SOURCE', qty, machineId, inkBatch: 'TRANSFER-1', noChemicals: 'yes', reference: 'OP-1' });
    const runId = ref(state().processBatches, batchId).runs[0].id;
    const treatment = { batchId, runId, machineId, settings: 'Measured cycle recorded' };
    assert.throws(() => run('print-operation', { ...treatment, operation: 'Curing', reference: 'WRONG-STEP' }), /Record Washing next/);
    run('print-operation', { ...treatment, operation: 'Washing', reference: 'WASH-1' });
    run('print-operation', { ...treatment, operation: 'Curing', reference: 'CURE-1' });
    run('print-output', { batchId, runId, used: qty, outputs: 'Accepted,FINISHED,' + qty, reference: 'RECEIPT' });
    const output = ref(state().lots, 'FINISHED');
    assert.deepEqual([output.stage, output.material, output.unit, output.qty, output.parents[0].id, output.printing.inkBatch],
      [stage, material, unit, qty, 'SOURCE', 'TRANSFER-1']);
    assert.equal(output.qualityStatus, 'Released');
  });
}
