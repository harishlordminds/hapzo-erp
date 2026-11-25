import { clean, csvLines, date, decimal, ensure, id, key, norm, quantity, record, ref, req, sum } from './model.js';
import { location, schemesOf } from './commerce.js';
import { checkLotClaims } from './standards.js';
import { checkProcessScope } from './process-materials.js';
import { lotKey, newLot, post, stockMove, takeStock, usable } from './stock.js';

export function approvePackingPlan(s, x, ctx) {
  const order = record(s.orders, x.orderId, 'buyer PO');
  ensure(order.kind === 'Goods', 'Use a goods order for carton packing.');
  const code = key(x.code, 'Packing instruction code');
  const version = req(x.version, 'Packing revision');
  ensure(!s.processSetups.some(p => p.process === 'Packing' && p.orderId === order.id && norm(p.code) === norm(code) && norm(p.version) === norm(version)),
    'This packing instruction revision already exists.');
  const assortment = csvLines(x.assortment, 'Carton assortment', 2).map(([lineId, pieces]) => {
    const line = record(s.lines, lineId, 'assortment line');
    ensure(line.orderId === order.id && line.unit === 'pcs' && line.product === 'Packed carton' && line.status === 'Approved' && line.stages.includes('Packing'),
      'Use approved packing lines for this buyer PO.');
    return { lineId, revision: line.revision, sku: line.sku || line.style, colour: line.color, size: line.size,
      qty: quantity(pieces, 'Pieces per carton for ' + line.lineNo, 'pcs') };
  });
  ensure(assortment.length && new Set(assortment.map(p => p.lineId)).size === assortment.length, 'Enter one count per PO line in the carton assortment.');
  const p = {
    id: id(s, 'PKP'), process: 'Packing', orderId: order.id, code, version, assortment, status: 'Approved', effective: date(x.effective),
    shortCarton: x.shortCarton === 'yes', instructions: req(x.instructions, 'Buyer packing instructions', 4000),
    reference: req(x.reference, 'Packing approval reference'), actor: ctx.actor, at: ctx.at, document: ctx.document(x.document, ['production', 'logistics']),
  };
  s.processSetups.push(p);
  return p;
}

