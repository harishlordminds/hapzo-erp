import { joinContent } from './react-ui.jsx';
import { ref, genealogy } from '../src/model.js';
import { schemeNames } from '../src/standards.js';
import { RATE_KEYS, wipKg, latestActive } from '../src/process-batch.js';
import { stageLabel } from '../src/routes.js';
import { WEAVE, LOOM, WEAVES, LOOM_TYPES, WEFT_PREP, DRESSING, loomProfile, weftState } from '../src/weaving.js';
import {
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
} from './ui.jsx';
const tabs = [
  ['setup', 'Setup'],
  ['warp', 'Warp path'],
  ['weft', 'Weft path'],
  ['loom', 'Loom'],
  ['rolls', 'Roll trace'],
  ['history', 'Lot history'],
];
const open = (s, process) =>
  s.processBatches.filter((b) => b.process === process && ['Open', 'In process'].includes(b.status));
const works = (s, stage) =>
  s.workOrders.filter((w) => w.stage === stage && ['Released', 'In progress'].includes(w.status));
const specs = (s) => s.processSetups.filter((r) => r.process === WEAVE && r.status === 'Approved');
const batchTitle = (b) => b.number + ' · ' + recipeText(b) + ' · WIP ' + fmt(wipKg(b)) + ' kg';
const batchChoice = (s, process, label, selected) =>
  choose(label, 'batchId', open(s, process), batchTitle, {
    initial: selected,
  });
