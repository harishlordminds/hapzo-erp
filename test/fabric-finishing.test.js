import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { ref, today } from '../src/model.js';
import { finishedRollTrace } from '../src/fabric-finishing.js';
import { orderWorkflow } from '../src/commerce.js';
import { wipKg } from '../src/process-batch.js';

const day = today();

function setup(t) {
  const store = new Store(':memory:');
  t.after(() => store.db.close());
  const token = store.bootstrap({ companyName: 'Finishing test', login: 'test', displayName: 'Test', password: 'finishing-test-only-2026' });
  const session = store.session(token);
  const state = () => store.readState(session.company_id);
  const run = (action, input) => store.post(session, {
    action, companyId: session.company_id, revision: state().revision, requestId: randomUUID(), input: { date: day, ...input },
  }).id;
  const loc = run('location-master', { code: 'MAIN', site: 'Sample mill', warehouse: 'Fabric' });
  const buyer = run('party-master', { code: 'BUY', type: 'Buyer', name: 'Sample buyer', currency: 'INR' });
  const drum = run('machine-master', { code: 'DRUM', name: 'Dryer', status: 'In service', locationId: loc });
  const stenter = run('machine-master', { code: 'STENTER', name: 'Stenter', status: 'In service', locationId: loc });
  const item = (code, type) => run('item-master', { code, name: code, type, unit: 'kg' });
  const receipt = (id, itemId, qty) => {
    run('receipt', { lotId: id, itemId, qty, mode: 'Opening stock', locationId: loc, origin: 'Sample source', supplierLot: id + '-SUP', reference: id + '-IN' });
    run('quality', { lotId: id, decision: 'Released', reference: id + '-QC' });
  };
  const line = (po, route, product, unit, qty) => {
    const orderId = run('buyer-order', { po, buyerId: buyer, currency: 'INR' });
    const lineId = run('po-line', { orderId, style: 'Single jersey', color: 'Navy', size: 'M', product, route, qty, unit, price: 200,
      specRev: '1', approvedSpec: 'Conditioned finishing, approved by the buyer.', fabricType: 'Knitted', fabricStructure: 'Single jersey',
      gsm: 212, fabricTolGsm: '5', delivery: day });
    run('approve-line', { lineId });
    return { orderId, lineId };
  };
  const route = (name, stages) => run('route-master', { code: name.replaceAll(' ', '-'), name, version: '1', stages });
  const work = (number, stage, lineId, plannedQty, unit = 'kg') => run('work-order', { number, lineId, stage, plannedQty, unit, locationId: loc });
  const inspect = (lotId, measuredGsm) => run('quality', { lotId, decision: 'Released', fabricType: 'Knitted',
    fabricStructure: 'Single jersey', measuredGsm, reference: lotId + '-LAB' });
  return { state, run, loc, drum, stenter, item, receipt, line, route, work, inspect };
}

