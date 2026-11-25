import { joinContent } from './react-ui.jsx';
import { ref, sum } from '../src/model.js';
import { lineRemaining } from '../src/process-batch.js';
import {
  h,
  fmt,
  showQty,
  valueOf,
  heading,
  panel,
  split,
  cards,
  facts,
  table,
  details,
  editor,
  field,
  day,
  text,
  check,
  choose,
  select,
  file,
  hidden,
  numberField,
  lotLink,
  linkButton,
  navLink,
  titles,
  lineLabel,
  txStatus,
} from './ui.jsx';
const paths = {
  Cutting: 'cutting',
  Stitching: 'stitching',
  'Garment finishing': 'garment-finishing',
};
export const garmentBatchHash = (process, id) => paths[process] + '?batch=' + encodeURIComponent(id);
export const garmentBatchLink = (batch, label = batch.number) => (
  <a href={'#' + garmentBatchHash(batch.process, batch.id)}>{h(label)}</a>
);
const optional = (label, name) =>
  field(label, name, {
    required: false,
  });
const num = (label, name, required = true) =>
  numberField(label, name, {
    required,
  });
const revision = (p) => p.code + ' r' + p.version;
const processPlans = (s, process) =>
  s.processSetups.filter((p) => p.process === process && p.status === 'Approved').toReversed();
const workChoice = (s, process) =>
  choose(
    'Released work order',
    'workOrderId',
    s.workOrders.filter((w) => w.stage === process && ['Released', 'In progress'].includes(w.status)),
    titles.wo,
  );
const lineChoice = (s, process) =>
  choose(
    'Approved buyer PO line',
    'lineId',
    s.lines.filter((l) => l.status === 'Approved' && l.stages.includes(process)),
    (line) => lineLabel(s, line),
  );
const batchControls = (b) => (
  <>
    {hidden('batchId', b.id)}
    {day()}
    {field('Posting reference', 'reference')}
  </>
);
const measurements = (l) =>
  [l.metres == null ? '' : fmt(l.metres) + ' m', l.kg == null ? '' : fmt(l.kg) + ' kg'].filter(Boolean).join(' / ');
