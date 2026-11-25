import { randomBytes, createHash } from 'node:crypto';
import { blank, today, DPP_FIELDS, round, sum } from './model.js';
import { fabricSpecInput } from './fabric.js';
import { execute } from './actions.js';

export function demo() {
  const s = blank({ name: 'HAPZO Training Mill', address: 'Example industrial estate, Tamil Nadu' });
  const day = today();
  const ctx = { role: 'Admin', actor: 'sample', at: new Date().toISOString(), document: () => null,
    publicToken: () => randomBytes(24).toString('base64url'), digest: obj => createHash('sha256').update(JSON.stringify(obj)).digest('hex') };
  const run = (action, input) => execute(s, action, { date: day, ...input }, ctx);
  const master = (code, type, name) => run('party-master', { code, type, name, currency: 'INR', shipTo: 'Demo distribution centre', terms: 'Net 30' });
  const buyer = master('DEMO-BUY', 'Buyer', 'Demo Retail');
  const supplier = master('DEMO-SUP', 'Supplier', 'Example Fibre Supply');
  const processor = master('DEMO-JOB', 'Processor', 'Example Dye House');
  const loc = run('location-master', { code: 'MAIN', site: 'Decaste Mill', warehouse: 'Production and stores', bin: 'A01' });
  const warehouse = run('location-master', { code: 'FG', site: 'Decaste Mill', warehouse: 'Finished goods', bin: 'FG01' });
  const own = { locationId: loc.id, supplierId: supplier.id, origin: 'Example spinning and ginning site' };
  const item = (code, name, type, unit, composition = '') => run('item-master', { code, name, type, unit, composition });
  const fibre = item('COT-001', 'Cotton fibre', 'Cotton fibre', 'kg', '100% cotton');
  const carton = item('CTN-001', 'Shipping carton', 'Carton', 'carton');
  const yarn = item('YRN-001', 'Undyed yarn', 'Yarn', 'kg', '100% cotton');
  const chemical = item('DYE-001', 'Navy dye', 'Chemical', 'kg');
  const machine = run('machine-master', { code: 'LOOM-1', name: 'Rapier loom 1', locationId: loc.id, status: 'In service', device: 'METER-L1' });
  const order = run('buyer-order', { po: 'DC-26018', buyerId: buyer.id, kind: 'Goods' });
  const line = run('po-line', {
    orderId: order.id, style: 'Cotton poplin shirt', color: 'Navy', size: 'M', sku: 'POP-NVY-M', qty: '460', unit: 'pcs',
    route: 'Fabric-dyed woven', product: 'Packed carton', scheme: 'Conventional', price: '500', delivery: day,
    specRev: 'S03', approvedSpec: 'Navy plain weave shirt. 120 GSM. Measurements and trims per training job sheet.',
    composition: '100% cotton', gsm: '120', bomRev: 'B03', bom: 'COT-001,0.65\nCTN-001,0.004348',
    fabricType: 'Woven', fabricStructure: 'Plain weave', fabricCondition: 'Finished', countUnit: 'Ne',
    warpThreads: '124', weftThreads: '72', warpCount: '40', weftCount: '40', warpCrimp: '6', weftCrimp: '3',
    fabricTolGsm: '5%', fabricTolEpi: '3', fabricTolPpi: '3', fabricTolWarpCount: '5%', fabricTolWeftCount: '5%',
    costRev: 'C03', materials: '120000', labour: '32000', processing: '18000', overhead: '8000',
  });
  run('garment-spec', { lineId: line.id, specRev: 'S03', techPack: JSON.stringify({
    category: 'Poplin shirt', fit: 'Regular fit', patternRef: 'PAT-POP-M-03', sampleRef: 'PP-POP-03',
    measurementStage: 'Laid flat after conditioning', measurementUnit: 'cm', baseSize: 'M', cartonCapacity: 230, garmentLoss: 2,
    packaging: 'Fold as approved, apply a size label, and record the carton label against the shipment.',
    fabrics: [{ code: 'SHELL', role: 'Shell', description: 'Navy cotton poplin', construction: fabricSpecInput(line.fabricSpec),
      blend: 'Cotton,100', colourRef: 'Buyer navy swatch NAVY-03', labDip: 'LD-26018-03',
      warpGround: '40 Ne single, combed cotton warp', weftPlating: '40 Ne single cotton weft', finish: 'Training soft finish',
      grossWidth: 150, usableWidth: 147, usableTolerance: '2', pattern: 'Front,2,3150\nBack,1,4200\nSleeve,2,1200\nCollar,1,100',
      markerEfficiency: 82, extraLoss: 3, washMethod: 'AATCC TM135, buyer-approved training condition', lengthShrink: 3, widthShrink: 2 }],
    poms: [{ code: 'CHEST', name: 'Half chest', target: 54, tolerance: '1', method: 'Measure straight across, 2.5 cm below the armhole.' },
      { code: 'BODY', name: 'Body length', target: 70, tolerance: '1', method: 'Measure from high shoulder point to bottom hem.' }],
    operations: [{ operation: 'Side seam', seam: 'Superimposed seam', stitch: '301 lockstitch', allowance: 10, stitches: 24, span: 5.08 }],
    trims: [{ itemId: carton.id, basis: 'Per carton', per: 1, description: 'Training export carton' }],
    tests: [{ code: 'SHRINK-L', name: 'Length shrinkage', scope: 'SHELL', method: 'AATCC TM135', unit: '%', min: -2, max: 4 }],
  }) });
  run('approve-line', { lineId: line.id, notes: 'Approved sample for training.' });
  const req = run('requisition', { itemId: fibre.id, lineId: line.id, qty: '300', required: day, notes: 'Fibre for demo order' });
  const po = run('purchase', { supplierId: supplier.id, locationId: loc.id, supplierSite: own.origin, number: 'SUP-001', lines: 'COT-001,300,140,' + req.id });
  const inspect = (lot, result = 'Released') => run('quality', {
    lotId: lot.id, decision: result, reference: 'QC-' + lot.id, result: 'Training inspection result',
    ...(lot.id === 'FAB-1002' ? {
      fabricType: 'Woven', fabricStructure: 'Plain weave', swatchMassG: '1.21', swatchAreaCm2: '100',
      warpThreads: '124', weftThreads: '72', countUnit: 'Ne', warpCount: '40', weftCount: '40',
      techInspection: JSON.stringify({ target: line.id + '|1|SHELL', actual: { 'width-usable': '147', 'test-SHRINK-L': '3' } }),
    } : {}),
  });
  const receive = (lotId, itemId, qty, additional = {}) => {
    const lot = run('receipt', { ...own, lotId, itemId, qty: String(qty), reference: 'GRN-' + lotId, ...additional });
    if (!lot.standardHold) inspect(lot);
    return lot;
  };
  const opening = { purchaseId: po.id, purchaseLineId: po.lines[0].id, originCountry: 'India' };
  receive('FIB-001', fibre.id, 250, opening);
  receive('FIB-002', fibre.id, 50, opening);
  receive('PKG-001', carton.id, 2);
  receive('CHEM-001', chemical.id, 5);
  receive('YRN-HOLD-01', yarn.id, 50, { scheme: 'GOTS' });
  run('reservation', { lotId: 'FIB-001', lineId: line.id, qty: '240' });
  const reading = run('meter', { machineId: machine.id, reference: 'DEMO-LOOM-METER-01', unit: 'kWh', qty: '42', method: 'Dedicated meter difference for the training weaving run' });
  run('verify-meter', { readingId: reading.id, reference: 'Demo meter log' });
  const process = (stage, inputs, outputId, qty, waste, more = {}) => {
    const wo = run('work-order', { number: 'WO-' + outputId, stage, plannedQty: String(qty),
      unit: more.unit || 'kg', locationId: loc.id, lineId: line.id, recipe: more.recipe || '',
      techComponent: ['Weaving', 'Fabric dyeing', 'Fabric finishing', 'Fabric inspection'].includes(stage) ? 'SHELL' : '' });
    const out = run('production', { workOrderId: wo.id, inputs, outputId, outputQty: String(qty), waste: String(waste),
      reference: 'RUN-' + outputId, labourHours: '1', ...more });
    if (out.qualityStatus !== 'Released') inspect(out);
    return out;
  };
  process('Fibre preparation', 'FIB-001,250\nFIB-002,50', 'BLEND-01', 293, 7);
  process('Spinning', 'BLEND-01,293', 'YRN-1001', 285, 8, { itemId: yarn.id, electricity: '105' });
  process('Warping', 'YRN-1001,120', 'WRP-1001', 118, 2);
  process('Weaving', 'WRP-1001,118\nYRN-1001,162', 'GRG-1001', 270, 10, { machineId: machine.id, readingId: reading.id, machineHours: '8', lengthM: '1380' });
  process('Fabric dyeing', 'GRG-1001,270\nCHEM-001,1', 'DYE-1001', 265, 5, { recipe: 'Recipe NAVY-03', electricity: '82', water: '1500' });
  process('Fabric finishing', 'DYE-1001,265', 'FAB-1001', 260, 5, { lengthM: '1310' });
  process('Fabric inspection', 'FAB-1001,260', 'FAB-1002', 258, 2, { lengthM: '1300' });
  for (const branch of ['01', '02']) {
    const suffix = '26018-' + branch;
    const count = { unit: 'pcs', netKg: '46' };
    process('Cutting', 'FAB-1002,50', 'CUT-' + suffix, 230, 4, { ...count, balanceUnit: 'kg' });
    process('Stitching', 'CUT-' + suffix + ',230', 'SEW-' + suffix, 230, 0, count);
    process('Garment QC', 'SEW-' + suffix + ',230', 'GQC-' + suffix, 230, 0, count);
    process('Garment finishing', 'GQC-' + suffix + ',230', 'FIN-' + suffix, 230, 0, count);
    process('Final inspection', 'FIN-' + suffix + ',230', 'REL-' + suffix, 230, 0, count);
    process('Packing', 'REL-' + suffix + ',230\nPKG-001,1', 'CTN-' + suffix, 230, 0, count);
    run('transfer', { lotId: 'CTN-' + suffix, qty: '230', locationId: warehouse.id, reference: 'FG-' + suffix });
    const sh = run('dispatch', { number: 'SHP-' + suffix, items: 'CTN-' + suffix + ',' + line.id + ',230', mode: 'Export',
      carrier: 'Example Logistics', originPort: 'Chennai', destinationPort: 'Rotterdam', tracking: 'AWB-' + suffix });
    const invoice = run('invoice', { shipmentId: sh.id, number: 'INV-' + suffix, taxRef: 'Training data' });
    run('account-erp-sales', { sourceId: invoice.id });
  }
  const cost = run('cost', { lotId: 'FIB-001', category: 'Material', reference: 'SUP-BILL-001', net: '35000', cgst: '875', sgst: '875', credit: '1750', itcStatus: 'Eligible' });
  run('account-erp-purchase', { sourceId: cost.id });
  run('evidence', { scheme: 'GOTS', kind: 'Scope certificate', role: 'Supplier', partyId: supplier.id, site: own.origin,
    number: 'DEMO-GOTS-01', issuer: 'Example issuer', issue: day, until: day, operations: 'Supply', materials: 'Yarn' });
  receive('YRN-JOB-01', yarn.id, 1000);
  const outside = run('job-out', { lotId: 'YRN-JOB-01', processorId: processor.id, site: 'Example dye site', security: '', stage: 'Yarn dyeing', qty: '600', number: 'CH-26001' });
  for (const [outputId, out] of [['YRN-JOB-DYED-01', '300'], ['YRN-JOB-DYED-02', '270']]) {
    const returned = run('job-return', { jobId: outside.id, kind: 'Processed return', used: out, outputQty: out, unit: 'kg', outputId, locationId: loc.id, reference: 'RET-' + outputId });
    inspect(returned);
  }
  run('job-return', { jobId: outside.id, kind: 'Unused return', used: '20', outputId: 'YRN-JOB-UNUSED', locationId: loc.id, reference: 'RET-UNUSED' });
  run('job-return', { jobId: outside.id, kind: 'Process loss', used: '10', locationId: loc.id, reference: 'RET-LOSS' });
  yarnDyeingSample(run, { buyer, loc, inspect });
  fibreSample(run, { loc, inspect });
  spinningSample(run, { buyer, loc, inspect });
  colourSplitSample(run, { loc, inspect, supplier });
  knittingSample(run, { buyer, loc, inspect });
  weavingSample(run, { buyer, loc, inspect, supplier });
  fabricDyeingSample(run, { loc, inspect, supplier });
  const demoProfile = run('dpp-profile', { code: 'DEMO-GARMENT', version: '1', product: 'Garment', market: 'Training pilot', reference: 'HAPZO demonstration profile' });
  const draft = run('passport', { lotId: 'CTN-26018-01', profileId: demoProfile.id, boundary: 'Electricity and water from linked training runs', factor: '0.71',
    factorRef: 'Training factor and meter examples', compositionSource: 'Approved demo specification S03' });
  for (const p of draft.points.filter(p => p.applicability === 'Applicable' && !p.verified)) {
    run('passport-point', { passportId: draft.id, point: p.number, applicability: 'Applicable', value: p.value, source: p.source || 'Training records',
      visibility: [22, 33, 34].includes(p.number) ? 'Public' : 'Internal', verified: 'yes' });
  }
  run('passport-assess', { passportId: draft.id, reason: 'Outside the training profile. Assess the live product separately.' });
  run('passport-status', { passportId: draft.id, mode: 'Submit' });
  run('passport-status', { passportId: draft.id, mode: 'Publish' });
  return s;
}

