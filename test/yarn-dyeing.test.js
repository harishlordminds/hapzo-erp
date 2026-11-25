import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { demo } from '../src/demo.js';
import { execute } from '../src/actions.js';
import { genealogy, today, ref, round, sum } from '../src/model.js';
import { wipKg, batchSummary } from '../src/yarn-dyeing.js';
import { lotCost } from '../src/fulfilment.js';
import { Store } from '../src/store.js';

const day = today();
const ctx = { role: 'Admin', actor: 'test', at: new Date().toISOString(), document: () => null,
  publicToken: () => randomBytes(24).toString('base64url'), digest: o => createHash('sha256').update(JSON.stringify(o)).digest('hex') };
const runner = s => (action, input) => execute(s, action, { date: day, ...input }, ctx);
const fails = (fn, pattern, code) => assert.throws(fn, error => (!code || error.code === code) && pattern.test(error.message));
const ownSiteBalance = (s, lotId) => round(sum(s.events.flatMap(e => e.moves ?? []).filter(m => m.lotId === lotId && m.custody === 'Own site')));

function fresh() {
  const s = demo();
  const run = runner(s);
  const loc = s.locations.find(l => l.code === 'MAIN');
  const line = s.lines.find(l => l.sku === 'YDC-RED-M');
  const route = s.componentRoutes.find(r => r.lineId === line.id);
  const recipe = s.processSetups[0];
  const machine = s.machines.find(m => m.code === 'HTHP-1');
  const yarn = s.items.find(i => i.code === 'YRN-001');
  const receive = (lotId, qty, more = {}) => {
    const lot = run('receipt', { lotId, itemId: yarn.id, qty: String(qty), locationId: loc.id, mode: 'Direct inward', supplierId: s.parties.find(p => p.code === 'DEMO-SUP').id,
      origin: 'Example spinning and ginning site', reference: 'GRN-' + lotId, ...more });
    if (!lot.standardHold) run('quality', { lotId, decision: 'Released', reference: 'QC-' + lotId });
    return lot;
  };
  const batchFor = (number, plannedQty = '100', extra = {}) => {
    const wo = run('work-order', { number: 'WO-' + number, stage: 'Yarn dyeing', lineId: line.id, componentRouteId: route.id, plannedQty, unit: 'kg', locationId: loc.id, ...extra });
    return run('dye-batch', { workOrderId: wo.id, number, machineId: machine.id, recipeId: recipe.id, plannedKg: plannedQty });
  };
  return { s, run, loc, line, route, recipe, machine, yarn, receive, batchFor };
}

test('sample transaction: balances, WIP, genealogy, cost and DPP activity', () => {
  const { s } = fresh();
  const batch = s.processBatches.find(b => b.number === 'DYB-26031-01');
  assert.equal(batch.status, 'Closed');
  assert.equal(wipKg(batch), 0);
  const summary = batchSummary(s, batch);
  assert.equal(summary.issuedKg, 199.5);
  assert.equal(summary.acceptedKg, 188);
  // Stock ledger agrees with each lot balance after issue, return, outputs and the next route step.
  for (const id of ['YRN-C-01', 'YRN-C-02', 'CHEM-R-01', 'CHEM-S-01', 'CHEM-P-01', 'DY-RED-01', 'DY-RED-02', 'BEAM-YD-01']) {
    assert.equal(ownSiteBalance(s, id), ref(s.lots, id).qty, 'ledger balance for ' + id);
  }
  assert.equal(ref(s.lots, 'YRN-C-02').qty, 2);
  assert.equal(ref(s.lots, 'DY-RED-01').qty, 40);
  // Many-to-many genealogy: both yarn lots feed both outputs; chemicals are process inputs.
  const back = genealogy(s, 'BEAM-YD-01').map(l => l.id);
  for (const id of ['DY-RED-01', 'YRN-C-01', 'YRN-C-02', 'CHEM-R-01', 'CHEM-S-01', 'CHEM-P-01']) assert.ok(back.includes(id), id);
  const forward = genealogy(s, 'YRN-C-01', true).map(l => l.id);
  assert.deepEqual(forward.sort(), ['BEAM-YD-01', 'DY-RED-01', 'DY-RED-02']);
  // Output reconciles in kg; the cone output carries its measured kg.
  const out2 = ref(s.lots, 'DY-RED-02');
  assert.equal(out2.unit, 'cone');
  assert.equal(out2.netKg, 88);
  // Internal absorption is GST free and kept separate from supplier bills.
  const internal = s.costs.filter(c => c.internal);
  assert.ok(internal.length >= 10 && internal.every(c => c.gst === 0 && c.credit === 0 && !c.supplierId));
  assert.ok(lotCost(s, ref(s.lots, 'DY-RED-01')) > 0);
  // Work order pins the approved component route and BOM revision.
  const wo = s.workOrders.find(w => w.number === 'WO-YD-26031');
  assert.equal(wo.componentRoute.template, 'B');
  assert.deepEqual(wo.componentRoute.stages, ['Yarn dyeing', 'Warping', 'Sizing', 'Weaving', 'Desizing', 'Fabric finishing']);
  assert.equal(wo.revisionPins.bom, 'B01');
  assert.equal(wo.completedQty, 188);
});

