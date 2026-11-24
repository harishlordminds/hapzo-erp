import { joinContent } from './react-ui.jsx';
import { ref } from '../src/model.mjs';
import { FABRIC_FINISHING, FINISH_OPERATIONS, finishEntries, finishedRollTrace } from '../src/fabric-finishing.mjs';
import { lineRemainingKg, latestActive, wipKg } from '../src/process-batch.mjs';
import { batchDetail, optional, optionalNumber, requiredNumber, now, stamp, params } from './process-ui.jsx';
import {
  h,
  valueOf,
  showQty,
  txStatus,
  badge,
  heading,
  panel,
  split,
  facts,
  table,
  details,
  note,
  choose,
  day,
  field,
  text,
  file,
  hidden,
  editor,
  linkButton,
  lotLink,
  finishBatchLink,
  navLink,
  lineLabel,
  titles,
} from './ui.jsx';
const planTitle = (p) => p.code + ' r' + p.version;
const operationMachine = (m) => m.code + ' · ' + m.name;
const planRoute = (r) =>
  r.componentRoute
    ? 'Route ' + r.componentRoute.template + ' r' + r.componentRoute.version + ' · ' + r.componentRoute.component
    : r.name + ' · ' + r.version;
const measured = (value, unit) => (value == null ? '—' : showQty(value, unit));
const target = (value, unit, limits) =>
  showQty(value, unit) + (limits ? ' · ' + showQty(limits.min, '') + '–' + showQty(limits.max, unit) : '');
