import {
  UNITS, STAGES, clean, req, key, choice, decimal, quantity, date, id, norm, ref, record, unique,
  ensure, round, close, sum, csvLines,
} from './model.mjs';
import { compareFabric, fabricCondition, fabricObservation, fabricTargetsForLot } from './fabric.mjs';
import { evaluateGarmentInspection, garmentTargetsForLot } from './garment.mjs';
import { checkClaimRules, claimContextForLot, declaredChemicals } from './claim-scope.mjs';
import { party, location, locationName, schemesOf, extraSchemes } from './commerce.mjs';
import { checkEvidence, checkHistory, checkLotClaims, schemeNames } from './standards.mjs';

export function post(s, kind, ctx, data) {
  const row = { id: id(s, 'EVT'), kind, at: ctx.at, actor: ctx.actor, ...data };
  s.events.push(row);
  return row;
}

export function lotKey(s, value) {
  const code = key(value, 'Lot ID');
  unique(s.lots, 'id', code, 'This lot ID already exists.');
  return code;
}

export function checkDate(lot, day) {
  ensure(day >= (lot.lastDate || lot.date), 'Posting date precedes the latest stock activity on lot ' + lot.id + '.');
}

export function usable(s, lot, day, rework = false) {
  checkDate(lot, day);
  checkHistory(s, lot);
  ensure(lot.custody === 'Own site', 'Lot ' + lot.id + ' is outside the factory.');
  ensure(lot.qualityStatus === (rework ? 'Rework' : 'Released'), 'Lot ' + lot.id + ' has quality status ' + lot.qualityStatus + '.');
}

export const stockMove = (lot, qty) => ({
  lotId: lot.id, qty, unit: lot.unit, locationId: lot.locationId, location: lot.location, custody: lot.custody,
});

export function newLot(s, code, qty, unit, day, loc, fields) {
  const row = {
    id: code, qty, initialQty: qty, unit, date: day, lastDate: day,
    locationId: loc.id, location: locationName(loc), site: loc.site,
    stage: 'Goods receipt', custody: 'Own site', qualityStatus: 'Pending inspection',
    ownerId: '', reservations: [], allocations: [], allocationBalance: [], parents: [],
    checks: [], scheme: 'Conventional', additionalSchemes: [], standardHold: false, holdReason: '',
    ...fields,
  };
  s.lots.push(row);
  return row;
}

export function measures(x, qty, unit) {
  return {
    netKg: unit === 'kg' ? qty : unit === 'g' ? round(qty / 1000) : (x.netKg ? decimal(x.netKg, 'Actual net kg', 0.000001) : null),
    lengthM: unit === 'm' ? qty : unit === 'cm' ? round(qty / 100) : (x.lengthM ? decimal(x.lengthM, 'Actual length in metres', 0.000001) : null),
    grossKg: x.grossKg ? decimal(x.grossKg, 'Actual gross kg', 0.000001) : null,
  };
}

export function inUnit(lot, qty, unit) {
  if (unit === lot.unit) return qty;
  if (unit === 'kg' && lot.netKg) return round(qty * lot.netKg / lot.initialQty);
  if (unit === 'm' && lot.lengthM) return round(qty * lot.lengthM / lot.initialQty);
  ensure(false, 'Record a measured ' + unit + ' equivalent for lot ' + lot.id + ' before combining these units.');
}

export function lotAllocations(s, text, unit, max, fallback = '') {
  const rows = csvLines(text, 'PO allocation', 2).map(([lineId, qty]) => ({ lineId, qty: quantity(qty, 'Allocated quantity', unit) }));
  if (!rows.length && fallback && ref(s.lines, fallback)?.unit === unit) rows.push({ lineId: fallback, qty: max });
  ensure(new Set(rows.map(a => a.lineId)).size === rows.length && sum(rows) <= max, 'Use unique PO lines and allocate within the lot quantity.');
  for (const row of rows) {
    const line = record(s.lines, row.lineId, 'PO line in allocation');
    ensure(line.status === 'Approved' && line.unit === unit, 'Allocation ' + line.id + ' must use an approved line with the same unit.');
  }
  return rows;
}

function reduceBucket(rows, qty, ids) {
  let left = qty;
  const used = [];
  for (const row of rows) {
    if (!ids.has(row.lineId) || left <= 0) continue;
    const take = Math.min(row.qty, left);
    row.qty = round(row.qty - take);
    left = round(left - take);
    if (take) used.push({ lineId: row.lineId, qty: take });
  }
  return used;
}

