import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';

test('PO imports can keep the printed buyer name or stay unassigned until a buyer is linked', t => {
  const store = new Store(':memory:');
  t.after(() => store.db.close());
  const session = store.session(store.bootstrap({ companyName: 'Test mill', login: 'admin', displayName: 'Tester', password: randomUUID() }));
  const state = () => store.readState(session.company_id);
  const post = (action, input) => store.post(session, {
    companyId: session.company_id, revision: state().revision, requestId: randomUUID(), action, input,
  });
  const doc = name => store.addDocument(session, { name, mime: 'application/pdf', bucket: 'buyer-po',
    content: Buffer.from('%PDF-1.7\n' + name).toString('base64') }).id;
  const input = {
    document: doc('first.pdf'), po: 'PO-01', poDate: '2026-11-01', shipDate: '2026-12-01', currency: 'USD',
    route: 'Garment assembly', product: 'Packed carton', importData: JSON.stringify({
      lines: [{ style: 'SHIRT', color: 'Navy', size: 'M', qty: 20, price: 10 }], specifications: [],
    }),
  };
  post('import-buyer-po', { ...input, buyerName: 'Name printed on PO' });
  post('import-buyer-po', { ...input, po: 'PO-02' });
  assert.deepEqual(state().orders.map(o => [o.buyerId, o.buyer]), [['', 'Name printed on PO'], ['', '']]);
  assert.equal(state().parties.length, 0);
  assert.throws(() => post('import-buyer-po', { ...input, po: 'PO-02', document: doc('different.pdf') }), /distinguish the two orders/);
  assert.equal(store.buyerView({ buyer_id: '' }, state()).orders.length, 0);
  const buyerId = post('po-buyer-create', { buyer: 'Confirmed buyer', currency: 'INR' }).id;
  const existing = state().orders[0];
  post('import-buyer-po', { ...input, buyerId, replaceDraft: 'yes' });
  assert.equal(state().orders.length, 2);
  assert.equal(state().orders[0].id, existing.id);
  assert.equal(state().orders[0].buyerId, buyerId);
  const second = state().orders[1];
  post('link-order-buyer', { orderId: second.id, buyerId });
  assert.equal(state().orders[1].buyer, 'Confirmed buyer');
  assert.equal(state().orders[1].currency, 'USD');
  assert.equal(store.buyerView({ buyer_id: buyerId }, state()).orders.length, 2);
});
