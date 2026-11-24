import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractBuyerPo, geminiCatalogue } from '../src/po-ai.mjs';

test('Gemini PO import retries a temporary 503 once and respects a long provider cooldown', async t => {
  const previousKey = process.env.HAPZO_GEMINI_API_KEY;
  process.env.HAPZO_GEMINI_API_KEY = 'test-only';
  t.after(() => {
    if (previousKey === undefined) delete process.env.HAPZO_GEMINI_API_KEY;
    else process.env.HAPZO_GEMINI_API_KEY = previousKey;
  });
  const model = 'gemini-test-flash';
  const session = { company_id: 'reader-test' };
  const bytes = await readFile(new URL('../output/pdf/01-standard-purchase-order.pdf', import.meta.url));
  const documents = [{ name: 'Test PO', doc: { bytes, mime: 'application/pdf', label: 'test-po.pdf' } }];
  const draft = { order: { po: 'NMO-PO-261124-01' }, lines: [{ style: 'SH-110', size: 'M', qty: 120 }], specifications: [] };
  const busy = seconds => new Response('Service unavailable', { status: 503, headers: { 'Retry-After': String(seconds) } });
  const paths = [];
  let responses = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const path = new URL(input).pathname;
    if (path.endsWith('/models')) return Response.json({ models: [{ name: 'models/' + model, supportedGenerationMethods: ['generateContent'] }] });
    paths.push(path);
    assert.ok(responses.length, 'Unplanned request');
    return responses.shift();
  });
  await geminiCatalogue(session, true);
  const read = () => extractBuyerPo(session, documents, 'gemini', 'local-ocr', { geminiModel: model });
  responses = [busy(0), Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(draft) }] } }] })];
  const result = await read();
  assert.equal(result.order.po, draft.order.po);
  assert.equal(result.retry.to, model);
  assert.deepEqual(paths, ['/v1beta/interactions', '/v1beta/models/' + model + ':generateContent']);

  paths.length = 0;
  responses = [busy(0), busy(0)];
  await assert.rejects(read, { code: 'ai-unavailable', status: 503 });
  assert.equal(paths.length, 2);

  paths.length = 0;
  responses = [busy(60)];
  await assert.rejects(read, { code: 'ai-unavailable', retryAfterMs: 60000 });
  assert.equal(paths.length, 1);
});
