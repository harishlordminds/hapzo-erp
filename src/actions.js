import { req, ensure } from './model.js';
import * as commerce from './commerce.js';
import * as stock from './stock.js';
import * as production from './production.js';
import * as standards from './standards.js';
import * as fulfilment from './fulfilment.js';
import * as passports from './passports.js';
import * as finance from './finance.js';
import { PO_IMPORT_ACTION } from './po-import.js';
import { addClaimRule, releaseProductClaim } from './claim-scope.js';
import { approveComponentRoute } from './routes.js';
import * as dyeing from './yarn-dyeing.js';
import * as fibre from './fibre.js';
import * as spin from './spinning.js';
import { assignYarn } from './yarn-allocation.js';
import * as knit from './knitting.js';
import * as weave from './weaving.js';
import * as fd from './fabric-dyeing.js';
import { finishing, finishPlan, finishIssue, finishReturn, finishRolls } from './fabric-finishing.js';
import { washRecipe, washLoad, washCycle, washOutput } from './washing.js';
import { approvePrintArtwork, issuePrintBatch, recordPrintOperation, receivePrintOutput } from './printing.js';
import { approveMarker, openCutLay, recordCutSpread, postCutBundles, returnCutRemnants } from './cutting.js';
import { approveGarmentPlan, issueGarmentBatch, transferGarmentLine, recordGarmentOperation, postGarmentOutput, returnGarmentInputs } from './garment-production.js';
import { approvePackingPlan, packCarton } from './packing.js';

