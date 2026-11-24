import { SelectControl, joinContent, renderPilot } from './react-ui.jsx';
('use strict');
const STORE = 'hapzo-decaste-erp-v2';
const ROUTES = {
  'Woven garment': [
    'Fibre preparation',
    'Spinning',
    'Yarn dyeing',
    'Warping',
    'Weaving',
    'Fabric dyeing',
    'Fabric finishing',
    'Fabric inspection',
    'Cutting',
    'Embroidery',
    'Printing',
    'Stitching',
    'Garment QC',
    'Garment finishing',
    'Final inspection',
    'Packing',
  ],
  'Knitted garment': [
    'Fibre preparation',
    'Spinning',
    'Yarn dyeing',
    'Knitting',
    'Fabric dyeing',
    'Fabric finishing',
    'Fabric inspection',
    'Cutting',
    'Embroidery',
    'Printing',
    'Stitching',
    'Garment QC',
    'Garment finishing',
    'Final inspection',
    'Packing',
  ],
};
const STAGES = {
  'Fibre preparation': {
    inputs: ['Cotton fibre', 'Cotton bale', 'Wool fibre', 'Flax fibre', 'Hemp fibre'],
    output: 'Prepared fibre',
  },
  Spinning: {
    inputs: ['Prepared fibre', 'Cotton fibre', 'Wool fibre', 'Flax fibre', 'Hemp fibre'],
    output: 'Yarn',
  },
  'Yarn dyeing': {
    inputs: ['Yarn'],
    output: 'Dyed yarn',
  },
  Warping: {
    inputs: ['Yarn', 'Dyed yarn'],
    output: 'Warp beam',
  },
  Weaving: {
    inputs: ['Warp beam', 'Yarn', 'Dyed yarn'],
    output: 'Greige fabric',
    needs: ['Warp beam', 'Yarn'],
  },
  Knitting: {
    inputs: ['Yarn', 'Dyed yarn'],
    output: 'Greige fabric',
  },
  'Fabric dyeing': {
    inputs: ['Greige fabric'],
    output: 'Dyed fabric',
  },
  'Fabric finishing': {
    inputs: ['Greige fabric', 'Dyed fabric'],
    output: 'Finished fabric',
  },
  'Fabric inspection': {
    inputs: ['Finished fabric', 'Dyed fabric'],
    output: 'Inspected fabric',
  },
  Cutting: {
    inputs: ['Finished fabric', 'Inspected fabric'],
    output: 'Cut bundle',
  },
  Embroidery: {
    inputs: ['Cut bundle'],
    output: 'Embroidered bundle',
  },
  Printing: {
    inputs: ['Cut bundle'],
    output: 'Printed bundle',
  },
  Stitching: {
    inputs: ['Cut bundle', 'Embroidered bundle', 'Printed bundle', 'Thread', 'Trim'],
    output: 'Sewn garment',
  },
  'Garment QC': {
    inputs: ['Sewn garment'],
    output: 'QC-passed garment',
  },
  'Garment finishing': {
    inputs: ['QC-passed garment'],
    output: 'Finished garment',
  },
  'Final inspection': {
    inputs: ['Finished garment'],
    output: 'Released garment',
  },
  Packing: {
    inputs: ['Released garment', 'Carton', 'Polybag', 'Hangtag'],
    output: 'Packed carton',
    needs: ['Released garment', 'Carton'],
  },
};
const MATERIALS = [
  'Cotton fibre',
  'Cotton bale',
  'Wool fibre',
  'Flax fibre',
  'Hemp fibre',
  'Prepared fibre',
  'Yarn',
  'Dyed yarn',
  'Warp beam',
  'Greige fabric',
  'Dyed fabric',
  'Finished fabric',
  'Inspected fabric',
  'Chemical',
  'Thread',
  'Trim',
  'Carton',
  'Polybag',
  'Hangtag',
  'Cut bundle',
  'Embroidered bundle',
  'Printed bundle',
  'Sewn garment',
  'QC-passed garment',
  'Finished garment',
  'Released garment',
  'Packed carton',
  'Other',
];
const UNITS = ['kg', 'm', 'pcs', 'L', 'bale', 'cone', 'roll', 'carton'];
const SCHEMES = {
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
const DPP_FIELDS = [
  'GTIN',
  'Global model identifier',
  'Production batch',
  'Item serial',
  'HS code',
  'TARIC code',
  'Category',
  'ESPR sector',
  'PEFCR classification',
  'Passport status',
  'Manufacturer',
  'Manufacturer GLN / EORI',
  'Manufacturer address',
  'Manufacturer contact',
  'Importer',
  'Importer GLN / EORI',
  'Importer contact',
  'Raw-material origin or facility',
  'Spinning facility',
  'Fabric-formation facility',
  'Assembly facility',
  'Fibre composition',
  'Robustness score',
  'Washing shrinkage',
  'Tensile strength',
  'Recyclability index',
  'Recycling disruption flags',
  'Total recycled content',
  'Pre-consumer recycled share',
  'Post-consumer recycled share',
  'Recycling technology',
  'Environmental footprint score',
  'Climate impact',
  'Water consumption',
  'Land-use indicator',
  'Substances of concern',
  'Substance concentration',
  'Substance-to-component map',
  'Wash care',
  'Repair guidance',
  'Disassembly instructions',
  'Take-back programme',
  'CE status',
  'EU declaration of conformity',
  'Audit body identifier',
  'Lab report',
  'Calculation trace',
  'Backup provider',
  'Digital signature',
];
const NAV = [
  ['OPERATIONS', 'Overview'],
  ['OPERATIONS', 'Buyer Orders'],
  ['OPERATIONS', 'Material Planning'],
  ['OPERATIONS', 'Inventory'],
  ['OPERATIONS', 'Work Orders'],
  ['OPERATIONS', 'Quality'],
  ['OPERATIONS', 'Movements'],
  ['FULFILMENT', 'Shipments & Invoices'],
  ['CONTROL', 'Standards & Evidence'],
  ['CONTROL', 'Costing & GST'],
  ['CONTROL', 'Digital Product Passport'],
  ['CONTROL', 'Traceability'],
  ['FINANCE', 'Accounts'],
  ['FINANCE', 'Vouchers'],
  ['FINANCE', 'Financial Reports'],
  ['ADMIN', 'Settings & Data'],
];
const empty = () => ({
  schema: 2,
  next: 1,
  company: 'HAPZO Decaste',
  facility: 'Main Mill',
  currency: 'INR',
  orders: [],
  lines: [],
  lots: [],
  events: [],
  workOrders: [],
  requisitions: [],
  shipments: [],
  invoices: [],
  evidence: [],
  costs: [],
  passports: [],
  audit: [],
  legacyPilot: null,
});
const id = (s, p) => p + '-' + String(s.next++).padStart(5, '0');
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const esc = (x) => String(x ?? '');
const round = (n) => Math.round((Number(n) + Number.EPSILON) * 1e6) / 1e6;
const fmt = (n) =>
  Number(n || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 3,
  });
const money = (n, c = 'INR') =>
  Number(n || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: c,
    maximumFractionDigits: 2,
  });
const req = (x, label) => {
  const v = String(x ?? '').trim();
  if (!v) throw Error(label + ' is required.');
  return v;
};
const num = (x, label, min = 0) => {
  const v = Number(x);
  if (x === '' || !Number.isFinite(v) || v < min) throw Error(label + ' is invalid.');
  return v;
};
const validDate = (d) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) &&
  !Number.isNaN(Date.parse(d)) &&
  new Date(d).toISOString().slice(0, 10) === d;
const ref = (a, key) => a.find((x) => x.id === key);
const available = (l) => Math.max(0, round(l.qty - (l.reservations || []).reduce((a, r) => a + r.qty, 0)));
const badge = (text, kind = '') => <span className={'badge ' + kind}>{esc(text)}</span>;
const btn = (label, attrs = '', cls = '') => (
  <button type="button" className={'button ' + cls} {...attrs}>
    {esc(label)}
  </button>
);
const linkLot = (lotId) => (
  <button type="button" className="inline" data-trace={esc(lotId)}>
    {esc(lotId)}
  </button>
);
const opt = (v, t) => <option value={esc(v)}>{esc(t ?? v)}</option>;
const field = (
  label,
  name,
  extra = {
    required: true,
  },
  type = 'text',
) => (
  <label>
    {label}
    <input name={name} type={type} {...extra} />
  </label>
);
const nfield = (
  label,
  name,
  extra = {
    required: true,
  },
) =>
  field(label, name, {
    type: 'number',
    min: '0',
    step: 'any',
    ...extra,
  });
const select = (label, name, items, required = true, blank = 'Select…', initial) => (
  <label>
    {esc(label)}
    <SelectControl name={esc(name)} required={required} defaultValue={initial}>
      {opt('', blank)}
      {joinContent(
        items.map((x) => (Array.isArray(x) ? opt(x[0], x[1]) : opt(x))),
        '',
      )}
    </SelectControl>
  </label>
);
const area = (label, name, placeholder = '', extra = {}) => (
  <label>
    {esc(label)}
    <textarea name={esc(name)} {...extra} placeholder={esc(placeholder)} />
  </label>
);
const form = (action, fields, label, note = '') => (
  <form data-form={action}>
    <div className="fields">{fields}</div>
    {note ? <div className="note">{note}</div> : ''}
    <button className="button">{esc(label)}</button>
  </form>
);
const panel = (title, body) => (
  <section className="panel">
    <h2>{esc(title)}</h2>
    {body}
  </section>
);
const table = (cols, rows) =>
  rows.length ? (
    <div className="table">
      <table>
        <thead>
          <tr>
            {joinContent(
              cols.map((c) => <th>{esc(c)}</th>),
              '',
            )}
          </tr>
        </thead>
        <tbody>
          {joinContent(
            rows.map((r) => (
              <tr>
                {joinContent(
                  r.map((v) => <td>{v}</td>),
                  '',
                )}
              </tr>
            )),
            '',
          )}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="empty">No records yet.</p>
  );
const audit = (s, action, reference) =>
  s.audit.push({
    id: id(s, 'AU'),
    at: new Date().toISOString(),
    action,
    ref: reference || '',
  });
let state,
  view = 'Overview',
  traceId = '',
  passportId = '',
  storageWarning = false;
