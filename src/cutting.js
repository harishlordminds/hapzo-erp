import { clean, csvLines, date, decimal, ensure, genealogy, id, key, norm, quantity, record, ref, req, round, sum } from './model.js';
import { location, schemesOf } from './commerce.js';
import { checkHistory } from './standards.js';
import { checkProcessScope } from './process-materials.js';
import { lotAllocations, lotKey, newLot, post, stockMove } from './stock.js';
import { batchReference, batchWork, kgBasis, lineRemaining, openBatch, postingDate, track } from './process-batch.js';
import { startGarmentBatch, garmentEvent, readGarmentIssue, issueGarmentStock, stageDraws, drawGarmentStock, returnGarmentStock } from './garment-stock.js';

export function approveMarker(s, x, ctx) {
  const line = record(s.lines, x.lineId, 'approved buyer PO line');
  const component = req(x.component, 'Fabric component').toUpperCase();
  const fabric = line.garmentSpec?.fabrics.find(row => row.code === component);
  ensure(line.status === 'Approved' && line.stages.includes('Cutting') && line.unit === 'pcs', 'Approve a pieces PO line with Cutting on its route.');
  ensure(!line.garmentSpec || fabric, 'Select a fabric component on the approved tech pack.');
  const code = key(x.code, 'Marker code');
  const version = req(x.version, 'Marker revision');
  ensure(!s.processSetups.some(row => row.process === 'Cutting' && row.lineId === line.id && norm(row.code) === norm(code) && norm(row.version) === norm(version)),
    'This marker revision is already approved for the line.');
  const pattern = fabric?.pattern ?? [];
  const panels = csvLines(x.panels, 'Panel position and number per garment', 2).map(([position, repeats]) => ({
    name: req(position, 'Panel position'), repeats: quantity(repeats, 'Panels per garment', 'pcs'), area: pattern.find(p => norm(p.name) === norm(position))?.area ?? null,
  }));
  const parts = panels.length ? panels : structuredClone(pattern);
  ensure(parts.length && new Set(parts.map(p => norm(p.name))).size === parts.length, 'Record each distinct panel position and its approved count.');
  ensure(!pattern.length || pattern.length === parts.length && pattern.every(p => parts.some(row => norm(row.name) === norm(p.name) && row.repeats === p.repeats)),
    'Panel positions and counts must match the approved tech pack pattern.');
  const effective = date(x.effective);
  const route = x.componentRouteId ? record(s.componentRoutes, x.componentRouteId, 'approved fabric component route')
    : s.componentRoutes.find(r => r.lineId === line.id && r.component === component && r.status === 'Approved');
  ensure(!route || route.lineId === line.id && route.component === component && route.status === 'Approved' && route.effective <= effective,
    'Select the effective approved route for the same line and fabric component.');
  const m = {
    id: id(s, 'MRK'), process: 'Cutting', code, version, status: 'Approved', lineId: line.id, lineRevision: line.revision, specRev: line.specRev,
    component, componentRouteId: route?.id || '', routeTemplate: route?.template || '', size: line.size, colour: line.color,
    parts, metres: decimal(x.metres, 'Marker length (m)', 0.000001), setsPerPly: quantity(x.setsPerPly || '1', 'Garment sets per ply', 'pcs'),
    effective, reference: req(x.reference, 'Marker approval reference'), document: ctx.document(x.document, ['production', 'tech-pack']), actor: ctx.actor, at: ctx.at,
  };
  s.processSetups.push(m);
  return m;
}