// Yarn dyeing on approved route B for a yarn-dyed check fabric: partial outputs, a cone conversion,
// an unused return and a measured loss at closure. The next route step consumes the first output.
function yarnDyeingSample(run, { buyer, loc, inspect }) {
  const day = today();
  const item = (code, name, type, unit, composition = '') => run('item-master', { code, name, type, unit, composition });
  const cones = item('YRN-CONE', 'Undyed 30s combed yarn on cones', 'Yarn', 'cone', '100% cotton');
  const dyed = item('DYN-RED', 'Dyed yarn red', 'Dyed yarn', 'kg', '100% cotton');
  item('FAB-YDCHK', 'Yarn-dyed check fabric', 'Finished fabric', 'm', '100% cotton');
  const chemicals = [['RDYE-01', 'Reactive red dye'], ['SALT-01', 'Glauber salt'], ['SOAP-01', 'Soaping agent']]
    .map(([code, name]) => item(code, name, 'Chemical', 'kg'));
  const machine = run('machine-master', { code: 'HTHP-1', name: 'Package dyeing machine 1', locationId: loc.id, status: 'In service', device: 'METER-HT1' });
  const supplier = run('party-master', { code: 'DEMO-YRN', type: 'Supplier', name: 'Example Yarn Mills', currency: 'INR' });
  const order = run('buyer-order', { po: 'DC-26031', buyerId: buyer.id, kind: 'Goods' });
  const line = run('po-line', {
    orderId: order.id, style: 'Yarn-dyed check shirt', color: 'Red check', size: 'M', sku: 'YDC-RED-M', qty: '230', unit: 'pcs',
    route: 'Yarn-dyed woven', product: 'Packed carton', scheme: 'Conventional', price: '540', delivery: day,
    specRev: 'S01', approvedSpec: 'Red yarn-dyed check shirt fabric, 30s warp and weft.', composition: '100% cotton',
    bomRev: 'B01', bom: 'FAB-YDCHK,1.6\nCTN-001,0.004348', costRev: 'C01',
  });
  run('approve-line', { lineId: line.id, notes: 'Approved yarn-dyed sample.' });
  const receive = (lotId, itemId, qty, more = {}) => inspect(run('receipt', { lotId, itemId, qty: String(qty), locationId: loc.id,
    mode: 'Direct inward', supplierId: supplier.id, origin: 'Example yarn and chemical suppliers', reference: 'GRN-' + lotId, ...more }));
  receive('YRN-C-01', cones.id, 100, { netKg: '125' });
  receive('YRN-C-02', cones.id, 60);
  receive('CHEM-R-01', chemicals[0].id, 5);
  receive('CHEM-S-01', chemicals[1].id, 150);
  receive('CHEM-P-01', chemicals[2].id, 5);
  const recipe = run('dye-setup', { code: 'RED-R1', version: '1', shade: 'Red 18-1663', effective: day, liquorRatio: '8',
    chemicals: 'RDYE-01,0.02\nSALT-01,0.6\nSOAP-01,0.002', waterPerKg: '60', steamPerKg: '3', electricityPerKg: '1.2', yieldPct: '97',
    labourRate: '120', machineRate: '400', electricityRate: '9', waterRate: '40', steamRate: '2.5', wasteRate: '15',
    rateRef: 'Training rate card RC-2026-1', reference: 'Lab dip LD-26031 approved' });
  const route = run('component-route', { lineId: line.id, component: 'FAB-YDCHK', template: 'B', conditional: 'Sizing,Desizing', effective: day, reference: 'Route approval RA-26031' });
  const wo = run('work-order', { number: 'WO-YD-26031', stage: 'Yarn dyeing', lineId: line.id, componentRouteId: route.id, plannedQty: '190', unit: 'kg', locationId: loc.id, recipe: 'RED-R1 r1' });
  const batch = run('dye-batch', { workOrderId: wo.id, number: 'DYB-26031-01', machineId: machine.id, recipeId: recipe.id, plannedKg: '200' });
  run('dye-issue', { batchId: batch.id, lines: 'YRN-C-01,100\nYRN-C-02,60,74.5', conversionRef: 'Weighing slip WS-26031-01', reference: 'ISS-26031-01' });
  run('dye-entry', { batchId: batch.id, step: 'Dyeing', start: day + 'T06:00', end: day + 'T12:30', operator: 'Dye operator A', shift: 'A',
    temperature: '60', liquorRatio: '8', chemicals: 'CHEM-R-01,4\nCHEM-S-01,118', water: '9200', steam: '480', electricity: '190', labourHours: '6.5', reference: 'LOG-26031-01' });
  run('dye-entry', { batchId: batch.id, step: 'Soaping / washing', start: day + 'T12:30', end: day + 'T14:00', operator: 'Dye operator A', shift: 'A',
    temperature: '95', chemicals: 'CHEM-P-01,0.4', water: '3100', steam: '120', electricity: '45', labourHours: '1.5', reference: 'LOG-26031-02' });
  const first = run('dye-output', { batchId: batch.id, outputId: 'DY-RED-01', outputQty: '100', unit: 'kg', itemId: dyed.id, waste: '1.5',
    reference: 'UNL-26031-01', operator: 'Dye operator B', shift: 'B' });
  run('dye-output', { batchId: batch.id, outputId: 'DY-RED-02', outputQty: '70', unit: 'cone', netKg: '88', waste: '1',
    reference: 'UNL-26031-02', operator: 'Dye operator B', shift: 'B' });
  run('dye-return', { batchId: batch.id, lines: 'YRN-C-02,2', reference: 'RET-26031-01' });
  run('dye-close', { batchId: batch.id, reason: 'Batch unloaded and reconciled.', lossConfirmed: 'yes', lossRef: 'Batch scale reconciliation BR-26031' });
  inspect(first);
  const warp = run('work-order', { number: 'WO-WRP-26031', stage: 'Warping', lineId: line.id, componentRouteId: route.id, plannedQty: '60', unit: 'kg', locationId: loc.id });
  run('production', { workOrderId: warp.id, inputs: 'DY-RED-01,60', outputId: 'BEAM-YD-01', outputQty: '59.4', waste: '0.6', reference: 'RUN-BEAM-YD-01' });
}

