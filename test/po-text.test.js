import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPoPages } from '../src/po-text.js';
import { inspectPoNumber, applyPoNumber } from '../src/po-number.js';
import { readPoNumber } from '../src/po-reference.js';
import { poNumberReader } from '../src/po-import.js';

const samples = [
  ['01-standard', 'NMO-PO-261124-01', 'Northmere Outfitters Ltd.', 'INR', '2026-11-24', [120, 80], [420, 420]],
  ['02-size-matrix', 'VMC-PO-261125-07', 'Verdant Mile Collective Inc.', 'USD', '2026-11-25',
    [20, 40, 30, 10, 15, 25, 25, 15], Array(8).fill(8.25)],
  ['03-mixed-styles', 'HLB-PO-261126-03', 'Harbourlight Basics GmbH', 'EUR', '2026-11-26', [30, 45, 55], [21.5, 21.5, 16.8]],
];
for (const [prefix, po, buyer, currency, date, quantities, prices] of samples) {
  test('extracts order header and each variant from ' + prefix + ' PDF', async () => {
    const filename = prefix + '-purchase-order.pdf';
    const data = new Uint8Array(await readFile(new URL('../output/pdf/' + filename, import.meta.url)));
    const task = getDocument({ data, useSystemFonts: true });
    try {
      const { order, lines, poNumber } = await readPoPages(await task.promise, filename);
      assert.deepEqual([order.po, order.buyer, order.currency, order.date], [po, buyer, currency, date]);
      const node = await inspectPoNumber({ bytes: await readFile(new URL('../output/pdf/' + filename, import.meta.url)),
        mime: 'application/pdf', label: filename }, poNumberReader());
      for (const read of [poNumber, node]) {
        assert.deepEqual([read.status, read.value, read.method, read.page], ['matched', po, 'PDF text', 1]);
        assert.ok(!read.notice);
      }
      assert.ok(order.shipTo.includes('DC'));
      assert.match(order.terms, /^Net/);
      assert.deepEqual(lines.map(line => line.qty), quantities);
      assert.deepEqual(lines.map(line => line.price), prices);
      assert.equal(order.totalPieces, quantities.reduce((a, b) => a + b, 0));
      assert.ok(lines.every(line => line.articleNo && line.articleName && line.color && line.size));
      if (prefix === '03-mixed-styles') {
        assert.deepEqual(lines.map(line => line.delivery), ['2026-12-18', '2026-12-18', '2027-01-08']);
        assert.equal(order.shipDate, '');
      }
    } finally { await task.destroy(); }
  });
}

test('conflicting header references need review and invoice or item references are excluded', () => {
  const read = text => readPoNumber([{ page: 1, method: 'PDF text', text }]);
  assert.equal(read('Purchase Order\nABC-PO-001\nABC-PO-002').status, 'ambiguous');
  assert.equal(read('Purchase Order\nInvoice No.\tINV-PO-001\nStyle\tQty\nART-PO-774\t10').status, 'missing');
  assert.equal(read('Purchase Order\nInvoice No.\nINV-PO-001').status, 'missing');
  assert.equal(read('Purchase Order\nABC-PO-001\nPO Number: BUY-5247').value, 'BUY-5247');
  const result = applyPoNumber({ order: { po: 'FROM-AI' }, review: [] }, { status: 'missing' });
  assert.equal(result.poNumber.status, 'suggested');
  assert.equal(result.poNumber.value, result.order.po);
  assert.equal(poNumberReader({ poNumberReader: 'local-oxr' }), 'local-oxr');
});