function migrateV1(old) {
  const s = empty();
  s.legacyPilot = old;
  (old.orders || []).forEach((o) => {
    s.orders.push({
      id: o.id,
      po: o.po,
      buyer: o.buyer,
      currency: o.currency || 'INR',
      created: o.created || today(),
      attachment: null,
    });
    s.lines.push({
      id: o.id + '-L01',
      orderId: o.id,
      lineNo: '1',
      style: o.style,
      color: '',
      size: '',
      qty: o.qty,
      unit: o.unit || 'kg',
      delivery: '',
      route: o.route?.includes('knitted') ? 'Knitted garment' : 'Woven garment',
      scheme: o.scheme || 'Conventional',
      specRev: 'Legacy',
      approvedSpec: 'Migrated from pilot order',
      bomRev: '',
      bom: [],
    });
  });
  (old.lots || []).forEach((l) =>
    s.lots.push({
      ...l,
      initialQty: l.received || l.qty,
      qualityStatus: l.hold ? 'Pending inspection' : 'Released',
      standardHold: !!l.hold,
      holdReason: l.reason || '',
      custody: l.custody || 'Own site',
      reservations: [],
      allocations: l.order
        ? [
            {
              lineId: l.order + '-L01',
              qty: l.qty || 0,
            },
          ]
        : [],
      cartonCount: l.material === 'Packed carton' ? 1 : 0,
      unit: l.unit || 'kg',
    }),
  );
  s.events = old.events || [];
  s.evidence = old.evidence || [];
  s.costs = old.costs || [];
  s.passports = old.passports || [];
  s.next = Math.max(old.next || 1, 1);
  s.audit.push({
    id: 'AU-MIGRATION',
    at: new Date().toISOString(),
    action: 'Migrated pilot data to ERP schema v2',
    ref: '',
  });
  return s;
}
function demo() {
  const s = empty(),
    order = {
      id: id(s, 'PO'),
      po: 'DC-26018',
      buyer: 'Demo Retail',
      currency: 'INR',
      created: today(),
      attachment: null,
    };
  s.orders.push(order);
  const line = {
    id: id(s, 'LINE'),
    orderId: order.id,
    lineNo: '1',
    style: 'Cotton poplin shirt',
    color: 'Navy',
    size: 'M',
    qty: 460,
    unit: 'pcs',
    delivery: today(),
    route: 'Woven garment',
    scheme: 'Conventional',
    specRev: 'SPEC-03',
    approvedSpec: '100% cotton poplin, 120 GSM, navy; approved sample on file.',
    bomRev: 'BOM-03',
    bom: [
      {
        material: 'Dyed yarn',
        per: 0.22,
        unit: 'kg',
      },
      {
        material: 'Trim',
        per: 7,
        unit: 'pcs',
      },
    ],
  };
  s.lines.push(line);
  const makeLot = (lotId, material, qty, unit, parents = [], stage = '', allocation = 0, loc = 'Main Mill') => {
    const l = {
      id: lotId,
      material,
      label: material + ' · ' + lotId,
      qty,
      initialQty: qty,
      unit,
      scheme: 'Conventional',
      party: stage ? 'HAPZO Decaste' : 'Demo Supplier',
      site: stage ? 'Main Mill' : 'Demo Supplier Site',
      location: loc,
      date: today(),
      parents: parents.map((p) => ({
        id: p.id,
        qty: p.qty,
        unit: p.unit,
      })),
      stage,
      orderId: order.id,
      allocations: allocation
        ? [
            {
              lineId: line.id,
              qty: allocation,
            },
          ]
        : [],
      qualityStatus: 'Released',
      standardHold: false,
      holdReason: '',
      custody: 'Own site',
      reservations: [],
      cartonCount: material === 'Packed carton' ? 1 : 0,
    };
    s.lots.push(l);
    return l;
  };
  const received = makeLot('FIB-001', 'Cotton fibre', 1000, 'kg', [], 'Goods receipt', 0, 'Raw Store');
  s.events.push({
    id: id(s, 'EVT'),
    kind: 'Goods receipt',
    date: today(),
    output: received.id,
    qty: 1000,
    unit: 'kg',
    from: 'Demo Supplier Site',
    to: 'Raw Store',
    reference: 'GRN-26001',
  });
  const process = (stage, ins, outId, qty, unit, loss, allocation = 0) => {
    const inputs = ins.map(([lotId, q]) => {
      const l = ref(s.lots, lotId);
      l.qty = round(l.qty - q);
      return {
        id: lotId,
        qty: q,
        unit: l.unit,
      };
    });
    const out = makeLot(outId, STAGES[stage].output, qty, unit, inputs, stage, allocation, 'Production WIP');
    s.events.push({
      id: id(s, 'EVT'),
      kind: stage,
      date: today(),
      inputs,
      output: outId,
      qty,
      unit,
      loss,
      lossUnit: inputs[0]?.unit || unit,
      orderId: order.id,
      site: 'Main Mill',
      party: 'HAPZO Decaste',
      reference: 'JOB-DEMO',
      workerHours: 0,
      machine: '',
      machineHours: 0,
      energyKwh: 0,
      waterL: 0,
      iotRef: '',
    });
    return out;
  };
  process('Fibre preparation', [['FIB-001', 1000]], 'FIB-002', 990, 'kg', 10);
  process('Spinning', [['FIB-002', 990]], 'YRN-1001', 970, 'kg', 20);
  process('Yarn dyeing', [['YRN-1001', 950]], 'YRN-1002', 945, 'kg', 5);
  process('Warping', [['YRN-1002', 400]], 'WRP-1001', 395, 'kg', 5);
  process(
    'Weaving',
    [
      ['WRP-1001', 395],
      ['YRN-1002', 300],
    ],
    'GRG-1001',
    650,
    'kg',
    45,
  );
  process('Fabric dyeing', [['GRG-1001', 650]], 'DYE-1001', 640, 'kg', 10);
  process('Fabric finishing', [['DYE-1001', 640]], 'FAB-1001', 620, 'kg', 20);
  process('Fabric inspection', [['FAB-1001', 620]], 'FAB-1002', 610, 'kg', 10);
  process('Cutting', [['FAB-1002', 100]], 'CUT-1001', 500, 'pcs', 10, 460);
  process('Embroidery', [['CUT-1001', 500]], 'EMB-1001', 490, 'pcs', 10, 460);
  process('Stitching', [['EMB-1001', 490]], 'SEW-1001', 480, 'pcs', 10, 460);
  process('Garment QC', [['SEW-1001', 480]], 'QC-1001', 470, 'pcs', 10, 460);
  process('Garment finishing', [['QC-1001', 470]], 'FIN-1001', 465, 'pcs', 5, 460);
  process('Final inspection', [['FIN-1001', 465]], 'REL-1001', 460, 'pcs', 5, 460);
  const cartonStock = makeLot('PKG-001', 'Carton', 2, 'carton', [], 'Goods receipt', 0, 'Packaging Store');
  s.events.push({
    id: id(s, 'EVT'),
    kind: 'Goods receipt',
    date: today(),
    output: cartonStock.id,
    qty: 2,
    unit: 'carton',
    from: 'Demo Supplier',
    to: 'Packaging Store',
    reference: 'GRN-PKG-01',
  });
  const c1 = process(
    'Packing',
    [
      ['REL-1001', 230],
      ['PKG-001', 1],
    ],
    'CTN-26018-01',
    230,
    'pcs',
    0,
    230,
  );
  c1.cartonCount = 1;
  c1.label = 'Carton 1 · 230 pcs';
  const c2 = process(
    'Packing',
    [
      ['REL-1001', 230],
      ['PKG-001', 1],
    ],
    'CTN-26018-02',
    230,
    'pcs',
    0,
    230,
  );
  c2.cartonCount = 1;
  c2.label = 'Carton 2 · 230 pcs';
  for (const [lot, refNo] of [
    [c1, 'SHP-26018-01'],
    [c2, 'SHP-26018-02'],
  ]) {
    lot.qty = 0;
    const sh = {
      id: id(s, 'SHP'),
      number: refNo,
      lot: lot.id,
      qty: 230,
      unit: 'pcs',
      customer: 'Demo Retail',
      destination: 'EU Distribution Centre',
      carrier: 'Demo Logistics',
      tracking: refNo,
      port: 'Chennai',
      date: today(),
      allocations: [
        {
          lineId: line.id,
          qty: 230,
        },
      ],
    };
    s.shipments.push(sh);
    s.events.push({
      id: id(s, 'EVT'),
      kind: 'Dispatch',
      date: today(),
      output: lot.id,
      qty: 230,
      unit: 'pcs',
      to: sh.destination,
      reference: sh.number,
      shipmentId: sh.id,
      allocations: sh.allocations,
      orderId: order.id,
    });
    s.invoices.push({
      id: id(s, 'INV'),
      number: 'INV-' + refNo,
      date: today(),
      due: today(),
      shipmentId: sh.id,
      currency: 'INR',
      net: 115000,
      tax: 20700,
      amount: 135700,
      status: 'Issued',
    });
  }
  s.lots.push({
    id: 'YRN-HOLD-01',
    material: 'Yarn',
    label: 'GOTS yarn · evidence pending',
    qty: 50,
    initialQty: 50,
    unit: 'kg',
    scheme: 'GOTS',
    party: 'Example Certified Supplier',
    site: 'Example Mill',
    location: 'Quarantine',
    date: today(),
    parents: [],
    stage: 'Goods receipt',
    orderId: '',
    allocations: [],
    qualityStatus: 'Pending inspection',
    standardHold: true,
    holdReason: 'No reviewed GOTS supplier evidence on file.',
    custody: 'Own site',
    reservations: [],
    cartonCount: 0,
  });
  s.events.push({
    id: id(s, 'EVT'),
    kind: 'Goods receipt',
    date: today(),
    output: 'YRN-HOLD-01',
    qty: 50,
    unit: 'kg',
    from: 'Example Mill',
    to: 'Quarantine',
    reference: 'GRN-HOLD-01',
  });
  s.workOrders.push({
    id: id(s, 'WO'),
    number: 'WO-DEMO-001',
    stage: 'Weaving',
    lineId: line.id,
    plannedQty: 650,
    unit: 'kg',
    due: today(),
    site: 'Main Mill',
    priority: 'Normal',
    status: 'Completed',
    completedQty: 650,
    created: today(),
  });
  s.evidence.push({
    id: id(s, 'EV'),
    scheme: 'GOTS',
    kind: 'Scope certificate',
    role: 'Supplier',
    party: 'Example Certified Supplier',
    site: 'Example Mill',
    number: 'EXAMPLE-GOTS-01',
    issuer: 'Example issuer',
    issue: today(),
    from: today(),
    until: today(),
    operations: ['Supply'],
    status: 'Pending review',
    source: '',
  });
  s.costs.push({
    id: id(s, 'COST'),
    lot: 'FAB-1001',
    category: 'Dyeing',
    reference: 'COST-DEMO-01',
    currency: 'INR',
    rate: 1,
    net: 32000,
    freight: 1500,
    other: 500,
    gst: 6120,
    credit: 6120,
    landed: 34000,
    date: today(),
  });
  const points = DPP_FIELDS.map((name) => ({
    name,
    applicability: 'Unassessed',
    value: '',
  }));
  points[2].value = c1.id;
  points[9].value = 'Draft';
  points[21].value = '100% cotton';
  points[32].value = '1.266 kg CO₂e/kg electricity subtotal';
  points[33].value = '28.261 L/kg';
  s.passports.push({
    id: id(s, 'DPP'),
    lot: c1.id,
    version: 1,
    scope: 'Demo carton production and conversion boundary',
    evidence: 'Pilot demonstration values',
    composition: '100% cotton',
    electricity: 82,
    factor: 0.71,
    water: 1500,
    back: 200,
    weight: 46,
    recycled: 0,
    co2: 58.22,
    co2kg: 1.26565,
    waterKg: 28.26087,
    recycledPct: 0,
    status: 'Draft',
    date: today(),
    points,
  });
  return s;
}
try {
  const raw = localStorage.getItem(STORE);
  if (raw) state = JSON.parse(raw);
  else {
    const old = localStorage.getItem('hapzo-decaste-erp-pilot-v1');
    state = old ? migrateV1(JSON.parse(old)) : demo();
    localStorage.setItem(STORE, JSON.stringify(state));
  }
} catch (e) {
  state = demo();
  storageWarning = true;
}
function tx(action, fn, data) {
  const staged = structuredClone(state),
    result = fn(staged, data);
  audit(staged, action, result?.id || result?.number || '');
  try {
    localStorage.setItem(STORE, JSON.stringify(staged));
  } catch (e) {
    throw Error('Browser storage is full or unavailable. Export a backup and free space before saving.');
  }
  state = staged;
  storageWarning = false;
  return result;
}
function parseLines(text, label, columns) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const row = raw.trim();
    if (!row) continue;
    const parts = row.split(',').map((x) => x.trim());
    if (parts.length !== columns) throw Error(label + ' lines need ' + columns + ' comma-separated values.');
    out.push(parts);
  }
  return out;
}
function parseBom(text) {
  return parseLines(text, 'BOM', 3).map(([material, per, unit]) => {
    if (!UNITS.includes(unit)) throw Error('Unsupported BOM unit: ' + unit);
    return {
      material: req(material, 'BOM material'),
      per: num(per, 'BOM quantity per garment', 0.000001),
      unit,
    };
  });
}
function parseAllocations(s, text, defaultLine, qty, unit) {
  let rows = parseLines(text, 'Allocation', 2).map(([lineId, q]) => ({
    lineId: req(lineId, 'PO line'),
    qty: num(q, 'Allocation quantity', 0.000001),
  }));
  if (!rows.length && defaultLine) {
    const l = ref(s.lines, defaultLine);
    if (l && l.unit === unit)
      rows = [
        {
          lineId: l.id,
          qty,
        },
      ];
  }
  const seen = new Set();
  rows.forEach((a) => {
    const l = ref(s.lines, a.lineId);
    if (!l) throw Error('Unknown PO line in allocation: ' + a.lineId);
    if (l.unit !== unit) throw Error('Allocation unit must match the PO line unit.');
    if (seen.has(l.id)) throw Error('Each PO line can appear once in allocations.');
    seen.add(l.id);
  });
  if (rows.reduce((n, a) => n + a.qty, 0) > qty + 1e-8) throw Error('PO allocations cannot exceed production output.');
  return rows;
}
function createOrder(s, x) {
  const po = req(x.po, 'Buyer PO');
  if (s.orders.some((o) => o.po.toLowerCase() === po.toLowerCase())) throw Error('This buyer PO already exists.');
  const o = {
    id: id(s, 'PO'),
    po,
    buyer: req(x.buyer, 'Buyer'),
    currency: x.currency || 'INR',
    created: x.date || today(),
    attachment: x.attachment || null,
  };
  s.orders.push(o);
  return o;
}
function createLine(s, x) {
  const o = ref(s.orders, x.orderId);
  if (!o) throw Error('Select a buyer PO.');
  if (!ROUTES[x.route]) throw Error('Choose a supported garment route.');
  const l = {
    id: id(s, 'LINE'),
    orderId: o.id,
    lineNo: String(s.lines.filter((a) => a.orderId === o.id).length + 1),
    style: req(x.style, 'Style'),
    color: req(x.color, 'Colour'),
    size: req(x.size, 'Size'),
    qty: num(x.qty, 'Order quantity', 0.000001),
    unit: req(x.unit, 'Order unit'),
    delivery: x.delivery || '',
    route: x.route,
    scheme: x.scheme || 'Conventional',
    specRev: req(x.specRev, 'Approved specification revision'),
    approvedSpec: req(x.approvedSpec, 'Approved specification'),
    bomRev: String(x.bomRev || '').trim(),
    bom: parseBom(x.bom || ''),
  };
  if (!UNITS.includes(l.unit) || !Object.hasOwn(SCHEMES, l.scheme))
    throw Error('Choose a supported unit and standard.');
  if (l.delivery && !validDate(l.delivery)) throw Error('Enter a valid delivery date.');
  s.lines.push(l);
  return l;
}
function verifyEvidence(s, scheme, party, site, operation, on, role) {
  if (scheme === 'Conventional') return true;
  const required = SCHEMES[scheme] || [];
  const pass = s.evidence.some(
    (e) =>
      e.status === 'Reviewed for pilot' &&
      e.scheme === scheme &&
      e.role === role &&
      required.includes(e.kind) &&
      e.party.toLowerCase() === party.toLowerCase() &&
      e.site.toLowerCase() === site.toLowerCase() &&
      e.operations.includes(operation) &&
      (!e.from || e.from <= on) &&
      (!e.until || e.until >= on),
  );
  if (!pass)
    throw Error(
      'Standard Hold: reviewed ' +
        scheme +
        ' evidence is missing for ' +
        party +
        ' / ' +
        site +
        ' / ' +
        operation +
        '.',
    );
  return true;
}
function receive(s, x) {
  const material = req(x.material, 'Material'),
    lotId = req(x.lotId, 'Lot ID'),
    qty = num(x.qty, 'Receipt quantity', 0.000001),
    unit = req(x.unit, 'Unit'),
    date = x.date || today(),
    scheme = x.scheme || 'Conventional';
  if (!MATERIALS.includes(material) || !UNITS.includes(unit) || !validDate(date) || !Object.hasOwn(SCHEMES, scheme))
    throw Error('Check material, unit, scheme, and receipt date.');
  if (s.lots.some((l) => l.id.toLowerCase() === lotId.toLowerCase())) throw Error('Lot ID already exists.');
  const party = req(x.supplier, 'Supplier'),
    site = req(x.supplierSite, 'Supplier site');
  const l = {
    id: lotId,
    material,
    label: req(x.label || material, 'Material description'),
    qty,
    initialQty: qty,
    unit,
    scheme,
    party,
    site,
    location: req(x.location, 'Receiving location'),
    date,
    parents: [],
    stage: 'Goods receipt',
    orderId: '',
    allocations: [],
    qualityStatus: 'Pending inspection',
    standardHold: false,
    holdReason: '',
    custody: 'Own site',
    reservations: [],
    cartonCount: 0,
    purchaseReqId: x.purchaseReqId || '',
  };
  try {
    verifyEvidence(s, scheme, party, site, 'Supply', date, 'Supplier');
  } catch (e) {
    l.standardHold = true;
    l.holdReason = e.message;
  }
  s.lots.push(l);
  s.events.push({
    id: id(s, 'EVT'),
    kind: 'Goods receipt',
    date,
    output: l.id,
    qty,
    unit,
    from: site,
    to: l.location,
    party,
    scheme,
    reference: req(x.reference, 'Receipt / delivery reference'),
    purchaseReqId: l.purchaseReqId,
  });
  if (l.purchaseReqId) {
    const pr = ref(s.requisitions, l.purchaseReqId);
    if (pr) {
      pr.received = round(
        <>
          {pr.received || 0}
          {qty}
        </>,
      );
      pr.status = pr.received >= pr.qty ? 'Received' : 'Part received';
    }
  }
  return l;
}
function createRequisition(s, x) {
  const line = x.lineId ? ref(s.lines, x.lineId) : null;
  const pr = {
    id: id(s, 'PR'),
    number: req(x.number, 'Requisition number'),
    material: req(x.material, 'Material'),
    qty: num(x.qty, 'Requested quantity', 0.000001),
    unit: req(x.unit, 'Unit'),
    supplier: String(x.supplier || '').trim(),
    required: x.required || '',
    lineId: line?.id || '',
    status: 'Open',
    received: 0,
    date: today(),
    notes: String(x.notes || '').trim(),
  };
  if (!UNITS.includes(pr.unit) || s.requisitions.some((r) => r.number.toLowerCase() === pr.number.toLowerCase()))
    throw Error('Check unit or use a unique requisition number.');
  s.requisitions.push(pr);
  return pr;
}
function reserve(s, x) {
  const l = ref(s.lots, x.lotId),
    line = ref(s.lines, x.lineId);
  if (!l || !line) throw Error('Select a stock lot and PO line.');
  if (l.unit !== line.unit && x.confirmUnit !== 'yes')
    throw Error('Stock and PO units differ. Confirm the conversion against the approved BOM.');
  if (l.qualityStatus !== 'Released' || l.standardHold)
    throw Error('Only released, evidence-cleared stock can be reserved.');
  const q = num(x.qty, 'Reservation quantity', 0.000001);
  if (q > available(l)) throw Error('Reservation exceeds free stock.');
  l.reservations = l.reservations || [];
  const existing = l.reservations.find((r) => r.lineId === line.id);
  if (existing)
    existing.qty = round(
      <>
        {existing.qty}
        {q}
      </>,
    );
  else
    l.reservations.push({
      lineId: line.id,
      qty: q,
    });
  return {
    id: l.id,
  };
}
function createWorkOrder(s, x) {
  const line = x.lineId ? ref(s.lines, x.lineId) : null;
  if (x.lineId && !line) throw Error('Selected PO line does not exist.');
  const stage = req(x.stage, 'Operation');
  if (!STAGES[stage]) throw Error('Choose a valid production operation.');
  if (line && !ROUTES[line.route].includes(stage)) throw Error(stage + ' is outside the PO line route.');
  const number = req(x.number, 'Work order number');
  if (s.workOrders.some((w) => w.number.toLowerCase() === number.toLowerCase()))
    throw Error('Work order number already exists.');
  const w = {
    id: id(s, 'WO'),
    number,
    stage,
    lineId: line?.id || '',
    plannedQty: num(x.plannedQty, 'Planned quantity', 0.000001),
    unit: req(x.unit, 'Output unit'),
    due: x.due || '',
    site: req(x.site, 'Production site'),
    priority: x.priority || 'Normal',
    status: 'Planned',
    completedQty: 0,
    created: today(),
    notes: String(x.notes || '').trim(),
  };
  if (!UNITS.includes(w.unit) || (w.due && !validDate(w.due))) throw Error('Check work order unit or due date.');
  s.workOrders.push(w);
  return w;
}
function production(s, x) {
  const wo = ref(s.workOrders, x.workOrderId);
  if (!wo || wo.status === 'Completed' || wo.status === 'Cancelled') throw Error('Select an active work order.');
  const stage = wo.stage,
    definition = STAGES[stage],
    date = x.date || today();
  if (!validDate(date)) throw Error('Enter a valid operation date.');
  const outId = req(x.outputId, 'Output lot ID');
  if (s.lots.some((l) => l.id.toLowerCase() === outId.toLowerCase())) throw Error('Output lot ID already exists.');
  const qty = num(x.outputQty, 'Output quantity', 0.000001),
    unit = req(x.unit, 'Output unit');
  if (unit !== wo.unit) throw Error('Output unit must match work order unit.');
  const inputs = parseLines(x.inputs, 'Input', 2).map(([lotId, q]) => ({
    lotId: req(lotId, 'Input lot ID'),
    qty: num(q, 'Input quantity', 0.000001),
  }));
  if (!inputs.length || new Set(inputs.map((a) => a.lotId)).size !== inputs.length)
    throw Error('Enter unique input lot IDs and quantities.');
  const party = req(x.party, 'Processor'),
    site = req(x.site, 'Process site'),
    line = ref(s.lines, wo.lineId),
    outputAlloc = parseAllocations(s, x.allocations, line && line.unit === unit ? line.id : '', qty, unit),
    schemes = new Set(outputAlloc.map((a) => ref(s.lines, a.lineId)?.scheme).filter(Boolean));
  if (!schemes.size && line) schemes.add(line.scheme);
  if (!schemes.size) schemes.add(x.scheme || 'Conventional');
  if (schemes.size > 1) throw Error('A production batch cannot mix certification schemes.');
  for (const a of outputAlloc) {
    const allocatedLine = ref(s.lines, a.lineId);
    if (!ROUTES[allocatedLine.route].includes(stage))
      throw Error('Operation ' + stage + ' is outside route for ' + allocatedLine.id + '.');
  }
  const scheme = [...schemes][0];
  verifyEvidence(s, scheme, party, site, stage, date, 'Processor');
  const reservationLines = new Set([...outputAlloc.map((a) => a.lineId), wo.lineId].filter(Boolean)),
    used = inputs.map((a) => {
      const l = ref(s.lots, a.lotId);
      if (!l) throw Error('Input lot not found: ' + a.lotId);
      if (l.qualityStatus !== 'Released' || l.standardHold || l.custody === 'Commission')
        throw Error('Input is held, unreleased, or at an outside processor: ' + l.id);
      if (!definition.inputs.includes(l.material)) throw Error(stage + ' cannot consume ' + l.material + '.');
      if (l.scheme !== scheme) throw Error('Standard mismatch for input lot ' + l.id + '.');
      const own = (l.reservations || []).filter((r) => reservationLines.has(r.lineId)).reduce((z, r) => z + r.qty, 0),
        blocked = (l.reservations || []).reduce((z, r) => z + r.qty, 0) - own;
      if (a.qty > l.qty - blocked + 1e-8) throw Error('Input quantity exceeds available stock on ' + l.id + '.');
      if (l.date > date) throw Error('Input lot date is after operation date: ' + l.id + '.');
      return {
        lot: l,
        qty: a.qty,
        unit: l.unit,
      };
    });
  if (definition.needs)
    for (const wanted of definition.needs) {
      const ok =
        wanted === 'Yarn'
          ? used.some((a) => ['Yarn', 'Dyed yarn'].includes(a.lot.material))
          : used.some((a) => a.lot.material === wanted);
      if (!ok) throw Error(stage + ' needs ' + wanted + '.');
    }
  if (stage === 'Packing' && !used.some((a) => a.lot.material === 'Released garment'))
    throw Error('Packing needs released garments.');
  const waste = num(x.waste || '0', 'Waste quantity'),
    sameUnit = used.every((a) => a.unit === used[0].unit);
  if (sameUnit && waste > used.reduce((a, b) => a + b.qty, 0)) throw Error('Waste cannot exceed input quantity.');
  used.forEach((a) => {
    a.lot.qty = round(a.lot.qty - a.qty);
    let left = a.qty;
    for (const r of a.lot.reservations || [])
      if (reservationLines.has(r.lineId)) {
        const take = Math.min(r.qty, left);
        r.qty = round(r.qty - take);
        left -= take;
      }
    a.lot.reservations = (a.lot.reservations || []).filter((r) => r.qty > 1e-8);
  });
  const parents = used.map((a) => ({
      id: a.lot.id,
      qty: a.qty,
      unit: a.unit,
    })),
    linkedOrders = [...new Set(outputAlloc.map((a) => ref(s.lines, a.lineId)?.orderId).filter(Boolean))],
    out = {
      id: outId,
      material: definition.output,
      label: req(x.label || definition.output, 'Output description'),
      qty,
      initialQty: qty,
      unit,
      scheme,
      party,
      site,
      location: req(x.location, 'Output location'),
      date,
      parents,
      stage,
      orderId: linkedOrders.length === 1 ? linkedOrders[0] : line?.orderId || '',
      allocations: outputAlloc,
      qualityStatus: 'Released',
      standardHold: false,
      holdReason: '',
      custody: 'Own site',
      reservations: [],
      cartonCount: stage === 'Packing' ? 1 : 0,
      workOrderId: wo.id,
    };
  s.lots.push(out);
  s.events.push({
    id: id(s, 'EVT'),
    kind: stage,
    date,
    inputs: parents,
    output: out.id,
    qty,
    unit,
    loss: waste,
    lossUnit: sameUnit ? used[0].unit : '',
    site,
    party,
    orderId: out.orderId,
    allocations: outputAlloc,
    scheme,
    reference: String(x.reference || '').trim(),
    workOrderId: wo.id,
    workerHours: num(x.workerHours || '0', 'Labour hours'),
    machine: String(x.machine || '').trim(),
    machineHours: num(x.machineHours || '0', 'Machine hours'),
    energyKwh: num(x.energyKwh || '0', 'Electricity'),
    waterL: num(x.waterL || '0', 'Water'),
    iotRef: String(x.iotRef || '').trim(),
    iotVerified: x.iotVerified === 'yes',
  });
  wo.completedQty = round(
    <>
      {wo.completedQty}
      {qty}
    </>,
  );
  wo.status = wo.completedQty >= wo.plannedQty ? 'Completed' : 'In progress';
  return out;
}
function quality(s, x) {
  const l = ref(s.lots, x.lotId);
  if (!l) throw Error('Select a lot.');
  if (l.qualityStatus === 'Rejected') throw Error('Rejected lots cannot be released.');
  const decision = x.decision;
  if (!['Released', 'Hold', 'Rework', 'Rejected'].includes(decision)) throw Error('Choose a quality decision.');
  const checker = req(x.checker, 'Inspector'),
    reference = req(x.reference, 'Inspection reference');
  if (decision === 'Released' && l.standardHold) throw Error('Resolve evidence hold before quality release.');
  if (decision === 'Rejected') {
    l.qualityStatus = 'Rejected';
    l.rejectedQty = l.qty;
  } else l.qualityStatus = decision;
  l.lastInspection = {
    date: x.date || today(),
    checker,
    reference,
    notes: String(x.notes || '').trim(),
  };
  s.events.push({
    id: id(s, 'EVT'),
    kind: 'Quality inspection',
    date: l.lastInspection.date,
    output: l.id,
    qty: l.qty,
    unit: l.unit,
    decision,
    checker,
    reference,
    notes: l.lastInspection.notes,
  });
  return l;
}
function releaseStandard(s, lotId) {
  const l = ref(s.lots, lotId);
  if (!l || !l.standardHold) throw Error('Select a lot with an evidence hold.');
  verifyEvidence(s, l.scheme, l.party, l.site, 'Supply', l.date, 'Supplier');
  l.standardHold = false;
  l.holdReason = '';
  return l;
}
function movement(s, x) {
  const l = ref(s.lots, x.lotId);
  if (!l) throw Error('Select a lot.');
  if (l.qualityStatus !== 'Released' || l.standardHold) throw Error('Only released lots can move.');
  const kind = x.kind;
  if (!['Internal transfer', 'Commission outward', 'Commission return'].includes(kind))
    throw Error('Choose a supported movement.');
  if (kind === 'Commission return' && l.custody !== 'Commission')
    throw Error('This lot is not with an outside processor.');
  if (kind === 'Commission outward' && l.custody === 'Commission')
    throw Error('Return the lot before sending it again.');
  const q = num(x.qty, 'Movement quantity', 0.000001);
  if (q > available(l)) throw Error('Movement exceeds free stock.');
  const from = l.location,
    to = req(x.to, 'Destination'),
    date = x.date || today();
  if (!validDate(date) || date < l.date) throw Error('Enter a valid movement date.');
  const party = String(x.party || '').trim(),
    stage = String(x.stage || '').trim();
  if (kind === 'Commission outward')
    verifyEvidence(s, l.scheme, req(party, 'Processor'), to, req(stage, 'Outside operation'), date, 'Processor');
  let moved = l;
  if (q < l.qty) {
    const splitId = req(x.splitId, 'New split lot ID');
    if (s.lots.some((a) => a.id.toLowerCase() === splitId.toLowerCase())) throw Error('Split lot ID already exists.');
    l.qty = round(l.qty - q);
    moved = {
      ...structuredClone(l),
      id: splitId,
      label: l.label + ' · split',
      qty: q,
      initialQty: q,
      parents: [
        ...(l.parents || []),
        {
          id: l.id,
          qty: q,
          unit: l.unit,
        },
      ],
      reservations: [],
      location: to,
      date,
      custody: kind === 'Commission outward' ? 'Commission' : 'Own site',
    };
    s.lots.push(moved);
  } else {
    moved = l;
    moved.location = to;
    moved.custody = kind === 'Commission outward' ? 'Commission' : 'Own site';
  }
  s.events.push({
    id: id(s, 'EVT'),
    kind,
    date,
    output: moved.id,
    qty: q,
    unit: l.unit,
    from,
    to,
    party,
    stage,
    reference: req(x.reference, 'Movement reference'),
    scheme: l.scheme,
  });
  return {
    id: moved.id,
  };
}
function addEvidence(s, x) {
  const scheme = x.scheme,
    kind = x.kind;
  if (!SCHEMES[scheme]?.includes(kind) || !['Supplier', 'Processor'].includes(x.role))
    throw Error('Evidence type or role does not match scheme.');
  for (const d of [x.issue, x.from, x.until]) if (d && !validDate(d)) throw Error('Evidence dates must be valid.');
  if ((x.from && x.until && x.from > x.until) || (x.issue && x.until && x.issue > x.until))
    throw Error('Expiry must follow start and issue dates.');
  const ops = String(x.operations || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (!ops.length || ops.some((v) => v !== 'Supply' && !STAGES[v]))
    throw Error('List exact operations, separated by commas.');
  const certificate = kind !== 'Registration / tracker',
    e = {
      id: id(s, 'EV'),
      scheme,
      kind,
      role: x.role,
      party: req(x.party, 'Party'),
      site: req(x.site, 'Site'),
      number: req(x.number, 'Evidence number'),
      issuer: certificate ? req(x.issuer, 'Issuing body') : String(x.issuer || '').trim(),
      issue: x.issue || '',
      from: x.from || x.issue || '',
      until: x.until || '',
      operations: ops,
      status: 'Pending review',
      source: '',
    };
  s.evidence.push(e);
  return e;
}
function reviewEvidence(s, x) {
  const e = ref(s.evidence, x.evidenceId);
  if (!e) throw Error('Select an evidence record.');
  if (!['Reviewed for pilot', 'Withdrawn'].includes(x.status)) throw Error('Choose a review decision.');
  e.source = req(x.source, 'Verification reference');
  e.status = x.status;
  e.reviewed = today();
  return e;
}
function addCost(s, x) {
  const lot = ref(s.lots, x.lotId);
  if (!lot) throw Error('Select a lot.');
  const category = req(x.category, 'Cost category'),
    currency = x.currency || 'INR';
  if (!['INR', 'USD', 'EUR', 'GBP'].includes(currency)) throw Error('Unsupported currency.');
  const net = num(x.net, 'Net value'),
    freight = num(x.freight || '0', 'Freight'),
    other = num(x.other || '0', 'Other cost'),
    gst = num(x.gst || '0', 'GST'),
    credit = num(x.credit || '0', 'Recoverable GST'),
    rate = num(x.rate || '1', 'INR exchange rate', 0.000001);
  if (credit > gst) throw Error('Recoverable GST cannot exceed GST.');
  if (currency === 'INR' && rate !== 1) throw Error('INR exchange rate must be 1.');
  const c = {
    id: id(s, 'COST'),
    lot: lot.id,
    category,
    reference: req(x.reference, 'Voucher / invoice reference'),
    currency,
    rate,
    net,
    freight,
    other,
    gst,
    credit,
    landed: round(
      ((
        <>
          {net}
          {freight}
          {other}
          {gst}
        </>
      ) -
        credit) *
        rate,
    ),
    date: x.date || today(),
    workerHours: num(x.workerHours || '0', 'Labour hours'),
    machineHours: num(x.machineHours || '0', 'Machine hours'),
  };
  if (s.costs.some((a) => a.reference.toLowerCase() === c.reference.toLowerCase()))
    throw Error('Voucher reference already exists.');
  s.costs.push(c);
  return c;
}
function shippedQty(s, lineId) {
  return s.shipments.reduce(
    (sum, sh) => sum + (sh.allocations || []).filter((a) => a.lineId === lineId).reduce((n, a) => n + a.qty, 0),
    0,
  );
}
function shipment(s, x) {
  const lot = ref(s.lots, x.lotId);
  if (!lot || lot.material !== 'Packed carton') throw Error('Dispatch must reference a packed carton.');
  if (lot.qualityStatus !== 'Released' || lot.standardHold || lot.custody === 'Commission')
    throw Error('Carton is held, unreleased, or outside your custody.');
  const q = num(x.qty, 'Shipment quantity', 0.000001);
  if (q !== lot.qty) throw Error('Dispatch the full carton lot to preserve carton-level trace.');
  const date = x.date || today();
  if (!validDate(date) || date < lot.date) throw Error('Enter a valid shipment date.');
  const allocations = parseLines(x.allocations, 'Allocation', 2).map(([lineId, n]) => ({
    lineId,
    qty: num(n, 'Allocated quantity', 0.000001),
  }));
  if (!allocations.length || Math.abs(allocations.reduce((n, a) => n + a.qty, 0) - q) > 1e-8)
    throw Error('Shipment allocations must cover the full carton quantity.');
  for (const a of allocations) {
    const line = ref(s.lines, a.lineId),
      cartonQty = (lot.allocations || []).filter((z) => z.lineId === a.lineId).reduce((n, z) => n + z.qty, 0),
      already = s.shipments
        .filter((t) => t.lot === lot.id)
        .flatMap((t) => t.allocations || [])
        .filter((z) => z.lineId === a.lineId)
        .reduce((n, z) => n + z.qty, 0);
    if (!line || line.unit !== lot.unit) throw Error('Check the PO line allocation and units.');
    if (a.qty > cartonQty - already + 1e-8)
      throw Error('Shipment allocation exceeds the carton contents for ' + line.id + '.');
    if (a.qty > line.qty - shippedQty(s, line.id) + 1e-8)
      throw Error('Shipment exceeds remaining order quantity on ' + line.id + '.');
  }
  const sh = {
    id: id(s, 'SHP'),
    number: req(x.number, 'Shipment number'),
    lot: lot.id,
    qty: q,
    unit: lot.unit,
    customer: req(x.customer, 'Customer'),
    destination: req(x.destination, 'Ship-to destination'),
    carrier: String(x.carrier || '').trim(),
    tracking: String(x.tracking || '').trim(),
    port: String(x.port || '').trim(),
    date,
    allocations,
    reference: String(x.reference || '').trim(),
  };
  if (s.shipments.some((a) => a.number.toLowerCase() === sh.number.toLowerCase()))
    throw Error('Shipment number already exists.');
  lot.qty = 0;
  s.shipments.push(sh);
  s.events.push({
    id: id(s, 'EVT'),
    kind: 'Dispatch',
    date,
    output: lot.id,
    qty: q,
    unit: lot.unit,
    to: sh.destination,
    reference: sh.number,
    shipmentId: sh.id,
    allocations,
    scheme: lot.scheme,
  });
  return sh;
}
function invoice(s, x) {
  const sh = ref(s.shipments, x.shipmentId);
  if (!sh) throw Error('Select a dispatched shipment.');
  const number = req(x.number, 'Invoice number');
  if (s.invoices.some((a) => a.number.toLowerCase() === number.toLowerCase()))
    throw Error('Invoice number already exists.');
  if (s.invoices.some((a) => a.shipmentId === sh.id)) throw Error('This shipment already has an invoice.');
  const currency = x.currency || 'INR',
    net = num(x.net, 'Taxable value'),
    tax = num(x.tax || '0', 'Invoice tax'),
    inv = {
      id: id(s, 'INV'),
      number,
      shipmentId: sh.id,
      date: x.date || today(),
      due: x.due || '',
      currency,
      net,
      tax,
      amount: round(
        <>
          {net}
          {tax}
        </>,
      ),
      status: 'Issued',
      terms: String(x.terms || '').trim(),
    };
  s.invoices.push(inv);
  return inv;
}
function createPassport(s, x) {
  const lot = ref(s.lots, x.lotId);
  if (
    !lot ||
    !['Finished garment', 'Released garment', 'Packed carton', 'Finished fabric', 'Inspected fabric'].includes(
      lot.material,
    )
  )
    throw Error('Choose a finished product or fabric lot.');
  if (lot.qualityStatus !== 'Released' || lot.standardHold)
    throw Error('Passport source must be released and evidence-cleared.');
  const weight = num(x.weight, 'Reportable mass', 0.000001),
    recycled = num(x.recycled || '0', 'Verified recycled content'),
    electricity = num(x.electricity || '0', 'Electricity'),
    factor = num(x.factor || '0', 'Electricity factor'),
    water = num(x.water || '0', 'Water intake'),
    back = num(x.back || '0', 'Qualifying return');
  if (recycled > weight || back > water) throw Error('Check reportable mass, recycled content and water return.');
  const points = DPP_FIELDS.map((name) => ({
      name,
      applicability: 'Unassessed',
      value: '',
    })),
    p = {
      id: id(s, 'DPP'),
      lot: lot.id,
      version: s.passports.filter((a) => a.lot === lot.id).length + 1,
      scope: req(x.scope, 'Calculation boundary'),
      evidence: req(x.evidence, 'Measurement evidence'),
      composition: req(x.composition, 'Composition'),
      electricity,
      factor,
      water,
      back,
      weight,
      recycled,
      co2: round(electricity * factor),
      co2kg: round((electricity * factor) / weight),
      waterKg: round((water - back) / weight),
      recycledPct: round((100 * recycled) / weight),
      scheme: lot.scheme,
      status: 'Draft',
      date: today(),
      points,
    };
  [
    [3, lot.id],
    [10, 'Draft'],
    [22, p.composition],
    [28, fmt(p.recycledPct) + '%'],
    [33, fmt(p.co2kg) + ' kg CO₂e/kg electricity subtotal'],
    [34, fmt(p.waterKg) + ' L/kg'],
    [47, 'Lot ' + lot.id + '; evidence ' + p.evidence],
  ].forEach(([n, v]) => (p.points[n - 1].value = String(v)));
  s.passports.push(p);
  return p;
}
function updateDppPoint(s, x) {
  const p = ref(s.passports, x.passportId),
    n = num(x.point, 'DPP field number', 1);
  if (!p || n > DPP_FIELDS.length || !Number.isInteger(n)) throw Error('Select a valid draft field.');
  if (!['Unassessed', 'Applicable', 'Not applicable', 'Under review'].includes(x.applicability))
    throw Error('Choose applicability.');
  p.points[n - 1] = {
    name: DPP_FIELDS[n - 1],
    applicability: x.applicability,
    value: String(x.value || '').trim(),
  };
  return p;
}
function lineage(s, start, forward = false) {
  const seen = new Set([start]),
    out = [];
  function walk(current, depth) {
    if (depth > 250) return;
    const next = forward
      ? s.lots.filter((l) => (l.parents || []).some((p) => p.id === current))
      : (ref(s.lots, current)?.parents || []).map((p) => ref(s.lots, p.id)).filter(Boolean);
    for (const l of next) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      out.push(l);
      walk(l.id, depth + 1);
    }
  }
  walk(start, 0);
  return out;
}
function lineStatus(s, line) {
  const shipped = shippedQty(s, line.id),
    packed = s.lots
      .filter((l) => l.material === 'Packed carton' && l.qualityStatus === 'Released')
      .reduce(
        (n, l) => n + (l.allocations || []).filter((a) => a.lineId === line.id).reduce((z, a) => z + a.qty, 0),
        0,
      );
  return {
    shipped,
    packed,
    progress: Math.min(100, round((shipped / line.qty) * 100)),
  };
}
function lineOptions(s) {
  return s.lines.map((l) => [
    l.id,
    (ref(s.orders, l.orderId)?.po || '') + ' · ' + l.style + ' / ' + l.color + ' / ' + l.size + ' · ' + l.id,
  ]);
}
function lotOptions(s, predicate = () => true) {
  return s.lots.filter(predicate).map((l) => [l.id, l.id + ' · ' + l.material + ' · ' + fmt(l.qty) + ' ' + l.unit]);
}
function orderOptions(s) {
  return s.orders.map((o) => [o.id, o.po + ' · ' + o.buyer]);
}
function heading(title, desc) {
  return (
    <div className="heading">
      <div>
        <h1>{esc(title)}</h1>
        <p>{esc(desc)}</p>
      </div>
    </div>
  );
}
function orderLinesTable(s) {
  return table(
    ['PO / line', 'Style / colour / size', 'Route / scheme', 'Ordered', 'Packed', 'Shipped / delivery'],
    s.lines.map((l) => {
      const st = lineStatus(s, l);
      return [
        <>
          {esc((ref(s.orders, l.orderId)?.po || '') + ' / ' + l.lineNo)}
          <br />
          <small>{esc(l.id)}</small>
        </>,
        esc(l.style + ' / ' + l.color + ' / ' + l.size),
        <>
          {esc(l.route)}
          <br />
          {badge(l.scheme)}
        </>,
        esc(fmt(l.qty) + ' ' + l.unit),
        esc(fmt(st.packed) + ' ' + l.unit),
        <>
          {esc(fmt(st.shipped) + ' ' + l.unit + ' · ' + (l.delivery || 'No date'))}
          <div className="progress">
            <span
              style={{
                width: st.progress + '%',
              }}
            />
          </div>
        </>,
      ];
    }),
  );
}
function inventoryTable(s) {
  return table(
    ['Lot / material', 'Free / stock', 'Location / custody', 'Quality / standard', 'Stage'],
    s.lots
      .slice()
      .reverse()
      .map((l) => [
        <>
          {linkLot(l.id)}
          <br />
          <small>{esc(l.material + ' · ' + l.label)}</small>
        </>,
        esc(fmt(available(l)) + ' / ' + fmt(l.qty) + ' ' + l.unit),
        esc(l.location + ' · ' + (l.custody || 'Own site')),
        <>
          {badge(
            l.standardHold ? 'Evidence hold' : l.qualityStatus,
            l.standardHold || l.qualityStatus !== 'Released' ? 'warn' : '',
          )}
          <br />
          {badge(l.scheme)}
        </>,
        esc(l.stage || 'Goods receipt'),
      ]),
  );
}
const pages = {
  Overview: () => {
    const open = state.lines.filter((l) => shippedQty(state, l.id) < l.qty).length,
      holds = state.lots.filter((l) => l.standardHold || l.qualityStatus !== 'Released').length,
      recent = state.events.slice().reverse().slice(0, 8);
    return (
      <>
        {heading(
          'Operations overview',
          'Buyer commitments, floor execution, quality, inventory and fulfilment at a glance.',
        )}
        <div className="cards">
          {joinContent(
            [
              ['Buyer POs', state.orders.length],
              ['Open PO lines', open],
              ['Lots on hold / inspection', holds],
              ['Shipments posted', state.shipments.length],
            ].map((a) => (
              <div className="card">
                <small>{a[0]}</small>
                <strong>{a[1]}</strong>
              </div>
            )),
            '',
          )}
        </div>
        <div className="split">
          {panel('Order progress', orderLinesTable(state))}
          {panel(
            'Latest posted activity',
            table(
              ['Transaction', 'Lot', 'Quantity', 'Site / destination', 'Date'],
              recent.map((e) => [
                esc(e.kind),
                e.output ? linkLot(e.output) : '—',
                esc(fmt(e.qty) + ' ' + (e.unit || '')),
                esc(e.to || e.site || '—'),
                esc(e.date || ''),
              ]),
            ),
          )}
        </div>
        {panel(
          'Start here',
          <>
            <div className="actions">
              {btn(
                'Create buyer PO',
                {
                  'data-nav': 'Buyer Orders',
                },
                'secondary',
              )}
              {btn(
                'Receive material',
                {
                  'data-nav': 'Inventory',
                },
                'secondary',
              )}
              {btn(
                'Plan work',
                {
                  'data-nav': 'Work Orders',
                },
                'secondary',
              )}
              {btn(
                'Trace sample carton',
                {
                  'data-trace': 'CTN-26018-01',
                },
                'secondary',
              )}
              {btn(
                'Export backup',
                {
                  'data-export': 'true',
                },
                'secondary',
              )}
            </div>
            <div className="note">
              Sample data contains a cotton-to-carton trace with two separately dispatched cartons. Replace it with live
              records as you configure the workspace.
            </div>
          </>,
        )}
      </>
    );
  },
  'Buyer Orders': () => {
    const att = state.orders.map((o) => [
      esc(o.po),
      esc(o.buyer),
      esc(o.created),
      o.attachment ? (
        <a download={esc(o.attachment.name)} href={esc(o.attachment.data)}>
          {'Download '}
          {esc(o.attachment.name)}
        </a>
      ) : (
        <span className="muted">No file attached</span>
      ),
    ]);
    const lf = form(
      'line',
      <>
        {select('Buyer PO', 'orderId', orderOptions(state))}
        {field('Style', 'style')}
        {field('Colour', 'color')}
        {field('Size / variant', 'size')}
        {nfield('Ordered quantity', 'qty')}
        {select('Unit', 'unit', UNITS)}
        {field(
          'Delivery date',
          'delivery',
          {
            defaultValue: today(),
            required: true,
          },
          'date',
        )}
        {select('Production route', 'route', Object.keys(ROUTES))}
        {select('Claim / standard', 'scheme', Object.keys(SCHEMES))}
        {field('Approved specification revision', 'specRev')}
        {field('BOM revision', 'bomRev', {})}
        {area(
          'Approved specification',
          'approvedSpec',
          'Measurements, tolerances, finish, packaging and approved requirements',
          {
            required: true,
          },
        )}
        {area('BOM lines (material, quantity per garment, unit)', 'bom', 'Cotton yarn, 0.22, kg&#10;Buttons, 7, pcs')}
      </>,
      'Add PO line',
      'Use one line for each style, colour and size. Save the approved specification and BOM revision.',
    );
    return (
      <>
        {heading(
          'Buyer orders',
          'Capture buyer PO, original attachment, style/colour/size lines, delivery, approved specification and BOM revision.',
        )}
        <div className="split">
          {panel(
            'Buyer PO register',
            <>
              {table(['PO', 'Buyer', 'Created', 'Original attachment'], att)}
              {form(
                'order',
                <>
                  {field('Buyer PO number', 'po')}
                  {field('Buyer', 'buyer')}
                  {select('Currency', 'currency', ['INR', 'USD', 'EUR', 'GBP'])}
                  {field(
                    'PO date',
                    'date',
                    {
                      defaultValue: today(),
                      required: true,
                    },
                    'date',
                  )}
                  <label>
                    Original PO file (PDF or image, max 2 MB)
                    <input type="file" name="poFile" accept=".pdf,image/*" />
                  </label>
                </>,
                'Create buyer PO',
                'The attachment is stored in this browser. Export regular backups because browser storage has a finite limit.',
              )}
            </>,
          )}
          {panel('Add PO line', lf)}
        </div>
        {panel('PO line schedule & execution', orderLinesTable(state))}
      </>
    );
  },
  'Material Planning': () => {
    const demand = [];
    state.lines
      .filter((l) => l.bom?.length)
      .forEach((l) =>
        l.bom.forEach((b) => {
          const needed = round(l.qty * b.per),
            r = demand.find((d) => d.material === b.material && d.unit === b.unit);
          if (r) {
            r.needed = round(r.needed + needed);
            r.lines.push(l.id);
          } else
            demand.push({
              material: b.material,
              unit: b.unit,
              needed,
              available: 0,
              lines: [l.id],
            });
        }),
      );
    demand.forEach((d) => {
      d.available = state.lots
        .filter(
          (a) =>
            a.material.toLowerCase() === d.material.toLowerCase() &&
            a.unit === d.unit &&
            a.qualityStatus === 'Released' &&
            !a.standardHold,
        )
        .reduce((n, a) => n + available(a), 0);
    });
    const rows = demand.map((d) => {
        const short = Math.max(0, round(d.needed - d.available));
        return [
          esc(d.material),
          esc(fmt(d.needed) + ' ' + d.unit),
          esc(fmt(d.available) + ' ' + d.unit),
          short ? badge(fmt(short) + ' ' + d.unit, 'warn') : badge('Covered'),
          esc(d.lines.join(', ')),
        ];
      }),
      prs = table(
        ['Requisition', 'Material', 'Requested', 'Received', 'Need by', 'Status'],
        state.requisitions
          .slice()
          .reverse()
          .map((r) => [
            esc(r.number),
            esc(r.material),
            esc(fmt(r.qty) + ' ' + r.unit),
            esc(fmt(r.received || 0) + ' ' + r.unit),
            esc(r.required || '—'),
            badge(r.status, r.status === 'Open' ? 'warn' : ''),
          ]),
      );
    return (
      <>
        {heading(
          'Material planning & procurement',
          'Compare approved BOM demand with released stock, raise requisitions for shortages and reserve stock against PO lines.',
        )}
        {panel(
          'BOM demand vs released inventory',
          table(['Material', 'BOM demand', 'Available stock', 'Shortage', 'PO lines'], rows),
        )}
        <div className="split">
          {panel(
            'Reserve stock',
            form(
              'reserve',
              <>
                {select(
                  'Inventory lot',
                  'lotId',
                  lotOptions(state, (l) => available(l) > 0),
                )}
                {select('Buyer PO line', 'lineId', lineOptions(state))}
                {nfield('Quantity to reserve', 'qty')}
                <label className="subtle">
                  <span>
                    <input type="checkbox" name="confirmUnit" value="yes" />
                    {' Confirm differing stock / PO units against approved BOM'}
                  </span>
                </label>
              </>,
              'Reserve stock',
              'Reservations reduce free stock and are consumed when matching allocations are posted.',
            ),
          )}
          {panel(
            'Create requisition',
            form(
              'requisition',
              <>
                {field('Requisition number', 'number')}
                {field('Material', 'material')}
                {nfield('Requested quantity', 'qty')}
                {select('Unit', 'unit', UNITS)}
                {select('Link to PO line', 'lineId', lineOptions(state), false, 'General stock')}
                {field(
                  'Required by',
                  'required',
                  {
                    type: 'date',
                  },
                  'date',
                )}
                {field('Suggested supplier', 'supplier', {})}
                {area('Planning note', 'notes', 'Shortage / buyer demand')}
              </>,
              'Create requisition',
            ),
          )}
        </div>
        {panel('Requisition register', prs)}
      </>
    );
  },
  Inventory: () => {
    const rf = form(
      'receipt',
      <>
        {field('Material lot ID', 'lotId')}
        {field('Material description', 'label')}
        {select('Material type', 'material', MATERIALS)}
        {nfield('Received quantity', 'qty')}
        {select('Unit', 'unit', UNITS)}
        {select('Claim / standard', 'scheme', Object.keys(SCHEMES))}
        {field('Supplier', 'supplier')}
        {field('Supplier site / origin facility', 'supplierSite')}
        {field('Receiving location', 'location')}
        {field(
          'Receipt date',
          'date',
          {
            defaultValue: today(),
            required: true,
          },
          'date',
        )}
        {field('GRN / delivery reference', 'reference')}
        {select(
          'Purchase requisition',
          'purchaseReqId',
          state.requisitions.filter((r) => r.status !== 'Received').map((r) => [r.id, r.number + ' · ' + r.material]),
          false,
          'Not linked',
        )}
      </>,
      'Post goods receipt',
      'Receipts start Pending inspection. Non-conventional lots also require reviewed supplier evidence.',
    );
    return (
      <>
        {heading(
          'Inventory & receiving',
          'Receive material by physical lot, supplier, origin, standard, location and delivery reference.',
        )}
        <div className="split">
          {panel('Goods receipt', rf)}
          {panel('Stock position', inventoryTable(state))}
        </div>
        {panel(
          'Trace lots',
          <p className="muted">
            Select a lot number to inspect its lineage, reservations, quality history, movements and affected shipments.
          </p>,
        )}
      </>
    );
  },
  'Work Orders': () => {
    const wf = form(
      'workorder',
      <>
        {field('Work order number', 'number')}
        {select('Buyer PO line (optional)', 'lineId', lineOptions(state), false, 'Stock / mixed allocation')}
        {select('Operation', 'stage', Object.keys(STAGES))}
        {nfield('Planned output quantity', 'plannedQty')}
        {select('Output unit', 'unit', UNITS)}
        {field(
          'Due date',
          'due',
          {
            type: 'date',
          },
          'date',
        )}
        {field('Production site', 'site')}
        {select('Priority', 'priority', ['Low', 'Normal', 'High', 'Urgent'])}
        {area('Job sheet / work instruction', 'notes', 'Recipe, machine setup, job sheet number')}
      </>,
      'Release work order',
    );
    const pf = form(
      'production',
      <>
        {select(
          'Work order',
          'workOrderId',
          state.workOrders
            .filter((w) => w.status !== 'Completed' && w.status !== 'Cancelled')
            .map((w) => [w.id, w.number + ' · ' + w.stage]),
        )}
        {field('Output lot ID', 'outputId')}
        {field('Output description', 'label', {})}
        {nfield('Actual output quantity', 'outputQty')}
        {select('Output unit', 'unit', UNITS)}
        {field(
          'Transaction date',
          'date',
          {
            defaultValue: today(),
            required: true,
          },
          'date',
        )}
        {field('Processor / department', 'party', {
          required: true,
          defaultValue: 'HAPZO Decaste',
        })}
        {field('Process site', 'site', {
          required: true,
          defaultValue: 'Main Mill',
        })}
        {field('Output location', 'location', {
          required: true,
          defaultValue: 'Production WIP',
        })}
        {field('Job sheet / recipe reference', 'reference', {})}
        {nfield('Waste / reject quantity', 'waste', {
          required: true,
          defaultValue: '0',
        })}
        {area('Input lots (lot ID, quantity on each line)', 'inputs', 'YRN-1001, 40&#10;TRIM-001, 2', {
          required: true,
        })}
        {area('PO line allocations (line ID, quantity)', 'allocations', 'LINE-00001, 200')}
        {nfield('Labour hours', 'workerHours', {
          required: true,
          defaultValue: '0',
        })}
        {field('Machine / resource ID', 'machine', {})}
        {nfield('Machine hours', 'machineHours', {
          required: true,
          defaultValue: '0',
        })}
        {nfield('Electricity (kWh)', 'energyKwh', {
          required: true,
          defaultValue: '0',
        })}
        {nfield('Water (L)', 'waterL', {
          required: true,
          defaultValue: '0',
        })}
        {field('IoT reading / source reference', 'iotRef', {})}
        <label className="subtle">
          <span>
            <input type="checkbox" name="iotVerified" value="yes" />
            {' IoT reading verified against machine and run'}
          </span>
        </label>
      </>,
      'Post production transaction',
      'Inputs are decremented from released stock; output lots preserve input lot IDs and quantities.',
    );
    const wr = table(
        ['Work order', 'Operation / PO line', 'Plan / actual', 'Site / due', 'Status'],
        state.workOrders
          .slice()
          .reverse()
          .map((w) => [
            esc(w.number),
            esc(w.stage + ' · ' + (ref(state.lines, w.lineId)?.id || 'Stock batch')),
            esc(fmt(w.plannedQty) + ' / ' + fmt(w.completedQty || 0) + ' ' + w.unit),
            esc(w.site + ' · ' + (w.due || '—')),
            badge(w.status, w.status === 'Planned' ? 'warn' : ''),
          ]),
      ),
      events = table(
        ['Operation', 'Inputs', 'Output lot', 'Output / waste', 'Resources'],
        state.events
          .filter((e) => e.inputs?.length)
          .slice()
          .reverse()
          .map((e) => [
            esc(e.kind),
            esc(e.inputs.map((i) => i.id + ' (' + fmt(i.qty) + ' ' + (i.unit || '') + ')').join(', ')),
            linkLot(e.output),
            esc(fmt(e.qty) + ' ' + e.unit + ' / ' + fmt(e.loss || 0) + ' ' + (e.lossUnit || e.unit)),
            esc(
              fmt(e.workerHours || 0) +
                ' h labour · ' +
                fmt(e.machineHours || 0) +
                ' h machine · ' +
                fmt(e.energyKwh || 0) +
                ' kWh',
            ),
          ]),
      );
    return (
      <>
        {heading(
          'Work orders & production',
          'Release job sheets, then post actual issues, output, waste, labour, machine resources and attributable IoT readings.',
        )}
        <div className="split">
          {panel('Release work order', wf)}
          {panel('Post actual production', pf)}
        </div>
        {panel('Work order register', wr)}
        {panel('Production transaction ledger', events)}
      </>
    );
  },
  Quality: () => {
    const qf = form(
      'quality',
      <>
        {select(
          'Lot for inspection',
          'lotId',
          lotOptions(state, (l) => l.qualityStatus !== 'Released' || l.standardHold),
        )}
        {select('Decision', 'decision', ['Released', 'Hold', 'Rework', 'Rejected'])}
        {field('Inspector', 'checker')}
        {field('Inspection report / reference', 'reference')}
        {field(
          'Inspection date',
          'date',
          {
            defaultValue: today(),
            required: true,
          },
          'date',
        )}
        {area('Inspection findings', 'notes', 'Test result, sampling, defect, corrective action')}
      </>,
      'Post inspection',
      'A quality release cannot clear an open standards evidence hold.',
    );
    const rows = table(
      ['Lot', 'Material', 'Quantity', 'Decision / evidence gate', 'Last inspection'],
      state.lots
        .filter((l) => l.lastInspection || l.qualityStatus !== 'Released' || l.standardHold)
        .slice()
        .reverse()
        .map((l) => [
          linkLot(l.id),
          esc(l.material),
          esc(fmt(l.qty) + ' ' + l.unit),
          badge(
            l.standardHold ? 'Evidence hold' : l.qualityStatus,
            l.standardHold || l.qualityStatus !== 'Released' ? 'warn' : '',
          ),
          esc(l.lastInspection ? l.lastInspection.reference + ' · ' + l.lastInspection.checker : 'Awaiting inspection'),
        ]),
    );
    return (
      <>
        {heading(
          'Quality & release',
          'Record pass, hold, rework or reject decisions with inspector and report reference.',
        )}
        <div className="split">
          {panel('Record inspection', qf)}
          {panel('Quality queue', rows)}
        </div>
      </>
    );
  },
  Movements: () => {
    const mf = form(
      'movement',
      <>
        {select('Movement type', 'kind', ['Internal transfer', 'Commission outward', 'Commission return'])}
        {select(
          'Lot',
          'lotId',
          lotOptions(state, (l) => available(l) > 0),
        )}
        {nfield('Movement quantity', 'qty')}
        {field('New split lot ID (required for partial movement)', 'splitId', {})}
        {field('Destination site / location', 'to')}
        {field('Outside processor', 'party', {})}
        {select('Outside operation', 'stage', Object.keys(STAGES), false)}
        {field('Challan / gate pass / return reference', 'reference')}
        {field(
          'Movement date',
          'date',
          {
            defaultValue: today(),
            required: true,
          },
          'date',
        )}
      </>,
      'Post movement',
      'Partial movements create a child lot. Commission outward and return preserve custody history.',
    );
    const rows = table(
      ['Type', 'Lot', 'Quantity', 'From → to', 'Processor / reference', 'Date'],
      state.events
        .filter((e) => ['Internal transfer', 'Commission outward', 'Commission return'].includes(e.kind))
        .slice()
        .reverse()
        .map((e) => [
          esc(e.kind),
          linkLot(e.output),
          esc(fmt(e.qty) + ' ' + e.unit),
          esc((e.from || '—') + ' → ' + (e.to || '—')),
          esc((e.party || '') + ' · ' + (e.reference || '')),
          esc(e.date),
        ]),
    );
    return (
      <>
        {heading(
          'Warehouse & outside processing',
          'Move released lots or record material sent to and returned from an outside job worker.',
        )}
        <div className="split">
          {panel('Post movement', mf)}
          {panel('Movement ledger', rows)}
        </div>
      </>
    );
  },
  'Shipments & Invoices': () => {
    const packed = state.lots.filter(
        (l) =>
          l.material === 'Packed carton' &&
          l.qty > 0 &&
          l.qualityStatus === 'Released' &&
          !l.standardHold &&
          l.custody !== 'Commission',
      ),
      sf = form(
        'shipment',
        <>
          {select(
            'Packed carton lot',
            'lotId',
            packed.map((l) => [l.id, l.id + ' · ' + l.label + ' · ' + fmt(l.qty) + ' ' + l.unit]),
          )}
          {nfield('Quantity to dispatch (entire carton lot)', 'qty')}
          {field('Shipment / dispatch number', 'number')}
          {field(
            'Shipment date',
            'date',
            {
              defaultValue: today(),
              required: true,
            },
            'date',
          )}
          {field('Customer', 'customer')}
          {field('Ship-to destination', 'destination')}
          {field('Carrier', 'carrier', {})}
          {field('Tracking / AWB', 'tracking', {})}
          {field('Port / terminal', 'port', {})}
          {area('PO line allocations (line ID, quantity)', 'allocations', 'LINE-00001, 230', {
            required: true,
          })}
          {field('Shipment reference / notes', 'reference', {})}
        </>,
        'Post dispatch',
        'Dispatch the whole carton lot to preserve carton-level trace.',
      );
    const inf = form(
      'invoice',
      <>
        {select(
          'Dispatched shipment',
          'shipmentId',
          state.shipments.map((sh) => [sh.id, sh.number + ' · ' + sh.customer + ' · ' + fmt(sh.qty) + ' ' + sh.unit]),
        )}
        {field('Invoice number', 'number')}
        {field(
          'Invoice date',
          'date',
          {
            defaultValue: today(),
            required: true,
          },
          'date',
        )}
        {field(
          'Due date',
          'due',
          {
            type: 'date',
          },
          'date',
        )}
        {select('Currency', 'currency', ['INR', 'USD', 'EUR', 'GBP'])}
        {nfield('Taxable amount', 'net')}
        {nfield('Tax amount', 'tax', {
          required: true,
          defaultValue: '0',
        })}
        {field('Payment terms', 'terms', {})}
      </>,
      'Issue invoice',
    );
    const sr = table(
        ['Dispatch', 'Carton lot', 'Qty', 'Customer / destination', 'Carrier / tracking', 'Invoice'],
        state.shipments
          .slice()
          .reverse()
          .map((sh) => {
            const inv = state.invoices.find((i) => i.shipmentId === sh.id);
            return [
              esc(sh.number),
              linkLot(sh.lot),
              esc(fmt(sh.qty) + ' ' + sh.unit),
              esc(sh.customer + ' / ' + sh.destination),
              esc((sh.carrier || '') + ' / ' + (sh.tracking || '')),
              inv ? esc(inv.number + ' · ' + money(inv.amount, inv.currency)) : badge('Invoice pending', 'warn'),
            ];
          }),
      ),
      ir = table(
        ['Invoice', 'Shipment', 'Date / due', 'Taxable + tax', 'Status'],
        state.invoices
          .slice()
          .reverse()
          .map((i) => [
            esc(i.number),
            esc(ref(state.shipments, i.shipmentId)?.number || ''),
            esc(i.date + ' / ' + (i.due || '—')),
            esc(money(i.net, i.currency) + ' + ' + money(i.tax, i.currency)),
            badge(i.status),
          ]),
      );
    return (
      <>
        {heading(
          'Dispatch, logistics & invoicing',
          'Link carton-level shipments to PO lines and issue invoices against dispatched shipments.',
        )}
        <div className="split">
          {panel('Dispatch packed carton', sf)}
          {panel('Invoice shipment', inf)}
        </div>
        {panel('Shipment register', sr)}
        {panel('Invoice register', ir)}
      </>
    );
  },
  'Standards & Evidence': () => {
    const er = table(
        ['Evidence', 'Scheme / type', 'Party / site', 'Operation scope', 'Validity / status'],
        state.evidence
          .slice()
          .reverse()
          .map((e) => [
            esc(e.id + ' · ' + e.number),
            esc(e.scheme + ' · ' + e.kind),
            esc(e.party + ' / ' + e.site),
            esc(e.operations.join(', ')),
            <>
              {esc((e.from || '—') + ' → ' + (e.until || '—'))}
              <br />
              {badge(e.status, e.status !== 'Reviewed for pilot' ? 'warn' : '')}
            </>,
          ]),
      ),
      rv = form(
        'review',
        <>
          {select(
            'Evidence record',
            'evidenceId',
            state.evidence.map((e) => [e.id, e.id + ' · ' + e.number]),
          )}
          {select('Review decision', 'status', ['Reviewed for pilot', 'Withdrawn'])}
          {field('Verification reference', 'source')}
        </>,
        'Record review',
      ),
      ef = form(
        'evidence',
        <>
          {select(
            'Scheme',
            'scheme',
            Object.keys(SCHEMES).filter((x) => x !== 'Conventional'),
          )}
          {select('Evidence type', 'kind', [...new Set(Object.values(SCHEMES).flat())])}
          {select('Party role', 'role', ['Supplier', 'Processor'])}
          {field('Legal party name', 'party')}
          {field('Covered facility/site', 'site')}
          {field('Certificate / registration number', 'number')}
          {field('Issuing body', 'issuer', {})}
          {field(
            'Issue date',
            'issue',
            {
              type: 'date',
            },
            'date',
          )}
          {field(
            'Valid from',
            'from',
            {
              type: 'date',
            },
            'date',
          )}
          {field(
            'Expiry date',
            'until',
            {
              type: 'date',
            },
            'date',
          )}
          {field('Exact covered operations (comma separated)', 'operations', {
            placeholder: 'Supply, Weaving',
          })}
        </>,
        'Save evidence',
      );
    return (
      <>
        {heading(
          'Standards & evidence',
          'Maintain supplier and processor evidence by scheme, party, facility, operation and validity.',
        )}
        <div className="split">
          {panel(
            'Evidence register',
            <>
              {er}
              {rv}
            </>,
          )}
          {panel('Record evidence', ef)}
        </div>
        <div className="note alert">
          “Reviewed for pilot” records your verification reference. This local workspace does not contact or
          authenticate issuers.
        </div>
      </>
    );
  },
  'Costing & GST': () => {
    const cf = form(
      'cost',
      <>
        {select('Lot', 'lotId', lotOptions(state))}
        {select('Cost category', 'category', [
          'Material',
          'Labour',
          'Machine',
          'Freight',
          'Dyeing',
          'Finishing',
          'Energy',
          'Other',
        ])}
        {field('Invoice / voucher reference', 'reference')}
        {select('Currency', 'currency', ['INR', 'USD', 'EUR', 'GBP'])}
        {nfield('Approved INR exchange rate', 'rate', {
          required: true,
          defaultValue: '1',
        })}
        {nfield('Net material / service value', 'net')}
        {nfield('Freight', 'freight', {
          required: true,
          defaultValue: '0',
        })}
        {nfield('Other eligible costs', 'other', {
          required: true,
          defaultValue: '0',
        })}
        {nfield('GST charged', 'gst', {
          required: true,
          defaultValue: '0',
        })}
        {nfield('Recoverable GST', 'credit', {
          required: true,
          defaultValue: '0',
        })}
        {nfield('Labour hours represented', 'workerHours', {
          required: true,
          defaultValue: '0',
        })}
        {nfield('Machine hours represented', 'machineHours', {
          required: true,
          defaultValue: '0',
        })}
        {field(
          'Posting date',
          'date',
          {
            defaultValue: today(),
            required: true,
          },
          'date',
        )}
      </>,
      'Post cost',
      'Landed INR = (net + freight + other + GST − recoverable GST) × approved rate. No tax rate or ITC determination is made here.',
    );
    const rows = table(
      ['Voucher', 'Lot', 'Category', 'Currency / FX', 'GST / credit', 'Landed INR'],
      state.costs
        .slice()
        .reverse()
        .map((c) => [
          esc(c.reference),
          linkLot(c.lot),
          esc(c.category),
          esc(c.currency + ' · ' + fmt(c.rate)),
          esc(fmt(c.gst) + ' / ' + fmt(c.credit)),
          esc(money(c.landed)),
        ]),
    );
    return (
      <>
        {heading(
          'Costing & GST',
          'Attach material, processing, labour, machine, freight and eligible charges to physical lots.',
        )}
        <div className="split">
          {panel('Record lot cost', cf)}
          {panel('Posted costs', rows)}
        </div>
      </>
    );
  },
  'Digital Product Passport': () => {
    const pf = form(
      'passport',
      <>
        {select(
          'Finished product / fabric lot',
          'lotId',
          lotOptions(state, (l) =>
            ['Finished garment', 'Released garment', 'Packed carton', 'Finished fabric', 'Inspected fabric'].includes(
              l.material,
            ),
          ),
        )}
        {field('Composition', 'composition')}
        {nfield('Reportable mass (kg)', 'weight')}
        {nfield('Verified recycled mass (kg)', 'recycled', {
          required: true,
          defaultValue: '0',
        })}
        {nfield('Electricity (kWh)', 'electricity', {
          required: true,
          defaultValue: '0',
        })}
        {nfield('Electricity factor (kg CO₂e/kWh)', 'factor', {
          required: true,
          defaultValue: '0',
        })}
        {nfield('Water intake (L)', 'water', {
          required: true,
          defaultValue: '0',
        })}
        {nfield('Qualifying water return (L)', 'back', {
          required: true,
          defaultValue: '0',
        })}
        {field('Calculation boundary', 'scope')}
        {field('Measurement / factor evidence', 'evidence')}
      </>,
      'Create DPP draft',
      'Pilot calculation draft only. The 49 mapping points track values and applicability; this does not publish a regulatory passport.',
    );
    const rows = table(
      ['Draft', 'Product lot', 'Climate subtotal', 'Water', 'Recycled', ''],
      state.passports
        .slice()
        .reverse()
        .map((p) => [
          esc(p.id + ' · v' + p.version),
          linkLot(p.lot),
          esc(fmt(p.co2kg) + ' kg CO₂e/kg'),
          esc(fmt(p.waterKg) + ' L/kg'),
          esc(fmt(p.recycledPct) + '%'),
          btn(
            'Open',
            {
              'data-passport': esc(p.id),
            },
            'secondary',
          ),
        ]),
    );
    return (
      <>
        {heading(
          'Digital Product Passport',
          'Create trace-linked calculation drafts and assess all 49 project mapping points.',
        )}
        <div className="split">
          {panel(
            'Passport drafts',
            <>
              {rows}
              <div id="passportDetail">{passportId ? passportDetail(passportId) : ''}</div>
            </>,
          )}
          {panel('Create DPP draft', pf)}
        </div>
      </>
    );
  },
  Traceability: () => (
    <>
      {heading(
        'Traceability & digital thread',
        'Trace backward from a carton to garment, fabric, yarn and fibre; trace forward from an input to affected production, cartons and shipments.',
      )}
      {panel(
        'Find a lot',
        form(
          'lookup',
          field('Lot ID or HZ:LOT payload', 'query', {
            placeholder: 'CTN-26018-01',
          }),
          'Trace lot',
          <label>
            Scan QR image (browser support varies)
            <input type="file" id="qrImage" accept="image/*" />
          </label>,
        ),
      )}
      {traceId ? traceDetail(traceId) : ''}
    </>
  ),
  'Settings & Data': () => {
    const cf = form(
        'company',
        <>
          {field('Company / workspace name', 'company')}
          {field('Default facility', 'facility')}
          {select('Reporting currency', 'currency', ['INR', 'USD', 'EUR', 'GBP'])}
        </>,
        'Save workspace',
      ),
      data = panel(
        'Back up and move workspace data',
        <>
          <p className="muted">
            Export the full local record set as JSON. Import restores it in this browser. Keep copies outside the
            browser.
          </p>
          <div className="actions">
            {btn('Export full backup', {
              'data-export': 'true',
            })}
            <label className="button secondary">
              Import JSON backup
              <input id="importFile" type="file" accept=".json,application/json" className="hide" />
            </label>
            {btn(
              'Restore sample workspace',
              {
                'data-reset': 'true',
              },
              'danger',
            )}
          </div>
        </>,
      ),
      ar = table(
        ['Time', 'Action', 'Record'],
        state.audit
          .slice()
          .reverse()
          .slice(0, 100)
          .map((a) => [esc(new Date(a.at).toLocaleString()), esc(a.action), esc(a.ref || '—')]),
      );
    return (
      <>
        {heading(
          'Workspace settings & data',
          'Configure this local workspace and protect records with regular exports.',
        )}
        <div className="split">
          {panel('Workspace defaults', cf)}
          {data}
        </div>
        {panel(
          'Data counts',
          <div className="cards">
            {joinContent(
              [
                ['POs', state.orders.length],
                ['PO lines', state.lines.length],
                ['Lots', state.lots.length],
                ['Operations', state.events.length],
                ['Shipments', state.shipments.length],
                ['DPP drafts', state.passports.length],
              ].map((a) => (
                <div className="card">
                  <small>{a[0]}</small>
                  <strong>{a[1]}</strong>
                </div>
              )),
              '',
            )}
          </div>,
        )}
        {panel('Recent audit trail', ar)}
        {state.legacyPilot
          ? panel('Migrated pilot data', <p>Full exports retain the original pilot records in legacyPilot.</p>)
          : ''}
      </>
    );
  },
};
function render() {
  renderPilot(
    document.getElementById('nav'),
    joinContent(
      NAV.map(([g, n], i) => (
        <>
          {i === 0 || NAV[i - 1][0] !== g ? <div className="nav-label">{esc(g)}</div> : ''}
          <button data-nav={esc(n)} aria-current={view === n ? 'page' : undefined}>
            {esc(n)}
          </button>
        </>
      )),
      '',
    ),
  );
  document.getElementById('saveState').textContent = storageWarning ? 'Storage warning' : 'Saved locally';
  renderPilot(
    document.getElementById('content'),
    <>
      {storageWarning ? (
        <div className="note alert">
          Browser storage could not be read. Export a backup before clearing this browser.
        </div>
      ) : (
        ''
      )}
      {state.company && state.company !== 'HAPZO Decaste' ? <p>{esc(state.company)}</p> : ''}
      {pages[view]()}
    </>,
  );
}
function traceDetail(lotId) {
  const lot = ref(state.lots, lotId);
  if (!lot)
    return panel(
      'Lot not found',
      <p>
        {'No lot matches '}
        {esc(lotId)}.
      </p>,
    );
  const up = lineage(state, lot.id),
    down = lineage(state, lot.id, true),
    events = state.events.filter((e) => e.output === lot.id || (e.inputs || []).some((a) => a.id === lot.id)),
    cartons = [lot, ...down].filter((l) => l.material === 'Packed carton'),
    ships = state.shipments.filter((sh) => cartons.some((c) => c.id === sh.lot)),
    orderIds = new Set(
      [
        ...(lot.allocations || []).map((a) => ref(state.lines, a.lineId)?.orderId),
        ...down.flatMap((l) => (l.allocations || []).map((a) => ref(state.lines, a.lineId)?.orderId)),
      ].filter(Boolean),
    ),
    row = (l) => (
      <div className="trace-node">
        {linkLot(l.id)} {esc(l.material + ' · ' + fmt(l.qty) + ' ' + l.unit + ' · ' + l.location)}{' '}
        {badge(l.qualityStatus, l.standardHold || l.qualityStatus !== 'Released' ? 'warn' : '')}
      </div>
    ),
    qrows = events
      .filter((e) => e.kind === 'Quality inspection')
      .map((e) => [
        esc(e.date),
        badge(e.decision, e.decision === 'Released' ? '' : 'warn'),
        esc(e.checker + ' · ' + e.reference),
        esc(e.notes || ''),
      ]),
    cost = state.costs
      .filter((c) => [lot.id, ...up.map((a) => a.id)].includes(c.lot))
      .reduce((n, c) => n + c.landed, 0);
  return panel(
    lot.id + ' · ' + lot.label,
    <>
      <div className="actions">
        {badge(lot.qualityStatus, lot.standardHold || lot.qualityStatus !== 'Released' ? 'warn' : '')}
        {badge(lot.scheme)}
        {badge(lot.custody || 'Own site', lot.custody === 'Commission' ? 'warn' : '')}
      </div>
      <p className="note">
        {'Available '}
        {esc(fmt(available(lot)) + ' ' + lot.unit)}
        {' of '}
        {esc(fmt(lot.qty) + ' ' + lot.unit)}
        {' at '}
        {esc(lot.location)}
        {' · '}
        {esc(lot.stage || 'Goods receipt')}
        {lot.holdReason ? ' · ' + esc(lot.holdReason) : ''}
      </p>
      {lot.standardHold ? (
        <div className="actions">
          {btn(
            'Recheck supplier evidence',
            {
              'data-release': esc(lot.id),
            },
            'secondary',
          )}
        </div>
      ) : (
        ''
      )}
      <div className="split">
        {panel(
          'Upstream input lots',
          up.length ? joinContent(up.map(row), '') : <p className="empty">Source receipt</p>,
        )}
        {panel(
          'Downstream affected lots',
          down.length ? joinContent(down.map(row), '') : <p className="empty">No downstream production yet</p>,
        )}
      </div>
      {panel(
        'Operations and movements',
        table(
          ['Transaction', 'Output / lot', 'Inputs / destination', 'Quantity', 'Date / reference'],
          events.map((e) => [
            esc(e.kind),
            e.output ? linkLot(e.output) : '—',
            esc((e.inputs || []).map((i) => i.id + ' ' + fmt(i.qty) + ' ' + i.unit).join(', ') || e.to || '—'),
            esc(fmt(e.qty) + ' ' + (e.unit || '')),
            esc((e.date || '') + ' · ' + (e.reference || '')),
          ]),
        ),
      )}
      {ships.length
        ? panel(
            'Customer shipments',
            table(
              ['Shipment', 'Qty', 'Ship to', 'Carrier / tracking', 'Date'],
              ships.map((sh) => [
                esc(sh.number),
                esc(fmt(sh.qty) + ' ' + sh.unit),
                esc(sh.customer + ' · ' + sh.destination),
                esc((sh.carrier || '') + ' · ' + (sh.tracking || '')),
                esc(sh.date),
              ]),
            ),
          )
        : ''}
      {qrows.length
        ? panel('Quality history', table(['Date', 'Decision', 'Inspector / report', 'Findings'], qrows))
        : ''}
      {panel(
        'Buyer order & cost links',
        <p>
          {esc(
            [...orderIds]
              .map((i) => ref(state.orders, i)?.po || '')
              .filter(Boolean)
              .join(', ') || 'No PO allocation',
          )}
          {' · Ancestor cost total '}
          {esc(money(cost))}
        </p>,
      )}
    </>,
  );
}
function passportDetail(pid) {
  const p = ref(state.passports, pid);
  if (!p) return '';
  const apps = ['Unassessed', 'Applicable', 'Not applicable', 'Under review'],
    rows = joinContent(
      p.points.map((q, i) => (
        <tr>
          <td>{i + 1}</td>
          <td>{esc(q.name)}</td>
          <td>
            <SelectControl data-dpp-app={esc(p.id)} data-point={i + 1}>
              {joinContent(
                apps.map((a) => (
                  <option value={esc(a)} selected={q.applicability === a}>
                    {esc(a)}
                  </option>
                )),
                '',
              )}
            </SelectControl>
          </td>
          <td>
            <input
              data-dpp-value={esc(p.id)}
              data-point={i + 1}
              value={esc(q.value)}
              aria-label={esc(q.name) + ' value'}
            />
          </td>
          <td>
            <button className="inline" data-save-point={esc(p.id)} data-point={i + 1}>
              Save
            </button>
          </td>
        </tr>
      )),
      '',
    );
  return panel(
    p.id + ' · ' + p.lot + ' · v' + p.version + ' · ' + p.status,
    <>
      <p className="note">
        {esc(
          p.scope +
            ' · ' +
            p.evidence +
            ' · ' +
            p.composition +
            ' · ' +
            fmt(p.co2kg) +
            ' kg CO₂e/kg electricity subtotal · ' +
            fmt(p.waterKg) +
            ' L/kg',
        )}
      </p>
      <div className="table scroll-card">
        <table className="dpp-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Project mapping point</th>
              <th>Applicability</th>
              <th>Value / evidence</th>
              <th />
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </>,
  );
}
function setNotice(m = '', error = false) {
  const n = document.getElementById('notice');
  n.textContent = m;
  n.className = 'notice' + (error ? ' error' : '');
}
function lookup(value) {
  const token = req(value, 'Lot ID').replace(/^HZ:LOT:/i, '');
  traceId = state.lots.find((l) => l.id.toLowerCase() === token.toLowerCase())?.id || token;
  view = 'Traceability';
  render();
  if (!ref(state.lots, traceId)) setNotice('Lot not found.', true);
  else setNotice('Trace opened for ' + traceId + '.');
}
const handlers = {
  order: createOrder,
  line: createLine,
  receipt: receive,
  requisition: createRequisition,
  reserve,
  workorder: createWorkOrder,
  production,
  quality,
  movement,
  evidence: addEvidence,
  review: reviewEvidence,
  cost: addCost,
  shipment,
  invoice,
  passport: createPassport,
  'dpp-point': updateDppPoint,
  company: (s, x) => {
    s.company = req(x.company, 'Workspace name');
    s.facility = String(x.facility || '').trim();
    s.currency = x.currency || 'INR';
    return {
      id: 'workspace',
    };
  },
};
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  setNotice('');
  try {
    const x = Object.fromEntries(new FormData(f));
    if (f.dataset.form === 'lookup') {
      lookup(x.query);
      return;
    }
    if (f.dataset.form === 'account-filter') {
      if (!validDate(x.end) || (x.start && (!validDate(x.start) || x.start > x.end)))
        throw Error('Check the report dates.');
      accountFilter = x;
      render();
      return;
    }
    if (f.dataset.form === 'order') {
      const file = f.querySelector('[name="poFile"]').files[0];
      if (file) {
        if (file.size > 2 * 1024 * 1024) throw Error('Original PO file must be 2 MB or smaller.');
        x.attachment = {
          name: file.name,
          type: file.type,
          data: await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(Error('Could not read PO attachment.'));
            r.readAsDataURL(file);
          }),
        };
      }
    }
    const result = tx(f.dataset.form, handlers[f.dataset.form], x);
    render();
    setNotice(
      f.dataset.form === 'receipt' && result.standardHold
        ? 'Receipt saved on quality and evidence hold.'
        : 'Posted ' + (result.number || result.id || 'record') + '.',
    );
  } catch (err) {
    setNotice(err.message || String(err), true);
  }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  try {
    if (d.nav) {
      view = d.nav;
      setNotice('');
      render();
    } else if (d.trace) lookup(d.trace);
    else if (d.export) {
      const blob = new Blob([JSON.stringify(state, null, 2)], {
          type: 'application/json',
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = 'HAPZO_Decaste_ERP_Backup_' + today() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Full backup exported.');
    } else if (d.release) {
      tx('release evidence hold', releaseStandard, d.release);
      render();
      setNotice('Evidence passed; complete quality inspection separately.');
    } else if (d.passport) {
      passportId = d.passport;
      render();
    } else if (d.savePoint) {
      const key = CSS.escape(d.savePoint),
        app = document.querySelector('[data-dpp-app="' + key + '"][data-point="' + d.point + '"]').value,
        value = document.querySelector('[data-dpp-value="' + key + '"][data-point="' + d.point + '"]').value;
      tx('update DPP mapping point', handlers['dpp-point'], {
        passportId: d.savePoint,
        point: d.point,
        applicability: app,
        value,
      });
      passportId = d.savePoint;
      render();
      setNotice('DPP mapping point saved.');
    } else if (d.reset) {
      if (confirm('Replace this workspace with sample records? Export a backup first if current data is needed.')) {
        state = demo();
        localStorage.setItem(STORE, JSON.stringify(state));
        view = 'Overview';
        render();
        setNotice('Sample workspace restored.');
      }
    }
  } catch (err) {
    setNotice(err.message || String(err), true);
  }
});
document.addEventListener('change', async (e) => {
  if (e.target.id === 'importFile' && e.target.files[0]) {
    try {
      const imported = JSON.parse(await e.target.files[0].text());
      if (imported.schema !== 2 || !Array.isArray(imported.orders) || !Array.isArray(imported.lots))
        throw Error('This is not a HAPZO ERP v2 backup.');
      if (confirm('Replace current local records with this backup?')) {
        localStorage.setItem(STORE, JSON.stringify(imported));
        state = imported;
        view = 'Overview';
        render();
        setNotice('Backup imported.');
      }
    } catch (err) {
      setNotice(err.message || 'Could not import JSON.', true);
    }
    e.target.value = '';
  }
  if (e.target.id === 'qrImage' && e.target.files[0]) {
    try {
      if (!('BarcodeDetector' in window))
        throw Error('QR scanning is unsupported in this browser. Enter the lot ID manually.');
      const bitmap = await createImageBitmap(e.target.files[0]);
      try {
        const found = await new BarcodeDetector({
          formats: ['qr_code'],
        }).detect(bitmap);
        if (found.length !== 1) throw Error('Choose an image with one readable QR code.');
        lookup(found[0].rawValue);
      } finally {
        bitmap.close();
      }
    } catch (err) {
      setNotice(err.message, true);
    }
  }
});
const ACCOUNT_GROUPS = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];
const ACCOUNTS = [
  ['CASH', 'Cash in hand', 'Asset'],
  ['BANK', 'Bank account', 'Asset'],
  ['AR', 'Trade receivables', 'Asset'],
  ['STOCK', 'Inventory', 'Asset'],
  ['ITC', 'GST input credit', 'Asset'],
  ['AP', 'Trade payables', 'Liability'],
  ['GSTOUT', 'GST output payable', 'Liability'],
  ['CAPITAL', 'Capital', 'Equity'],
  ['SALES', 'Sales', 'Income'],
  ['OTHERINC', 'Other income', 'Income'],
  ['COGS', 'Cost of goods sold', 'Expense'],
  ['JOB', 'Job work expense', 'Expense'],
  ['FREIGHT', 'Freight expense', 'Expense'],
  ['GENERAL', 'General expenses', 'Expense'],
  ['FX', 'Exchange difference', 'Expense'],
].map(([code, name, group]) => ({
  id: code,
  code,
  name,
  group,
}));
const book = (s) =>
  s.accounts ?? {
    charts: ACCOUNTS,
    vouchers: [],
  };