export function openCutLay(s, x, ctx) {
  const { wo, b, day } = startGarmentBatch(s, x, 'Cutting', 'LAY');
  const marker = record(s.processSetups, x.markerId, 'approved marker');
  ensure(marker.process === 'Cutting' && marker.status === 'Approved' && marker.effective <= day && marker.lineId === wo.lineId &&
    marker.lineRevision === wo.lineRevision && (!wo.techComponent || wo.techComponent === marker.component), 'Use the effective marker for the work order’s approved line revision and fabric component.');
  const plannedPlies = quantity(x.plies, 'Planned plies', 'pcs');
  ensure(plannedPlies * marker.setsPerPly <= wo.plannedQty - wo.completedQty, 'The approved lay exceeds the remaining work order plan.');
  const shadeGroup = req(x.shadeGroup, 'Lay shade group');
  const rows = readGarmentIssue(s, wo, x.inputs, day, (lot, [metres, kg, shade, conversion]) => {
    ensure(['Finished fabric', 'Inspected fabric'].includes(lot.material) && ['kg', 'g', 'm', 'cm'].includes(lot.unit), 'Issue released fabric rolls with kg, g, m or cm as their native unit.');
    ensure(lot.material === 'Inspected fabric' || ref(s.events, lot.inspectionId)?.decision === 'Released', 'Release finished fabric through Quality before cutting.');
    ensure(norm(req(shade || lot.shadeGroup || lot.fabric?.shade, 'Observed roll shade group')) === norm(shadeGroup) &&
      (!lot.shadeGroup || norm(lot.shadeGroup) === norm(shadeGroup)), 'Roll ' + lot.id + ' is outside the lay shade group.');
    if (marker.componentRouteId) {
      const route = [lot, ...genealogy(s, lot.id)].some(node => node.stage === 'Fabric finishing' &&
        ref(s.workOrders, node.workOrderId)?.componentRoute?.id === marker.componentRouteId);
      ensure(route, 'Roll ' + lot.id + ' does not trace to the approved finishing route for ' + marker.component + '.', 422, 'route-skip');
    }
    return { measuredMetres: metres, measuredKg: kg, conversion: clean(conversion) };
  }, 6).map(({ lot, qty, measuredMetres, measuredKg, conversion }) => {
    const nativeM = lot.unit === 'm' ? qty : lot.unit === 'cm' ? round(qty / 100) : null;
    const nativeKg = lot.unit === 'kg' ? qty : lot.unit === 'g' ? round(qty / 1000) : null;
    const metres = measuredMetres ? decimal(measuredMetres, 'Issued metres', 0.000001)
      : nativeM ?? (lot.lengthM ? round(lot.lengthM * qty / lot.initialQty) : null);
    const kg = measuredKg ? decimal(measuredKg, 'Issued kg', 0.000001)
      : nativeKg ?? (lot.netKg ? kgBasis(lot, qty).kg : null);
    ensure(nativeM == null || metres === nativeM, 'Issued metres must agree with the native quantity.');
    ensure(nativeKg == null || kg === nativeKg, 'Issued kg must agree with the native quantity.');
    ensure((!measuredMetres || nativeM != null || conversion) && (!measuredKg || nativeKg != null || conversion),
      'An additional unit measurement requires a weighing or length conversion reference.', 422, 'conversion');
    return { lot, qty, metres, kg, conversion: conversion || lot.eventId || lot.id };
  });
  Object.assign(b, { marker: structuredClone(marker), shadeGroup, plannedPlies, spreads: [], outputIds: [] });
  const checks = checkProcessScope(s, wo, b, rows, day, { material: () => 'Cut bundle' });
  return issueGarmentStock(s, ctx, b, rows, day, req(x.reference, 'Fabric issue slip'), checks);
}