const kg = (n) => fmt(Math.round(n * 1000) / 1000);
const routes = (s, stage) => s.componentRoutes.filter((r) => r.status === 'Approved' && r.stages.includes(stage));
function tabBar(selected) {
  return (
    <nav className="actions" aria-label="Weaving screens">
      {joinContent(
        tabs.map(([key, label]) => (
          <a
            className={'button ' + (key === selected ? '' : 'secondary')}
            href={'#weaving?tab=' + key}
            aria-current={key === selected ? 'page' : undefined}>
            {h(label)}
          </a>
        )),
        '',
      )}
    </nav>
  );
}
function workForm(app, s, stage, label) {
  return editor(
    app,
    'work-order',
    'Release ' + label + ' order',
    <>
      {hidden('stage', stage)}
      {hidden('unit', 'kg')}
      {field('Work order number', 'number')}
      {choose(
        'Approved component route',
        'componentRouteId',
        routes(s, stage),
        (r) => r.lineId + ' · ' + r.component + ' · route ' + r.template + ' · ' + r.stages.join(' → '),
        {
          required: false,
          blank: 'Stock order',
        },
      )}
      {choose('Output location', 'locationId', s.locations, titles.location)}
      {requiredNumber('Planned kg', 'plannedQty')}
      {select('Standard for stock orders', 'scheme', schemeNames(s), {
        initial: 'Conventional',
      })}
      {day('Release date')}
    </>,
    'Release order',
  );
}
function reverseForm(app, s, process, action) {
  const latest = open(s, process).flatMap((b) => {
    const e = ref(s.events, latestActive(b)?.eventId);
    return e ? [[b.id + '|' + e.id, b.number + ' · ' + e.id + ' · ' + (e.step || e.kind) + ' · ' + e.reference]] : [];
  });
  return editor(
    app,
    action,
    'Reverse the latest ' + process.toLowerCase() + ' posting',
    <>
      {select('Set or run and latest posting', 'pick', latest)}
      {day('Reversal date')}
      {text('Reason', 'reason', '', true)}
    </>,
    'Post reversal',
  );
}
function setup(app) {
  const s = app.data;
  const all = s.processSetups.filter((r) => r.process === WEAVE);
  return (
    <>
      {split(
        editor(
          app,
          'loom-setup',
          'Record a loom',
          <>
            {choose('Loom', 'machineId', s.machines, (m) => m.code + ' · ' + m.name)}
            {select('Loom type', 'type', LOOM_TYPES)}
            {requiredNumber('Reed width cm', 'widthCm')}
            {optionalNumber('Weft selectors (colours)', 'selectors', '1')}
            {optional('Shedding', 'shedding')}
            {day('Effective date', 'effective')}
            {field('Loom setting or audit reference', 'reference')}
          </>,
          'Save loom',
          'A run opens only on a loom of the construction’s type, wide enough for its reed space, with enough weft selectors.',
          !s.processSetups.some((r) => r.process === LOOM),
        ),
        editor(
          app,
          'weave-setup',
          'Approve a weave construction',
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
            {optional('BOM component code', 'bomCode')}
            {select('Weave', 'weave', WEAVES)}
            {check('Yarn-dyed (route B); greige otherwise (route D)', 'yarnDyed')}
            {requiredNumber('Total warp ends', 'ends')}
            {optionalNumber('Reed dents per inch', 'reedDents')}
            {optionalNumber('Ends per dent', 'endsPerDent')}
            {requiredNumber('Reed space cm', 'reedSpaceCm')}
            {requiredNumber('Picks per cm', 'picksPerCm')}
            {requiredNumber('Warp count', 'warpCount')}
            {requiredNumber('Weft count', 'weftCount')}
            {select('Count system', 'countSystem', ['Ne', 'Nm', 'tex', 'den'], {
              initial: 'Ne',
            })}
            {optionalNumber('Warp crimp %', 'warpCrimp')}
            {optionalNumber('Weft crimp %', 'weftCrimp')}
            {text('Warp colour sequence: colour and ends per repeat', 'warpSequence', 'Red,24\nNavy,24')}
            {text('Weft insertion sequence: colour and picks per repeat', 'weftSequence', 'Navy,24\nRed,24')}
            {check('Size the warp', 'sizing')}
            {optional('Size recipe', 'sizeRecipe')}
            {select('Weft preparation required', 'weftPrep', WEFT_PREP, {
              initial: 'None',
            })}
            {select('Loom type', 'loomType', LOOM_TYPES)}
            {optionalNumber('Greige width cm', 'widthCm')}
            {optionalNumber('Target GSM', 'gsm')}
            {optionalNumber('Planned yield %', 'yieldPct', '97')}
            {joinContent(
              Object.entries(RATE_KEYS).map(([k, label]) => optionalNumber(label, k + 'Rate')),
              '',
            )}
            {optional('Approved rate card reference', 'rateRef')}
            {field('Construction approval reference', 'reference')}
          </>,
          'Approve construction',
          'A sized warp needs a route with Sizing and Desizing. Warper’s beams of a sized warp join at sizing; an unsized loom beam carries all ends.',
          !specs(s).length,
        ),
      )}
      {panel(
        'Looms',
        table(
          ['Loom', 'Type', 'Width / selectors', 'Revision', 'Reference'],
          s.machines
            .map((m) => loomProfile(s, m.id))
            .filter(Boolean)
            .map((p) => [
              h(p.machine),
              h(p.type + (p.shedding ? ' · ' + p.shedding : '')),
              h(p.widthCm + ' cm · ' + p.selectors + ' selector(s)'),
              h('r' + p.version + ' · ' + p.effective),
              h(p.reference),
            ]),
          'No looms recorded.',
        ),
      )}
      {panel(
        'Weave constructions',
        table(
          ['Construction', 'Weave and set', 'Warp / weft', 'Colour sequences', 'Sizing / weft prep / loom', 'Status'],
          all
            .slice()
            .reverse()
            .map((r) => [
              h(r.code + ' r' + r.version + (r.bomCode ? ' · ' + r.bomCode : '')),
              h(
                r.weave +
                  (r.yarnDyed ? ' · yarn-dyed' : ' · greige') +
                  ' · ' +
                  r.ends +
                  ' ends · ' +
                  r.picksPerCm +
                  ' picks/cm · reed space ' +
                  r.reedSpaceCm +
                  ' cm',
              ),
              h(
                r.warpCount +
                  ' / ' +
                  r.weftCount +
                  ' ' +
                  r.countSystem +
                  ' · crimp ' +
                  r.warpCrimp +
                  '% / ' +
                  r.weftCrimp +
                  '%',
              ),
              h(
                r.warpSequence.length
                  ? 'Warp ' +
                      r.warpSequence.map((c) => c.colour + ' ' + c.ends).join(' / ') +
                      ' · weft ' +
                      r.weftSequence.map((c) => c.colour + ' ' + c.picks).join(' / ')
                  : '—',
              ),
              h((r.sizing ? 'Sized: ' + r.sizeRecipe : 'Unsized') + ' · ' + r.weftPrep + ' · ' + r.loomType),
              txStatus(r.status),
            ]),
          'No constructions approved yet.',
        ),
      )}
    </>
  );
}
function warp(app, selected) {
  const s = app.data;
  const loomBeams = s.lots.filter((l) => l.weave?.beamType === 'Loom beam' && l.qty > 0);
  const looms = s.machines.filter((m) => loomProfile(s, m.id));
  return (
    <>
      {split(
        workForm(app, s, 'Warping', 'warping'),
        editor(
          app,
          'warp-open',
          'Open a warp set',
          <>
            {choose('Warping order', 'workOrderId', works(s, 'Warping'), titles.wo)}
            {field('Warp set number', 'number')}
            {choose(
              'Warping machine',
              'machineId',
              s.machines.filter((m) => m.status === 'In service'),
              (m) => m.code + ' · ' + m.name,
            )}
            {choose(
              'Weave construction',
              'recipeId',
              specs(s),
              (r) => r.code + ' r' + r.version + ' · ' + r.ends + ' ends',
            )}
            {requiredNumber('Planned warp kg', 'plannedKg')}
            {day('Set date')}
          </>,
          'Open warp set',
        ),
        editor(
          app,
          'warp-issue',
          'Issue allocated warp yarn',
          <>
            {batchChoice(s, 'Warping', 'Warp set', selected)}
            {text('Lots and quantity (cones or kg)', 'lines', 'YRN-WP-01,400', true)}
            {optional('Weighing slip for measured kg', 'conversionRef')}
            {day('Issue date')}
            {field('Issue slip', 'reference')}
          </>,
          'Post issue',
          'Each lot must be allocated as warp to this warping order (Yarn dyeing → Knitting, warp and weft).',
        ),
        editor(
          app,
          'warp-entry',
          'Record creel loading or warping',
          <>
            {batchChoice(s, 'Warping', 'Warp set', selected)}
            {select('Step', 'step', ['Creel loading', 'Warping', 'Beam doffing'], {
              initial: 'Warping',
            })}
            {stamp('Start', 'start', now('06:00'))}
            {stamp('End', 'end', now('10:00'))}
            {field('Operator', 'operator')}
            {field('Shift', 'shift')}
            {optionalNumber('Electricity kWh', 'electricity', '0')}
            {optionalNumber('Labour hours', 'labourHours', '0')}
            {field('Log reference', 'reference')}
          </>,
          'Post step',
        ),
        editor(
          app,
          'warp-beams',
          'Doff beams (warper’s or loom beams)',
          <>
            {batchChoice(s, 'Warping', 'Warp set', selected)}
            {text('Beams: beam ID, ends, metres, kg', 'beams', 'WB-001,1200,1000,99', true)}
            {optionalNumber('Warping waste kg', 'waste', '0')}
            {day('Doffing date')}
            {field('Doffing reference', 'reference')}
          </>,
          'Post beams',
          'An unsized construction makes the loom beam here and it must carry all ends.',
        ),
        workForm(app, s, 'Sizing', 'sizing'),
        editor(
          app,
          'size-open',
          'Open a sizing set',
          <>
            {choose('Sizing order', 'workOrderId', works(s, 'Sizing'), titles.wo)}
            {field('Sizing set number', 'number')}
            {choose(
              'Sizing machine',
              'machineId',
              s.machines.filter((m) => m.status === 'In service'),
              (m) => m.code + ' · ' + m.name,
            )}
            {choose(
              'Weave construction',
              'recipeId',
              specs(s).filter((r) => r.sizing),
              (r) => r.code + ' r' + r.version + ' · ' + r.sizeRecipe,
            )}
            {requiredNumber('Planned warp kg', 'plannedKg')}
            {day('Set date')}
          </>,
          'Open sizing set',
        ),
        editor(
          app,
          'size-issue',
          'Creel warper’s beams',
          <>
            {batchChoice(s, 'Sizing', 'Sizing set', selected)}
            {text('Beams and kg', 'lines', 'WB-001,99', true)}
            {day('Issue date')}
            {field('Issue slip', 'reference')}
          </>,
          'Post issue',
        ),
        editor(
          app,
          'size-entry',
          'Record size preparation, sizing or drying',
          <>
            {batchChoice(s, 'Sizing', 'Sizing set', selected)}
            {select('Step', 'step', ['Size preparation', 'Creel loading', 'Sizing', 'Drying', 'Beaming'], {
              initial: 'Sizing',
            })}
            {stamp('Start', 'start', now('10:00'))}
            {stamp('End', 'end', now('13:00'))}
            {field('Operator', 'operator')}
            {field('Shift', 'shift')}
            {text('Size chemical lots and kg', 'chemicals', 'CHEM-SZ-01,40')}
            {optionalNumber('Temperature °C', 'temperature', '', -20)}
            {optionalNumber('Steam kg', 'steam', '0')}
            {optionalNumber('Electricity kWh', 'electricity', '0')}
            {optionalNumber('Labour hours', 'labourHours', '0')}
            {field('Log reference', 'reference')}
          </>,
          'Post step',
        ),
        editor(
          app,
          'size-beams',
          'Doff the loom beam',
          <>
            {batchChoice(s, 'Sizing', 'Sizing set', selected)}
            {text('Loom beams: beam ID, ends, metres, kg', 'beams', 'LB-001,4800,990,431', true)}
            {optionalNumber('Size add-on kg (measured)', 'adjustment', '', -100000000)}
            {optional('Add-on basis', 'adjustmentRef')}
            {optionalNumber('Sizing waste kg', 'waste', '0')}
            {day('Doffing date')}
            {field('Doffing reference', 'reference')}
          </>,
          'Post loom beam',
          'All warper’s beams of the set and a size chemical lot must be linked before the loom beam posts.',
        ),
        editor(
          app,
          'beam-dress',
          'Drawing-in or tying-in',
          <>
            {choose(
              'Loom beam',
              'lotId',
              loomBeams.filter((l) => !l.dressing),
              (l) => l.id + ' · ' + l.weave.construction + ' · ' + l.weave.ends + ' ends',
            )}
            {choose('Loom', 'loomId', looms, (m) => m.code + ' · ' + m.name)}
            {select('Method', 'method', DRESSING)}
            {choose(
              'Beam being replaced (tying-in)',
              'previousBeamId',
              s.lots.filter((l) => l.dressing),
              (l) => l.id + ' on ' + l.dressing.loom,
              {
                required: false,
              },
            )}
            {requiredNumber('Ends drawn or tied', 'ends')}
            {optional('Heald plan', 'healds')}
            {optional('Reed', 'reed')}
            {field('Drawer or tier', 'operator')}
            {day('Date')}
            {field('Reference', 'reference')}
          </>,
          'Post dressing',
        ),
        reverseForm(app, s, 'Warping', 'warp-reverse'),
        reverseForm(app, s, 'Sizing', 'size-reverse'),
      )}
      {panel(
        'Beams',
        table(
          ['Beam', 'Type and construction', 'Ends / metres / kg', 'Inputs', 'Dressing', 'On hand'],
          s.lots
            .filter((l) => l.material === 'Warp beam' && l.weave)
            .slice()
            .reverse()
            .map((l) => [
              lotLink(l.id),
              h(l.weave.beamType + ' · ' + l.weave.construction + (l.weave.sized ? ' · sized' : '')),
              h(l.weave.ends + ' ends · ' + fmt(l.lengthM) + ' m · ' + fmt(l.netKg) + ' kg'),
              joinContent(
                l.parents.map((p) => lotLink(p.id)),
                ', ',
              ),
              h(
                l.dressing
                  ? l.dressing.method + ' on ' + l.dressing.loom + ' · ' + l.dressing.reference
                  : 'Not dressed',
              ),
              showQty(l.qty, l.unit),
            ]),
          'No beams yet.',
        ),
      )}
      {joinContent(
        ['Warping', 'Sizing']
          .map((p) => open(s, p)[0])
          .filter(Boolean)
          .map((b) => batchDetail(s, b)),
        '',
      )}
    </>
  );
}
function weft(app) {
  const s = app.data;
  const wefts = s.lots.filter((l) => (l.assignments ?? []).some((a) => a.role === 'Weft'));
  return (
    <>
      {split(
        editor(
          app,
          'yarn-assign',
          'Allocate weft lots to a weaving order',
          <>
            {hidden('role', 'Weft')}
            {hidden('mode', 'Assign')}
            {choose(
              'Weft lot',
              'lotId',
              s.lots.filter((l) => ['Yarn', 'Dyed yarn'].includes(l.material) && l.qty > 0),
              titles.lot,
            )}
            {choose('Weaving order', 'workOrderId', works(s, 'Weaving'), titles.wo)}
            {requiredNumber('Quantity in lot unit', 'qty')}
            {day('Date')}
            {field('Allocation reference', 'reference')}
          </>,
          'Allocate weft',
        ),
        editor(
          app,
          'weft-prep',
          'Prepare weft packages',
          <>
            {choose(
              'Allocated weft lot',
              'lotId',
              wefts.filter((l) => l.qty > 0),
              titles.lot,
            )}
            {select(
              'Preparation',
              'method',
              WEFT_PREP.filter((m) => m !== 'None'),
            )}
            {requiredNumber('Quantity prepared in lot unit', 'qty')}
            {optionalNumber('Packages produced', 'packages')}
            {choose(
              'Machine',
              'machineId',
              s.machines.filter((m) => m.status === 'In service'),
              (m) => m.code + ' · ' + m.name,
              {
                required: false,
              },
            )}
            {day('Date')}
            {field('Preparation reference', 'reference')}
          </>,
          'Post preparation',
          'When the construction requires preparation, an unprepared weft lot cannot be issued to the loom.',
        ),
      )}
      {panel(
        'Weft lots',
        table(
          ['Lot', 'Colour', 'On hand', 'Allocated to', 'Prepared', 'Loom runs'],
          wefts.map((l) => [
            lotLink(l.id),
            h(l.colour || '—'),
            showQty(l.qty, l.unit),
            h(
              l.assignments
                .filter((a) => a.role === 'Weft')
                .map((a) => a.workOrder + ' ' + fmt(a.used) + '/' + fmt(a.qty))
                .join(', '),
            ),
            h(
              (l.weftPrep ?? [])
                .map((p) => p.method + ' ' + fmt(p.qty) + (p.packages ? ' (' + p.packages + ' packages)' : ''))
                .join(', ') || '—',
            ),
            h(
              s.processBatches
                .filter((b) => b.process === 'Weaving' && b.lines.some((x) => x.lotId === l.id))
                .map((b) => b.number)
                .join(', ') || '—',
            ),
          ]),
          'No weft allocated yet.',
        ),
      )}
    </>
  );
}
function timeline(s, b) {
  const entries = s.events.filter((e) => e.batchId === b.id && e.kind === 'Process entry' && !e.reversedBy);
  const feed = entries.find((e) => e.weftFeed?.length);
  const rows = [
    ...(feed
      ? feed.weftFeed.map((f) => [
          '0',
          h('Feeder plan'),
          h(f.feeder),
          lotLink(f.lotId),
          h(f.colour || '—'),
          h(feed.reference),
        ])
      : []),
    ...entries
      .filter((e) => e.weftChange)
      .sort((p, q) => p.weftChange.atMetre - q.weftChange.atMetre)
      .map((e) => [
        h(fmt(e.weftChange.atMetre)),
        h('Package change' + (e.weftChange.packages ? ' · ' + e.weftChange.packages + ' packages' : '')),
        h(e.weftChange.feeder),
        <>
          {lotLink(e.weftChange.fromLot)}
          {' → '}
          {lotLink(e.weftChange.toLot)}
        </>,
        '—',
        h(e.reference),
      ]),
  ];
  const rolls = s.events.filter((e) => e.batchId === b.id && e.kind === 'Production' && !e.reversedBy);
  return panel(
    'Weft insertion and rolls · ' + b.number,
    <>
      {table(
        ['Loom metre', 'Event', 'Feeder', 'Weft lot', 'Colour', 'Reference'],
        rows,
        'No feeder plan recorded yet.',
      )}
      {table(
        ['Roll', 'Seq', 'Metres on loom', 'Segments and weft', 'kg'],
        rolls.map((e) => [
          lotLink(e.output),
          h(e.roll.seq),
          h(fmt(e.roll.fromM) + '–' + fmt(e.roll.toM) + ' m'),
          h(
            e.segments
              .map(
                (g) => fmt(g.fromM) + '–' + fmt(g.toM) + ': ' + g.weft.map((w) => w.feeder + ' ' + w.lotId).join(', '),
              )
              .join(' | '),
          ),
          h(fmt(e.qty)),
        ]),
        'No rolls doffed yet.',
      )}
    </>,
  );
}
function loom(app, selected) {
  const s = app.data;
  const b =
    ref(s.processBatches, selected) ||
    open(s, 'Weaving')[0] ||
    s.processBatches.filter((x) => x.process === 'Weaving').at(-1);
  const state = b ? weftState(s, b, Infinity) : null;
  return (
    <>
      {split(
        workForm(app, s, 'Weaving', 'weaving'),
        editor(
          app,
          'loom-open',
          'Open a loom run',
          <>
            {choose('Weaving order', 'workOrderId', works(s, 'Weaving'), titles.wo)}
            {field('Run number', 'number')}
            {choose(
              'Loom',
              'machineId',
              s.machines.filter((m) => loomProfile(s, m.id)),
              (m) => m.code + ' · ' + loomProfile(s, m.id).type + ' · ' + loomProfile(s, m.id).widthCm + ' cm',
            )}
            {choose('Weave construction', 'recipeId', specs(s), (r) => r.code + ' r' + r.version)}
            {requiredNumber('Planned kg', 'plannedKg')}
            {day('Run date')}
          </>,
          'Open run',
        ),
        editor(
          app,
          'loom-issue',
          'Gait the beam and issue weft',
          <>
            {batchChoice(s, 'Weaving', 'Loom run', b?.id)}
            {text('Beam and weft lots with quantity', 'lines', 'LB-001,431\nYRN-WF-01,40', true)}
            {day('Issue date')}
            {field('Issue slip', 'reference')}
          </>,
          'Post issue',
          'The beam must be drawn in or tied in on this loom. Weft must be allocated to the order and prepared if the construction requires it.',
        ),
        editor(
          app,
          'loom-entry',
          'Record weaving, a weft package change or a stoppage',
          <>
            {batchChoice(s, 'Weaving', 'Loom run', b?.id)}
            {select('Step', 'step', ['Beam gaiting', 'Weaving', 'Weft package change', 'Loom stoppage', 'Doffing'], {
              initial: 'Weaving',
            })}
            {stamp('Start', 'start', now('06:00'))}
            {stamp('End', 'end', now('14:00'))}
            {field('Weaver', 'operator')}
            {field('Shift', 'shift')}
            {text('Feeder plan on the first weaving step: feeder, weft lot', 'weftFeed', 'F1,YRN-WF-01')}
            {optional('Feeder (package change)', 'feeder')}
            {optional('New weft lot (package change)', 'toLot')}
            {optionalNumber('Loom metre counter at the change', 'atMetre')}
            {optionalNumber('Packages changed', 'packages')}
            {optionalNumber('Electricity kWh', 'electricity', '0')}
            {optionalNumber('Labour hours', 'labourHours', '0')}
            {field('Log reference', 'reference')}
          </>,
          'Post step',
          'A package change takes effect at its loom metre. Rolls are cut into segments there, each keeping its own weft lots.',
        ),
        editor(
          app,
          'loom-roll',
          'Doff a roll',
          <>
            {batchChoice(s, 'Weaving', 'Loom run', b?.id)}
            {field('Roll ID', 'rollId')}
            {requiredNumber('Woven metres (loom counter)', 'metres')}
            {requiredNumber('Measured roll kg', 'kg')}
            {optionalNumber('Loom waste kg (selvedge, fringe)', 'waste', '0')}
            {check('Remnant piece', 'remnant')}
            {optional('Weaver', 'operator')}
            {optional('Shift', 'shift')}
            {day('Doffing date')}
            {field('Doffing reference', 'reference')}
          </>,
          'Post roll',
          'Warp is drawn from the beam by metres with crimp; weft is the roll weight less warp. The posting is blocked if the beam or a feeder lot is missing from the run.',
        ),
        editor(
          app,
          'loom-return',
          'Return beam remnant and unused weft',
          <>
            {batchChoice(s, 'Weaving', 'Loom run', b?.id)}
            {text('Lots and quantity', 'lines', '', true)}
            {text('Remnant note', 'notes')}
            {day('Return date')}
            {field('Return reference', 'reference')}
          </>,
          'Post return',
        ),
        editor(
          app,
          'loom-close',
          'Close a loom run',
          <>
            {batchChoice(s, 'Weaving', 'Loom run', b?.id)}
            {day('Closure date')}
            {field('Closure reason', 'reason')}
            {check('Confirm remainder as measured loss', 'lossConfirmed')}
            {optional('Measured loss reference', 'lossRef')}
          </>,
          'Close run',
        ),
        reverseForm(app, s, 'Weaving', 'loom-reverse'),
      )}
      {b ? (
        <>
          {state
            ? note(
                'Current feeders on ' +
                  b.number +
                  ': ' +
                  [...state.values()]
                    .map((f) => f.feeder + ' ' + f.lotId + (f.colour ? ' (' + f.colour + ')' : ''))
                    .join(', '),
              )
            : ''}
          {timeline(s, b)}
          {batchDetail(s, b)}
        </>
      ) : (
        ''
      )}
    </>
  );
}
export function rollTrace(s, roll) {
  const w = roll.weave;
  const beam = ref(s.lots, w.warpBeam);
  const warpYarn = genealogy(s, beam.id).filter((l) => ['Yarn', 'Dyed yarn'].includes(l.material));
  const sizeLots = genealogy(s, beam.id).filter((l) => l.material === 'Chemical');
  const wo = ref(s.workOrders, roll.workOrderId);
  const route = wo?.componentRoute;
  const next = genealogy(s, roll.id, true);
  return panel(
    'Roll ' + roll.id,
    <>
      {facts([
        [
          'Roll',
          h(
            'Roll ' +
              w.rollSeq +
              ' of ' +
              w.run +
              ' · ' +
              fmt(w.fromM) +
              '–' +
              fmt(w.toM) +
              ' m on the loom · ' +
              fmt(roll.netKg) +
              ' kg' +
              (w.remnant ? ' · remnant' : ''),
          ),
        ],
        [
          'Construction',
          h(
            w.construction +
              ' · ' +
              w.weave +
              (w.yarnDyed ? ' · yarn-dyed' : ' · greige') +
              ' · ' +
              w.ends +
              ' ends · ' +
              w.picksPerCm +
              ' picks/cm',
          ),
        ],
        ['Loom', h(w.loom + ' · ' + w.loomType + ' · shift ' + (w.shift || '—') + ' · ' + (w.weaver || ''))],
        [
          'Warp',
          <>
            {lotLink(beam.id)}
            {h(
              ' · ' +
                beam.weave.beamType +
                (beam.weave.sized ? ', sized' : '') +
                ' · ' +
                kg(w.warpKg) +
                ' kg drawn · ' +
                (beam.dressing ? beam.dressing.method + ' ' + beam.dressing.reference : ''),
            )}
          </>,
        ],
        [
          'Warp yarn lots',
          joinContent(
            warpYarn.map((l) => (
              <>
                {lotLink(l.id)}
                {h(l.colour ? ' ' + l.colour : '')}
              </>
            )),
            ', ',
          ) || '—',
        ],
        [
          'Size chemical lots',
          joinContent(
            sizeLots.map((l) => lotLink(l.id)),
            ', ',
          ) || '—',
        ],
        [
          'Selected route',
          route
            ? h('Route ' + route.template + ' r' + route.version + ': ' + route.stages.map(stageLabel).join(' → '))
            : h(w.route),
        ],
      ])}
      {details(
        'Weft by segment',
        table(
          ['Segment', 'Loom metres', 'Feeder', 'Weft lot', 'Colour', 'Weft kg', 'On feeder since'],
          w.segments.flatMap((g) =>
            g.weft.map((x) => [
              h(g.seq),
              h(fmt(g.fromM) + '–' + fmt(g.toM) + ' m (' + fmt(g.metres) + ' m)'),
              h(x.feeder),
              lotLink(x.lotId),
              h(x.colour || '—'),
              h(kg(x.kg)),
              h(fmt(x.since) + ' m'),
            ]),
          ),
        ),
        true,
      )}
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
function rolls(app) {
  const s = app.data;
  const roll = ref(s.lots, app.local.weaveRoll);
  const all = s.lots.filter((l) => l.weave?.segments);
  return (
    <>
      {panel(
        'Find a roll',
        <>
          {form(
            'weave-trace',
            field('Roll ID or scanned label', 'rollId', {
              value: app.local.weaveRoll || '',
              placeholder: 'GR-061-02',
            }),
            'Trace roll',
          )}
          {note('A lookup only retrieves the record.')}
        </>,
      )}
      {roll?.weave?.segments
        ? rollTrace(s, roll)
        : app.local.weaveRoll
          ? note('No woven roll matches ' + app.local.weaveRoll + '.', true)
          : ''}
      {panel(
        'Woven rolls',
        table(
          ['Roll', 'Run and metres', 'Weft lots by segment', 'kg', 'Quality / on hand'],
          all
            .slice()
            .reverse()
            .map((l) => [
              lotLink(l.id),
              h(l.weave.run + ' · ' + fmt(l.weave.fromM) + '–' + fmt(l.weave.toM) + ' m'),
              h(l.weave.segments.map((g) => g.weft.map((x) => x.lotId).join('+')).join(' | ')),
              h(fmt(l.netKg)),
              <>
                {txStatus(l.qualityStatus)}
                {' · '}
                {showQty(l.qty, l.unit)}
              </>,
            ]),
          'No rolls yet.',
        ),
      )}
    </>
  );
}
function history(app) {
  const s = app.data;
  const lot = ref(s.lots, app.local.weaveLot);
  return (
    <>
      {panel(
        'Find a lot',
        form(
          'weave-history',
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
function WeavingPage({ app }) {
  const p = params();
  const tab = tabs.some(([key]) => key === p.get('tab')) ? p.get('tab') : 'setup';
  const body = {
    setup,
    warp,
    weft,
    loom,
    rolls,
    history,
  }[tab](app, p.get('batch') || '');
  return (
    <>
      {heading(
        'Weaving',
        'Prepare warp and weft separately, then weave on the loom. Each roll keeps its beam, its warp yarn and, segment by segment, the weft lots actually inserted.',
        <a className="button secondary" href="#trace">
          {'Scan & trace'}
        </a>,
      )}
      {tabBar(tab)}
      {body}
    </>
  );
}
export { WeavingPage };