// Seed cotton is ginned into lint lot LINT-B. Purchased lint lot LINT-A arrives by bale.
// Blend BL-26-01 takes actual weights from both lots and hands one prepared fibre lot to spinning.
function fibreSample(run, { loc, inspect }) {
  const day = today();
  const item = (code, name, type) => run('item-master', { code, name, type, unit: 'kg', composition: '100% cotton' });
  const seedCotton = item('SEED-COT', 'Seed cotton (kapas)', 'Seed cotton');
  const lint = item('LINT-BALE', 'Lint cotton bale', 'Cotton bale');
  item('PREP-FIB', 'Prepared fibre for carding', 'Prepared fibre');
  const party = (code, name) => run('party-master', { code, type: 'Supplier', name, currency: 'INR' });
  const fpo = party('DEMO-FPO', 'Example Farmers Producer Company');
  const ginner = party('DEMO-GIN', 'Example Ginning and Pressing');
  const gin = run('machine-master', { code: 'GIN-1', name: 'Double roller gin line 1', locationId: loc.id, status: 'In service' });
  const blowroom = run('machine-master', { code: 'BR-1', name: 'Blowroom line 1', locationId: loc.id, status: 'In service' });
  run('fibre-config', { baleTracking: 'Bale lot', handoff: 'Blend lot', version: '1', effective: day, reference: 'Mill tracking policy MTP-01' });
  const seed = run('seed-inward', { lotId: 'SC-26-001', itemId: seedCotton.id, supplierId: fpo.id, grower: 'Example FPO member group 4', farmId: 'FPO-G4',
    origin: 'Rajkot district, Gujarat', originCountry: 'India', variety: 'Shankar-6', cropYear: '2026-27', locationId: loc.id,
    grossKg: '5400', tareKg: '1400', moisture: '8.5', trash: '3', weighbridgeRef: 'WB-26-0001', vehicle: 'GJ-03-0000' });
  inspect(seed);
  const ginPlan = run('fibre-setup', { process: 'Ginning', code: 'GP-S6', version: '1', variety: 'Shankar-6', effective: day, lintPct: '34', seedPct: '63', wastePct: '3',
    labourRate: '110', machineRate: '650', electricityRate: '9', rateRef: 'Gin rate card GR-2026', reference: 'Gin plan approval GPA-01' });
  const ginWo = run('work-order', { number: 'WO-GIN-26-01', stage: 'Ginning', plannedQty: '1400', unit: 'kg', locationId: loc.id });
  const ginRun = run('gin-run', { workOrderId: ginWo.id, number: 'GR-26-01', machineId: gin.id, recipeId: ginPlan.id, plannedKg: '4000' });
  run('gin-issue', { batchId: ginRun.id, lines: 'SC-26-001,4000', reference: 'GIN-ISS-01' });
  run('gin-entry', { batchId: ginRun.id, step: 'Ginning', start: day + 'T06:00', end: day + 'T14:00', operator: 'Gin operator A', shift: 'A',
    moisture: '7.5', electricity: '320', labourHours: '16', reference: 'GIN-LOG-01' });
  const lintB = run('gin-output', { batchId: ginRun.id, lotId: 'LINT-B', itemId: lint.id, seedLotId: 'CSEED-26-01', seedKg: '2510', waste: '130',
    bales: 'GB-001,170,172,3.9,29.5,29\nGB-002,171,173\nGB-003,169,171\nGB-004,170,172\nGB-005,170,172\nGB-006,171,173\nGB-007,169,171\nGB-008,170,172',
    reference: 'PRESS-26-01', operator: 'Press operator', shift: 'A' });
  inspect(lintB);
  run('gin-close', { batchId: ginRun.id, reason: 'Gin run pressed and reconciled.' });
  const lintA = run('bale-inward', { lotId: 'LINT-A', itemId: lint.id, supplierId: ginner.id, origin: 'Akola district, Maharashtra', originCountry: 'India',
    ginner: 'Example Ginning and Pressing, Akola', lotMark: 'AK-26-117', variety: 'MCU-5', cropYear: '2026-27', locationId: loc.id,
    bales: 'PB-101,172,174,4.1,30,30\nPB-102,169,171\nPB-103,171,173\nPB-104,170,172\nPB-105,168,170', weighRef: 'Bale weigh check BW-26-01', reference: 'GRN-LINT-A' }).lots[0];
  inspect(lintA);
  const plan = run('fibre-setup', { process: 'Fibre preparation', code: 'BP-30C', version: '1', blendName: '30s combed mixing', effective: day,
    components: 'Shankar-6,60\nMCU-5,40', tolerancePct: '3', wastePct: '4', labourRate: '110', machineRate: '500', electricityRate: '9', wasteRate: '6',
    rateRef: 'Blowroom rate card BR-2026', reference: 'Mixing approval MX-01' });
  const wo = run('work-order', { number: 'WO-BLD-26-01', stage: 'Fibre preparation', plannedQty: '820', unit: 'kg', locationId: loc.id });
  const blend = run('blend-open', { workOrderId: wo.id, number: 'BL-26-01', machineId: blowroom.id, recipeId: plan.id, plannedKg: '850' });
  run('blend-issue', { batchId: blend.id, lines: 'LINT-B,510\nLINT-A,340', reference: 'BL-ISS-01' });
  const step = (stepName, start, end, more) => run('blend-entry', { batchId: blend.id, step: stepName, start: day + start, end: day + end,
    operator: 'Blowroom tenter', shift: 'A', reference: 'BL-' + stepName.toUpperCase().replace(/\W+/g, '-'), ...more });
  step('Laydown', 'T06:00', 'T06:40', { laydownNo: 'LD-01', laydown: 'LINT-B LINT-A', labourHours: '1.5' });
  step('Opening', 'T06:40', 'T09:00', { electricity: '45', droppings: '12', labourHours: '2' });
  step('Cleaning', 'T09:00', 'T11:30', { electricity: '50', droppings: '20', labourHours: '2' });
  step('Blending', 'T11:30', 'T13:00', { electricity: '25', labourHours: '1' });
  run('blend-output', { batchId: blend.id, outputId: 'PF-BL-26-01', outputQty: '816', waste: '34', reference: 'BL-HANDOFF-01', shift: 'A' });
  run('blend-close', { batchId: blend.id, reason: 'Blend handed off to carding.' });
  // OCS lint without verified supplier evidence enters on Standard Hold. Scan it to see why it is ineligible.
  run('bale-inward', { lotId: 'LINT-C', itemId: lint.id, supplierId: ginner.id, origin: 'Akola district, Maharashtra', originCountry: 'India',
    ginner: 'Example Ginning and Pressing, Akola', lotMark: 'AK-26-OCS', variety: 'MCU-5', cropYear: '2026-27', locationId: loc.id, scheme: 'OCS',
    bales: 'PB-201,170\nPB-202,171', weighRef: 'Bale weigh check BW-26-02', reference: 'GRN-LINT-C' });
}