function committedStock(lot, exclude = new Set()) {
  const lines = new Set([...lot.reservations, ...lot.allocationBalance].map(a => a.lineId).filter(line => !exclude.has(line)));
  return sum([...lines], line => Math.max(
    lot.reservations.find(a => a.lineId === line)?.qty || 0,
    lot.allocationBalance.find(a => a.lineId === line)?.qty || 0,
  ));
}

export function takeStock(lot, qty, day, eligible = new Set(), allocationOrder = []) {
  const blocked = committedStock(lot, eligible);
  ensure(qty <= round(lot.qty - blocked), 'Quantity exceeds usable balance on ' + lot.id + '. Check reservations and PO allocations.');
  const rowOrder = allocationOrder.length
    ? [...lot.allocationBalance].sort((a, b) => (allocationOrder.indexOf(a.lineId) + 1 || Infinity) - (allocationOrder.indexOf(b.lineId) + 1 || Infinity))
    : lot.allocationBalance;
  const allocations = reduceBucket(rowOrder, qty, eligible);
  reduceBucket(lot.reservations, qty, eligible);
  lot.allocationBalance = lot.allocationBalance.filter(a => a.qty > 0);
  lot.reservations = lot.reservations.filter(a => a.qty > 0);
  lot.qty = round(lot.qty - qty);
  ensure(committedStock(lot) <= lot.qty, 'The issue would strand an existing reservation or allocation on ' + lot.id + '.');
  lot.lastDate = day;
  return allocations;
}

function receiptChecks(s, lot, consume) {
  const item = ref(s.items, lot.itemId);
  const purchase = ref(s.purchases, lot.purchaseId);
  const lineId = ref(s.requisitions, ref(purchase?.lines ?? [], lot.purchaseLineId)?.reqId)?.lineId;
  const operation = 'Supply';
  const scoped = checkClaimRules(s, { operation, lineIds: [lineId], on: lot.date, itemId: lot.itemId, site: lot.origin,
    holder: lot.party, chemicals: item?.type === 'Chemical' ? [item.code] : [], components: item ? [item.code] : [] });
  const schemeChecks = checkEvidence(s, {
    schemes: schemesOf(lot), role: 'Supplier', partyId: lot.partyId, name: lot.party, site: lot.origin,
    operation, material: lot.material, on: lot.date, amount: lot.initialQty, unit: lot.unit, consume,
    tx: lot.evidenceShipment ? { seller: lot.party, buyer: lot.evidenceBuyer || s.settings.name, shipment: lot.evidenceShipment } : null,
    subject: item?.code,
  });
  return [...schemeChecks, ...scoped];
}

export function receive(s, x, ctx) {
  const day = date(x.date);
  const code = lotKey(s, x.lotId);
  const dest = location(s, x.locationId);
  const purchase = x.purchaseId ? record(s.purchases, x.purchaseId, 'purchase PO') : null;
  const pl = purchase ? record(purchase.lines, x.purchaseLineId, 'purchase line') : null;
  const item = record(s.items, pl?.itemId || x.itemId, 'received item');
  const reference = req(x.reference, 'GRN or opening stock reference');
  const mode = purchase ? 'Purchase' : choice(x.mode || 'Direct inward', ['Direct inward', 'Customer inward', 'Opening stock'], 'inward type');
  const p = mode === 'Customer inward' ? party(s, x.ownerId, 'Buyer') :
    mode === 'Opening stock' ? null : party(s, purchase?.supplierId || x.supplierId, 'Supplier');
  const origin = purchase?.supplierSite || req(x.origin, 'Source location or facility');
  const scheme = purchase?.scheme || choice(x.scheme || 'Conventional', schemeNames(s), 'standard');
  const qty = quantity(x.qty, 'Received stock quantity', item.unit);
  if (purchase) {
    ensure(day >= purchase.date && day >= (pl.lastDate || purchase.date) && qty <= round(pl.qty - pl.received), 'Receipt date or remainder does not match the purchase line.');
    ensure(dest.id === purchase.shipTo, 'Receive at the location on the supplier PO.');
  }
  const measurement = measures(x, qty, item.unit);
  ensure(!measurement.grossKg || !measurement.netKg || measurement.grossKg >= measurement.netKg, 'Gross kg must be at least net kg.');
  const lot = newLot(s, code, qty, item.unit, day, dest, {
    itemId: item.id, material: item.type, label: item.name, partyId: p?.id || '', party: p?.name || s.settings.name,
    supplierLot: clean(x.supplierLot, 120), origin, ownerId: mode === 'Customer inward' ? p.id : '',
    evidenceShipment: clean(x.evidenceShipment, 150) || reference, evidenceBuyer: s.settings.name,
    scheme, additionalSchemes: extraSchemes(s, x.additionalSchemes, scheme), ...measurement, claimSource: 'receipt', purchaseId: purchase?.id || '',
    purchaseLineId: pl?.id || '',
    originCountry: clean(x.originCountry, 80), composition: clean(x.composition) || item.composition,
  });
  try {
    lot.checks = receiptChecks(s, lot, true);
  } catch (error) {
    // A transaction failure after any limited evidence allocation must roll back.
    if (error.code !== 'standard-lock') throw error;
    lot.standardHold = true;
    lot.holdReason = error.message;
  }
  if (pl) {
    pl.received = round(pl.received + qty);
    pl.lastDate = day;
  }
  const event = post(s, 'Goods receipt', ctx, {
    date: day, reference, mode, lotId: lot.id, output: lot.id, qty, unit: item.unit, party: lot.party, evidenceShipment: lot.evidenceShipment,
    purchaseId: purchase?.id || '', purchaseLineId: pl?.id || '', document: ctx.document(x.document, ['stock']),
    from: origin, to: lot.location, moves: [stockMove(lot, qty)], checks: lot.checks,
  });
  lot.eventId = event.id;
  return lot;
}

