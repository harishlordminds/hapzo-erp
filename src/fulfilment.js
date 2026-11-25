import { UNITS, CURRENCIES, id, req, clean, choice, date, ensure, ref, record, unique, csvLines, quantity, round, sum, norm } from './model.js';
import { schemesOf, shippedQty } from './commerce.js';
import { checkEvidence, checkLotClaims, useCredits } from './standards.js';
import { usable, inUnit, takeStock, post, stockMove } from './stock.js';
import { checkClaimRules, claimContextForLot } from './claim-scope.js';

function shippingLegs(input) {
  return csvLines(input, 'Transport leg', 4, 7).map(([from, to, mode, carrier, dateOut, dateIn, tracking]) => {
    const departure = dateOut ? date(dateOut) : '';
    const arrival = dateIn ? date(dateIn) : '';
    ensure(!departure || !arrival || arrival >= departure, 'Transport arrival must follow departure.');
    return { from: req(from, 'Origin terminal'), to: req(to, 'Destination terminal'), mode: req(mode, 'Transport mode'),
      carrier: req(carrier, 'Carrier'), departure, arrival, tracking: clean(tracking, 120) };
  });
}

export function dispatch(s, x, ctx) {
  const number = req(x.number, 'Dispatch number');
  unique(s.shipments, 'number', number, 'Dispatch number already exists.');
  const day = date(x.date);
  const evidenceShipment = clean(x.evidenceShipment, 150) || number;
  const inputs = csvLines(x.items, 'Dispatch content', 3);
  ensure(inputs.length, 'List each lot, PO line and quantity to dispatch.');
  const keys = new Set();
  const byLot = new Map();
  const totals = new Map();
  let buyer;
  let currency;
  let massBalanceKg = 0;
  const claimDecisions = [];
  for (const [lotId, lineId, value] of inputs) {
    const lot = record(s.lots, lotId, 'shipping lot ' + lotId);
    ensure(lot.material !== 'Packed carton' || !s.shipments.some(sh => sh.lotIds.includes(lot.id)), 'Carton ' + lot.id + ' has already been dispatched.');
    const line = record(s.lines, lineId, 'PO line');
    const order = record(s.orders, line.orderId, 'buyer PO');
    ensure(order.buyerId, 'Link a buyer in the Buyer PO register before dispatching this order.');
    const pair = lotId + '|' + lineId;
    ensure(!keys.has(pair), 'List each lot and PO line combination once.');
    keys.add(pair);
    buyer ??= order;
    currency ??= order.currency;
    ensure(buyer.buyerId === order.buyerId && currency === order.currency, 'One dispatch must go to one buyer in one order currency.');
    ensure(line.status === 'Approved' && order.kind === 'Goods' && day >= order.date, 'Use approved goods PO lines and a valid date.');
    ensure(!lot.ownerId || lot.ownerId === order.buyerId, 'The lot is owned by a different customer.');
    ensure((line.product === lot.material || line.product === 'Traded goods' && line.stages.length === 0) && line.unit === lot.unit, 'The lot does not match the ordered product or unit on ' + line.id + '.');
    usable(s, lot, day);
    const schemes = schemesOf(line);
    checkLotClaims(s, lot, schemes);
    const qty = quantity(value, 'Dispatch quantity', line.unit);
    const pending = round((totals.get(line.id) ?? 0) + qty);
    ensure(pending <= round(line.qty - shippedQty(s, line.id)), 'Dispatch exceeds the open quantity on ' + line.id + '.');
    totals.set(line.id, pending);
    const list = byLot.get(lot.id) ?? [];
    list.push({ lotId, lineId, lineNo: line.lineNo, po: order.po, qty, unit: lot.unit, style: line.style, price: line.price, revision: line.revision });
    byLot.set(lot.id, list);
    const checked = schemes.filter(scheme => s.policies.some(p => p.scheme === scheme && p.role === 'Processor' && p.operation === 'Dispatch' && p.effective <= day));
    if (s.claimRules.length) claimDecisions.push(...checkClaimRules(s, { ...claimContextForLot(s, lot, line.id),
      holder: s.settings.name, operation: 'Dispatch', on: day }));
    claimDecisions.push(...checkEvidence(s, {
      schemes: checked, role: 'Processor', name: s.settings.name, site: lot.site, operation: 'Dispatch',
      material: lot.material, on: day, amount: qty, unit: lot.unit, consume: true, subject: line.sku || ref(s.items, lot.itemId)?.code,
      tx: { seller: s.settings.name, buyer: order.buyer, shipment: evidenceShipment },
    }));
    if (schemes.includes('CMiA Mass Balance')) massBalanceKg = round(massBalanceKg + inUnit(lot, qty, 'kg'));
  }
  const moves = [];
  const contents = [];
  for (const [lotId, rows] of byLot) {
    const lot = record(s.lots, lotId, 'shipping lot');
    const packed = lot.material === 'Packed carton';
    const qty = sum(rows);
    if (packed) {
      ensure(qty === lot.qty, 'Dispatch the complete carton ' + lot.id + '.');
      ensure(rows.every(r => r.qty === lot.allocationBalance.find(a => a.lineId === r.lineId)?.qty), 'Dispatch allocations must match the packing record for ' + lot.id + '.');
    }
    const promises = lot.allocationBalance;
    const unassigned = round(lot.qty - sum(promises));
    const needUnassigned = sum(rows, r => Math.max(0, r.qty - (promises.find(a => a.lineId === r.lineId)?.qty || 0)));
    ensure(needUnassigned <= unassigned, 'Check the assigned quantities before dispatching ' + lot.id + '.');
    for (const item of rows) takeStock(lot, item.qty, day, new Set([item.lineId]));
    moves.push(stockMove(lot, -qty));
    contents.push(...rows);
  }
  const claims = massBalanceKg ? useCredits(s, massBalanceKg, day) : [];
  const sh = {
    id: id(s, 'SHP'), number, date: day, buyerId: buyer.buyerId, customer: buyer.buyer, currency, contents, evidenceShipment,
    mode: choice(x.mode || 'Domestic', ['Domestic', 'Export', 'Customer return'], 'shipment type'),
    destination: req(x.destination || buyer.shipTo, 'Delivery address or ship-to site'),
    allocations: [...totals].map(([lineId, qty]) => ({ lineId, qty })),
    lotIds: [...byLot.keys()], carrier: clean(x.carrier), tracking: clean(x.tracking),
    packingList: [...byLot.keys()].flatMap(lotId => {
      const p = ref(s.lots, lotId)?.packing;
      return p ? [{ cartonId: lotId, label: p.label, pallet: p.pallet, netKg: p.netKg, grossKg: p.grossKg, contents: structuredClone(p.contents) }] : [];
    }),
    originPort: clean(x.originPort), destinationPort: clean(x.destinationPort), legs: shippingLegs(x.legs),
    challan: clean(x.challan), customsRef: clean(x.customsRef), eway: clean(x.eway), container: clean(x.container),
    document: ctx.document(x.document, ['logistics']), notes: clean(x.notes), status: 'Dispatched',
    claims, claimDecisions,
  };
  s.shipments.push(sh);
  post(s, 'Dispatch', ctx, { date: day, shipmentId: sh.id, output: sh.lotIds[0], lotIds: sh.lotIds, moves, reference: number, to: sh.destination });
  return sh;
}