test('DPP activity carries steam, water and electricity with method version', async () => {
  const { s, run } = fresh();
  const { runActivity } = await import('../src/passports.js');
  const rows = runActivity(s, ref(s.lots, 'BEAM-YD-01'));
  const dye = rows.find(r => r.stage === 'Yarn dyeing');
  assert.ok(dye.steam > 0 && dye.water > 0 && dye.electricity > 0);
  assert.equal(dye.methodVersion, 'HZ-YD-ALLOC-1');
  // Existing orders keep their earlier interpretation.
  assert.equal(s.workOrders.find(w => w.number === 'WO-FAB-1001').componentRoute, null);
  void run;
});

test('Standard Lock blocks issue until processor evidence is verified, independent of quality', () => {
  const { s, run, receive, batchFor, line } = fresh();
  const supplier = s.parties.find(p => p.code === 'DEMO-SUP');
  const ev = run('evidence', { scheme: 'GOTS', kind: 'Scope certificate', role: 'Supplier', partyId: supplier.id, site: 'Example spinning and ginning site',
    number: 'GOTS-SUP-T1', issuer: 'Example CB', issue: day, until: day, operations: 'Supply', materials: 'Yarn' });
  run('review-evidence', { evidenceId: ev.id, status: 'Verified', source: 'Test lookup', scopeConfirmed: 'yes' });
  receive('YRN-GOTS-T1', 50, { scheme: 'GOTS' });
  assert.equal(ref(s.lots, 'YRN-GOTS-T1').qualityStatus, 'Released');
  const wo = run('work-order', { number: 'WO-GOTS-T1', stage: 'Yarn dyeing', plannedQty: '50', unit: 'kg', locationId: s.locations[0].id, scheme: 'GOTS' });
  const b = run('dye-batch', { workOrderId: wo.id, number: 'DYB-GOTS-T1', machineId: s.machines.find(m => m.code === 'HTHP-1').id, recipeId: s.processSetups[0].id, plannedKg: '50' });
  const issue = () => run('dye-issue', { batchId: b.id, lines: 'YRN-GOTS-T1,50', reference: 'ISS-GOTS-T1' });
  fails(issue, /Standard Lock · GOTS requires verified/, 'standard-lock');
  const own = run('evidence', { scheme: 'GOTS', kind: 'Scope certificate', role: 'Processor', party: s.settings.name, site: 'Decaste Mill',
    number: 'GOTS-OWN-T1', issuer: 'Example CB', issue: day, until: day, operations: 'Yarn dyeing', materials: 'Dyed yarn' });
  fails(issue, /Standard Lock/, 'standard-lock'); // pending verification still blocks
  run('review-evidence', { evidenceId: own.id, status: 'Verified', source: 'Test lookup', scopeConfirmed: 'yes' });
  issue();
  assert.equal(ref(s.lots, 'YRN-GOTS-T1').qty, 0);
  // A lot on Standard Hold is blocked even though nothing failed quality.
  fails(() => run('dye-issue', { batchId: b.id, lines: 'YRN-HOLD-01,10', reference: 'ISS-HOLD' }), /on hold/, 'standard-lock');
  void line; void batchFor;
});

