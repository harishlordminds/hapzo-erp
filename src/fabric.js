import { choice, clean, decimal, ensure, genealogy, norm, ref, req, round } from './model.js';

const INCH_M = 0.0254;
const COTTON_COUNT_FACTOR = 453.59237 * 1000 / (840 * 0.9144);
export const FABRIC_TYPES = ['Woven', 'Knitted'];
export const FABRIC_CONDITIONS = ['Greige', 'Dyed', 'Finished'];
export const YARN_COUNT_UNITS = ['Ne', 'tex', 'Nm', 'denier'];

export const FABRIC_INPUTS = {
  Woven: [
    ['warpThreads', 'Warp ends counted'], ['weftThreads', 'Weft picks counted'],
    ['warpCount', 'Warp yarn count'], ['weftCount', 'Weft yarn count'],
    ['warpCrimp', 'Warp crimp %'], ['weftCrimp', 'Weft crimp %'],
  ],
  Knitted: [
    ['waleThreads', 'Wales counted'], ['courseThreads', 'Courses counted'],
    ['loopLength', 'Stitch length (mm)'], ['yarnCount', 'Yarn count'],
    ['repeatYarnMm', 'Yarn in one pattern repeat (mm)'], ['repeatCells', 'Wale × course cells in that repeat'],
    ['gauge', 'Nominal machine gauge (needles/in)'], ['needlePositions', 'Needle positions on one cylinder'],
    ['cylinderIn', 'Cylinder diameter at the needle line (in)'], ['needlePitchMm', 'Needle pitch (mm)'],
  ],
};

export const FABRIC_METRICS = {
  gsm: { label: 'GSM', unit: 'g/m²' },
  epi: { label: 'Warp ends (EPI)', unit: 'ends/in' },
  ppi: { label: 'Weft picks (PPI)', unit: 'picks/in' },
  warpCount: { label: 'Warp yarn count' },
  weftCount: { label: 'Weft yarn count' },
  wpi: { label: 'Wales (WPI)', unit: 'wales/in' },
  cpi: { label: 'Courses (CPI)', unit: 'courses/in' },
  loopLength: { label: 'Stitch length', unit: 'mm' },
  yarnCount: { label: 'Yarn count' },
  gauge: { label: 'Machine gauge', unit: 'needles/in' },
};

const metricKeys = {
  Woven: ['gsm', 'epi', 'ppi', 'warpCount', 'weftCount'],
  Knitted: ['gsm', 'wpi', 'cpi', 'loopLength', 'yarnCount', 'gauge'],
};
export const fabricMetrics = type => metricKeys[type] ?? [];
export const isYarnCount = key => ['warpCount', 'weftCount', 'yarnCount'].includes(key);
export const toleranceField = key => 'fabricTol' + key[0].toUpperCase() + key.slice(1);
export const fabricCondition = lot => ({
  'Greige fabric': 'Greige', 'Dyed fabric': 'Dyed', 'Finished fabric': 'Finished', 'Inspected fabric': 'Finished',
})[lot?.material] ?? '';

const hasValue = value => value !== undefined && value !== null && String(value).trim() !== '';
const optionalNumber = (value, label, min = 0.000001) => hasValue(value) ? decimal(value, label, min) : null;
const divide = (value, by) => value != null && by > 0 ? value / by : null;
const structureKey = value => norm(value).replace(/\s+/g, ' ');

function isPlainSingleJersey(structure) {
  const name = structureKey(structure).replace(/[‐‑–—]/g, '-');
  const jersey = /\b(?:(?:single|plain)[ -]+jersey|s\s*\/\s*j|sj)\b/;
  const variants = /\b(?:rib|interlock|double|piqu[eé]|lacoste|fleece|terry|jacquard|mesh|plated|plating|tucks?|floats?|elastane|spandex|lycra)\b/;
  return jersey.test(name) && !variants.test(name);
}

export function convertTex(value, system) {
  if (value == null || value <= 0) return null;
  if (system === 'Ne') return COTTON_COUNT_FACTOR / value;
  if (system === 'Nm') return 1000 / value;
  if (system === 'denier') return value / 9;
  return value;
}

export function convertFromTex(value, system) {
  if (value == null || value <= 0) return null;
  return system === 'denier' ? value * 9 : convertTex(value, system);
}

