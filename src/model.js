export const UNITS = ['kg', 'g', 'm', 'cm', 'pcs', 'L', 'bale', 'cone', 'beam', 'roll', 'bundle', 'carton'];
export const DISCRETE = ['pcs', 'bale', 'cone', 'beam', 'roll', 'bundle', 'carton'];
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];
export const SCHEMES = {
  Conventional: [],
  GOTS: ['Scope certificate', 'Subcontractor annex'],
  OCS: ['Scope certificate', 'Subcontractor annex'],
  GRS: ['Scope certificate', 'Subcontractor annex'],
  RCS: ['Scope certificate', 'Subcontractor annex'],
  'CMiA Traceable': ['Registration / tracker'],
  'CMiA Mass Balance': ['Registration / tracker'],
  BCI: ['Registration / tracker', 'Scope certificate'],
  'OEKO-TEX STANDARD 100': ['Article certificate'],
};
export const EXTRA_EVIDENCE = ['Transaction certificate', 'Chemical approval', 'Article certificate', 'Details only'];
export const STAGES = {
  Ginning: { primary: ['Seed cotton'], output: 'Cotton bale' },
  'Fibre preparation': { primary: ['Cotton fibre', 'Cotton bale', 'Other fibre'], output: 'Prepared fibre' },
  Spinning: { primary: ['Prepared fibre', 'Cotton fibre', 'Other fibre'], output: 'Yarn' },
  'Yarn dyeing': { primary: ['Yarn'], output: 'Dyed yarn', auxiliary: ['Chemical'] },
  Warping: { primary: ['Yarn', 'Dyed yarn'], output: 'Warp beam', auxiliary: ['Chemical'] },
  Weaving: { primary: ['Warp beam', 'Yarn', 'Dyed yarn'], output: 'Greige fabric' },
  Knitting: { primary: ['Yarn', 'Dyed yarn'], output: 'Greige fabric' },
  'Fabric dyeing': { primary: ['Greige fabric'], output: 'Dyed fabric', auxiliary: ['Chemical'] },
  // Conditional operations keep the incoming material type. They run only when an approved route includes them.
  Sizing: { primary: ['Warp beam'], output: 'Warp beam', auxiliary: ['Chemical'], preserve: true, conditional: true },
  Desizing: { primary: ['Greige fabric'], output: 'Greige fabric', auxiliary: ['Chemical'], preserve: true, conditional: true },
  'Yarn washing': { primary: ['Yarn', 'Dyed yarn'], output: 'Yarn', auxiliary: ['Chemical'], preserve: true, conditional: true },
  'Fabric washing': { primary: ['Greige fabric', 'Dyed fabric', 'Finished fabric', 'Inspected fabric'], output: 'Greige fabric', auxiliary: ['Chemical'], preserve: true, conditional: true },
  'Fabric printing': { primary: ['Greige fabric', 'Dyed fabric', 'Finished fabric', 'Inspected fabric'], output: 'Greige fabric', auxiliary: ['Chemical'], preserve: true, conditional: true },
  'Fabric finishing': { primary: ['Greige fabric', 'Dyed fabric'], output: 'Finished fabric', auxiliary: ['Chemical'] },
  'Fabric inspection': { primary: ['Finished fabric'], output: 'Inspected fabric', inspection: true },
  Cutting: { primary: ['Inspected fabric', 'Finished fabric'], output: 'Cut bundle', count: true },
  Embroidery: { primary: ['Cut bundle', 'Printed bundle', 'Sewn garment', 'QC-passed garment', 'Finished garment', 'Released garment', 'Traded goods'],
    output: 'Embroidered bundle', count: true, auxiliary: ['Thread', 'Trim', 'Backing'] },
  Printing: { primary: ['Cut bundle', 'Embroidered bundle'], output: 'Printed bundle', count: true, auxiliary: ['Chemical'] },
  'Cut bundle washing': { primary: ['Cut bundle', 'Printed bundle', 'Embroidered bundle'], output: 'Cut bundle', auxiliary: ['Chemical'], preserve: true, conditional: true },
  Stitching: { primary: ['Cut bundle', 'Embroidered bundle', 'Printed bundle'], output: 'Sewn garment', count: true, auxiliary: ['Thread', 'Trim'] },
  'Garment printing': { primary: ['Sewn garment'], output: 'Sewn garment', count: true, auxiliary: ['Chemical'], preserve: true, conditional: true },
  'Garment washing': { primary: ['Sewn garment'], output: 'Sewn garment', count: true, auxiliary: ['Chemical'], preserve: true, conditional: true },
  'Garment QC': { primary: ['Sewn garment'], output: 'QC-passed garment', count: true, inspection: true },
  'Garment finishing': { primary: ['QC-passed garment'], output: 'Finished garment', count: true },
  'Final inspection': { primary: ['Finished garment'], output: 'Released garment', count: true, inspection: true },
  Packing: { primary: ['Released garment'], output: 'Packed carton', count: true, auxiliary: ['Carton', 'Polybag', 'Hangtag'] },
};
export const WASH_STAGES = ['Yarn washing', 'Fabric washing', 'Cut bundle washing', 'Garment washing'];
export const PRINT_STAGES = ['Fabric printing', 'Printing', 'Garment printing'];
const fibre = ['Fibre preparation', 'Spinning'];
const garment = ['Fabric inspection', 'Cutting', 'Embroidery', 'Printing', 'Stitching', 'Garment QC', 'Garment finishing', 'Final inspection', 'Packing'];
export const ROUTES = {
  'Fabric-dyed woven': [...fibre, 'Warping', 'Weaving', 'Fabric dyeing', 'Fabric finishing', ...garment],
  'Yarn-dyed woven': [...fibre, 'Yarn dyeing', 'Warping', 'Weaving', 'Fabric finishing', ...garment],
  'Fabric-dyed knitted': [...fibre, 'Knitting', 'Fabric dyeing', 'Fabric finishing', ...garment],
  'Yarn-dyed knitted': [...fibre, 'Yarn dyeing', 'Knitting', 'Fabric finishing', ...garment],
  'Spinning only': fibre,
  'Garment assembly': garment,
  Trading: [],
};
export const MATERIALS = [...new Set([
  'Seed cotton', 'Cotton fibre', 'Cotton bale', 'Other fibre', 'Cotton seed', 'Fibre waste', ...Object.values(STAGES).map(s => s.output),
  'Chemical', 'Thread', 'Trim', 'Backing', 'Zip', 'Button', 'Label', 'Interlining', 'Carton', 'Polybag', 'Hangtag', 'Traded goods', 'Other',
])];
export const FULFILMENT = ['Packed carton', 'Released garment', 'Yarn', 'Dyed yarn', 'Greige fabric', 'Finished fabric', 'Inspected fabric', 'Traded goods'];
export const DPP_FIELDS = [
  'GTIN', 'Global model identifier', 'Production batch', 'Item serial', 'HS code', 'TARIC code',
  'Product category', 'ESPR sector', 'PEFCR classification', 'Passport status', 'Manufacturer',
  'Manufacturer GLN / EORI', 'Manufacturer address', 'Manufacturer contact', 'Importer',
  'Importer GLN / EORI', 'Importer contact', 'Raw material origin or facility', 'Spinning facility',
  'Fabric formation facility', 'Assembly facility', 'Fibre composition', 'Robustness score',
  'Washing shrinkage', 'Tensile strength', 'Recyclability index', 'Recycling disruption flags',
  'Total recycled content', 'Pre-consumer recycled share', 'Post-consumer recycled share',
  'Recycling technology', 'Environmental footprint score', 'Climate impact', 'Water consumption',
  'Land-use indicator', 'Substances of concern', 'Substance concentration', 'Substance to component map',
  'Wash care', 'Repair guidance', 'Disassembly instructions', 'Take-back programme', 'CE status',
  'EU declaration of conformity', 'Audit body identifier', 'Lab report', 'Calculation trace',
  'Backup provider', 'Digital signature',
];
export const KINDS = [
  'parties', 'locations', 'items', 'machines', 'routes', 'policies', 'orders', 'lines', 'requisitions',
  'purchases', 'lots', 'events', 'workOrders', 'jobs', 'shipments', 'invoices', 'evidence',
  'costs', 'accounts', 'vouchers', 'passports', 'readings', 'credits', 'maintenance', 'quotes', 'claimRules', 'claimReleases',
  'componentRoutes', 'processSetups', 'processBatches',
];
export const ROLES = ['Admin', 'Merchandising', 'Stores', 'Production', 'Quality', 'Logistics', 'Finance', 'Compliance', 'Viewer', 'Buyer'];
export const APP_ROLES = ROLES.filter(role => role !== 'Buyer');
export const EPS = 0.0000005;
export const round = n => Math.round(n * 1e6) / 1e6;
export const ref = (rows, key) => rows.find(row => row.id === key);
export const id = (s, prefix) => prefix + '-' + String(s.next++).padStart(5, '0');
export const serial = (s, prefix) => prefix + '-' + String(s.next).padStart(5, '0');
export const blank = (settings = {}) => ({
  ...Object.fromEntries(KINDS.map(kind => [kind, []])),
  next: 1,
  settings: { name: 'HAPZO Decaste', currency: 'INR', timeZone: 'Asia/Kolkata', ...settings },
});

