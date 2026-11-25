import { csvLines, ensure, lock, norm, quantity, record, ref, req } from './model.js';
import { schemesOf } from './commerce.js';
import { checkEvidence, checkLotClaims } from './standards.js';
import { checkClaimRules, componentCodes } from './claim-scope.js';
import { usable, takeStock, stockMove } from './stock.js';
import { wipMove } from './process-batch.js';

export const processStockMove = (batch, lotId, qty) => batch.jobId
  ? { lotId, qty, unit: batch.unit, location: batch.site, custody: batch.processor }
  : wipMove(batch, lotId, qty, batch.unit);

export function checkProcessScope(s, wo, batch, lots, day, options = {}) {
  const { consume = false, chemicals = [], noChemicals = false, requireChemicalDeclaration = false, material = lot => lot.material } = options;
  const line = ref(s.lines, wo.lineId);
  const holder = batch.processor || s.settings.name;
  return lots.flatMap(({ lot, qty }) => [
    ...checkEvidence(s, {
      schemes: schemesOf(wo), role: 'Processor', name: holder, partyId: batch.processorId, site: batch.site,
      operation: wo.stage, material: material(lot), on: day, amount: qty, unit: batch.unit,
      subject: line?.sku || ref(s.items, lot.itemId)?.code, planning: !consume, consume,
      tx: { seller: s.settings.name, buyer: holder, shipment: batch.challan || batch.number },
    }),
    ...checkClaimRules(s, {
      lineIds: [wo.lineId], operation: wo.stage, holder, site: batch.site, itemId: lot.itemId, on: day,
      components: componentCodes(s, [lot]), chemicals, noChemicals, requireChemicalDeclaration,
    }),
  ]);
}

export function verifyProcessEvidence(s, checks) {
  for (const decision of checks) for (const evidence of decision.evidence ?? []) {
    lock(ref(s.evidence, evidence.id)?.status === 'Verified', 'Evidence ' + evidence.number + ' is no longer verified.');
  }
}

export function readProcessChemicals(s, batch, x, day, needs, requireDeclaration = true, materials = ['Chemical']) {
  const rows = csvLines(x.chemicals, 'Chemical issue', batch.jobId ? 3 : 2);
  const noChemicals = x.noChemicals === 'yes';
  ensure(!rows.length || !noChemicals, 'Enter the chemical lots or confirm that the operation used no chemicals.');
  ensure(!requireDeclaration || rows.length || noChemicals, 'Enter the chemical lots or confirm that the operation used no chemicals.');
  const chemicals = rows.map(([code, refOrQty, outsideQty]) => {
    if (batch.jobId) {
      const item = s.items.find(row => materials.includes(row.type) && norm(row.code) === norm(code));
      ensure(item, 'Use a ' + materials.join(', ') + ' item code from Company masters for ' + code + '.');
      return { itemId: item.id, material: item.type, code: item.code, lotRef: req(refOrQty, 'Processor material lot'), qty: quantity(outsideQty, 'Material quantity', item.unit),
        unit: item.unit, external: true };
    }
    const lot = record(s.lots, code, 'chemical lot ' + code);
    ensure(materials.includes(lot.material) && lot.site === batch.site && (!lot.ownerId || lot.ownerId === batch.ownerId), 'Use a compatible supply lot at the operation site.');
    usable(s, lot, day);
    checkLotClaims(s, lot, needs, true);
    return { itemId: lot.itemId, material: lot.material, code: ref(s.items, lot.itemId)?.code || lot.id, lotRef: lot.id, lotId: lot.id,
      qty: quantity(refOrQty, 'Chemical quantity for ' + lot.id, lot.unit), unit: lot.unit, external: false };
  });
  ensure(new Set(chemicals.map(row => JSON.stringify([row.itemId, norm(row.lotRef)]))).size === chemicals.length, 'Enter each chemical lot once per operation.');
  return chemicals;
}

export function issueProcessChemicals(s, chemicals, day, lineId) {
  return chemicals.filter(row => !row.external).map(row => {
    const lot = record(s.lots, row.lotId, 'chemical lot');
    row.allocations = takeStock(lot, row.qty, day, new Set([lineId]));
    return stockMove(lot, -row.qty);
  });
}