const definitions = {};
function add(roles, methods) {
  for (const [name, run] of Object.entries(methods)) definitions[name] = { roles: ['Admin', ...roles], run };
}
add([], { settings: commerce.saveSettings, 'po-number-reader': commerce.savePoNumberReader, 'master-delete': commerce.deleteMaster });
add(['Merchandising'], {
  'buyer-order': commerce.newOrder, 'po-buyer-create': commerce.createPoBuyer, 'link-order-buyer': commerce.linkOrderBuyer, 'po-revision': commerce.orderRevision,
  'po-line': commerce.newLine, 'approve-line': commerce.approveLine, 'revise-line': commerce.reviseLine,
  'garment-spec': commerce.saveGarmentSpec, [PO_IMPORT_ACTION]: commerce.importBuyerPo, 'garment-import-draft': commerce.saveImportDraft,
});
add(['Merchandising', 'Stores'], { 'party-master': commerce.saveParty, 'item-master': commerce.saveItem, quotation: commerce.quotation, requisition: commerce.requisition });
add(['Stores'], {
  'location-master': commerce.saveLocation, purchase: commerce.purchaseOrder, receipt: stock.receive,
  reservation: stock.reserveStock, transfer: stock.transfer,
});
add(['Stores', 'Quality'], { disposal: stock.dispose, 'stock-count': stock.adjustStock });
add(['Production'], {
  'route-master': commerce.saveRoute, 'machine-master': commerce.saveMachine, 'work-order': production.releaseWork,
  'work-close': production.closeWork, production: production.production, meter: production.meterReading,
  maintenance: production.maintenance,
  'dye-setup': dyeing.dyeSetup, 'dye-batch': dyeing.dyeBatch, 'dye-entry': dyeing.dyeEntry, 'dye-output': dyeing.dyeOutput,
  'dye-close': dyeing.dyeClose, 'dye-reverse': dyeing.dyeReverse,
});
add(['Production', 'Merchandising'], { 'component-route': approveComponentRoute });
add(['Production', 'Stores'], { 'dye-issue': dyeing.dyeIssue, 'dye-return': dyeing.dyeReturn, 'yarn-assign': assignYarn });
add(['Stores', 'Logistics'], { 'dye-deliver': dyeing.dyeDeliver });
add(['Stores'], { 'seed-inward': fibre.seedInward, 'bale-inward': fibre.baleInward });
add(['Production'], {
  'fibre-config': fibre.fibreConfig, 'fibre-setup': fibre.fibreSetup,
  'gin-run': fibre.ginning.open, 'gin-entry': fibre.ginning.entry, 'gin-output': fibre.ginOutput, 'gin-close': fibre.ginning.close, 'gin-reverse': fibre.ginning.reverse,
  'blend-open': fibre.preparation.open, 'blend-entry': fibre.preparation.entry, 'blend-output': fibre.preparation.output,
  'blend-close': fibre.preparation.close, 'blend-reverse': fibre.preparation.reverse,
});
add(['Production'], {
  'spin-config': spin.spinConfig, 'spin-setup': spin.spinSetup, 'spin-open': spin.spinning.open, 'spin-entry': spin.spinning.entry,
  'spin-output': spin.spinOutput, 'spin-close': spin.spinning.close, 'spin-reverse': spin.spinning.reverse,
});
add(['Production'], {
  'knit-machine': knit.knitMachine, 'knit-setup': knit.knitSetup, 'knit-open': knit.knitting.open, 'knit-entry': knit.knitting.entry,
  'knit-output': knit.knitOutput, 'knit-close': knit.knitting.close, 'knit-reverse': knit.knitting.reverse,
});
add(['Production'], {
  'loom-setup': weave.loomSetup, 'weave-setup': weave.weaveSetup,
  'warp-open': weave.warping.open, 'warp-entry': weave.warping.entry, 'warp-beams': weave.warpBeams, 'warp-close': weave.warping.close, 'warp-reverse': weave.warping.reverse,
  'size-open': weave.sizing.open, 'size-entry': weave.sizing.entry, 'size-beams': weave.sizeBeams, 'size-close': weave.sizing.close, 'size-reverse': weave.sizing.reverse,
  'beam-dress': weave.dressBeam, 'weft-prep': weave.prepareWeft,
  'loom-open': weave.weaving.open, 'loom-entry': weave.weaving.entry, 'loom-roll': weave.loomRoll, 'loom-close': weave.weaving.close, 'loom-reverse': weave.weaving.reverse,
});
add(['Stores'], { 'fabric-inward': fd.fabricInward });
add(['Production'], {
  'fdye-setup': fd.fdSetup, 'fdye-open': fd.fabricDyeing.open, 'fdye-entry': fd.fabricDyeing.entry, 'fdye-rolls': fd.fdRolls,
  'fdye-close': fd.fabricDyeing.close, 'fdye-reverse': fd.fabricDyeing.reverse,
});
add(['Production', 'Stores'], { 'fdye-issue': fd.fabricDyeing.issue, 'fdye-return': fd.fabricDyeing.returnUnused });
add(['Production'], {
  'finish-plan': finishPlan, 'finish-order': production.releaseFinishWork, 'finish-open': finishing.open,
  'finish-entry': finishing.entry, 'finish-rolls': finishRolls, 'finish-close': finishing.close, 'finish-reverse': finishing.reverse,
});
add(['Production', 'Stores'], { 'finish-issue': finishIssue, 'finish-return': finishReturn });
add(['Stores', 'Logistics'], { 'fdye-deliver': fd.fdDeliver });
add(['Production', 'Stores'], {
  'warp-issue': weave.warping.issue, 'warp-return': weave.warping.returnUnused, 'size-issue': weave.sizing.issue, 'size-return': weave.sizing.returnUnused,
  'loom-issue': weave.weaving.issue, 'loom-return': weave.weaving.returnUnused,
});
add(['Production', 'Stores'], { 'knit-issue': knit.knitting.issue, 'knit-return': knit.knitting.returnUnused });
add(['Production', 'Stores'], { 'spin-issue': spin.spinning.issue, 'spin-return': spin.spinning.returnUnused });
add(['Production', 'Stores'], {
  'gin-issue': fibre.ginning.issue, 'gin-return': fibre.ginning.returnUnused, 'blend-issue': fibre.preparation.issue, 'blend-return': fibre.preparation.returnUnused,
});
add(['Production', 'Stores'], { 'job-out': production.openJob, 'job-return': production.jobReturn });
add(['Production'], { 'wash-recipe': washRecipe, 'wash-cycle': washCycle });
add(['Production', 'Stores'], { 'wash-load': washLoad, 'wash-output': washOutput });
add(['Production', 'Merchandising'], { 'print-artwork': approvePrintArtwork });
add(['Production'], { 'print-order': production.releasePrintWork, 'print-operation': recordPrintOperation });
add(['Production', 'Stores'], { 'print-issue': issuePrintBatch, 'print-output': receivePrintOutput });
add(['Production', 'Merchandising'], { 'cut-marker': approveMarker, 'garment-plan': approveGarmentPlan });
add(['Production'], { 'cut-spread': recordCutSpread, 'cut-bundles': postCutBundles, 'garment-operation': recordGarmentOperation, 'garment-output': postGarmentOutput });
add(['Production', 'Stores'], { 'cut-lay': openCutLay, 'cut-return': returnCutRemnants, 'garment-issue': issueGarmentBatch,
  'garment-line-transfer': transferGarmentLine, 'garment-return': returnGarmentInputs });