export function packCarton(s, x, ctx) {
  const wo = record(s.workOrders, x.workOrderId, 'packing work order');
  const plan = record(s.processSetups, x.planId, 'approved packing instruction');
  const day = date(x.date);
  ensure(wo.stage === 'Packing' && ['Released', 'In progress'].includes(wo.status) && day >= wo.date && plan.process === 'Packing' &&
    plan.status === 'Approved' && plan.effective <= day && plan.assortment.some(row => row.lineId === wo.lineId && row.revision === wo.lineRevision),
  'Use a released work order with the effective packing instruction and approved PO revision.');
  const order = record(s.orders, plan.orderId, 'buyer order for this carton');
  const code = lotKey(s, x.cartonId);
  const dest = location(s, x.locationId || wo.locationId);
  ensure(dest.site === wo.site, 'Pack at the released work order site.');
  const label = req(x.labelRef, 'Carton label reference');
  ensure(!s.lots.some(lot => lot.packing && norm(lot.packing.label) === norm(label)), 'A carton already uses this label reference.');
  const netKg = decimal(x.netKg, 'Carton net kg', 0.000001);
  const grossKg = decimal(x.grossKg, 'Carton gross kg', 0.000001);
  ensure(grossKg >= netKg, 'Gross weight must be at least net weight.');
  const needs = schemesOf(wo);
  const contents = csvLines(x.contents, 'Carton garment issue', 3).map(([lotId, lineId, value]) => {
    const lot = record(s.lots, lotId, 'released garment lot');
    const line = record(s.lines, lineId, 'packing line');
    const rule = plan.assortment.find(row => row.lineId === lineId);
    ensure(rule && rule.revision === line.revision && line.status === 'Approved', 'This variant is outside the approved assortment or revision.');
    ensure(lot.material === 'Released garment' && lot.unit === 'pcs' && lot.site === dest.site, 'Issue quality released garments from the packing site.');
    ensure(!lot.ownerId || lot.ownerId === order.buyerId, 'The garment lot belongs to another customer.');
    ensure(lot.allocations.some(a => a.lineId === lineId) || ref(s.workOrders, lot.workOrderId)?.lineId === lineId, 'Use the garment lot allocated to this exact buyer PO variant.');
    ensure(JSON.stringify(schemesOf(line)) === JSON.stringify(needs), 'Keep different claims in separate cartons.');
    usable(s, lot, day);
    checkLotClaims(s, lot, needs);
    return { lot, lotId, lineId, revision: line.revision, sku: rule.sku, colour: rule.colour, size: rule.size,
      qty: quantity(value, 'Pieces from ' + lotId, 'pcs') };
  });
  ensure(contents.length && new Set(contents.map(row => row.lotId + '|' + row.lineId)).size === contents.length, 'List each garment lot and PO line combination once.');
  for (const rule of plan.assortment) {
    const qty = sum(contents.filter(row => row.lineId === rule.lineId));
    ensure(plan.shortCarton ? qty <= rule.qty : qty === rule.qty, 'Actual carton quantity must match the approved assortment for ' + rule.sku + ' / ' + rule.size + '.');
  }
  const total = sum(contents);
  ensure(total + wo.completedQty <= wo.plannedQty, 'Carton output exceeds the released work order quantity.');
  const ownerId = contents[0].lot.ownerId;
  ensure(contents.every(row => row.lot.ownerId === ownerId), 'Keep company and customer-owned stock in separate cartons.');
  const container = record(s.lots, x.cartonLotId, 'carton stock lot');
  const auxiliary = [{ lot: container, qty: 1 }, ...csvLines(x.supplies, 'Packing supply lot', 2).map(([id, value]) => {
    const lot = record(s.lots, id, 'packing supply');
    ensure(['Polybag', 'Hangtag', 'Label', 'Trim'].includes(lot.material), 'Use non-carton packing supplies in this list.');
    return { lot, qty: quantity(value, 'Packing quantity', lot.unit) };
  })];
  ensure(container.material === 'Carton' && ['carton', 'pcs'].includes(container.unit) && new Set(auxiliary.map(row => row.lot.id)).size === auxiliary.length,
    'Use one carton and distinct packing supply lots.');
  for (const { lot } of auxiliary) {
    ensure(lot.site === dest.site && (!lot.ownerId || lot.ownerId === ownerId), 'Packing inputs must match this site and stock owner.');
    usable(s, lot, day);
    checkLotClaims(s, lot, needs, true);
  }
  const assignments = plan.assortment.map(p => ({ lineId: p.lineId, qty: sum(contents.filter(row => row.lineId === p.lineId)) })).filter(a => a.qty > 0);
  const checks = assignments.flatMap(a => checkProcessScope(s, { ...wo, lineId: a.lineId }, { site: wo.site, number: code, unit: 'pcs' },
    [{ lot: contents.find(row => row.lineId === a.lineId).lot, qty: a.qty }], day, { consume: true, material: () => 'Packed carton' }));
  const parents = contents.map(({ lot, qty, lineId }) => ({
    id: lot.id, qty, unit: 'pcs', role: 'Carton content', allocations: takeStock(lot, qty, day, new Set([lineId])),
  }));
  for (const { lot, qty } of auxiliary) {
    takeStock(lot, qty, day, new Set(assignments.map(row => row.lineId)));
    parents.push({ id: lot.id, qty, unit: lot.unit, role: 'Packaging' });
  }
  const packing = { planId: plan.id, planRevision: plan.version, label, pallet: clean(x.pallet), locationId: dest.id, orderId: order.id,
    contents: contents.map(({ lot, ...row }) => row), netKg, grossKg, document: ctx.document(x.document, ['production', 'logistics']) };
  const out = newLot(s, code, total, 'pcs', day, dest, {
    material: 'Packed carton', label: 'Carton ' + code, stage: 'Packing', workOrderId: wo.id, qualityStatus: 'Released', ownerId,
    scheme: wo.scheme, additionalSchemes: wo.additionalSchemes, checks, parents, netKg, grossKg, packing,
    composition: [...new Set(contents.map(row => row.lot.composition).filter(Boolean))].join(' / '),
    allocations: assignments, allocationBalance: structuredClone(assignments),
  });
  const event = post(s, 'Production', ctx, {
    process: 'Packing', stage: 'Packing', type: 'Run', date: day, workOrderId: wo.id, site: wo.site, inputs: parents, output: out.id,
    qty: total, unit: 'pcs', allocations: assignments, checks, reference: label,
    reconciliation: { unit: 'pcs', accepted: total, waste: 0, rejects: 0 },
    moves: [...parents.map(p => stockMove(record(s.lots, p.id, 'packing input'), -p.qty)), stockMove(out, total)],
  });
  out.eventId = event.id;
  wo.completedQty += total;
  wo.status = wo.completedQty === wo.plannedQty ? 'Completed' : 'In progress';
  return out;
}