export function confirmDelivery(s, x, ctx) {
  const sh = record(s.shipments, x.shipmentId, 'shipment');
  ensure(sh.status === 'Dispatched', 'This shipment has already been delivered.');
  sh.delivered = date(x.date);
  ensure(sh.delivered >= sh.date, 'Delivery cannot precede dispatch.');
  sh.proof = req(x.reference, 'Proof of delivery reference');
  sh.deliveryDocument = ctx.document(x.document, ['logistics']);
  sh.status = 'Delivered';
  return sh;
}

export function customerReturn(s, x, ctx) {
  const sh = record(s.shipments, x.shipmentId, 'shipment');
  const content = sh.contents.find(row => row.lotId === x.lotId && row.lineId === x.lineId);
  ensure(content, 'Select a lot and PO line on the shipment.');
  const line = record(s.lines, content.lineId, 'PO line');
  const dateReturned = date(x.date);
  ensure(dateReturned >= sh.date, 'Return cannot precede dispatch.');
  const qty = quantity(x.qty, 'Returned quantity', content.unit);
  const already = sum(s.events.filter(e => e.kind === 'Customer return' && e.shipmentId === sh.id && e.input === content.lotId && e.lineId === content.lineId));
  ensure(round(already + qty) <= content.qty, 'Return exceeds the quantity dispatched for this line.');
  const lot = record(s.lots, content.lotId, 'original lot');
  const dest = record(s.locations, x.locationId, 'return location');
  const result = ctx.newReturnLot(s, x, lot, qty, dateReturned, dest);
  post(s, 'Customer return', ctx, {
    date: dateReturned, shipmentId: sh.id, input: lot.id, output: result.id, lineId: line.id, qty, unit: lot.unit,
    lotIds: [lot.id, result.id], moves: [stockMove(result, qty)], reference: req(x.reference, 'Return authorization or RMA'),
    document: ctx.document(x.document, ['logistics']),
  });
  return result;
}