const poLink = (s, lineId) => {
  const line = ref(s.lines, lineId);
  return line ? linkButton(lineLabel(s, line), 'order', line.orderId) : h(lineId);
};
function batchList(s, process, params) {
  const rows = s.processBatches.filter((b) => b.process === process).toReversed();
  const selection = ref(rows, params.get('batch')) || rows.find((b) => b.status !== 'Closed') || rows[0];
  return {
    selection,
    register: panel(
      process === 'Cutting' ? 'Lay register' : 'Batch register',
      table(
        ['Batch', 'Buyer PO line', 'Factory', 'Plan', 'Status'],
        rows.map((b) => [
          garmentBatchLink(b),
          poLink(s, b.lineId),
          h(b.site),
          h(revision(b.marker || b.plan)),
          txStatus(b.status),
        ]),
      ),
    ),
  };
}
function issuedLots(b) {
  return table(
    ['Source lot', 'Issued', 'Used', 'Returned', 'In process', 'Measured at issue'],
    b.lines.map((r) => [
      lotLink(r.lotId),
      showQty(r.issued, r.unit),
      showQty(r.consumed, r.unit),
      showQty(r.returned, r.unit),
      showQty(lineRemaining(r), r.unit),
      valueOf(measurements(r)),
    ]),
  );
}
function returnEditor(app, b, action) {
  return editor(
    app,
    action,
    'Return unused stock',
    <>
      {batchControls(b)}
      {text('Input lot ID, quantity, optional new remnant ID', 'lines', 'ROLL-01,0.5,REMNANT-01', true)}
      {text('Return notes', 'notes')}
    </>,
    'Post material return',
  );
}
function CuttingPage({ app, params }) {
  const s = app.data;
  const { selection: b, register } = batchList(s, 'Cutting', params);
  const markers = processPlans(s, 'Cutting');
  const summary = b
    ? panel(
        'Lay ' + b.number,
        <>
          {cards([
            ['Planned plies', fmt(b.plannedPlies)],
            ['Actual plies', fmt(sum(b.spreads, (r) => r.plies))],
            ['Numbered panels', fmt(sum(b.outputIds, (id) => ref(s.lots, id)?.initialQty || 0))],
            ['Complete sets cut', fmt(b.actualSets)],
          ])}
          {facts([
            ['Buyer PO / style', poLink(s, b.lineId)],
            ['Fabric component and route', h([b.marker.component, b.marker.routeTemplate].filter(Boolean).join(' · '))],
            ['Marker revision', h(revision(b.marker))],
            ['Colour / size', h(b.marker.colour + ' / ' + b.marker.size)],
            ['Shade group', h(b.shadeGroup)],
            ['Marker length / sets per ply', showQty(b.marker.metres, 'm') + ' / ' + h(b.marker.setsPerPly)],
            ['Panel counts per garment', h(b.marker.parts.map((p) => p.name + ' × ' + p.repeats).join(' · '))],
            ['Status', txStatus(b.status)],
          ])}
          {details('Fabric issue and remaining stock', issuedLots(b), true)}
          {details(
            'Actual spreading and cutting waste',
            table(
              ['Roll', 'Stock used', 'Metres / kg', 'Plies', 'Waste', 'Measurement source'],
              b.spreads.map((r) => [
                lotLink(r.lotId),
                showQty(r.qty, r.unit),
                valueOf(measurements(r)),
                h(r.plies),
                showQty(r.waste, r.unit),
                h(r.conversion),
              ]),
            ),
            true,
          )}
          {details(
            'Numbered bundles and roll allocations',
            table(
              ['Bundle', 'Panel position', 'Numbers', 'Quantity', 'Source rolls'],
              b.outputIds.map((id) => {
                const l = ref(s.lots, id);
                return [
                  lotLink(id),
                  h(l.panel.position),
                  h(l.panel.first + '–' + l.panel.last),
                  showQty(l.initialQty, l.unit),
                  joinContent(
                    l.parents.map((p) => (
                      <>
                        {lotLink(p.id)}
                        {' · '}
                        {showQty(p.panels, 'pcs')}
                      </>
                    )),
                    <br />,
                  ),
                ];
              }),
            ),
            true,
          )}
          {details(
            'Material returns',
            table(
              ['Return reference', 'Date', 'Returned stock'],
              b.postings
                .filter((p) => p.kind === 'Return')
                .map((p) => {
                  const e = ref(s.events, p.eventId);
                  return [h(e.reference), h(e.date), joinContent(e.lotIds.map(lotLink), <br />)];
                }),
            ),
            b.postings.some((p) => p.kind === 'Return'),
          )}
          {b.status === 'Closed'
            ? ''
            : split(
                !b.spreads.length
                  ? editor(
                      app,
                      'cut-spread',
                      'Record actual spread',
                      <>
                        {batchControls(b)}
                        {field('Spreader', 'operator')}
                        {field('Shift', 'shift')}
                        {text(
                          'Roll ID, quantity used in stock unit, plies, optional waste in stock unit',
                          'rolls',
                          'ROLL-01,50,75,0.5',
                          true,
                        )}
                      </>,
                      'Save spread',
                    )
                  : '',
                b.spreads.length && !b.outputIds.length
                  ? editor(
                      app,
                      'cut-bundles',
                      'Cut, number and create bundles',
                      <>
                        {batchControls(b)}
                        {text(
                          'Bundle ID, panel position, first number, last number, source roll counts',
                          'bundles',
                          'BUNDLE-01,Front,1,75,ROLL-01:50+ROLL-02:25',
                          true,
                        )}
                      </>,
                      'Post numbered bundles',
                    )
                  : '',
                returnEditor(app, b, 'cut-return'),
              )}
        </>,
      )
    : '';
  return (
    <>
      {heading(
        'Cutting',
        'Plan each component lay, issue the actual rolls and number cut panels against the buyer PO.',
        navLink('Work orders', 'floor'),
      )}
      {summary}
      {register}
      {split(
        editor(
          app,
          'cut-marker',
          'Approve marker revision',
          <>
            {lineChoice(s, 'Cutting')}
            {field('Tech pack fabric component code', 'component')}
            {choose(
              'Fabric component route',
              'componentRouteId',
              s.componentRoutes.filter((r) => r.status === 'Approved'),
              (r) => r.lineId + ' · ' + r.component + ' · Route ' + r.template,
              {
                required: false,
                blank: 'Use the effective component route',
              },
            )}
            {field('Marker code', 'code')}
            {field('Revision', 'version')}
            {num('Marker length m', 'metres')}
            {num('Garment sets per ply', 'setsPerPly', false)}
            {text('Panel position and count per garment, one row per position', 'panels', 'Front,1\nBack,1')}
            {day('Effective date', 'effective')}
            {field('Approval reference', 'reference')}
            {file('Marker or pattern sheet', 'production')}
          </>,
          'Approve marker',
        ),
        editor(
          app,
          'cut-lay',
          'Plan lay and issue fabric',
          <>
            {workChoice(s, 'Cutting')}
            {choose(
              'Approved marker revision',
              'markerId',
              markers,
              (p) => revision(p) + ' · ' + p.lineId + ' · ' + p.component,
            )}
            {field('Lay number', 'number')}
            {field('Shade group', 'shadeGroup')}
            {num('Planned plies', 'plies')}
            {day('Issue date')}
            {field('Fabric issue slip', 'reference')}
            {choose(
              'Add a released fabric roll',
              'lotPicker',
              s.lots.filter(
                (l) =>
                  ['Inspected fabric', 'Finished fabric'].includes(l.material) &&
                  l.qty > 0 &&
                  l.qualityStatus === 'Released' &&
                  !l.standardHold,
              ),
              titles.lot,
              {
                required: false,
                hook: 'process-input-lot',
              },
            )}
            {text(
              'Roll ID, stock quantity, optional metres, optional kg, shade group, measurement reference',
              'inputs',
              'ROLL-01,65,,,Navy-1',
              true,
            )}
            {text('Lay instructions', 'notes')}
          </>,
          'Post fabric issue',
        ),
      )}
      {details(
        'Approved markers',
        table(
          ['Marker', 'Buyer PO line', 'Component', 'Route', 'Size / colour', 'Approved panel positions'],
          markers.map((p) => [
            h(revision(p)),
            poLink(s, p.lineId),
            h(p.component),
            valueOf(p.routeTemplate),
            h(p.size + ' / ' + p.colour),
            h(p.parts.map((part) => part.name + ' × ' + part.repeats).join(' · ')),
          ]),
        ),
      )}
    </>
  );
}
export { CuttingPage };
function garmentDetail(app, b) {
  const s = app.data;
  const output = b.outputIds.map((id) => ref(s.lots, id)).filter(Boolean);
  const byQuality = (state) =>
    sum(
      output.filter((l) => l.qualityStatus === state),
      (l) => l.initialQty,
    );
  const inspection = (id) => ref(s.events, id);
  return panel(
    'Batch ' + b.number,
    <>
      {cards([
        ['Planned from issued stock', fmt(b.plannedQty) + ' pcs'],
        ['Posted output', fmt(b.completedQty) + ' pcs'],
        ['Pending production', fmt(b.plannedQty - b.completedQty) + ' pcs'],
        ['Released by Quality', fmt(byQuality('Released')) + ' pcs'],
        ['Rework / rejected', fmt(byQuality('Rework')) + ' / ' + fmt(byQuality('Rejected')) + ' pcs'],
        ['Awaiting inspection or on hold', fmt(byQuality('Pending inspection') + byQuality('Hold')) + ' pcs'],
      ])}
      {facts([
        ['Buyer PO line', poLink(s, b.lineId)],
        ['Work order', linkButton(ref(s.workOrders, b.workOrderId)?.number, 'work-order', b.workOrderId)],
        ['Factory line', h(b.floorLine)],
        ['Operation plan revision', h(revision(b.plan))],
        ['Batch status', txStatus(b.status)],
        ['Batch purpose', h(b.rework ? 'Rework' : 'Production')],
      ])}
      {details('Component issues and balances', issuedLots(b), true)}
      {details(
        'Operations, lines and operator records',
        table(
          ['Operation', 'Completed', 'Defect observations', 'Line / shift', 'Operator / machine', 'Reference'],
          b.entries.map((e) => [
            h(e.step + ' · ' + e.operation),
            showQty(e.qty, 'pcs'),
            showQty(e.defects, 'pcs'),
            h(e.floorLine + ' / ' + e.shift),
            h([e.operator, e.machineName].filter(Boolean).join(' · ')),
            h(e.reference),
          ]),
        ),
        true,
      )}
      {details(
        'Line transfers',
        table(
          ['Date', 'Reference', 'Line transfer', 'Reason'],
          b.postings
            .filter((p) => p.kind === 'Line transfer')
            .map((p) => {
              const e = ref(s.events, p.eventId);
              return [h(e.date), h(e.reference), h(e.from + ' → ' + e.to), h(e.reason)];
            }),
        ),
      )}
      {details(
        'Garment lots and Quality decisions',
        table(
          ['Garment lot', 'Output', 'Quality', 'Inspection and earlier decisions', 'Actual inputs'],
          output.map((l) => [
            lotLink(l.id),
            showQty(l.initialQty, l.unit),
            txStatus(l.qualityStatus),
            joinContent(
              [l.inspectionId, ...(l.garmentFinish?.inspectionHistory || [])]
                .filter(Boolean)
                .map(inspection)
                .filter(Boolean)
                .map((e) => h(e.reference + ' · ' + e.decision)),
              <br />,
            ) || '—',
            joinContent(
              l.parents.map((p) => (
                <>
                  {lotLink(p.id)}
                  {' · '}
                  {showQty(p.qty, p.unit)}
                </>
              )),
              <br />,
            ),
          ]),
        ),
        true,
      )}
      {b.status === 'Closed'
        ? ''
        : split(
            editor(
              app,
              'garment-operation',
              'Record actual operation work',
              <>
                {batchControls(b)}
                {select(
                  'Approved operation',
                  'step',
                  b.plan.steps.map((e, i) => [i + 1, i + 1 + ' · ' + e.operation]),
                )}
                {num('Pieces completed', 'qty')}
                {num('Defect observations', 'defects', false)}
                {field('Shift', 'shift')}
                {field('Operator', 'operator')}
                {choose(
                  'Machine',
                  'machineId',
                  s.machines.filter(
                    (m) => m.status === 'In service' && ref(s.locations, m.locationId)?.site === b.site,
                  ),
                  (m) => m.code + ' · ' + m.name,
                  {
                    required: false,
                  },
                )}
                {num('Electricity kWh', 'electricity', false)}
                {num('Water L', 'water', false)}
                {num('Steam kg', 'steam', false)}
                {text('Actual settings or observations', 'settings')}
                {file('Operation record', 'production')}
              </>,
              'Post operation',
            ),
            editor(
              app,
              'garment-output',
              'Create garment lot for Quality',
              <>
                {batchControls(b)}
                {field('New lot ID', 'outputId')}
                {num('Garment pieces', 'qty')}
                {num('Measured net kg', 'netKg', false)}
                {optional('Approved physical composition', 'composition')}
                {text(
                  'Actual component or supply lot ID and quantity in its stock unit',
                  'inputs',
                  'FRONT-BUNDLE-01,60\nRIB-BUNDLE-01,60\nTHREAD-LOT-01,0.1',
                  true,
                )}
                {text('Actual measurement name, unit, value', 'measurements', 'Body length,cm,70')}
              </>,
              'Post for inspection',
            ),
            editor(
              app,
              'garment-line-transfer',
              'Transfer work in progress',
              <>
                {batchControls(b)}
                {field('Receiving line', 'floorLine')}
                {text('Reason', 'notes', '', true)}
              </>,
              'Post transfer',
            ),
            returnEditor(app, b, 'garment-return'),
          )}
    </>,
  );
}
function garmentPage(app, params, process) {
  const s = app.data;
  const stitch = process === 'Stitching';
  const { selection, register } = batchList(s, process, params);
  const plans = processPlans(s, process);
  const ready = s.lots.filter(
    (l) =>
      l.qty > 0 &&
      !l.standardHold &&
      l.custody === 'Own site' &&
      [
        'Cut bundle',
        'Printed bundle',
        'Embroidered bundle',
        'Sewn garment',
        'Finished garment',
        'Released garment',
        'QC-passed garment',
        'Thread',
        'Trim',
        'Chemical',
        'Zip',
        'Button',
        'Label',
        'Interlining',
        'Hangtag',
      ].includes(l.material) &&
      ['Released', 'Rework'].includes(l.qualityStatus),
  );
  return (
    <>
      {heading(
        process,
        stitch
          ? 'Issue actual panels and trims, record line work, and assemble garments for inspection.'
          : 'Record the approved finishing sequence and prepare garment lots for final Quality release.',
        <>
          {navLink('Quality & lab', 'quality')}
          {navLink('Work orders', 'floor')}
        </>,
      )}
      {selection ? garmentDetail(app, selection) : ''}
      {register}
      {split(
        editor(
          app,
          'garment-plan',
          'Approve operation plan',
          <>
            {hidden('process', process)}
            {lineChoice(s, process)}
            {field('Plan code', 'code')}
            {field('Revision', 'version')}
            {day('Effective date', 'effective')}
            {field('Approval reference', 'reference')}
            {text(
              'Operations in order, optional settings after |',
              'steps',
              stitch ? 'Join shoulders\nAttach rib\nClose sides' : 'Thread trimming\nPressing\nMeasurements\nTagging',
              !stitch,
            )}
            {stitch
              ? text(
                  'Component code, panel position, pieces per garment, optional required embellishment',
                  'components',
                  'SHELL,Front,1,Embroidery\nRIB,Collar,1',
                )
              : ''}
            {file('Approved operation sheet', 'production')}
          </>,
          'Approve plan',
        ),
        editor(
          app,
          'garment-issue',
          'Issue stock to a line',
          <>
            {workChoice(s, process)}
            {choose('Approved operation plan', 'planId', plans, (p) => revision(p) + ' · ' + p.lineId)}
            {field('Batch number', 'number')}
            {field('Production line', 'floorLine')}
            {num('Planned garments in pieces', 'plannedQty')}
            {field('Stock issue slip', 'reference')}
            {day('Issue date')}
            {choose('Add a bundle, garment or supply lot', 'lotPicker', ready, titles.lot, {
              required: false,
              hook: 'process-input-lot',
            })}
            {text('Lot ID and quantity in stock unit', 'inputs', 'BUNDLE-01,60\nTHREAD-LOT-01,0.1', true)}
          </>,
          'Post issue',
        ),
      )}
      {details(
        'Approved operation plans',
        table(
          ['Plan', 'Buyer PO line', 'Operations', 'Component requirements'],
          plans.map((p) => [
            h(revision(p)),
            poLink(s, p.lineId),
            h(p.steps.map((e) => e.operation).join(' → ')),
            valueOf(
              p.components
                .map(
                  (c) =>
                    c.component + ' / ' + c.position + ' × ' + c.repeats + (c.decoration ? ' · ' + c.decoration : ''),
                )
                .join(', '),
            ),
          ]),
        ),
      )}
    </>
  );
}
const StitchingPage = ({ app, params }) => garmentPage(app, params, 'Stitching');
export { StitchingPage };
const GarmentFinishingPage = ({ app, params }) => garmentPage(app, params, 'Garment finishing');
export { GarmentFinishingPage };
function PackingPage({ app }) {
  const s = app.data;
  const plans = processPlans(s, 'Packing');
  const shipments = new Map(s.shipments.flatMap((sh) => sh.lotIds.map((id) => [id, sh])));
  const cartons = s.lots.filter((l) => l.packing).toReversed();
  return (
    <>
      {heading(
        'Packing',
        'Build cartons to an approved buyer assortment and track the exact garments through dispatch.',
        navLink('Dispatch & logistics', 'logistics'),
      )}
      {panel(
        'Carton register',
        table(
          ['Carton', 'Pallet / label', 'Pieces / stock', 'Location', 'Net / gross kg', 'Shipment'],
          cartons.map((l) => {
            const sh = shipments.get(l.id);
            return [
              lotLink(l.id),
              h([l.packing.pallet, l.packing.label].filter(Boolean).join(' · ')),
              showQty(l.initialQty, 'pcs') + ' / ' + showQty(l.qty, 'pcs'),
              h(l.location),
              h(fmt(l.netKg) + ' / ' + fmt(l.grossKg)),
              sh ? linkButton(sh.number, 'shipment', sh.id) : '—',
            ];
          }),
        ),
      )}
      {split(
        editor(
          app,
          'packing-plan',
          'Approve buyer packing instructions',
          <>
            {choose(
              'Buyer PO',
              'orderId',
              s.orders.filter((o) => o.kind === 'Goods'),
              titles.order,
            )}
            {field('Instruction code', 'code')}
            {field('Revision', 'version')}
            {day('Effective date', 'effective')}
            {field('Approval reference', 'reference')}
            {text('Approved PO line ID and pieces per carton', 'assortment', 'LINE-00010,150', true)}
            {text('Buyer packing and label instructions', 'instructions', '', true)}
            {check('Buyer allows short cartons', 'shortCarton')}
            {file('Approved packing sheet', 'logistics')}
          </>,
          'Approve packing instructions',
        ),
        editor(
          app,
          'pack-carton',
          'Pack released garments',
          <>
            {workChoice(s, 'Packing')}
            {choose(
              'Approved instruction revision',
              'planId',
              plans,
              (p) => revision(p) + ' · ' + ref(s.orders, p.orderId)?.po,
            )}
            {field('Carton ID', 'cartonId')}
            {field('Carton label reference', 'labelRef')}
            {optional('Pallet ID', 'pallet')}
            {choose(
              'Empty carton stock lot',
              'cartonLotId',
              s.lots.filter((l) => l.material === 'Carton' && l.qty > 0 && l.qualityStatus === 'Released'),
              titles.lot,
            )}
            {choose('Finished goods warehouse', 'locationId', s.locations, titles.location)}
            {num('Measured net weight kg', 'netKg')}
            {num('Measured gross weight kg', 'grossKg')}
            {day('Packing date')}
            {text(
              'Released garment lot ID, approved PO line ID, pieces',
              'contents',
              'GARMENT-01,LINE-00010,150',
              true,
            )}
            {text('Packing supply lot ID, quantity in stock unit', 'supplies', 'POLYBAG-01,150')}
            {file('Packing record', 'logistics')}
          </>,
          'Create carton',
        ),
      )}
      {details(
        'Approved packing instructions',
        table(
          ['Plan', 'Buyer PO', 'Assortment', 'Instructions'],
          plans.map((p) => [
            h(revision(p)),
            valueOf(ref(s.orders, p.orderId)?.po),
            h(p.assortment.map((r) => [r.lineId, r.sku, r.colour, r.size, r.qty + ' pcs'].join(' · ')).join(' / ')),
            h(p.instructions),
          ]),
        ),
      )}
    </>
  );
}
export { PackingPage };
export function garmentTracePanel(s, lot) {
  const p = lot.panel;
  const layout = p ? ref(s.processBatches, p.layId) : null;
  const panelDetails = p
    ? panel(
        'Cut bundle genealogy',
        <>
          {facts([
            ['Buyer PO line', poLink(s, p.lineId)],
            ['Actual lay', layout ? garmentBatchLink(layout) : h(p.layNumber)],
            ['Marker', h(p.marker)],
            ['Component / panel', h(p.component + ' / ' + p.position)],
            ['Colour / size / shade', h([p.colour, p.size, p.shadeGroup].join(' · '))],
            ['Panel numbers in original bundle', h((p.first ?? p.sourceFirst) + '–' + (p.last ?? p.sourceLast))],
            ['Material allocation', h(p.method)],
          ])}
          {lot.stage === 'Cutting'
            ? table(
                ['Contributing roll', 'Panels', 'Allocated fabric'],
                lot.parents.map((r) => [lotLink(r.id), showQty(r.panels, 'pcs'), showQty(r.qty, r.unit)]),
              )
            : ''}
        </>,
      )
    : '';
  const garment = lot.assembly || lot.garmentFinish;
  const b = garment ? ref(s.processBatches, lot.batchId) : null;
  const garmentDetails = b
    ? panel(
        lot.assembly ? 'Assembly record' : 'Garment finishing record',
        <>
          {facts([
            ['Actual batch', garmentBatchLink(b)],
            ['Operation plan', h(revision(b.plan))],
            [
              'Earlier inspection decisions',
              valueOf(
                garment.inspectionHistory
                  .map((id) => {
                    const e = ref(s.events, id);
                    return e ? e.reference + ' · ' + e.decision : id;
                  })
                  .join(' / '),
              ),
            ],
          ])}
          {table(
            ['Actual input', 'Component / use', 'Quantity'],
            lot.parents.map((r) => [
              lotLink(r.id),
              h([r.component, r.position].filter(Boolean).join(' / ') || r.role),
              showQty(r.qty, r.unit),
            ]),
          )}
          {garment.measurements?.length
            ? table(
                ['Measurement', 'Result'],
                garment.measurements.map((m) => [h(m.name), showQty(m.value, m.unit)]),
              )
            : ''}
        </>,
      )
    : '';
  const c = lot.packing;
  return (
    <>
      {panelDetails}
      {garmentDetails}
      {c
        ? panel(
            'Carton contents',
            <>
              {facts([
                ['Carton label / pallet', h([c.label, c.pallet].filter(Boolean).join(' · '))],
                ['Net / gross weight', showQty(c.netKg, 'kg') + ' / ' + showQty(c.grossKg, 'kg')],
                ['Warehouse', h(lot.location)],
              ])}
              {table(
                ['Garment lot', 'Buyer PO line', 'SKU', 'Colour', 'Size', 'Pieces'],
                c.contents.map((r) => [
                  lotLink(r.lotId),
                  poLink(s, r.lineId),
                  h(r.sku),
                  h(r.colour),
                  h(r.size),
                  showQty(r.qty, 'pcs'),
                ]),
              )}
            </>,
          )
        : ''}
    </>
  );
}
