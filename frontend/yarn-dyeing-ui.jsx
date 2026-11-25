import { joinContent } from './react-ui.jsx';
import { ref, genealogy, today } from '../src/model.js';
import { schemeNames } from '../src/standards.js';
import { schemesOf } from '../src/commerce.js';
import { FABRIC_ROUTE_TEMPLATES, CONDITIONAL_OPERATIONS, lineComponents, stageLabel } from '../src/routes.js';
import {
  colourShade,
  PROCESS,
  DYE_STEPS,
  PRETREATMENTS,
  RATE_KEYS,
  batchSummary,
  wipKg,
  batchSteps,
} from '../src/yarn-dyeing.js';
import { YARN_ROLES } from '../src/yarn-allocation.js';
import {
  stockHint,
  batchDetail,
  lotHistory,
  optional,
  optionalNumber,
  requiredNumber,
  now,
  stamp,
  params,
  reverseInput,
} from './process-ui.jsx';
export { lotHistory, reverseInput };
import {
  h,
  fmt,
  badge,
  txStatus,
  valueOf,
  showQty,
  heading,
  panel,
  split,
  note,
  details,
  table,
  select,
  choose,
  field,
  numberField,
  day,
  text,
  check,
  file,
  hidden,
  form,
  editor,
  facts,
  cards,
  titles,
  lineLabel,
  lotLink,
  linkButton,
} from './ui.jsx';
const tabs = [
  ['setup', 'Setup'],
  ['work', 'Work order'],
  ['issue', 'Material issue'],
  ['entry', 'Process entry'],
  ['output', 'Output and return'],
  ['commission', 'Commission and custody'],
  ['allocate', 'Knitting, warp and weft'],
  ['history', 'Lot history'],
];
const dyeWork = (s) => s.workOrders.filter((w) => w.stage === PROCESS);
const openBatches = (s) =>
  s.processBatches.filter((b) => b.process === PROCESS && ['Open', 'In process'].includes(b.status));
const batchTitle = (b) =>
  b.number +
  ' · ' +
  colourShade(b.recipe) +
  (b.commission ? ' · for ' + b.customer : '') +
  ' · WIP ' +
  fmt(wipKg(b)) +
  ' kg';
const batchChoice = (s, selected, label = 'Dye batch') =>
  choose(label, 'batchId', openBatches(s), batchTitle, {
    initial: selected,
  });