export function releaseStandard(s, x, ctx) {
  const lot = record(s.lots, x.lotId, 'lot');
  ensure(lot.standardHold, 'This lot has no outstanding Standard Lock hold.');
  if (lot.claimSource === 'receipt') lot.checks = receiptChecks(s, lot, true);
  else if (lot.washBatchId && lot.wash || lot.printBatchId && lot.printing || lot.embroideryBatchId && lot.embroidery) checkHistory(s, { ...lot, standardHold: false });
  else {
    const trigger = lot.claimTrigger;
    ensure(trigger, 'Add verified evidence to the source transaction before releasing this lot.');
    for (const parent of lot.parents) checkHistory(s, record(s.lots, parent.id, 'parent lot'));
    const scoped = lot.scopedClaimTrigger;
    if (scoped?.requireChemicalDeclaration && (x.chemicalItems || x.noChemicals === 'yes')) {
      const codes = declaredChemicals(s, x.chemicalItems);
      ensure(!codes.length || x.noChemicals !== 'yes', 'Record the chemical codes or confirm no chemicals were used.');
      scoped.chemicals = codes;
      scoped.noChemicals = x.noChemicals === 'yes';
    }
    const job = ref(s.jobs, lot.jobId);
    for (const decision of job?.checks ?? []) for (const evidence of decision.evidence) {
      ensure(ref(s.evidence, evidence.id)?.status === 'Verified', 'Evidence ' + evidence.number + ' on this challan is no longer verified.', 422, 'standard-lock');
    }
    const checks = scoped ? checkClaimRules(s, scoped) : [];
    lot.checks = [...checkEvidence(s, trigger), ...checks];
    if (job?.checks?.length) lot.checks.push(...job.checks);
  }
  lot.standardHold = false;
  lot.holdReason = '';
  post(s, 'Standards release', ctx, { date: date(), output: lot.id, checks: lot.checks, qty: lot.qty, unit: lot.unit });
  return lot;
}

export function inspect(s, x, ctx) {
  const lot = record(s.lots, x.lotId, 'lot');
  const day = date(x.date);
  checkDate(lot, day);
  ensure(lot.qty > 0 && lot.custody === 'Own site', 'This inspection requires available stock in your custody.');
  const decision = choice(x.decision, ['Released', 'Hold', 'Rework', 'Rejected'], 'inspection result');
  ensure(lot.qualityStatus !== 'Rejected', 'Rejected stock requires an approved disposition.');
  const condition = fabricCondition(lot);
  ensure(condition || !x.fabricType, 'Fabric measurements apply to greige, dyed or finished fabric lots.');
  const observation = condition ? fabricObservation(x) : null;
  const techPack = evaluateGarmentInspection(s, lot, x.techInspection);
  const techTarget = techPack?.key || clean(x.techTarget, 200);
  ensure(!techTarget || techPack || garmentTargetsForLot(s, lot).some(row => row.key === techTarget), 'Choose a tech pack target linked to this lot.');
  const comparisons = condition ? compareFabric(fabricTargetsForLot(s, lot, techTarget), observation) : [];
  const fabric = observation || comparisons.length ? { condition, observation, comparisons } : null;
  const event = post(s, 'Quality inspection', ctx, {
    date: day, output: lot.id, qty: lot.qty, unit: lot.unit, decision,
    reference: req(x.reference, 'Inspection report or sample reference'), testMethod: clean(x.testMethod),
    sample: clean(x.sample), result: clean(x.result), notes: clean(x.notes), document: ctx.document(x.document, ['quality']),
    ...(fabric ? { fabric } : {}),
    ...(techPack ? { techPack } : {}),
    ...(lot.garmentFinish?.inspectionHistory?.length ? { earlierInspections: lot.garmentFinish.inspectionHistory } : {}),
  });
  lot.qualityStatus = decision;
  if (decision === 'Released' && lot.garmentFinish && lot.material === 'Finished garment') {
    lot.material = 'Released garment';
    lot.stage = 'Final inspection';
  }
  lot.lastDate = day;
  lot.inspectionId = event.id;
  return lot;
}