function readConstruction(x, type, partial) {
  const structure = clean(x.fabricStructure, 100);
  const countUnit = choice(x.countUnit || 'Ne', YARN_COUNT_UNITS, 'yarn count system');
  const inputs = {};
  for (const [key, label] of [['countSpanIn', 'Count span'], ...FABRIC_INPUTS[type]]) {
    const value = optionalNumber(x[key], label, key.endsWith('Crimp') ? 0 : undefined);
    if (value != null) inputs[key] = value;
  }
  if (type === 'Knitted') {
    for (const key of ['repeatCells', 'needlePositions']) {
      ensure(inputs[key] == null || Number.isInteger(inputs[key]), FABRIC_INPUTS.Knitted.find(row => row[0] === key)[1] + ' must be a whole number.');
    }
    if (!partial) {
      ensure((inputs.repeatYarnMm == null) === (inputs.repeatCells == null), 'Enter both the yarn length and the number of cells in a knit repeat.');
      ensure((inputs.needlePositions == null) === (inputs.cylinderIn == null), 'Enter both cylinder diameter and needle positions to calculate circular machine gauge.');
      ensure(inputs.needlePitchMm == null || inputs.needlePositions == null, 'Use either needle pitch or cylinder dimensions to calculate machine gauge.');
    }
  }
  return { type, structure, countUnit, inputs };
}

function woven(values, countUnit, targetGsm) {
  const { countSpanIn = 1, warpThreads, weftThreads, warpCount, weftCount, warpCrimp = 0, weftCrimp = 0 } = values;
  const epi = divide(warpThreads, countSpanIn);
  const ppi = divide(weftThreads, countSpanIn);
  // Yarn length in one square metre, converted to kilometres and adjusted for crimp.
  const warpPerEpi = (1 + warpCrimp / 100) / (INCH_M * 1000);
  const weftPerPpi = (1 + weftCrimp / 100) / (INCH_M * 1000);
  const warp = epi * warpPerEpi;
  const weft = ppi * weftPerPpi;
  const warpTex = convertTex(warpCount, countUnit);
  const weftTex = convertTex(weftCount, countUnit);
  const warpGsm = warp * warpTex;
  const weftGsm = weft * weftTex;
  const bothDensities = epi != null && ppi != null;
  const bothCounts = warpTex != null && weftTex != null;
  return {
    epi, ppi, warpCount, weftCount,
    estimatedGsm: bothDensities && bothCounts ? warpGsm + weftGsm : null,
    requiredEpi: targetGsm > weftGsm && bothCounts && epi == null && ppi != null ? (targetGsm - weftGsm) / (warpPerEpi * warpTex) : null,
    requiredPpi: targetGsm > warpGsm && bothCounts && ppi == null && epi != null ? (targetGsm - warpGsm) / (weftPerPpi * weftTex) : null,
    idealEqualCount: targetGsm && bothDensities ? convertFromTex(targetGsm / (warp + weft), countUnit) : null,
    idealWarpCount: targetGsm && bothDensities && weftCount ? convertFromTex((targetGsm - weftGsm) / warp, countUnit) : null,
    idealWeftCount: targetGsm && bothDensities && warpCount ? convertFromTex((targetGsm - warpGsm) / weft, countUnit) : null,
  };
}

function knitted(values, structure, countUnit, targetGsm) {
  const { countSpanIn = 1, waleThreads, courseThreads, loopLength, yarnCount, repeatYarnMm, repeatCells,
    gauge, needlePositions, cylinderIn, needlePitchMm } = values;
  const wpi = divide(waleThreads, countSpanIn);
  const cpi = divide(courseThreads, countSpanIn);
  const cellsPerSquareInch = wpi && cpi ? wpi * cpi : null;
  const plainJersey = isPlainSingleJersey(structure);
  const hasRepeat = repeatYarnMm != null || repeatCells != null;
  const yarnMmPerCell = hasRepeat ? divide(repeatYarnMm, repeatCells) : plainJersey ? loopLength : null;
  // A measured repeat accounts for tucks, floats and both beds when one yarn count is used.
  const yarnKmPerSquareMetre = cellsPerSquareInch * yarnMmPerCell / (INCH_M ** 2 * 1e6);
  const calculatedGauge = divide(needlePositions, Math.PI * cylinderIn) ?? divide(25.4, needlePitchMm);
  return {
    wpi, cpi, loopLength, yarnCount, gauge: gauge ?? calculatedGauge, calculatedGauge,
    stitchDensity: plainJersey ? cellsPerSquareInch : null,
    loopsPerYarnInch: divide(25.4, loopLength),
    estimatedGsm: yarnCount && yarnKmPerSquareMetre ? yarnKmPerSquareMetre * convertTex(yarnCount, countUnit) : null,
    idealYarnCount: targetGsm ? convertFromTex(divide(targetGsm, yarnKmPerSquareMetre), countUnit) : null,
  };
}

