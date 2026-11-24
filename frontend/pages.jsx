import { joinContent } from './react-ui.jsx';
import {
  CURRENCIES,
  UNITS,
  FULFILMENT,
  STAGES,
  WASH_STAGES,
  PRINT_STAGES,
  ROUTES,
  MATERIALS,
  freeStock,
  ref,
  norm,
  round,
  sum,
  today,
  ROLES,
} from '../src/model.mjs';
import {
  MASTER_LABELS,
  PARTY_TYPES,
  locationName,
  masterLabel,
  planning,
  shippedQty,
  lineProgress,
  schemesOf,
  orderRoute,
  orderWorkflow,
} from '../src/commerce.mjs';
import { schemeNames } from '../src/standards.mjs';
import { fabricSpecAt } from '../src/fabric.mjs';
import { materialRequirements } from '../src/garment.mjs';
import { productionProcess } from '../src/po-process.mjs';
import { fabricInspectionCell, fabricInspectionFields, fabricSpecCard, fabricSpecFields } from './fabric-ui.jsx';
import {
  buyerPoFile,
  buyerPoIdentityFields,
  garmentInspectionCell,
  garmentInspectionFields,
  garmentLink,
  poImportLink,
} from './garment-ui.jsx';
import { garmentBatchLink } from './garment-production-ui.jsx';
import {
  h,
  fmt,
  money,
  valueOf,
  showQty,
  badge,
  txStatus,
  heading,
  panel,
  split,
  cards,
  facts,
  table,
  details,
  note,
  empty,
  actions,
  button,
  linkButton,
  navLink,
  lotLink,
  washLink,
  finishBatchLink,
  printBatchLink,
  embroideryBatchLink,
  docs,
  field,
  text,
  check,
  day,
  numberField,
  select,
  choose,
  file,
  hidden,
  form,
  editor,
  can,
  titles,
  lineLabel,
  passportUrl,
} from './ui.jsx';
const locationChoice = (s, label = 'Location', options = {}) =>
  choose(label, 'locationId', s.locations, titles.location, options);
const items = (s, label = 'Material item', options = {}) => choose(label, 'itemId', s.items, titles.item, options);
const lots = (s, label = 'Stock lot', filter = (l) => l.qty > 0, options = {}) =>
  choose(label, 'lotId', s.lots.filter(filter), titles.lot, options);
const schemes = (s, label = 'Standard', name = 'scheme') =>
  select(label, name, schemeNames(s), {
    initial: 'Conventional',
  });
const parties = (s, kind, name = kind.toLowerCase() + 'Id', options = {}) =>
  choose(
    kind,
    name,
    s.parties.filter((p) => p.type === kind),
    titles.party,
    options,
  );
const approvedLines = (s, label = 'Approved PO line', options = {}) =>
  choose(
    label,
    'lineId',
    s.lines.filter((l) => l.status === 'Approved'),
    (l) => lineLabel(s, l),
    options,
  );
const routeList = (s) => [
  ...Object.keys(ROUTES),
  ...s.routes.map((r) => [r.id, r.code + ' · ' + r.name + ' · ' + r.version]),
];
const orderList = (s) => choose('Buyer PO', 'orderId', s.orders, titles.order);
const shipmentList = (s, opts = {}) =>
  choose('Shipment', 'shipmentId', s.shipments, (sh) => sh.number + ' · ' + sh.customer, opts);
const requiredNumber = (label, name, value = '') =>
  numberField(label, name, {
    value,
  });
const optionalNumber = (label, name, value = '', min = 0) =>
  numberField(label, name, {
    required: false,
    value,
    min,
  });
const optional = (label, name, value = '') =>
  field(label, name, {
    required: false,
    value,
  });
const jobLabel = (job) =>
  job.embroideryBatchId
    ? embroideryBatchLink(job.embroideryBatchId, job.number)
    : job.printBatchId
      ? printBatchLink(job.printBatchId, job.number)
      : job.washBatchId
        ? washLink(job.washBatchId, job.number)
        : h(job.number);
const jobLots = (job) => joinContent((job.inputs?.map((input) => input.id) ?? [job.lotId]).map(lotLink), <br />);
const jobBalance = (job, qty, kg) =>
  showQty(qty, job.unit) + (job.washBatchId && job.unit !== 'kg' ? ' · ' + showQty(kg, 'kg') : '');
