import { joinContent } from './react-ui.jsx';
import { ref } from '../src/model.js';
import { schemeNames } from '../src/standards.js';
import { RATE_KEYS, wipKg, latestActive } from '../src/process-batch.js';
import {
  SPINNING,
  SPIN_ROUTES,
  SPIN_SYSTEMS,
  COUNT_SYSTEMS,
  SPIN_INPUTS,
  spinSettings,
  preparationRecord,
  countLabel,
} from '../src/spinning.js';
import { scanRecord } from '../src/fibre.js';
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
  heading,
} from './ui.jsx';
const tabs = [
  ['setup', 'Setup'],
  ['work', 'Work order'],
  ['issue', 'Fibre issue'],
  ['steps', 'Process steps'],
  ['output', 'Yarn packing'],
  ['yarn', 'Yarn sale and transfer'],
  ['scan', 'Yarn scan'],
  ['history', 'Lot history'],
];
const open = (s) => s.processBatches.filter((b) => b.process === SPINNING && ['Open', 'In process'].includes(b.status));
const works = (s) => s.workOrders.filter((w) => w.stage === SPINNING && ['Released', 'In progress'].includes(w.status));
const plans = (s) => s.processSetups.filter((r) => r.process === SPINNING && r.status === 'Approved');
const lotTitle = (b) => b.number + ' · ' + recipeText(b) + ' · WIP ' + fmt(wipKg(b)) + ' kg';
const lotChoice = (s, selected) =>
  choose('Spin lot', 'batchId', open(s), lotTitle, {
    initial: selected,
  });
const machines = (s) => s.machines.filter((m) => m.status === 'In service');
const selectedLot = (s, selected) =>
  ref(s.processBatches, selected) || open(s)[0] || s.processBatches.filter((b) => b.process === SPINNING).at(-1);
