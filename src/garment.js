import { choice, clean, csvLines, decimal, DISCRETE, ensure, key, norm, quantity, record, req, round, sum } from './model.js';
import { convertFromTex, convertTex, fabricCondition, fabricSpecification, linkedSpecRevisions, matchingFabricComponents, toleranceRange, YARN_COUNT_UNITS } from './fabric.js';

export const FABRIC_ROLES = ['Shell', 'Lining', 'Contrast', 'Rib', 'Pocketing', 'Interlining', 'Other'];
export const FABRIC_WIDTHS = ['Open width', 'Tubular lay-flat'];
export const AREA_BASES = ['Cut pattern including seam allowances', 'Finished pattern including seam allowances'];
export const MARKER_BASES = ['Pattern area and efficiency', 'CAD marker length'];
export const TRIM_BASES = ['Per garment cut', 'Per garment shipped', 'Per carton'];
export const GARMENT_LOTS = ['Sewn garment', 'QC-passed garment', 'Finished garment', 'Released garment', 'Packed carton'];

const filled = value => value != null && String(value).trim() !== '';
const optional = (value, label, min = 0) => filled(value) ? decimal(value, label, min) : null;
const positive = (value, label) => optional(value, label, 0.000001);
const code = (value, label) => key(value, label).toUpperCase();
const whole = n => Math.ceil(round(n));
const letters = values => values.map(value => norm(value));