test('a dyed roll splits into two measurable rolls, traces through dye and yarn, and releases for sale or cutting', t => {
  const { state, run, loc, drum, stenter, item, receipt, line, route, work, inspect } = setup(t);
  const manufacture = route('Fabric-dyed jersey', 'Knitting,Fabric dyeing,Fabric finishing,Fabric inspection,Cutting,Packing');
  const { orderId, lineId } = line('MAKING', manufacture, 'Packed carton', 'pcs', 200);
  const yarn = item('YARN', 'Yarn');
  const chemical = item('SOFTENER', 'Chemical');
  receipt('YARN-A', yarn, 100);
  receipt('CHEM-A', chemical, 2);
  // Actual posted yarn, knitting and fabric dyeing establish the route and ancestry.
  run('production', { workOrderId: work('WO-KNIT', 'Knitting', lineId, 100), inputs: 'YARN-A,100', outputId: 'GREIGE-A', outputQty: 100, reference: 'KNIT-01' });
  const dyeOrder = work('WO-DYE', 'Fabric dyeing', lineId, 100);
  const recipeId = run('fdye-setup', { code: 'DYE-PLAN', version: '1', shade: 'Navy', fabricKind: 'Knitted', reference: 'DIP-1', effective: day });
  const dyeId = run('fdye-open', { workOrderId: dyeOrder, recipeId, machineId: drum, number: 'DYE-B01', plannedKg: 100 });
  run('fdye-issue', { batchId: dyeId, lines: 'GREIGE-A,100', reference: 'DYE-I' });
  for (const [i, step] of ['Loading', 'Dyeing', 'Washing / soaping', 'Unloading'].entries()) {
    run('fdye-entry', { batchId: dyeId, step, start: day + 'T0' + (i + 4) + ':00', end: day + 'T0' + (i + 4) + ':25',
      operator: 'Operator', shift: 'A', reference: 'DYE-OP-' + i });
  }
  run('fdye-rolls', { batchId: dyeId, rolls: 'DYED-A,100,116,313,GREIGE-A', reference: 'DYE-OUT' });
  run('quality', { lotId: 'DYED-A', decision: 'Released', reference: 'DYE-LAB' });
  const finishId = run('finish-plan', { lineId, code: 'FINISH-PLAN', version: '1', effective: day,
    steps: 'Drying | Condition\nStentering | 152 cm\nCompacting | Control residual shrinkage', reference: 'FINISH-APP-01' });
  const workOrderId = run('finish-order', { recipeId: finishId, number: 'FIN-WO', locationId: loc, plannedQty: 96.8 });
  const batchId = run('finish-open', { workOrderId, recipeId: finishId, machineId: drum, number: 'FIN-B01', plannedKg: 100 });
  assert.throws(() => run('production', { workOrderId }), /approved finishing sequence/);
  assert.throws(() => run('finish-issue', { batchId, lines: 'GREIGE-A,100', reference: 'WRONG' }), /post Fabric dyeing before Fabric finishing/);
  run('finish-issue', { batchId, lines: 'DYED-A,100', reference: 'FIN-I' });
  assert.throws(() => run('work-close', { workOrderId, notes: 'Test' }), /fabric still held/);
  const actual = (step, machineId, hour, chemicals = '') => run('finish-entry', { batchId, step, machineId,
    start: day + 'T' + hour + ':00', end: day + 'T' + hour + ':35', operator: 'Operator', shift: 'A', reference: 'FIN-' + step, chemicals });
  assert.throws(() => actual('Compacting', stenter, '10', 'CHEM-A,0.5'), /Record Drying next/);
  assert.equal(ref(state().lots, 'CHEM-A').qty, 2);
  actual('Drying', drum, '08');
  const rolls = { batchId, rolls: 'FIN-A,DYED-A,56,55.2,170.4,152,213\nFIN-B,DYED-A,42,41.6,129.3,151.5,212.4', waste: 1.2, reference: 'FIN-ROLLS' };
  assert.throws(() => run('finish-rolls', rolls), /Record Stentering, Compacting/);
  actual('Stentering', stenter, '09', 'CHEM-A,0.5');
  actual('Compacting', drum, '10');
  assert.throws(() => run('finish-rolls', { ...rolls, waste: 0 }), /Reconcile 98 kg/);
  run('finish-rolls', rolls);
  let s = state();
  assert.equal(wipKg(ref(s.processBatches, batchId)), 2);
  for (const id of ['FIN-A', 'FIN-B']) {
    const lot = ref(s.lots, id);
    const trace = finishedRollTrace(s, lot);
    assert.equal(lot.qualityStatus, 'Pending inspection');
    assert.equal(trace.batch.id, batchId);
    assert.equal(trace.route.name, 'Fabric-dyed jersey');
    assert.deepEqual(trace.steps.map(e => e.step), ['Drying', 'Stentering', 'Compacting']);
    assert.equal(trace.steps[1].machineName, 'Stenter');
    assert.equal(trace.dye[0].batch.id, dyeId);
    assert.deepEqual(trace.yarn.map(y => y.id), ['YARN-A']);
    assert.ok(lot.parents.some(p => p.id === 'CHEM-A'));
  }
  assert.deepEqual(['FIN-A', 'FIN-B'].map(id => ref(s.lots, id).finishing.widthCm), [152, 151.5]);
  assert.ok(orderWorkflow(s, orderId, lineId).lots.some(lot => lot.id === 'FIN-B'));
  const rejectedSale = line('SALE', manufacture, 'Finished fabric', 'kg', 55.2).lineId;
  const ship = () => run('dispatch', { number: 'SHIP-1', items: 'FIN-A,' + rejectedSale + ',55.2', destination: 'Sample buyer' });
  const cut = () => run('production', { workOrderId: cutWork, inputs: 'FIN-B,41.6', outputId: 'BUNDLES', outputQty: 200,
    netKg: 40.6, balanceUnit: 'kg', waste: 1, reference: 'CUT-1' });
  const cutWork = work('CUT-WO', 'Cutting', lineId, 200, 'pcs');
  assert.throws(ship, /Pending inspection/);
  assert.throws(cut, /through Quality/);
  inspect('FIN-A', 213);
  inspect('FIN-B', 212.4);
  ship();
  cut();
  run('finish-return', { batchId, lines: 'DYED-A,2,6.1', reference: 'FIN-RET', notes: 'Unprocessed tail' });
  run('finish-close', { batchId, reason: 'All rolls reconciled' });
  s = state();
  assert.equal(ref(s.lots, 'DYED-A').qty, 2);
  assert.equal(ref(s.processBatches, batchId).status, 'Closed');
  assert.equal(s.events.find(e => e.reference === 'FIN-RET').remnants[0].metres, 6.1);
  assert.equal(ref(s.lots, 'BUNDLES').parents[0].id, 'FIN-B');
  assert.equal(s.shipments[0].contents[0].lotId, 'FIN-A');
});