export const TAX_PARTS = ['cgst', 'sgst', 'utgst', 'igst', 'cess'];
export function taxLines(x) {
  const parts = Object.fromEntries(TAX_PARTS.map(k => [k, cash(x[k] || '0', k.toUpperCase())]));
  const total = sum(Object.values(parts), n => n);
  ensure(!(parts.igst && (parts.cgst || parts.sgst || parts.utgst)), 'Enter IGST or the local components for this document.');
  ensure(!parts.sgst || !parts.utgst, 'Use SGST or UTGST for the approved document.');
  return { parts, total };
}

export function cash(value, label) {
  const raw = String(value ?? '').trim();
  ensure(/^\d+(?:\.\d{1,2})?$/.test(raw), label + ' requires an amount with up to two decimal places.');
  const v = Number(raw);
  ensure(v <= 1e10, label + ' exceeds the supported amount.');
  return v;
}

export function issueInvoice(s, x, ctx) {
  const number = req(x.number, 'Invoice number');
  unique(s.invoices, 'number', number, 'Invoice number already exists.');
  const sh = x.shipmentId ? record(s.shipments, x.shipmentId, 'shipment') : null;
  const order = sh ? null : record(s.orders, x.orderId, 'service order');
  if (order) ensure(order.buyerId, 'Link a buyer in the Buyer PO register before invoicing this order.');
  if (order) ensure(order.kind === 'Service' && s.lines.some(l => l.orderId === order.id && l.status === 'Approved'), 'Approve a service order before billing it.');
  if (sh) ensure(!s.invoices.some(i => i.shipmentId === sh.id), 'This shipment already has an invoice.');
  const day = date(x.date);
  ensure(day >= (sh?.date || order.date), 'Invoice date cannot precede the transaction.');
  const due = x.due ? date(x.due) : day;
  ensure(due >= day, 'Due date cannot precede invoice date.');
  const items = sh?.contents.map(i => ({ ...i, net: Math.round(i.qty * i.price * 100) / 100 })) ?? [];
  const net = x.net ? cash(x.net, 'Taxable value') : sum(items, i => i.net);
  if (x.net && items.length) ensure(net === sum(items, i => i.net) || clean(x.adjustmentRef), 'Explain why invoice value differs from PO pricing.');
  const taxes = taxLines(x);
  ensure(net + taxes.total > 0, 'Enter a positive invoice amount.');
  const inv = {
    id: id(s, 'INV'), number, date: day, due, status: 'Issued', buyerId: sh?.buyerId || order.buyerId,
    customer: sh?.customer || order.buyer, shipmentId: sh?.id || '', serviceOrderId: order?.id || '',
    currency: sh?.currency || order.currency, net, tax: taxes.total, ...taxes.parts, amount: round(net + taxes.total),
    lines: items, terms: clean(x.terms) || order?.terms || '', gstin: clean(x.gstin, 30),
    placeOfSupply: clean(x.placeOfSupply, 100), hsn: clean(x.hsn, 50), taxRef: clean(x.taxRef),
    description: clean(x.description), adjustmentRef: clean(x.adjustmentRef), document: ctx.document(x.document, ['invoice']),
  };
  if (order) inv.description = req(inv.description, 'Service description');
  s.invoices.push(inv);
  return inv;
}