function calculate(construction, gsm) {
  const { type, inputs, structure, countUnit } = construction;
  const values = type === 'Woven' ? woven(inputs, countUnit, gsm) : knitted(inputs, structure, countUnit, gsm);
  return { gsm, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value == null ? null : round(value)])) };
}

export function toleranceRange(input, target, label) {
  const sides = input.split('/').map(side => side.trim().match(/^[-+±−]?\s*(\d+(?:\.\d+)?|\.\d+)\s*(%)?$/));
  ensure(sides.length <= 2 && sides.every(Boolean),
    'Enter a numeric tolerance for ' + label + ', such as 3, ±5% or −3% / +5%.');
  const margins = sides.map(([, value, percent]) => {
    const amount = decimal(value, label + ' tolerance');
    return percent ? target * amount / 100 : amount;
  });
  return { target, min: round(Math.max(0, target - margins[0])), max: round(target + (margins[1] ?? margins[0])) };
}

export function fabricSpecification(x, { partial = false, stages = [] } = {}) {
  const type = x.fabricType;
  if (!type) return null;
  choice(type, FABRIC_TYPES, 'fabric type');
  const wovenRoute = stages.includes('Weaving');
  const knitRoute = stages.includes('Knitting');
  ensure(wovenRoute === knitRoute || type === (wovenRoute ? 'Woven' : 'Knitted'), 'Choose the fabric type produced by the PO route.');
  const construction = readConstruction(x, type, partial);
  if (!partial) req(construction.structure, 'Fabric structure', 100);
  const condition = choice(x.fabricCondition || 'Finished', FABRIC_CONDITIONS, 'fabric stage');
  const values = calculate(construction, optionalNumber(x.gsm, 'Target GSM'));
  const ranges = {}, tolerances = {}, warnings = [];
  for (const key of fabricMetrics(type)) {
    const input = clean(x[toleranceField(key)], 50);
    if (!input) continue;
    const { label } = FABRIC_METRICS[key];
    try {
      ensure(values[key] != null, 'Set a target for ' + label + ' before entering its tolerance.');
      ranges[key] = toleranceRange(input, values[key], label);
    } catch (error) {
      if (!partial) throw error;
      warnings.push(error.message);
    }
    tolerances[key] = input;
  }
  return { ...construction, condition, values, tolerances, ranges, ...(partial ? { warnings } : {}) };
}

export function fabricSpecInput(spec) {
  if (!spec) return {};
  return {
    ...spec.inputs, fabricType: spec.type, fabricStructure: spec.structure, fabricCondition: spec.condition,
    countUnit: spec.countUnit, gsm: spec.values.gsm,
    ...Object.fromEntries(Object.entries(spec.tolerances).map(([key, value]) => [toleranceField(key), value])),
  };
}

export function fabricObservation(x, { partial = false } = {}) {
  if (!x.fabricType) return null;
  const construction = readConstruction(x, choice(x.fabricType, FABRIC_TYPES, 'fabric type'), partial);
  const mass = optionalNumber(x.swatchMassG, 'Swatch mass');
  const area = optionalNumber(x.swatchAreaCm2, 'Swatch area');
  const measured = optionalNumber(x.measuredGsm, 'Lab GSM');
  if (!partial) {
    ensure((mass == null) === (area == null), 'Enter both swatch mass and area to calculate measured GSM.');
    ensure(measured == null || mass == null, 'Use either the lab GSM or the swatch mass and area.');
  }
  if (!construction.structure && measured == null && mass == null && area == null &&
    !Object.keys(construction.inputs).some(key => key !== 'countSpanIn')) return null;
  const values = { ...calculate(construction, null), gsm: measured ?? (mass && area ? round(mass * 10000 / area) : null) };
  return { ...construction, swatchMassG: mass, swatchAreaCm2: area, values };
}