test('posting checks: over-issue, duplicate reference, conversion basis, lot links, owners and route skips', () => {
  const { s, run, receive, batchFor, loc, line, route } = fresh();
  receive('YRN-T2', 40);
  const b = batchFor('DYB-T2', '40');
  fails(() => run('dye-issue', { batchId: b.id, lines: 'YRN-T2,41', reference: 'ISS-T2' }), /Over-issue/);
  run('dye-issue', { batchId: b.id, lines: 'YRN-T2,30', reference: 'ISS-T2' });
  fails(() => run('dye-issue', { batchId: b.id, lines: 'YRN-T2,5', reference: 'iss-t2' }), /already posted/, 'duplicate');
  // A cone lot without a measured kg basis needs weighing at issue.
  const cones = s.items.find(i => i.code === 'YRN-CONE');
  run('receipt', { lotId: 'YRN-CN-T2', itemId: cones.id, qty: '10', locationId: loc.id, mode: 'Direct inward', supplierId: s.parties.find(p => p.code === 'DEMO-YRN').id, origin: 'Mill', reference: 'GRN-CN' });
  run('quality', { lotId: 'YRN-CN-T2', decision: 'Released', reference: 'QC-CN' });
  fails(() => run('dye-issue', { batchId: b.id, lines: 'YRN-CN-T2,5', reference: 'ISS-CN' }), /measured kg basis/, 'conversion');
  // Customer-owned yarn stays out of a company-owned batch.
  run('receipt', { lotId: 'YRN-CUST-T2', itemId: s.items.find(i => i.code === 'YRN-001').id, qty: '20', locationId: loc.id, mode: 'Customer inward',
    ownerId: s.parties.find(p => p.code === 'DEMO-BUY').id, origin: 'Buyer yarn', reference: 'GRN-CUST' });
  run('quality', { lotId: 'YRN-CUST-T2', decision: 'Released', reference: 'QC-CUST' });
  fails(() => run('dye-issue', { batchId: b.id, lines: 'YRN-CUST-T2,5', reference: 'ISS-CUST' }), /Open a commission batch for customer-owned lot YRN-CUST-T2/);
  run('dye-entry', { batchId: b.id, step: 'Dyeing', start: day + 'T08:00', end: day + 'T10:00', operator: 'Op', shift: 'A', water: '1000', reference: 'LOG-T2' });
  fails(() => run('dye-output', { batchId: b.id, outputId: 'DY-T2', outputQty: '10', waste: '0', consumption: 'YRN-C-01,10', reference: 'OUT-T2' }), /Invalid lot link/, 'lot-link');
  fails(() => run('dye-output', { batchId: b.id, outputId: 'DY-T2', outputQty: '29', waste: '0', consumedKg: '31', reference: 'OUT-T2' }), /Reconcile/);
  // Route skip: weaving without the approved sizing step.
  const weave = run('work-order', { number: 'WO-WV-T2', stage: 'Weaving', lineId: line.id, componentRouteId: route.id, plannedQty: '50', unit: 'kg', locationId: loc.id });
  fails(() => run('production', { workOrderId: weave.id, inputs: 'BEAM-YD-01,20\nDY-RED-01,10', outputId: 'GRG-T2', outputQty: '30', reference: 'RUN-WV-T2' }),
    /Route skip · post Sizing before Weaving/, 'route-skip');
  // An operation outside the approved component route cannot be released.
  fails(() => run('work-order', { number: 'WO-FD-T2', stage: 'Fabric dyeing', lineId: line.id, componentRouteId: route.id, plannedQty: '10', unit: 'kg', locationId: loc.id }), /approved route B/);
});

