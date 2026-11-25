import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';

test('an imported PO can defer its route until line approval', t => {
  const store = new Store(':memory:');
  t.after(() => store.db.close());
  const session = store.session(store.bootstrap({ companyName: 'Test mill', login: 'admin', displayName: 'Tester', password: randomUUID() }));
  const companyId = session.company_id;
  const state = () => store.readState(companyId);
  const post = (action, input) => store.post(session, { companyId, revision: state().revision, requestId: randomUUID(), action, input });
  const { id: document } = store.addDocument(session, { bucket: 'buyer-po', name: 'order.pdf', mime: 'application/pdf',
    content: Buffer.from('%PDF-1.7\nTest fixture').toString('base64') });
  const lines = ['M', 'L'].map(size => ({ style: 'SH-110', color: 'Navy', size, qty: 10, price: 420 }));
  const input = { po: 'ROUTE-TEST', buyerName: 'Test buyer', document, poDate: '2026-11-24', shipDate: '2026-12-15',
    currency: 'INR', product: 'Packed carton', route: '', importData: JSON.stringify({ lines, specifications: [] }) };
  post('import-buyer-po', input);
  const [first, second] = state().lines;
  assert.equal(state().orders.length, 1);
  assert.ok(state().lines.every(l => l.status === 'Draft' && !l.route && !l.stages.length && l.garmentDraft));
  assert.throws(() => post('approve-line', { lineId: first.id }), /choose a production route/i);
  assert.throws(() => post('approve-line', { lineId: first.id, route: 'unknown' }), /valid route/);
  assert.throws(() => post('approve-line', { lineId: first.id, route: 'Spinning only' }), /does not produce/);
  assert.equal(state().lines[0].status, 'Draft');
  const { id: custom } = post('route-master', { code: 'PACK', name: 'Carton packing', version: '2', stages: 'Packing' });
  post('approve-line', { lineId: first.id, route: custom });
  const approved = state().lines[0];
  assert.equal(approved.status, 'Approved');
  assert.equal(approved.revisions[0].routeVersion, '2');
  assert.deepEqual(approved.stages, ['Packing']);
  post('import-buyer-po', { ...input, replaceDraft: 'yes', route: 'Garment assembly' });
  assert.equal(state().lines.length, 2);
  assert.equal(state().lines[0].route, 'Carton packing');
  assert.equal(state().lines[1].route, 'Garment assembly');
  post('approve-line', { lineId: second.id });
});