// Blend BL-26-01 is spun on a combed ring route into two yarn lots, each with its own good output,
// comber noil and waste. Lot A is sold against a yarn order; lot B moves to the weaving preparatory store.
function spinningSample(run, { buyer, loc, inspect }) {
  const day = today();
  run('spin-config', { ring: 'yes', rotor: 'yes', version: '1', effective: day, reference: 'Mill configuration SPN-CFG-01' });
  const yarnItem = run('item-master', { code: 'YRN-30CR', name: '30s Ne combed ring cotton yarn', type: 'Yarn', unit: 'kg', composition: '100% cotton' });
  const machine = (code, name) => run('machine-master', { code, name, locationId: loc.id, status: 'In service' });
  const ring = machine('RF-01', 'Ring frame 01');
  const steps = [['Carding', machine('CRD-01', 'Card 01'), { stepKg: '790', droppings: '26', hank: '0.12', hankUnit: 'Ne' }],
    ['Breaker drawing', machine('DRW-01', 'Breaker draw frame 01'), { stepKg: '790', hank: '0.12' }],
    ['Lap forming', machine('LAP-01', 'Lap former 01'), { stepKg: '785', droppings: '5' }],
    ['Combing', machine('CMB-01', 'Comber 01'), { stepKg: '655', droppings: '130' }],
    ['Finisher drawing', machine('DRW-02', 'Finisher draw frame 02'), { stepKg: '655', hank: '0.13' }],
    ['Roving', machine('SPX-01', 'Speed frame 01'), { stepKg: '652', hank: '1.1', deliveries: '120' }],
    ['Ring spinning', ring, { stepKg: '645', deliveries: '1008', electricity: '520' }],
    ['Winding', machine('ACW-01', 'Autoconer 01'), { stepKg: '640', electricity: '60' }]];
  const plan = run('spin-setup', { code: 'SP-30CR', version: '1', route: 'Combed ring', effective: day, count: '30', countSystem: 'Ne', countTolerancePct: '2',
    composition: '100% cotton', twist: 'TM 3.8', coneKg: '1.25', yieldPct: '79', noilPct: '16', wastePct: '5',
    labourRate: '110', machineRate: '300', electricityRate: '9', wasteRate: '4', rateRef: 'Spinning rate card SR-2026', reference: 'Count plan approval CP-30CR' });
  const wo = run('work-order', { number: 'WO-SPN-26-01', stage: 'Spinning', plannedQty: '660', unit: 'kg', locationId: loc.id });
  const lot = run('spin-open', { workOrderId: wo.id, number: 'SPL-26-01', machineId: ring.id, recipeId: plan.id, plannedKg: '816' });
  run('spin-issue', { batchId: lot.id, lines: 'PF-BL-26-01,816', reference: 'SPN-ISS-01' });
  steps.forEach(([step, m, more], i) => run('spin-entry', { batchId: lot.id, step, machineId: m.id, start: day + 'T' + String(6 + i * 2).padStart(2, '0') + ':00',
    end: day + 'T' + String(7 + i * 2).padStart(2, '0') + ':30', operator: 'Spinning team ' + (i < 4 ? 'A' : 'B'), shift: i < 4 ? 'A' : 'B', labourHours: '3',
    reference: 'SPN-' + step.toUpperCase().replace(/\W+/g, '-'), ...more }));
  const order = run('buyer-order', { po: 'DC-26040', buyerId: buyer.id, kind: 'Goods' });
  const line = run('po-line', { orderId: order.id, style: '30s Ne combed ring yarn', color: 'Raw white', size: 'Cones 1.25 kg', sku: 'YRN-30CR-RW', qty: '400', unit: 'kg',
    route: 'Spinning only', product: 'Yarn', scheme: 'Conventional', price: '320', delivery: day, specRev: 'Y01', approvedSpec: '30s Ne combed ring, TM 3.8, 1.25 kg cones.',
    composition: '100% cotton', bom: '', costRev: 'C01' });
  run('approve-line', { lineId: line.id, notes: 'Approved yarn order.' });
  const a = run('spin-output', { batchId: lot.id, outputId: 'YRN-30C-A', itemId: yarnItem.id, outputQty: '330', cones: '264', coneFrom: 'A-0001', coneTo: 'A-0264', cartons: '11',
    noilLotId: 'NOIL-26-01', noilKg: '70', waste: '25', actualCount: '30.2', countCv: '1.4', countTest: 'Count test CT-26-01', allocations: line.id + ',330',
    reference: 'PACK-30C-A', shift: 'B' });
  const b = run('spin-output', { batchId: lot.id, outputId: 'YRN-30C-B', itemId: yarnItem.id, outputQty: '310', cones: '248', coneFrom: 'B-0001', coneTo: 'B-0248', cartons: '10',
    noilLotId: 'NOIL-26-02', noilKg: '60', waste: '21', actualCount: '29.9', countCv: '1.5', countTest: 'Count test CT-26-02', reference: 'PACK-30C-B', shift: 'B' });
  run('spin-close', { batchId: lot.id, reason: 'Spin lot packed and reconciled.' });
  inspect(a);
  inspect(b);
  const sale = run('dispatch', { number: 'SHP-26040-01', items: 'YRN-30C-A,' + line.id + ',330', mode: 'Domestic', carrier: 'Example Transport' });
  run('invoice', { shipmentId: sale.id, number: 'INV-26040-01', taxRef: 'Training data' });
  const weave = run('location-master', { code: 'WEAVE', site: 'Decaste Mill', warehouse: 'Weaving preparatory', bin: 'WP01' });
  run('transfer', { lotId: 'YRN-30C-B', qty: '310', locationId: weave.id, reference: 'TRF-30C-B to weaving' });
}

// Undyed lot YRN-UD-01 splits into a red and a navy batch. Red is split into two dyed lots; part of the navy
// batch is re-dyed on a revised recipe. Red cones go to knitting, red warp and navy weft go to weaving.
// A commission customer's yarn is dyed and delivered back; a GOTS commission batch waits on site scope.
function colourSplitSample(run, { loc, inspect, supplier }) {
  const day = today();
  const at = (h, m = '00') => day + 'T' + String(h).padStart(2, '0') + ':' + m;
  const item = (code, name, type, unit) => run('item-master', { code, name, type, unit });
  const undyed = item('YRN-UD30', 'Undyed 30s cotton yarn, soft packages', 'Yarn', 'kg');
  const chem = Object.fromEntries([['NDYE-01', 'Reactive navy dye'], ['SCOUR-01', 'Scouring agent'], ['RDYE-02', 'Reactive red dye (lot 2)'], ['SALT-02', 'Glauber salt (lot 2)']]
    .map(([code, name]) => [code, item(code, name, 'Chemical', 'kg')]));
  const m = (code, name) => run('machine-master', { code, name, locationId: loc.id, status: 'In service' });
  const machines = { wind: m('SPW-1', 'Soft package winder 1'), hthp1: m('HTHP-2', 'Package dyeing machine 2'), hthp2: m('HTHP-3', 'Package dyeing machine 3'),
    dry: m('RFD-1', 'RF package dryer 1'), rewind: m('RWD-1', 'Rewinding machine 1') };
  const receive = (lotId, itemId, qty, more = {}) => {
    const lot = run('receipt', { lotId, itemId, qty: String(qty), locationId: loc.id, mode: 'Direct inward', supplierId: supplier.id, origin: 'Example spinning and ginning site', reference: 'GRN-' + lotId, ...more });
    if (!lot.standardHold) inspect(lot);
    return lot;
  };
  receive('YRN-UD-01', undyed.id, 1000, { composition: '100% cotton' });
  receive('CHEM-N-01', chem['NDYE-01'].id, 30);
  receive('CHEM-SC-01', chem['SCOUR-01'].id, 20);
  receive('CHEM-R-02', chem['RDYE-02'].id, 20);
  receive('CHEM-S-02', chem['SALT-02'].id, 900);
  const recipe = (code, version, colour, shade, dyeCode, dose, more = {}) => run('dye-setup', { code, version, colour, shade, effective: day, pretreatment: 'Scouring',
    pretreatmentSpec: 'Scour 2 g/L at 95 °C for 30 min, hot rinse', rewind: 'yes', liquorRatio: '8',
    chemicals: dyeCode + ',' + dose + '\nSALT-02,0.6\nSCOUR-01,0.004', waterPerKg: '60', steamPerKg: '3', electricityPerKg: '1.2', yieldPct: '97',
    labourRate: '120', machineRate: '400', electricityRate: '9', waterRate: '40', steamRate: '2.5', wasteRate: '15', rateRef: 'Training rate card RC-2026-1',
    reference: 'Lab dip approval ' + code + '-' + version, ...more });
  const red = recipe('RED-R2', '1', 'Red', 'Red 18-1663', 'RDYE-02', '0.02');
  const navy = recipe('NAVY-R1', '1', 'Navy', 'Navy 19-3923', 'NDYE-01', '0.04');
  const wo = (number, qty, more = {}) => run('work-order', { number, stage: 'Yarn dyeing', plannedQty: String(qty), unit: 'kg', locationId: loc.id, ...more });
  const steps = (batch, machine, chemicals, list = ['Package winding', 'Pre-treatment', 'Dyeing', 'Soaping / washing', 'Drying', 'Rewinding']) => list.forEach((step, i) => {
    const use = { 'Package winding': machines.wind, Drying: machines.dry, Rewinding: machines.rewind }[step] || machine;
    run('dye-entry', { batchId: batch.id, step, machineId: use.id, start: at(6 + i * 2), end: at(7 + i * 2, '30'), operator: 'Dye house team', shift: i < 3 ? 'A' : 'B',
      reference: batch.number + '-' + step.toUpperCase().replace(/\W+/g, '-'), labourHours: '2',
      ...(step === 'Pre-treatment' ? { chemicals: 'CHEM-SC-01,' + chemicals.scour, temperature: '95', water: chemicals.water / 3, steam: '120' } : {}),
      ...(step === 'Dyeing' || step === 'Re-dye (rework)' ? { chemicals: chemicals.dye, temperature: '60', liquorRatio: '8', water: chemicals.water, steam: chemicals.steam, electricity: chemicals.kwh } : {}),
      ...(step === 'Soaping / washing' ? { temperature: '95', water: chemicals.water / 2 } : {}),
      ...(step === 'Drying' ? { electricity: chemicals.kwh / 2 } : {}) });
  });
  // One yarn lot, two colours.
  const redBatch = run('dye-batch', { workOrderId: wo('WO-YD-RED-01', 500).id, number: 'DYB-RED-01', machineId: machines.hthp1.id, recipeId: red.id, plannedKg: '500' });
  const navyBatch = run('dye-batch', { workOrderId: wo('WO-YD-NAVY-01', 450).id, number: 'DYB-NAVY-01', machineId: machines.hthp2.id, recipeId: navy.id, plannedKg: '450' });
  run('dye-issue', { batchId: redBatch.id, lines: 'YRN-UD-01,500', reference: 'ISS-RED-01' });
  run('dye-issue', { batchId: navyBatch.id, lines: 'YRN-UD-01,450', reference: 'ISS-NAVY-01' });
  steps(redBatch, machines.hthp1, { scour: '2', dye: 'CHEM-R-02,10\nCHEM-S-02,300', water: 24000, steam: '1500', kwh: 600 });
  steps(navyBatch, machines.hthp2, { scour: '1.8', dye: 'CHEM-N-01,18\nCHEM-S-02,270', water: 21600, steam: '1350', kwh: 540 });
  // Batch split: the red batch unloads into two dyed lots on cones.
  const out = (batch, outputId, cones, kg, waste, more = {}) => run('dye-output', { batchId: batch.id, outputId, outputQty: String(cones), unit: 'cone', netKg: String(kg),
    waste: String(waste), reference: 'UNL-' + outputId, operator: 'Unloading team', shift: 'B', ...more });
  inspect(out(redBatch, 'DYR-01', 300, 375, 4));
  inspect(out(redBatch, 'DYR-02', 90, 112, 4));
  run('dye-return', { batchId: redBatch.id, lines: 'YRN-UD-01,5', reference: 'RET-RED-01' });
  run('dye-close', { batchId: redBatch.id, reason: 'Red batch unloaded in two lots.' });
  inspect(out(navyBatch, 'DYN-01', 360, 432, 6));
  run('dye-output', { batchId: navyBatch.id, outputId: 'DYN-RW', outputQty: '10', unit: 'kg', waste: '0', result: 'Rework', reference: 'UNL-DYN-RW', shift: 'B' });
  run('dye-close', { batchId: navyBatch.id, reason: 'Navy batch unloaded; shade-off packages held for re-dye.', lossConfirmed: 'yes', lossRef: 'Batch scale reconciliation BR-NAVY-01' });
  // Recipe revision, then re-dye of the shade-off packages.
  const navy2 = recipe('NAVY-R1', '2', 'Navy', 'Navy 19-3923', 'NDYE-01', '0.042', { revises: navy.id, revisionReason: 'Lab dip re-test: navy dose +5% for full shade depth' });
  const redye = run('dye-batch', { workOrderId: wo('WO-YD-REDYE-01', 10, { rework: 'yes' }).id, number: 'DYB-NAVY-RD1', machineId: machines.hthp2.id, recipeId: navy2.id, plannedKg: '10' });
  run('dye-issue', { batchId: redye.id, lines: 'DYN-RW,10', reference: 'ISS-REDYE-01' });
  steps(redye, machines.hthp2, { dye: 'CHEM-N-01,0.2\nCHEM-S-02,3', water: 480, steam: '30', kwh: 12 }, ['Re-dye (rework)', 'Soaping / washing', 'Drying', 'Rewinding']);
  inspect(run('dye-output', { batchId: redye.id, outputId: 'DYN-02', outputQty: '9.8', unit: 'kg', waste: '0.2', reference: 'UNL-DYN-02' }));
  run('dye-close', { batchId: redye.id, reason: 'Re-dyed packages unloaded.' });
  // Dyed cones to knitting, and separate warp and weft allocations for weaving.
  const stage = (number, name, qty) => run('work-order', { number, stage: name, plannedQty: String(qty), unit: 'kg', locationId: loc.id });
  const knit = stage('WO-KNT-YD-01', 'Knitting', 112);
  const warp = stage('WO-WRP-YD-01', 'Warping', 200);
  const weave = stage('WO-WV-YD-01', 'Weaving', 440);
  run('yarn-assign', { lotId: 'DYR-02', workOrderId: knit.id, role: 'Knitting', qty: '90', reference: 'KNIT-ALLOC-01' });
  run('yarn-assign', { lotId: 'DYR-01', workOrderId: warp.id, role: 'Warp', qty: '160', reference: 'WARP-ALLOC-01' });
  run('yarn-assign', { lotId: 'DYN-01', workOrderId: weave.id, role: 'Weft', qty: '200', reference: 'WEFT-ALLOC-01' });
  run('production', { workOrderId: knit.id, inputs: 'DYR-02,90', outputId: 'KNT-YD-01', outputQty: '110', waste: '2', balanceUnit: 'kg', reference: 'RUN-KNT-YD-01' });
  run('production', { workOrderId: warp.id, inputs: 'DYR-01,160', outputId: 'BEAM-YD-02', outputQty: '199', waste: '1', balanceUnit: 'kg', reference: 'RUN-WRP-YD-01' });
  run('production', { workOrderId: weave.id, inputs: 'BEAM-YD-02,199\nDYN-01,200', outputId: 'GRG-YD-01', outputQty: '430', waste: '9', balanceUnit: 'kg', reference: 'RUN-WV-YD-01' });
  // Commission dyeing for a customer: ownership stays with the customer, custody with this mill until delivery.
  const customer = run('party-master', { code: 'DEMO-CUS', type: 'Buyer', name: 'Example Knit Brand', currency: 'INR', shipTo: 'Example Knit Brand, knitting unit' });
  const inward = (lotId, qty, more = {}) => run('receipt', { lotId, itemId: undyed.id, qty: String(qty), locationId: loc.id, mode: 'Customer inward', ownerId: customer.id,
    origin: 'Example Knit Brand yarn store', reference: 'CUS-IN-' + lotId, ...more });
  inspect(inward('YRN-CUS-01', 200));
  const cus = run('dye-batch', { workOrderId: wo('WO-YD-CUS-01', 200).id, number: 'DYB-CUS-01', machineId: machines.hthp1.id, recipeId: red.id, plannedKg: '200',
    customerId: customer.id, commissionRef: 'Customer job order CJO-001' });
  run('dye-issue', { batchId: cus.id, lines: 'YRN-CUS-01,200', reference: 'ISS-CUS-01' });
  steps(cus, machines.hthp1, { scour: '0.8', dye: 'CHEM-R-02,4\nCHEM-S-02,120', water: 9600, steam: '600', kwh: 240 });
  inspect(out(cus, 'DYC-01', 157, 196, 3));
  run('dye-close', { batchId: cus.id, reason: 'Commission batch complete.', lossConfirmed: 'yes', lossRef: 'Batch scale reconciliation BR-CUS-01' });
  run('dye-deliver', { customerId: customer.id, number: 'DC-CUS-001', lines: 'DYC-01,157', carrier: 'Example Transport' });
  // GOTS commission yarn: the customer's evidence is verified, but this site's verified GOTS scope covers knitting and weaving only.
  const cusEv = run('evidence', { scheme: 'GOTS', kind: 'Scope certificate', role: 'Supplier', party: customer.name, site: 'Example Knit Brand yarn store',
    number: 'GOTS-CUS-01', issuer: 'Example certification body', issue: day, until: day, operations: 'Supply', materials: 'Yarn' });
  run('review-evidence', { evidenceId: cusEv.id, status: 'Verified', source: 'Training: certification body lookup', scopeConfirmed: 'yes' });
  const own = run('evidence', { scheme: 'GOTS', kind: 'Scope certificate', role: 'Processor', party: 'HAPZO Training Mill', site: loc.site,
    number: 'GOTS-MILL-01', issuer: 'Example certification body', issue: day, until: day, operations: 'Knitting, Weaving', materials: '*' });
  run('review-evidence', { evidenceId: own.id, status: 'Verified', source: 'Training: certification body lookup', scopeConfirmed: 'yes' });
  inspect(inward('YRN-CUS-GOTS', 300, { scheme: 'GOTS' }));
  run('dye-batch', { workOrderId: wo('WO-YD-CUS-GOTS', 300, { scheme: 'GOTS' }).id, number: 'DYB-CUS-GOTS', machineId: machines.hthp2.id, recipeId: red.id, plannedKg: '300',
    customerId: customer.id, commissionRef: 'Customer job order CJO-002 (GOTS)' });
}

