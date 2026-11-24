import { openDB } from 'idb';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { execute, permitted } from '../src/actions.mjs';
import { ensure } from '../src/model.mjs';

let ready;
function database() {
  ready ??= initialize().catch(error => { ready = undefined; throw error; });
  return ready;
}

async function initialize() {
  const db = await openDB('hapzo-training-workspace', 1, { upgrade(db) {
    for (const name of ['workspace', 'files', 'documents', 'requests']) db.createObjectStore(name);
  } });
  if (!await db.get('workspace', 'current')) {
    const response = await fetch('/demo-state.json');
    if (!response.ok) throw new Error('The sample workspace could not be loaded.');
    const demo = await response.json();
    const tx = db.transaction(['workspace', 'documents'], 'readwrite');
    if (!await tx.objectStore('workspace').get('current')) {
      await tx.objectStore('workspace').put(demo, 'current');
      for (const sample of demo.data.buyerPoUploads || []) await tx.objectStore('documents').put(sample, sample.id);
    }
    await tx.done;
  }
  return db;
}

const digest = value => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));

export async function previewApi(url, data) {
  const db = await database();
  const path = new URL(url, window.location.href).pathname;
  if (path === '/api/actions') {
    const input = Object.fromEntries(Object.entries(data.input).filter(([, value]) => value !== undefined));
    return postAction(db, { ...data, input });
  }
  const { user, data: state, members } = await db.get('workspace', 'current');
  user.actions = permitted(user.role);
  user.publishedOrigin = window.location.origin;
  if (path === '/api/session') return { initialized: true, user };
  if (path === '/api/state') {
    state.buyerPoUploads = (await db.getAll('documents')).filter(doc => doc.bucket === 'buyer-po')
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 50);
    return { user, data: state };
  }
  if (path === '/api/members' && !data) return { members };
  if (path === '/api/gemini-models' && !data) return { models: [], canManage: false };
  if (path === '/api/documents' && data?.companyId === user.companyId) {
    const bytes = Uint8Array.from(atob(data.content), char => char.charCodeAt(0));
    ensure(bytes.length && bytes.length <= 10_000_000, 'Choose a supported file up to 10 MB.');
    const id = crypto.randomUUID();
    const meta = { id, label: data.name, bucket: data.bucket, mime: data.mime, addedAt: new Date().toISOString(),
      sha256: bytesToHex(sha256(bytes)), size: bytes.length };
    const tx = db.transaction(['files', 'documents'], 'readwrite');
    await Promise.all([tx.objectStore('documents').put(meta, id),
      tx.objectStore('files').put(new Blob([bytes], { type: data.mime }), id)]);
    await tx.done;
    return meta;
  }
  throw new Error('This feature requires the Node.js workspace.');
}

export async function previewFile(id) {
  const db = await database();
  let [blob, meta] = await Promise.all([db.get('files', id), db.get('documents', id)]);
  if (!blob && meta?.samplePath) {
    const response = await fetch(meta.samplePath);
    if (response.ok) blob = await response.blob();
  }
  ensure(blob && meta, 'This attachment is unavailable in the sample workspace.');
  return new File([blob], meta.label, { type: meta.mime });
}

async function postAction(db, { action, companyId, revision, requestId, input }) {
  const tx = db.transaction(['workspace', 'documents', 'requests'], 'readwrite');
  const workspace = tx.objectStore('workspace');
  const requests = tx.objectStore('requests');
  const [demo, previous, docs] = await Promise.all([workspace.get('current'), requests.get(requestId),
    tx.objectStore('documents').getAll()]);
  const { user, data: state } = demo;
  ensure(companyId === user.companyId && permitted(user.role).includes(action), 'This action is unavailable in this workspace.');
  const signature = digest([action, input]);
  if (previous) {
    ensure(previous.signature === signature, 'The request was already used for a different submission.');
    return previous.result;
  }
  ensure(revision === state.revision, 'Another tab saved a change. Reload and review your form.', 409, 'stale');
  const at = new Date().toISOString();
  const record = execute(state, action, input, {
    actor: user.login, role: user.role, at, digest, publicToken: () => crypto.randomUUID().replaceAll('-', ''),
    hasBuyerPortalAccess: id => demo.members.some(member => member.buyerId === id),
    document(id, buckets, required = false) {
      if (!id && !required) return null;
      const doc = docs.find(row => row.id === id && buckets.includes(row.bucket));
      ensure(doc, 'Choose an uploaded document in the correct category.');
      return doc;
    },
  });
  state.audit.unshift({ actor: user.login, action, state: 'Posted', target: record.id, at, details: '' });
  const result = { id: record.id, revision: ++state.revision };
  await Promise.all([workspace.put(demo, 'current'), requests.put({ signature, result }, requestId)]);
  await tx.done;
  return result;
}