export class DomainError extends Error {
  constructor(message, status = 422, code = 'validation') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function ensure(condition, message, status, code) {
  if (!condition) throw new DomainError(message, status, code);
}
export const lock = (condition, message) => ensure(condition, 'Standard Lock · ' + message, 422, 'standard-lock');
export function clean(input, max = 2000) {
  const result = String(input ?? '').trim();
  ensure(result.length <= max, 'Text is too long (limit ' + max + ' characters).');
  return result;
}
export function req(input, label, max = 200) {
  const result = clean(input, max);
  ensure(result, label + ' is required.');
  return result;
}
export function choice(value, choices, label) {
  ensure(choices.includes(value), 'Choose a valid ' + label + '.');
  return value;
}
export function key(input, label = 'Code') {
  const result = req(input, label, 64);
  ensure(/^[\p{L}\d][\p{L}\d._/-]{0,63}$/u.test(result), label + ' must use letters, digits, dots, underscores, slashes or hyphens.');
  return result;
}
export const norm = value => String(value ?? '').trim().toLowerCase();
export function unique(rows, field, value, msg) {
  ensure(!rows.some(row => norm(row[field]) === norm(value)), msg);
}
export function number(input, label, min = 0, max = 1e10) {
  const raw = String(input ?? '').trim();
  const result = Number(raw);
  ensure(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw) && Number.isFinite(result) && result >= min && result <= max, label + ' is outside the permitted range.');
  return result;
}
export function decimal(input, label, min = 0) {
  const n = number(input, label, min);
  ensure(Math.abs(round(n) - n) < 1e-10, label + ' allows up to six decimal places.');
  return round(n);
}
export function quantity(input, label, unit, allowZero = false) {
  const amount = decimal(input, label, allowZero ? 0 : 0.000001);
  if (DISCRETE.includes(unit)) ensure(Number.isInteger(amount), label + ' must be a whole number in ' + unit + '.');
  return amount;
}
export function validDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? '')) &&
    Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
}
export function today(timeZone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = type => parts.find(p => p.type === type).value;
  return [get('year'), get('month'), get('day')].join('-');
}
export function date(value, fallback = today()) {
  const day = value || fallback;
  ensure(validDate(day), 'Enter a valid date.');
  return day;
}
export function csvLines(input, label, min, max = min) {
  const list = clean(input, 40000).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  ensure(list.length <= 200, label + ' allows up to 200 rows per posting.');
  return list.map((line, i) => {
    const fields = line.split(',').map(x => x.trim());
    ensure(fields.length >= min && fields.length <= max, label + ' row ' + (i + 1) + ' has the wrong number of values.');
    return fields;
  });
}
export function record(rows, key, label) {
  const found = ref(rows, key);
  ensure(found, 'Select a valid ' + label + '.');
  return found;
}
export function freeStock(lot) {
  return Math.max(0, round(lot.qty - sum(lot.reservations ?? [])));
}
export const sum = (rows, get = row => row.qty) => round(rows.reduce((total, row) => total + get(row), 0));
export const close = (a, b) => Math.abs(a - b) <= EPS;
export function genealogy(s, start, forward = false) {
  const lots = new Map(s.lots.map(lot => [lot.id, lot]));
  const edges = new Map();
  for (const lot of s.lots) {
    for (const parent of lot.parents ?? []) {
      const from = forward ? parent.id : lot.id;
      const to = forward ? lot.id : parent.id;
      if (!edges.has(from)) edges.set(from, []);
      edges.get(from).push(to);
    }
  }
  const seen = new Set([start]);
  const queue = [start];
  const result = [];
  for (let i = 0; i < queue.length; i++) {
    for (const next of edges.get(queue[i]) ?? []) {
      if (seen.has(next) || !lots.has(next)) continue;
      seen.add(next);
      queue.push(next);
      result.push(lots.get(next));
    }
  }
  return result;
}