function planFacts(p) {
  const spec = p.specification;
  return (
    <>
      {facts([
        ['Plan / approval', h(planTitle(p) + ' · ' + p.reference)],
        ['Approved spec', h('r' + spec.revision + ' · PO line revision ' + p.lineRevision)],
        [
          'Selected production route',
          <>
            {h(planRoute(p.route))}
            <br />
            {h(p.route.stages.join(' → '))}
          </>,
        ],
        ['Fabric construction', valueOf([spec.type, spec.structure, p.component].filter(Boolean).join(' · '))],
        ...(spec.widthCm == null
          ? []
          : [
              [
                'Target full width',
                target(spec.widthCm, 'cm', spec.widthLimits) + (spec.widthMode ? ' · ' + h(spec.widthMode) : ''),
              ],
            ]),
        ...(spec.usableWidthCm == null ? [] : [['Target usable width', showQty(spec.usableWidthCm, 'cm')]]),
        ...(spec.gsm == null ? [] : [['Target GSM', target(spec.gsm, 'g/m²', spec.gsmLimits)]]),
        ...(spec.instructions ? [['Approved finish instructions', h(spec.instructions)]] : []),
      ])}
      {details('Approved buyer fabric specification', <p>{h(spec.approvedSpec)}</p>)}
    </>
  );
}
function sequenceTable(steps, actual) {
  return table(
    ['Operation', 'Approved settings', 'Actual machine / time', 'Actual settings', 'Chemical lots'],
    steps.map((step, i) => {
      const e = actual[i];
      return [
        h(i + 1 + '. ' + step.operation),
        valueOf(step.settings),
        e ? (
          <>
            {h(e.machineName + ' · ' + e.operator + ' · shift ' + e.shift)}
            <br />
            <small>
              {h(
                e.start.replace('T', ' ') +
                  ' → ' +
                  (e.start.slice(0, 10) === e.end.slice(0, 10) ? e.end.slice(11) : e.end.replace('T', ' ')),
              )}
            </small>
          </>
        ) : (
          badge('Pending', 'warn')
        ),
        valueOf(e?.settings || e?.notes),
        joinContent(
          (e?.inputs ?? []).map((row) => (
            <>
              {lotLink(row.id)}
              {' · '}
              {showQty(row.qty, row.unit)}
            </>
          )),
          <br />,
        ) || '—',
      ];
    }),
  );
}
export function finishingTracePanel(s, lot) {
  const trace = finishedRollTrace(s, lot);
  if (!trace) return '';
  const { roll, batch, dye, yarn, steps } = trace;
  const f = roll.finishing;
  return (
    <>
      {panel(
        'Finishing history' + (roll.id === lot.id ? '' : ' · original roll ' + roll.id),
        <>
          {facts([
            ['Finishing batch', finishBatchLink(batch.id, batch.number)],
            [
              'Source roll',
              <>
                {lotLink(f.sourceLotId)}
                {' · '}
                {showQty(f.inputKg, 'kg drawn')}
              </>,
            ],
            ['Measured width', showQty(f.widthCm, 'cm') + (f.widthMode ? ' · ' + h(f.widthMode) : '')],
            ['Measured GSM', showQty(f.gsm, 'g/m²')],
            ['Measured length', showQty(f.lengthM, 'm')],
            ['Net weight at finishing', showQty(f.netKg, 'kg')],
            ['Output', h(f.remnant ? 'Retained finished remnant' : 'Finished roll')],
          ])}
          {planFacts(batch.recipe)}
          {sequenceTable(batch.recipe.steps, steps)}
        </>,
      )}
      {split(
        panel(
          'Upstream dye batches',
          table(
            ['Dyed lot', 'Batch', 'Recipe / shade'],
            dye.map((row) => {
              const page = row.lot.stage === 'Fabric dyeing' ? 'fabric-dyeing?tab=batch' : 'yarn-dyeing?tab=history';
              const batchLink = row.batch ? (
                <a href={'#' + page + '&batch=' + encodeURIComponent(row.batch.id)}>{h(row.batch.number)}</a>
              ) : (
                valueOf(row.event?.reference)
              );
              return [
                lotLink(row.lot.id),
                batchLink,
                valueOf(
                  [row.lot.dyed?.recipe || row.event?.recipe, row.lot.fabric?.shade || row.lot.shade]
                    .filter(Boolean)
                    .join(' · '),
                ),
              ];
            }),
            'The upstream lots have no dye run recorded.',
          ),
        ),
        panel(
          'Upstream yarn lots',
          table(
            ['Yarn lot', 'Material / stage', 'Source batch or supplier lot'],
            yarn.map((y) => [
              lotLink(y.id),
              h(y.material + ' · ' + y.stage),
              valueOf(
                [ref(s.processBatches, y.batchId)?.number, y.supplierLot, y.party || y.origin]
                  .filter(Boolean)
                  .join(' · '),
              ),
            ]),
            'No upstream yarn lots are linked.',
          ),
        ),
      )}
    </>
  );
}
function setupForms(app, plans) {
  const s = app.data;
  const routes = s.componentRoutes.filter((r) => r.status === 'Approved' && r.stages.includes(FABRIC_FINISHING));
  const lines = s.lines.filter(
    (l) => l.status === 'Approved' && (l.stages.includes(FABRIC_FINISHING) || routes.some((r) => r.lineId === l.id)),
  );
  const machines = s.machines.filter((m) => m.status === 'In service');
  const works = s.workOrders.filter(
    (w) => w.stage === FABRIC_FINISHING && ['Released', 'In progress'].includes(w.status),
  );
  const planChoice = (opts = {}) =>
    choose('Approved finishing plan', 'recipeId', plans, (p) => planTitle(p) + ' · ' + p.lineId, opts);
  return split(
    editor(
      app,
      'finish-plan',
      'Approve a finishing sequence',
      <>
        {choose('Approved PO line', 'lineId', lines, (l) => lineLabel(s, l))}
        {choose(
          'Approved component route',
          'componentRouteId',
          routes,
          (r) => r.lineId + ' · ' + r.component + ' · Route ' + r.template,
          {
            required: false,
            blank: 'Use the buyer PO line route',
          },
        )}
        {optional('Tech pack fabric code, if applicable', 'component')}
        {field('Finishing plan code', 'code')}
        {field('Plan revision', 'version')}
        {day('Effective date', 'effective')}
        {field('Approval reference', 'reference')}
        {text(
          'Ordered operations · one per line, with optional settings after |',
          'steps',
          'Drying | Condition fabric before stentering\nStentering | 152 cm set width\nCompacting | Confirm handfeel',
          true,
        )}
      </>,
      'Approve plan',
      'Choose from ' + FINISH_OPERATIONS.join(', ') + ', or enter the name of another approved finish.',
    ),
    editor(
      app,
      'finish-order',
      'Release a finishing work order',
      <>
        {planChoice()}
        {field('Work order number', 'number')}
        {choose('Finishing output location', 'locationId', s.locations, titles.location)}
        {requiredNumber('Planned output (kg)', 'plannedQty')}
        {day('Release date')}
        {day('Due date', 'due', false)}
        {text('Job instructions', 'notes')}
      </>,
      'Release work order',
    ),
    editor(
      app,
      'finish-open',
      'Open a finishing batch',
      <>
        {choose('Finishing work order', 'workOrderId', works, titles.wo, {
          hook: 'finish-work',
        })}
        {planChoice()}
        {field('Batch number', 'number')}
        {choose('Starting machine', 'machineId', machines, operationMachine)}
        {requiredNumber('Planned batch load (kg)', 'plannedKg')}
        {day('Batch date')}
      </>,
      'Open batch',
    ),
  );
}
function batchForms(app, b, actual) {
  if (!['Open', 'In process'].includes(b.status)) return '';
  const s = app.data;
  const selected = hidden('batchId', b.id);
  const next = b.recipe.steps[actual.length];
  const hasStock = wipKg(b) > 0;
  const prior = actual.at(-1)?.end;
  const latest = ref(s.events, latestActive(b)?.eventId);
  return split(
    !actual.length
      ? editor(
          app,
          'finish-issue',
          'Issue fabric rolls',
          <>
            {selected}
            {text('Roll lot ID and issued kg, one per line', 'lines', 'DYED-ROLL-01,100', true)}
            {day('Issue date')}
            {field('Issue slip', 'reference')}
            {file('Issue slip attachment', 'production')}
          </>,
          'Issue rolls',
          '',
          !hasStock,
        )
      : '',
    hasStock && next
      ? editor(
          app,
          'finish-entry',
          'Record ' + next.operation,
          <>
            {selected}
            {hidden('step', next.operation)}
            {stamp('Started at', 'start', prior?.slice(0, 16) || now('08:00'))}
            {stamp('Ended at', 'end', '')}
            {choose(
              'Actual machine',
              'machineId',
              s.machines.filter((m) => m.status === 'In service' && ref(s.locations, m.locationId)?.site === b.site),
              operationMachine,
              {
                initial: b.machineId,
              },
            )}
            {field('Operator', 'operator')}
            {field('Shift', 'shift')}
            {text('Actual operating settings', 'settings', next.settings)}
            {text('Chemical lot ID and actual amount in lot unit', 'chemicals', 'SOFTENER-LOT-01,1.2')}
            {field('Operation reference', 'reference')}
            {text('Notes', 'notes')}
          </>,
          'Record operation',
          '',
          true,
        )
      : '',
    hasStock && !next
      ? editor(
          app,
          'finish-rolls',
          'Post finished rolls for inspection',
          <>
            {selected}
            {text(
              'Roll ID, source lot ID, input kg, finished kg, metres, width cm, GSM, optional Remnant',
              'rolls',
              'FIN-ROLL-A,DYED-ROLL-01,56,55.2,170.4,152,213\nFIN-ROLL-B,DYED-ROLL-01,42,41.6,129.3,151.5,212.4',
              true,
            )}
            {choose(
              'Finished fabric item',
              'itemId',
              s.items.filter((i) => i.type === 'Finished fabric' && i.unit === 'kg'),
              titles.item,
              {
                required: false,
                initial: b.recipe.specification.itemId,
              },
            )}
            {optionalNumber('Waste kg', 'waste')}
            {optionalNumber('Reject kg', 'rejects')}
            {optionalNumber('Measured kg adjustment', 'adjustment', '', -1e8)}
            {optional('Adjustment reference', 'adjustmentRef')}
            {day('Posting date')}
            {field('Roll posting reference', 'reference')}
            {file('Roll measurement sheet', 'production')}
          </>,
          'Post finished rolls',
          'Enter one row per finished roll. Use Remnant for a finished offcut kept as a separate lot.',
          true,
        )
      : '',
    hasStock
      ? editor(
          app,
          'finish-return',
          'Return an unused remnant',
          <>
            {selected}
            {text('Source roll ID, returned kg, optional measured metres', 'lines', 'DYED-ROLL-01,2,6.1', true)}
            {day('Return date')}
            {field('Return slip', 'reference')}
            {text('Return notes', 'notes')}
          </>,
          'Return to original stock',
        )
      : editor(
          app,
          'finish-close',
          'Close reconciled batch',
          <>
            {selected}
            {day('Closure date')}
            {field('Closure reason', 'reason')}
          </>,
          'Close batch',
        ),
    latest
      ? editor(
          app,
          'finish-reverse',
          'Reverse latest posting',
          <>
            {selected}
            {hidden('eventId', latest.id)}
            {day()}
            {field('Reason', 'reason')}
          </>,
          'Reverse ' + latest.reference,
        )
      : '',
  );
}
function finishBatch(app, b) {
  const s = app.data;
  const actual = finishEntries(s, b);
  const lots = b.outputs.map((id) => ref(s.lots, id)).filter(Boolean);
  const remaining = b.lines.filter((line) => lineRemainingKg(line) > 0);
  const returned = b.postings
    .filter((p) => p.kind === 'Return' && !p.reversed)
    .flatMap((p) => {
      const e = ref(s.events, p.eventId);
      return (e?.remnants ?? []).map((row) => [
        h(e.reference),
        lotLink(row.lotId),
        showQty(row.kg, 'kg'),
        measured(row.metres, 'm'),
      ]);
    });
  return (
    <>
      {panel(
        'Finishing plan · ' + b.number,
        <>
          {planFacts(b.recipe)}
          {sequenceTable(b.recipe.steps, actual)}
        </>,
      )}
      {panel(
        'Finished rolls and retained remnants',
        <>
          {table(
            ['Scan / trace', 'Width', 'GSM', 'Length', 'Net kg', 'Quality', 'Source roll'],
            lots.map((lot) => {
              const f = lot.finishing;
              return [
                <>
                  {lotLink(lot.id)}
                  {f.remnant ? (
                    <>
                      <br />
                      {badge('Remnant')}
                    </>
                  ) : (
                    ''
                  )}
                </>,
                showQty(f.widthCm, 'cm'),
                showQty(f.gsm, 'g/m²'),
                showQty(f.lengthM, 'm'),
                showQty(f.netKg, 'kg'),
                txStatus(lot.standardHold ? 'Hold' : lot.qualityStatus),
                lotLink(f.sourceLotId),
              ];
            }),
            'No finished rolls have been posted.',
          )}
          {lots.length ? navLink('Inspect or release in Quality', 'quality') : ''}
        </>,
      )}
      {batchForms(app, b, actual)}
      {remaining.length
        ? panel(
            'Fabric retained in the batch',
            table(
              ['Source roll', 'Remaining kg'],
              remaining.map((row) => [lotLink(row.lotId), showQty(lineRemainingKg(row), 'kg')]),
            ),
          )
        : ''}
      {returned.length
        ? panel(
            'Returned unused remnants',
            table(['Return slip', 'Original roll', 'Returned kg', 'Measured length'], returned),
          )
        : ''}
      {batchDetail(s, b)}
    </>
  );
}
function FabricFinishingPage({ app }) {
  const s = app.data;
  const p = params();
  const batches = s.processBatches
    .filter((b) => b.process === FABRIC_FINISHING)
    .slice()
    .reverse();
  const plans = s.processSetups
    .filter((row) => row.process === FABRIC_FINISHING && row.status === 'Approved')
    .slice()
    .reverse();
  const selected = ref(batches, p.get('batch')) || batches[0];
  return (
    <>
      {heading(
        'Fabric finishing',
        'Run the approved finishing sequence, reconcile the rolls and send measured output to Quality.',
        navLink('Quality & lab', 'quality'),
      )}
      {selected
        ? finishBatch(app, selected)
        : note('Approve a sequence for a buyer PO line or component, then release the finishing work order.')}
      {panel(
        'Finishing batch register',
        table(
          ['Batch', 'Plan', 'Production route', 'Issued stock in process', 'Status'],
          batches.map((b) => [
            finishBatchLink(b.id, b.number),
            h(planTitle(b.recipe)),
            h(planRoute(b.recipe.route)),
            showQty(wipKg(b), 'kg'),
            txStatus(b.status),
          ]),
        ),
      )}
      {setupForms(app, plans)}
      {details(
        'Approved finishing plans',
        table(
          ['Plan', 'Buyer PO line', 'Selected route', 'Operations', 'Effective'],
          plans.map((p) => [
            h(planTitle(p)),
            valueOf(ref(s.lines, p.lineId) && lineLabel(s, ref(s.lines, p.lineId))),
            h(planRoute(p.route)),
            h(p.steps.map((row) => row.operation).join(' → ')),
            h(p.effective),
          ]),
        ),
      )}
    </>
  );
}
export { FabricFinishingPage };
