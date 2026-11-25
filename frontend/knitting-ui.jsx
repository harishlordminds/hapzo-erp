import { joinContent } from './react-ui.jsx';
import { ref, genealogy } from '../src/model.js';
import { schemeNames } from '../src/standards.js';
import { RATE_KEYS, wipKg, latestActive } from '../src/process-batch.js';
import { stageLabel } from '../src/routes.js';
import {
  KNITTING,
  MACHINE_PROFILE,
  KNIT_COMPONENTS,
  KNIT_STRUCTURES,
  MACHINE_TYPES,
  machineProfile,
  lotCount,
} from '../src/knitting.js';
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
  recipeText,
} from './process-ui.jsx';
import {
  h,
  fmt,
  badge,
  txStatus,
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
  day,
  text,
  check,
  hidden,
  form,
  editor,
  facts,
  titles,
  lotLink,
  lineLabel,
} from './ui.jsx';
const tabs = [
  ['setup', 'Setup'],
  ['work', 'Production orders'],
  ['issue', 'Cone issue and return'],
  ['steps', 'Machine and shift'],
  ['rolls', 'Rolls'],
  ['trace', 'Roll trace'],
  ['history', 'Lot history'],
];
const open = (s) => s.processBatches.filter((b) => b.process === KNITTING && ['Open', 'In process'].includes(b.status));
const works = (s) => s.workOrders.filter((w) => w.stage === KNITTING && ['Released', 'In progress'].includes(w.status));
const specs = (s) => s.processSetups.filter((r) => r.process === KNITTING && r.status === 'Approved');
const runTitle = (b) => b.number + ' · ' + recipeText(b) + ' · WIP ' + fmt(wipKg(b)) + ' kg';
const runChoice = (s, selected) =>
  choose('Knit run', 'batchId', open(s), runTitle, {
    initial: selected,
  });
const selectedRun = (s, selected) =>
  ref(s.processBatches, selected) || open(s)[0] || s.processBatches.filter((b) => b.process === KNITTING).at(-1);