function tabBar(selected) {
  return (
    <nav className="actions" aria-label="Spinning screens">
      {joinContent(
        tabs.map(([key, label]) => (
          <a
            className={'button ' + (key === selected ? '' : 'secondary')}
            href={'#spinning?tab=' + key}
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
  const cfg = spinSettings(s);
  const routes = Object.entries(SPIN_ROUTES)
    .filter(([, r]) => cfg.systems.includes(r.system))
    .map(([k]) => k);
  return (
    <>
      {split(
        editor(
          app,
          'spin-config',
          'Spinning systems configured at this mill',
          <>
            {joinContent(
              SPIN_SYSTEMS.map((name) => (
                <label className="check">
                  <input
                    type="checkbox"
                    name={name.toLowerCase()}
                    defaultValue="yes"
                    defaultChecked={cfg.systems.includes(name)}
                  />{' '}
                  {h(name)}
                  {' spinning'}
                </label>
              )),
              '',
            )}
            {field('Configuration revision', 'version', {
              value: cfg.version ? String(Number(cfg.version) + 1 || '') : '1',
            })}
            {day('Effective date', 'effective')}
            {field('Approval reference', 'reference')}
          </>,
          'Save configuration',
          'Only configured systems can be used in count plans and spin lots.',
          !cfg.version,
        ),
        editor(
          app,
          'spin-setup',
          'Approve a count plan',
          <>
            {field('Plan code', 'code')}
            {field('Revision', 'version', {
              value: '1',
            })}
            {select('Route', 'route', routes)}
            {day('Effective date', 'effective')}
            {requiredNumber('Nominal count', 'count')}
            {select('Count system', 'countSystem', COUNT_SYSTEMS, {
              initial: 'Ne',
            })}
            {optionalNumber('Count tolerance ± %', 'countTolerancePct', '2')}
            {field('Composition', 'composition', {
              value: '100% cotton',
            })}
            {optional('Twist (TPI or TM)', 'twist')}
            {optionalNumber('Nominal cone kg', 'coneKg')}
            {optionalNumber('Planned yarn yield %', 'yieldPct')}
            {optionalNumber('Planned noil % (combed)', 'noilPct')}
            {optionalNumber('Planned waste %', 'wastePct')}
            {joinContent(
              Object.entries(RATE_KEYS).map(([k, label]) => optionalNumber(label, k + 'Rate')),
              '',
            )}
            {optional('Approved rate card reference', 'rateRef')}
            {field('Plan approval reference', 'reference')}
          </>,
          'Approve count plan',
          'The route fixes the process steps: carded or combed preparation, roving for ring spinning, and winding.',
          !plans(s).length,
        ),
      )}
      {panel(
        'Mill configuration',
        facts([
          ['Systems', h(cfg.systems.join(', '))],
          [
            'Revision',
            h(
              cfg.version
                ? cfg.version + ' · ' + cfg.effective + ' · ' + cfg.reference
                : 'Default: ring only (not yet approved)',
            ),
          ],
        ]),
      )}
      {panel(
        'Count plans',
        table(
          ['Plan', 'Count', 'Route and steps', 'Targets', 'Approval'],
          s.processSetups
            .filter((r) => r.process === SPINNING)
            .slice()
            .reverse()
            .map((r) => [
              h(r.code + ' r' + r.version),
              h(
                r.count +
                  ' ' +
                  r.countSystem +
                  ' ± ' +
                  r.countTolerancePct +
                  '% · ' +
                  r.composition +
                  (r.twist ? ' · ' + r.twist : ''),
              ),
              h(r.route + ': ' + SPIN_ROUTES[r.route].steps.join(' → ') + ' → packing'),
              h('Yield ' + r.yieldPct + '% · noil ' + r.noilPct + '% · waste ' + r.wastePct + '%'),
              h(r.reference + ' · ' + r.effective),
            ]),
          'No count plans approved yet.',
        ),
      )}
    </>
  );
}
function work(app) {
  const s = app.data;
  const lines = s.lines.filter((l) => l.status === 'Approved' && l.stages.includes(SPINNING));
  return (
    <>
      {split(
        editor(
          app,
          'work-order',
          'Release spinning work order',
          <>
            {hidden('stage', SPINNING)}
            {hidden('unit', 'kg')}
            {field('Work order number', 'number')}
            {choose('Yarn buyer order line', 'lineId', lines, (l) => lineLabel(s, l), {
              required: false,
              blank: 'Stock production',
            })}
            {choose('Output location', 'locationId', s.locations, titles.location)}
            {requiredNumber('Planned yarn kg', 'plannedQty')}
            {select('Standard for stock production', 'scheme', schemeNames(s), {
              initial: 'Conventional',
            })}
            {day('Release date')}
            {day('Due date', 'due', false)}
            {text('Instructions', 'notes')}
          </>,
          'Release work order',
          'For a buyer order, yarn packed on this work order is allocated to the line unless you allocate it differently at packing.',
          !works(s).length,
        ),
        editor(
          app,
          'spin-open',
          'Open a spin lot',
          <>
            {choose('Spinning work order', 'workOrderId', works(s), titles.wo)}
            {field('Spin lot number', 'number')}
            {choose('Spinning machine (ring frame or rotor)', 'machineId', machines(s), (m) => m.code + ' · ' + m.name)}
            {choose('Count plan', 'recipeId', plans(s), (r) => r.code + ' r' + r.version + ' · ' + countLabel(r))}
            {requiredNumber('Planned fibre kg', 'plannedKg')}
            {day('Lot date')}
          </>,
          'Open spin lot',
          '',
          works(s).length > 0,
        ),
      )}
      {panel(
        'Spinning work orders',
        table(
          ['Work order', 'Order', 'Plan / packed', 'Spin lots', 'Status'],
          s.workOrders
            .filter((w) => w.stage === SPINNING)
            .slice()
            .reverse()
            .map((w) => [
              h(w.number),
              h(w.lineId ? lineLabel(s, ref(s.lines, w.lineId)) : 'Stock production'),
              showQty(w.plannedQty, w.unit) + ' / ' + showQty(w.completedQty, w.unit),
              joinContent(
                s.processBatches
                  .filter((b) => b.workOrderId === w.id)
                  .map((b) => <a href={'#spinning?tab=output&batch=' + encodeURIComponent(b.id)}>{h(b.number)}</a>),
                ', ',
              ) || '—',
              txStatus(w.status),
            ]),
        ),
      )}
    </>
  );
}
function prepPanel(s, b) {
  const pulled = [...new Set(b.lines.map((l) => ref(s.lots, l.lotId)))].map((lot) => [lot, preparationRecord(s, lot)]);
  if (!pulled.length) return '';
  return panel(
    'Fibre preparation pulled forward',
    joinContent(
      pulled.map(([lot, prep]) =>
        prep
          ? facts([
              ['Prepared fibre lot', lotLink(lot.id)],
              [
                'Blend',
                h(
                  prep.blend.number +
                    ' · ' +
                    (prep.plan ? prep.plan.code + ' r' + prep.plan.version + ' · ' + prep.plan.blendName : ''),
                ),
              ],
              [
                'Bales issued to the blend',
                h(
                  prep.issued
                    .map((i) => i.lotId + ' ' + fmt(i.kg) + ' kg' + (i.component ? ' (' + i.component + ')' : ''))
                    .join(' · '),
                ),
              ],
              [
                'Blow room steps',
                h(
                  prep.steps
                    .map(
                      (st) =>
                        st.step +
                        ' ' +
                        st.date +
                        (st.machine ? ' · ' + st.machine : '') +
                        (st.droppings ? ' · ' + fmt(st.droppings) + ' kg droppings' : '') +
                        (st.laydown ? ' · ' + st.laydown.number + ': ' + st.laydown.lots.join(', ') : ''),
                    )
                    .join(' | '),
                ),
              ],
              ['Handoff', h(prep.handoff ? prep.handoff.reference + ' · ' + prep.handoff.date : '—')],
            ])
          : note(
              'Lot ' +
                lot.id +
                ' (' +
                lot.material +
                ') has no posted fibre preparation. Record blow room on this spin lot.',
              true,
            ),
      ),
      '',
    ),
  );
}
function issue(app, selected) {
  const s = app.data;
  const b = selectedLot(s, selected);
  return (
    <>
      {split(
        editor(
          app,
          'spin-issue',
          'Issue blend or fibre to a spin lot',
          <>
            {lotChoice(s, b?.id)}
            {text('Lots and kg', 'lines', 'PF-BL-26-01,816', true)}
            {day('Issue date')}
            {field('Issue slip reference', 'reference')}
          </>,
          'Post issue',
          'A prepared fibre lot brings its blend record forward and counts as the blow room step.',
          open(s).length > 0,
        ),
        editor(
          app,
          'spin-return',
          'Return unused fibre',
          <>
            {lotChoice(s, b?.id)}
            {text('Lots and kg', 'lines', '', true)}
            {day('Return date')}
            {field('Return reference', 'reference')}
          </>,
          'Post return',
        ),
      )}
      {panel(
        'Fibre available',
        stockHint(
          s,
          s.lots.filter((l) => l.qty > 0 && SPIN_INPUTS.includes(l.material) && l.custody === 'Own site'),
          'No released fibre on hand.',
        ),
      )}
      {b ? prepPanel(s, b) : ''}
    </>
  );
}
function steps(app, selected) {
  const s = app.data;
  const b = selectedLot(s, selected);
  const done = b ? s.events.filter((e) => e.batchId === b.id && e.kind === 'Process entry' && !e.reversedBy) : [];
  return (
    <>
      {split(
        editor(
          app,
          'spin-entry',
          'Record a process step',
          <>
            {lotChoice(s, b?.id)}
            {select('Step', 'step', b?.steps ?? Object.values(SPIN_ROUTES)[0].steps)}
            {choose('Machine', 'machineId', machines(s), (m) => m.code + ' · ' + m.name, {
              required: false,
              blank: 'Spin lot machine',
            })}
            {stamp('Start', 'start', now('06:00'))}
            {stamp('End', 'end', now('14:00'))}
            {field('Operator or team', 'operator')}
            {field('Shift', 'shift')}
            {optionalNumber('Production at this step kg', 'stepKg')}
            {optionalNumber('Waste or noil removed kg', 'droppings')}
            {optionalNumber('Measured hank', 'hank')}
            {select('Hank unit', 'hankUnit', ['Ne', 'ktex', 'g/m'], {
              required: false,
              initial: 'Ne',
            })}
            {optionalNumber('Deliveries, spindles or rotors running', 'deliveries')}
            {optionalNumber('Electricity kWh', 'electricity', '0')}
            {optionalNumber('Labour hours', 'labourHours', '0')}
            {field('Step log reference', 'reference')}
            {text('Observations', 'notes')}
          </>,
          'Post step',
          'Steps follow the plan route in order. A route skip is rejected.',
          open(s).length > 0,
        ),
      )}
      {b
        ? panel(
            'Route progress · ' + b.number + ' · ' + b.route,
            table(
              ['Step', 'Recorded', 'Machine', 'Output / waste kg', 'Hank'],
              b.steps.map((step) => {
                const rows = done.filter((e) => e.step === step);
                const pulled = step === 'Blow room' && b.lines.length && b.lines.every((l) => l.preparedBy);
                return [
                  h(step),
                  pulled
                    ? badge('From blend ' + [...new Set(b.lines.map((l) => l.blend))].join(', '))
                    : rows.length
                      ? badge(rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies'))
                      : badge('Pending', 'warn'),
                  h(rows.map((e) => e.machineName).join(', ') || '—'),
                  h(rows.map((e) => fmt(e.stepKg ?? 0) + ' / ' + fmt(e.droppings ?? 0)).join(', ') || '—'),
                  h(
                    rows
                      .filter((e) => e.hank)
                      .map((e) => e.hank + ' ' + e.hankUnit)
                      .join(', ') || '—',
                  ),
                ];
              }),
            ),
          )
        : ''}
    </>
  );
}
function output(app, selected) {
  const s = app.data;
  const b = selectedLot(s, selected);
  const latest = open(s).flatMap((x) => {
    const e = ref(s.events, latestActive(x)?.eventId);
    return e ? [[x.id + '|' + e.id, x.number + ' · ' + e.id + ' · ' + (e.step || e.kind) + ' · ' + e.reference]] : [];
  });
  const yarnLines = s.lines.filter((l) => l.status === 'Approved' && l.product === 'Yarn');
  return (
    <>
      {split(
        editor(
          app,
          'spin-output',
          'Pack yarn into a lot',
          <>
            {lotChoice(s, b?.id)}
            {field('Yarn lot ID', 'outputId')}
            {choose(
              'Yarn item',
              'itemId',
              s.items.filter((i) => i.type === 'Yarn' && i.unit === 'kg'),
              titles.item,
              {
                required: false,
              },
            )}
            {requiredNumber('Good yarn net kg', 'outputQty')}
            {requiredNumber('Cones', 'cones')}
            {optional('First cone ID', 'coneFrom')}
            {optional('Last cone ID', 'coneTo')}
            {text('Or list cone IDs', 'coneIds')}
            {optionalNumber('Cartons or bags', 'cartons')}
            {optional('Packing', 'packing')}
            {requiredNumber('Measured count', 'actualCount')}
            {optionalNumber('Count CV %', 'countCv')}
            {field('Count test report', 'countTest')}
            {optional('Comber noil lot ID', 'noilLotId')}
            {optionalNumber('Comber noil kg', 'noilKg', '0')}
            {optionalNumber('Waste kg (hard and soft waste)', 'waste', '0')}
            {optionalNumber('Rejects kg', 'rejects', '0')}
            {optionalNumber('Fibre consumed kg (default yarn + noil + waste + rejects − adjustment)', 'consumedKg')}
            {optionalNumber('Measured moisture gain / loss kg', 'adjustment', '', -100000000)}
            {optional('Gain / loss basis', 'adjustmentRef')}
            {text(
              'Allocate to yarn order lines (line ID, kg); blank uses the work order line',
              'allocations',
              yarnLines[0] ? yarnLines[0].id + ',300' : '',
            )}
            {optional('Shift', 'shift')}
            {day('Packing date')}
            {field('Packing slip reference', 'reference')}
          </>,
          'Post yarn lot',
          'All route steps must be recorded. Yarn outside the count tolerance is placed on quality hold. Yarn and noil share the fibre consumed by mass.',
          open(s).length > 0,
        ),
        editor(
          app,
          'spin-close',
          'Close a spin lot',
          <>
            {lotChoice(s, b?.id)}
            {day('Closure date')}
            {field('Closure reason', 'reason')}
            {check('Confirm remaining fibre as measured loss', 'lossConfirmed')}
            {optional('Measured loss reference', 'lossRef')}
          </>,
          'Close spin lot',
        ),
        editor(
          app,
          'spin-reverse',
          'Reverse the latest posting',
          <>
            {select('Spin lot and latest active posting', 'pick', latest)}
            {day('Reversal date')}
            {text('Reason', 'reason', '', true)}
          </>,
          'Post reversal',
          'Reverse later postings first. Yarn that has been sold, moved or issued cannot be reversed here.',
        ),
      )}
      {b ? (
        <>
          {batchDetail(s, b)}
          {yarnTable(
            s,
            s.lots.filter((l) => l.batchId === b.id && l.material === 'Yarn'),
          )}
        </>
      ) : (
        ''
      )}
    </>
  );
}
function yarnTable(s, rows) {
  return panel(
    'Yarn lots',
    table(
      ['Yarn lot', 'Count / route', 'Cones and packing', 'On hand / location', 'Allocated', 'Quality'],
      rows
        .slice()
        .reverse()
        .map((l) => [
          <>
            {lotLink(l.id)}
            <br />
            <small>{h(l.yarn?.spinLot || '')}</small>
          </>,
          h(
            l.yarn
              ? l.yarn.count.actual +
                  ' ' +
                  l.yarn.count.system +
                  ' (nominal ' +
                  l.yarn.count.nominal +
                  ', ' +
                  l.yarn.count.deviation +
                  '%' +
                  (l.yarn.count.cv != null ? ', CV ' + l.yarn.count.cv + '%' : '') +
                  ') · ' +
                  l.yarn.route
              : l.label,
          ),
          h(
            l.yarn
              ? l.yarn.packages.cones +
                  ' cones · ' +
                  (l.yarn.packages.ids ? 'listed IDs' : l.yarn.packages.first + ' to ' + l.yarn.packages.last) +
                  (l.yarn.packages.cartons ? ' · ' + l.yarn.packages.cartons + ' cartons' : '')
              : '—',
          ),
          <>
            {showQty(l.qty, l.unit)}
            <br />
            <small>{h(l.location)}</small>
          </>,
          h(l.allocationBalance.map((a) => a.lineId + ' · ' + fmt(a.qty) + ' kg').join(', ') || 'Stock'),
          <>
            {txStatus(l.qualityStatus)}
            {l.qualityNote ? (
              <>
                <br />
                <small>{h(l.qualityNote)}</small>
              </>
            ) : (
              ''
            )}
          </>,
        ]),
      'No yarn lots yet.',
    ),
  );
}
function yarn(app) {
  const s = app.data;
  const lots = s.lots.filter((l) => l.material === 'Yarn' && l.yarn);
  const ids = new Set(lots.map((l) => l.id));
  return (
    <>
      {note(
        'Sell yarn through Dispatch & logistics against an approved yarn order line, then invoice it. Move yarn to dyeing, knitting or weaving with an inventory transfer, ' +
          'or issue it directly to a yarn dyeing batch, knitting or warping work order.',
      )}
      <div className="actions">
        <a className="button secondary" href="#logistics">
          {'Dispatch & logistics'}
        </a>
        <a className="button secondary" href="#stock">
          Inventory transfer
        </a>
        <a className="button secondary" href="#yarn-dyeing?tab=issue">
          Yarn dyeing issue
        </a>
        <a className="button secondary" href="#floor">
          Knitting or warping work order
        </a>
      </div>
      {yarnTable(s, lots)}
      {panel(
        'Yarn shipments, transfers and issues',
        table(
          ['Date', 'Movement', 'Yarn lot', 'Quantity', 'From → to', 'Reference'],
          s.events
            .filter(
              (e) =>
                e.process !== SPINNING &&
                e.kind !== 'Quality inspection' &&
                (e.moves ?? []).some((m) => ids.has(m.lotId) && m.qty < 0),
            )
            .slice()
            .reverse()
            .map((e) => {
              const out = e.moves.filter((m) => ids.has(m.lotId) && m.qty < 0);
              return [
                h(e.date),
                h(e.process ? e.process + ' · ' + e.kind : e.kind),
                joinContent(
                  out.map((m) => lotLink(m.lotId)),
                  ', ',
                ),
                out.map((m) => showQty(-m.qty, m.unit)).join(', '),
                h([e.from || out[0].location, e.to || e.customer || e.destination].filter(Boolean).join(' → ')),
                h(e.reference || e.number || ''),
              ];
            }),
          'No yarn has moved yet.',
        ),
      )}
    </>
  );
}
function scan(app) {
  const s = app.data;
  let result = '';
  if (app.local.yarnScan) {
    try {
      const r = scanRecord(s, app.local.yarnScan);
      ensureLot(r);
      const l = r.lot;
      const prep = l.parents.map((p) => preparationRecord(s, ref(s.lots, p.id))).find(Boolean);
      result = panel(
        'Yarn lot ' + l.id,
        <>
          {facts([
            [
              'Yarn',
              h(
                l.yarn
                  ? l.yarn.count.actual + ' ' + l.yarn.count.system + ' · ' + l.yarn.route + ' · ' + l.composition
                  : l.material,
              ),
            ],
            ['Spin lot', h(l.yarn?.spinLot || '—')],
            ['Blend', h(l.yarn?.blends?.join(', ') || prep?.blend.number || '—')],
            [
              'Cones',
              h(
                l.yarn
                  ? l.yarn.packages.cones +
                      ' · ' +
                      (l.yarn.packages.first ? l.yarn.packages.first + ' to ' + l.yarn.packages.last : 'listed')
                  : '—',
              ),
            ],
            ['On hand / location', showQty(l.qty, l.unit) + ' · ' + h(l.location)],
            [
              'Standard',
              r.standard.ok ? (
                <>
                  {badge('Eligible')} <small>{h(r.standard.reason)}</small>
                </>
              ) : (
                <>
                  {badge('Blocked', 'bad')} <small>{h(r.standard.reason)}</small>
                </>
              ),
            ],
            ['Quality', txStatus(l.qualityStatus)],
          ])}
          {details(
            'Input bale history',
            table(
              [
                'Bale lot',
                'Bales',
                'Origin / supplier / ginner',
                'Issued to blend',
                'Attributable to this yarn lot',
                'Evidence',
              ],
              r.bales.map((x) => [
                lotLink(x.lot.id),
                h(x.bales.length + ' · ' + x.bales.map((b) => b.no + ' ' + fmt(b.netKg) + ' kg').join(', ')),
                h(
                  [
                    x.variety,
                    x.origin,
                    x.supplier,
                    x.ginner,
                    x.ginRun && 'gin run ' + x.ginRun,
                    x.growers && 'growers ' + x.growers,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ),
                h(
                  x.blendIssues
                    .map((i) => i.blend + ': ' + fmt(i.kg) + ' kg on ' + i.date + ' (' + i.reference + ')')
                    .join(' · ') || '—',
                ),
                h(
                  fmt(Math.round(x.kg * 10) / 10) +
                    ' kg (' +
                    fmt(Math.round(x.share * 10000) / 100) +
                    '% of the bale lot)',
                ),
                h(x.evidence.map((e) => e.number + ' ' + e.status).join(', ') || 'None required'),
              ]),
              'No bale lots in this lot’s history.',
            ),
            true,
          )}
          {details(
            'All recorded sources',
            table(
              ['Source lot', 'Origin', 'Supplier / grower', 'Ginner', 'Variety', 'Received'],
              r.sources.map((x) => [
                lotLink(x.id),
                h(x.origin || '—'),
                h([x.party, x.grower].filter(Boolean).join(' · ') || '—'),
                h(x.ginner || '—'),
                h(x.variety || '—'),
                h(x.date),
              ]),
            ),
            true,
          )}
        </>,
      );
    } catch (error) {
      result = note(error.message, true);
    }
  }
  return (
    <>
      {panel(
        'Scan a yarn lot or cone label',
        <>
          {form(
            'yarn-scan',
            field('Scanned label or yarn lot ID', 'query', {
              value: app.local.yarnScan || '',
              placeholder: 'HZ:LOT:YRN-30C-A',
            }),
            'Look up',
          )}
          {note(
            'A scan only retrieves the record. It shows the bales behind the yarn, the weights issued to the blend and the share attributable to this lot.',
          )}
        </>,
      )}
      {result}
    </>
  );
}
function ensureLot(r) {
  if (r.kind !== 'lot') throw new Error('Scan a yarn lot. Use Ginning & fibre to scan a blend.');
}
function history(app) {
  const s = app.data;
  const lot = ref(s.lots, app.local.spinLot);
  return (
    <>
      {panel(
        'Find a lot',
        form(
          'spin-history',
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
function SpinningPage({ app }) {
  const p = params();
  const tab = tabs.some(([key]) => key === p.get('tab')) ? p.get('tab') : 'setup';
  const body = {
    setup,
    work,
    issue,
    steps,
    output,
    yarn,
    scan,
    history,
  }[tab](app, p.get('batch') || '');
  return (
    <>
      {heading(
        'Spinning',
        'Spin carded or combed yarn on ring or rotor frames from a posted blend or from lint. Each step follows the count plan route, and every yarn lot carries its count, cones, noil, waste and input bales.',
        <a className="button secondary" href="#fibre?tab=scan">
          Bale and blend scan
        </a>,
      )}
      {tabBar(tab)}
      {body}
    </>
  );
}
export { SpinningPage };