export function garmentPayload(value, label) {
  let parsed;
  try { parsed = JSON.parse(req(value, label, 130000)); }
  catch (err) { if (!(err instanceof SyntaxError)) throw err; }
  ensure(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Enter valid ' + label + ' data.');
  return parsed;
}

function rows(value, label, cap = 150) {
  if (value == null) return [];
  ensure(Array.isArray(value) && value.length <= cap && value.every(row => row && typeof row === 'object' && !Array.isArray(row)),
    'Use up to ' + cap + ' rows for ' + label + '.');
  return value;
}

function loss(input, label) {
  const value = optional(input, label) ?? 0;
  ensure(value < 100, label + ' must be below 100%.');
  return value;
}

function integer(input, label, min = 1) {
  if (!filled(input)) return null;
  const result = decimal(input, label, min);
  ensure(Number.isSafeInteger(result), label + ' must be a whole number.');
  return result;
}

function distinctCodes(entries, label) {
  const keys = entries.map(row => row.code);
  ensure(new Set(keys).size === keys.length, 'Use a separate code for each ' + label + '.');
}

export function dimensionalChange(before, after) {
  return (before - after) / before * 100;
}

function shrinkage(x, prefix, label) {
  const value = optional(x[prefix], label, -1000);
  const before = positive(x[prefix + 'Before'], label + ' before measurement');
  const after = positive(x[prefix + 'After'], label + ' after measurement');
  ensure((before == null) === (after == null), 'Enter before and after measurements for ' + label.toLowerCase() + '.');
  ensure(before == null || value == null, 'Use a percentage or before and after measurements for ' + label.toLowerCase() + '.');
  const calculated = before == null ? value : dimensionalChange(before, after);
  ensure(calculated == null || calculated < 100, label + ' must be below 100%.');
  return { value, before, after, percent: calculated };
}

function rangeFor(value, input, label) {
  const tolerance = clean(input, 50);
  ensure(!tolerance || value != null, 'Set a target for ' + label + ' before entering tolerance.');
  return { tolerance, limits: tolerance ? toleranceRange(tolerance, value, label) : null };
}

function stockItem(s, itemId) {
  const item = itemId ? record(s.items, itemId, 'stock item') : null;
  return item ? { itemId: item.id, itemCode: item.code, itemName: item.name, unit: item.unit } : null;
}

export function applyKnitYarnSystems(x, construction) {
  const cells = integer(x.yarnRepeatCells, 'Wale × course cells in a complete repeat');
  const yarns = csvLines(x.yarnSystems, 'Knitted yarn systems', 4).map(([name, count, unit, length]) => ({
    name: req(name, 'Yarn system'), count: decimal(count, 'Yarn count', 0.000001), unit: choice(unit, YARN_COUNT_UNITS, 'yarn count unit'),
    length: decimal(length, 'Yarn length in the repeat (mm)', 0.000001),
  }));
  if (yarns.length) {
    ensure(construction?.type === 'Knitted' && cells, 'Choose Knitted and enter the cells in the complete repeat for yarn-system GSM.');
    ensure(new Set(letters(yarns.map(row => row.name))).size === yarns.length, 'Use a distinct name for each yarn system.');
    const { wpi, cpi } = construction.values;
    const repeatMultiplier = wpi && cpi ? wpi * cpi / (cells * 0.0254 ** 2 * 1e6) : null;
    for (const row of yarns) row.gsm = repeatMultiplier == null ? null : row.length * convertTex(row.count, row.unit) * repeatMultiplier;
    construction.values.estimatedGsm = repeatMultiplier == null ? null : sum(yarns, row => row.gsm);
    construction.values.idealYarnCount = yarns.length === 1 && repeatMultiplier && construction.values.gsm
      ? round(convertFromTex(construction.values.gsm / (yarns[0].length * repeatMultiplier), construction.countUnit)) : null;
  }
  return { cells, yarns };
}

function fabricComponent(s, x) {
  const id = code(x.code, 'Fabric component code');
  const role = choice(x.role || 'Shell', FABRIC_ROLES, 'fabric use');
  const construction = fabricSpecification(x.construction ?? {});
  const yarnSystems = applyKnitYarnSystems(x, construction);
  const gsm = construction?.values.gsm ?? positive(x.construction?.gsm, 'Target GSM');
  const structure = construction?.structure || clean(x.structure, 150);
  ensure(structure, 'Record the structure of fabric ' + id + '.');
  const widthMode = choice(x.widthMode || 'Open width', FABRIC_WIDTHS, 'fabric width basis');
  const grossWidth = positive(x.grossWidth, 'Full roll width');
  const usableWidth = positive(x.usableWidth, 'Usable cutting width');
  ensure(grossWidth == null || usableWidth == null || usableWidth <= grossWidth, 'Usable width cannot exceed full roll width for ' + id + '.');
  const grossTolerance = rangeFor(grossWidth, x.grossTolerance, 'full roll width');
  const usableTolerance = rangeFor(usableWidth, x.usableTolerance, 'usable width');
  const blend = csvLines(x.blend, 'Fibre composition', 2).map(([fibre, percent]) => ({ fibre: req(fibre, 'Fibre name'), percent: decimal(percent, 'Fibre percentage', 0.000001) }));
  if (blend.length) {
    ensure(new Set(letters(blend.map(row => row.fibre))).size === blend.length && sum(blend, row => row.percent) === 100,
      'Use distinct fibres adding up to 100% for ' + id + '.');
  }
  const pattern = csvLines(x.pattern, 'Pattern parts', 3).map(([name, repeats, area]) => ({
    name: req(name, 'Pattern piece'), repeats: quantity(repeats, 'Pieces per garment', 'pcs'), area: decimal(area, 'Area per piece in cm²', 0.000001),
  }));
  const areaBasis = choice(x.areaBasis || AREA_BASES[0], AREA_BASES, 'pattern area basis');
  const lengthChange = shrinkage(x, 'lengthShrink', 'Length shrinkage');
  const widthChange = shrinkage(x, 'widthShrink', 'Width shrinkage');
  const markerBasis = choice(x.markerBasis || MARKER_BASES[0], MARKER_BASES, 'marker basis');
  const markerEfficiency = markerBasis === MARKER_BASES[0] ? positive(x.markerEfficiency, 'Marker efficiency') : null;
  ensure(markerEfficiency == null || markerEfficiency <= 100, 'Marker efficiency cannot exceed 100%.');
  const markerLength = markerBasis === MARKER_BASES[1] ? positive(x.markerLength, 'CAD marker length') : null;
  const markerPieces = markerBasis === MARKER_BASES[1] ? integer(x.markerPieces, 'Garments in marker') : null;
  ensure((markerLength == null) === (markerPieces == null), 'Enter both the CAD marker length and the garments in the marker.');
  const extraLoss = loss(x.extraLoss, 'Spreading and cutting loss');
  const item = stockItem(s, x.itemId);
  if (item) ensure(['Greige fabric', 'Dyed fabric', 'Finished fabric', 'Inspected fabric', 'Other'].includes(record(s.items, item.itemId, 'fabric item').type),
    'Link a fabric material item to ' + id + '.');
  const preparePurchase = x.preparePurchase === 'yes';
  const row = { code: id, role, construction, yarnSystems, gsm, structure, item, preparePurchase, widthMode, grossWidth, usableWidth,
    grossTolerance, usableTolerance, blend, pattern, areaBasis, lengthChange, widthChange, markerBasis, markerEfficiency, markerLength, markerPieces, extraLoss,
    description: clean(x.description, 200), millRef: clean(x.millRef, 300), colourRef: clean(x.colourRef, 250), labDip: clean(x.labDip, 250),
    dyePrint: clean(x.dyePrint, 1200), finish: clean(x.finish, 1200), warpGround: clean(x.warpGround, 1200), weftPlating: clean(x.weftPlating, 1200),
    machine: clean(x.machine, 1200), grainRepeat: clean(x.grainRepeat, 1200), washMethod: clean(x.washMethod, 1000), notes: clean(x.notes, 3000) };
  const plan = fabricRequirement(row, 1);
  ensure(plan.markerEfficiency == null || round(plan.markerEfficiency) <= 100, 'Check the pattern area, marker length and usable width for ' + id + '. Marker efficiency is over 100%.');
  if (preparePurchase) {
    ensure(item && fabricStockQuantity(item.unit, plan) != null, 'Calculate fabric in kg, g, m or cm and link a matching stock item before including ' + id + ' in planning.');
  }
  return row;
}

function measurePoint(x, steps) {
  const name = req(x.name, 'Point of measure');
  const base = positive(x.base, name + ' base measurement');
  const grade = optional(x.grade, name + ' grade per step', -10000);
  const specified = positive(x.target, name + ' buyer target');
  ensure(specified != null || base != null, 'Enter a target or a base measurement for ' + name + '.');
  ensure(specified != null || !steps || grade != null, 'Enter the grade per size step for ' + name + '.');
  const target = specified ?? round(base + steps * (grade ?? 0));
  ensure(target > 0, name + ' must have a positive graded target.');
  return { code: code(x.code, 'POM code'), name, method: req(x.method, 'How to measure ' + name, 1000),
    base, grade, specified, target, ...rangeFor(target, x.tolerance, name) };
}

function seamOperation(x) {
  const stitches = integer(x.stitches, 'Stitches counted');
  const span = positive(x.span, 'Stitch count span');
  ensure((stitches == null) === (span == null), 'Enter both the stitch count and span to calculate SPI.');
  const length = positive(x.length, 'Total seam length per garment');
  const ratio = positive(x.ratio, 'Approved thread to seam ratio');
  ensure((length == null) === (ratio == null), 'Enter both the seam length and thread ratio for a thread estimate.');
  return { operation: req(x.operation, 'Sewing operation'), seam: clean(x.seam, 180), stitch: clean(x.stitch, 180),
    allowance: optional(x.allowance, 'Seam allowance'), stitches, span, spi: span == null ? null : round(stitches * 2.54 / span),
    length, ratio, threadM: length == null ? null : round(length * ratio / 100), thread: clean(x.thread, 200), notes: clean(x.notes, 1000) };
}

function trim(s, x, cartonCapacity) {
  const item = stockItem(s, x.itemId);
  ensure(item, 'Link each trim or packaging entry to a stock item.');
  const basis = choice(x.basis || TRIM_BASES[0], TRIM_BASES, 'trim calculation basis');
  ensure(basis !== TRIM_BASES[2] || cartonCapacity, 'Enter garments per carton to calculate a per-carton requirement.');
  return { item, description: clean(x.description, 400), basis, per: decimal(x.per, 'Usage per ' + basis.toLowerCase(), 0.000001),
    loss: loss(x.loss, 'Trim or packaging loss'), preparePurchase: x.preparePurchase === 'yes' };
}

function labTest(x, fabrics) {
  const scope = code(x.scope || 'GARMENT', 'Test component code');
  ensure(scope === 'GARMENT' || fabrics.some(row => row.code === scope), 'Use GARMENT or an exact fabric component code as the test scope.');
  const name = req(x.name, 'Test name');
  const min = optional(x.min, name + ' minimum', -1000000);
  const max = optional(x.max, name + ' maximum', -1000000);
  ensure(min != null || max != null, 'Enter a minimum or maximum for ' + name + '.');
  ensure(min == null || max == null || min <= max, 'Minimum cannot exceed maximum for ' + name + '.');
  return { code: code(x.code, 'Lab test code'), scope, name, method: req(x.method, 'Lab test method', 300),
    unit: req(x.unit, 'Test result unit', 50), condition: clean(x.condition, 800), min, max };
}

export function garmentSpecification(s, x) {
  const fabrics = rows(x.fabrics, 'fabric components', 24).map(row => fabricComponent(s, row));
  distinctCodes(fabrics, 'fabric component');
  ensure(fabrics.every(row => row.code !== 'GARMENT'), 'Use a fabric code other than GARMENT.');
  ensure(fabrics.length, 'Add a fabric component to this garment specification.');
  const sizeSteps = integer(x.sizeSteps, 'Steps from base size', -100) ?? 0;
  ensure(!sizeSteps || filled(x.baseSize), 'Enter the base size for grading.');
  const poms = rows(x.poms, 'measurement points').map(row => measurePoint(row, sizeSteps));
  distinctCodes(poms, 'point of measure');
  const tests = rows(x.tests, 'lab tests').map(row => labTest(row, fabrics));
  distinctCodes(tests, 'lab test');
  const cartonCapacity = integer(x.cartonCapacity, 'Garments per carton');
  return {
    category: clean(x.category, 200), fit: clean(x.fit, 200), patternRef: clean(x.patternRef, 200), sampleRef: clean(x.sampleRef, 200),
    care: clean(x.care, 1200), assembly: clean(x.assembly, 2000), artwork: clean(x.artwork, 2000), packaging: clean(x.packaging, 2000),
    measurementStage: clean(x.measurementStage, 800), measurementUnit: choice(x.measurementUnit || 'cm', ['cm', 'in'], 'measurement unit'),
    baseSize: clean(x.baseSize, 80), sizeSteps, garmentLoss: loss(x.garmentLoss, 'Garment reject allowance'), cartonCapacity, fabrics, poms,
    operations: rows(x.operations, 'sewing operations').map(seamOperation), trims: rows(x.trims, 'trims and packaging').map(row => trim(s, row, cartonCapacity)), tests,
  };
}

export function fabricRequirement(f, cutQty) {
  const tubeFaces = f.widthMode === 'Tubular lay-flat' ? 2 : 1;
  const materialWidthM = f.grossWidth == null ? null : f.grossWidth * tubeFaces / 100;
  const usableWidthM = f.usableWidth == null ? null : f.usableWidth * tubeFaces / 100;
  const patternArea = f.pattern.length ? f.pattern.reduce((total, part) => total + part.area * part.repeats, 0) / 10000 : null;
  let cutArea = patternArea;
  if (f.areaBasis === AREA_BASES[1]) {
    const length = f.lengthChange.percent;
    const width = f.widthChange.percent;
    cutArea = patternArea == null || length == null || width == null ? null : patternArea / ((1 - length / 100) * (1 - width / 100));
  }
  const cadLength = f.markerLength == null ? null : f.markerLength / f.markerPieces;
  const areaLength = cutArea && usableWidthM && f.markerEfficiency ? cutArea / (usableWidthM * f.markerEfficiency / 100) : null;
  const baseLength = f.markerBasis === MARKER_BASES[1] ? cadLength : areaLength;
  const metresPerGarmentCut = baseLength == null ? null : baseLength / (1 - f.extraLoss / 100);
  const gramsPerMetre = materialWidthM && f.gsm ? materialWidthM * f.gsm : null;
  const metres = metresPerGarmentCut == null ? null : metresPerGarmentCut * cutQty;
  return { materialWidthM, usableWidthM, patternArea, cutArea, baseLength, metresPerGarmentCut, gramsPerMetre,
    markerEfficiency: cadLength && cutArea && usableWidthM ? cutArea / (cadLength * usableWidthM) * 100 : f.markerEfficiency,
    metres, kg: metres != null && gramsPerMetre != null ? metres * gramsPerMetre / 1000 : null };
}

function fabricStockQuantity(unit, result) {
  if (unit === 'kg') return result.kg;
  if (unit === 'g') return result.kg == null ? null : result.kg * 1000;
  if (unit === 'm') return result.metres;
  return unit === 'cm' && result.metres != null ? result.metres * 100 : null;
}

export function garmentPlan(pack, ordered) {
  const cutQty = whole(ordered / (1 - pack.garmentLoss / 100));
  const cartons = pack.cartonCapacity ? whole(ordered / pack.cartonCapacity) : null;
  const fabrics = pack.fabrics.map(fabric => ({ ...fabric, result: fabricRequirement(fabric, cutQty) }));
  const trims = pack.trims.map(row => {
    const basis = row.basis === TRIM_BASES[0] ? cutQty : row.basis === TRIM_BASES[1] ? ordered : cartons;
    const required = basis * row.per / (1 - row.loss / 100);
    return { ...row, required };
  });
  const demand = new Map();
  function add(item, amount) {
    if (!item || amount == null || !ordered) return;
    const prior = demand.get(item.itemId)?.qty || 0;
    demand.set(item.itemId, { ...item, qty: prior + amount });
  }
  for (const row of fabrics) if (row.preparePurchase) add(row.item, fabricStockQuantity(row.item.unit, row.result));
  for (const row of trims) if (row.preparePurchase) add(row.item, row.required);
  const bom = [...demand.values()].map(row => {
    const qty = DISCRETE.includes(row.unit) ? whole(row.qty) : round(row.qty);
    return { ...row, code: row.itemCode, label: row.itemName, qty, per: qty / ordered, calculated: true };
  });
  return { cutQty, cartons, fabrics, trims: trims.map(row => ({ ...row, total: DISCRETE.includes(row.item.unit) ? whole(row.required) : round(row.required) })), bom };
}

export function materialRequirements(line, ordered = line.qty) {
  const calculated = line.garmentSpec ? garmentPlan(line.garmentSpec, ordered).bom : [];
  const selected = new Set(calculated.map(row => row.itemId));
  return [...line.bom.filter(row => !selected.has(row.itemId)).map(row => ({ ...row, qty: round(row.per * ordered) })), ...calculated];
}

function technicalChecks(pack, component) {
  const rows = component ? [
    ...[['width-gross', 'Full roll width', component.grossTolerance], ['width-usable', 'Usable cutting width', component.usableTolerance]]
      .filter(([, , range]) => range?.limits).map(([id, name, range]) => ({ key: id, name, unit: 'cm', ...range.limits })),
  ] : pack.poms.map(row => ({ key: 'pom-' + row.code, name: row.code + ' · ' + row.name, unit: pack.measurementUnit,
    method: row.method, condition: pack.measurementStage, target: row.target, min: row.limits?.min ?? null, max: row.limits?.max ?? null }));
  return rows.concat(pack.tests.filter(test => test.scope === (component?.code || 'GARMENT')).map(row => ({ ...row, key: 'test-' + row.code })));
}

export function garmentTargetsForLot(s, lot) {
  const condition = fabricCondition(lot);
  if (!condition && !GARMENT_LOTS.includes(lot?.material)) return [];
  return linkedSpecRevisions(s, lot).flatMap(link => {
    const pack = link.snapshot.garmentSpec;
    if (!pack) return [];
    const components = condition ? matchingFabricComponents(link, lot, condition) : [null];
    return components.map(component => ({
      key: [link.lineId, link.revision, component?.code || 'GARMENT'].join('|'), lineId: link.lineId, revision: link.revision,
      specRev: link.snapshot.specRev, component: component?.code || 'GARMENT', name: component?.role || 'Garment',
      checks: technicalChecks(pack, component),
    })).filter(target => condition || target.checks.length);
  });
}

export function evaluateGarmentInspection(s, lot, x) {
  if (!x) return null;
  const input = garmentPayload(x, 'tech pack inspection');
  const target = garmentTargetsForLot(s, lot).find(row => row.key === input.target);
  ensure(target, 'Choose a tech pack inspection target linked to this lot and revision.');
  const actual = input.actual;
  ensure(actual && typeof actual === 'object' && !Array.isArray(actual), 'Enter tech pack readings.');
  const checks = target.checks.map(check => {
    const minValue = check.key.startsWith('test-') ? -1000000 : 0.000001;
    const value = optional(Object.hasOwn(actual, check.key) ? actual[check.key] : null, check.name + ' reading', minValue);
    const hasLimits = check.min != null || check.max != null;
    const status = value == null ? 'Missing' : !hasLimits ? 'Recorded' :
      (check.min == null || value >= check.min) && (check.max == null || value <= check.max) ? 'Within limits' : 'Outside limits';
    return { ...check, actual: value, status };
  });
  ensure(checks.some(row => row.actual != null), 'Enter at least one tech pack reading.');
  const status = checks.some(row => row.status === 'Outside limits') ? 'Outside limits' : checks.some(row => row.status === 'Missing') ? 'Measurements missing' :
    checks.some(row => row.status === 'Within limits') ? 'Within limits' : 'Recorded';
  return { ...target, status, checks };
}