const initBook = (s) =>
  (s.accounts ??= {
    charts: ACCOUNTS.map((a) => ({
      ...a,
    })),
    vouchers: [],
  });
const acctMoney = (cents) => money(cents / 100, 'INR');
function paise(x, label) {
  const input = String(x ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(input)) throw Error(label + ' must have up to two decimal places.');
  const [whole, fraction = ''] = input.split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(n)) throw Error(label + ' exceeds the supported amount.');
  return n;
}
function accountDate(x) {
  const date = x || today();
  if (!validDate(date)) throw Error('Enter a valid voucher date.');
  return date;
}
function newAccount(s, x) {
  const b = initBook(s),
    code = req(x.code, 'Ledger code').toUpperCase(),
    name = req(x.name, 'Ledger name');
  if (!/^[A-Z0-9_-]{1,20}$/.test(code) || !ACCOUNT_GROUPS.includes(x.group))
    throw Error('Enter a valid ledger code and group.');
  if (b.charts.some((a) => a.id === code || a.name.toLowerCase() === name.toLowerCase()))
    throw Error('Ledger code or name already exists.');
  const a = {
    id: code,
    code,
    name,
    group: x.group,
  };
  b.charts.push(a);
  return a;
}
const debit = (a, amount) => ({
  a,
  d: amount,
  c: 0,
});
const credit = (a, amount) => ({
  a,
  d: 0,
  c: amount,
});
function postVoucher(s, x, lines) {
  const b = initBook(s),
    number = req(x.number, 'Voucher number'),
    date = accountDate(x.date);
  if (b.vouchers.some((v) => v.number.toLowerCase() === number.toLowerCase()))
    throw Error('Voucher number already posted.');
  const rows = lines.filter((r) => r.d || r.c);
  if (
    rows.length < 2 ||
    rows.some(
      (r) =>
        !ref(b.charts, r.a) ||
        !Number.isSafeInteger(r.d) ||
        !Number.isSafeInteger(r.c) ||
        r.d < 0 ||
        r.c < 0 ||
        Boolean(r.d) === Boolean(r.c),
    )
  )
    throw Error('Each voucher line requires one debit or credit and a valid ledger.');
  const total = rows.reduce((n, r) => n + r.d, 0);
  if (!Number.isSafeInteger(total) || total <= 0 || total !== rows.reduce((n, r) => n + r.c, 0))
    throw Error('Debits and credits must match.');
  const v = {
    id: id(s, 'VCH'),
    number,
    date,
    type: x.type,
    party: String(x.party || '').trim(),
    note: String(x.note || '').trim(),
    source: x.source || null,
    against: x.against || null,
    reverses: x.reverses || null,
    currency: x.currency || 'INR',
    rate: x.rate || 1,
    documentAmount: x.documentAmount ?? null,
    lines: rows,
    total,
  };
  b.vouchers.push(v);
  return v;
}
function activeAt(b, v, asOf = '9999-12-31') {
  return v.date <= asOf && !b.vouchers.some((r) => r.reverses === v.id && r.date <= asOf);
}
function settlementTotal(b, v, asOf) {
  return b.vouchers
    .filter((r) => r.against === v.id && !r.reverses && activeAt(b, r, asOf))
    .reduce((n, r) => n + r.total, 0);
}
function accountingInvoice(s, x) {
  const b = initBook(s),
    isSale = x.kind === 'Sales';
  if (!isSale && x.kind !== 'Purchase') throw Error('Select sales or purchase.');
  let source, party, docDate, currency, net, tax, recoverable, docNumber;
  if (isSale) {
    const inv = ref(s.invoices, x.sourceId),
      sh = inv && ref(s.shipments, inv.shipmentId);
    if (!sh) throw Error('Select an issued dispatch invoice.');
    source = {
      type: 'Sales invoice',
      id: inv.id,
      reference: inv.number,
    };
    party = req(sh.customer, 'Buyer');
    docDate = inv.date;
    currency = inv.currency;
    net = paise(inv.net, 'Invoice value');
    tax = paise(inv.tax, 'Invoice tax');
    recoverable = 0;
    docNumber = inv.number;
  } else {
    const cost = ref(s.costs, x.sourceId),
      event = cost && s.events.find((e) => e.kind === 'Goods receipt' && e.output === cost.lot);
    if (!event) throw Error('Select a cost record linked to a goods receipt.');
    source = {
      type: 'Receipt cost',
      id: cost.id,
      reference: cost.reference,
    };
    party = req(event.party, 'Supplier');
    docDate = cost.date;
    currency = cost.currency;
    net = paise(cost.net, 'Value') + paise(cost.freight, 'Freight') + paise(cost.other, 'Other cost');
    tax = paise(cost.gst, 'GST');
    recoverable = paise(cost.credit, 'Recoverable GST');
    docNumber = cost.reference;
  }
  const date = accountDate(x.date);
  if (docDate && date < docDate) throw Error('Voucher date cannot precede the source document.');
  if (b.vouchers.some((v) => v.source?.type === source.type && v.source.id === source.id && activeAt(b, v)))
    throw Error('This source already has an active voucher.');
  if (
    b.vouchers.some(
      (v) =>
        v.type === x.kind &&
        v.source?.reference.toLowerCase() === docNumber.toLowerCase() &&
        v.party.toLowerCase() === party.toLowerCase() &&
        activeAt(b, v),
    )
  )
    throw Error('This party document already has an active voucher.');
  const sourceRate = !isSale ? ref(s.costs, x.sourceId)?.rate : undefined;
  const rate = currency === 'INR' ? 1 : num(sourceRate ?? x.rate, 'INR conversion rate', 0.000001);
  const total = Math.round((net + tax) * rate),
    gst = Math.round((isSale ? tax : recoverable) * rate);
  const lines = isSale
    ? [debit('AR', total), credit('SALES', total - gst), credit('GSTOUT', gst)]
    : [debit('STOCK', total - gst), debit('ITC', gst), credit('AP', total)];
  return postVoucher(
    s,
    {
      number: x.number || (isSale ? 'S-' : 'P-') + docNumber,
      date,
      type: x.kind,
      party,
      source,
      currency,
      rate,
      documentAmount: net + tax,
    },
    lines,
  );
}
function manualBill(s, x) {
  const b = initBook(s),
    sale = x.kind === 'Sales';
  if (!sale && x.kind !== 'Purchase') throw Error('Select sales or purchase.');
  const party = req(x.party, 'Party'),
    reference = req(x.reference, 'Document reference'),
    date = accountDate(x.date);
  const tax = paise(x.tax || '0', 'GST'),
    net = paise(x.net, 'Taxable value'),
    total = tax + net;
  const recoverable = sale ? tax : paise(x.recoverable || '0', 'Recoverable GST');
  if (recoverable > tax) throw Error('Recoverable GST cannot exceed tax charged.');
  if (
    b.vouchers.some(
      (v) =>
        v.type === x.kind &&
        v.source?.reference.toLowerCase() === reference.toLowerCase() &&
        v.party.toLowerCase() === party.toLowerCase() &&
        activeAt(b, v),
    )
  )
    throw Error('This party document already has an active voucher.');
  const ledger = ref(b.charts, x.ledger);
  if (
    !ledger ||
    (sale
      ? ledger.group !== 'Income'
      : !['Expense', 'Asset'].includes(ledger.group) || ['AR', 'BANK', 'CASH', 'ITC'].includes(ledger.id))
  )
    throw Error('Select an eligible bill ledger.');
  const lines = sale
    ? [debit('AR', total), credit(ledger.id, net), credit('GSTOUT', tax)]
    : [debit(ledger.id, total - recoverable), debit('ITC', recoverable), credit('AP', total)];
  return postVoucher(
    s,
    {
      ...x,
      date,
      type: x.kind,
      party,
      source: {
        type: 'Manual bill',
        id: null,
        reference,
      },
      documentAmount: total,
    },
    lines,
  );
}
function settleBill(s, x) {
  const b = initBook(s),
    v = ref(b.vouchers, x.voucherId),
    date = accountDate(x.date);
  if (!v || !['Sales', 'Purchase'].includes(v.type) || v.reverses || !activeAt(b, v) || date < v.date)
    throw Error('Select an active invoice and a valid settlement date.');
  const amount = paise(x.amount, 'Settlement amount');
  if (!['CASH', 'BANK'].includes(x.bank) || amount <= 0 || amount > v.total - settlementTotal(b, v))
    throw Error('Select Cash or Bank and an amount within the outstanding balance.');
  const sale = v.type === 'Sales';
  return postVoucher(
    s,
    {
      ...x,
      date,
      type: sale ? 'Receipt' : 'Payment',
      party: v.party,
      against: v.id,
    },
    sale ? [debit(x.bank, amount), credit('AR', amount)] : [debit('AP', amount), credit(x.bank, amount)],
  );
}
function journal(s, x) {
  const lines = parseLines(x.entries, 'Journal', 3).map(([code, d, c]) => {
    const a = code.toUpperCase();
    if (['AR', 'AP'].includes(a)) throw Error('Use bills and settlements for receivable and payable ledgers.');
    return {
      a,
      d: paise(d || '0', 'Debit'),
      c: paise(c || '0', 'Credit'),
    };
  });
  if (x.kind === 'Contra' && lines.some((l) => !['CASH', 'BANK'].includes(l.a)))
    throw Error('Contra vouchers only use Cash and Bank.');
  return postVoucher(
    s,
    {
      ...x,
      type: x.kind === 'Contra' ? 'Contra' : 'Journal',
    },
    lines,
  );
}
function reverseVoucher(s, x) {
  const b = initBook(s),
    v = ref(b.vouchers, x.voucherId),
    date = accountDate(x.date);
  if (!v || v.reverses || !activeAt(b, v) || date < v.date)
    throw Error('Select an active voucher and a valid reversal date.');
  const linked = b.vouchers.filter((r) => r.against === v.id && !r.reverses);
  if (
    linked.some((r) => activeAt(b, r) || r.date > date || b.vouchers.some((z) => z.reverses === r.id && z.date > date))
  )
    throw Error('Reverse linked settlements first, with a reversal date on or before this voucher reversal.');
  return postVoucher(
    s,
    {
      ...x,
      date,
      type: 'Reversal',
      party: v.party,
      reverses: v.id,
      note: req(x.note, 'Reversal reason'),
    },
    v.lines.map((r) => ({
      a: r.a,
      d: r.c,
      c: r.d,
    })),
  );
}
function accountTotals(b, start = '', end = '9999-12-31') {
  const columns = new Map(
    b.charts.map((a) => [
      a.id,
      {
        ...a,
        d: 0,
        c: 0,
      },
    ]),
  );
  for (const v of b.vouchers.filter((v) => v.date >= start && v.date <= end))
    for (const l of v.lines) {
      const a = columns.get(l.a);
      if (a) {
        a.d += l.d;
        a.c += l.c;
      }
    }
  return [...columns.values()];
}
function openBalances(b, end = '9999-12-31') {
  return b.vouchers
    .filter((v) => ['Sales', 'Purchase'].includes(v.type) && !v.reverses && activeAt(b, v, end))
    .map((v) => ({
      ...v,
      balance: v.total - settlementTotal(b, v, end),
    }))
    .filter((v) => v.balance > 0);
}
let accountFilter = {
  start: '',
  end: today(),
  ledger: '',
};
const accountingChoices = () => book(state).charts.map((a) => [a.id, a.code + ' · ' + a.name]);
const accountDay = () =>
  field(
    'Voucher date',
    'date',
    {
      required: true,
      defaultValue: today(),
    },
    'date',
  );
