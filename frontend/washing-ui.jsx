import { joinContent, setContents } from './react-ui.jsx';
import { STAGES, WASH_STAGES, ref } from '../src/model.mjs';
import { lineRemaining, lineRemainingKg } from '../src/process-batch.mjs';
import {
  h,
  can,
  fmt,
  money,
  valueOf,
  showQty,
  txStatus,
  heading,
  panel,
  split,
  cards,
  facts,
  table,
  details,
  note,
  editor,
  choose,
  select,
  field,
  day,
  text,
  check,
  file,
  hidden,
  numberField,
  option,
  lotLink,
  washLink,
  linkButton,
  docs,
  navLink,
  titles,
} from './ui.jsx';
const optional = (label, name) =>
  field(label, name, {
    required: false,
  });
const num = (label, name, required = false) =>
  numberField(label, name, {
    required,
  });
const qtyAndKg = (qty, unit, kg) =>
  fmt(qty) + ' ' + unit + (unit === 'kg' && qty === kg ? '' : ' · ' + fmt(kg) + ' kg');
const recipeTitle = (row) => row.code + ' r' + row.version + ' · ' + row.washType;
const recipes = (s) => s.processSetups.filter((row) => row.process === 'Washing' && row.status === 'Approved');
const bucket = (b) => (b.jobId ? 'logistics' : 'production');
const withUnits = (n, unit) => (n == null ? '—' : showQty(n, unit));
export function selectWashWork(form, s) {
  const wo = ref(s.workOrders, form.elements.workOrderId.value);
  const fill = (name, rows) => {
    const select = form.elements[name];
    const value = select.value;
    setContents(
      select,
      <>
        {option('', 'Select…')}
        {joinContent(
          rows.map(([id, label]) => option(id, label, value)),
          '',
        )}
      </>,
    );
  };
  fill(
    'recipeId',
    recipes(s)
      .filter((row) => row.stage === wo?.stage)
      .map((row) => [row.id, recipeTitle(row)]),
  );
  fill(
    'lotPicker',
    wo
      ? s.lots
          .filter(
            (lot) =>
              lot.qty > 0 &&
              !lot.standardHold &&
              lot.custody === 'Own site' &&
              lot.site === wo.site &&
              lot.unit === wo.unit &&
              STAGES[wo.stage].primary.includes(lot.material) &&
              lot.qualityStatus === (wo.rework ? 'Rework' : 'Released'),
          )
          .map((lot) => [lot.id, titles.lot(lot)])
      : [],
  );
  if (form.elements.machineId)
    fill(
      'machineId',
      s.machines
        .filter((m) => m.status === 'In service' && ref(s.locations, m.locationId)?.site === wo?.site)
        .map((m) => [m.id, m.code + ' · ' + m.name]),
    );
}
function loadEditor(app, mode, work) {
  const s = app.data;
  const outside = mode === 'Commission';
  return editor(
    app,
    'wash-load',
    outside ? 'Send commission wash' : 'Load in-house machine',
    <>
      {hidden('mode', mode)}
      {choose('Released washing work order', 'workOrderId', work, (wo) => titles.wo(wo) + ' · ' + wo.unit, {
        hook: 'wash-work',
      })}
      {select('Approved recipe', 'recipeId', [])}
      {field('Wash batch number', 'number')}
      {day('Issue date')}
      {outside ? (
        <>
          {choose(
            'Processor',
            'processorId',
            s.parties.filter((p) => p.type === 'Processor'),
            titles.party,
          )}
          {field('Actual processor facility', 'site')}
          {field('Outward challan', 'challan')}
          {optional('Carrier / vehicle', 'carrier')}
          {optional('Transit reference', 'transitRef')}
        </>
      ) : (
        select('Washing machine at work order site', 'machineId', [])
      )}
      {num('Machine load limit (kg)', 'maxKg')}
      {optional('Issue weighing slip', 'weighRef')}
      {select('Add input lot', 'lotPicker', [], {
        required: false,
        hook: 'process-input-lot',
      })}
      {text(
        'Input lines in stock units · lot ID, quantity, optional weighed kg',
        'inputs',
        'SEWN-LOT-01,60,14.4\nSEWN-LOT-02,40,9.6',
        true,
      )}
      {text('Issue notes', 'notes')}
      {file(outside ? 'Outward challan document' : 'Load sheet', outside ? 'logistics' : 'production')}
    </>,
    outside ? 'Post outward challan' : 'Issue to washing',
  );
}
function cycleEditor(app, b) {
  return editor(
    app,
    'wash-cycle',
    'Record actual machine cycle',
    <>
      {hidden('batchId', b.id)}
      {field('Cycle record reference', 'reference')}
      {day('Cycle date')}
      {b.jobId ? field('Processor machine ID or name', 'machine') : ''}
      {numberField('Actual cycle duration (min)', 'minutes', {
        value: b.recipe.minutes,
      })}
      {numberField('Actual temperature (°C)', 'temperatureC', {
        required: false,
        value: b.recipe.temperatureC ?? '',
      })}
      {numberField('Actual machine load (kg)', 'loadKg', {
        value: b.remainingKg,
      })}
      {num('Water (L)', 'water')}
      {num('Steam (kg)', 'steam')}
      {num('Electricity (kWh)', 'electricity')}
      {b.jobId
        ? text(
            'Reported chemicals · item code, processor lot, quantity in item unit',
            'chemicals',
            'WASH-DETERGENT,DET-26-011,0.45',
          )
        : text('Issued chemicals · stock lot ID, quantity in lot unit', 'chemicals', 'DET-LOT-01,0.45')}
      {check('No chemicals used', 'noChemicals')}
      {text('Cycle readings and observations', 'notes')}
      {file('Cycle or processor report', bucket(b))}
    </>,
    'Post actual cycle',
    '',
    true,
  );
}
function returnEditor(app, b, unused = false) {
  const returning = b.jobId ? 'processor return' : 'output';
  const dispositions = joinContent(
    [
      ['Usable', 'usable'],
      ['Re-wash', 'rewash'],
      ['Rejected', 'rejected'],
    ].map(([label, name]) => (
      <>
        {optional(label + ' lot ID', name + 'Id')}
        {num(label + ' (' + b.unit + ')', name + 'Qty')}
        {!['kg', 'g'].includes(b.unit) ? num(label + ' measured kg', name + 'Kg') : ''}
      </>
    )),
    '',
  );
  return editor(
    app,
    'wash-output',
    unused ? 'Return unused material' : 'Post actual ' + returning,
    <>
      {hidden('batchId', b.id)}
      {unused ? hidden('unused', 'yes') : ''}
      {select(
        'Original input lot',
        'lotId',
        b.lines
          .filter((row) => lineRemaining(row) > 0)
          .map((row) => [
            row.lotId,
            row.lotId + ' · ' + qtyAndKg(lineRemaining(row), b.unit, lineRemainingKg(row)) + ' open',
          ]),
      )}
      {num('Quantity reconciled (' + b.unit + ')', 'used', true)}
      {field(b.jobId ? 'Inward challan / return reference' : 'Output reference', 'reference')}
      {day()}
      {choose(
        'Receiving location',
        'locationId',
        app.data.locations.filter((loc) => loc.site === ref(app.data.workOrders, b.workOrderId)?.site),
        titles.location,
        {
          required: false,
          blank: 'Use work order location',
        },
      )}
      {unused ? (
        field('Returned lot ID', 'usableId')
      ) : (
        <>
          {dispositions}
          {num('Process loss (' + b.unit + ')', 'loss')}
          {num('Weighed portion before wash (kg)', 'beforeKg')}
          {text(
            'Measurements · name, unit, before, after',
            'measurements',
            'Body length,cm,70,68.6\nChest width,cm,54,53.5',
          )}
        </>
      )}
      {text('Disposition, loss or measurement notes', 'notes')}
      {file('Return or measurement report', bucket(b))}
    </>,
    unused ? 'Receive unused material' : 'Post actual ' + returning,
    unused ? '' : 'For rejected pieces, re-wash, process loss or a measured stock-unit variance, record the reason.',
    !unused,
  );
}
function outputRows(app, b) {
  const s = app.data;
  return b.postings
    .filter((p) => ['Output', 'Unused return'].includes(p.kind))
    .map((p) => {
      const e = ref(s.events, p.eventId);
      const lots = e.lotIds.map((id) => ref(s.lots, id)).filter(Boolean);
      return [
        <>
          {h(e.reference)}
          <br />
          <small>{h(e.date)}</small>
        </>,
        <>
          {lotLink(e.inputs[0].id)}
          {' · '}
          {showQty(e.inputs[0].qty, e.unit)}
        </>,
        joinContent(
          lots.map((lot) => (
            <>
              {lotLink(lot.id)}
              {' · '}
              {showQty(lot.initialQty, lot.unit)}
              {' · '}
              {txStatus(lot.standardHold ? 'Hold' : lot.qualityStatus)}
            </>
          )),
          <br />,
        ),
        showQty(e.reconciliation.waste, e.unit),
        <>
          {h(fmt(e.wash.beforeKg) + ' → ' + fmt(e.wash.afterKg) + ' kg')}
          <br />
          <small>{h(e.wash.beforeMeasured ? 'Measured before wash' : 'Issued weight basis')}</small>
        </>,
        joinContent(
          e.wash.measurements.map((m) =>
            h(
              m.name +
                ' · ' +
                fmt(m.before) +
                ' → ' +
                fmt(m.after) +
                ' ' +
                m.unit +
                (m.changePct == null ? '' : ' (' + fmt(m.changePct) + '%)'),
            ),
          ),
          <br />,
        ) || '—',
        valueOf(e.note),
      ];
    });
}
function serviceCosts(app, b) {
  if (!b.jobId || !['Admin', 'Finance'].includes(app.user.role)) return '';
  const s = app.data;
  const charges = s.costs.filter((c) => c.washBatchId === b.id);
  const returned = s.lots.filter((lot) => lot.washBatchId === b.id && lot.wash?.disposition !== 'unused');
  return panel(
    'Commission service costs',
    <>
      {table(
        ['Vendor bill', 'Processor', 'Return lot', 'Payable', 'Inventory cost', 'Voucher'],
        charges.map((c) => [
          h(c.reference),
          h(c.supplier),
          lotLink(c.lot),
          h(money(c.payable, c.currency)),
          h(money(c.landed)),
          valueOf(s.vouchers.find((v) => v.source?.id === c.id)?.number),
        ]),
        'No service charge posted for this batch.',
      )}
      {can(app, 'cost') && returned.length ? (
        <p>
          {joinContent(
            returned.map((lot) => (
              <a className="button secondary" href={'#invoices?washLot=' + encodeURIComponent(lot.id)}>
                {'Add charge to '}
                {h(lot.id)}
              </a>
            )),
            ' ',
          )}
        </p>
      ) : (
        ''
      )}
    </>,
  );
}
function batchDetail(app, b) {
  const s = app.data;
  const wo = ref(s.workOrders, b.workOrderId);
  const line = ref(s.lines, b.lineId);
  const order = ref(s.orders, line?.orderId);
  const issued = b.postings.find((p) => p.kind === 'Issue');
  const cycles = b.cycle;
  return (
    <>
      {panel(
        'Wash batch ' + b.number,
        <>
          {cards([
            [b.jobId ? 'Sent on challan' : 'Issued to wash', qtyAndKg(b.issuedQty, b.unit, b.issuedKg)],
            [b.jobId ? 'Washed stock received' : 'Washed output posted', qtyAndKg(b.returnedQty, b.unit, b.returnedKg)],
            [
              b.jobId ? 'Remaining at processor' : 'Remaining in wash WIP',
              qtyAndKg(b.remainingQty, b.unit, b.remainingKg),
            ],
            ['Usable output', fmt(b.usableQty) + ' ' + b.unit],
          ])}
          {facts([
            ['Operation', h(b.stage + (b.rework ? ' · Re-wash' : ''))],
            ['Status', txStatus(ref(s.jobs, b.jobId)?.status || b.status)],
            [
              'PO line / approved revision',
              order ? (
                <a
                  href={
                    '#po-flow?company=' +
                    encodeURIComponent(app.user.companyId) +
                    '&order=' +
                    encodeURIComponent(order.id) +
                    '&line=' +
                    encodeURIComponent(line.id)
                  }>
                  {h(order.po + ' · line ' + line.lineNo + ' / r' + b.lineRevision)}
                </a>
              ) : (
                '—'
              ),
            ],
            ['Work order', linkButton(wo?.number || b.workOrderId, 'work-order', b.workOrderId)],
            ['Wash recipe', h(recipeTitle(b.recipe))],
            ['Factory / mode', h([b.processor, b.site, b.mode].filter(Boolean).join(' · '))],
            ['Outward challan', valueOf(b.challan)],
            ['Issue document', docs(ref(s.events, issued?.eventId)?.document)],
            [
              'Re-wash / rejected / process loss',
              showQty(b.rewashQty, b.unit) +
                ' / ' +
                showQty(b.rejectedQty, b.unit) +
                ' / ' +
                showQty(b.lossQty, b.unit),
            ],
            ['Unused returns', h(qtyAndKg(b.unusedQty, b.unit, b.unusedKg))],
          ])}
          {b.remainingQty ? note('Remaining kg uses the issued weight for each outstanding stock quantity.') : ''}
          {details(
            'Approved recipe instructions',
            facts([
              [
                'Recipe target',
                h(fmt(b.recipe.minutes) + ' min') +
                  (b.recipe.temperatureC == null ? '' : ' · ' + showQty(b.recipe.temperatureC, '°C')),
              ],
              ['Approval reference', h(b.recipe.reference)],
              ['Method', joinContent(b.recipe.method.split('\n'), <br />)],
            ]),
          )}
        </>,
      )}
      {panel(
        'Input lots and custody',
        table(
          ['Original lot', 'Issued quantity / kg', 'Remaining quantity / kg', 'Weight basis'],
          b.lines.map((row) => [
            lotLink(row.lotId),
            h(qtyAndKg(row.issued, b.unit, row.issuedKg)),
            h(qtyAndKg(lineRemaining(row), b.unit, lineRemainingKg(row))),
            h([row.basis, row.basisRef].filter(Boolean).join(' · ')),
          ]),
        ),
      )}
      {cycles
        ? panel(
            'Actual machine cycle',
            <>
              {facts([
                ['Cycle / date', h(cycles.reference + ' · ' + cycles.date)],
                ['Machine', h(cycles.machineName)],
                ['Load', showQty(cycles.loadKg, 'kg')],
                [
                  'Duration / temperature',
                  showQty(cycles.minutes, 'min') + ' / ' + withUnits(cycles.temperatureC, '°C'),
                ],
                ['Water', withUnits(cycles.resources.water, 'L')],
                ['Steam', withUnits(cycles.resources.steam, 'kg')],
                ['Electricity', withUnits(cycles.resources.electricity, 'kWh')],
                ['Cycle report', docs(ref(s.events, cycles.eventId)?.document)],
              ])}
              {cycles.notes ? note(cycles.notes) : ''}
              {table(
                ['Chemical item', 'Chemical lot', 'Actual quantity'],
                cycles.chemicals.map((row) => [
                  h(row.code),
                  row.lotId ? lotLink(row.lotId) : h(row.lotRef),
                  showQty(row.qty, row.unit),
                ]),
                'Cycle recorded without chemicals.',
              )}
            </>,
          )
        : b.remainingQty
          ? cycleEditor(app, b)
          : ''}
      {b.remainingQty ? returnEditor(app, b, !cycles) : ''}
      {panel(
        'Actual returns and measurements',
        table(
          [
            'Receipt / date',
            'Original input reconciled',
            'Returned lots / status',
            'Loss',
            'Before / after weight',
            'Measurements',
            'Notes',
          ],
          outputRows(app, b),
          'No outputs received yet.',
        ),
      )}
      {serviceCosts(app, b)}
    </>
  );
}
function WashingPage({ app }) {
  const s = app.data;
  const list = s.processBatches
    .filter((b) => b.process === 'Washing')
    .slice()
    .reverse();
  const batchId = new URLSearchParams(window.location.hash.split('?')[1] || '').get('batch');
  const selected = ref(list, batchId) || list[0];
  const work = s.workOrders.filter(
    (wo) => WASH_STAGES.includes(wo.stage) && wo.lineId && ['Released', 'In progress'].includes(wo.status),
  );
  return (
    <>
      {heading(
        'Washing',
        'Run approved yarn, fabric, cut bundle and garment washes. Track machine loads, actual outputs and processor custody.',
        navLink('Work orders', 'floor'),
      )}
      {selected ? batchDetail(app, selected) : ''}
      {panel(
        'Wash batch register',
        table(
          ['Batch', 'Operation', 'Factory / mode', 'Outward challan', 'Issued', 'Remaining', 'Status'],
          list.map((b) => [
            washLink(b.id, b.number),
            h(b.stage),
            h([b.processor, b.site, b.mode].filter(Boolean).join(' · ')),
            valueOf(b.challan),
            h(qtyAndKg(b.issuedQty, b.unit, b.issuedKg)),
            h(qtyAndKg(b.remainingQty, b.unit, b.remainingKg)),
            txStatus(ref(s.jobs, b.jobId)?.status || b.status),
          ]),
        ),
      )}
      {can(app, 'wash-load') && !work.length
        ? note('Release a work order for a washing step on the approved PO route to load a batch.')
        : ''}
      {split(loadEditor(app, 'In-house', work), loadEditor(app, 'Commission', work))}
      {editor(
        app,
        'wash-recipe',
        'Approve wash recipe revision',
        <>
          {select('Washing operation', 'stage', WASH_STAGES)}
          {field('Recipe code', 'code')}
          {field('Revision', 'version')}
          {field('Washing type', 'washType')}
          {num('Target cycle minutes', 'minutes', true)}
          {num('Target temperature (°C)', 'temperatureC')}
          {day('Effective date', 'effective')}
          {field('Approval reference', 'reference')}
          {text('Recipe steps, chemical targets and operating settings', 'method', '', true)}
        </>,
        'Approve recipe',
      )}
      {details(
        'Approved wash recipes',
        table(
          ['Recipe', 'Operation', 'Effective', 'Approval'],
          recipes(s).map((row) => [h(recipeTitle(row)), h(row.stage), h(row.effective), h(row.reference)]),
        ),
      )}
    </>
  );
}
export { WashingPage };
