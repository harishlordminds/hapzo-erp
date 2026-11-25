import { clean, csvLines, date, ensure, id, quantity, record, ref, req, round, unique } from './model.js';
import { schemesOf } from './commerce.js';
import { checkLotClaims } from './standards.js';
import { lotKey, newLot, post, stockMove, takeStock, usable } from './stock.js';
import { batchReference, lineRemaining, openBatch, postingDate, track, wipMove } from './process-batch.js';

export function startGarmentBatch(s, x, process, prefix) {
  const wo = record(s.workOrders, x.workOrderId, process.toLowerCase() + ' work order');
  ensure(wo.stage === process && wo.lineId && ['Released', 'In progress'].includes(wo.status), 'Use an open work order on the approved PO route.');
  const day = date(x.date);
  ensure(day >= wo.date, 'Production cannot precede work order release.');
  const number = req(x.number, 'Batch or lay number');
  unique(s.processBatches, 'number', number, 'This batch or lay number is already in use.');
  const b = { id: id(s, prefix), number, process, workOrderId: wo.id, lineId: wo.lineId, lineRevision: wo.lineRevision,
    stage: wo.stage, site: wo.site, locationId: wo.locationId, unit: wo.unit, date: day, lastDate: day, status: 'Open',
    lines: [], postings: [], notes: clean(x.notes) };
  return { wo, b, day };
}

export const garmentEvent = b => ({
  process: b.process, stage: b.stage, batchId: b.id, workOrderId: b.workOrderId, lineId: b.lineId, lineRevision: b.lineRevision, site: b.site,
});

export function readGarmentIssue(s, wo, text, day, check, maxColumns = 2) {
  const needs = schemesOf(wo);
  const buyer = ref(s.orders, ref(s.lines, wo.lineId)?.orderId)?.buyerId;
  const rows = csvLines(text, 'Issued lot', 2, maxColumns).map(([lotId, amount, ...details]) => {
    const lot = record(s.lots, lotId, 'input lot ' + lotId);
    ensure(lot.site === wo.site, 'Transfer ' + lot.id + ' to the work order site before issue.');
    ensure(!lot.ownerId || lot.ownerId === buyer, 'Input lot ' + lot.id + ' belongs to a different buyer.');
    const fields = check(lot, details);
    usable(s, lot, day, Boolean(fields.rework));
    checkLotClaims(s, lot, needs, Boolean(fields.auxiliary));
    return { lot, qty: quantity(amount, 'Issued ' + lot.unit + ' from ' + lot.id, lot.unit), ...fields };
  });
  ensure(rows.length && new Set(rows.map(row => row.lot.id)).size === rows.length, 'List each issued lot once.');
  return rows;
}

export function issueGarmentStock(s, ctx, b, rows, day, reference, checks) {
  const owner = rows.find(row => !row.auxiliary)?.lot.ownerId || '';
  ensure(rows.every(row => row.lot.ownerId === owner || row.auxiliary && !row.lot.ownerId), 'Keep material ownership consistent within the batch.');
  b.ownerId = owner;
  b.checks = checks;
  const moves = [];
  for (const { lot, qty, ...fields } of rows) {
    const allocations = takeStock(lot, qty, day, new Set([b.lineId]));
    b.lines.push({ lotId: lot.id, unit: lot.unit, issued: qty, consumed: 0, returned: 0, allocations, ...fields });
    moves.push(stockMove(lot, -qty), wipMove(b, lot.id, qty, lot.unit));
  }
  const e = post(s, 'Process issue', ctx, {
    ...garmentEvent(b), date: day, reference, checks, moves, lotIds: rows.map(row => row.lot.id),
    inputs: rows.map(({ lot, qty }) => ({ id: lot.id, qty, unit: lot.unit })),
  });
  track(b, e, 'Issue', day);
  s.processBatches.push(b);
  record(s.workOrders, b.workOrderId, 'work order').status = 'In progress';
  return b;
}