// Striped polo: the body is yarn-dyed single jersey on route A (yarn dyeing → knitting → finishing) from red and
// navy cones; the rib is greige 1x1 rib on route C (knitting → fabric dyeing → finishing) from undyed 30s yarn.
function knittingSample(run, { buyer, loc, inspect }) {
  const day = today();
  const at = h => day + 'T' + String(h).padStart(2, '0') + ':00';
  const item = (code, name) => run('item-master', { code, name, type: 'Finished fabric', unit: 'kg', composition: '100% cotton' });
  item('KF-BODY-STR', 'Red/navy striped single jersey body fabric');
  item('KF-RIB-STR', 'Navy 1x1 rib fabric');
  const order = run('buyer-order', { po: 'DC-26052', buyerId: buyer.id, kind: 'Goods' });
  const line = run('po-line', { orderId: order.id, style: 'Striped polo tee', color: 'Red/navy stripe', size: 'M', sku: 'POLO-STR-M', qty: '400', unit: 'pcs',
    route: 'Yarn-dyed knitted', product: 'Packed carton', scheme: 'Conventional', price: '420', delivery: day, specRev: 'S01',
    approvedSpec: 'Red 6 / navy 4 course stripe body, navy 1x1 rib collar and cuffs.', composition: '100% cotton', bomRev: 'B01',
    bom: 'KF-BODY-STR,0.25\nKF-RIB-STR,0.03', costRev: 'C01' });
  run('approve-line', { lineId: line.id, notes: 'Approved striped polo.' });
  const bodyRoute = run('component-route', { lineId: line.id, component: 'KF-BODY-STR', template: 'A', effective: day, reference: 'Route approval RA-26052-BODY' });
  const ribRoute = run('component-route', { lineId: line.id, component: 'KF-RIB-STR', template: 'C', effective: day, reference: 'Route approval RA-26052-RIB' });
  const machine = (code, name) => run('machine-master', { code, name, locationId: loc.id, status: 'In service' });
  const sj = machine('KNT-SJ-01', 'Single jersey circular 30 inch');
  const rib = machine('KNT-RIB-01', 'Rib circular 30 inch');
  run('knit-machine', { machineId: sj.id, type: 'Circular single jersey', gauge: '24', diameter: '30', feeders: '90', effective: day, reference: 'Machine audit KM-01' });
  run('knit-machine', { machineId: rib.id, type: 'Circular double jersey (rib/interlock)', gauge: '18', diameter: '30', feeders: '60', effective: day, reference: 'Machine audit KM-02' });
  const rates = { labourRate: '110', machineRate: '250', electricityRate: '9', wasteRate: '5', rateRef: 'Knitting rate card KR-2026' };
  const body = run('knit-setup', { code: 'KC-STR-SJ', version: '1', effective: day, component: 'Body', bomCode: 'KF-BODY-STR', structure: 'Single jersey', yarnDyed: 'yes',
    feeds: 'Ground,30,Ne,Red\nGround,30,Ne,Navy', stripe: 'Red,6\nNavy,4', machineType: 'Circular single jersey', gauge: '24', diameter: '30',
    stitchLength: '2.7', gsm: '160', width: '180 cm open width', yieldPct: '98', reference: 'Construction approval KCA-26052-BODY', ...rates });
  const ribSpec = run('knit-setup', { code: 'KC-RIB-11', version: '1', effective: day, component: 'Rib', bomCode: 'KF-RIB-STR', structure: 'Rib 1x1', yarnDyed: 'no',
    feeds: 'Ground,30,Ne', machineType: 'Circular double jersey (rib/interlock)', gauge: '18', diameter: '30', stitchLength: '2.9', gsm: '220',
    width: '90 cm tubular', yieldPct: '98', reference: 'Construction approval KCA-26052-RIB', ...rates });
  const wo = (number, stage, route, qty) => run('work-order', { number, stage, componentRouteId: route.id, plannedQty: String(qty), unit: 'kg', locationId: loc.id });
  const steps = (b, list, more = {}) => list.forEach((step, i) => run('knit-entry', { batchId: b.id, step, start: at(6 + i * 3), end: at(8 + i * 3),
    operator: 'Knitter ' + (i % 2 ? 'B' : 'A'), shift: i < 2 ? 'A' : 'B', reference: b.number + '-' + step.toUpperCase().replace(/\W+/g, '-'), ...(step === 'Knitting' ? more : {}) }));
  // Body: separate production order, yarn-dyed stripe from red and navy cones.
  const bodyRun = run('knit-open', { workOrderId: wo('WO-KNT-BODY-01', 'Knitting', bodyRoute, 230).id, number: 'KNR-BODY-01', machineId: sj.id, recipeId: body.id, plannedKg: '230' });
  run('knit-issue', { batchId: bodyRun.id, lines: 'DYR-01,110\nDYN-01,76', reference: 'CONE-ISS-BODY-01' });
  steps(bodyRun, ['Yarn creel loading', 'Knitting', 'Doffing'], { electricity: '140', labourHours: '8' });
  run('knit-output', { batchId: bodyRun.id, rolls: 'KR-STR-001,55.2,142\nKR-STR-002,55,141\nKR-STR-003,54.8,141\nKR-STR-004,55,142',
    consumedKg: '222.55', consumption: 'DYR-01,133.75\nDYN-01,88.8', waste: '2.55', reference: 'DOFF-BODY-01', shift: 'B', operator: 'Knitter B' });
  run('knit-return', { batchId: bodyRun.id, lines: 'DYR-01,3\nDYN-01,2', reference: 'CONE-RET-BODY-01' });
  run('knit-close', { batchId: bodyRun.id, reason: 'Body run doffed; unused cones returned.' });
  for (const roll of ['KR-STR-001', 'KR-STR-002']) inspect({ id: roll });
  // Rib: separate production order, greige from undyed 30s Ne yarn.
  const ribRun = run('knit-open', { workOrderId: wo('WO-KNT-RIB-01', 'Knitting', ribRoute, 42).id, number: 'KNR-RIB-01', machineId: rib.id, recipeId: ribSpec.id, plannedKg: '42' });
  run('knit-issue', { batchId: ribRun.id, lines: 'YRN-30C-B,42', reference: 'CONE-ISS-RIB-01' });
  steps(ribRun, ['Yarn creel loading', 'Knitting', 'Doffing'], { electricity: '30', labourHours: '3' });
  run('knit-output', { batchId: ribRun.id, rolls: 'KR-RIB-001,20.3\nKR-RIB-002,20.5', waste: '1.2', reference: 'DOFF-RIB-01', shift: 'B', operator: 'Knitter B' });
  run('knit-close', { batchId: ribRun.id, reason: 'Rib run doffed.' });
  inspect({ id: 'KR-RIB-001' });
  // A yarn-dyed striped roll goes to finishing; an undyed greige rib roll goes to fabric dyeing.
  run('production', { workOrderId: wo('WO-FIN-BODY-01', 'Fabric finishing', bodyRoute, 60).id, inputs: 'KR-STR-001,55.2', outputId: 'FF-STR-001', outputQty: '54.1',
    waste: '1.1', lengthM: '138', reference: 'RUN-FIN-STR-001', recipe: 'Compacting and softening, finish recipe FN-07' });
  run('production', { workOrderId: wo('WO-DYE-RIB-01', 'Fabric dyeing', ribRoute, 25).id, inputs: 'KR-RIB-001,20.3\nCHEM-N-01,0.6', outputId: 'FD-RIB-001',
    outputQty: '20', waste: '0.3', reference: 'RUN-DYE-RIB-001', recipe: 'Navy rib dye NAVY-RIB-1', water: '600' });
}