add(['Quality'], { quality: stock.inspect });
add(['Logistics'], { dispatch: fulfilment.dispatch, delivery: fulfilment.confirmDelivery, 'customer-return': fulfilment.customerReturn });
add(['Logistics', 'Merchandising'], { 'packing-plan': approvePackingPlan });
add(['Logistics', 'Stores', 'Production'], { 'pack-carton': packCarton });
add(['Finance'], {
  invoice: fulfilment.issueInvoice, cost: fulfilment.addCost,
  'account-new': finance.newAccount, 'account-edit': finance.editAccount,
  'account-opening': finance.recordOpening, 'account-opening-bill': finance.openingBill,
  'account-erp-sales': (s, x, ctx) => finance.accountingInvoice(s, { ...x, kind: 'Sales' }, ctx),
  'account-erp-purchase': (s, x, ctx) => finance.accountingInvoice(s, { ...x, kind: 'Purchase' }, ctx),
  'account-cogs': finance.postCogs,
  'account-bill': finance.manualBill, 'account-settle': finance.settleBill, 'account-cash': finance.cashEntry,
  'account-journal': finance.journal, 'account-reverse': finance.reverseVoucher,
});
add(['Compliance'], {
  evidence: standards.addEvidence, 'review-evidence': standards.reviewEvidence,
  policy: standards.addPolicy, 'claim-credit': standards.addCredit, 'release-standard': stock.releaseStandard,
  'claim-rule': addClaimRule, 'claim-release': releaseProductClaim,
  'verify-meter': production.verifyReading, passport: passports.newPassport, 'passport-point': passports.editPoint,
  'passport-assess': passports.assessRemaining, 'passport-status': passports.passportStatus,
  'dpp-profile': passports.approveDppProfile, 'passport-profile': passports.applyPassportProfile,
});
export const permitted = role => Object.keys(definitions).filter(name => definitions[name].roles.includes(role));

export function execute(s, name, data, ctx) {
  const definition = Object.hasOwn(definitions, name) ? definitions[name] : null;
  ensure(definition, 'Unknown transaction.', 404, 'not-found');
  ensure(definition.roles.includes(ctx.role), 'Your workspace role cannot post this transaction.', 403, 'role');
  ensure(data && typeof data === 'object' && !Array.isArray(data), 'Transaction fields are required.');
  for (const value of Object.values(data)) {
    ensure(value === null || ['string', 'number', 'boolean'].includes(typeof value), 'Transaction fields must be plain values.');
  }
  return definition.run(s, data, {
    ...ctx, checkSupply: standards.checkSupply, checkHistory: standards.checkHistory,
    newReturnLot: (s, x, source, qty, day, dest) => stock.newLot(s, stock.lotKey(s, x.outputId), qty, source.unit, day, dest, {
      itemId: source.itemId, material: source.material, label: source.label, ownerId: source.ownerId, stage: 'Customer return',
      scheme: source.scheme, additionalSchemes: source.additionalSchemes, composition: source.composition,
      parents: [{ id: source.id, qty, unit: source.unit }],
      netKg: source.netKg ? stock.inUnit(source, qty, 'kg') : null,
      lengthM: source.lengthM ? stock.inUnit(source, qty, 'm') : null,
    }),
  });
}