export function recordCutSpread(s, x, ctx) {
  const b = openBatch(s, x.batchId, 'Cutting');
  ensure(!b.spreads.length, 'A completed spread is already recorded for this lay.');
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Spreading record');
  const requested = csvLines(x.rolls, 'Spread roll', 3, 4);
  const draws = stageDraws(s, b, requested.map(([id, qty]) => id + ',' + qty).join('\n'));
  const spreads = draws.map(({ line, lot, qty }, index) => {
    const [, , plies, offcuts] = requested[index];
    const layers = quantity(plies, 'Spread plies for ' + lot.id, 'pcs');
    const waste = quantity(offcuts || '0', 'Waste in the issued stock unit', line.unit, true);
    ensure(waste < qty, 'Roll waste must be below the actual spread usage.');
    const metres = line.metres == null ? null : round(line.metres * qty / line.issued);
    const kg = line.kg == null ? null : round(line.kg * qty / line.issued);
    ensure(metres == null || metres + 0.000001 >= layers * b.marker.metres, 'Measured fabric length is below marker length × actual plies on ' + lot.id + '.');
    return { lotId: lot.id, qty, unit: line.unit, plies: layers, metres, kg, waste, conversion: line.conversion };
  });
  ensure(sum(spreads, row => row.plies) <= b.plannedPlies, 'Spread plies exceed the approved lay.');
  b.spreads = spreads;
  b.status = 'In process';
  const event = post(s, 'Cut spreading', ctx, { ...garmentEvent(b), date: day, reference, spreads, operator: req(x.operator, 'Spreader'),
    shift: req(x.shift, 'Shift'), lotIds: spreads.map(row => row.lotId) });
  track(b, event, 'Spread', day);
  return b;
}