export function addCost(s, x, ctx) {
  const lot = record(s.lots, x.lotId, 'lot');
  const refNo = req(x.reference, 'Charge or invoice reference');
  const batch = x.category === 'Job work' ? ref(s.processBatches, lot.embroideryBatchId || lot.washBatchId) : null;
  const serviceJob = ref(s.jobs, batch?.jobId);
  ensure(!serviceJob || norm(lot.embroidery?.disposition || lot.wash?.disposition) !== 'unused', 'Select an actual processed return lot for the service charge.');
  ensure(!serviceJob || !x.supplierId || x.supplierId === serviceJob.processorId, 'Use the processor on the outward challan for this charge.');
  const supplierId = serviceJob?.processorId || x.supplierId;
  const supplier = supplierId ? partyForCost(s, supplierId) : null;
  ensure(!s.costs.some(c => c.lot === lot.id && norm(c.reference) === norm(refNo)), 'This charge reference is already posted to the lot.');
  const day = date(x.date);
  ensure(day >= lot.date, 'Charge date cannot precede lot creation.');
  const currency = choice(x.currency || 'INR', CURRENCIES, 'charge currency');
  const rate = currency === 'INR' ? 1 : quantity(x.rate, 'INR conversion rate', '', false);
  const net = cash(x.net, 'Net payable');
  const taxable = x.taxable ? cash(x.taxable, 'Taxable basis') : net;
  const capitalized = x.capitalized ? cash(x.capitalized, 'Amount added to cost') : net;
  ensure(capitalized <= net, 'Capitalized value cannot exceed the net payable.');
  const taxes = taxLines(x);
  const recoverable = cash(x.credit || '0', 'Confirmed recoverable GST');
  const itcStatus = choice(x.itcStatus || 'Pending review', ['Pending review', 'Eligible', 'Ineligible', 'Reversed'], 'ITC review status');
  ensure(recoverable <= taxes.total && (!recoverable || itcStatus === 'Eligible'), 'Only confirmed eligible GST can be excluded from cost.');
  const taxToCost = cash(x.taxToCost || '0', 'GST added to cost');
  ensure(round(recoverable + taxToCost) <= taxes.total, 'Recoverable GST plus GST added to cost cannot exceed total GST.');
  const landed = Math.round((capitalized + taxToCost) * rate * 100) / 100;
  const row = {
    id: id(s, 'CST'), lot: lot.id, date: day, currency, rate, rateRef: currency === 'INR' ? 'Base' : req(x.rateRef, 'Approved exchange rate source'),
    reference: refNo, net, taxable, capitalized, ...taxes.parts, gst: taxes.total, credit: recoverable, taxToCost,
    landed, itcStatus, payable: round(net + taxes.total), taxRef: clean(x.taxRef), supplierId: supplier?.id || '', supplier: supplier?.name || '',
    category: choice(x.category, ['Material', 'Labour', 'Machine', 'Energy', 'Water', 'Steam', 'Chemicals', 'Waste', 'Job work', 'Freight', 'Insurance', 'Duty', 'Other'], 'charge category'),
    basis: req(x.basis || 'Direct to lot', 'Cost allocation basis'),
    document: ctx.document(x.document, ['cost']),
  };
  if (serviceJob) Object.assign(row, {
    [batch.process === 'Embroidery' ? 'embroideryBatchId' : 'washBatchId']: batch.id,
    jobId: serviceJob.id, challan: serviceJob.number, returnEventId: lot.eventId,
  });
  s.costs.push(row);
  return row;
}

function partyForCost(s, id) {
  const result = record(s.parties, id, 'charge supplier');
  ensure(['Supplier', 'Processor'].includes(result.type), 'Select the supplier or job worker who billed the charge.');
  return result;
}

export function lotCost(s, lot, through = '9999-12-31') {
  const byLot = new Map(s.lots.map(row => [row.id, row]));
  const direct = new Map();
  for (const charge of s.costs.filter(row => row.date <= through)) {
    direct.set(charge.lot, (direct.get(charge.lot) ?? 0) + charge.landed);
  }
  const values = new Map();
  // Posted parents always precede their children. Use a memoized walk for imported lots.
  const active = new Set();
  function calculate(row) {
    if (values.has(row.id)) return values.get(row.id);
    if (active.has(row.id)) return 0;
    active.add(row.id);
    let value = direct.get(row.id) ?? 0;
    for (const parent of row.parents) {
      const source = byLot.get(parent.id);
      if (source?.initialQty) value += calculate(source) * parent.qty / source.initialQty;
    }
    active.delete(row.id);
    values.set(row.id, value);
    return value;
  }
  return Math.round(calculate(lot) * 100) / 100;
}