export function dispose(s, x, ctx) {
  const lot = record(s.lots, x.lotId, 'lot');
  const day = date(x.date);
  checkDate(lot, day);
  ensure(['Rejected', 'Hold'].includes(lot.qualityStatus) && lot.custody === 'Own site', 'Dispose of rejected or held stock at a factory.');
  const amount = quantity(x.qty, 'Disposition quantity', lot.unit);
  const mode = choice(x.mode, ['Scrap', 'Supplier return'], 'disposition type');
  ensure(amount <= lot.qty, 'Disposition exceeds on-hand stock.');
  const reference = req(x.reference, 'Disposition approval or return reference');
  lot.qty = round(lot.qty - amount);
  lot.lastDate = day;
  let released = amount;
  const reservations = [...lot.reservations];
  for (const reservation of reservations) {
    const n = Math.min(reservation.qty, released);
    reservation.qty = round(reservation.qty - n);
    released = round(released - n);
  }
  lot.reservations = reservations.filter(r => r.qty > 0);
  reduceBucket(lot.allocationBalance, amount, new Set(lot.allocationBalance.map(a => a.lineId)));
  lot.allocationBalance = lot.allocationBalance.filter(a => a.qty > 0);
  if (mode === 'Supplier return' && lot.purchaseId) {
    const po = record(s.purchases, lot.purchaseId, 'supplier PO');
    const source = ref(s.events, lot.eventId) ?? s.events.find(e => e.output === lot.id && e.kind === 'Goods receipt');
    const pl = ref(po.lines, source?.purchaseLineId || lot.purchaseLineId);
    if (pl) {
      ensure(day >= pl.lastDate && amount <= pl.received, 'Return exceeds the purchase line received balance.');
      pl.received = round(pl.received - amount);
      pl.lastDate = day;
    }
  }
  return post(s, mode, ctx, { date: day, reference, output: lot.id, qty: amount, unit: lot.unit, moves: [stockMove(lot, -amount)], notes: clean(x.notes) });
}

export function reserveStock(s, x, ctx) {
  const mode = choice(x.mode ?? 'Reserve', ['Reserve', 'Release'], 'reservation action');
  const lot = record(s.lots, x.lotId, 'lot');
  const line = record(s.lines, x.lineId, 'PO line');
  ensure(line.status === 'Approved', 'Approve the PO line before reserving stock.');
  const amount = quantity(x.qty, 'Reservation quantity', lot.unit);
  const old = lot.reservations.find(r => r.lineId === line.id);
  if (mode === 'Release') {
    ensure(old && amount <= old.qty, 'Release must be within the existing reservation.');
    old.qty = round(old.qty - amount);
    lot.reservations = lot.reservations.filter(r => r.qty > 0);
  } else {
    usable(s, lot, date());
    checkLotClaims(s, lot, schemesOf(line));
    const order = record(s.orders, line.orderId, 'PO');
    ensure(!lot.ownerId || lot.ownerId === order.buyerId, 'This lot belongs to another customer.');
    if (old) old.qty = round(old.qty + amount);
    else lot.reservations.push({ lineId: line.id, qty: amount });
    ensure(committedStock(lot) <= lot.qty, 'Reservation exceeds uncommitted stock.');
  }
  return post(s, mode === 'Release' ? 'Release reservation' : 'Reserve', ctx, {
    date: date(), output: lot.id, lineId: line.id, qty: amount, unit: lot.unit,
  });
}