const yarnLots = (s) => s.lots.filter((l) => l.qty > 0 && l.material === 'Yarn' && l.custody === 'Own site');
const chemicalLots = (s) => s.lots.filter((l) => l.qty > 0 && l.material === 'Chemical' && l.custody === 'Own site');
function tabBar(selected) {
  return (
    <nav className="actions" aria-label="Yarn dyeing screens">
      {joinContent(
        tabs.map(([key, label]) => (
          <a
            className={'button ' + (key === selected ? '' : 'secondary')}
            href={'#yarn-dyeing?tab=' + key}
            aria-current={key === selected ? 'page' : undefined}>
            {h(label)}
          </a>
        )),
        '',
      )}
    </nav>
  );
}
function setup(app) {
  const s = app.data;
  const approvedLines = s.lines.filter((l) => l.status === 'Approved');
  const componentOptions = approvedLines.flatMap((l) =>
    lineComponents(l).map((c) => [
      l.id + '|' + c.code,
      lineLabel(s, l) + ' · ' + c.code + (c.type ? ' (' + c.type + ')' : '') + ' · ' + c.source,
    ]),
  );
  const recipes = s.processSetups.filter((r) => r.process === PROCESS);
  return (
    <>
      {split(
        editor(
          app,
          'component-route',
          'Approve a fabric route for a BOM component',
          <>
            {select('PO line and BOM component', 'lineComponent', componentOptions)}
            {select(
              'Route template',
              'template',
              Object.entries(FABRIC_ROUTE_TEMPLATES).map(([k, t]) => [k, t.name]),
            )}
            {text(
              'Conditional operations, comma separated',
              'conditional',
              Object.entries(CONDITIONAL_OPERATIONS)
                .map(([k, r]) => k + ' (' + r.note + ')')
                .join('; '),
            )}
            {day('Effective date', 'effective')}
            {field('Approval reference', 'reference')}
          </>,
          'Approve route',
          'Only listed conditional operations become part of the route. A new approval supersedes the previous route for that component; released work orders keep their pinned route.',
          !s.componentRoutes.length,
        ),
        editor(
          app,
          'dye-setup',
          'Approve a dye recipe and cost rates',
          <>
            {field('Recipe code', 'code')}
            {field('Recipe revision', 'version', {
              value: '1',
            })}
            {optional('Colour', 'colour')}
            {field('Shade', 'shade')}
            {day('Effective date', 'effective')}
            {choose(
              'Revises (supersedes) recipe',
              'revises',
              recipes.filter((r) => r.status === 'Approved'),
              (r) => r.code + ' r' + r.version + ' · ' + r.shade,
              {
                required: false,
                blank: 'New recipe',
              },
            )}
            {optional('Reason for the revision', 'revisionReason')}
            {select('Pretreatment', 'pretreatment', PRETREATMENTS, {
              initial: 'Scouring',
            })}
            {optional('Pretreatment specification (bath, temperature, time)', 'pretreatmentSpec')}
            {check('Rewind onto final cones after drying', 'rewind')}
            {optionalNumber('Liquor ratio (1 : n)', 'liquorRatio')}
            {text(
              'Chemicals, item code and dose per kg yarn in the item unit',
              'chemicals',
              'RDYE-01,0.02\nSALT-01,0.6',
            )}
            {optionalNumber('Planned water L per kg', 'waterPerKg')}
            {optionalNumber('Planned steam kg per kg', 'steamPerKg')}
            {optionalNumber('Planned electricity kWh per kg', 'electricityPerKg')}
            {optionalNumber('Planned yield %', 'yieldPct', '100', 1)}
            {joinContent(
              Object.entries(RATE_KEYS).map(([k, label]) => optionalNumber(label, k + 'Rate')),
              '',
            )}
            {optional('Approved rate card reference', 'rateRef')}
            {field('Recipe approval or lab dip reference', 'reference')}
          </>,
          'Approve recipe',
          'The recipe fixes the required steps: package winding, the specified pretreatment, dyeing, washing, drying and rewinding. A revision supersedes the earlier revision for new batches; open batches keep theirs. Rates value internal absorption and carry no GST.',
          !recipes.length,
        ),
      )}
      {panel(
        'Approved component routes',
        table(
          ['Route', 'PO line / component', 'Operations', 'BOM / line revision', 'Approval', 'Status'],
          s.componentRoutes
            .slice()
            .reverse()
            .map((r) => [
              h(r.id + ' · ' + r.template + ' r' + r.version),
              <>
                {h(r.lineId + ' · ' + r.component)}
                <br />
                <small>{h(r.componentSource)}</small>
              </>,
              h(r.stages.map(stageLabel).join(' → ')),
              h(r.bomRev + ' / ' + r.lineRevision),
              h(r.reference + ' · ' + r.effective),
              txStatus(r.status),
            ]),
          'No component routes approved yet. Existing PO line routes continue to apply.',
        ),
      )}
      {panel(
        'Dye recipes and rate cards',
        table(
          ['Recipe', 'Colour / shade and steps', 'Dose per kg', 'Utilities per kg', 'Rates', 'Approval'],
          recipes
            .slice()
            .reverse()
            .map((r) => [
              <>
                {h(r.code + ' r' + r.version)}
                <br />
                {txStatus(r.status)}
                {r.revises ? (
                  <>
                    <br />
                    <small>
                      {h(
                        'Revises ' +
                          (ref(s.processSetups, r.revises)?.version
                            ? 'r' + ref(s.processSetups, r.revises).version
                            : r.revises) +
                          ': ' +
                          r.revisionReason,
                      )}
                    </small>
                  </>
                ) : (
                  ''
                )}
              </>,
              <>
                {h([r.colour, r.shade].filter(Boolean).join(' · '))}
                <br />
                <small>
                  {h(
                    r.requiredSteps?.length
                      ? r.requiredSteps.join(' → ') +
                          (r.pretreatmentSpec ? ' · ' + r.pretreatment + ': ' + r.pretreatmentSpec : '')
                      : 'No step control (approved before step control)',
                  )}
                </small>
              </>,
              h(r.chemicals.map((c) => c.code + ' ' + fmt(c.per) + ' ' + c.unit).join(', ') || '—'),
              h(
                [
                  '1:' + fmt(r.liquorRatio),
                  fmt(r.waterPerKg) + ' L',
                  fmt(r.steamPerKg) + ' kg steam',
                  fmt(r.electricityPerKg) + ' kWh',
                  'yield ' + fmt(r.yieldPct) + '%',
                ].join(' · '),
              ),
              <>
                {h(
                  Object.entries(r.rates)
                    .filter(([, v]) => v)
                    .map(([k, v]) => k + ' ' + fmt(v))
                    .join(' · ') || '—',
                )}
                <br />
                <small>{h(r.rateRef)}</small>
              </>,
              h(r.reference + ' · ' + r.effective),
            ]),
        ),
      )}
    </>
  );
}
function work(app) {
  const s = app.data;
  const routes = s.componentRoutes.filter((r) => r.status === 'Approved' && r.stages.includes(PROCESS));
  const openWork = dyeWork(s).filter((w) => ['Released', 'In progress'].includes(w.status));
  return (
    <>
      {split(
        editor(
          app,
          'work-order',
          'Release yarn dyeing work order',
          <>
            {hidden('stage', PROCESS)}
            {field('Work order number', 'number')}
            {choose(
              'Approved component route',
              'componentRouteId',
              routes,
              (r) => r.id + ' · ' + r.lineId + ' · ' + r.component + ' · route ' + r.template,
              {
                required: false,
                blank: 'Stock or commission job without route',
              },
            )}
            {choose(
              'Buyer PO line (required with a route)',
              'lineId',
              s.lines.filter((l) => l.status === 'Approved'),
              (l) => lineLabel(s, l),
              {
                required: false,
                blank: 'Stock job',
              },
            )}
            {choose('Output location', 'locationId', s.locations, titles.location)}
            {requiredNumber('Planned dyed yarn', 'plannedQty')}
            {select('Planned unit', 'unit', ['kg', 'cone'], {
              initial: 'kg',
            })}
            {select('Standard for stock jobs', 'scheme', schemeNames(s), {
              initial: 'Conventional',
            })}
            {day('Release date')}
            {day('Due date', 'due', false)}
            {optional('Recipe reference', 'recipe')}
            {check('Re-dye of lots held for rework', 'rework')}
            {text('Work instructions', 'notes')}
            {file('Job sheet', 'production')}
          </>,
          'Release work order',
          'The work order pins the approved route, its BOM revision and the PO line revision. A PO line standard overrides the stock-job standard.',
          !openWork.length,
        ),
        editor(
          app,
          'dye-batch',
          'Open a dye batch on a work order',
          <>
            {choose('Yarn dyeing work order', 'workOrderId', openWork, titles.wo)}
            {field('Batch number', 'number')}
            {choose(
              'Dyeing machine',
              'machineId',
              s.machines.filter((m) => m.status === 'In service'),
              (m) => m.code + ' · ' + m.name,
            )}
            {choose(
              'Approved recipe',
              'recipeId',
              s.processSetups.filter((r) => r.process === PROCESS && r.status === 'Approved'),
              (r) => r.code + ' r' + r.version + ' · ' + r.shade,
            )}
            {choose(
              'Commission customer (owner of the yarn)',
              'customerId',
              s.parties.filter((p) => p.type === 'Buyer'),
              titles.party,
              {
                required: false,
                blank: 'Own material',
              },
            )}
            {optional('Customer job order or challan', 'commissionRef')}
            {requiredNumber('Planned batch kg', 'plannedKg')}
            {day('Batch date')}
            {text('Notes', 'notes')}
          </>,
          'Open batch',
          "A commission batch accepts only that customer's yarn, and its dyed lots stay in the customer's ownership. An own-material batch rejects customer yarn.",
          openWork.length > 0,
        ),
      )}
      {panel(
        'Yarn dyeing work orders',
        table(
          ['Job sheet', 'Route / component', 'Plan / accepted', 'Batches', 'Site', 'Status'],
          dyeWork(s)
            .slice()
            .reverse()
            .map((w) => [
              linkButton(w.number, 'work-order', w.id),
              h(
                w.componentRoute
                  ? 'Route ' +
                      w.componentRoute.template +
                      ' r' +
                      w.componentRoute.version +
                      ' · ' +
                      w.componentRoute.component +
                      ' · BOM ' +
                      w.componentRoute.bomRev
                  : w.route || 'Stock job',
              ),
              showQty(w.plannedQty, w.unit) + ' / ' + showQty(w.completedQty, w.unit),
              h(
                s.processBatches
                  .filter((b) => b.workOrderId === w.id)
                  .map((b) => b.number)
                  .join(', ') || '—',
              ),
              h(w.site),
              txStatus(w.status),
            ]),
        ),
      )}
      {panel(
        'Dye batches',
        table(
          ['Batch', 'Recipe', 'Owner', 'Planned / issued', 'WIP', 'Accepted', 'Status'],
          s.processBatches
            .filter((b) => b.process === PROCESS)
            .slice()
            .reverse()
            .map((b) => {
              const sum = batchSummary(s, b);
              return [
                <a href={'#yarn-dyeing?tab=history&batch=' + encodeURIComponent(b.id)}>{h(b.number)}</a>,
                h(b.recipe.code + ' r' + b.recipe.version + ' · ' + colourShade(b.recipe)),
                h(b.commission ? b.customer + ' (commission · ' + b.commissionRef + ')' : s.settings.name),
                h(fmt(b.plannedKg) + ' / ' + fmt(sum.issuedKg) + ' kg'),
                h(fmt(sum.wipKg) + ' kg'),
                h(fmt(sum.acceptedKg) + ' kg'),
                txStatus(b.status),
              ];
            }),
        ),
      )}
    </>
  );
}
function issue(app, selected) {
  const s = app.data;
  return (
    <>
      {split(
        editor(
          app,
          'dye-issue',
          'Issue yarn to a batch',
          <>
            {batchChoice(s, selected)}
            {text(
              'Issued lots: lot ID, quantity in stock unit, and measured kg when the lot has no kg basis',
              'lines',
              'YRN-C-01,40\nYRN-C-02,20,24.8',
              true,
            )}
            {optional('Weighing slip for measured kg', 'conversionRef')}
            {day('Issue date')}
            {field('Issue slip reference', 'reference')}
            {file('Issue slip', 'production')}
          </>,
          'Post issue',
          'Stock moves from the store into batch work in progress. Owner, standard claim, route step and lot availability are checked before posting.',
          openBatches(s).length > 0,
        ),
        editor(
          app,
          'dye-return',
          'Return unused yarn from a batch',
          <>
            {batchChoice(s, selected)}
            {text('Returned lots: lot ID and unused quantity in stock unit', 'lines', 'YRN-C-02,2', true)}
            {day('Return date')}
            {field('Return slip reference', 'reference')}
            {text('Notes', 'notes')}
          </>,
          'Post return',
          'Unused yarn returns to its original lot and location. Its PO allocation is restored.',
        ),
      )}
      {panel('Yarn available to issue', stockHint(s, yarnLots(s), 'No released yarn lots on hand.'))}
    </>
  );
}
function entry(app, selected) {
  const s = app.data;
  return (
    <>
      {split(
        editor(
          app,
          'dye-entry',
          'Record a process step',
          <>
            {batchChoice(s, selected)}
            {select('Step', 'step', DYE_STEPS, {
              initial: 'Dyeing',
            })}
            {stamp('Start', 'start', now('06:00'))}
            {stamp('End', 'end', now('12:00'))}
            {field('Operator', 'operator')}
            {field('Shift', 'shift')}
            {choose(
              'Machine override',
              'machineId',
              s.machines.filter((m) => m.status === 'In service'),
              (m) => m.code + ' · ' + m.name,
              {
                required: false,
                blank: 'Batch machine',
              },
            )}
            {choose(
              'Verified meter reading',
              'readingId',
              s.readings.filter((r) => r.verified && !r.eventId),
              (r) => r.reference + ' · ' + fmt(r.qty) + ' ' + r.unit,
              {
                required: false,
              },
            )}
            {optionalNumber('Temperature °C', 'temperature', '', -20)}
            {optionalNumber('Actual liquor ratio', 'liquorRatio')}
            {optionalNumber('pH', 'ph')}
            {optionalNumber('Water L', 'water', '0')}
            {optionalNumber('Steam kg', 'steam', '0')}
            {optionalNumber('Electricity kWh', 'electricity', '0')}
            {optionalNumber('Labour hours', 'labourHours', '0')}
            {text('Chemicals consumed: lot ID and quantity in stock unit', 'chemicals', 'CHEM-R-01,1.2\nCHEM-S-01,36')}
            {field('Process log reference', 'reference')}
            {text('Observations', 'notes')}
            {file('Process log or chart', 'production')}
          </>,
          'Post process step',
          'Machine hours come from the start and end times. Chemicals post from stock now and are absorbed into output by the share of WIP consumed.',
          openBatches(s).length > 0,
        ),
      )}
      {stepProgress(s, ref(s.processBatches, selected) || openBatches(s)[0])}
      {panel('Chemical lots on hand', stockHint(s, chemicalLots(s), 'No released chemical lots on hand.'))}
    </>
  );
}
function stepProgress(s, b) {
  if (!b) return '';
  const steps = batchSteps(s, b);
  const done = s.events.filter((e) => e.batchId === b.id && e.kind === 'Process entry' && !e.reversedBy);
  return panel(
    'Recipe steps · ' + b.number,
    steps.length ? (
      <>
        {table(
          ['Step', 'Recorded', 'Machine / operator', 'Resources'],
          steps.map((step) => {
            const rows = done.filter((e) => e.step === step);
            return [
              h(step),
              rows.length ? badge(rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies')) : badge('Pending', 'warn'),
              h(rows.map((e) => e.machineName + ' · ' + e.operator).join(', ') || '—'),
              h(
                rows
                  .map((e) =>
                    [
                      e.water && fmt(e.water) + ' L',
                      e.steam && fmt(e.steam) + ' kg steam',
                      e.electricity && fmt(e.electricity) + ' kWh',
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  )
                  .join(' | ') || '—',
              ),
            ];
          }),
        )}
        {note(
          'Other steps (loading, shade correction, fixing, hydro-extraction, unloading) can be recorded at any point after the first required step.',
        )}
      </>
    ) : (
      note('This batch uses a recipe approved before step control. Steps are recorded but not enforced.')
    ),
  );
}
function output(app, selected) {
  const s = app.data;
  const batch = ref(s.processBatches, selected) || openBatches(s)[0];
  const latest = s.processBatches
    .filter((b) => ['Open', 'In process'].includes(b.status))
    .flatMap((b) => {
      const last = b.postings.filter((p) => !p.reversed && p.kind !== 'Reversal').at(-1);
      const e = last && ref(s.events, last.eventId);
      return e ? [[b.id + '|' + e.id, b.number + ' · ' + e.id + ' · ' + (e.step || e.kind) + ' · ' + e.reference]] : [];
    });
  return (
    <>
      {split(
        <>
          {editor(
            app,
            'dye-output',
            'Post dyed yarn output (partial allowed)',
            <>
              {batchChoice(s, batch?.id)}
              {select('Result', 'result', ['Accepted', 'Rework'], {
                initial: 'Accepted',
              })}
              {field('New output lot ID', 'outputId')}
              {requiredNumber('Output quantity', 'outputQty')}
              {select('Output unit', 'unit', ['kg', 'cone'], {
                initial: 'kg',
              })}
              {optionalNumber('Measured net kg (required for cones)', 'netKg')}
              {optionalNumber('Gross kg', 'grossKg')}
              {optionalNumber('Waste kg', 'waste', '0')}
              {optionalNumber('Rejects kg', 'rejects', '0')}
              {optionalNumber('WIP consumed kg (default output + waste + rejects − adjustment)', 'consumedKg')}
              {optionalNumber('Measured gain / loss kg', 'adjustment', '', -100000000)}
              {optional('Gain / loss basis (moisture regain, conditioned weight)', 'adjustmentRef')}
              {text(
                'Lot consumption kg when known (otherwise proportional to WIP)',
                'consumption',
                'YRN-C-01,60\nYRN-C-02,41.5',
              )}
              {choose(
                'Dyed yarn item',
                'itemId',
                s.items.filter((i) => i.type === 'Dyed yarn'),
                titles.item,
                {
                  required: false,
                },
              )}
              {optional('Output description', 'label')}
              {choose('Output location', 'locationId', s.locations, titles.location, {
                required: false,
                blank: 'Work order location',
              })}
              {optional('Operator', 'operator')}
              {optional('Shift', 'shift')}
              {day('Output date')}
              {field('Unloading reference', 'reference')}
              {file('Unloading or shade report', 'production')}
            </>,
            'Post output',
            'Accepted output enters shade inspection. Rework output is held for re-dye. Standard evidence is checked separately from quality.',
            openBatches(s).length > 0,
          )}
          {editor(
            app,
            'dye-close',
            'Close a batch',
            <>
              {batchChoice(s, batch?.id)}
              {day('Closure date')}
              {field('Closure reason', 'reason')}
              {check('Confirm remaining WIP as measured process loss', 'lossConfirmed')}
              {optional('Measured loss reference', 'lossRef')}
            </>,
            'Close batch',
            'Return unused yarn first. Any remainder needs a measured loss reference.',
          )}
        </>,
        editor(
          app,
          'dye-reverse',
          'Reverse the latest posting on a batch',
          <>
            {select('Batch and latest active posting', 'pick', latest)}
            {day('Reversal date')}
            {text('Reason', 'reason', '', true)}
          </>,
          'Post reversal',
          'Corrections post a linked reversal. Reverse later postings first; outputs used downstream cannot be reversed here.',
        ),
      )}
      {batch ? batchDetail(s, batch) : ''}
    </>
  );
}
function history(app) {
  const s = app.data;
  const p = params();
  const batch = ref(s.processBatches, p.get('batch'));
  const lot = ref(s.lots, app.local.dyeLot || p.get('lot'));
  return (
    <>
      {panel(
        'Find a lot or batch',
        <>
          {form(
            'dye-history',
            <>
              {field('Lot ID or scanned QR payload', 'lotId', {
                value: lot?.id || '',
                required: false,
              })}
              {choose(
                'Batch',
                'batchView',
                s.processBatches.filter((b) => b.process === PROCESS),
                (b) => b.number + ' · ' + b.status,
                {
                  required: false,
                  initial: batch?.id,
                },
              )}
            </>,
            'Show history',
          )}
          {note('A lookup or scan only retrieves the record. Stock changes need an explicit posting above.')}
        </>,
      )}
      {batch ? batchDetail(s, batch) : ''}
      {lot ? lotHistory(s, lot) : ''}
    </>
  );
}
function YarnDyeing({ app }) {
  const p = params();
  const tab = tabs.some(([key]) => key === p.get('tab')) ? p.get('tab') : 'setup';
  const selected = p.get('batch') || '';
  const body = {
    setup,
    work,
    issue,
    entry,
    output,
    commission,
    allocate,
    history,
  }[tab](app, selected);
  return (
    <>
      {heading(
        'Yarn dyeing',
        'Approved routes A and B start here. Issue yarn to a dye batch, record each process step, post partial outputs and return unused yarn. Every posting carries its lots, measured kg and evidence.',
        <a className="button secondary" href="#trace">
          {'Scan & trace'}
        </a>,
      )}
      {tabBar(tab)}
      {body}
    </>
  );
}

// The component route form posts line and component together; split them for the action.
export { YarnDyeing };
export function routeInput(input) {
  const [lineId, component] = String(input.lineComponent || '').split('|');
  return {
    lineId,
    component,
    template: input.template,
    conditional: String(input.conditional || '')
      .split(/[;,]/)
      .map((v) => v.replace(/\(.*\)/, '').trim())
      .filter(Boolean)
      .join(','),
    effective: input.effective,
    reference: input.reference,
  };
}
const ownerOf = (s, l) => (l.ownerId ? s.parties.find((p) => p.id === l.ownerId)?.name || l.ownerId : s.settings.name);
function commission(app) {
  const s = app.data;
  const customerLots = s.lots.filter((l) => l.ownerId && l.qty > 0 && ['Yarn', 'Dyed yarn'].includes(l.material));
  const jobs = s.jobs.filter((j) => j.stage === PROCESS);
  const deliveries = s.events.filter((e) => e.kind === 'Commission delivery');
  return (
    <>
      {split(
        editor(
          app,
          'receipt',
          'Receive undyed yarn (own or customer)',
          <>
            {field('Yarn lot ID', 'lotId')}
            {select(
              'Ownership',
              'mode',
              [
                ['Direct inward', 'Own material from supplier'],
                ['Customer inward', 'Customer-owned for commission dyeing'],
              ],
              {
                initial: 'Direct inward',
              },
            )}
            {choose(
              'Yarn item',
              'itemId',
              s.items.filter((i) => i.type === 'Yarn'),
              titles.item,
            )}
            {numberField('Quantity in item unit', 'qty')}
            {choose(
              'Supplier (own material)',
              'supplierId',
              s.parties.filter((p) => p.type === 'Supplier'),
              titles.party,
              {
                required: false,
              },
            )}
            {choose(
              'Customer (commission)',
              'ownerId',
              s.parties.filter((p) => p.type === 'Buyer'),
              titles.party,
              {
                required: false,
                blank: 'Company-owned',
              },
            )}
            {field('Origin or customer store', 'origin')}
            {choose('Receiving location', 'locationId', s.locations, titles.location)}
            {select('Standard claimed', 'scheme', schemeNames(s), {
              initial: 'Conventional',
            })}
            {optionalNumber('Actual net kg (cones)', 'netKg')}
            {day('Receipt date')}
            {field('GRN or customer challan', 'reference')}
          </>,
          'Post receipt',
          'Customer yarn keeps the customer as owner and this mill as custodian. A claimed standard needs verified supplier or customer evidence.',
        ),
        editor(
          app,
          'dye-deliver',
          'Deliver commission-dyed yarn to its owner',
          <>
            {choose(
              'Customer',
              'customerId',
              s.parties.filter((p) => p.type === 'Buyer'),
              titles.party,
            )}
            {field('Delivery challan number', 'number')}
            {text('Dyed lots and quantities in stock unit', 'lines', 'DYC-01,157', true)}
            {optional('Carrier', 'carrier')}
            {day('Delivery date')}
            {text('Notes', 'notes')}
            {file('Signed delivery challan', 'logistics')}
          </>,
          'Post delivery',
          "Only that customer's released lots can go on its challan. Invoice the dyeing charge as a service order.",
        ),
      )}
      {panel(
        "Customer-owned yarn in this mill's custody",
        table(
          ['Lot', 'Material / colour', 'Owner', 'Custodian and location', 'On hand', 'Quality / claim'],
          customerLots.map((l) => [
            lotLink(l.id),
            h(l.material + (l.colour ? ' · ' + l.colour : '') + (l.commissionRef ? ' · ' + l.commissionRef : '')),
            h(ownerOf(s, l)),
            <>
              {h(s.settings.name + ' · ' + l.custody)}
              <br />
              <small>{h(l.location)}</small>
            </>,
            showQty(l.qty, l.unit),
            <>
              {l.standardHold ? badge('Standard Hold', 'bad') : txStatus(l.qualityStatus)}
              <br />
              <small>{h(schemesOf(l).join(', ') || 'Conventional')}</small>
            </>,
          ]),
          'No customer-owned yarn on hand.',
        ),
      )}
      {panel(
        'Commission batches',
        table(
          ['Batch', 'Customer and job order', 'Recipe', 'Issued / WIP', 'Outputs', 'Status'],
          s.processBatches
            .filter((b) => b.process === PROCESS && b.commission)
            .slice()
            .reverse()
            .map((b) => {
              const sum = batchSummary(s, b);
              return [
                h(b.number),
                h(b.customer + ' · ' + b.commissionRef),
                h(b.recipe.code + ' r' + b.recipe.version),
                h(fmt(sum.issuedKg) + ' / ' + fmt(sum.wipKg) + ' kg'),
                joinContent(b.outputs.map(lotLink), ', ') || '—',
                txStatus(b.status),
              ];
            }),
          'No commission batches.',
        ),
      )}
      {panel(
        'Deliveries to owners',
        table(
          ['Date', 'Challan', 'Customer', 'Lots', 'Carrier'],
          deliveries
            .slice()
            .reverse()
            .map((e) => [
              h(e.date),
              h(e.reference),
              h(e.customer),
              joinContent(
                e.inputs.map((i) => (
                  <>
                    {lotLink(i.id)}
                    {' · '}
                    {showQty(i.qty, i.unit)}
                  </>
                )),
                <br />,
              ),
              h(e.carrier || '—'),
            ]),
          'No deliveries yet.',
        ),
      )}
      {panel(
        'Yarn with outside dye houses (processor custody)',
        table(
          ['Challan', 'Lot', 'Processor and site', 'Sent / outstanding', 'Status'],
          jobs
            .slice()
            .reverse()
            .map((j) => [
              h(j.number),
              lotLink(j.lotId),
              h(j.processor + ' · ' + j.site),
              showQty(j.sent, j.unit) + ' / ' + showQty(j.qty, j.unit),
              txStatus(j.status),
            ]),
          'No yarn is with an outside dye house.',
        ),
      )}
    </>
  );
}
function allocate(app) {
  const s = app.data;
  const yarn = s.lots.filter((l) => ['Yarn', 'Dyed yarn'].includes(l.material) && (l.qty > 0 || l.assignments?.length));
  const work = s.workOrders.filter(
    (w) => Object.values(YARN_ROLES).flat().includes(w.stage) && ['Released', 'In progress'].includes(w.status),
  );
  return (
    <>
      {split(
        editor(
          app,
          'yarn-assign',
          'Allocate yarn to knitting, warp or weft',
          <>
            {choose(
              'Yarn lot',
              'lotId',
              yarn.filter((l) => l.qty > 0),
              titles.lot,
            )}
            {choose('Work order', 'workOrderId', work, titles.wo)}
            {select('Use', 'role', Object.keys(YARN_ROLES), {
              initial: 'Warp',
            })}
            {numberField('Quantity in lot unit', 'qty')}
            {select('Action', 'mode', ['Assign', 'Release'], {
              initial: 'Assign',
            })}
            {day('Date')}
            {field('Allocation reference', 'reference')}
          </>,
          'Post allocation',
          'Warp goes to warping or weaving, weft to weaving, knitting yarn to knitting. Allocated yarn is held: other work orders can only use the unallocated balance, and the allocated work order can only use it for that role.',
          work.length > 0,
        ),
      )}
      {note(
        'Post the knitting, warping or weaving run under Work orders. Issue dyed cones by lot ID and quantity in cones, and reconcile in kg.',
      )}
      <div className="actions">
        <a className="button secondary" href="#floor">
          Work orders and production
        </a>
      </div>
      {panel(
        'Yarn allocations',
        table(
          ['Yarn lot', 'Colour / count', 'On hand', 'Allocated to', 'Use', 'Allocated / used', 'Reference'],
          yarn.flatMap((l) =>
            (l.assignments ?? []).map((a) => [
              lotLink(l.id),
              h(
                [l.colour, l.yarn ? l.yarn.count.actual + ' ' + l.yarn.count.system : ''].filter(Boolean).join(' · ') ||
                  l.material,
              ),
              showQty(l.qty, l.unit),
              h(a.workOrder + ' · ' + a.stage),
              badge(a.role),
              h(fmt(a.qty) + ' / ' + fmt(a.used) + ' ' + l.unit),
              h(a.reference),
            ]),
          ),
          'No yarn allocated yet.',
        ),
      )}
    </>
  );
}