// Woven shirting. Greige (route D with sizing and desizing): warp set → warper's beams → sizing with size lots →
// loom beam → drawing-in → loom run with a weft lot change at 450 m → desizing → fabric dyeing.
// Yarn-dyed check (route B): red/navy warp, two-colour weft prepared by rewinding → loom → finishing.
function weavingSample(run, { buyer, loc, inspect, supplier }) {
  const day = today();
  const at = h => day + 'T' + String(h).padStart(2, '0') + ':00';
  const left = (batch, lotId) => round(sum(batch.lines.filter(l => l.lotId === lotId), l => l.issuedKg - l.consumedKg - l.returnedKg));
  const leftUnits = (batch, lotId) => Math.floor(sum(batch.lines.filter(l => l.lotId === lotId), l => l.issued - l.consumed - l.returned) + 1e-9);
  const item = (code, name, type, unit = 'kg') => run('item-master', { code, name, type, unit, composition: '100% cotton' });
  const yarn = item('YRN-40C', 'Undyed 40s Ne cotton yarn', 'Yarn');
  item('WF-PL-DYED', 'Navy dyed poplin (woven)', 'Finished fabric');
  item('WF-YD-CHK', 'Red/navy yarn-dyed check (woven)', 'Finished fabric');
  const size = item('SIZE-01', 'Starch and PVA size mix', 'Chemical');
  const receive = (lotId, itemId, qty) => inspect(run('receipt', { lotId, itemId, qty: String(qty), locationId: loc.id, mode: 'Direct inward', supplierId: supplier.id,
    origin: 'Example spinning and ginning site', reference: 'GRN-' + lotId }));
  receive('YRN-WP-01', yarn.id, 400);
  receive('YRN-WF-01', yarn.id, 40);
  receive('YRN-WF-02', yarn.id, 40);
  receive('CHEM-SZ-01', size.id, 50);
  const line = (po, style, colour, sku, route, bom) => {
    const order = run('buyer-order', { po, buyerId: buyer.id, kind: 'Goods' });
    const l = run('po-line', { orderId: order.id, style, color: colour, size: 'M', sku, qty: '300', unit: 'pcs', route, product: 'Packed carton', scheme: 'Conventional',
      price: '520', delivery: day, specRev: 'S01', approvedSpec: style + ', woven shirting.', composition: '100% cotton', bomRev: 'B01', bom: bom + ',1.6\nCTN-001,0.004348', costRev: 'C01' });
    run('approve-line', { lineId: l.id, notes: 'Approved woven shirt.' });
    return l;
  };
  const greigeLine = line('DC-26061', 'Navy poplin shirt', 'Navy', 'POP-WV-NVY-M', 'Fabric-dyed woven', 'WF-PL-DYED');
  const checkLine = line('DC-26062', 'Red/navy check shirt', 'Red/navy check', 'CHK-WV-M', 'Yarn-dyed woven', 'WF-YD-CHK');
  const routeD = run('component-route', { lineId: greigeLine.id, component: 'WF-PL-DYED', template: 'D', conditional: 'Sizing,Desizing', effective: day, reference: 'Route approval RA-26061' });
  const routeB = run('component-route', { lineId: checkLine.id, component: 'WF-YD-CHK', template: 'B', effective: day, reference: 'Route approval RA-26062' });
  const machine = (code, name) => run('machine-master', { code, name, locationId: loc.id, status: 'In service' });
  const warper = machine('WARPER-1', 'Direct warping machine 1');
  const sizer = machine('SIZER-1', 'Sizing machine 1');
  const loom1 = machine('LOOM-R1', 'Rapier loom 190 cm (4 colours)');
  const loom2 = machine('LOOM-R2', 'Rapier loom 190 cm (8 colours)');
  run('loom-setup', { machineId: loom1.id, type: 'Rapier', widthCm: '190', selectors: '4', shedding: 'Dobby 16 shafts', effective: day, reference: 'Loom audit LA-01' });
  run('loom-setup', { machineId: loom2.id, type: 'Rapier', widthCm: '190', selectors: '8', shedding: 'Dobby 16 shafts', effective: day, reference: 'Loom audit LA-02' });
  const rates = { labourRate: '110', machineRate: '220', electricityRate: '9', wasteRate: '5', rateRef: 'Weaving rate card WR-2026' };
  const greige = run('weave-setup', { code: 'GW-PL-40', version: '1', effective: day, bomCode: 'WF-PL-DYED', weave: 'Plain', ends: '4800', reedDents: '76', endsPerDent: '2',
    reedSpaceCm: '160', picksPerCm: '28', warpCount: '40', weftCount: '40', countSystem: 'Ne', warpCrimp: '8', weftCrimp: '5', sizing: 'yes',
    sizeRecipe: 'Starch 8% and PVA 2% at 85 °C', weftPrep: 'None', loomType: 'Rapier', widthCm: '150', gsm: '110', yieldPct: '97', reference: 'Construction approval WCA-26061', ...rates });
  const check = run('weave-setup', { code: 'YD-CHK-01', version: '1', effective: day, bomCode: 'WF-YD-CHK', weave: 'Plain', yarnDyed: 'yes', ends: '960',
    warpSequence: 'Red,24\nNavy,24', weftSequence: 'Navy,24\nRed,24', reedSpaceCm: '34', picksPerCm: '26', warpCount: '30', weftCount: '30', countSystem: 'Ne',
    warpCrimp: '6', weftCrimp: '4', weftPrep: 'Rewinding to weft cones', loomType: 'Rapier', widthCm: '32', yieldPct: '97', reference: 'Construction approval WCA-26062', ...rates });
  const wo = (number, stage, route, qty) => run('work-order', { number, stage, componentRouteId: route.id, plannedQty: String(qty), unit: 'kg', locationId: loc.id });
  const step = (action, batch, name, i, more = {}) => run(action, { batchId: batch.id, step: name, start: at(6 + i), end: at(7 + i), operator: 'Weaving team', shift: i < 4 ? 'A' : 'B',
    reference: batch.number + '-' + name.toUpperCase().replace(/\W+/g, '-'), ...more });

  // Greige: warp path with sizing.
  const warpWo = wo('WO-WRP-26061', 'Warping', routeD, 400);
  const sizeWo = wo('WO-SZ-26061', 'Sizing', routeD, 440);
  const loomWo = wo('WO-WV-26061', 'Weaving', routeD, 500);
  run('yarn-assign', { lotId: 'YRN-WP-01', workOrderId: warpWo.id, role: 'Warp', qty: '400', reference: 'WARP-ALLOC-26061' });
  run('yarn-assign', { lotId: 'YRN-WF-01', workOrderId: loomWo.id, role: 'Weft', qty: '40', reference: 'WEFT-ALLOC-26061-1' });
  run('yarn-assign', { lotId: 'YRN-WF-02', workOrderId: loomWo.id, role: 'Weft', qty: '40', reference: 'WEFT-ALLOC-26061-2' });
  const set = run('warp-open', { workOrderId: warpWo.id, number: 'WS-26061', machineId: warper.id, recipeId: greige.id, plannedKg: '400' });
  run('warp-issue', { batchId: set.id, lines: 'YRN-WP-01,400', reference: 'WARP-ISS-26061' });
  step('warp-entry', set, 'Creel loading', 0);
  step('warp-entry', set, 'Warping', 1, { electricity: '35', labourHours: '4' });
  run('warp-beams', { batchId: set.id, beams: 'WB-061-1,1200,1000,99\nWB-061-2,1200,1000,99\nWB-061-3,1200,1000,99\nWB-061-4,1200,1000,99', waste: '4', reference: 'WARP-DOFF-26061' });
  run('warp-close', { batchId: set.id, reason: 'Warper’s beams doffed.' });
  const sz = run('size-open', { workOrderId: sizeWo.id, number: 'SZ-26061', machineId: sizer.id, recipeId: greige.id, plannedKg: '400' });
  run('size-issue', { batchId: sz.id, lines: 'WB-061-1,99\nWB-061-2,99\nWB-061-3,99\nWB-061-4,99', reference: 'SIZE-ISS-26061' });
  step('size-entry', sz, 'Size preparation', 2);
  step('size-entry', sz, 'Sizing', 3, { chemicals: 'CHEM-SZ-01,40', temperature: '85', steam: '180', electricity: '60', labourHours: '3' });
  step('size-entry', sz, 'Drying', 4, { steam: '120' });
  run('size-beams', { batchId: sz.id, beams: 'LB-061-1,4800,990,431', adjustment: '40', adjustmentRef: 'Size add-on weighed: CHEM-SZ-01 on the beam', waste: '5', reference: 'SIZE-DOFF-26061' });
  run('size-close', { batchId: sz.id, reason: 'Loom beam made.' });
  run('beam-dress', { lotId: 'LB-061-1', loomId: loom1.id, method: 'Drawing-in', ends: '4800', healds: 'Plain, 4 shafts straight draft', reed: '76 dents/inch, 2 ends/dent',
    operator: 'Drawing-in team', reference: 'DRAW-26061' });
  // Loom: weft lot change at 450 m on feeder F1.
  const lr = run('loom-open', { workOrderId: loomWo.id, number: 'LR-26061', machineId: loom1.id, recipeId: greige.id, plannedKg: '520' });
  run('loom-issue', { batchId: lr.id, lines: 'LB-061-1,431\nYRN-WF-01,40', reference: 'LOOM-ISS-26061-1' });
  step('loom-entry', lr, 'Beam gaiting', 5);
  step('loom-entry', lr, 'Weaving', 6, { weftFeed: 'F1,YRN-WF-01', electricity: '220', labourHours: '8' });
  run('loom-roll', { batchId: lr.id, rollId: 'GR-061-01', metres: '300', kg: '163', waste: '1', reference: 'DOFF-26061-01', shift: 'A', operator: 'Weaver A' });
  run('loom-issue', { batchId: lr.id, lines: 'YRN-WF-02,40', reference: 'LOOM-ISS-26061-2' });
  step('loom-entry', lr, 'Weft package change', 7, { feeder: 'F1', toLot: 'YRN-WF-02', atMetre: '450', packages: '8' });
  run('loom-roll', { batchId: lr.id, rollId: 'GR-061-02', metres: '300', kg: '163', waste: '1', reference: 'DOFF-26061-02', shift: 'B', operator: 'Weaver B' });
  run('loom-roll', { batchId: lr.id, rollId: 'GR-061-03', metres: '300', kg: '163', waste: '1', reference: 'DOFF-26061-03', shift: 'B', operator: 'Weaver B' });
  run('loom-return', { batchId: lr.id, lines: ['LB-061-1', 'YRN-WF-01', 'YRN-WF-02'].map(id => id + ',' + left(lr, id)).join('\n'), reference: 'LOOM-RET-26061',
    notes: 'Beam remnant ' + round(990 - 900 * 1.08) + ' m returned to stock; unused weft cones returned.' });
  run('loom-close', { batchId: lr.id, reason: 'Beam woven out.' });
  for (const roll of ['GR-061-01', 'GR-061-02', 'GR-061-03']) inspect({ id: roll });
  // Greige output goes to desizing (the route requires it after sizing) and then fabric dyeing.
  run('production', { workOrderId: wo('WO-DS-26061', 'Desizing', routeD, 170).id, inputs: 'GR-061-02,163', outputId: 'DS-061-02', outputQty: '150', waste: '13',
    reference: 'RUN-DS-061-02', recipe: 'Enzymatic desizing at 60 °C', water: '900' });
  run('production', { workOrderId: wo('WO-FD-26061', 'Fabric dyeing', routeD, 160).id, inputs: 'DS-061-02,150\nCHEM-N-01,1', outputId: 'FD-061-02', outputQty: '148',
    waste: '2', reference: 'RUN-FD-061-02', recipe: 'Navy reactive, jigger', water: '1500' });

  // Yarn-dyed check: unsized sectional warp, two-colour weft prepared by rewinding.
  const ydWarpWo = wo('WO-WRP-26062', 'Warping', routeB, 30);
  const ydLoomWo = wo('WO-WV-26062', 'Weaving', routeB, 40);
  run('yarn-assign', { lotId: 'DYR-01', workOrderId: ydWarpWo.id, role: 'Warp', qty: '10', reference: 'WARP-ALLOC-26062-R' });
  run('yarn-assign', { lotId: 'DYN-01', workOrderId: ydWarpWo.id, role: 'Warp', qty: '10', reference: 'WARP-ALLOC-26062-N' });
  run('yarn-assign', { lotId: 'DYN-01', workOrderId: ydLoomWo.id, role: 'Weft', qty: '6', reference: 'WEFT-ALLOC-26062-N' });
  run('yarn-assign', { lotId: 'DYR-01', workOrderId: ydLoomWo.id, role: 'Weft', qty: '6', reference: 'WEFT-ALLOC-26062-R' });
  const ys = run('warp-open', { workOrderId: ydWarpWo.id, number: 'WS-26062', machineId: warper.id, recipeId: check.id, plannedKg: '25' });
  run('warp-issue', { batchId: ys.id, lines: 'DYR-01,10\nDYN-01,10', reference: 'WARP-ISS-26062' });
  step('warp-entry', ys, 'Creel loading', 0);
  step('warp-entry', ys, 'Warping', 1, { labourHours: '2' });
  run('warp-beams', { batchId: ys.id, beams: 'YB-062-1,960,300,24', waste: '0.5', reference: 'WARP-DOFF-26062' });
  run('warp-close', { batchId: ys.id, reason: 'Sectional beam doffed.' });
  run('beam-dress', { lotId: 'YB-062-1', loomId: loom2.id, method: 'Drawing-in', ends: '960', healds: 'Plain, 4 shafts', reed: '70 dents/inch', operator: 'Drawing-in team', reference: 'DRAW-26062' });
  run('weft-prep', { lotId: 'DYN-01', method: 'Rewinding to weft cones', qty: '6', packages: '6', reference: 'WEFT-RW-26062-N' });
  run('weft-prep', { lotId: 'DYR-01', method: 'Rewinding to weft cones', qty: '6', packages: '6', reference: 'WEFT-RW-26062-R' });
  const yr = run('loom-open', { workOrderId: ydLoomWo.id, number: 'LR-26062', machineId: loom2.id, recipeId: check.id, plannedKg: '40' });
  run('loom-issue', { batchId: yr.id, lines: 'YB-062-1,24\nDYN-01,6\nDYR-01,6', reference: 'LOOM-ISS-26062' });
  step('loom-entry', yr, 'Weaving', 6, { weftFeed: 'F1,DYN-01\nF2,DYR-01', labourHours: '4' });
  run('loom-roll', { batchId: yr.id, rollId: 'YC-062-01', metres: '270', kg: '30', waste: '0.4', reference: 'DOFF-26062-01', shift: 'B', operator: 'Weaver C' });
  run('loom-return', { batchId: yr.id, lines: 'YB-062-1,' + left(yr, 'YB-062-1') + '\nDYN-01,' + leftUnits(yr, 'DYN-01') + '\nDYR-01,' + leftUnits(yr, 'DYR-01'), reference: 'LOOM-RET-26062' });
  run('loom-close', { batchId: yr.id, reason: 'Check sample woven.', lossConfirmed: 'yes', lossRef: 'Part-cone weft waste weighed WW-26062' });
  inspect({ id: 'YC-062-01' });
  // Yarn-dyed output follows its approved finishing route.
  run('production', { workOrderId: wo('WO-FIN-26062', 'Fabric finishing', routeB, 35).id, inputs: 'YC-062-01,30', outputId: 'FF-YC-062-01', outputQty: '29.4', waste: '0.6',
    lengthM: '265', reference: 'RUN-FIN-YC-062-01', recipe: 'Wash, soften and stenter FN-11' });
}