const accountAmount = (
  label,
  name,
  extra = {
    required: true,
  },
) =>
  field(
    label,
    name,
    {
      min: '0',
      step: '0.01',
      ...extra,
    },
    'number',
  );
const accountKind = () => select('Bill type', 'kind', ['Sales', 'Purchase']);
const voucherChoices = (predicate) =>
  book(state)
    .vouchers.filter(predicate)
    .map((v) => [v.id, v.number + ' · ' + v.type + (v.party ? ' · ' + v.party : '')]);
const activeBill = (b, v) => ['Sales', 'Purchase'].includes(v.type) && !v.reverses && activeAt(b, v);
function accountsHome() {
  const b = book(state),
    open = openBalances(b, accountFilter.end);
  const totals = (type) => open.filter((v) => v.type === type).reduce((n, v) => n + v.balance, 0);
  return (
    <>
      {heading(
        'Accounts',
        'Post ERP documents into a double-entry ledger and track the amounts customers and suppliers owe.',
      )}
      <div className="cards">
        {joinContent(
          [
            ['Receivables', acctMoney(totals('Sales'))],
            ['Payables', acctMoney(totals('Purchase'))],
            ['Vouchers', b.vouchers.length],
            ['Base currency', 'INR'],
          ].map(([label, value]) => (
            <div className="card">
              <small>{esc(label)}</small>
              <strong>{esc(value)}</strong>
            </div>
          )),
          '',
        )}
      </div>
      {panel(
        'Accounting workspace',
        <>
          <p>
            Open Vouchers to post invoices and settlements. Open Financial Reports to reconcile the trial balance with
            profit and loss and the balance sheet.
          </p>
          <div className="actions">
            {btn('Post vouchers', {
              'data-nav': 'Vouchers',
            })}
            {btn(
              'Review reports',
              {
                'data-nav': 'Financial Reports',
              },
              'secondary',
            )}
          </div>
        </>,
      )}
      {panel(
        'Chart of accounts',
        table(
          ['Code', 'Ledger', 'Group'],
          b.charts.map((a) => [esc(a.code), esc(a.name), esc(a.group)]),
        ),
      )}
      {panel(
        'Create a ledger',
        form(
          'account-new',
          <>
            {field('Ledger code', 'code')}
            {field('Ledger name', 'name')}
            {select('Account group', 'group', ACCOUNT_GROUPS)}
          </>,
          'Create ledger',
        ),
      )}
    </>
  );
}
function accountsVouchers() {
  const b = book(state);
  const sources = (type, rows) =>
    rows.map((r) => [
      r.id,
      (r.number || r.reference) +
        ' · ' +
        r.currency +
        (b.vouchers.some((v) => v.source?.type === type && v.source.id === r.id && activeAt(b, v)) ? ' · posted' : ''),
    ]);
  const posting = (kind) =>
    kind === 'Sales'
      ? sources('Sales invoice', state.invoices)
      : sources(
          'Receipt cost',
          state.costs.filter((c) => state.events.some((e) => e.kind === 'Goods receipt' && e.output === c.lot)),
        );
  function erpForm(kind) {
    return form(
      'account-erp-' + kind.toLowerCase(),
      <>
        {select(kind === 'Sales' ? 'Issued dispatch invoice' : 'Goods receipt cost', 'sourceId', posting(kind))}
        {field('Voucher number', 'number', {
          placeholder: 'Auto from source reference',
        })}
        {accountDay()}
        {field(
          'Foreign currency to INR rate',
          'rate',
          {
            min: '0',
            step: 'any',
          },
          'number',
        )}
      </>,
      'Post ' + kind.toLowerCase() + ' voucher',
      kind === 'Sales'
        ? 'Post the buyer and values from the issued invoice. Enter the approved exchange rate for a foreign invoice.'
        : 'Post the receipt cost and entered recoverable GST. Foreign receipt costs use the exchange rate saved on the cost record. Use manual purchase bills for service expenses.',
    );
  }
  return (
    <>
      {heading(
        'Vouchers',
        'Create sales, purchase, receipt, payment, journal, and contra vouchers. Posted entries can be corrected through linked reversals.',
      )}
      <div className="split">
        {panel('Post ERP sales invoice', erpForm('Sales'))}
        {panel('Post received stock cost', erpForm('Purchase'))}
      </div>
      <div className="split">
        {panel(
          'Manual sales or purchase bill',
          form(
            'account-bill',
            <>
              {accountKind()}
              {field('Customer or supplier', 'party')}
              {field('Invoice reference', 'reference')}
              {field('Voucher number', 'number')}
              {accountDay()}
              {select('Income, inventory or expense ledger', 'ledger', accountingChoices())}
              {accountAmount('Taxable value (INR)', 'net')}
              {accountAmount('GST charged (INR)', 'tax', {
                defaultValue: '0',
              })}
              {accountAmount('Recoverable GST on purchase (INR)', 'recoverable', {
                defaultValue: '0',
              })}
            </>,
            'Post bill',
          ),
        )}
        {panel(
          'Receipt or payment',
          form(
            'account-settle',
            <>
              {select(
                'Outstanding bill',
                'voucherId',
                voucherChoices((v) => activeBill(b, v) && v.total > settlementTotal(b, v)),
              )}
              {field('Voucher number', 'number')}
              {accountDay()}
              {select(
                'Cash or bank',
                'bank',
                accountingChoices().filter((x) => ['CASH', 'BANK'].includes(x[0])),
              )}
              {accountAmount('Amount settled (INR)', 'amount')}
              {field('Bank or payment reference', 'note', {})}
            </>,
            'Record settlement',
            'The selected bill determines receipt or payment. For foreign bills enter the INR amount applied to the posted carrying balance.',
          ),
        )}
      </div>
      <div className="split">
        {panel(
          'Journal or contra',
          form(
            'account-journal',
            <>
              {select('Voucher type', 'kind', ['Journal', 'Contra'])}
              {field('Voucher number', 'number')}
              {accountDay()}
              {field('Narration', 'note', {})}
              <label>
                Ledger, debit, credit
                <textarea name="entries" required placeholder={'BANK,1000,0\nCAPITAL,0,1000'} />
              </label>
            </>,
            'Post balanced voucher',
            'Use one ledger code per line. Opening cash, bank and inventory can be entered through a journal.',
          ),
        )}
        {panel(
          'Reverse a voucher',
          form(
            'account-reverse',
            <>
              {select(
                'Active voucher',
                'voucherId',
                voucherChoices((v) => !v.reverses && activeAt(b, v)),
              )}
              {field('Reversal number', 'number')}
              {accountDay()}
              {field('Reason', 'note')}
            </>,
            'Post reversal',
          ),
        )}
      </div>
      {panel(
        'Day book',
        table(
          ['Date', 'Voucher', 'Type', 'Party', 'Source / reference', 'Debit and credit total', 'Status'],
          b.vouchers
            .slice()
            .reverse()
            .map((v) => [
              esc(v.date),
              esc(v.number),
              esc(v.type),
              esc(v.party || '—'),
              esc(
                v.reverses ? 'Reverses ' + ref(b.vouchers, v.reverses)?.number : v.source?.reference || v.note || '—',
              ),
              esc(acctMoney(v.total)),
              esc(activeAt(b, v) ? 'Posted' : 'Reversed'),
            ]),
        ),
      )}
    </>
  );
}
function accountReportData(b, filter) {
  const { start, end } = filter,
    period = accountTotals(b, start, end),
    closing = accountTotals(b, '', end),
    open = openBalances(b, end);
  const signed = (rows, groups, creditNormal = false) =>
    rows.filter((a) => groups.includes(a.group)).reduce((n, a) => n + (creditNormal ? a.c - a.d : a.d - a.c), 0);
  return {
    period,
    closing,
    open,
    income: signed(period, ['Income'], true),
    expenses: signed(period, ['Expense']),
    assets: signed(closing, ['Asset']),
    liabilities: signed(closing, ['Liability'], true),
    equity: signed(closing, ['Equity'], true),
    earnings: signed(closing, ['Income', 'Expense'], true),
  };
}
const amountCell = (n) => esc(acctMoney(n));
function accountsReports() {
  const b = book(state),
    f = accountFilter,
    data = accountReportData(b, f),
    balanceSide = (n) => (n === 0 ? '—' : acctMoney(Math.abs(n)) + (n < 0 ? ' Cr' : ' Dr'));
  const ledger = ref(b.charts, f.ledger);
  const vouchers = b.vouchers
    .filter((v) => v.date <= f.end)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  const entries = [];
  if (ledger)
    for (const v of vouchers)
      for (const l of v.lines.filter((r) => r.a === ledger.id)) {
        running += l.d - l.c;
        if (v.date >= f.start)
          entries.push([
            esc(v.date),
            esc(v.number),
            esc(v.type),
            esc(v.party || v.note || '—'),
            amountCell(l.d),
            amountCell(l.c),
            esc(balanceSide(running)),
          ]);
      }
  const a = data.closing;
  const dTotal = a.reduce((n, l) => n + Math.max(0, l.d - l.c), 0),
    cTotal = a.reduce((n, l) => n + Math.max(0, l.c - l.d), 0);
  return (
    <>
      {heading(
        'Financial reports',
        'Review the INR books, outstanding invoices and ledger detail. The start date filters activity and profit and loss. Closing balances include postings up to the end date.',
      )}
      {panel(
        'Report period',
        <>
          {form(
            'account-filter',
            <>
              {field(
                'From',
                'start',
                {
                  defaultValue: esc(f.start),
                },
                'date',
              )}
              {field(
                'Through',
                'end',
                {
                  required: true,
                  defaultValue: esc(f.end),
                },
                'date',
              )}
              {select('Ledger detail', 'ledger', accountingChoices(), false, 'All balances', f.ledger)}
            </>,
            'Apply filters',
          )}
          <br />
          {btn(
            'Export voucher lines CSV',
            {
              'data-acct-export': '1',
            },
            'secondary',
          )}
        </>,
      )}
      <div className="split">
        {panel(
          'Profit and loss',
          table(
            ['Ledger', 'INR'],
            data.period
              .filter((a) => ['Income', 'Expense'].includes(a.group) && (a.d || a.c))
              .map((a) => [esc(a.name), amountCell(a.group === 'Income' ? a.c - a.d : a.d - a.c)])
              .concat([
                ['Total income', amountCell(data.income)],
                ['Total expenses', amountCell(data.expenses)],
                ['Net profit / loss', amountCell(data.income - data.expenses)],
              ]),
          ),
        )}
        {panel(
          'Balance sheet',
          table(
            ['Closing balance', 'INR'],
            [
              ['Assets', amountCell(data.assets)],
              ['Liabilities', amountCell(data.liabilities)],
              ['Equity before earnings', amountCell(data.equity)],
              ['Cumulative earnings', amountCell(data.earnings)],
              ['Liabilities and equity', amountCell(data.liabilities + data.equity + data.earnings)],
            ],
          ),
        )}
      </div>
      {panel(
        'Trial balance',
        table(
          ['Ledger', 'Dr balance', 'Cr balance'],
          a
            .filter((l) => l.d !== l.c)
            .map((l) => [esc(l.name), amountCell(Math.max(0, l.d - l.c)), amountCell(Math.max(0, l.c - l.d))])
            .concat([['Total', amountCell(dTotal), amountCell(cTotal)]]),
        ),
      )}
      {panel(
        'Outstanding receivables and payables',
        table(
          ['Reference', 'Party', 'Type', 'Date', 'Original INR', 'Outstanding INR'],
          data.open.map((v) => [
            esc(v.source?.reference || v.number),
            esc(v.party),
            esc(v.type === 'Sales' ? 'Receivable' : 'Payable'),
            esc(v.date),
            amountCell(v.total),
            amountCell(v.balance),
          ]),
        ),
      )}
      {panel(
        'Sales and purchase GST register',
        table(
          ['Date', 'Voucher / original reference', 'Party', 'Entry', 'GST output', 'GST input credit'],
          vouchers
            .filter((v) => v.date >= f.start && v.lines.some((l) => ['GSTOUT', 'ITC'].includes(l.a)))
            .map((v) => {
              const out = v.lines.filter((l) => l.a === 'GSTOUT').reduce((n, l) => n + l.c - l.d, 0),
                itc = v.lines.filter((l) => l.a === 'ITC').reduce((n, l) => n + l.d - l.c, 0);
              return [
                esc(v.date),
                esc(v.number + ' / ' + (v.source?.reference || '—')),
                esc(v.party),
                esc(v.type),
                amountCell(out),
                amountCell(itc),
              ];
            }),
        ),
      )}
      {ledger
        ? panel(
            'Ledger · ' + ledger.name,
            table(['Date', 'Voucher', 'Type', 'Party / narration', 'Debit', 'Credit', 'Balance'], entries),
          )
        : ''}
    </>
  );
}
function accountingCsv() {
  const b = book(state),
    f = accountFilter;
  const rows = [
    [
      'Date',
      'Voucher',
      'Type',
      'Party',
      'Source reference',
      'Ledger code',
      'Debit INR',
      'Credit INR',
      'Document currency',
      'INR rate',
      'Document total (source currency)',
    ],
  ];
  for (const v of b.vouchers.filter((v) => v.date >= f.start && v.date <= f.end))
    for (const l of v.lines)
      rows.push([
        v.date,
        v.number,
        v.type,
        v.party,
        v.source?.reference || '',
        l.a,
        l.d / 100,
        l.c / 100,
        v.currency,
        v.rate,
        v.documentAmount === null ? '' : v.documentAmount / 100,
      ]);
  const csv = rows
    .map((row) =>
      row
        .map(
          (x) =>
            '"' + String(typeof x === 'string' && /^[\s]*[=+\-@]/.test(x) ? "'" + x : x).replaceAll('"', '""') + '"',
        )
        .join(','),
    )
    .join('\r\n');
  const url = URL.createObjectURL(
    new Blob(['\ufeff', csv], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'HAPZO_Decaste_Vouchers.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
Object.assign(pages, {
  Accounts: accountsHome,
  Vouchers: accountsVouchers,
  'Financial Reports': accountsReports,
});
Object.assign(handlers, {
  'account-new': newAccount,
  'account-erp-sales': (s, x) =>
    accountingInvoice(s, {
      ...x,
      kind: 'Sales',
    }),
  'account-erp-purchase': (s, x) =>
    accountingInvoice(s, {
      ...x,
      kind: 'Purchase',
    }),
  'account-bill': manualBill,
  'account-settle': settleBill,
  'account-journal': journal,
  'account-reverse': reverseVoucher,
});
document.addEventListener('click', (e) => {
  if (e.target.closest('button[data-acct-export]')) accountingCsv();
});
render();
