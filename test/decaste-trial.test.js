import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { ref, today } from '../src/model.js';
import { decasteTrial } from './fixtures/decaste-trial.js';

test('Decaste mixed-route PO reconciles from stock issue to packing, shipment and DPP', async t => {
  const store = new Store(':memory:');
  t.after(() => store.db.close());
  const password = 'Decaste-test-account-2026';
  const admin = store.session(store.bootstrap({ companyName: 'HAPZO Decaste test', login: 'admin', displayName: 'Trial Admin', password }));
  const companyId = admin.company_id;
  const state = () => store.readState(companyId);
  const post = (action, input, session = admin) => store.post(session,
    { companyId, revision: state().revision, requestId: randomUUID(), action, input: { date: today(), ...input } }).id;
  const trial = decasteTrial(store, admin);
  assert.ok(Object.values(trial.results).every(value => value === 'Passed'));

  await t.test('buyers see their shipments and carton assortment without internal garment lots or drafts', () => {
    const order = ref(state().orders, trial.orderId);
    store.assignMember(admin, { login: 'buyer', name: 'Trial Buyer', role: 'Buyer', buyerId: order.buyerId, password });
    const buyer = store.session(store.signIn({ login: 'buyer', password }));
    const view = store.view(buyer);
    assert.equal(view.shipments.length, 2);
    assert.equal(view.lots, undefined);
    assert.equal(view.passports.length, 0);
    assert.equal(view.shipments[1].packingList[0].contents[1].qty, 2);
    assert.ok(view.shipments.every(sh => sh.packingList.every(c => c.contents.every(r => !r.lotId))));
    assert.throws(() => post('passport-status', { passportId: trial.passportId, mode: 'Submit' }, buyer),
      error => error.status === 403);
    const otherId = post('party-master', { code: 'OTHER-BUYER', type: 'Buyer', name: 'Unrelated Buyer', currency: 'INR' });
    store.assignMember(admin, { login: 'other', name: 'Unrelated Buyer', role: 'Buyer', buyerId: otherId, password });
    const other = store.session(store.signIn({ login: 'other', password }));
    assert.deepEqual(store.view(other).shipments, []);
    const viewer = store.view({ company_id: companyId, role: 'Viewer' });
    assert.equal(viewer.passports.length, 0);
    assert.ok(viewer.lots.some(l => l.id === trial.cartonIds[1]));
  });

  await t.test('profile approval and publication keep the same URL across reviews and versions', () => {
    const garment = () => ref(state().passports, trial.passportId);
    const profileId = garment().profileSnapshot.id;
    const fabricProfileId = ref(state().passports, trial.fabricPassportId).profileSnapshot.id;
    const calc = {
      factor: 0.7, factorRef: 'Synthetic factor and trial water meter observations', compositionSource: 'Component tech pack and actual draws',
      boundary: 'Activity measured on the synthetic mixed route',
    };
    const bare = post('passport', { ...calc, lotId: trial.cartonIds[0], profile: 'Pending profile' });
    assert.throws(() => post('passport-status', { passportId: bare, mode: 'Submit' }), /Apply an approved product and market profile/);
    assert.throws(() => post('passport-profile', { passportId: bare, profileId: fabricProfileId }), /approved profile for this product family/);
    post('passport-profile', { passportId: bare, profileId });
    assert.equal(ref(state().passports, bare).profileSnapshot.id, profileId);
    assert.throws(() => post('passport-point', { passportId: bare, point: 20, applicability: 'Not applicable', visibility: 'Internal',
      reason: 'Required profile point' }), /required by HAPZO or the selected product profile/);

    const finishReview = passportId => {
      post('passport-assess', { passportId, reason: 'Unmapped fields are outside the local trial buyer profile.' });
      for (const q of ref(state().passports, passportId).points.filter(p => p.applicability === 'Applicable' && !p.verified)) {
        assert.ok(q.value && q.source, q.name);
        post('passport-point', { passportId, point: q.number, applicability: q.applicability, visibility: q.visibility,
          verified: 'yes', value: q.value, source: q.source });
      }
      post('passport-status', { passportId, mode: 'Submit' });
    };
    const token = garment().token;
    assert.equal(store.publicPassport(token), null);
    finishReview(garment().id);
    assert.equal(store.publicPassport(token), null);
    post('passport-status', { passportId: garment().id, mode: 'Publish' });
    const first = store.publicPassport(token);
    assert.equal(first.version, 1);
    assert.ok(first.fields.some(q => q.number === 22));
    assert.ok(first.fields.every(q => q.source === undefined && q.document === undefined));
    assert.equal(first.sources, undefined);
    const next = post('passport', { ...calc, lotId: trial.cartonIds[1], profileId });
    assert.equal(ref(state().passports, next).token, token);
    assert.equal(store.publicPassport(token).version, 1);
    finishReview(next);
    post('passport-status', { passportId: next, mode: 'Publish' });
    assert.equal(store.publicPassport(token).version, 2);
    assert.equal(garment().status, 'Superseded');
    post('passport-status', { passportId: next, mode: 'Suspend', notes: 'Synthetic test withdrawal' });
    assert.deepEqual(store.publicPassport(token), { state: 'Suspended' });
  });
});