test('reversal restores WIP, stock and cost through a linked entry, latest posting first', () => {
  const { s, run, receive, batchFor } = fresh();
  receive('YRN-T3', 50);
  const b = batchFor('DYB-T3', '50');
  const issue = run('dye-issue', { batchId: b.id, lines: 'YRN-T3,50', reference: 'ISS-T3' });
  run('dye-entry', { batchId: b.id, step: 'Dyeing', start: day + 'T08:00', end: day + 'T11:00', operator: 'Op', shift: 'A', chemicals: 'CHEM-S-01,10', steam: '100', labourHours: '3', reference: 'LOG-T3' });
  const out = run('dye-output', { batchId: b.id, outputId: 'DY-T3', outputQty: '20', waste: '0.5', reference: 'OUT-T3' });
  assert.equal(wipKg(b), 29.5);
  const costBefore = lotCost(s, out);
  assert.ok(costBefore > 0);
  fails(() => run('dye-reverse', { batchId: b.id, eventId: issue.id, reason: 'Wrong lot' }), /latest active posting/);
  const rev = run('dye-reverse', { batchId: b.id, eventId: out.eventId, reason: 'Wrong output weight' });
  assert.equal(rev.reverses, out.eventId);
  assert.equal(ref(s.lots, 'DY-T3').qty, 0);
  assert.equal(ref(s.lots, 'DY-T3').qualityStatus, 'Reversed');
  assert.equal(wipKg(b), 50);
  assert.equal(round(sum(s.costs.filter(c => c.lot === 'DY-T3'), c => c.landed)), 0);
  assert.equal(ref(s.events, out.eventId).reversedBy, rev.id);
  // Re-post with the same reference after reversal, then return the rest unused.
  run('dye-output', { batchId: b.id, outputId: 'DY-T3B', outputQty: '21', waste: '0.5', reference: 'OUT-T3' });
  run('dye-return', { batchId: b.id, lines: 'YRN-T3,28.5', reference: 'RET-T3' });
  assert.equal(wipKg(b), 0);
  assert.equal(ref(s.lots, 'YRN-T3').qty, 28.5);
  assert.equal(ownSiteBalance(s, 'YRN-T3'), 28.5);
  assert.equal(ownSiteBalance(s, 'DY-T3'), 0);
});

test('shared posting path: SQLite transaction, request replay and blocked audit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hapzo-yd-'));
  const store = new Store(join(dir, 'hapzo.sqlite'));
  try {
    const token = store.bootstrap({ login: 'admin', displayName: 'Admin', password: 'correct horse battery', companyName: 'Empty' });
    let session = store.session(token);
    const cid = store.transaction(() => store.newCompany({ id: session.user_id, login: session.login }, 'Sample', demo));
    store.switchCompany(session, cid);
    session = store.session(token);
    const state = () => store.readState(cid);
    const post = (action, input, requestId = randomUUID()) => store.post(session, { companyId: cid, revision: state().revision, requestId, action, input: { date: day, ...input } });
    const yarn = state().items.find(i => i.code === 'YRN-001');
    const loc = state().locations.find(l => l.code === 'MAIN');
    post('receipt', { lotId: 'YRN-DB-1', itemId: yarn.id, qty: '30', locationId: loc.id, mode: 'Direct inward', supplierId: state().parties.find(p => p.code === 'DEMO-SUP').id, origin: 'Mill', reference: 'GRN-DB-1' });
    post('quality', { lotId: 'YRN-DB-1', decision: 'Released', reference: 'QC-DB-1' });
    const s0 = state();
    const line = s0.lines.find(l => l.sku === 'YDC-RED-M');
    const wo = post('work-order', { number: 'WO-DB-1', stage: 'Yarn dyeing', lineId: line.id, componentRouteId: s0.componentRoutes[0].id, plannedQty: '30', unit: 'kg', locationId: loc.id });
    const batch = post('dye-batch', { workOrderId: wo.id, number: 'DYB-DB-1', machineId: s0.machines.find(m => m.code === 'HTHP-1').id, recipeId: s0.processSetups[0].id, plannedKg: '30' });
    const requestId = randomUUID();
    const issue = { batchId: batch.id, lines: 'YRN-DB-1,30', reference: 'ISS-DB-1' };
    const first = post('dye-issue', issue, requestId);
    const replay = post('dye-issue', issue, requestId);
    assert.equal(replay.replayed, true);
    assert.equal(replay.id, first.id);
    assert.equal(state().lots.find(l => l.id === 'YRN-DB-1').qty, 0);
    assert.equal(state().events.filter(e => e.kind === 'Process issue' && e.reference === 'ISS-DB-1').length, 1);
    // A blocked Standard Lock posting rolls back and leaves an audit entry.
    assert.throws(() => post('dye-issue', { batchId: batch.id, lines: 'YRN-HOLD-01,5', reference: 'ISS-DB-HOLD' }), /on hold/);
    assert.equal(state().lots.find(l => l.id === 'YRN-HOLD-01').qty, 50);
    assert.ok(store.readAudit(cid).some(a => a.state === 'Blocked' && a.action === 'dye-issue'));
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