export function stageDraws(s, b, input) {
  const draws = csvLines(input, 'Actual lot draw', 2).map(([lotId, amount]) => {
    const line = b.lines.find(r => r.lotId === lotId);
    ensure(line, 'Lot ' + lotId + ' was not issued to this batch.', 422, 'lot-link');
    const lot = record(s.lots, lotId, 'issued stock');
    const qty = quantity(amount, 'Consumption from ' + lotId, line.unit);
    ensure(qty <= lineRemaining(line), 'Consumption exceeds the available batch quantity of ' + lotId + '.');
    return { lot, line, qty };
  });
  ensure(draws.length && new Set(draws.map(row => row.lot.id)).size === draws.length, 'List each actual input lot once.');
  return draws;
}

export function drawGarmentStock(b, draws) {
  return draws.map(({ line, qty }) => {
    line.consumed = round(line.consumed + qty);
    return wipMove(b, line.lotId, -qty, line.unit);
  });
}

export function returnGarmentStock(s, x, ctx, process, protect = () => 0) {
  const b = openBatch(s, x.batchId, process);
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Unused material return slip');
  const rows = csvLines(x.lines, 'Unused material return', 2, 3).map(([lotId, amount, remnantId]) => {
    const line = b.lines.find(row => row.lotId === lotId);
    ensure(line, 'This lot is outside the batch.');
    const lot = record(s.lots, lotId, 'original lot');
    const qty = quantity(amount, 'Return from ' + lotId, line.unit);
    ensure(qty <= round(lineRemaining(line) - protect(b, lotId)), 'Return would exceed unused material on ' + lotId + '.');
    const code = remnantId ? lotKey(s, remnantId) : '';
    return { line, lot, qty, code };
  });
  ensure(rows.length && new Set(rows.map(row => row.lot.id)).size === rows.length &&
    new Set(rows.filter(row => row.code).map(row => row.code.toLowerCase())).size === rows.filter(row => row.code).length,
  'List each input and remnant ID once.');
  const moves = [];
  const lotIds = [];
  for (const { line, lot, qty, code } of rows) {
    ensure(day >= lot.lastDate, 'Return date precedes activity on ' + lot.id + '.');
    line.returned = round(line.returned + qty);
    const restored = line.allocations.flatMap(a => {
      const amount = Math.min(qty, round(a.qty - (a.restored || 0)));
      a.restored = round((a.restored || 0) + amount);
      return amount ? [{ lineId: a.lineId, qty: amount }] : [];
    });
    let returned = lot;
    if (code) {
      const loc = record(s.locations, lot.locationId, 'original stock location');
      returned = newLot(s, code, qty, line.unit, day, loc, {
        ...Object.fromEntries(['material', 'itemId', 'stage', 'ownerId', 'scheme', 'additionalSchemes', 'qualityStatus', 'composition',
          'workOrderId', 'fabric', 'cutting', 'panel', 'printing', 'embroidery', 'garmentFinish'].filter(k => lot[k] !== undefined).map(k => [k, lot[k]])),
        label: 'Remnant · ' + lot.label, checks: lot.checks, parents: [{ id: lot.id, qty, unit: line.unit }],
        inspectionId: lot.inspectionId, netKg: lot.netKg ? round(lot.netKg * qty / lot.initialQty) : null,
        lengthM: lot.lengthM ? round(lot.lengthM * qty / lot.initialQty) : null, allocations: restored, allocationBalance: structuredClone(restored),
      });
    } else {
      lot.qty = round(lot.qty + qty);
      lot.lastDate = day;
      for (const a of restored) {
        const bucket = lot.allocationBalance.find(row => row.lineId === a.lineId);
        if (bucket) bucket.qty = round(bucket.qty + a.qty);
        else lot.allocationBalance.push(a);
      }
    }
    lotIds.push(returned.id);
    moves.push(wipMove(b, lot.id, -qty, line.unit), stockMove(returned, qty));
  }
  const e = post(s, 'Process return', ctx, {
    ...garmentEvent(b), date: day, reference, inputs: rows.map(({ lot, qty }) => ({ id: lot.id, qty, unit: lot.unit })),
    lotIds, output: lotIds[0], moves, notes: clean(x.notes),
  });
  for (const row of rows.filter(row => row.code)) record(s.lots, row.code, 'remnant lot').eventId = e.id;
  track(b, e, 'Return', day);
  if (b.lines.every(line => !lineRemaining(line))) b.status = 'Closed';
  return b;
}