const eventLots = (e) => joinContent((e.lotIds ?? e.outputs ?? [e.output]).map(lotLink), <br />) || '—';
function orderLineTable(s, list = s.lines, portal = false) {
  const header = ['PO / line', 'Style, colour and size', 'Ordered', 'Delivery'];
  if (!portal) header.push('Planned', 'Produced', 'Released stock', 'Packed stock', 'Status');
  header.push('Shipped / open');
  return table(
    header,
    list.map((l) => {
      const p = portal
        ? {
            shipped: shippedQty(s, l.id),
            open: l.qty - shippedQty(s, l.id),
          }
        : lineProgress(s, l);
      const order = ref(s.orders, l.orderId);
      const entries = [
        <>
          {linkButton((order?.po || '') + ' / ' + l.lineNo, 'line', l.id)}
          <br />
          <small>{h(l.id)}</small>
        </>,
        h([l.articleNo, l.style, l.color, l.size].filter(Boolean).join(' / ')),
        showQty(l.qty, l.unit),
        h(l.delivery),
      ];
      if (!portal)
        entries.push(
          showQty(p.planned, l.unit),
          showQty(p.produced, l.unit),
          showQty(p.released, l.unit),
          showQty(p.packed, l.unit),
          txStatus(l.status),
        );
      entries.push(
        <>
          {`${showQty(p.shipped, l.unit)} / ${showQty(p.open, l.unit)}`}
          <progress value={h(p.shipped)} max={h(l.qty)} aria-label="Dispatch progress" />
        </>,
      );
      return entries;
    }),
  );
}
function Overview({ app }) {
  const s = app.data;
  const sample = ref(s.lots, 'CTN-26018-01');
  const open = s.lines.filter((l) => l.status === 'Approved' && l.qty > shippedQty(s, l.id));
  const buttons = sample
    ? actions(
        button('Trace sample carton', {
          'data-lot': 'CTN-26018-01',
        }),
        button('Trace fibre forward', {
          'data-lot': 'FIB-001',
        }),
      )
    : actions(
        navLink('Set up masters', 'masters'),
        navLink('Create buyer PO', 'orders'),
        navLink('Receive stock', 'stock'),
      );
  return (
    <>
      {heading('Dashboard', 'Live overview of buyer orders, production, inventory, and dispatch.', buttons)}
      {cards([
        ['Open approved PO lines', open.length],
        [
          'Lots on hold / inspection',
          s.lots.filter((l) => l.qty > 0 && (l.standardHold || l.qualityStatus !== 'Released')).length,
        ],
        ['Work orders on floor', s.workOrders.filter((w) => ['Released', 'In progress'].includes(w.status)).length],
        ['Dispatches', s.shipments.length],
      ])}
      {panel('Buyer order progress', orderLineTable(s, s.lines.slice(-12).reverse()))}
      {panel(
        'Recent transactions',
        table(
          ['Date', 'Transaction', 'Lot', 'Reference', 'Posted by'],
          s.events
            .slice(-10)
            .reverse()
            .map((e) => [h(e.date), h(e.stage || e.kind), lotLink(e.output), valueOf(e.reference), h(e.actor)]),
        ),
      )}
    </>
  );
}
export { Overview };
function masterDisplayName(kind, row) {
  if (kind === 'locations') return locationName(row);
  return kind === 'routes' ? row.name + ' · ' + row.version : row.name;
}
export function masterDeletePrompt(app, kind, id) {
  const row = Object.hasOwn(MASTER_LABELS, kind) && ref(app.data[kind], id);
  if (!row) throw new Error('Choose a company master record.');
  const action = 'Delete ' + masterLabel(kind, row);
  return (
    <>
      <h2>{h(action)}?</h2>
      {note(row.code + ' · ' + masterDisplayName(kind, row))}
      {button(
        action,
        {
          'data-confirm-delete-master': h(kind),
          'data-master-id': h(row.id),
        },
        'danger',
      )}
    </>
  );
}
function Masters({ app }) {
  const s = app.data;
  const canDelete = can(app, 'master-delete');
  const masterTable = (kind, labels, cells, builtIns = []) =>
    table(canDelete ? [...labels, 'Actions'] : labels, [
      ...builtIns.map((row) => (canDelete ? [...row, null] : row)),
      ...s[kind].map((row) => {
        const values = cells(row);
        if (canDelete)
          values.push(
            button('Delete', {
              'data-delete-master': h(kind),
              'data-master-id': h(row.id),
              'aria-label': 'Delete ' + h(masterLabel(kind, row) + ' ' + masterDisplayName(kind, row)),
            }),
          );
        return values;
      }),
    ]);
  return (
    <>
      {heading(
        'Company masters',
        'Set up the buyers, suppliers, stock locations, materials and equipment used on production and commercial records.',
      )}
      {split(
        editor(
          app,
          'party-master',
          'Create or update party',
          <>
            {field('Party code', 'code')}
            {select('Party type', 'type', PARTY_TYPES)}
            {field('Legal name', 'name')}
            {optional('Country', 'country')}
            {optional('GST registration', 'gstin')}
            {select('Default currency', 'currency', CURRENCIES, {
              initial: 'INR',
            })}
            {optional('Contact', 'contact')}
            {optional('Email', 'email')}
            {optional('Payment terms', 'terms')}
            {text('Billing / legal address', 'address')}
            {text('Default ship-to address', 'shipTo')}
          </>,
          'Save party',
          'Use the same code to update the master. Buyer POs retain the original commercial details.',
          s.parties.length === 0,
        ),
        editor(
          app,
          'location-master',
          'Create or update factory location',
          <>
            {field('Location code', 'code')}
            {field('Factory / site', 'site')}
            {field('Warehouse or department', 'warehouse')}
            {optional('Zone / rack / bin', 'bin')}
            {optional('GST registration', 'gstin')}
            {text('Site address', 'address')}
          </>,
          'Save location',
          '',
          s.locations.length === 0,
        ),
        editor(
          app,
          'item-master',
          'Create or update material',
          <>
            {field('Item code', 'code')}
            {field('Material name', 'name')}
            {select('Physical type', 'type', MATERIALS)}
            {select('Stock unit', 'unit', UNITS)}
            {optional('HSN / HS code', 'hs')}
            {optional('Composition', 'composition')}
          </>,
          'Save material',
          '',
          s.items.length === 0,
        ),
        editor(
          app,
          'machine-master',
          'Create or update machine',
          <>
            {field('Machine code', 'code')}
            {field('Machine name', 'name')}
            {locationChoice(s)}
            {optional('Meter or device ID', 'device')}
            {select('State', 'status', ['In service', 'Down', 'Retired'], {
              initial: 'In service',
            })}
            {text('Description', 'description')}
          </>,
          'Save machine',
        ),
        editor(
          app,
          'route-master',
          'Create a route revision',
          <>
            {field('Route code', 'code')}
            {field('Route name', 'name')}
            {field('Revision', 'version')}
            {text(
              'Operations in order, one per line',
              'stages',
              'Fabric inspection\nCutting\nStitching\nGarment QC\nGarment finishing\nFinal inspection\nPacking',
              true,
            )}
          </>,
          'Save route',
          'Use operation names from the route catalogue. Released PO lines keep the selected revision.',
        ),
      )}
      {panel(
        'Parties',
        masterTable('parties', ['Code', 'Party', 'Type', 'Currency', 'Payment terms', 'Contact'], (p) => [
          h(p.code),
          h(p.name),
          h(p.type),
          h(p.currency),
          valueOf(p.terms),
          valueOf(p.contact || p.email),
        ]),
      )}
      {panel(
        'Materials',
        masterTable('items', ['Code', 'Material', 'Physical type', 'Unit', 'Composition'], (i) => [
          h(i.code),
          h(i.name),
          h(i.type),
          h(i.unit),
          valueOf(i.composition),
        ]),
      )}
      {split(
        panel(
          'Factory locations',
          masterTable('locations', ['Code', 'Site', 'Warehouse', 'Bin'], (l) => [
            h(l.code),
            h(l.site),
            h(l.warehouse),
            valueOf(l.bin),
          ]),
        ),
        panel(
          'Machines',
          masterTable('machines', ['Code', 'Machine', 'Meter', 'State'], (m) => [
            h(m.code),
            h(m.name),
            valueOf(m.device),
            txStatus(m.status),
          ]),
        ),
      )}
      {details(
        'Routing catalogue',
        masterTable(
          'routes',
          ['Route', 'Operations'],
          (r) => [h(masterDisplayName('routes', r)), h(r.stages.join(' → '))],
          Object.entries(ROUTES).map(([name, stages]) => [h(name), h(stages.join(' → ') || 'Direct fulfilment')]),
        ),
      )}
    </>
  );
}
export { Masters };
function lineFields(s, l = null) {
  const v = (label, name, required = true) =>
    field(label, name, {
      value: l?.[name] ?? '',
      required,
    });
  const num = (label, name, value = '') => optionalNumber(label, name, l?.plannedCosts?.[name] ?? l?.[name] ?? value);
  const routeId = l && (Object.hasOwn(ROUTES, l.route) ? l.route : s.routes.find((r) => r.name === l.route)?.id);
  return (
    <>
      {v('Style', 'style')}
      {v('Colour', 'color')}
      {v('Size / variant', 'size')}
      {v('SKU', 'sku', false)}
      {v('Article number', 'articleNo', false)}
      {v('Article name', 'articleName', false)}
      {v('Client order number for this variant', 'clientOrderNo', false)}
      {v('Colour code', 'colorCode', false)}
      {v('Buyer lot reference', 'lot', false)}
      {requiredNumber('Ordered quantity', 'qty', l?.qty)}
      {select('Order unit', 'unit', UNITS, {
        initial: l?.unit || 'pcs',
      })}
      {num('Unit selling price', 'price', '0')}
      {field('Main delivery date', 'delivery', {
        type: 'date',
        value: l?.delivery || today(),
      })}
      {select('Production route', 'route', routeList(s), {
        initial: routeId || '',
      })}
      {select('Deliverable', 'product', FULFILMENT, {
        initial: l?.product || 'Packed carton',
      })}
      {select('Primary claim', 'scheme', schemeNames(s), {
        initial: l?.scheme || 'Conventional',
      })}
      {optional('Additional schemes, comma separated', 'additionalSchemes', l?.additionalSchemes?.join(', '))}
      {v('Specification revision', 'specRev')}
      {v('BOM revision', 'bomRev')}
      {v('Composition', 'composition', false)}
      {fabricSpecFields(l)}
      {text(
        'Approved specification',
        'approvedSpec',
        'Construction, measurements, tolerances, finishes and packing',
        true,
        l?.approvedSpec,
      )}
      {text(
        'Delivery schedule, date and quantity per row',
        'schedule',
        '2026-12-15,230',
        false,
        l?.schedule?.map((x) => [x.date, x.qty].join(',')).join('\n'),
      )}
      {text(
        'BOM, item code and quantity per ordered unit',
        'bom',
        'FIBRE-001,0.20\nTRIM-01,6',
        false,
        l?.bom?.map((x) => [x.code, x.per].join(',')).join('\n'),
      )}
      {v('Costing revision', 'costRev', false)}
      {num('Planned material cost', 'materials')}
      {num('Planned labour cost', 'labour')}
      {num('Planned processing cost', 'processing')}
      {num('Planned overhead', 'overhead')}
    </>
  );
}
export function orderLineDetail(app, l) {
  const s = app.data;
  const o = ref(s.orders, l.orderId);
  const portal = app.user.role === 'Buyer';
  const p = portal
    ? {
        shipped: shippedQty(s, l.id),
        open: l.qty - shippedQty(s, l.id),
      }
    : lineProgress(s, l);
  const buyerRefs = [
    ['Article number', l.articleNo],
    ['Article name', l.articleName],
    ['Client order number', l.clientOrderNo || o.clientOrderNo],
    ['Colour code', l.colorCode],
    ['Buyer lot reference', l.lot],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => [label, h(value)]);
  return (
    <>
      {heading(
        o.po + ' / ' + l.lineNo,
        l.style + ' · ' + l.color + ' · ' + l.size,
        portal
          ? ''
          : actions(flowLink(app, o, l.id), o.kind === 'Goods' && l.unit === 'pcs' ? garmentLink(app, l.id) : ''),
      )}
      {facts([
        ['PO line', h(l.id)],
        ['Buyer', h(o.buyer)],
        ['Ordered', showQty(l.qty, l.unit)],
        ['Shipped / remaining', showQty(p.shipped, l.unit) + ' / ' + showQty(p.open, l.unit)],
        ['Price', h(money(l.price, o.currency))],
        ['PO attachment', docs(o.document)],
        ...buyerRefs,
      ])}
      {panel(
        'Delivery schedule',
        table(
          ['Due', 'Quantity'],
          l.schedule.map((r) => [h(r.date), showQty(r.qty, l.unit)]),
        ),
      )}
      {portal ? (
        ''
      ) : (
        <>
          {panel(
            'Approved product record',
            <>
              {facts([
                ['Specification', h(l.specRev + ' · ' + l.approvedSpec)],
                ['Route', h(l.route ? l.route + ' · ' + l.routeVersion : 'Awaiting route')],
                [
                  'Planned cost',
                  h(
                    money(
                      Object.values(l.plannedCosts).reduce((n, v) => n + v, 0),
                      o.currency,
                    ),
                  ),
                ],
                ['Standard', h(schemesOf(l).join(', ') || 'Conventional')],
              ])}
              {table(
                ['Item', 'Usage per ordered unit'],
                materialRequirements(l).map((b) => [h(b.code + ' · ' + b.label), showQty(b.per, b.unit)]),
              )}
            </>,
          )}
          {l.fabricSpec || l.gsm != null ? panel('Fabric specification', fabricSpecCard(l.fabricSpec, l.gsm)) : ''}
          {panel(
            'Approval history',
            <>
              {table(
                ['Revision', 'Specification', 'BOM', 'Costing', 'Approved by', 'Reason'],
                l.revisions.map((r) => [
                  h(r.revision),
                  h(r.specRev),
                  h(r.bomRev),
                  h(r.costRev),
                  h(r.actor),
                  valueOf(r.reason),
                ]),
              )}
              {joinContent(
                l.revisions.map((r) =>
                  details(
                    'Revision ' + r.revision,
                    <>
                      {h(r.approvedSpec)}
                      {fabricSpecCard(r.fabricSpec, r.gsm)}
                      {r.garmentSpec ? actions(garmentLink(app, l.id, r.revision, 'Open revision tech pack')) : ''}
                      {table(
                        ['Item', 'Usage'],
                        materialRequirements(r).map((b) => [h(b.code), showQty(b.per, b.unit)]),
                      )}
                    </>,
                  ),
                ),
                '',
              )}
            </>,
          )}
        </>
      )}
    </>
  );
}
function Orders({ app }) {
  const s = app.data;
  const revision = ref(s.lines, app.local.revise);
  return (
    <>
      {heading(
        'Buyer orders',
        'Record the purchase order and approve each style, colour and size line before reserving materials or releasing work.',
        poImportLink(app),
      )}
      {panel(
        'Buyer PO register',
        table(
          ['PO', 'Buyer', 'Type', 'Date', 'Original PO', 'Buyer revisions', 'Workflow'],
          s.orders
            .slice()
            .reverse()
            .map((o) => [
              <>
                {h(o.po)}
                {o.clientOrderNo ? (
                  <>
                    <br />
                    <small>
                      {'Client order '}
                      {h(o.clientOrderNo)}
                    </small>
                  </>
                ) : (
                  ''
                )}
              </>,
              <>
                {h(o.buyer || 'Unassigned')}
                {!o.buyerId && can(app, 'link-order-buyer') ? details('Link a saved buyer',
                  s.parties.some(p => p.type === 'Buyer')
                    ? form('link-order-buyer', <>
                        {hidden('orderId', o.id)}
                        {choose('Saved buyer', 'buyerId', s.parties.filter(p => p.type === 'Buyer'), titles.party)}
                      </>, 'Link buyer')
                    : <a href="#masters">Add a buyer in Company masters</a>) : ''}
              </>,
              h(o.kind),
              h(o.date),
              docs(o.document),
              joinContent(
                o.revisions.map((r) => (
                  <>
                    {h(r.revision)}
                    {' · '}
                    {docs(r.document)}
                  </>
                )),
                <br />,
              ) || '—',
              flowLink(app, o),
            ]),
        ),
      )}
      {panel(
        'PO lines and fulfilment',
        <>
          {orderLineTable(s)}
          {can(app, 'revise-line') && s.lines.some((l) => l.status === 'Approved') ? (
            <p className="sub muted">
              Open a line to inspect its approval history. Use Revise PO line to pin new specifications or costing.
            </p>
          ) : (
            ''
          )}
        </>,
      )}
      {split(
        editor(
          app,
          'buyer-order',
          'Create buyer PO',
          <>
            {buyerPoFile(app, 'Original buyer PO', {
              mapBuyer: true,
            })}
            {field('Buyer PO number', 'po')}
            {optional('Client order number', 'clientOrderNo')}
            {buyerPoIdentityFields(app)}
            {select('Order type', 'kind', ['Goods', 'Service'], {
              initial: 'Goods',
            })}
            {select('Currency override', 'currency', CURRENCIES, {
              required: false,
              blank: 'Buyer default',
            })}
            {day('PO date')}
            {optional('Payment terms override', 'terms')}
            {text('Ship-to address override', 'shipTo')}
          </>,
          'Save PO',
          '',
          !s.orders.length,
        ),
        editor(
          app,
          'po-line',
          'Add PO line',
          <>
            {orderList(s)}
            {optional('Buyer line number', 'lineNo')}
            {lineFields(s)}
          </>,
          'Save draft',
          '',
          s.orders.length > 0 && !s.lines.length,
        ),
        editor(
          app,
          'approve-line',
          'Approve PO line',
          <>
            {choose(
              'Draft PO line',
              'lineId',
              s.lines.filter((l) => l.status === 'Draft'),
              (l) => lineLabel(s, l),
              { hook: 'approve-draft-line' },
            )}
            {select('Production route', 'route', routeList(s), { required: false, hidden: true })}
            {text('Approval note', 'notes')}
          </>,
          'Approve line',
          '',
          s.lines.some((l) => l.status === 'Draft'),
        ),
        editor(
          app,
          'po-revision',
          'Attach buyer PO revision',
          <>
            {orderList(s)}
            {field('Buyer revision number', 'revision')}
            {day('Revision date')}
            {text('Change note', 'notes', 'What the buyer changed or confirmed', true)}
            {file('Revised buyer PO', 'buyer-po')}
          </>,
          'Record revision',
        ),
      )}
      {can(app, 'revise-line')
        ? details(
            'Revise approved PO line',
            <>
              {approvedLines(s, 'Load existing PO line', {
                hook: 'revision',
                required: false,
                initial: revision?.id || '',
              })}
              {revision
                ? form(
                    'revise-line',
                    <>
                      {hidden('lineId', revision.id)}
                      {lineFields(s, revision)}
                      {text('Reason for new approval', 'notes', '', true)}
                    </>,
                    'Release approved revision',
                  )
                : ''}
            </>,
            Boolean(revision),
          )
        : ''}
    </>
  );
}
export { Orders };
export function orderFlowHash(companyId, orderId, lineId = '', phase = '') {
  const args = new URLSearchParams();
  if (companyId && orderId) {
    args.set('company', companyId);
    args.set('order', orderId);
  }
  if (lineId) args.set('line', lineId);
  if (phase) args.set('phase', phase);
  const query = args.toString();
  return '#po-flow' + (query ? '?' + query : '');
}
function flowLink(app, order, lineId = '', label = 'Open flowchart') {
  const path = orderFlowHash(app.user.companyId, order.id, lineId);
  return (
    <a className="button secondary" data-order-flow="" href={h(path)} aria-label={h(label + ' for PO ' + order.po)}>
      {h(label)}
    </a>
  );
}
const countLabel = (n, single, plural = single + 's') => fmt(n) + ' ' + (n === 1 ? single : plural);
function byUnit(rows, getQty = (row) => row.qty) {
  const units = new Map();
  for (const row of rows) units.set(row.unit, round((units.get(row.unit) ?? 0) + getQty(row)));
  return [...units].map(([unit, qty]) => fmt(qty) + ' ' + unit).join(' · ') || '—';
}
const recorded = (text = 'Recorded') => ({
  tone: 'done',
  text,
});
const active = (text = 'In progress') => ({
  tone: 'active',
  text,
});
const blocked = (text = 'Needs attention') => ({
  tone: 'hold',
  text,
});
const pending = (text = 'Pending') => ({
  tone: 'pending',
  text,
});
const optionalStep = (text = 'If needed') => ({
  tone: 'optional',
  text,
});
const statusPill = (status) => <span className={'po-flow-status ' + status.tone}>{h(status.text)}</span>;
const flowStep = (title, status, description, body, open = false) => (
  <li className="po-flow-step">
    <details className={'po-flow-node ' + status.tone} open={open}>
      <summary>
        <span className="po-flow-step-head">
          <strong>{h(title)}</strong>
          {statusPill(status)}
        </span>
        {description ? <small>{h(description)}</small> : ''}
      </summary>
      <div className="po-flow-step-body">{body}</div>
    </details>
  </li>
);
const stepList = (...nodes) => <ol className="po-flow-steps">{joinContent(nodes, '')}</ol>;
function flowCommercial(app, order, x) {
  const approved = x.lines.filter((l) => l.status === 'Approved').length;
  const orderRefs = [
    ['Client order number', order.clientOrderNo],
    ['Client', order.client],
    ['Division', order.division],
    ['Buyer ship-by date', order.shipDate],
    ['Printed quantity', order.totalPieces == null ? '' : order.totalPieces + ' pcs'],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => [label, h(value)]);
  return stepList(
    flowStep(
      'Buyer PO and revisions',
      recorded('PO recorded'),
      order.buyer + ' · ' + order.date,
      <>
        {facts([
          ['Order type', h(order.kind)],
          ['Currency', h(order.currency)],
          ['Payment terms', valueOf(order.terms)],
          ['Original buyer PO', docs(order.document)],
          ...orderRefs,
        ])}
        {order.poDetails?.length
          ? details(
              'Other details from the PO',
              table(
                ['Field', 'Value', 'Source'],
                order.poDetails.map((row) => [h(row.label), h(row.value), h(row.source)]),
              ),
            )
          : ''}
        {table(
          ['Buyer revision', 'Date', 'Change note', 'Attachment'],
          order.revisions.map((r) => [h(r.revision), h(r.date), h(r.notes), docs(r.document)]),
          'No buyer revisions recorded.',
        )}
      </>,
      true,
    ),
    flowStep(
      'Approve PO lines and product specifications',
      x.lines.length && approved === x.lines.length ? recorded('Approved') : pending('Awaiting approval'),
      fmt(approved) + ' of ' + fmt(x.lines.length) + ' lines approved',
      <>
        {table(
          ['Line', 'Variant', 'Committed quantity', 'Deliveries', 'Approval', 'Pinned revisions'],
          x.lines.map((l) => [
            linkButton(l.lineNo, 'line', l.id),
            h([l.articleNo, l.style, l.color, l.size].filter(Boolean).join(' / ')),
            showQty(l.qty, l.unit),
            joinContent(
              l.schedule.map((slot) => h(slot.date) + ' · ' + showQty(slot.qty, l.unit)),
              <br />,
            ),
            txStatus(l.status),
            l.revision ? h(['Spec ' + l.specRev, 'BOM ' + l.bomRev, 'Cost ' + l.costRev].join(' · ')) : '—',
          ]),
          'Add lines to this buyer PO to begin planning.',
        )}
        {joinContent(
          x.lines
            .filter((l) => l.fabricSpec || l.gsm != null)
            .map((l) =>
              details(
                'Fabric specification · line ' + l.lineNo,
                fabricSpecCard(l.fabricSpec, l.gsm),
                x.lines.length === 1,
              ),
            ),
          '',
        )}
        {actions(
          navLink('Buyer orders', 'orders'),
          ...x.lines
            .filter((l) => order.kind === 'Goods' && l.unit === 'pcs')
            .map((l) => garmentLink(app, l.id, '', 'Tech pack · line ' + l.lineNo)),
        )}
      </>,
      true,
    ),
  );
}
function flowMaterials(x) {
  const bom = x.lines.flatMap((line) =>
    materialRequirements(line).map((b) => ({
      ...b,
      line,
    })),
  );
  const buying = x.purchases.flatMap((po) =>
    po.lines.map((line) => ({
      ...line,
      po,
    })),
  );
  const outstanding =
    buying.some((row) => row.received < row.qty) || x.requisitions.some((row) => row.ordered < row.qty);
  const incoming = new Set(x.receipts.map((posting) => posting.output));
  const pendingInspection = x.lots.filter(
    (lot) => incoming.has(lot.id) && lot.qty > 0 && lot.qualityStatus === 'Pending inspection',
  );
  const incomingHolds = x.qualityHolds.filter((lot) => incoming.has(lot.id));
  const receiptClaimHolds = x.claimHolds.filter((row) => incoming.has(row.lot.id));
  const inspected = x.inspections.filter((row) => incoming.has(row.output));
  const sourcing = (
    <div className="po-flow-sourcing">
      {stepList(
        flowStep(
          'Reserve existing stock',
          x.reserved.length ? active('Reserved') : x.reservations.length ? recorded() : optionalStep(),
          countLabel(x.reserved.length, 'open reservation'),
          <>
            {table(
              ['Lot', 'PO line', 'Currently reserved'],
              x.reserved.map((r) => [lotLink(r.lot.id), h(r.lineId), showQty(r.qty, r.unit)]),
              'No open stock reservations.',
            )}
            {table(
              ['Reservation posting', 'Lot', 'Quantity', 'Date'],
              x.reservations.map((r) => [h(r.kind), lotLink(r.output), showQty(r.qty, r.unit), h(r.date)]),
              'No reservation history.',
            )}
          </>,
        ),
      )}
      {stepList(
        flowStep(
          'Purchase requisitions and supplier POs',
          outstanding ? active('Open purchase') : buying.length || x.requisitions.length ? recorded() : optionalStep(),
          countLabel(x.requisitions.length, 'requisition') + ' · ' + countLabel(x.purchases.length, 'supplier PO'),
          <>
            {table(
              ['Requisition', 'Material', 'Requested', 'Ordered', 'Due'],
              x.requisitions.map((r) => [
                h(r.id),
                h(r.label),
                showQty(r.qty, r.unit),
                showQty(r.ordered, r.unit),
                h(r.required),
              ]),
              'No purchase requisitions linked.',
            )}
            {x.quotes.length
              ? table(
                  ['Quotation', 'Supplier', 'Requisition', 'Quantity', 'Valid through'],
                  x.quotes.map((q) => [
                    h(q.number),
                    h(q.party),
                    h(q.requisitionId),
                    showQty(q.qty),
                    valueOf(q.validUntil),
                  ]),
                )
              : ''}
            {table(
              ['Supplier PO', 'Supplier', 'Item', 'Ordered', 'Received'],
              buying.map((row) => [
                h(row.po.number),
                h(row.po.supplier),
                h(row.label),
                showQty(row.qty, row.unit),
                showQty(row.received, row.unit),
              ]),
              'No supplier PO lines linked.',
            )}
          </>,
        ),
      )}
    </div>
  );
  return (
    <>
      {stepList(
        flowStep(
          'BOM and material requirements',
          bom.length ? recorded('BOM linked') : pending('No BOM items'),
          countLabel(bom.length, 'BOM item'),
          <>
            {table(
              ['PO line', 'Material', 'Usage per ordered unit', 'Planned requirement'],
              bom.map((b) => [
                h(b.line.lineNo),
                h(b.code + ' · ' + b.label),
                showQty(b.per, b.unit),
                showQty(round(b.per * b.line.qty), b.unit),
              ]),
              'No BOM items on the selected lines.',
            )}
            {navLink('Planning & purchase', 'purchase')}
          </>,
          true,
        ),
      )}
      <div className="po-flow-fork">
        <span>Source materials through stock, purchasing, or direct inward</span>
      </div>
      {sourcing}
      {stepList(
        flowStep(
          'Material inward and goods receipts',
          x.receipts.length ? recorded() : pending('No linked receipt'),
          countLabel(x.receipts.length, 'goods receipt'),
          <>
            {table(
              ['GRN', 'Lot', 'Quantity', 'From', 'Date'],
              x.receipts.map((r) => [
                h(r.reference),
                lotLink(r.output),
                showQty(r.qty, r.unit),
                valueOf(r.from),
                h(r.date),
              ]),
              'No goods receipts linked to the selected lines.',
            )}
            {navLink('Inventory', 'stock')}
          </>,
          Boolean(x.receipts.length),
        ),
        flowStep(
          'Incoming quality and Standard Lock',
          receiptClaimHolds.length || incomingHolds.length
            ? blocked('On hold')
            : pendingInspection.length
              ? active('Awaiting inspection')
              : inspected.length
                ? recorded('Inspections recorded')
                : pending(),
          countLabel(inspected.length, 'incoming inspection'),
          <>
            {flowInspections(inspected)}
            {table(
              ['Lot', 'Current decision', 'Evidence issue'],
              [...incoming].flatMap((id) => {
                const lot = x.lotById.get(id);
                return lot
                  ? [
                      [
                        lotLink(id),
                        txStatus(lot.qualityStatus),
                        valueOf(receiptClaimHolds.find((row) => row.lot.id === id)?.reason),
                      ],
                    ]
                  : [];
              }),
            )}
            {actions(navLink('Quality & lab', 'quality'), navLink('Standards & evidence', 'standards'))}
          </>,
        ),
      )}
    </>
  );
}
export function inspectionChecks(event) {
  return (
    joinContent(
      [event.fabric ? fabricInspectionCell(event) : '', garmentInspectionCell(event)].filter(Boolean),
      <br />,
    ) || '—'
  );
}
function flowInspections(rows) {
  return table(
    ['Lot', 'Decision', 'Report', 'Date', 'Fabric check'],
    rows.map((r) => [lotLink(r.output), txStatus(r.decision), valueOf(r.reference), h(r.date), inspectionChecks(r)]),
    'No inspections linked.',
  );
}
function flowRunRows(rows, lineId) {
  return table(
    ['Run', 'Inputs', 'Output lot', 'Run output', 'Allocated to line', 'Waste / rejects', 'Machine / meter', 'Date'],
    rows.map((run) => {
      const allocated = run.allocations?.find((row) => row.lineId === lineId);
      const loss = run.reconciliation;
      const reference =
        run.process === 'Washing'
          ? washLink(run.batchId, run.reference)
          : run.process === 'Fabric finishing' && run.batchId
            ? finishBatchLink(run.batchId, run.reference)
            : run.process === 'Printing' && run.batchId
              ? printBatchLink(run.batchId, run.reference)
              : run.process === 'Embroidery' && run.batchId
                ? embroideryBatchLink(run.batchId, run.reference)
                : ['Cutting', 'Stitching', 'Garment finishing'].includes(run.process) && run.batchId
                  ? garmentBatchLink(
                      {
                        process: run.process,
                        id: run.batchId,
                      },
                      run.reference,
                    )
                  : h(run.reference);
      return [
        reference,
        joinContent(
          (run.inputs ?? []).map((i) => (
            <>
              {lotLink(i.id)}
              {' · '}
              {showQty(i.qty, i.unit)}
            </>
          )),
          <br />,
        ),
        eventLots(run),
        showQty(run.qty, run.unit),
        allocated ? showQty(allocated.qty, run.unit) : '—',
        loss ? showQty(loss.waste, loss.unit) + ' / ' + showQty(loss.rejects, loss.unit) : '—',
        valueOf([run.machineName, run.readingId].filter(Boolean).join(' · ')),
        h(run.date),
      ];
    }),
    'No production runs posted.',
  );
}
function flowOperation(stage, x, line, step = {}) {
  const work = x.workOrders.filter((w) => w.stage === stage && !w.rework);
  const runs = x.runs.filter((r) => r.stage === stage && r.type !== 'Rework');
  const outside = x.jobs.filter((j) => j.stage === stage);
  const outputLots = new Set(runs.flatMap((run) => run.lotIds ?? run.outputs ?? [run.output]));
  for (const event of x.jobEvents) {
    if (event.kind === 'Processed return' && outside.some((job) => job.id === event.jobId)) {
      for (const lotId of event.lotIds ?? [event.output]) outputLots.add(lotId);
    }
  }
  const outputs = [...outputLots].map((id) => x.lotById.get(id)).filter(Boolean);
  const held = outputs.some(
    (lot) =>
      (lot.qty > 0 && ['Hold', 'Rejected', 'Rework'].includes(lot.qualityStatus)) ||
      x.claimHolds.some((row) => row.lot.id === lot.id),
  );
  const awaiting = outputs.some((lot) => lot.qty > 0 && lot.qualityStatus === 'Pending inspection');
  const incomplete = work.some((w) => ['Released', 'In progress'].includes(w.status)) || outside.some((j) => j.qty > 0);
  const unused = work.length > 0 && work.every((w) => w.status === 'Cancelled');
  let status;
  if (held || work.some((w) => w.status === 'Closed short')) status = blocked();
  else if (awaiting) status = active('Awaiting inspection');
  else if (incomplete) status = active(outputs.length ? 'In progress' : 'Scheduled');
  else if (outputs.length) status = recorded('Output posted');
  else if (unused) status = optionalStep('Cancelled');
  else if (['Embroidery', 'Printing'].includes(stage) && Object.hasOwn(ROUTES, line.route))
    status = optionalStep('Optional');
  else status = pending('No linked posting');
  return flowStep(
    step.title || stage,
    status,
    [
      step.input && '+ ' + step.input,
      step.description,
      STAGES[stage]?.preserve ? '' : STAGES[stage]?.output,
      countLabel(work.length, 'work order'),
      outside.length ? countLabel(outside.length, 'outside job') : '',
    ]
      .filter(Boolean)
      .join(' · '),
    <>
      {table(
        ['Work order', 'Site', 'Planned / actual', 'Status'],
        work.map((w) => [
          linkButton(w.number, 'work-order', w.id),
          h(w.site),
          showQty(w.plannedQty, w.unit) + ' / ' + showQty(w.completedQty, w.unit),
          txStatus(w.status),
        ]),
        'No work orders linked for this operation.',
      )}
      {flowRunRows(runs, line.id)}
      {outside.length
        ? table(
            ['Outside challan', 'Processor', 'Sent', 'Outstanding'],
            outside.map((job) => [
              jobLabel(job),
              h(job.processor),
              jobBalance(job, job.sent, job.sentKg),
              jobBalance(job, job.qty, job.remainingKg),
            ]),
          )
        : ''}
      {STAGES[stage]?.inspection || awaiting || held
        ? flowInspections(x.inspections.filter((row) => outputLots.has(row.output)))
        : ''}
    </>,
  );
}
function flowMaterialCheckpoint(step, x) {
  const lots = x.lots.filter((lot) => lot.material === step.material);
  const held = lots.some((lot) => x.claimHolds.some((row) => row.lot.id === lot.id) || x.qualityHolds.includes(lot));
  const awaiting = lots.some((lot) => lot.qty > 0 && lot.qualityStatus === 'Pending inspection');
  const status = held
    ? blocked('On hold')
    : awaiting
      ? active('Awaiting inspection')
      : lots.length
        ? recorded('Lots linked')
        : pending('No linked lot');
  return flowStep(
    step.title,
    status,
    countLabel(lots.length, 'lot'),
    table(
      ['Lot', 'Location', 'Current balance', 'Quality'],
      lots.map((lot) => [lotLink(lot.id), h(lot.location), showQty(lot.qty, lot.unit), resultStatus(lot)]),
      'No lots of this material are linked.',
    ),
  );
}
function flowProcessSteps(steps, x, line, tracked = true) {
  const rows = steps.map((step) => {
    if (step.lanes)
      return (
        <li className="po-process-split">
          <div className="po-process-lanes" role="group" aria-label={h(step.title)}>
            {joinContent(
              step.lanes.map((lane) => (
                <section
                  className={
                    'po-process-lane' +
                    (lane.selected === true ? ' selected' : lane.selected === false ? ' alternate' : '')
                  }>
                  <h3>
                    {h(lane.title)}
                    {lane.selected === true
                      ? badge('PO route')
                      : lane.selected === false
                        ? badge('Alternate route', 'neutral')
                        : ''}
                  </h3>
                  {flowProcessSteps(lane.steps, x, line, tracked && lane.selected !== false)}
                </section>
              )),
              '',
            )}
          </div>
        </li>
      );
    if (tracked && step.stage && !step.reference) return flowOperation(step.stage, x, line, step);
    if (tracked && step.material) return flowMaterialCheckpoint(step, x);
    if (step.dispatch) return flowDispatch(x, 'Dispatch');
    const description = [step.input && '+ ' + step.input, step.description].filter(Boolean).join(' · ');
    return (
      <li className="po-process-guide">
        <strong>{h(step.title)}</strong>
        {description ? <small>{h(description)}</small> : ''}
      </li>
    );
  });
  return <ol className="po-process-chain">{joinContent(rows, '')}</ol>;
}
function flowManufacturing(app, order, x) {
  const firstRoute = x.lines.find((line) => orderRoute(line).length) ?? x.lines[0];
  const phases = x.lines.map((line) => {
    if (!line.route)
      return details(
        'Line ' + line.lineNo + ' · ' + line.style + ' · Awaiting route',
        empty('Choose a production route when approving this line in Buyer orders.'),
        line === firstRoute,
      );
    const scope = x.lines.length === 1 ? x : orderWorkflow(app.data, order.id, line.id);
    const route = orderRoute(line);
    const recordedStages = [...new Set([...scope.workOrders, ...scope.runs, ...scope.jobs].map((row) => row.stage))];
    const additional = recordedStages.filter((stage) => stage && !route.includes(stage));
    const panelPrintRequired =
      route.includes('Printing') &&
      (!Object.hasOwn(ROUTES, line.route) || scope.workOrders.some((w) => w.stage === 'Printing' && w.printArtworkId));
    const steps = productionProcess(route, {
      panelPrintRequired,
    });
    if (order.kind === 'Goods')
      steps.push({
        dispatch: true,
      });
    const body = steps.length ? (
      <section className="po-process" aria-label={'Process for line ' + h(line.lineNo)}>
        {flowProcessSteps(steps, scope, line)}
      </section>
    ) : (
      empty('This line has no planned production operations.')
    );
    const extra = additional.length ? (
      <>
        <h3 className="po-flow-subtitle">Other linked operations</h3>
        {stepList(...additional.map((stage) => flowOperation(stage, scope, line)))}
      </>
    ) : (
      ''
    );
    return details(
      'Line ' + line.lineNo + ' · ' + line.style + ' · ' + line.route,
      <>
        {body}
        {extra}
      </>,
      line === firstRoute,
    );
  });
  const pastRework = x.runs.filter((run) => run.type === 'Rework');
  const reworkOrders = x.workOrders.filter((work) => work.rework);
  return (
    <>
      {joinContent(phases, '') || empty('Add a PO line to see its route.')}
      {stepList(
        flowStep(
          'Outside processing and returns',
          x.jobs.some((job) => job.qty > 0) ? active('Awaiting return') : x.jobs.length ? recorded() : optionalStep(),
          countLabel(x.jobs.length, 'outside job'),
          <>
            {table(
              ['Challan', 'Operation / site', 'Sent lot', 'Sent', 'Processed', 'Unused', 'Loss', 'Outstanding'],
              x.jobs.map((job) => [
                jobLabel(job),
                h(job.stage + ' · ' + job.site),
                jobLots(job),
                jobBalance(job, job.sent, job.sentKg),
                showQty(job.processed, job.unit),
                showQty(job.unused, job.unit),
                showQty(job.loss, job.unit),
                jobBalance(job, job.qty, job.remainingKg),
              ]),
              'No outside jobs for the selected lines.',
            )}
            {x.jobEvents.length
              ? table(
                  ['Posting', 'Reference', 'Lot', 'Quantity', 'Date'],
                  x.jobEvents.map((event) => [
                    h(event.kind),
                    valueOf(event.reference),
                    eventLots(event),
                    showQty(event.qty, event.unit),
                    h(event.date),
                  ]),
                )
              : ''}
            {navLink('Outside job work', 'jobwork')}
          </>,
          x.jobs.some((job) => job.qty > 0),
        ),
        flowStep(
          'Quality holds, rework and claims',
          x.qualityHolds.length || x.claimHolds.length
            ? blocked('On hold')
            : reworkOrders.some((w) => ['Released', 'In progress'].includes(w.status))
              ? active('Rework in progress')
              : x.inspections.length
                ? recorded()
                : pending(),
          countLabel(x.inspections.length, 'inspection') + ' · ' + countLabel(pastRework.length, 'rework run'),
          <>
            {x.claimHolds.length
              ? table(
                  ['Standard Hold', 'Reason'],
                  x.claimHolds.map((row) => [lotLink(row.lot.id), h(row.reason)]),
                )
              : ''}
            {x.qualityHolds.length
              ? table(
                  ['Quality exception', 'Decision'],
                  x.qualityHolds.map((lot) => [lotLink(lot.id), txStatus(lot.qualityStatus)]),
                )
              : ''}
            {flowInspections(x.inspections)}
            {reworkOrders.length
              ? table(
                  ['Rework order', 'Operation', 'Planned / actual', 'Status'],
                  reworkOrders.map((w) => [
                    linkButton(w.number, 'work-order', w.id),
                    h(w.stage),
                    showQty(w.plannedQty, w.unit) + ' / ' + showQty(w.completedQty, w.unit),
                    txStatus(w.status),
                  ]),
                )
              : ''}
            {pastRework.length ? flowRunRows(pastRework, x.lines.length === 1 ? x.lines[0].id : '') : ''}
            {actions(
              navLink('Work orders', 'floor'),
              navLink('Quality & lab', 'quality'),
              navLink('Machines & readings', 'equipment'),
            )}
          </>,
          Boolean(x.qualityHolds.length || x.claimHolds.length),
        ),
      )}
    </>
  );
}
function flowDispatch(x, title, open = false) {
  return flowStep(
    title,
    shippingStatus(x),
    countLabel(x.shipments.length, 'shipment'),
    <>
      {table(
        ['Dispatch', 'Lot / carton', 'PO line', 'Quantity', 'Tracking / POD', 'Status'],
        x.shipments.flatMap((shipment) =>
          shipment.contents
            .filter((row) => x.lines.some((line) => line.id === row.lineId))
            .map((row) => [
              linkButton(shipment.number, 'shipment', shipment.id),
              lotLink(row.lotId),
              h(row.lineNo),
              showQty(row.qty, row.unit),
              valueOf([shipment.tracking, shipment.proof].filter(Boolean).join(' · ')),
              txStatus(shipment.status),
            ]),
        ),
        'No dispatches linked.',
      )}
      {navLink('Dispatch & logistics', 'logistics')}
    </>,
    open,
  );
}
function flowFulfilment(x) {
  return stepList(
    flowStep(
      'Finished stock, packing and warehouse movements',
      x.finishedLots.length ? recorded('Lots linked') : pending(),
      countLabel(x.finishedLots.length, 'finished lot'),
      <>
        {table(
          [
            'Finished lot / carton',
            'Material',
            'Last stock location',
            'Quality',
            'Allocated',
            'Shipped on selected lines',
          ],
          x.finishedLots.map((lot) => [
            lotLink(lot.id),
            h(lot.material),
            h(lot.location),
            resultStatus(lot),
            showQty(
              sum((lot.allocations ?? []).filter((row) => x.lines.some((line) => line.id === row.lineId))),
              lot.unit,
            ),
            showQty(sum(x.contents.filter((row) => row.lotId === lot.id)), lot.unit),
          ]),
          'No finished lots linked.',
        )}
        {x.movements.length
          ? table(
              ['Stock posting', 'Lot', 'From / to', 'Quantity', 'Date'],
              x.movements.map((m) => [
                h(m.kind),
                lotLink(m.output),
                valueOf([m.from, m.to].filter(Boolean).join(' → ')),
                showQty(m.qty, m.unit),
                h(m.date),
              ]),
            )
          : ''}
      </>,
    ),
    flowDispatch(x, 'Dispatch and proof of delivery', true),
    flowStep(
      'Customer returns',
      x.returns.length ? recorded() : optionalStep(),
      countLabel(x.returns.length, 'return'),
      table(
        ['Return reference', 'Shipped lot', 'Return lot', 'Quantity', 'Date'],
        x.returns.map((event) => [
          h(event.reference),
          lotLink(event.input),
          lotLink(event.output),
          showQty(event.qty, event.unit),
          h(event.date),
        ]),
        'No customer returns recorded.',
      ),
    ),
  );
}
function flowFinance(app, order, x) {
  const financialAccess = ['Admin', 'Finance'].includes(app.user.role);
  return stepList(
    flowStep(
      order.kind === 'Service' ? 'Service billing' : 'Dispatch invoices',
      invoiceStatus(order, x),
      countLabel(x.invoices.length, 'invoice'),
      <>
        {table(
          ['Invoice', 'Source', 'Issued', 'Status', ...(financialAccess ? ['Invoice total'] : [])],
          x.invoices.map((inv) => [
            linkButton(inv.number, 'invoice', inv.id),
            h(ref(x.shipments, inv.shipmentId)?.number || order.po),
            h(inv.date),
            txStatus(inv.status),
            ...(financialAccess ? [h(money(inv.amount, inv.currency))] : []),
          ]),
          'No invoices linked.',
        )}
        {financialAccess ? navLink('Invoices & costs', 'invoices') : ''}
      </>,
      true,
    ),
    ...(financialAccess
      ? [
          flowStep(
            'Landed cost and approved taxes',
            x.costs.length ? recorded() : pending('No cost postings'),
            countLabel(x.costs.length, 'lot cost'),
            table(
              ['Charge', 'Source lot', 'Category', 'Landed cost for lot', 'Date'],
              x.costs.map((c) => [h(c.reference), lotLink(c.lot), h(c.category), h(money(c.landed)), h(c.date)]),
              'No costs entered on the linked lots.',
            ),
          ),
          flowStep(
            'Ledger, settlements and reversals',
            x.vouchers.length ? recorded() : pending('No ledger postings'),
            countLabel(x.vouchers.length, 'voucher'),
            <>
              {table(
                ['Voucher', 'Type', 'Source or match', 'Amount', 'Date'],
                x.vouchers.map((v) => [
                  linkButton(v.number, 'voucher', v.id),
                  h(v.type),
                  valueOf(v.source?.reference || ref(x.vouchers, v.against || v.reverses)?.number),
                  h(money(v.total / 100)),
                  h(v.date),
                ]),
                'No accounting entries linked.',
              )}
              {navLink('Accounts & vouchers', 'accounts')}
            </>,
          ),
        ]
      : []),
  );
}
function flowPassports(s, x) {
  const lineIds = new Set(x.lines.map((line) => line.id));
  const lotIds = new Set(x.lots.map((lot) => lot.id));
  const rules = s.claimRules.filter(
    (rule) => rule.orderId === x.lines[0]?.orderId && (!rule.lineId || lineIds.has(rule.lineId)),
  );
  const labels = s.claimReleases.filter((row) => (row.lineId ? lineIds.has(row.lineId) : lotIds.has(row.lotId)));
  return stepList(
    flowStep(
      'Lot genealogy and QR labels',
      x.lots.length ? recorded('Trace available') : pending(),
      countLabel(x.lots.length, 'linked lot'),
      <>
        {table(
          ['Lot', 'Material', 'Direct inputs', 'Location'],
          x.lots.map((lot) => [
            lotLink(lot.id),
            h(lot.material),
            joinContent(
              lot.parents.map((parent) => lotLink(parent.id)),
              ', ',
            ) || '—',
            h(lot.location),
          ]),
          'Post or allocate lots to trace this order.',
        )}
        {navLink('Scan & trace', 'trace')}
      </>,
    ),
    flowStep(
      'Digital Product Passport versions',
      passportStatus(x),
      countLabel(x.passports.length, 'linked version'),
      <>
        {table(
          ['Passport', 'Source lot', 'Version', 'Status'],
          x.passports.map((p) => [
            linkButton(p.id, 'passport', p.id),
            lotLink(p.lotId),
            h(p.version),
            txStatus(p.status),
          ]),
          'No passport version linked to these lots.',
        )}
        {navLink('Digital Product Passports', 'passports')}
      </>,
      true,
    ),
    ...(rules.length || labels.length
      ? [
          flowStep(
            'Buyer claim requirements and label releases',
            labels.length ? recorded() : pending('Evidence required'),
            countLabel(rules.length, 'buyer requirement') + ' · ' + countLabel(labels.length, 'claim release'),
            <>
              {rules.length
                ? table(
                    ['Programme', 'Lock point', 'Coverage', 'Required evidence', 'Rule'],
                    rules.map((rule) => [
                      h(rule.scheme),
                      h(rule.operation),
                      h([rule.scope, rule.site, rule.subject].filter(Boolean).join(' · ')),
                      h(rule.kinds.join(' / ')),
                      h(rule.version),
                    ]),
                  )
                : ''}
              {labels.length
                ? table(
                    ['Programme', 'Article', 'Lot', 'Reference'],
                    labels.map((row) => [h(row.scheme), h(row.subject), lotLink(row.lotId), h(row.number)]),
                  )
                : ''}
              {navLink('Standards & evidence', 'standards')}
            </>,
            true,
          ),
        ]
      : []),
  );
}
function shippingStatus(x) {
  if (!x.shipments.length) return pending('Awaiting dispatch');
  if (x.lines.some((line) => sum(x.contents.filter((row) => row.lineId === line.id)) < line.qty))
    return active('Partially shipped');
  if (x.shipments.some((sh) => sh.status !== 'Delivered')) return active('Dispatched');
  return recorded('Delivered');
}
function invoiceStatus(order, x) {
  if (order.kind === 'Service') return x.invoices.length ? recorded('Issued') : pending('Awaiting invoice');
  if (!x.shipments.length) return pending('Awaiting dispatch');
  if (x.shipments.every((sh) => x.invoices.some((inv) => inv.shipmentId === sh.id)))
    return recorded('Dispatched lots invoiced');
  return x.invoices.length ? active('Partially invoiced') : pending('Awaiting invoice');
}
function passportStatus(x) {
  const published = new Set(x.passports.filter((p) => p.status === 'Published').map((p) => p.lotId));
  const covered = x.finishedLots.filter((lot) => published.has(lot.id)).length;
  if (covered && covered === x.finishedLots.length) return recorded('Published');
  if (covered) return active(fmt(covered) + ' of ' + fmt(x.finishedLots.length) + ' lots published');
  if (published.size) return recorded('Input passport linked');
  if (x.passports.some((p) => ['Draft', 'Under review'].includes(p.status))) return active('In preparation');
  return x.passports.some((p) => p.status === 'Suspended') ? blocked('Suspended') : optionalStep('If applicable');
}
function PoFlow({ app, params: args }) {
  const s = app.data;
  const choices = s.orders.slice().reverse();
  const requested = args.get('order');
  const inCompany = !args.has('company') || args.get('company') === app.user.companyId;
  const order = inCompany ? (requested ? ref(choices, requested) : choices[0]) : null;
  const lines = s.lines.filter((line) => line.orderId === order?.id);
  const lineId = args.get('line') || '';
  const line = ref(lines, lineId);
  const filters = (
    <div className="po-flow-filters">
      {choose('Buyer PO', 'flowOrder', choices, titles.order, {
        initial: order?.id,
        hook: 'flow-order',
      })}
      {order
        ? choose('PO line', 'flowLine', lines, (l) => l.lineNo + ' · ' + [l.style, l.color, l.size].join(' / '), {
            initial: line?.id,
            required: false,
            blank: 'All PO lines',
            hook: 'flow-line',
          })
        : ''}
    </div>
  );
  if (!order || (lineId && !line)) {
    return (
      <>
        {heading('Buyer PO flowchart', '')}
        {panel(
          'Select an order',
          <>
            {filters}
            {choices.length ? (
              note('The requested PO or line is unavailable in the active company.', true)
            ) : (
              <>
                {empty('Create a buyer PO to start tracking its workflow.')}
                {navLink('Buyer orders', 'orders')}
              </>
            )}
          </>,
        )}
      </>
    );
  }
  const x = orderWorkflow(s, order.id, line?.id);
  const approved = x.lines.filter((l) => l.status === 'Approved').length;
  const purchaseOpen =
    x.requisitions.some((r) => r.ordered < r.qty) || x.purchases.some((po) => po.lines.some((l) => l.received < l.qty));
  const stagesOpen =
    x.workOrders.some((w) => ['Released', 'In progress'].includes(w.status)) || x.jobs.some((job) => job.qty > 0);
  const awaitingInspection = x.lots.some((lot) => lot.qty > 0 && lot.qualityStatus === 'Pending inspection');
  const phases = {
    commercial: {
      label: 'Buyer PO & approval',
      status: x.lines.length && approved === x.lines.length ? recorded('Approved') : pending('Awaiting approval'),
      caption: fmt(approved) + ' of ' + fmt(x.lines.length) + ' lines approved',
      render: () => flowCommercial(app, order, x),
    },
    material: {
      label: 'Material & sourcing',
      status: purchaseOpen
        ? active('Open purchase')
        : x.receipts.length || x.reserved.length
          ? recorded('Materials linked')
          : pending('Awaiting stock or purchase'),
      caption: countLabel(x.receipts.length, 'GRN'),
      render: () => flowMaterials(x),
    },
    production: {
      label: 'Production & quality',
      status:
        x.qualityHolds.length || x.claimHolds.length
          ? blocked('On hold')
          : awaitingInspection
            ? active('Awaiting inspection')
            : stagesOpen
              ? active()
              : x.runs.length || x.jobs.length
                ? recorded('Operations posted')
                : x.lines.some((l) => orderRoute(l).length)
                  ? pending('Awaiting work')
                  : x.lines.some((l) => !l.route)
                    ? pending('Awaiting route')
                    : optionalStep(x.lines.length ? 'Direct fulfilment' : 'Awaiting lines'),
      caption: countLabel(x.runs.length, 'run') + ' · ' + countLabel(x.jobs.length, 'outside job'),
      render: () => flowManufacturing(app, order, x),
    },
    dispatch: {
      label: 'Packing & dispatch',
      status: shippingStatus(x),
      caption: countLabel(x.shipments.length, 'shipment'),
      render: () => flowFulfilment(x),
    },
    finance: {
      label: 'Invoicing & accounts',
      status: invoiceStatus(order, x),
      caption: countLabel(x.invoices.length, 'invoice'),
      render: () => flowFinance(app, order, x),
    },
    passport: {
      label: 'Traceability & DPP',
      status: passportStatus(x),
      caption: countLabel(x.passports.length, 'passport version'),
      render: () => flowPassports(s, x),
    },
  };
  const isService = order.kind === 'Service';
  const main = ['commercial', 'material', 'production', isService ? 'finance' : 'dispatch'];
  const branches = {
    production: 'passport',
    ...(isService
      ? {}
      : {
          dispatch: 'finance',
        }),
  };
  const route = args.get('phase');
  const defaultPhase = !isService && x.lines.some((item) => orderRoute(item).length) ? 'production' : 'commercial';
  const phase = Object.hasOwn(phases, route) && (!isService || route !== 'dispatch') ? route : defaultPhase;
  const node = (key) => {
    const data = phases[key];
    const href = orderFlowHash(app.user.companyId, order.id, line?.id, key);
    return (
      <a
        href={h(href)}
        className={'po-flow-card ' + data.status.tone}
        data-order-flow=""
        aria-current={phase === key ? 'step' : undefined}>
        <strong>{h(data.label)}</strong>
        {statusPill(data.status)}
        <small>{h(data.caption)}</small>
      </a>
    );
  };
  const chart = (
    <nav className="po-flow-chart" aria-label="PO process flow">
      {joinContent(
        main.map((key) => (
          <div className="po-flow-cell">
            {node(key)}
            {branches[key] ? <div className="po-flow-branch">{node(branches[key])}</div> : ''}
          </div>
        )),
        '',
      )}
    </nav>
  );
  const lineSummary = x.lines.map((l) => ({
    ...l,
    shipped: sum(x.contents.filter((row) => row.lineId === l.id)),
  }));
  const metrics = isService
    ? cards([
        ['Selected lines', fmt(x.lines.length)],
        ['Approved', fmt(approved)],
        ['Issued invoices', fmt(x.invoices.length)],
      ])
    : cards([
        ['Selected lines', fmt(x.lines.length)],
        ['Ordered', byUnit(lineSummary)],
        ['Shipped', byUnit(lineSummary, (l) => l.shipped)],
        ['Remaining to ship', byUnit(lineSummary, (l) => Math.max(0, round(l.qty - l.shipped)))],
      ]);
  return (
    <>
      {heading(
        'PO ' + order.po + ' flowchart',
        order.buyer + (line ? ' · Line ' + line.lineNo + ' · ' + line.style : ''),
        navLink('Buyer orders', 'orders'),
      )}
      {filters}
      {metrics}
      {chart}
      <section className="po-flow-selection" aria-labelledby="flow-phase-title">
        <div className="po-flow-phase-heading">
          <h2 id="flow-phase-title" tabIndex="-1">
            {h(phases[phase].label)}
          </h2>
          {button('Back to flowchart', {
            'data-flow-top': 'yes',
          })}
        </div>
        {phases[phase].render()}
      </section>
    </>
  );
}
export { PoFlow };
function Procurement({ app }) {
  const s = app.data;
  const requirements = planning(s);
  return (
    <>
      {heading(
        'Material planning and purchase',
        'Check BOM demand, make reservations, and raise supplier purchase orders for shortages.',
      )}
      {panel(
        'Open order requirements',
        table(
          ['Material / claim', 'Demand', 'Reserved', 'Free', 'Open supplier PO', 'Shortage', 'Buyer lines'],
          requirements.map((d) => [
            h(d.label + ' · ' + (d.schemes.join(', ') || 'Conventional')),
            showQty(d.demand, d.unit),
            showQty(d.reserved, d.unit),
            showQty(d.free, d.unit),
            showQty(d.onOrder, d.unit),
            d.shortage ? badge(fmt(d.shortage) + ' ' + d.unit, 'warn') : '—',
            h(d.lines.join(', ')),
          ]),
        ),
      )}
      {split(
        editor(
          app,
          'requisition',
          'Raise purchase requisition',
          <>
            {items(s)}
            {approvedLines(s, 'Buyer PO line', {
              required: false,
              blank: 'General stock',
            })}
            {requiredNumber('Required quantity in stock unit', 'qty')}
            {day('Required by', 'required')}
            {text('Buyer demand / reason', 'notes')}
          </>,
          'Save requisition',
        ),
        editor(
          app,
          'purchase',
          'Issue supplier PO',
          <>
            {parties(s, 'Supplier')}
            {field('Supplier PO number', 'number')}
            {field('Supplier facility in evidence scope', 'supplierSite')}
            {locationChoice(s, 'Receiving location')}
            {schemes(s)}
            {day('Order date')}
            {day('Expected delivery', 'due', false)}
            {select('Commercial currency', 'currency', CURRENCIES, {
              required: false,
              blank: 'Supplier default',
            })}
            {text(
              'PO rows: item code, quantity, price, optional requisition ID',
              'lines',
              'COT-001,300,140,REQ-00005',
              true,
            )}
            {text('Terms or delivery instruction', 'notes')}
          </>,
          'Issue supplier PO',
        ),
        editor(
          app,
          'reservation',
          'Reserve or release lot stock',
          <>
            {lots(s)}
            {approvedLines(s)}
            {requiredNumber('Quantity in lot unit', 'qty')}
            {select('Action', 'mode', ['Reserve', 'Release'], {
              initial: 'Reserve',
            })}
          </>,
          'Post reservation',
        ),
        editor(
          app,
          'quotation',
          'Record supplier or sales quotation',
          <>
            {field('Quotation reference', 'number')}
            {select('Quotation type', 'kind', ['Supplier quotation', 'Sales quotation'])}
            {choose(
              'Buyer or supplier',
              'partyId',
              s.parties.filter((p) => p.type !== 'Processor'),
              titles.party,
            )}
            {items(s)}
            {choose('Related requisition', 'requisitionId', s.requisitions, (r) => r.id + ' · ' + r.label, {
              required: false,
            })}
            {requiredNumber('Quantity', 'qty')}
            {requiredNumber('Unit price', 'price')}
            {day('Quote date')}
            {day('Valid through', 'validUntil', false)}
            {select('Currency', 'currency', CURRENCIES, {
              required: false,
              blank: 'Party default',
            })}
            {text('Payment and delivery terms', 'terms')}
          </>,
          'Save quote',
        ),
      )}
      {panel(
        'Requisitions',
        table(
          ['Requisition', 'Material', 'Requested', 'Ordered', 'Buyer line', 'Required'],
          s.requisitions
            .slice()
            .reverse()
            .map((r) => [
              h(r.id),
              h(r.label),
              showQty(r.qty, r.unit),
              showQty(r.ordered, r.unit),
              valueOf(r.lineId),
              h(r.required),
            ]),
        ),
      )}
      {panel(
        'Purchase orders',
        table(
          ['Supplier PO', 'Supplier', 'Site', 'Due', 'Order line / received / ordered', 'Currency'],
          s.purchases
            .slice()
            .reverse()
            .map((p) => [
              h(p.number),
              h(p.supplier),
              h(p.supplierSite),
              h(p.due),
              joinContent(
                p.lines.map((l) =>
                  h(l.id + ' · ' + l.label + ' · ' + fmt(l.received) + ' / ' + fmt(l.qty) + ' ' + l.unit),
                ),
                <br />,
              ),
              h(p.currency),
            ]),
        ),
      )}
      {panel(
        'Quotation comparison',
        table(
          ['Reference', 'Kind', 'Party', 'Item', 'Quantity', 'Unit rate', 'Valid through'],
          s.quotes
            .slice()
            .reverse()
            .map((q) => [
              h(q.number),
              h(q.kind),
              h(q.party),
              h(ref(s.items, q.itemId)?.code),
              showQty(q.qty),
              h(money(q.price, q.currency)),
              valueOf(q.validUntil),
            ]),
        ),
      )}
    </>
  );
}
export { Procurement };
const measures = () => (
  <>
    {optionalNumber('Actual net kg', 'netKg')}
    {optionalNumber('Actual metres', 'lengthM')}
    {optionalNumber('Gross kg', 'grossKg')}
  </>
);
const openWork = (s) => s.workOrders.filter((w) => ['Released', 'In progress'].includes(w.status));
export const resultStatus = (l) => (l.standardHold ? badge('Standard Hold', 'bad') : txStatus(l.qualityStatus));
function Stock({ app }) {
  const s = app.data;
  const search = norm(app.local.stockSearch);
  const filtered = s.lots.filter(
    (l) => !search || norm([l.id, l.material, l.location, l.label, l.party].join(' ')).includes(search),
  );
  return (
    <>
      {heading(
        'Inventory',
        'Record lots and roll measurements at receiving. Search by lot, material, supplier or location.',
        navLink('Scan & trace', 'trace'),
      )}
      {split(
        editor(
          app,
          'receipt',
          'Post material receipt',
          <>
            {field('Lot, bale or roll ID', 'lotId')}
            {select(
              'Inward source without supplier PO',
              'mode',
              ['Direct inward', 'Customer inward', 'Opening stock'],
              {
                initial: 'Direct inward',
              },
            )}
            {choose(
              'Supplier PO',
              'purchaseId',
              s.purchases.filter((p) => p.lines.some((l) => l.received < l.qty)),
              (p) => p.number + ' · ' + p.supplier,
              {
                required: false,
                hook: 'purchase',
                blank: 'No supplier PO',
              },
            )}
            {select('Supplier PO line', 'purchaseLineId', [], {
              required: false,
              blank: 'Choose supplier PO first',
            })}
            {items(s, 'Item for non-PO receipt', {
              required: false,
            })}
            {requiredNumber('Quantity in item stock unit', 'qty')}
            {parties(s, 'Supplier', 'supplierId', {
              required: false,
            })}
            {parties(s, 'Buyer', 'ownerId', {
              required: false,
              blank: 'Company-owned',
            })}
            {optional('Supplier origin or facility for non-PO receipt', 'origin')}
            {optional('Origin country', 'originCountry')}
            {optional('Supplier’s lot reference', 'supplierLot')}
            {locationChoice(s, 'Receiving location')}
            {schemes(s)}
            {optional('Additional schemes, comma separated', 'additionalSchemes')}
            {optional('Declared composition', 'composition')}
            {measures()}
            {day('Receipt date')}
            {field('GRN / delivery reference', 'reference')}
            {optional('Shipment reference on transaction evidence', 'evidenceShipment')}
            {file('GRN, supplier challan or Bill of Entry', 'stock')}
          </>,
          'Post receipt',
          'Physical stock enters pending inspection. Missing claim evidence creates a separate Standard Hold.',
          !s.lots.length,
        ),
        editor(
          app,
          'transfer',
          'Transfer or split a lot',
          <>
            {lots(s)}
            {requiredNumber('Transfer quantity', 'qty')}
            {locationChoice(s, 'Destination')}
            {optional('New lot ID for partial transfer', 'outputId')}
            {field('Transfer / challan reference', 'reference')}
            {day()}
            {text('PO allocations to move on a split, line ID and quantity', 'allocations', 'LINE-00010,40')}
            {optional('Carrier', 'carrier')}
            {optional('Route / vehicle', 'route')}
            {file('Transfer document', 'stock')}
          </>,
          'Post transfer',
          'A full transfer keeps the lot ID. For a split, enter the new ID and any existing packing or production allocations to carry forward.',
        ),
        editor(
          app,
          'stock-count',
          'Post a stock count adjustment',
          <>
            {lots(s)}
            {requiredNumber('Counted balance', 'qty')}
            {field('Count reference and reason', 'reference')}
            {day()}
          </>,
          'Post count',
        ),
      )}
      {panel(
        'Lot register',
        <>
          {form(
            'stock-search',
            field('Find stock', 'search', {
              value: app.local.stockSearch || '',
              required: false,
            }),
            'Filter',
          )}
          {table(
            [
              'Lot',
              'Material',
              'On hand / unreserved',
              'Actual measures at intake',
              'Location / owner',
              'Quality / claim',
            ],
            filtered
              .slice()
              .reverse()
              .map((l) => [
                lotLink(l.id),
                h(l.label),
                showQty(l.qty, l.unit) + ' / ' + showQty(freeStock(l), l.unit),
                h(
                  [l.netKg ? fmt(l.netKg) + ' kg' : '', l.lengthM ? fmt(l.lengthM) + ' m' : '']
                    .filter(Boolean)
                    .join(' · ') || '—',
                ),
                <>
                  {h(l.location)}
                  <br />
                  <small>{h(ref(s.parties, l.ownerId)?.name || s.settings.name)}</small>
                </>,
                <>
                  {resultStatus(l)}
                  <br />
                  <small>{h(schemesOf(l).join(', ') || 'Conventional')}</small>
                </>,
              ]),
          )}
        </>,
      )}
      {details(
        'Stock movement ledger',
        table(
          ['Posting date', 'Transaction', 'Lot', 'Quantity change', 'Location', 'Reference'],
          s.events
            .slice(-120)
            .reverse()
            .flatMap((e) =>
              (e.moves ?? []).map((m) => [
                h(e.date),
                h(e.stage || e.kind),
                lotLink(m.lotId),
                (m.qty > 0 ? '+' : '') + showQty(m.qty, m.unit),
                h(m.location),
                valueOf(e.reference),
              ]),
            ),
        ),
      )}
    </>
  );
}
export { Stock };
function Floor({ app }) {
  const s = app.data;
  return (
    <>
      {heading(
        'Work orders and production',
        'Release job sheets and issue actual stock lots. Record accepted output, measured loss and resources on each run.',
        <>
          {navLink('Washing', 'washing')}
          {navLink('Printing', 'printing')}
        </>,
      )}
      {split(
        editor(
          app,
          'work-order',
          'Release job sheet',
          <>
            {field('Work order number', 'number')}
            {approvedLines(s, 'Buyer PO line', {
              required: false,
              blank: 'Stock / mixed allocations',
              hook: 'tech-work-line',
            })}
            {select('Tech pack fabric component', 'techComponent', [], {
              required: false,
              blank: 'Use product or stock item',
            })}
            {select(
              'Operation',
              'stage',
              Object.keys(STAGES).filter((stage) => !PRINT_STAGES.includes(stage)),
              {
                hook: 'stage',
              },
            )}
            {locationChoice(s, 'Output location at production site')}
            {requiredNumber('Planned good output', 'plannedQty')}
            {select('Output stock unit', 'unit', UNITS, {
              initial: 'kg',
            })}
            {schemes(s, 'Standard for stock jobs')}
            {optional('Additional schemes for stock jobs', 'additionalSchemes')}
            {day('Release date')}
            {day('Due date', 'due', false)}
            {optional('Recipe revision or setup reference', 'recipe')}
            {check('Rework of held-for-rework lots', 'rework')}
            {text('Work instructions', 'notes')}
            {file('Job sheet or approved recipe', 'production')}
          </>,
          'Release work order',
          '',
          !openWork(s).length,
        ),
        editor(
          app,
          'production',
          'Post actual production',
          <>
            {choose(
              'Open work order',
              'workOrderId',
              openWork(s).filter(
                (w) => !WASH_STAGES.includes(w.stage) && !PRINT_STAGES.includes(w.stage) && !w.finishPlanId,
              ),
              titles.wo,
              {
                hook: 'work',
              },
            )}
            {field('New output lot ID', 'outputId')}
            {requiredNumber('Actual accepted output in work order unit', 'outputQty')}
            {items(s, 'Matching output item', {
              required: false,
              blank: 'Use operation material',
            })}
            {optional('Output description', 'label')}
            {locationChoice(s, 'Output location override', {
              required: false,
              blank: 'Use job sheet',
            })}
            {day()}
            {field('Run / job sheet reference', 'reference')}
            {optional('Recipe or method override', 'recipe')}
            {optional('Shift', 'shift')}
            {optional('Operator / line', 'operator')}
            {select(
              'Reconciliation unit',
              'balanceUnit',
              UNITS.filter((u) => u !== 'carton'),
              {
                required: false,
                blank: 'First primary input unit',
              },
            )}
            {optionalNumber('Waste in reconciliation unit', 'waste', '0')}
            {optionalNumber('Rejects in reconciliation unit', 'rejects', '0')}
            {optionalNumber('Measured gain / loss adjustment', 'adjustment', '', -100000000)}
            {optional('Adjustment basis', 'adjustmentRef')}
            {measures()}
            {text('Inputs, lot ID and quantity in stock unit', 'inputs', 'WRP-1001,100\nYRN-1002,55', true)}
            {text('Output allocation, PO line ID and quantity', 'allocations', 'LINE-00010,230')}
            {optional('Measured fibre composition', 'composition')}
            {choose('Machine', 'machineId', s.machines, (m) => m.code + ' · ' + m.name, {
              required: false,
            })}
            {choose(
              'Verified meter activity',
              'readingId',
              s.readings.filter((r) => r.verified && !r.eventId),
              (r) => r.reference + ' · ' + fmt(r.qty) + ' ' + r.unit,
              {
                required: false,
              },
            )}
            {optionalNumber('Labour hours', 'labourHours', '0')}
            {optionalNumber('Machine hours', 'machineHours', '0')}
            {optionalNumber('Electricity kWh', 'electricity', '0')}
            {optionalNumber('Water L', 'water', '0')}
            {check('Hold the output for inspection', 'inspect')}
            {file('Run or measurement report', 'production')}
          </>,
          'Post operation',
          'The work order carries the route and approved revisions. For cutting in pieces, reconcile in kg with the actual output weight. Each packing run posts one carton.',
          openWork(s).length > 0,
        ),
        editor(
          app,
          'work-close',
          'Close an unfinished work order',
          <>
            {choose('Work order', 'workOrderId', openWork(s), titles.wo)}
            {text('Closure reason', 'notes', '', true)}
          </>,
          'Close work order',
        ),
      )}
      {panel(
        'Work order register',
        table(
          ['Job sheet', 'Operation', 'PO line / revision', 'Plan / actual', 'Site', 'Status'],
          s.workOrders
            .slice()
            .reverse()
            .map((w) => [
              linkButton(w.number, 'work-order', w.id),
              h(w.stage),
              h((w.lineId || 'Stock') + (w.lineRevision ? ' / ' + w.lineRevision : '')),
              showQty(w.plannedQty, w.unit) + ' / ' + showQty(w.completedQty, w.unit),
              h(w.site),
              txStatus(w.status),
            ]),
        ),
      )}
      {panel(
        'Production postings',
        table(
          ['Run', 'Operation', 'Issued', 'Output', 'Waste / rejects', 'Resources'],
          s.events
            .filter((e) => e.kind === 'Production')
            .slice()
            .reverse()
            .map((e) => [
              h(e.reference),
              h(e.stage),
              joinContent(
                e.inputs.map((a) => (
                  <>
                    {lotLink(a.id)}
                    {' · '}
                    {showQty(a.qty, a.unit)}
                  </>
                )),
                <br />,
              ),
              <>
                {eventLots(e)}
                {' · '}
                {showQty(e.qty, e.unit)}
              </>,
              showQty(e.reconciliation.waste, e.reconciliation.unit) +
                ' / ' +
                showQty(e.reconciliation.rejects, e.reconciliation.unit),
              h(
                [
                  fmt(e.labourHours) + ' h labour',
                  fmt(e.machineHours) + ' h machine',
                  fmt(e.electricity) + ' kWh',
                  fmt(e.water) + ' L',
                ].join(' · '),
              ),
            ]),
        ),
      )}
    </>
  );
}
export { Floor };
export function workDetail(app, w) {
  const line = ref(app.data.lines, w.lineId);
  const pinned =
    w.lineRevision === line?.revision ? line : line?.revisions.find((row) => row.revision === w.lineRevision);
  const component = pinned?.garmentSpec?.fabrics.find((row) => row.code === w.techComponent);
  const spec = pinned?.garmentSpec ? component?.construction : fabricSpecAt(line, w.lineRevision);
  const washBatches = app.data.processBatches.filter((b) => b.process === 'Washing' && b.workOrderId === w.id);
  const finishBatches = app.data.processBatches.filter(
    (b) => b.process === 'Fabric finishing' && b.workOrderId === w.id,
  );
  const printBatches = app.data.processBatches.filter((b) => b.process === 'Printing' && b.workOrderId === w.id);
  return (
    <>
      {heading(
        'Job sheet ' + w.number,
        w.stage + ' · ' + w.site,
        pinned?.garmentSpec ? garmentLink(app, line.id, w.lineRevision, 'Open pinned tech pack') : '',
      )}
      {facts([
        ['Plan', showQty(w.plannedQty, w.unit)],
        ['Posted', showQty(w.completedQty, w.unit)],
        ['Due', h(w.due)],
        ['Status', txStatus(w.status)],
        ['PO line', valueOf(w.lineId)],
        ['Approval revision', valueOf(w.lineRevision)],
        ['Fabric component', valueOf(w.techComponent)],
        [
          'Approved component route',
          w.componentRoute
            ? h(
                w.componentRoute.template +
                  ' r' +
                  w.componentRoute.version +
                  ' · ' +
                  w.componentRoute.stages.join(' → ') +
                  ' · BOM ' +
                  w.componentRoute.bomRev,
              )
            : '—',
        ],
        ['Recipe', valueOf(w.recipe)],
        ['Instructions', valueOf(w.notes)],
        ['Document', docs(w.document)],
      ])}
      {spec ? panel('Approved fabric specification', fabricSpecCard(spec)) : ''}
      {WASH_STAGES.includes(w.stage)
        ? panel(
            'Washing',
            washBatches.length
              ? joinContent(
                  washBatches.map((b) => <p>{washLink(b.id, b.number)}</p>),
                  '',
                )
              : navLink('Load a wash batch', 'washing'),
          )
        : ''}
      {w.finishPlanId
        ? panel(
            'Fabric finishing',
            finishBatches.length
              ? joinContent(
                  finishBatches.map((b) => <p>{finishBatchLink(b.id, b.number)}</p>),
                  '',
                )
              : navLink('Open a finishing batch', 'fabric-finishing'),
          )
        : ''}
      {w.printArtworkId
        ? panel(
            'Printing',
            printBatches.length
              ? joinContent(
                  printBatches.map((b) => <p>{printBatchLink(b.id, b.number)}</p>),
                  '',
                )
              : navLink('Issue a print batch', 'printing'),
          )
        : ''}
      {panel(
        'Posted runs',
        table(
          ['Reference', 'Lot', 'Quantity'],
          app.data.events
            .filter((e) => e.workOrderId === w.id)
            .map((e) => [h(e.reference), eventLots(e), showQty(e.qty, e.unit)]),
        ),
      )}
    </>
  );
}
function Quality({ app }) {
  const s = app.data;
  const queue = s.lots.filter((l) => l.qty > 0 && (l.qualityStatus !== 'Released' || l.standardHold));
  return (
    <>
      {heading(
        'Quality and lab',
        'Release, hold, rework or reject a physical lot. The inspection and the scheme evidence gate are recorded separately.',
      )}
      {split(
        editor(
          app,
          'quality',
          'Post quality disposition',
          <>
            {lots(s, 'Lot for inspection', (l) => l.qty > 0 && l.qualityStatus !== 'Rejected', {
              hook: 'fabric-lot',
            })}
            {select('Decision', 'decision', ['Released', 'Hold', 'Rework', 'Rejected'])}
            {day('Inspection date')}
            {field('Inspection / lab report ID', 'reference')}
            {optional('Sample ID', 'sample')}
            {optional('Test method', 'testMethod')}
            {optional('Measured result and unit', 'result')}
            {fabricInspectionFields()}
            {garmentInspectionFields()}
            {text('Findings or corrective action', 'notes')}
            {file('Lab or quality report', 'quality')}
          </>,
          'Post inspection',
          '',
          queue.length > 0,
        ),
        editor(
          app,
          'disposal',
          'Scrap or return held stock',
          <>
            {lots(s, 'Held or rejected lot', (l) => l.qty > 0 && ['Hold', 'Rejected'].includes(l.qualityStatus))}
            {select('Disposition', 'mode', ['Scrap', 'Supplier return'])}
            {requiredNumber('Quantity', 'qty')}
            {day()}
            {field('Disposition approval or supplier return', 'reference')}
            {text('Reason', 'notes')}
          </>,
          'Post disposition',
        ),
      )}
      {panel(
        'Inspection queue',
        table(
          ['Lot', 'Material', 'On hand', 'Inspection result', 'Standard Hold'],
          queue.map((l) => [
            lotLink(l.id),
            h(l.material),
            showQty(l.qty, l.unit),
            txStatus(l.qualityStatus),
            l.standardHold ? h(l.holdReason) : '—',
          ]),
        ),
      )}
      {panel(
        'Inspection register',
        table(
          ['Date', 'Lot', 'Decision', 'Report / test', 'Technical checks', 'Inspector', 'Document'],
          s.events
            .filter((e) => e.kind === 'Quality inspection')
            .slice()
            .reverse()
            .map((e) => [
              h(e.date),
              lotLink(e.output),
              txStatus(e.decision),
              h([e.reference, e.testMethod, e.result].filter(Boolean).join(' · ')),
              inspectionChecks(e),
              h(e.actor),
              docs(e.document),
            ]),
        ),
      )}
    </>
  );
}
export { Quality };
function Jobwork({ app }) {
  const s = app.data;
  return (
    <>
      {heading(
        'Outside job work',
        'Track stock sent to each commission processor. Receipts and losses close the quantity outstanding against the outward challan.',
        <>
          {navLink('Washing', 'washing')}
          {navLink('Printing', 'printing')}
        </>,
      )}
      {split(
        editor(
          app,
          'job-out',
          'Send material to processor',
          <>
            {lots(s)}
            {parties(s, 'Processor')}
            {field('Actual processor facility', 'site')}
            {select(
              'Operation',
              'stage',
              Object.keys(STAGES).filter((stage) => !WASH_STAGES.includes(stage) && !PRINT_STAGES.includes(stage)),
            )}
            {requiredNumber('Sent quantity in lot unit', 'qty')}
            {approvedLines(s, 'Approved PO line for reserved stock', {
              required: false,
            })}
            {field('Outward challan', 'number')}
            {day('Outward date')}
            {optional('Carrier / vehicle', 'carrier')}
            {optional('Route / e-way bill reference', 'route')}
            {file('Challan or transit document', 'logistics')}
          </>,
          'Post outward',
        ),
        editor(
          app,
          'job-return',
          'Receive output, unused goods or loss',
          <>
            {choose(
              'Open commission job',
              'jobId',
              s.jobs.filter((j) => j.qty > 0 && !j.washBatchId && !j.printBatchId && !j.embroideryBatchId),
              (j) => j.number + ' · ' + j.processor + ' · ' + fmt(j.qty) + ' ' + j.unit,
            )}
            {select('Return type', 'kind', ['Processed return', 'Unused return', 'Process loss'])}
            {requiredNumber('Quantity reconciled in sent unit', 'used')}
            {optional('New lot ID for returned stock', 'outputId')}
            {select('Processed output unit', 'unit', UNITS, {
              required: false,
              blank: 'Sent unit',
            })}
            {optionalNumber('Processed quantity received', 'outputQty')}
            {optionalNumber('Waste included in sent-unit reconciliation', 'waste', '0')}
            {optionalNumber('Rejected within reconciled quantity', 'rejects', '0')}
            {measures()}
            {optional('Reported processor chemical codes, comma separated', 'chemicalItems')}
            {check('Processor confirmed no chemicals were used', 'noChemicals')}
            {locationChoice(s, 'Returning location')}
            {day()}
            {field('Return or loss reference', 'reference')}
            {text('Findings or processing notes', 'notes')}
            {file('Return or loss document', 'logistics')}
          </>,
          'Post return / loss',
        ),
      )}
      {panel(
        'Commission balance',
        table(
          ['Challan', 'Sent lot', 'Processor / site', 'Sent', 'Processed', 'Unused', 'Loss', 'Outstanding', 'Status'],
          s.jobs
            .slice()
            .reverse()
            .map((j) => [
              jobLabel(j),
              jobLots(j),
              h(j.processor + ' / ' + j.site),
              jobBalance(j, j.sent, j.sentKg),
              showQty(j.processed, j.unit),
              showQty(j.unused, j.unit),
              showQty(j.loss, j.unit),
              jobBalance(j, j.qty, j.remainingKg),
              txStatus(j.status),
            ]),
        ),
      )}
    </>
  );
}
export { Jobwork };
export function shipmentListTable(s, includeInvoices = true) {
  return table(
    ['Dispatch', 'Buyer', 'Lots / cartons', 'Route', 'Tracking', 'Status', 'Invoice'],
    s.shipments
      .slice()
      .reverse()
      .map((sh) => {
        const inv = s.invoices.find((i) => i.shipmentId === sh.id);
        return [
          linkButton(sh.number, 'shipment', sh.id),
          h(sh.customer),
          joinContent(
            sh.lotIds.map((id) => (includeInvoices ? lotLink(id) : h(id))),
            ', ',
          ),
          h([sh.originPort, sh.destinationPort, sh.destination].filter(Boolean).join(' → ')),
          valueOf(sh.tracking),
          txStatus(sh.status),
          inv ? linkButton(inv.number, 'invoice', inv.id) : '—',
        ];
      }),
  );
}
function Logistics({ app }) {
  const s = app.data;
  const packed = s.lots.filter(
    (l) => l.material === 'Packed carton' && l.qty > 0 && l.qualityStatus === 'Released' && !l.standardHold,
  );
  return (
    <>
      {heading(
        'Dispatch and logistics',
        'Build shipments from available lots and approved PO lines. Record transport legs, port references and delivery evidence.',
        navLink('Packing', 'packing'),
      )}
      {panel(
        'Ready cartons',
        table(
          ['Carton', 'Quantity', 'Warehouse', 'Allocated buyer lines', ''],
          packed.map((l) => [
            lotLink(l.id),
            showQty(l.qty, l.unit),
            h(l.location),
            h(l.allocationBalance.map((a) => a.lineId + ' · ' + fmt(a.qty)).join(', ')),
            can(app, 'dispatch') ? linkButton('Use in dispatch', 'ship-lot', l.id) : '—',
          ]),
        ),
      )}
      {split(
        editor(
          app,
          'dispatch',
          'Post dispatch',
          <>
            {field('Dispatch reference', 'number')}
            {select('Movement type', 'mode', ['Domestic', 'Export', 'Customer return'], {
              initial: 'Domestic',
            })}
            {day('Dispatch date')}
            {optional('Destination override', 'destination')}
            {optional('Carrier', 'carrier')}
            {optional('Tracking / AWB / BL', 'tracking')}
            {optional('Shipment reference on transaction evidence', 'evidenceShipment')}
            {optional('Port / terminal of loading', 'originPort')}
            {optional('Port / terminal of discharge', 'destinationPort')}
            {optional('Container and seal', 'container')}
            {optional('Challan', 'challan')}
            {optional('Customs document reference', 'customsRef')}
            {optional('E-way bill reference', 'eway')}
            {text(
              'Contents, lot ID, PO line ID, quantity per row',
              'items',
              'CTN-26018-01,LINE-00012,230',
              true,
              app.local.shipItems || '',
            )}
            {text(
              'Route legs, from, to, mode, carrier, departure, arrival, tracking',
              'legs',
              'Chennai,Rotterdam,Ocean,Carrier,2026-12-10,2026-12-29,BL-11',
            )}
            {text('Instructions', 'notes')}
            {file('Transport, packing or customs document', 'logistics')}
          </>,
          'Post dispatch',
          'Each listed carton must depart in full, using its recorded packing allocations.',
          packed.length > 0,
        ),
        editor(
          app,
          'delivery',
          'Confirm delivery',
          <>
            {shipmentList(s)}
            {day('Delivery date')}
            {field('Delivery evidence reference', 'reference')}
            {file('Proof of delivery', 'logistics')}
          </>,
          'Confirm delivery',
        ),
        editor(
          app,
          'customer-return',
          'Record customer return',
          <>
            {shipmentList(s)}
            {field('Originally dispatched lot ID', 'lotId')}
            {approvedLines(s)}
            {requiredNumber('Returned quantity', 'qty')}
            {field('New return lot ID', 'outputId')}
            {field('Return authorization', 'reference')}
            {locationChoice(s, 'Receiving location')}
            {day('Return date')}
            {file('Customer return document', 'logistics')}
          </>,
          'Receive return',
        ),
      )}
      {panel('Shipments', shipmentListTable(s))}
    </>
  );
}
export { Logistics };
export function shipmentDetail(app, sh) {
  const internal = app.user.role !== 'Buyer';
  const s = app.data;
  return (
    <>
      {heading('Packing list ' + sh.number, s.settings.name + ' · ' + sh.customer)}
      {facts([
        ['Date', h(sh.date)],
        ['Ship to', h(sh.destination)],
        ['Carrier and tracking', valueOf([sh.carrier, sh.tracking].filter(Boolean).join(' · '))],
        ['Status', txStatus(sh.status)],
        ['Ports', valueOf([sh.originPort, sh.destinationPort].filter(Boolean).join(' → '))],
        ['Container', valueOf(sh.container)],
        ['Challan / e-way bill', valueOf([sh.challan, sh.eway].filter(Boolean).join(' / '))],
        ['Customs reference', valueOf(sh.customsRef)],
        ['Document', docs(sh.document)],
        ['Proof of delivery', sh.deliveryDocument ? docs(sh.deliveryDocument) : valueOf(sh.proof)],
      ])}
      {panel(
        'Packed or dispatched contents',
        table(
          ['Lot / carton', 'Buyer PO', 'Line', 'Style', 'Quantity'],
          sh.contents.map((c) => [
            internal ? lotLink(c.lotId) : h(c.lotId),
            h(c.po),
            h(c.lineNo),
            h(c.style),
            showQty(c.qty, c.unit),
          ]),
        ),
      )}
      {sh.packingList?.length
        ? panel(
            'Carton packing list',
            table(
              [
                'Carton',
                'Pallet / label',
                'Net / gross kg',
                'SKU',
                'Colour',
                'Size',
                'Pieces',
                ...(internal ? ['Garment lot'] : []),
              ],
              sh.packingList.flatMap((c) =>
                c.contents.map((r) => [
                  internal ? lotLink(c.cartonId) : h(c.cartonId),
                  valueOf([c.pallet, c.label].filter(Boolean).join(' · ')),
                  h(fmt(c.netKg) + ' / ' + fmt(c.grossKg)),
                  h(r.sku),
                  h(r.colour),
                  h(r.size),
                  showQty(r.qty, 'pcs'),
                  ...(internal ? [lotLink(r.lotId)] : []),
                ]),
              ),
            ),
          )
        : ''}
      {panel(
        'Transport legs',
        table(
          ['From', 'To', 'Mode', 'Carrier', 'Departure / arrival', 'Tracking'],
          sh.legs.map((leg) => [
            h(leg.from),
            h(leg.to),
            h(leg.mode),
            h(leg.carrier),
            h([leg.departure, leg.arrival].filter(Boolean).join(' → ')),
            valueOf(leg.tracking),
          ]),
        ),
      )}
    </>
  );
}
function Equipment({ app }) {
  const s = app.data;
  const machine = (label = 'Machine') => choose(label, 'machineId', s.machines, (m) => m.code + ' · ' + m.name);
  return (
    <>
      {heading(
        'Machines and readings',
        'Record maintenance history and meter activity. Verified readings can be assigned to a run on the same machine and date.',
      )}
      {split(
        editor(
          app,
          'meter',
          'Record a meter reading',
          <>
            {machine()}
            {field('Device receipt / log reference', 'reference')}
            {day('Run date')}
            {optional('Timestamp and offset', 'time')}
            {select('Measured unit', 'unit', ['kWh', 'L', 'kg steam'])}
            {requiredNumber('Activity', 'qty')}
            {text('Allocation method or meter boundary', 'method', '', true)}
          </>,
          'Record reading',
        ),
        editor(
          app,
          'verify-meter',
          'Verify a reading',
          <>
            {choose(
              'Reading',
              'readingId',
              s.readings.filter((r) => !r.verified),
              (r) => r.reference,
            )}
            {field('Calibration or attribution evidence', 'reference')}
          </>,
          'Verify reading',
        ),
        editor(
          app,
          'maintenance',
          'Post maintenance activity',
          <>
            {machine()}
            {select('Type', 'kind', ['Scheduled service', 'Breakdown', 'Repair completed', 'Inspection'])}
            {field('Maintenance reference', 'reference')}
            {day()}
            {day('Next due', 'due', false)}
            {text('Work or findings', 'notes', '', true)}
          </>,
          'Save activity',
        ),
      )}
      {panel(
        'Meter register',
        table(
          ['Reading', 'Machine', 'Device', 'Value', 'Verification', 'Run'],
          s.readings
            .slice()
            .reverse()
            .map((r) => [
              h(r.reference),
              h(ref(s.machines, r.machineId)?.name),
              valueOf(r.device),
              showQty(r.qty, r.unit),
              txStatus(r.verified ? 'Verified' : 'Pending verification'),
              valueOf(r.eventId),
            ]),
        ),
      )}
      {panel(
        'Maintenance history',
        table(
          ['Date', 'Machine', 'Activity', 'Reference', 'Findings', 'Next due'],
          s.maintenance
            .slice()
            .reverse()
            .map((m) => [
              h(m.date),
              h(ref(s.machines, m.machineId)?.name),
              h(m.kind),
              h(m.reference),
              h(m.notes),
              valueOf(m.due),
            ]),
        ),
      )}
    </>
  );
}
export { Equipment };