export function fabricSpecAt(line, revision = line?.revision) {
  if (revision === line?.revision) return line?.fabricSpec ?? null;
  return line?.revisions?.find(row => row.revision === revision)?.fabricSpec ?? null;
}

export function linkedSpecRevisions(s, lot) {
  if (!lot) return [];
  const origin = [lot, ...genealogy(s, lot.id)].find(row => row.material === lot.material && row.stage === lot.stage && (row.workOrderId || row.jobId));
  const work = ref(s.workOrders, origin?.workOrderId) ?? ref(s.jobs, origin?.jobId);
  const purchase = ref(s.purchases, lot.purchaseId);
  const requisition = ref(s.requisitions, ref(purchase?.lines ?? [], lot.purchaseLineId)?.reqId);
  const ids = new Set([...(lot.allocations ?? []).map(row => row.lineId), work?.lineId, requisition?.lineId].filter(Boolean));
  return [...ids].flatMap(id => {
    const line = ref(s.lines, id);
    if (line?.status !== 'Approved') return [];
    const pinned = work?.lineId === id ? work.lineRevision : requisition?.lineId === id ? requisition.lineRevision : null;
    const revision = pinned ?? line.revision;
    const snapshot = revision === line.revision ? line : line.revisions?.find(row => row.revision === revision);
    return snapshot ? [{ lineId: id, revision, snapshot, work: work?.lineId === id ? work : null }] : [];
  });
}

export function matchingFabricComponents(link, lot, condition) {
  const all = link.snapshot.garmentSpec?.fabrics ?? [];
  const components = all.filter(row => (row.construction?.condition || 'Finished') === condition);
  if (link.work?.techComponent) return components.filter(row => row.code === link.work.techComponent);
  const matching = lot.itemId ? components.filter(row => row.item?.itemId === lot.itemId) : [];
  if (matching.length) return matching;
  if (link.work && all.length === 1 && components.length === 1 && !components[0].item) return components;
  return [];
}

export function fabricTargetsForLot(s, lot, techTarget = '') {
  const condition = fabricCondition(lot);
  if (!condition) return [];
  return linkedSpecRevisions(s, lot).flatMap(link => {
    const { lineId, revision, snapshot } = link;
    const matching = matchingFabricComponents(link, lot, condition);
    const prefix = lineId + '|' + revision + '|';
    const selected = techTarget ? matching.filter(row => techTarget === prefix + row.code) : matching;
    if (selected.length === 1 && selected[0].construction) {
      const component = selected[0];
      return [{ lineId, revision, specRev: snapshot.specRev, spec: component.construction, component: component.code }];
    }
    if (snapshot.garmentSpec || snapshot.fabricSpec?.condition !== condition) return [];
    return [{ lineId, revision, specRev: snapshot.specRev, spec: snapshot.fabricSpec }];
  });
}

export function compareFabric(targets, observation) {
  return targets.map(({ lineId, revision, specRev, spec, component }) => {
    const sameType = !observation || spec.type === observation.type;
    const structure = observation?.structure || '';
    const checks = [
      { label: 'Fabric type', target: spec.type, actual: observation?.type ?? null, status: !observation ? 'Missing' : sameType ? 'Within limits' : 'Outside limits' },
      { label: 'Structure', target: spec.structure, actual: structure || null,
        status: !structure ? 'Missing' : structureKey(structure) === structureKey(spec.structure) ? 'Within limits' : 'Outside limits' },
    ];
    for (const [key, range] of Object.entries(spec.ranges)) {
      const { label, unit } = FABRIC_METRICS[key];
      let actual = sameType || key === 'gsm' ? observation?.values[key] ?? null : null;
      if (isYarnCount(key) && actual != null && spec.countUnit !== observation.countUnit) {
        actual = round(convertFromTex(convertTex(actual, observation.countUnit), spec.countUnit));
      }
      checks.push({
        label, unit: unit || spec.countUnit, ...range, actual,
        status: actual == null ? 'Missing' : actual >= range.min && actual <= range.max ? 'Within limits' : 'Outside limits',
      });
    }
    const status = checks.some(row => row.status === 'Outside limits') ? 'Outside limits' :
      checks.some(row => row.status === 'Missing') ? 'Measurements missing' : 'Within limits';
    return { lineId, revision, specRev, ...(component ? { component } : {}), status, checks };
  });
}