export function adjustStock(s, x, ctx) {
  const lot = record(s.lots, x.lotId, 'lot');
  const day = date(x.date);
  checkDate(lot, day);
  ensure(lot.custody === 'Own site' && lot.material !== 'Packed carton', 'Count this lot at a factory before packing.');
  const counted = quantity(x.qty, 'Counted quantity', lot.unit, true);
  const delta = round(counted - lot.qty);
  ensure(delta !== 0 && counted >= committedStock(lot), 'Count adjustment must change quantity and preserve commitments.');
  ensure(delta < 0 || !schemesOf(lot).length, 'Record extra claimed quantity through a documented receipt.');
  if (delta > 0) ensure(!lot.parents.length && !lot.netKg && !lot.lengthM, 'Record newly found traced or measured goods as a separate receipt.');
  lot.qty = counted;
  lot.lastDate = day;
  return post(s, 'Stock count adjustment', ctx, {
    date: day, output: lot.id, qty: delta, unit: lot.unit, reference: req(x.reference, 'Count reference and reason'),
    moves: [stockMove(lot, delta)],
  });
}

export function transfer(s, x, ctx) {
  const lot = record(s.lots, x.lotId, 'lot');
  const dest = location(s, x.locationId);
  ensure(dest.id !== lot.locationId, 'Choose a different destination.');
  const day = date(x.date);
  usable(s, lot, day);
  const operation = 'Transfer';
  const scoped = s.claimRules.length ? checkClaimRules(s, { ...claimContextForLot(s, lot), site: dest.site, holder: s.settings.name, operation, on: day }) : [];
  const transferSchemes = schemesOf(lot).filter(scheme => s.policies.some(r => r.scheme === scheme && r.role === 'Processor' && r.operation === operation && r.effective <= day));
  const checks = [...scoped, ...checkEvidence(s, { schemes: transferSchemes, role: 'Processor', name: s.settings.name, site: dest.site,
    operation, material: lot.material, on: day, subject: ref(s.items, lot.itemId)?.code })];
  const qty = quantity(x.qty, 'Transfer quantity', lot.unit);
  ensure(qty <= lot.qty, 'Transfer exceeds lot quantity.');
  const outgoing = stockMove(lot, -qty);
  let moved = lot;
  if (close(qty, lot.qty)) {
    lot.locationId = dest.id;
    lot.location = locationName(dest);
    lot.site = dest.site;
    lot.lastDate = day;
  } else {
    ensure(lot.material !== 'Packed carton', 'Move a carton as one physical unit.');
    const code = lotKey(s, x.outputId);
    const movedAllocations = lotAllocations(s, x.allocations, lot.unit, qty);
    for (const draw of movedAllocations) {
      const bucket = lot.allocationBalance.find(a => a.lineId === draw.lineId);
      ensure(bucket && bucket.qty >= draw.qty, 'Split can only move the allocated quantity held on ' + draw.lineId + '.');
      bucket.qty = round(bucket.qty - draw.qty);
    }
    lot.allocationBalance = lot.allocationBalance.filter(a => a.qty > 0);
    const carriedReservations = [];
    for (const draw of movedAllocations) {
      const r = lot.reservations.find(a => a.lineId === draw.lineId);
      if (!r?.qty) continue;
      const carried = Math.min(r.qty, draw.qty);
      r.qty = round(r.qty - carried);
      carriedReservations.push({ lineId: draw.lineId, qty: carried });
    }
    lot.reservations = lot.reservations.filter(a => a.qty > 0);
    ensure(qty <= round(lot.qty - committedStock(lot)), 'Enter the existing PO allocations to carry into the split lot, or move the whole lot.');
    takeStock(lot, qty, day);
    const { material, label, itemId, ownerId, scheme, additionalSchemes, party, partyId, stage, origin, qualityStatus, composition } = lot;
    const parent = { id: lot.id, qty, unit: lot.unit };
    moved = newLot(s, code, qty, lot.unit, day, dest, {
      material, label, itemId, ownerId, scheme, additionalSchemes, party, partyId, stage, origin, qualityStatus, composition, parents: [parent],
      purchaseId: lot.purchaseId, purchaseLineId: lot.purchaseLineId,
      allocations: movedAllocations, allocationBalance: structuredClone(movedAllocations), reservations: carriedReservations,
      netKg: lot.netKg ? inUnit(lot, qty, 'kg') : null, lengthM: lot.lengthM ? inUnit(lot, qty, 'm') : null,
    });
  }
  if (checks.length) moved.checks = [...moved.checks, ...checks];
  const event = post(s, 'Internal transfer', ctx, {
    date: day, output: moved.id, input: lot.id, qty, unit: lot.unit, from: outgoing.location, to: moved.location,
    reference: req(x.reference, 'Transfer reference'), carrier: clean(x.carrier), route: clean(x.route), document: ctx.document(x.document, ['stock', 'logistics']),
    moves: [outgoing, stockMove(moved, qty)], checks,
  });
  return event;
}