test('component-route finishing pins the approved tech pack and retains a measured remnant as its own lot', t => {
  const { state, run, loc, drum, item, receipt, line, route, inspect } = setup(t);
  const { lineId } = line('COMPONENT', route('ENTRY', 'Fabric finishing,Fabric inspection,Cutting,Packing'), 'Packed carton', 'pcs', 50);
  run('garment-spec', { lineId, specRev: '2', notes: 'Buyer width and handfeel revision', techPack: JSON.stringify({
    fabrics: [{ code: 'SHELL', structure: 'Single jersey', grossWidth: 150, usableWidth: 147, finish: 'Dry and brush',
      construction: { fabricType: 'Knitted', fabricStructure: 'Single jersey', gsm: 210 } }],
  }) });
  const componentRouteId = run('component-route', { lineId, component: 'SHELL', template: 'C', reference: 'ROUTE-1' });
  const planId = run('finish-plan', { componentRouteId, code: 'SHELL-FIN', version: '1', steps: 'Drying\nBrushing\nDrying', reference: 'APPROVED' });
  const workOrderId = run('finish-order', { recipeId: planId, number: 'FIN-RW', locationId: loc, plannedQty: 4, rework: 'yes' });
  const batchId = run('finish-open', { workOrderId, recipeId: planId, machineId: drum, number: 'RW-1', plannedKg: 4 });
  receipt('F-PRIOR', item('PRIOR', 'Finished fabric'), 4);
  run('quality', { lotId: 'F-PRIOR', decision: 'Rework', reference: 'LAB-REWORK' });
  run('finish-issue', { batchId, lines: 'F-PRIOR,4', reference: 'REWORK-ISSUE' });
  for (const [i, step] of ['Drying', 'Brushing', 'Drying'].entries()) {
    run('finish-entry', { batchId, step, operator: 'Operator', shift: 'B', reference: 'R-' + i,
      start: day + 'T1' + i + ':00', end: day + 'T1' + i + ':30' });
  }
  run('finish-rolls', { batchId, rolls: 'REMNANT,F-PRIOR,4,4,12.7,150,210,Remnant', reference: 'REMNANT-1' });
  const s = state();
  const trace = finishedRollTrace(s, ref(s.lots, 'REMNANT'));
  assert.equal(trace.route.componentRoute.id, componentRouteId);
  assert.equal(trace.batch.recipe.specification.widthCm, 150);
  assert.equal(trace.batch.recipe.specification.revision, '2');
  assert.equal(trace.roll.finishing.remnant, true);
  assert.deepEqual(trace.steps.map(e => e.step), ['Drying', 'Brushing', 'Drying']);
  inspect('REMNANT', 210);
  assert.equal(ref(state().lots, 'REMNANT').qualityStatus, 'Released');
});