const rolls = (s) => s.lots.filter((l) => l.knit);
function tabBar(selected) {
  return (
    <nav className="actions" aria-label="Knitting screens">
      {joinContent(
        tabs.map(([key, label]) => (
          <a
            className={'button ' + (key === selected ? '' : 'secondary')}
            href={'#knitting?tab=' + key}
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
  const all = s.processSetups.filter((r) => r.process === KNITTING);
  return (
    <>
      {split(
        editor(
          app,
          'knit-machine',
          'Record knitting machine type and gauge',
          <>
            {choose('Machine', 'machineId', s.machines, (m) => m.code + ' · ' + m.name)}
            {select('Machine type', 'type', MACHINE_TYPES)}
            {requiredNumber('Gauge (needles per inch)', 'gauge')}
            {optionalNumber('Diameter inch', 'diameter')}
            {optionalNumber('Feeders', 'feeders')}
            {day('Effective date', 'effective')}
            {field('Machine setting or audit reference', 'reference')}
          </>,
          'Save machine profile',
          'A run can only open on a machine whose recorded type and gauge match the construction.',
          !s.processSetups.some((r) => r.process === MACHINE_PROFILE),
        ),
        editor(
          app,
          'knit-setup',
          'Approve a fabric construction',
          <>
            {field('Construction code', 'code')}
            {field('Revision', 'version', {
              value: '1',
            })}
            {day('Effective date', 'effective')}
            {choose(
              'Revises (supersedes)',
              'revises',
              all.filter((r) => r.status === 'Approved'),
              (r) => r.code + ' r' + r.version,
              {
                required: false,
                blank: 'New construction',
              },
            )}
            {optional('Reason for the revision', 'revisionReason')}
            {select('Component', 'component', KNIT_COMPONENTS)}
            {optional('BOM component code', 'bomCode')}
            {select('Structure', 'structure', KNIT_STRUCTURES)}
            {check('Yarn-dyed fabric (knits dyed yarn)', 'yarnDyed')}
            {text('Yarn feed: role, count, count system, colour', 'feeds', 'Ground,30,Ne,Red\nGround,30,Ne,Navy', true)}
            {text('Colour sequence: colour and courses per repeat', 'stripe', 'Red,6\nNavy,4')}
            {select('Machine type', 'machineType', MACHINE_TYPES)}
            {requiredNumber('Gauge', 'gauge')}
            {optionalNumber('Diameter inch', 'diameter')}
            {optionalNumber('Stitch length mm', 'stitchLength')}
            {optionalNumber('Target GSM', 'gsm')}
            {optional('Width (open or tubular)', 'width')}
            {optionalNumber('Planned yield %', 'yieldPct', '98')}
            {joinContent(
              Object.entries(RATE_KEYS).map(([k, label]) => optionalNumber(label, k + 'Rate')),
              '',
            )}
            {optional('Approved rate card reference', 'rateRef')}
            {field('Construction approval reference', 'reference')}
          </>,
          'Approve construction',
          'Greige constructions take undyed yarn (route C). Yarn-dyed constructions take dyed yarn in the listed colours (route A). A recorded yarn count must match the feed.',
          !specs(s).length,
        ),
      )}
      {panel(
        'Knitting machines',
        table(
          ['Machine', 'Type', 'Gauge / diameter / feeders', 'Revision', 'Reference'],
          s.machines
            .map((m) => machineProfile(s, m.id))
            .filter(Boolean)
            .map((p) => [
              h(p.machine),
              h(p.type),
              h(p.gauge + ' G · ' + (p.diameter ? p.diameter + ' in' : '—') + ' · ' + (p.feeders ?? '—') + ' feeders'),
              h('r' + p.version + ' · ' + p.effective),
              h(p.reference),
            ]),
          'No knitting machines recorded.',
        ),
      )}
      {panel(
        'Fabric constructions',
        table(
          ['Construction', 'Component', 'Structure and yarn feed', 'Colour sequence', 'Machine', 'Status'],
          all
            .slice()
            .reverse()
            .map((r) => [
              <>
                {h(r.code + ' r' + r.version)}
                <br />
                <small>{h(r.reference)}</small>
              </>,
              h(r.component + (r.bomCode ? ' · ' + r.bomCode : '')),
              h(
                r.structure +
                  (r.yarnDyed ? ' · yarn-dyed' : ' · greige') +
                  ' · ' +
                  r.feeds
                    .map((f) => f.role + ' ' + f.count + ' ' + f.countSystem + (f.colour ? ' ' + f.colour : ''))
                    .join(', ') +
                  joinContent(
                    [r.gsm && r.gsm + ' GSM', r.stitchLength && 'SL ' + r.stitchLength + ' mm', r.width]
                      .filter(Boolean)
                      .map((v) => ' · ' + v),
                    '',
                  ),
              ),
              h(
                r.stripe.length
                  ? r.stripe.map((c) => c.colour + ' ' + c.courses).join(' / ') + ' (' + r.repeatCourses + ' courses)'
                  : '—',
              ),
              h(r.machineType + ' · ' + r.gauge + ' G' + (r.diameter ? ' · ' + r.diameter + ' in' : '')),
              txStatus(r.status),
            ]),
          'No constructions approved yet.',
        ),
      )}
    </>
  );
}
function work(app) {
  const s = app.data;
  const routes = s.componentRoutes.filter((r) => r.status === 'Approved' && r.stages.includes(KNITTING));
  return (
    <>
      {split(
        editor(
          app,
          'work-order',
          'Release a knitting production order',
          <>
            {hidden('stage', KNITTING)}
            {hidden('unit', 'kg')}
            {field('Work order number', 'number')}
            {choose(
              'Approved component route (body, rib or other)',
              'componentRouteId',
              routes,
              (r) => r.lineId + ' · ' + r.component + ' · route ' + r.template,
              {
                required: false,
                blank: 'Stock knitting',
              },
            )}
            {choose('Output location', 'locationId', s.locations, titles.location)}
            {requiredNumber('Planned fabric kg', 'plannedQty')}
            {select('Standard for stock knitting', 'scheme', schemeNames(s), {
              initial: 'Conventional',
            })}
            {day('Release date')}
            {day('Due date', 'due', false)}
            {text('Instructions', 'notes')}
          </>,
          'Release order',
          'Release body, rib and other components as separate orders. Each pins its component route and BOM revision.',
          !works(s).length,
        ),
        editor(
          app,
          'knit-open',
          'Open a knit run',
          <>
            {choose('Knitting order', 'workOrderId', works(s), titles.wo)}
            {field('Run number', 'number')}
            {choose(
              'Knitting machine',
              'machineId',
              s.machines.filter((m) => m.status === 'In service' && machineProfile(s, m.id)),
              (m) => m.code + ' · ' + machineProfile(s, m.id).type + ' · ' + machineProfile(s, m.id).gauge + ' G',
            )}
            {choose(
              'Fabric construction',
              'recipeId',
              specs(s),
              (r) => r.code + ' r' + r.version + ' · ' + r.component + ' · ' + r.structure,
            )}
            {requiredNumber('Planned yarn kg', 'plannedKg')}
            {day('Run date')}
          </>,
          'Open run',
          'The machine type and gauge must match the construction, and the construction must match the route: dyed yarn on route A, undyed yarn on route C.',
          works(s).length > 0,
        ),
      )}
      {panel(
        'Knitting orders',
        table(
          ['Order', 'Component and route', 'Plan / knitted', 'Runs', 'Status'],
          s.workOrders
            .filter((w) => w.stage === KNITTING)
            .slice()
            .reverse()
            .map((w) => [
              h(w.number),
              h(
                w.componentRoute
                  ? w.componentRoute.component +
                      ' · route ' +
                      w.componentRoute.template +
                      ' · ' +
                      (w.lineId ? lineLabel(s, ref(s.lines, w.lineId)) : '')
                  : 'Stock knitting',
              ),
              showQty(w.plannedQty, w.unit) + ' / ' + showQty(w.completedQty, w.unit),
              joinContent(
                s.processBatches
                  .filter((b) => b.workOrderId === w.id)
                  .map((b) => <a href={'#knitting?tab=rolls&batch=' + encodeURIComponent(b.id)}>{h(b.number)}</a>),
                ', ',
              ) || '—',
              txStatus(w.status),
            ]),
        ),
      )}
    </>
  );
}
function issue(app, selected) {
  const s = app.data;
  const b = selectedRun(s, selected);
  return (
    <>
      {split(
        editor(
          app,
          'knit-issue',
          'Issue cones to a knit run',
          <>
            {runChoice(s, b?.id)}
            {text(
              'Lots and quantity in stock unit (cones or kg); measured kg for cones without a kg basis',
              'lines',
              'DYR-01,110\nDYN-01,76',
              true,
            )}
            {optional('Weighing slip for measured kg', 'conversionRef')}
            {day('Issue date')}
            {field('Cone issue slip', 'reference')}
          </>,
          'Post issue',
          'Each lot is checked for colour against the colour sequence, for count against the feed when the count is recorded, for standard claims and for yarn allocations.',
          open(s).length > 0,
        ),
        editor(
          app,
          'knit-return',
          'Return unused cones',
          <>
            {runChoice(s, b?.id)}
            {text('Lots and quantity in stock unit', 'lines', '', true)}
            {day('Return date')}
            {field('Return slip', 'reference')}
          </>,
          'Post return',
        ),
      )}
      {panel(
        'Yarn available',
        stockHint(
          s,
          s.lots.filter((l) => l.qty > 0 && ['Yarn', 'Dyed yarn'].includes(l.material) && l.custody === 'Own site'),
          'No released yarn on hand.',
        ),
      )}
    </>
  );
}
function steps(app, selected) {
  const s = app.data;
  const b = selectedRun(s, selected);
  return (
    <>
      {split(
        editor(
          app,
          'knit-entry',
          'Record machine and shift',
          <>
            {runChoice(s, b?.id)}
            {select(
              'Step',
              'step',
              ['Yarn creel loading', 'Machine setting', 'Knitting', 'Doffing', 'Roll weighing', 'Machine stoppage'],
              {
                initial: 'Knitting',
              },
            )}
            {choose(
              'Machine',
              'machineId',
              s.machines.filter((m) => machineProfile(s, m.id)),
              (m) => m.code + ' · ' + m.name,
              {
                required: false,
                blank: 'Run machine',
              },
            )}
            {stamp('Start', 'start', now('06:00'))}
            {stamp('End', 'end', now('14:00'))}
            {field('Knitter', 'operator')}
            {field('Shift', 'shift')}
            {optionalNumber('Electricity kWh', 'electricity', '0')}
            {optionalNumber('Labour hours', 'labourHours', '0')}
            {field('Shift log reference', 'reference')}
            {text('Stoppages or observations', 'notes')}
          </>,
          'Post step',
          'Record at least one knitting entry before doffing rolls.',
          open(s).length > 0,
        ),
      )}
      {b ? batchDetail(s, b) : ''}
    </>
  );
}
function rollsTab(app, selected) {
  const s = app.data;
  const b = selectedRun(s, selected);
  const latest = open(s).flatMap((x) => {
    const e = ref(s.events, latestActive(x)?.eventId);
    return e ? [[x.id + '|' + e.id, x.number + ' · ' + e.id + ' · ' + (e.step || e.kind) + ' · ' + e.reference]] : [];
  });
  return (
    <>
      {split(
        editor(
          app,
          'knit-output',
          'Doff rolls',
          <>
            {runChoice(s, b?.id)}
            {text('Rolls: roll ID, kg, metres where measured', 'rolls', 'KR-001,55.2,142\nKR-002,55', true)}
            {select('Result', 'result', ['Accepted', 'Rework'], {
              initial: 'Accepted',
            })}
            {optionalNumber('Knitting loss kg (fly, ends, cut-offs)', 'waste', '0')}
            {optionalNumber('Rejects kg', 'rejects', '0')}
            {optionalNumber('Yarn consumed kg (default rolls + loss + rejects)', 'consumedKg')}
            {text('Yarn consumed by lot in kg, when weighed by colour', 'consumption', '')}
            {optional('Knitter', 'operator')}
            {optional('Shift', 'shift')}
            {day('Doffing date')}
            {field('Roll slip reference', 'reference')}
          </>,
          'Post rolls',
          'Each roll links to the yarn lots consumed in this posting by its share of the roll weight.',
          open(s).length > 0,
        ),
        editor(
          app,
          'knit-close',
          'Close a run',
          <>
            {runChoice(s, b?.id)}
            {day('Closure date')}
            {field('Closure reason', 'reason')}
            {check('Confirm remaining yarn as measured loss', 'lossConfirmed')}
            {optional('Measured loss reference', 'lossRef')}
          </>,
          'Close run',
        ),
        editor(
          app,
          'knit-reverse',
          'Reverse the latest posting',
          <>
            {select('Run and latest active posting', 'pick', latest)}
            {day('Reversal date')}
            {text('Reason', 'reason', '', true)}
          </>,
          'Post reversal',
        ),
      )}
      {panel(
        'Rolls',
        table(
          ['Roll', 'Component / construction', 'kg / metres', 'Machine and shift', 'Route', 'Location / quality'],
          rolls(s)
            .slice()
            .reverse()
            .map((l) => [
              lotLink(l.id),
              h(
                l.knit.component +
                  ' · ' +
                  l.knit.construction +
                  ' · ' +
                  l.knit.structure +
                  (l.knit.colours.length ? ' · ' + l.knit.colours.join('/') : ''),
              ),
              <>
                {h(fmt(l.netKg) + ' kg' + (l.lengthM ? ' · ' + fmt(l.lengthM) + ' m' : ''))}
                <br />
                <small>
                  {'on hand '}
                  {showQty(l.qty, l.unit)}
                </small>
              </>,
              h(l.knit.machine + ' · ' + l.knit.gauge + ' G · shift ' + (l.knit.shift || '—')),
              h(l.knit.route),
              <>
                {h(l.location)}
                <br />
                {txStatus(l.qualityStatus)}
              </>,
            ]),
          'No rolls yet.',
        ),
      )}
      {b ? batchDetail(s, b) : ''}
    </>
  );
}

// A roll's yarn lots (colour, count, cones and kg) and the selected route, then where the roll went next.
export function rollTrace(s, roll) {
  const issueLine = (lotId) =>
    s.processBatches.find((b) => b.id === roll.batchId)?.lines.find((l) => l.lotId === lotId);
  const yarns = roll.parents
    .filter((p) => p.role === 'Primary')
    .map((p) => {
      const lot = ref(s.lots, p.id);
      const line = issueLine(p.id);
      const dye = ref(s.processBatches, lot.batchId);
      const count = lotCount(s, lot);
      return [
        lotLink(lot.id),
        h(lot.material + (lot.colour ? ' · ' + lot.colour : '')),
        h(count ? count.count + ' ' + count.system + ' (' + count.source + ')' : line?.countBasis || 'Not recorded'),
        h(
          fmt(Math.round(p.qty * 1000) / 1000) +
            ' ' +
            p.unit +
            ' · ' +
            fmt(Math.round(p.kg * 100) / 100) +
            ' kg in this roll',
        ),
        h(dye ? dye.process + ' ' + dye.number + ' · ' + dye.recipe.code + ' r' + dye.recipe.version : lot.stage),
        h(
          [lot, ...genealogy(s, lot.id)]
            .filter((a) => a.claimSource === 'receipt' && a.material !== 'Chemical')
            .map((a) => a.id)
            .join(', ') || lot.id,
        ),
      ];
    });
  const wo = ref(s.workOrders, roll.workOrderId);
  const route = wo?.componentRoute;
  const next = genealogy(s, roll.id, true);
  const done = route
    ? route.stages.map((stage) => [
        stage,
        stage === 'Knitting' ? roll.id : [...next, ...genealogy(s, roll.id)].find((l) => l.stage === stage)?.id || '',
      ])
    : [];
  return panel(
    'Roll ' + roll.id,
    <>
      {facts([
        [
          'Roll',
          h(roll.knit.roll + ' · ' + fmt(roll.netKg) + ' kg' + (roll.lengthM ? ' · ' + fmt(roll.lengthM) + ' m' : '')),
        ],
        [
          'Construction',
          h(
            roll.knit.construction +
              ' · ' +
              roll.knit.component +
              ' · ' +
              roll.knit.structure +
              (roll.knit.stripe.length
                ? ' · stripe ' + roll.knit.stripe.map((c) => c.colour + ' ' + c.courses).join(' / ')
                : ''),
          ),
        ],
        ['Machine', h(roll.knit.machine + ' · ' + roll.knit.machineType + ' · ' + roll.knit.gauge + ' G')],
        [
          'Run and shift',
          h(roll.knit.run + ' · shift ' + (roll.knit.shift || '—') + ' · ' + (roll.knit.operator || '')),
        ],
        [
          'Production order',
          h(wo ? wo.number + (route ? ' · component ' + route.component + ' · BOM ' + route.bomRev : '') : '—'),
        ],
        [
          'Selected route',
          route
            ? h('Route ' + route.template + ' r' + route.version + ': ' + route.stages.map(stageLabel).join(' → '))
            : h(roll.knit.route),
        ],
      ])}
      {details(
        'Actual yarn lots in this roll',
        table(
          ['Yarn lot', 'Material / colour', 'Count', 'In this roll', 'Dyed or spun on', 'Received source lots'],
          yarns,
        ),
        true,
      )}
      {route
        ? details(
            'Route progress',
            table(
              ['Operation', 'Lot', 'Status'],
              done.map(([stage, lotId]) => [
                h(stageLabel(stage)),
                lotId ? lotLink(lotId) : '—',
                lotId ? badge('Posted') : badge('Pending', 'warn'),
              ]),
            ),
            true,
          )
        : ''}
      {details(
        'Where the roll went',
        table(
          ['Lot', 'Material / stage', 'On hand'],
          next.map((l) => [lotLink(l.id), h(l.material + ' · ' + stageLabel(l.stage)), showQty(l.qty, l.unit)]),
          'Not yet used downstream.',
        ),
        true,
      )}
    </>,
  );
}
function trace(app) {
  const s = app.data;
  const roll = ref(s.lots, app.local.knitRoll);
  return (
    <>
      {panel(
        'Find a roll',
        <>
          {form(
            'knit-trace',
            field('Roll ID or scanned label', 'rollId', {
              value: app.local.knitRoll || '',
              placeholder: 'KR-STR-001',
            }),
            'Trace roll',
          )}
          {note('A lookup only retrieves the record.')}
        </>,
      )}
      {roll?.knit
        ? rollTrace(s, roll)
        : app.local.knitRoll
          ? note('No knitted roll matches ' + app.local.knitRoll + '.', true)
          : ''}
    </>
  );
}
function history(app) {
  const s = app.data;
  const lot = ref(s.lots, app.local.knitLot);
  return (
    <>
      {panel(
        'Find a lot',
        form(
          'knit-history',
          field('Lot ID or scanned label', 'lotId', {
            value: lot?.id || '',
            required: false,
          }),
          'Show history',
        ),
      )}
      {lot ? lotHistory(s, lot) : ''}
    </>
  );
}
function KnittingPage({ app }) {
  const p = params();
  const tab = tabs.some(([key]) => key === p.get('tab')) ? p.get('tab') : 'setup';
  const body = {
    setup,
    work,
    issue,
    steps,
    rolls: rollsTab,
    trace,
    history,
  }[tab](app, p.get('batch') || '');
  return (
    <>
      {heading(
        'Knitting',
        'Knit greige fabric from undyed yarn or yarn-dyed fabric from dyed cones, on the machine type and gauge the construction specifies. Each roll records its yarn lots, machine, shift, kg and metres.',
        <a className="button secondary" href="#trace">
          {'Scan & trace'}
        </a>,
      )}
      {tabBar(tab)}
      {body}
    </>
  );
}
export { KnittingPage };
