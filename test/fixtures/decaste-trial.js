import assert from 'node:assert/strict';
import { genealogy, ref, round, sum, today } from '../../src/model.js';
import { orderWorkflow, shippedQty } from '../../src/commerce.js';
import { lotCost } from '../../src/fulfilment.js';
import { accountTotals, book } from '../../src/finance.js';

export function decasteTrial(store, session, { day = today(), prefix = 'DC-E2E-01' } = {}) {
  const companyId = session.company_id;
  const state = () => store.readState(companyId);
  let serial = 0;
  const code = suffix => prefix + '-' + suffix;
  const run = (action, input, requestId = code('ACT-' + (++serial))) => {
    try {
      return store.post(session, { companyId, revision: state().revision, requestId, action, input: { date: day, ...input } });
    } catch (error) {
      error.trialStep = action + ' ' + (input.reference || input.code || input.number || requestId);
      throw error;
    }
  };
  const post = (action, input) => run(action, input).id;
  const results = {};
  const unchanged = (name, action, expected) => {
    const before = state();
    assert.throws(action, expected);
    assert.deepEqual(state(), before, name + ' changed company records');
    results[name] = 'Passed';
  };
  const site = 'Decaste trial production site';
  const supplierSite = 'Decaste trial source mill';
  const processorSite = 'Decaste trial embroidery unit';
  const loc = post('location-master', { code: code('MILL'), site, warehouse: 'Production' });
  const fg = post('location-master', { code: code('FG'), site, warehouse: 'Finished Goods', bin: 'Pilot dispatch bay' });
  const party = (suffix, type, name) => post('party-master', { code: code(suffix), type, name, currency: 'INR' });
  const buyerName = 'Decaste E2E Sample Buyer';
  const supplierName = 'Decaste E2E Sample Material Mill';
  const processorName = 'Decaste E2E Sample Embroidery';
  const buyer = party('BUY', 'Buyer', buyerName);
  const supplier = party('SUP', 'Supplier', supplierName);
  const processor = party('PROCESSOR', 'Processor', processorName);

  const approval = (role, partyId, facility, operation, suffix) => {
    const ev = post('evidence', { scheme: 'Buyer code', kind: 'Buyer approval', role, partyId, site: facility,
      number: code(suffix), scopeType: 'Facility', operations: operation, from: day, notes: 'Synthetic buyer approval for Decaste trial only.' });
    post('review-evidence', { evidenceId: ev, status: 'Verified', scopeConfirmed: 'yes', method: 'Buyer acceptance', source: 'Approved synthetic buyer site list', verifiedOn: day });
    return ev;
  };
  post('claim-rule', { scheme: 'Buyer code', scopeType: 'Facility', operation: 'Supply', site: supplierSite,
    kinds: 'Buyer approval', version: '1', reference: 'Trial source approval', source: 'Decaste pilot sourcing list', effective: day });
  const supplyEvidence = approval('Supplier', supplier, supplierSite, 'Supply', 'SUP-EVIDENCE');

  const orderId = post('buyer-order', { po: prefix, buyerId: buyer, currency: 'INR', totalPieces: 300,
    notes: 'E2E test records only. Mixed route, partial embroidery and two partial shipments.' });
  const route = post('route-master', { code: code('RT'), name: 'Decaste mixed-route garment assembly trial', version: '1',
    stages: 'Cutting,Embroidery,Stitching,Garment finishing,Final inspection,Packing' });
  const lineId = post('po-line', { orderId, style: 'Woven overshirt with rib collar', color: 'Navy', size: 'M', sku: code('NAVY-M'), price: 600,
    unit: 'pcs', qty: 300, route, product: 'Packed carton', delivery: day, specRev: 'A', approvedSpec: 'Yarn-dyed woven shell and fabric-dyed knitted collar.' });
  post('garment-spec', { lineId, specRev: 'A', techPack: JSON.stringify({
    fabrics: [
      { code: 'SHELL', role: 'Shell', structure: 'Plain', construction: { fabricType: 'Woven', fabricStructure: 'Plain', gsm: 140 },
        grossWidth: 150, pattern: 'Front,1,3200\nBack,1,3300', blend: 'Cotton,100', finish: 'Stenter and inspect' },
      { code: 'RIB', role: 'Rib', structure: 'Rib 1x1', construction: { fabricType: 'Knitted', fabricStructure: 'Rib 1x1', gsm: 220 },
        grossWidth: 45, pattern: 'Collar,1,600', blend: 'Cotton,100', finish: 'Compact and inspect' },
    ],
    poms: [{ code: 'LENGTH', name: 'Body length', target: 70, tolerance: '1', unit: 'cm', method: 'Measure from high shoulder point to hem with the garment laid flat.' }],
  }) });
  post('approve-line', { lineId, notes: 'Approved synthetic tech pack and production route.' });
  const componentRoute = (component, template) => post('component-route', { lineId, component, template, effective: day, reference: code('ROUTE-' + component) });
  const shellRoute = componentRoute('SHELL', 'B');
  const ribRoute = componentRoute('RIB', 'C');
  const wo = (suffix, stage, plannedQty, componentRouteId = '', rework = '', unit = componentRouteId ? 'kg' : 'pcs') =>
    post('work-order', { number: code(suffix), stage, plannedQty, unit, lineId, componentRouteId, locationId: loc, rework });
  const machine = (suffix, name) => post('machine-master', { code: code(suffix), name, status: 'In service', locationId: loc });
  const item = (suffix, type, unit, composition = '') => post('item-master', { code: code(suffix), name: code(suffix), type, unit, composition });
  const inspect = (lotId, decision = 'Released', notes = 'Approved on the Decaste trial check sheet') => {
    post('quality', { lotId, decision, reference: lotId + '-Q-' + decision, notes });
    return ref(state().lots, lotId).inspectionId;
  };
  const receipt = (suffix, itemId, qty) => {
    const lotId = code(suffix);
    post('receipt', { lotId, itemId, qty, mode: 'Direct inward', origin: supplierSite, supplierId: supplier,
      supplierLot: code('SUP-' + suffix), locationId: loc, reference: code('GRN-' + suffix) });
    inspect(lotId);
    return lotId;
  };
  const raw = item('YARN', 'Yarn', 'kg', '100% cotton');
  const cone = item('YARN-CONE', 'Yarn', 'cone', '100% cotton');
  const dye = item('DYE', 'Chemical', 'kg');
  const warpYarn = receipt('RAW-WARP', raw, 51);
  const weftYarn = receipt('RAW-WEFT', raw, 30);
  const ribYarn = receipt('RAW-RIB', raw, 17);
  const unweighed = receipt('UNWEIGHED', cone, 2);
  const chemical = receipt('DYE-LOT', dye, 3);
  const dyeMachine = machine('JET', 'Trial dye machine');
  const ware = machine('WARPER', 'Trial warping machine');
  const loom = machine('LOOM', 'Trial rapier loom');
  const knit = machine('RIB-KNIT', 'Trial rib knitting machine');
  const finishMachine = machine('FIN', 'Trial fabric finishing machine');
  function step(action, batchId, name, hour, more = {}) {
    const h = String(hour).padStart(2, '0');
    return post(action, { batchId, step: name, start: day + 'T' + h + ':00', end: day + 'T' + h + ':35',
      operator: 'Trial operator', shift: 'A', reference: code(batchId + '-' + name), ...more });
  }
  const dyeRecipe = post('dye-setup', { code: code('NAVY'), version: '1', colour: 'Navy', shade: 'Navy trial', effective: day, reference: code('LAB-YARN') });
  function dyeYarn(suffix, input, kg, finished, mixedTest = false) {
    const w = wo(suffix + '-YARN-WO', 'Yarn dyeing', finished, shellRoute);
    const b = post('dye-batch', { workOrderId: w, machineId: dyeMachine, recipeId: dyeRecipe, number: code(suffix + '-YDB'), plannedKg: kg });
    if (mixedTest) unchanged('Mixed unit without conversion blocked', () => run('dye-issue', {
      batchId: b, lines: input + ',' + kg + '\n' + unweighed + ',1', reference: code('BAD-WEIGHT'),
    }), error => error.code === 'conversion');
    post('dye-issue', { batchId: b, lines: input + ',' + kg, reference: code(suffix + '-YDI') });
    step('dye-entry', b, 'Dyeing', 6, { chemicals: chemical + ',0.35', electricity: 12, water: 350, steam: 18 });
    step('dye-entry', b, 'Soaping / washing', 7, { water: 120 });
    const output = code(suffix + '-DYED');
    post('dye-output', { batchId: b, outputId: output, outputQty: finished, unit: 'kg', waste: round(kg - finished), reference: code(suffix + '-YDO') });
    post('dye-close', { batchId: b, reason: 'Yarn dye run reconciled' });
    inspect(output);
    return output;
  }
  const dyedWarp = dyeYarn('WARP', warpYarn, 51, 50, true);
  const dyedWeft = dyeYarn('WEFT', weftYarn, 30, 29);
  post('loom-setup', { machineId: loom, type: 'Rapier', widthCm: 190, selectors: 4, shedding: 'Plain draft', effective: day, reference: code('LOOM-AUDIT') });
  const weavePlan = post('weave-setup', { code: code('WV'), version: '1', effective: day, bomCode: 'SHELL', weave: 'Plain', yarnDyed: 'yes', ends: 3600,
    warpSequence: 'Navy,1', weftSequence: 'Navy,1', reedSpaceCm: 150, picksPerCm: 26, warpCount: 30, weftCount: 30,
    countSystem: 'Ne', warpCrimp: '0', weftCrimp: 4, weftPrep: 'None', loomType: 'Rapier', widthCm: 150, gsm: 140, reference: code('WV-APP') });
  const warpOrder = wo('WARP-WO', 'Warping', 50, shellRoute);
  const loomOrder = wo('LOOM-WO', 'Weaving', 76, shellRoute);
  post('yarn-assign', { lotId: dyedWarp, workOrderId: warpOrder, role: 'Warp', qty: 50, reference: code('WARP-ASSIGN') });
  post('yarn-assign', { lotId: dyedWeft, workOrderId: loomOrder, role: 'Weft', qty: 29, reference: code('WEFT-ASSIGN') });
  const warpBatch = post('warp-open', { workOrderId: warpOrder, recipeId: weavePlan, machineId: ware, number: code('WARP-SET'), plannedKg: 50 });
  post('warp-issue', { batchId: warpBatch, lines: dyedWarp + ',50', reference: code('WARP-IN') });
  step('warp-entry', warpBatch, 'Warping', 8, { electricity: 8 });
  const beam = code('BEAM');
  post('warp-beams', { batchId: warpBatch, beams: beam + ',3600,600,50', reference: code('DOFF-BEAM') });
  post('warp-close', { batchId: warpBatch, reason: 'Trial loom beam doffed' });
  post('beam-dress', { lotId: beam, loomId: loom, method: 'Drawing-in', ends: 3600, healds: 'Plain draft', reed: '150 cm reed', operator: 'Trial operator', reference: code('DRESS') });
  const loomBatch = post('loom-open', { workOrderId: loomOrder, recipeId: weavePlan, machineId: loom, number: code('LOOM-RUN'), plannedKg: 79 });
  post('loom-issue', { batchId: loomBatch, lines: beam + ',50', reference: code('LOOM-BEAM-ISSUE') });
  unchanged('Missing weft lot blocked', () => step('loom-entry', loomBatch, 'Weaving', 8, { weftFeed: 'F1,' + dyedWeft }), /not issued to loom run/);
  post('loom-issue', { batchId: loomBatch, lines: dyedWeft + ',29', reference: code('LOOM-WEFT-ISSUE') });
  step('loom-entry', loomBatch, 'Weaving', 8, { weftFeed: 'F1,' + dyedWeft, electricity: 45 });
  const shellGreige = code('SHELL-WOVEN');
  post('loom-roll', { batchId: loomBatch, rollId: shellGreige, metres: 570, kg: 76, waste: 0.5, reference: code('WOVEN-ROLL') });
  post('loom-return', { batchId: loomBatch, lines: beam + ',2.5', reference: code('BEAM-REMNANT') });
  post('loom-close', { batchId: loomBatch, reason: 'Roll doffed and beam remnant returned' });
  inspect(shellGreige);
  results['Woven yarn-dyed shell with actual warp and weft'] = 'Passed';

  post('knit-machine', { machineId: knit, type: 'Circular double jersey (rib/interlock)', gauge: 18, diameter: 30, feeders: 60, effective: day, reference: code('KNIT-AUDIT') });
  const ribPlan = post('knit-setup', { code: code('RIB-KC'), version: '1', effective: day, component: 'Rib', bomCode: 'RIB', structure: 'Rib 1x1',
    feeds: 'Ground,30,Ne', machineType: 'Circular double jersey (rib/interlock)', gauge: 18, diameter: 30, stitchLength: 2.9,
    gsm: 220, width: '45 cm open', reference: code('RIB-APP') });
  const knitRun = post('knit-open', { workOrderId: wo('KNIT-WO', 'Knitting', 16.5, ribRoute), recipeId: ribPlan, machineId: knit, number: code('KNIT-RUN'), plannedKg: 17 });
  post('knit-issue', { batchId: knitRun, lines: ribYarn + ',17', reference: code('KNIT-ISSUE') });
  step('knit-entry', knitRun, 'Knitting', 9, { electricity: 9 });
  const greigeRib = code('RIB-GREIGE');
  post('knit-output', { batchId: knitRun, rolls: greigeRib + ',16.5,162', waste: 0.5, reference: code('KNIT-DOFF') });
  post('knit-close', { batchId: knitRun, reason: 'Rib stock reconciled' });
  inspect(greigeRib);
  const fdRecipe = post('fdye-setup', { code: code('RIB-DYE'), version: '1', shade: 'Navy', colour: 'Navy', fabricKind: 'Knitted', effective: day, reference: code('LAB-RIB') });
  const fd = post('fdye-open', { workOrderId: wo('RIB-DYE-WO', 'Fabric dyeing', 16, ribRoute), recipeId: fdRecipe, machineId: dyeMachine,
    number: code('RIB-DYE-RUN'), plannedKg: 16.5 });
  post('fdye-issue', { batchId: fd, lines: greigeRib + ',16.5', reference: code('RIB-DYE-ISSUE') });
  for (const [idx, name] of ['Loading', 'Dyeing', 'Washing / soaping', 'Unloading'].entries()) step('fdye-entry', fd, name, 10 + idx,
    name === 'Dyeing' ? { chemicals: chemical + ',0.2', water: 120, electricity: 6 } : {});
  const dyedRib = code('RIB-DYED');
  post('fdye-rolls', { batchId: fd, rolls: dyedRib + ',16,19,157,' + greigeRib, waste: 0.5, reference: code('RIB-DYE-DOFF') });
  post('fdye-close', { batchId: fd, reason: 'Fabric dye yields reconciled' });
  inspect(dyedRib);
  results['Knitted fabric-dyed rib'] = 'Passed';

  function finishFabric(component, routeId, source, inputKg, outKg, metres, width, gsm, operation) {
    const recipeId = post('finish-plan', { componentRouteId: routeId, code: code(component + '-FIN'), version: '1',
      steps: operation + ' | Approved Decaste trial setting', reference: code(component + '-FIN-APP'), effective: day });
    const workOrderId = post('finish-order', { recipeId, number: code(component + '-FIN-WO'), locationId: loc, plannedQty: outKg });
    const batchId = post('finish-open', { workOrderId, recipeId, machineId: finishMachine, number: code(component + '-FIN-B'), plannedKg: inputKg });
    post('finish-issue', { batchId, lines: source + ',' + inputKg, reference: code(component + '-FIN-IN') });
    step('finish-entry', batchId, operation, 15, { electricity: 8, steam: 5 });
    const out = code(component + '-ROLL');
    post('finish-rolls', { batchId, rolls: [out, source, inputKg, outKg, metres, width, gsm].join(','), waste: round(inputKg - outKg), reference: code(component + '-FIN-OUT') });
    post('finish-close', { batchId, reason: 'Roll reconciled' });
    inspect(out);
    return out;
  }
  const shell = finishFabric('SHELL', shellRoute, shellGreige, 76, 74, 560, 150, 140, 'Stentering');
  const rib = finishFabric('RIB', ribRoute, dyedRib, 16, 15.8, 155, 45, 220, 'Compacting');
  function cut(component, routeId, roll, issueKg, spreadKg, waste, markerLength, positions) {
    const markerId = post('cut-marker', { lineId, component, componentRouteId: routeId, code: code(component + '-MARKER'), version: '2',
      metres: markerLength, setsPerPly: 1, reference: code(component + '-MARKER-APP'), effective: day });
    const workOrderId = wo(component + '-CUT-WO', 'Cutting', 300);
    const batchId = post('cut-lay', { workOrderId, markerId, number: code(component + '-LAY'), shadeGroup: 'Navy-1', plies: 300,
      inputs: roll + ',' + issueKg + ',,,Navy-1', reference: code(component + '-CUT-IN') });
    post('cut-spread', { batchId, rolls: [roll, spreadKg, 300, waste].join(','), operator: 'Trial spreader', shift: 'A', reference: code(component + '-SPREAD') });
    if (component === 'SHELL') unchanged('Excess panel quantity blocked', () => run('cut-bundles', {
      batchId, bundles: [code('EXCESS'), 'Front', 1, 301, roll + ':301'].join(','), reference: code('EXCESS-CUT'),
    }), /numbering exceeds the approved lay/);
    const bundling = { batchId, bundles: positions.map(position => [code(position.toUpperCase()), position, 1, 300, roll + ':300'].join(',')).join('\n'),
      reference: code(component + '-BUNDLE') };
    const requestId = code(component + '-BUNDLE-ACT');
    const first = run('cut-bundles', bundling, requestId);
    const snapshot = state();
    assert.equal(run('cut-bundles', bundling, requestId).replayed, true);
    assert.deepEqual(state(), snapshot);
    unchanged('Duplicate bundle posting blocked', () => run('cut-bundles', bundling), /post this lay.s bundles once/);
    assert.equal(first.id, batchId);
    post('cut-return', { batchId, lines: [roll, round(issueKg - spreadKg), code(component + '-REMNANT')].join(','), reference: code(component + '-REMNANT-RET') });
    return batchId;
  }
  const shellLay = cut('SHELL', shellRoute, shell, 74, 72, 1, 1.8, ['Front', 'Back']);
  const ribLay = cut('RIB', ribRoute, rib, 15.8, 15.5, 0.2, 0.5, ['Collar']);
  results['Cutting, shade, marker, numbering and remnants'] = 'Passed';

  post('claim-rule', { scheme: 'Buyer code', scopeType: 'Facility', operation: 'Embroidery', lineId, effective: day,
    kinds: 'Buyer approval', version: '1', source: 'Trial buyer accepted processor list' });
  const processorEvidence = approval('Processor', processor, processorSite, 'Embroidery', 'EMB-SITE-EVIDENCE');
  const thread = item('THREAD', 'Thread', 'kg');
  const backing = item('BACKING', 'Backing', 'm');
  const art = post('print-artwork', { lineId, stage: 'Embroidery', code: code('EMB-ART'), version: '1', effective: day,
    method: 'Multihead embroidery', design: 'Decaste trial wordmark', designFile: 'Decaste-Wordmark-R1.dst', placement: 'Shell front chest', reference: code('EMB-APP') });
  const ew = post('print-order', { artworkId: art, number: code('EMB-WO'), unit: 'pcs', plannedQty: 300, locationId: loc });
  const outward = { workOrderId: ew, mode: 'Commission', number: code('EMB-BATCH'), processorId: processor, site: processorSite,
    challan: code('EMB-OUT'), inputs: code('FRONT') + ',300' };
  unchanged('Out-of-scope processor blocked', () => run('print-issue', { ...outward, site: 'Unapproved alternate site' }), error => error.code === 'standard-lock');
  const eb = post('print-issue', outward);
  post('print-operation', { batchId: eb, operation: 'Embroidery', lotId: code('FRONT'), qty: 300, machine: 'Trial multihead 6',
    heads: 6, stitches: 2400, supplies: code('THREAD') + ',EXT-TH-01,0.4\n' + code('BACKING') + ',EXT-BK-01,22', reference: code('EMB-RUN') });
  const er = ref(state().processBatches, eb).runs[0].id;
  const embLots = [code('EMB-200'), code('EMB-100')];
  const jobId = ref(state().processBatches, eb).jobId;
  post('print-output', { batchId: eb, runId: er, used: 200, outputs: 'Accepted,' + embLots[0] + ',200', reference: code('EMB-IN-1') });
  const interim = ref(state().jobs, jobId);
  assert.deepEqual([interim.sent, interim.qty, interim.status], [300, 100, 'Part returned']);
  const balanceAfterFirst = interim.qty;
  post('print-output', { batchId: eb, runId: er, used: 100, outputs: 'Accepted,' + embLots[1] + ',100', reference: code('EMB-IN-2') });
  assert.equal(ref(state().jobs, jobId).qty, 0);
  assert.equal(ref(state().lots, embLots[0]).panel.layId, shellLay);
  results['Embroidery 300 out, 200 first return, 100 outstanding then reconciled'] = 'Passed';

  const sewingThread = receipt('SEW-THREAD', thread, 1.2);
  const buttons = receipt('BUTTONS', item('BUTTON', 'Button', 'pcs'), 600);
  const labels = receipt('LABELS', item('LABEL', 'Label', 'pcs'), 300);
  const cartons = receipt('CARTON-STOCK', item('CARTON', 'Carton', 'carton'), 2);
  const plan = (suffix, process, steps, components = '') => post('garment-plan', { lineId, process, code: code(suffix), version: '1',
    steps, components, effective: day, reference: code(suffix + '-APP') });
  const sewPlan = plan('SEW-PLAN', 'Stitching', 'Join shell panels\nAttach rib collar\nAttach buttons',
    'SHELL,Front,1,Embroidery\nSHELL,Back,1\nRIB,Collar,1');
  const sewWo = wo('SEW-WO', 'Stitching', 300);
  const sewInputs = embLots[0] + ',200\n' + embLots[1] + ',100\n' + code('BACK') + ',300\n' + code('COLLAR') + ',300\n' + sewingThread + ',1.2\n' + buttons + ',600';
  const sewBatch = post('garment-issue', { workOrderId: sewWo, planId: sewPlan, number: code('SEW-BATCH'), floorLine: 'Sewing line A',
    plannedQty: 300, inputs: sewInputs, reference: code('SEW-ISSUE') });
  const op = (batchId, step, qty, suffix, more = {}) => post('garment-operation', { batchId, step, qty, operator: 'Trial operator', shift: 'A',
    reference: code(suffix), ...more });
  op(sewBatch, 1, 300, 'SEW-1', { electricity: 8 });
  post('garment-line-transfer', { batchId: sewBatch, floorLine: 'Sewing line B', reference: code('SEW-TRANSFER'), notes: 'Move to collar line' });
  op(sewBatch, 2, 300, 'SEW-2', { electricity: 6 });
  op(sewBatch, 3, 300, 'SEW-3', { electricity: 3 });
  const sewn = code('SEWN');
  post('garment-output', { batchId: sewBatch, outputId: sewn, inputs: sewInputs, qty: 300, netKg: 87, reference: code('SEWN-OUTPUT') });
  assert.ok([shell, rib].every(lotId => genealogy(state(), sewn).some(lot => lot.id === lotId)));
  inspect(sewn);
  results['Stitching with actual shell and rib component usage'] = 'Passed';

  const finishing = plan('FINISH-GARMENT', 'Garment finishing', 'Thread trimming\nPressing\nMeasurements\nTagging');
  const finWo = wo('GARMENT-FIN-WO', 'Garment finishing', 300);
  const fin = post('garment-issue', { workOrderId: finWo, planId: finishing, floorLine: 'Finishing line A', number: code('GARMENT-FIN'),
    plannedQty: 300, inputs: sewn + ',300\n' + labels + ',300', reference: code('GARMENT-FIN-ISSUE') });
  [1, 2, 3, 4].forEach(n => op(fin, n, 300, 'GARMENT-FIN-' + n, n === 2 ? { steam: 12, electricity: 9 } : {}));
  const good = code('RELEASED-298');
  const defective = code('FIN-HOLD-2');
  post('garment-output', { batchId: fin, outputId: good, inputs: sewn + ',298\n' + labels + ',298', qty: 298, netKg: 86.42,
    measurements: 'Body length,cm,70', reference: code('FIN-GOOD') });
  post('garment-output', { batchId: fin, outputId: defective, inputs: sewn + ',2\n' + labels + ',2', qty: 2, netKg: 0.58,
    measurements: 'Body length,cm,70.3', reference: code('FIN-HOLD') });
  inspect(good);
  const earlierInspection = inspect(defective, 'Rework', 'Press mark correction required on two garments');
  const rwWo = wo('FIN-RW-WO', 'Garment finishing', 2, '', 'yes');
  const rw = post('garment-issue', { workOrderId: rwWo, planId: finishing, floorLine: 'Finishing rework', number: code('FIN-REWORK'),
    plannedQty: 2, inputs: defective + ',2', reference: code('FIN-RW-ISSUE') });
  [1, 2, 3, 4].forEach(n => op(rw, n, 2, 'FIN-RW-' + n, n === 2 ? { steam: 0.4 } : {}));
  const recovered = code('RELEASED-RW-2');
  post('garment-output', { batchId: rw, outputId: recovered, inputs: defective + ',2', qty: 2, netKg: 0.58,
    measurements: 'Body length,cm,70.1', reference: code('FIN-RW-OUT') });
  assert.equal(ref(state().lots, recovered).qualityStatus, 'Pending inspection');
  const reinspection = inspect(recovered, 'Released', 'Press marks corrected. Reinspection accepted both pieces.');
  assert.deepEqual(ref(state().events, reinspection).earlierInspections, [earlierInspection]);
  results['Finishing rework reinspection and controlled release to packing'] = 'Passed';

  const packing = post('packing-plan', { orderId, code: code('PACK-PLAN'), version: '1', effective: day, assortment: lineId + ',150',
    instructions: 'Solid SKU M, 150 pieces per carton. Record pallet, net weight and gross weight.', reference: code('PACK-APP') });
  const packWo = wo('PACK-WO', 'Packing', 300);
  const cartonIds = [code('CARTON-A'), code('CARTON-B')];
  const shipmentIds = [];
  const invoiceIds = [];
  const salesVouchers = [];
  const costs = [];
  for (const [lotId, net] of [[warpYarn, 2500], [weftYarn, 1600], [ribYarn, 1300], [chemical, 900], [sewingThread, 5500], [buttons, 6500], [labels, 1600], [cartons, 400]]) {
    const c = post('cost', { lotId, supplierId: supplier, category: 'Material', reference: lotId + '-BILL', net });
    costs.push(c);
    post('account-erp-purchase', { sourceId: c });
  }
  for (const [i, lotId] of embLots.entries()) {
    const c = post('cost', { lotId, category: 'Job work', reference: code('EMB-BILL-' + i), net: i ? 1500 : 3000 });
    costs.push(c);
    const v = post('account-erp-purchase', { sourceId: c });
    assert.equal(ref(state().vouchers, v).source.jobId, jobId);
  }
  for (const [i, cartonId] of cartonIds.entries()) {
    const packInput = { workOrderId: packWo, planId: packing, cartonId, cartonLotId: cartons, labelRef: code('LABEL-' + (i + 1)),
      pallet: code('PALLET-' + (i + 1)), locationId: fg, netKg: 43.5, grossKg: 45 };
    const lines = i ? good + ',' + lineId + ',148\n' + recovered + ',' + lineId + ',2' : good + ',' + lineId + ',150';
    if (i) unchanged('Only reinspected garments available for packing', () => run('pack-carton', {
      ...packInput, contents: good + ',' + lineId + ',148\n' + defective + ',' + lineId + ',2',
    }), /quality released garments/);
    post('pack-carton', { ...packInput, contents: lines });
    const ship = { number: code('SHIP-' + (i + 1)), items: cartonId + ',' + lineId + ',150', destination: 'Decaste test buyer terminal',
      carrier: 'Sample local carrier', tracking: code('TRACK-' + (i + 1)), originPort: 'Trial origin terminal', destinationPort: 'Trial buyer terminal',
      challan: code('SHIP-DC-' + (i + 1)), legs: 'Trial origin terminal,Trial buyer terminal,Road,Sample carrier,' + day + ',' + day + ',' + code('TRACK-' + (i + 1)) };
    const shipmentId = post('dispatch', ship);
    shipmentIds.push(shipmentId);
    assert.equal(shippedQty(state(), lineId), (i + 1) * 150);
    unchanged('Duplicate carton dispatch blocked', () => run('dispatch', { ...ship, number: code('DUP-' + (i + 1)) }), /already been dispatched/);
    post('delivery', { shipmentId, reference: code('POD-' + (i + 1)) });
    const invoiceId = post('invoice', { shipmentId, number: code('INV-' + (i + 1)), cgst: 2250, sgst: 2250, taxRef: 'Synthetic GST amounts for voucher testing' });
    invoiceIds.push(invoiceId);
    salesVouchers.push(post('account-erp-sales', { sourceId: invoiceId }));
    post('account-cogs', { shipmentId, note: 'Approved trial lot genealogy valuation' });
    unchanged('Duplicate Accounts voucher blocked', () => run('account-erp-sales', { sourceId: invoiceId }), /already has an active voucher/);
  }
  results['Two partial shipments, complete carton contents and PO reconciliation'] = 'Passed';
  results['Inventory, commission service bills, GST and sales vouchers'] = 'Passed';

  const profileId = post('dpp-profile', { code: code('GARMENT-DPP'), version: '1', product: 'Garment', market: 'India local trial',
    reference: 'Decaste pilot buyer mapping, sample only', requiredPoints: '20,21,33', effective: day });
  const fabricProfile = post('dpp-profile', { code: code('FABRIC-DPP'), version: '1', product: 'Fabric', market: 'India local trial',
    reference: 'Decaste pilot buyer mapping, sample only', effective: day });
  const passportId = post('passport', { lotId: cartonIds[1], profileId, factor: 0.7,
    factorRef: 'Approved synthetic 0.7 factor and measured trial inputs', compositionSource: 'Approved tech pack A and actual component issue',
    boundary: 'Energy and water recorded on the trial routes, attributed by actual lot quantity.' });
  const fabricPassportId = post('passport', { lotId: shell, profileId: fabricProfile, boundary: 'Recorded woven trial route activity',
    compositionSource: 'Shell component spec A', factorRef: 'Trial water readings on the yarn dyeing and shell finishing jobs.' });
  const s = state();
  const p = ref(s.passports, passportId);
  assert.equal(p.points.length, 49);
  assert.equal(p.calculationVersion, 'HZ-DPP-2');
  assert.ok(p.sources.processors.some(j => j.jobId === jobId && j.checks.flatMap(row => row.evidence).some(e => e.id === processorEvidence)));
  assert.ok(p.sources.lots.find(l => l.lotId === warpYarn).checks.flatMap(row => row.evidence).some(e => e.id === supplyEvidence));
  assert.ok([dyedWarp, dyedWeft, shell, rib, defective, recovered].every(lotId => p.sources.lots.some(l => l.lotId === lotId)));
  assert.equal(p.co2, round(p.electricity * p.factor / p.weight));
  assert.equal(store.publicPassport(p.token), null);
  assert.ok(p.sources.events.filter(e => e.kind === 'Quality inspection').some(e => e.id === earlierInspection));
  assert.equal(ref(s.passports, fabricPassportId).status, 'Draft');
  const forward = new Set(genealogy(s, warpYarn, true).map(l => l.id));
  assert.ok(shipmentIds.every(id => ref(s.shipments, id).lotIds.some(lotId => forward.has(lotId))));
  assert.ok(cartonIds.every(id => ref(s.lots, id).qty === 0 && lotCost(s, ref(s.lots, id)) > 0));
  assert.ok([good, defective, recovered, sewn].every(id => ref(s.lots, id).qty === 0));
  assert.equal(ref(s.jobs, jobId).qty, 0);
  assert.equal(shippedQty(s, lineId), 300);
  assert.deepEqual(orderWorkflow(s, orderId, lineId).vouchers.filter(v => v.source?.type === 'Sales invoice').map(v => v.id), salesVouchers);
  for (const [i, shipmentId] of shipmentIds.entries()) {
    const shipment = ref(s.shipments, shipmentId);
    assert.equal(shipment.packingList[0].cartonId, cartonIds[i]);
    assert.equal(sum(shipment.packingList[0].contents), 150);
    const costed = s.vouchers.find(v => v.source?.type === 'Shipment valuation' && v.source.id === shipmentId);
    assert.equal(costed.lines.find(l => l.a === 'COGS').d, Math.round(lotCost(s, ref(s.lots, cartonIds[i])) * 100));
  }
  const accounts = accountTotals(book(s));
  assert.equal(sum(accounts, a => a.d - a.c), 0);
  assert.equal(ref(accounts, 'AR').d, 18900000);
  assert.equal(ref(accounts, 'GSTOUT').c, 900000);
  assert.equal(ref(accounts, 'STOCK').d, 2480000);
  assert.equal(ref(accounts, 'STOCK').d - ref(accounts, 'STOCK').c,
    sum(s.lots.filter(l => l.qty > 0), l => Math.round(lotCost(s, l) * l.qty / l.initialQty * 100)));
  results['Carton backward trace and source lot forward to both shipments'] = 'Passed';
  results['49-point fabric and garment draft calculation and internal source records'] = 'Passed';
  return { prefix, orderId, lineId, shellRoute, ribRoute, shellLay, ribLay, shell, rib, eb, jobId, balanceAfterFirst, sewBatch, fin, rw, recovered, cartonIds,
    shipmentIds, invoiceIds, salesVouchers, costs, passportId, fabricPassportId, warpYarn, weftYarn, results };
}