export function postCutBundles(s, x, ctx) {
  const b = openBatch(s, x.batchId, 'Cutting');
  const wo = batchWork(s, b);
  ensure(b.spreads.length && !b.outputIds.length, 'Record the actual spread first, then post this lay’s bundles once.');
  const day = postingDate(b, x.date);
  const reference = batchReference(s, b, x.reference, 'Bundle numbering or cut report');
  const limit = sum(b.spreads, row => row.plies) * b.marker.setsPerPly;
  const drawn = new Map();
  const ranges = new Map();
  const rows = csvLines(x.bundles, 'Cut bundle', 5).map(([lotId, position, first, last, quantities]) => {
    const part = b.marker.parts.find(p => norm(p.name) === norm(position));
    ensure(part, 'Unknown panel position ' + position + ' for this marker.');
    const start = quantity(first, 'First panel number', 'pcs');
    const end = quantity(last, 'Last panel number', 'pcs');
    const earlier = ranges.get(part.name) ?? [];
    ensure(end >= start && end <= limit * part.repeats && earlier.every(r => end < r.start || start > r.end),
      'Panel numbering exceeds the approved lay or overlaps an earlier bundle.');
    earlier.push({ start, end });
    ranges.set(part.name, earlier);
    const sources = quantities.split('+').map(entry => {
      const split = entry.lastIndexOf(':');
      const roll = b.spreads.find(row => row.lotId === entry.slice(0, split).trim());
      ensure(split > 0 && roll, 'Link each actual spread roll as roll ID:panel count.', 422, 'lot-link');
      const qty = quantity(entry.slice(split + 1), 'Panels from ' + roll.lotId, 'pcs');
      const index = JSON.stringify([roll.lotId, part.name]);
      const used = (drawn.get(index) || 0) + qty;
      ensure(used <= roll.plies * b.marker.setsPerPly * part.repeats, 'Panel output exceeds the approved lay quantity for ' + roll.lotId + ' / ' + part.name + '.');
      drawn.set(index, used);
      return { roll, qty };
    });
    ensure(new Set(sources.map(row => row.roll.lotId)).size === sources.length && sum(sources) === end - start + 1,
      'Roll panel quantities must add up to the numbered bundle.');
    return { id: lotKey(s, lotId), part, start, end, qty: end - start + 1, sources };
  });
  ensure(rows.length && new Set(rows.map(row => norm(row.id))).size === rows.length, 'Enter each numbered bundle once.');
  const sets = Math.min(...b.marker.parts.map(p => Math.floor(sum(rows.filter(row => row.part === p)) / p.repeats)));
  ensure(wo.completedQty + sets <= wo.plannedQty, 'Cut output exceeds the released work order plan.');
  const sources = b.spreads.map(row => ({ lot: record(s.lots, row.lotId, 'spread roll'), qty: row.qty }));
  for (const { lot } of sources) checkHistory(s, lot);
  const checks = checkProcessScope(s, wo, b, [{ lot: sources[0].lot, qty: sets || sum(rows) }], day,
    { consume: true, material: () => 'Cut bundle' });
  const dest = location(s, b.locationId);
  const areaWeighted = b.marker.parts.every(p => p.area != null);
  const basis = sum(b.marker.parts, p => p.repeats * (areaWeighted ? p.area : 1));
  const lots = rows.map(row => {
    const parents = row.sources.map(({ roll, qty }) => {
      const fraction = qty * (areaWeighted ? row.part.area : 1) / (roll.plies * b.marker.setsPerPly * basis);
      return { id: roll.lotId, qty: round(roll.qty * fraction), unit: roll.unit, panels: qty,
        netKg: roll.kg == null ? null : round(roll.kg * fraction * (1 - roll.waste / roll.qty)), metres: roll.metres == null ? null : round(roll.metres * fraction) };
    });
    const allocation = lotAllocations(s, '', 'pcs', row.qty, wo.lineId);
    return newLot(s, row.id, row.qty, 'pcs', day, dest, {
      material: 'Cut bundle', stage: 'Cutting', label: b.marker.component + ' · ' + row.part.name, batchId: b.id, workOrderId: wo.id,
      qualityStatus: 'Released', ownerId: b.ownerId, scheme: wo.scheme, additionalSchemes: wo.additionalSchemes, checks,
      composition: [...new Set(parents.map(p => ref(s.lots, p.id)?.composition).filter(Boolean))].join(' / '),
      parents, allocations: allocation, allocationBalance: structuredClone(allocation),
      netKg: parents.every(p => p.netKg != null) ? sum(parents, p => p.netKg) : null,
      panel: { layId: b.id, layNumber: b.number, marker: b.marker.code + ' r' + b.marker.version, lineId: wo.lineId, component: b.marker.component,
        position: row.part.name, size: b.marker.size, colour: b.marker.colour, shadeGroup: b.shadeGroup, first: row.start, last: row.end,
        routeId: b.marker.componentRouteId, method: areaWeighted ? 'Approved pattern area share' : 'Panel count share' },
    });
  });
  const moves = drawGarmentStock(b, b.spreads.map(row => ({ line: b.lines.find(line => line.lotId === row.lotId), qty: row.qty })));
  const event = post(s, 'Production', ctx, {
    ...garmentEvent(b), date: day, reference, type: 'Run', output: lots[0].id, lotIds: lots.map(lot => lot.id), qty: sum(lots), unit: 'pcs',
    inputs: b.spreads.map(r => ({ id: r.lotId, qty: r.qty, unit: r.unit, kg: r.kg, metres: r.metres, waste: r.waste, plies: r.plies })),
    allocations: lotAllocations(s, '', 'pcs', sum(lots), wo.lineId), checks,
    reconciliation: { unit: 'pcs', accepted: sum(lots), waste: 0, rejects: 0 },
    cut: { garmentSets: sets, unusedPanelCapacity: limit * sum(b.marker.parts, p => p.repeats) - sum(lots), wasteByRoll: b.spreads.map(({ lotId, waste, unit }) => ({ lotId, waste, unit })) },
    moves: [...moves, ...lots.map(lot => stockMove(lot, lot.qty))],
  });
  for (const lot of lots) lot.eventId = event.id;
  wo.completedQty += sets;
  wo.status = wo.completedQty === wo.plannedQty ? 'Completed' : 'In progress';
  b.outputIds = event.lotIds;
  b.actualSets = sets;
  track(b, event, 'Cut output', day);
  if (b.lines.every(line => !lineRemaining(line))) b.status = 'Closed';
  return b;
}

export const returnCutRemnants = (s, x, ctx) => returnGarmentStock(s, x, ctx, 'Cutting', (b, lotId) =>
  b.outputIds.length ? 0 : b.spreads.find(row => row.lotId === lotId)?.qty || 0);