// Commission fabric dyeing: three customer greige rolls are combined in one jet batch and unloaded in two
// receipts with roll-to-roll sources and wet and dry-equivalent weights. Dyed rolls, a leftover piece and the
// leftover greige go back on two delivery challans. Own GOTS greige waits for an outside dye house whose
// verified scope covers yarn dyeing only.
function fabricDyeingSample(run, { loc, inspect, supplier }) {
  const day = today();
  const at = h => day + 'T' + String(h).padStart(2, '0') + ':00';
  const item = (code, name, type) => run('item-master', { code, name, type, unit: 'kg', composition: '100% cotton' });
  const greige = item('GRG-SJ-CUS', 'Greige single jersey (customer)', 'Greige fabric');
  const ownGreige = item('GRG-POP-40', 'Greige poplin 40s', 'Greige fabric');
  const chem = Object.fromEntries([['FDYE-RED', 'Reactive red for fabric'], ['SODA-01', 'Soda ash'], ['PEROX-01', 'Hydrogen peroxide 50%'], ['SALT-03', 'Glauber salt (fabric)']]
    .map(([code, name]) => [code, item(code, name, 'Chemical')]));
  const own = (lotId, itemId, qty) => inspect(run('receipt', { lotId, itemId, qty: String(qty), locationId: loc.id, mode: 'Direct inward', supplierId: supplier.id,
    origin: 'Example spinning and ginning site', reference: 'GRN-' + lotId }));
  own('CHEM-FD-R1', chem['FDYE-RED'].id, 15);
  own('CHEM-SODA-01', chem['SODA-01'].id, 40);
  own('CHEM-PX-01', chem['PEROX-01'].id, 20);
  own('CHEM-SALT-03', chem['SALT-03'].id, 400);
  const customer = run('party-master', { code: 'DEMO-CUS2', type: 'Buyer', name: 'Example Apparel Co', currency: 'INR', shipTo: 'Example Apparel Co, cutting unit' });
  const jet = run('machine-master', { code: 'JET-01', name: 'Soft-flow jet dyeing machine 1', locationId: loc.id, status: 'In service', device: 'METER-JET1' });
  const reading = run('meter', { machineId: jet.id, reference: 'JET-01-METER-' + day, unit: 'kWh', qty: '180', method: 'Dedicated meter on JET-01, batch start to end' });
  run('verify-meter', { readingId: reading.id, reference: 'Meter log JET-01 verified by maintenance' });
  // Roll-wise customer inward.
  const inward = run('fabric-inward', { mode: 'Customer inward', ownerId: customer.id, itemId: greige.id, fabricKind: 'Knitted', construction: 'Single jersey, 30s Ne, 160 GSM',
    gsm: '160', width: '180 cm open', commissionRef: 'CJO-F-001', rolls: 'CG-001,120.4,310,ABC-11\nCG-002,118.9,305,ABC-12\nCG-003,121.1,312,ABC-13',
    origin: 'Example Apparel Co knitting unit', locationId: loc.id, reference: 'Customer challan CUS-CH-7781' });
  for (const lot of inward.lots) inspect(lot);
  const recipe = run('fdye-setup', { code: 'FD-RED-K', version: '1', effective: day, colour: 'Red', shade: 'Red 18-1663', fabricKind: 'Knitted',
    pretreatment: 'Scouring and bleaching', pretreatmentSpec: 'H2O2 3 g/L, soda ash 2 g/L at 98 °C for 45 min', machineType: 'Soft-flow jet', liquorRatio: '8',
    chemicals: 'FDYE-RED,0.02\nSALT-03,0.6\nSODA-01,0.03\nPEROX-01,0.017', waterPerKg: '40', steamPerKg: '2.4', electricityPerKg: '0.5', yieldPct: '97',
    labourRate: '120', machineRate: '450', electricityRate: '9', waterRate: '40', steamRate: '2.5', wasteRate: '15', rateRef: 'Fabric dyeing rate card FR-2026',
    reference: 'Lab dip LD-CJO-F-001 approved by customer' });
  const wo = run('work-order', { number: 'WO-FD-CUS-01', stage: 'Fabric dyeing', plannedQty: '360', unit: 'kg', locationId: loc.id });
  const batch = run('fdye-open', { workOrderId: wo.id, number: 'FDB-CUS-01', machineId: jet.id, recipeId: recipe.id, plannedKg: '360.4',
    customerId: customer.id, commissionRef: 'CJO-F-001' });
  run('fdye-issue', { batchId: batch.id, lines: 'CG-001,120.4\nCG-002,118.9\nCG-003,121.1', reference: 'FD-ISS-CUS-01' });
  const step = (name, i, more = {}) => run('fdye-entry', { batchId: batch.id, step: name, start: at(6 + i * 2), end: at(7 + i * 2), operator: 'Jet operator', shift: i < 2 ? 'A' : 'B',
    reference: 'FDB-CUS-01-' + name.toUpperCase().replace(/\W+/g, '-'), labourHours: '1.5', ...more });
  step('Loading', 0);
  step('Pre-treatment', 1, { chemicals: 'CHEM-PX-01,6.2\nCHEM-SODA-01,3', temperature: '98', water: '2900', steam: '320' });
  step('Dyeing', 2, { chemicals: 'CHEM-FD-R1,7.2\nCHEM-SALT-03,216\nCHEM-SODA-01,7.5', temperature: '60', liquorRatio: '8', water: '2900', steam: '380', readingId: reading.id });
  step('Washing / soaping', 3, { temperature: '95', water: '5800', steam: '150' });
  step('Unloading', 4);
  // Two receipts of dyed rolls, each naming its source greige roll; a short leftover piece is flagged.
  run('fdye-rolls', { batchId: batch.id, rolls: 'CD-001,116.5,186.4,302,CG-001\nCD-002,115.2,184.3,298,CG-002', waste: '7.2', dryBasis: 'Conditioned weighing',
    reference: 'UNL-FDB-CUS-01-1', shift: 'B' });
  run('fdye-rolls', { batchId: batch.id, rolls: 'CD-003,117.3,187.7,305,CG-003\nCD-003L,1.6,2.6,4,CG-003,L', waste: '2', dryBasis: 'Conditioned weighing',
    reference: 'UNL-FDB-CUS-01-2', shift: 'B' });
  const left = lotId => { const l = batch.lines.find(x => x.lotId === lotId); return Math.round((l.issuedKg - l.consumedKg - l.returnedKg) * 1e6) / 1e6; };
  run('fdye-return', { batchId: batch.id, lines: ['CG-001', 'CG-002', 'CG-003'].map(id => id + ',' + left(id)).join('\n'), reference: 'FD-RET-CUS-01', notes: 'Greige ends cut at stitching' });
  run('fdye-close', { batchId: batch.id, reason: 'Batch unloaded in two receipts; greige ends returned.' });
  for (const id of ['CD-001', 'CD-002', 'CD-003', 'CD-003L']) inspect({ id });
  const returned = lotId => batch.lines.find(x => x.lotId === lotId).returned;
  run('fdye-deliver', { customerId: customer.id, number: 'DC-F-001', lines: 'CD-001,116.5\nCD-002,115.2', carrier: 'Example Transport' });
  run('fdye-deliver', { customerId: customer.id, number: 'DC-F-002', lines: 'CD-003,117.3\nCD-003L,1.6\n' + ['CG-001', 'CG-002', 'CG-003'].map(id => id + ',' + returned(id)).join('\n'),
    carrier: 'Example Transport', notes: 'Dyed roll, leftover piece and greige ends' });
  // Own GOTS greige for outside dyeing: the supplier's evidence is verified; the dye house is approved for yarn dyeing only.
  const supEv = run('evidence', { scheme: 'GOTS', kind: 'Scope certificate', role: 'Supplier', partyId: supplier.id, site: 'Example spinning and ginning site',
    number: 'GOTS-SUP-FAB-01', issuer: 'Example certification body', issue: day, until: day, operations: 'Supply', materials: 'Greige fabric' });
  run('review-evidence', { evidenceId: supEv.id, status: 'Verified', source: 'Training: certification body lookup', scopeConfirmed: 'yes' });
  const dyeHouse = run('party-master', { code: 'DEMO-JOB', type: 'Processor', name: 'Example Dye House', currency: 'INR' });
  const jobEv = run('evidence', { scheme: 'GOTS', kind: 'Scope certificate', role: 'Processor', partyId: dyeHouse.id, site: 'Example dye site',
    number: 'GOTS-DYEHOUSE-01', issuer: 'Example certification body', issue: day, until: day, operations: 'Yarn dyeing', materials: '*' });
  run('review-evidence', { evidenceId: jobEv.id, status: 'Verified', source: 'Training: certification body lookup', scopeConfirmed: 'yes' });
  const ownRolls = run('fabric-inward', { mode: 'Direct inward', supplierId: supplier.id, itemId: ownGreige.id, fabricKind: 'Woven', construction: 'Poplin 40s x 40s, 133 x 72',
    sized: 'yes', rolls: 'OG-001,150,380\nOG-002,148,375', origin: 'Example spinning and ginning site', scheme: 'GOTS', locationId: loc.id, reference: 'GRN-OG-26' });
  for (const lot of ownRolls.lots) inspect(lot);
}
