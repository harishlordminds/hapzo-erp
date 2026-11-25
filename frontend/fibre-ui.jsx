import { joinContent } from './react-ui.jsx';
import { ref } from '../src/model.js';
import { schemeNames } from '../src/standards.js';
import { RATE_KEYS, wipKg, latestActive } from '../src/process-batch.js';
import {
  GINNING,
  PREPARATION,
  GIN_STEPS,
  PREP_STEPS,
  BALE_TRACKING,
  HANDOFF,
  LINT_MATERIALS,
  fibreSettings,
  scanRecord,
} from '../src/fibre.js';
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
  file,
  hidden,
  form,
  editor,
  facts,
  titles,
  lotLink,
  linkButton,
  button,
} from './ui.jsx';
const tabs = [
  ['setup', 'Setup'],
  ['seed', 'Seed cotton inward'],
  ['gin', 'Gin run'],
  ['bales', 'Lint bale inward'],
  ['blend', 'Blend and laydown'],
  ['scan', 'Bale and blend scan'],
  ['history', 'Lot history'],
];
const open = (s, process) =>
  s.processBatches.filter((b) => b.process === process && ['Open', 'In process'].includes(b.status));
const works = (s, process) =>
  s.workOrders.filter((w) => w.stage === process && ['Released', 'In progress'].includes(w.status));
const plans = (s, process) => s.processSetups.filter((r) => r.process === process && r.status === 'Approved');
const batchTitle = (b) => b.number + ' · ' + recipeText(b) + ' · WIP ' + fmt(wipKg(b)) + ' kg';
const batchChoice = (s, process, selected, label) =>
  choose(label, 'batchId', open(s, process), batchTitle, {
    initial: selected,
  });
const onHand = (s, materials) =>
  s.lots.filter((l) => l.qty > 0 && materials.includes(l.material) && l.custody === 'Own site');
const machines = (s) => s.machines.filter((m) => m.status === 'In service');
const items = (s, types) => s.items.filter((i) => types.includes(i.type) && i.unit === 'kg');
const suppliers = (s) => s.parties.filter((p) => p.type === 'Supplier');
const rates = () => (
  <>
    {joinContent(
      Object.entries(RATE_KEYS).map(([k, label]) => optionalNumber(label, k + 'Rate')),
      '',
    )}
    {optional('Approved rate card reference', 'rateRef')}
  </>
);
function tabBar(selected) {
  return (
    <nav className="actions" aria-label="Ginning and fibre screens">
      {joinContent(
        tabs.map(([key, label]) => (
          <a
            className={'button ' + (key === selected ? '' : 'secondary')}
            href={'#fibre?tab=' + key}
            aria-current={key === selected ? 'page' : undefined}>
            {h(label)}
          </a>
        )),
        '',
      )}
    </nav>
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
    'Reverse the latest posting',
    <>
      {select('Batch and latest active posting', 'pick', latest)}
      {day('Reversal date')}
      {text('Reason', 'reason', '', true)}
    </>,
    'Post reversal',
    'Corrections post a linked reversal. Reverse later postings first.',
  );
}
function workForm(app, s, process, unitHint) {
  return editor(
    app,
    'work-order',
    'Release ' + process.toLowerCase() + ' work order',
    <>
      {hidden('stage', process)}
      {hidden('unit', 'kg')}
      {field('Work order number', 'number')}
      {choose('Output location', 'locationId', s.locations, titles.location)}
      {requiredNumber('Planned ' + unitHint + ' kg', 'plannedQty')}
      {select('Standard claimed', 'scheme', schemeNames(s), {
        initial: 'Conventional',
      })}
      {optional('Additional schemes, comma separated', 'additionalSchemes')}
      {day('Release date')}
      {day('Due date', 'due', false)}
      {text('Instructions', 'notes')}
    </>,
    'Release work order',
    'A claimed standard is checked against verified evidence on every issue and output.',
    !works(s, process).length,
  );
}
function setup(app) {
  const s = app.data;
  const cfg = fibreSettings(s);
  return (
    <>
      {split(
        editor(
          app,
          'fibre-config',
          'Mill tracking configuration',
          <>
            {select('Lint bale tracking', 'baleTracking', BALE_TRACKING, {
              initial: cfg.baleTracking,
            })}
            {select('Handoff to spinning', 'handoff', HANDOFF, {
              initial: cfg.handoff,
            })}
            {field('Configuration revision', 'version', {
              value: cfg.version ? String(Number(cfg.version) + 1 || '') : '1',
            })}
            {day('Effective date', 'effective')}
            {field('Approval reference', 'reference')}
            {check('Apply to new blends while others are open', 'confirm')}
          </>,
          'Save configuration',
          'Each bale: one lot per bale. Bale lot: one lot carrying its bale list. Handoff sets how many prepared fibre lots a blend may hand to spinning.',
          !cfg.version,
        ),
        editor(
          app,
          'fibre-setup',
          'Approve a gin plan',
          <>
            {hidden('process', GINNING)}
            {field('Plan code', 'code')}
            {field('Revision', 'version', {
              value: '1',
            })}
            {optional('Variety', 'variety')}
            {day('Effective date', 'effective')}
            {requiredNumber('Planned lint outturn %', 'lintPct')}
            {optionalNumber('Planned seed %', 'seedPct')}
            {optionalNumber('Planned gin waste %', 'wastePct')}
            {rates()}
            {field('Approval reference', 'reference')}
          </>,
          'Approve gin plan',
        ),
        editor(
          app,
          'fibre-setup',
          'Approve a blend plan',
          <>
            {hidden('process', PREPARATION)}
            {field('Plan code', 'code')}
            {field('Revision', 'version', {
              value: '1',
            })}
            {field('Blend name', 'blendName')}
            {day('Effective date', 'effective')}
            {text(
              'Components: variety, origin, supplier lot mark or item code, and share %',
              'components',
              'Shankar-6,60\nMCU-5,40',
            )}
            {optionalNumber('Tolerance ± % of issued weight', 'tolerancePct', '3')}
            {optionalNumber('Planned blowroom waste %', 'wastePct')}
            {rates()}
            {field('Mixing approval reference', 'reference')}
          </>,
          'Approve blend plan',
          'Bales are matched to a component by variety, origin, lot mark or item code. Output is blocked while the issued mix is outside tolerance.',
        ),
      )}
      {panel(
        'Current configuration',
        facts([
          ['Bale tracking', h(cfg.baleTracking)],
          ['Handoff to spinning', h(cfg.handoff)],
          [
            'Revision',
            h(cfg.version ? cfg.version + ' · ' + cfg.effective + ' · ' + cfg.reference : 'Default (not yet approved)'),
          ],
        ]),
      )}
      {panel(
        'Approved plans',
        table(
          ['Plan', 'Type', 'Targets', 'Rates', 'Approval'],
          s.processSetups
            .filter((r) => [GINNING, PREPARATION].includes(r.process))
            .slice()
            .reverse()
            .map((r) => [
              h(r.code + ' r' + r.version),
              h(r.process === GINNING ? 'Gin plan' : 'Blend plan · ' + r.blendName),
              h(
                r.process === GINNING
                  ? 'Lint ' + r.lintPct + '% · seed ' + r.seedPct + '% · waste ' + r.wastePct + '%'
                  : r.components.map((c) => c.key + ' ' + c.pct + '%').join(' · ') +
                      ' ± ' +
                      r.tolerancePct +
                      '% · waste ' +
                      r.wastePct +
                      '%',
              ),
              h(
                Object.entries(r.rates)
                  .filter(([, v]) => v)
                  .map(([k, v]) => k + ' ' + fmt(v))
                  .join(' · ') || '—',
              ),
              h(r.reference + ' · ' + r.effective),
            ]),
          'No plans approved yet.',
        ),
      )}
    </>
  );
}
function seed(app) {
  const s = app.data;
  const lots = s.lots
    .filter((l) => l.material === 'Seed cotton')
    .slice()
    .reverse();
  return (
    <>
      {split(
        editor(
          app,
          'seed-inward',
          'Receive seed cotton by weighbridge',
          <>
            {field('Seed cotton lot ID', 'lotId')}
            {choose('Seed cotton item', 'itemId', items(s, ['Seed cotton']), titles.item)}
            {choose('Supplier, grower or farmer group', 'supplierId', suppliers(s), titles.party)}
            {field('Grower or farmer group name', 'grower')}
            {optional('Farm or member ID', 'farmId')}
            {field('Origin (village, district, state)', 'origin')}
            {optional('Origin country', 'originCountry', 'India')}
            {optional('Variety', 'variety')}
            {optional('Crop year', 'cropYear')}
            {choose('Receiving location', 'locationId', s.locations, titles.location)}
            {requiredNumber('Weighbridge gross kg', 'grossKg')}
            {requiredNumber('Tare kg', 'tareKg')}
            {optionalNumber('Moisture %', 'moisture')}
            {optionalNumber('Trash %', 'trash')}
            {field('Weighbridge ticket', 'weighbridgeRef')}
            {optional('Vehicle', 'vehicle')}
            {select('Standard claimed', 'scheme', schemeNames(s), {
              initial: 'Conventional',
            })}
            {optional('Shipment reference on transaction evidence', 'evidenceShipment')}
            {day('Receipt date')}
            {file('Weighbridge ticket or purchase slip', 'stock')}
          </>,
          'Post seed cotton receipt',
          'Stock quantity is the net weight, gross minus tare. A claimed standard without verified supplier evidence puts the lot on Standard Hold.',
          !lots.length,
        ),
      )}
      {panel(
        'Seed cotton lots',
        table(
          ['Lot', 'Grower / origin', 'Weighbridge', 'Moisture / trash', 'On hand', 'Status'],
          lots.map((l) => [
            lotLink(l.id),
            h((l.intake?.grower || l.party) + ' · ' + l.origin),
            h(
              l.intake
                ? fmt(l.intake.grossKg) +
                    ' − ' +
                    fmt(l.intake.tareKg) +
                    ' = ' +
                    fmt(l.intake.netKg) +
                    ' kg · ' +
                    l.intake.ticket
                : '—',
            ),
            h(
              [l.intake?.moisture != null && l.intake.moisture + '%', l.intake?.trash != null && l.intake.trash + '%']
                .filter(Boolean)
                .join(' / ') || '—',
            ),
            showQty(l.qty, l.unit),
            l.standardHold ? badge('Standard Hold', 'bad') : txStatus(l.qualityStatus),
          ]),
        ),
      )}
    </>
  );
}
function gin(app, selected) {
  const s = app.data;
  const batch =
    ref(s.processBatches, selected) ||
    open(s, GINNING)[0] ||
    s.processBatches.filter((b) => b.process === GINNING).at(-1);
  const tracking = fibreSettings(s).baleTracking;
  return (
    <>
      {split(
        workForm(app, s, GINNING, 'lint'),
        editor(
          app,
          'gin-run',
          'Open a gin run',
          <>
            {choose('Ginning work order', 'workOrderId', works(s, GINNING), titles.wo)}
            {field('Gin run number', 'number')}
            {choose('Gin', 'machineId', machines(s), (m) => m.code + ' · ' + m.name)}
            {choose('Gin plan', 'recipeId', plans(s, GINNING), (r) => r.code + ' r' + r.version, {
              required: false,
              blank: 'No plan',
            })}
            {requiredNumber('Planned seed cotton kg', 'plannedKg')}
            {day('Run date')}
          </>,
          'Open gin run',
          '',
          works(s, GINNING).length > 0,
        ),
        editor(
          app,
          'gin-issue',
          'Issue seed cotton to the gin',
          <>
            {batchChoice(s, GINNING, batch?.id, 'Gin run')}
            {text('Seed cotton lots and kg', 'lines', 'SC-26-001,4000', true)}
            {day('Issue date')}
            {field('Issue reference', 'reference')}
          </>,
          'Post issue',
        ),
        editor(
          app,
          'gin-entry',
          'Record a gin run step',
          <>
            {batchChoice(s, GINNING, batch?.id, 'Gin run')}
            {select('Step', 'step', GIN_STEPS, {
              initial: 'Ginning',
            })}
            {stamp('Start', 'start', now('06:00'))}
            {stamp('End', 'end', now('14:00'))}
            {field('Operator', 'operator')}
            {field('Shift', 'shift')}
            {optionalNumber('Moisture % at gin', 'moisture')}
            {optionalNumber('Electricity kWh', 'electricity', '0')}
            {optionalNumber('Labour hours', 'labourHours', '0')}
            {optionalNumber('Measured waste removed kg', 'droppings')}
            {field('Run log reference', 'reference')}
            {text('Observations', 'notes')}
          </>,
          'Post step',
        ),
        editor(
          app,
          'gin-output',
          'Press lint bales and weigh seed and waste',
          <>
            {batchChoice(s, GINNING, batch?.id, 'Gin run')}
            {tracking === 'Bale lot'
              ? field('Lint bale lot ID', 'lotId')
              : note('Tracking is set to each bale: every bale number becomes its own lot.')}
            {choose('Lint item', 'itemId', items(s, ['Cotton bale']), titles.item, {
              required: false,
            })}
            {text(
              'Bales: number, net kg, gross kg, micronaire, staple mm, strength g/tex',
              'bales',
              'GB-001,170,172,3.9,29.5,29\nGB-002,171,173',
              true,
            )}
            {optional('Cotton seed lot ID', 'seedLotId')}
            {optionalNumber('Cotton seed kg', 'seedKg', '0')}
            {optionalNumber('Gin waste kg (motes, trash)', 'waste', '0')}
            {optionalNumber('Seed cotton consumed kg (default lint + seed + waste − adjustment)', 'consumedKg')}
            {optionalNumber('Measured moisture gain / loss kg', 'adjustment', '', -100000000)}
            {optional('Gain / loss basis', 'adjustmentRef')}
            {optional('Operator', 'operator')}
            {optional('Shift', 'shift')}
            {day('Pressing date')}
            {field('Pressing reference', 'reference')}
          </>,
          'Post lint and seed',
          'Seed cotton consumed must equal lint + seed + waste, with any measured moisture change recorded separately. Lint and seed share inputs, utilities and cost by mass.',
        ),
        editor(
          app,
          'gin-return',
          'Return unused seed cotton',
          <>
            {batchChoice(s, GINNING, batch?.id, 'Gin run')}
            {text('Lots and kg', 'lines', '', true)}
            {day('Return date')}
            {field('Return reference', 'reference')}
          </>,
          'Post return',
        ),
        editor(
          app,
          'gin-close',
          'Close a gin run',
          <>
            {batchChoice(s, GINNING, batch?.id, 'Gin run')}
            {day('Closure date')}
            {field('Closure reason', 'reason')}
            {check('Confirm remaining seed cotton as measured loss', 'lossConfirmed')}
            {optional('Measured loss reference', 'lossRef')}
          </>,
          'Close gin run',
        ),
        reverseForm(app, s, GINNING, 'gin-reverse'),
      )}
      {panel('Seed cotton available', stockHint(s, onHand(s, ['Seed cotton']), 'No released seed cotton on hand.'))}
      {batch ? batchDetail(s, batch) : ''}
    </>
  );
}
function bales(app) {
  const s = app.data;
  const tracking = fibreSettings(s).baleTracking;
  return (
    <>
      {split(
        editor(
          app,
          'bale-inward',
          'Receive purchased lint bales',
          <>
            {tracking === 'Bale lot'
              ? field('Bale lot ID', 'lotId')
              : note('Tracking is set to each bale: every bale number becomes its own lot.')}
            {choose('Lint item', 'itemId', items(s, LINT_MATERIALS), titles.item)}
            {choose('Supplier', 'supplierId', suppliers(s), titles.party)}
            {field('Ginner or press factory', 'ginner')}
            {field('Origin (ginning region or facility)', 'origin')}
            {optional('Origin country', 'originCountry', 'India')}
            {optional('Supplier lot or press mark', 'lotMark')}
            {optional('Variety', 'variety')}
            {optional('Crop year', 'cropYear')}
            {choose('Receiving location', 'locationId', s.locations, titles.location)}
            {choose('Supplier PO', 'purchaseId', s.purchases, (p) => p.number + ' · ' + p.supplier, {
              required: false,
              blank: 'No supplier PO',
            })}
            {text(
              'Bales: number, net kg, gross kg, micronaire, staple mm, strength g/tex',
              'bales',
              'PB-101,172,174,4.1,30,30\nPB-102,169,171',
              true,
            )}
            {field('Weight check reference', 'weighRef')}
            {select('Standard claimed', 'scheme', schemeNames(s), {
              initial: 'Conventional',
            })}
            {optional('Additional schemes', 'additionalSchemes')}
            {optional('Shipment reference on transaction evidence', 'evidenceShipment')}
            {day('Receipt date')}
            {field('GRN or invoice reference', 'reference')}
            {file('Invoice, bale list or certificate', 'stock')}
          </>,
          'Post bale receipt',
          'Lint enters pending inspection. Missing or unverified supplier evidence for a claimed standard places the bales on Standard Hold.',
        ),
      )}
      {panel('Lint on hand', stockHint(s, onHand(s, LINT_MATERIALS), 'No lint bales on hand.'))}
    </>
  );
}
function blend(app, selected) {
  const s = app.data;
  const batch =
    ref(s.processBatches, selected) ||
    open(s, PREPARATION)[0] ||
    s.processBatches.filter((b) => b.process === PREPARATION).at(-1);
  const draft = app.local.blendIssueDraft || '';
  return (
    <>
      {split(
        workForm(app, s, PREPARATION, 'prepared fibre'),
        editor(
          app,
          'blend-open',
          'Open a blend',
          <>
            {choose('Fibre preparation work order', 'workOrderId', works(s, PREPARATION), titles.wo)}
            {field('Blend number', 'number')}
            {choose('Blowroom line', 'machineId', machines(s), (m) => m.code + ' · ' + m.name)}
            {choose(
              'Blend plan',
              'recipeId',
              plans(s, PREPARATION),
              (r) => r.code + ' r' + r.version + ' · ' + r.blendName,
            )}
            {requiredNumber('Planned blend kg', 'plannedKg')}
            {day('Blend date')}
          </>,
          'Open blend',
          'The blend keeps the handoff granularity in force when it opens: ' + fibreSettings(s).handoff + '.',
          works(s, PREPARATION).length > 0,
        ),
        editor(
          app,
          'blend-issue',
          'Bale selection: issue actual weights',
          <>
            {batchChoice(s, PREPARATION, batch?.id, 'Blend')}
            <label className="wide">
              Bale lots and actual issued kg
              <textarea name="lines" required placeholder={'LINT-B,510\nLINT-A,340'} defaultValue={h(draft)} />
            </label>
            {day('Issue date')}
            {field('Issue slip reference', 'reference')}
          </>,
          'Post bale issue',
          'Scanned bales are added here for review. Nothing moves until you post.',
          Boolean(draft),
        ),
        editor(
          app,
          'blend-entry',
          'Record laydown, opening, cleaning or blending',
          <>
            {batchChoice(s, PREPARATION, batch?.id, 'Blend')}
            {select('Step', 'step', PREP_STEPS, {
              initial: 'Laydown',
            })}
            {stamp('Start', 'start', now('06:00'))}
            {stamp('End', 'end', now('07:00'))}
            {field('Operator', 'operator')}
            {field('Shift', 'shift')}
            {optional('Laydown or selection number', 'laydownNo')}
            {text('Bale lots in this laydown (bale selection and laydown steps)', 'laydown', 'LINT-B LINT-A')}
            {optionalNumber('Measured droppings kg', 'droppings')}
            {optionalNumber('Electricity kWh', 'electricity', '0')}
            {optionalNumber('Labour hours', 'labourHours', '0')}
            {field('Step log reference', 'reference')}
            {text('Observations', 'notes')}
          </>,
          'Post step',
        ),
        editor(
          app,
          'blend-output',
          'Hand off prepared fibre to spinning',
          <>
            {batchChoice(s, PREPARATION, batch?.id, 'Blend')}
            {field('Prepared fibre lot ID', 'outputId')}
            {requiredNumber('Output kg', 'outputQty')}
            {optionalNumber('Blowroom waste kg', 'waste', '0')}
            {optionalNumber('Rejects kg', 'rejects', '0')}
            {optionalNumber('Blend kg consumed (default output + waste + rejects − adjustment)', 'consumedKg')}
            {optionalNumber('Measured moisture gain / loss kg', 'adjustment', '', -100000000)}
            {optional('Gain / loss basis', 'adjustmentRef')}
            {optional('Can or lap number (each can / lap handoff)', 'canNo')}
            {optional('Shift (shift lot handoff)', 'shift')}
            {choose(
              'Prepared fibre item',
              'itemId',
              s.items.filter((i) => i.type === 'Prepared fibre'),
              titles.item,
              {
                required: false,
              },
            )}
            {check('Hold for inspection before spinning', 'inspect')}
            {day('Handoff date')}
            {field('Handoff reference', 'reference')}
          </>,
          'Post handoff',
          'Granularity and the approved blend mix are checked before posting. The lot links to every issued bale lot with its consumed kg.',
        ),
        editor(
          app,
          'blend-return',
          'Return unused bales',
          <>
            {batchChoice(s, PREPARATION, batch?.id, 'Blend')}
            {text('Lots and kg', 'lines', '', true)}
            {day('Return date')}
            {field('Return reference', 'reference')}
          </>,
          'Post return',
        ),
        editor(
          app,
          'blend-close',
          'Close a blend',
          <>
            {batchChoice(s, PREPARATION, batch?.id, 'Blend')}
            {day('Closure date')}
            {field('Closure reason', 'reason')}
            {check('Confirm remaining fibre as measured loss', 'lossConfirmed')}
            {optional('Measured loss reference', 'lossRef')}
          </>,
          'Close blend',
        ),
        reverseForm(app, s, PREPARATION, 'blend-reverse'),
      )}
      {panel('Lint available for selection', stockHint(s, onHand(s, LINT_MATERIALS), 'No lint on hand.'))}
      {batch ? batchDetail(s, batch) : ''}
    </>
  );
}
const ok = (state, okText) =>
  state ? (
    <>
      {badge(state.ok ? okText || 'Eligible' : 'Blocked', state.ok ? '' : 'bad')}
      <br />
      <small>{h(state.ok ? state.reason || state.component || '' : state.reason)}</small>
    </>
  ) : (
    '—'
  );
function scan(app) {
  const s = app.data;
  const target = app.local.fibreTarget || open(s, PREPARATION)[0]?.id || '';
  let result = '';
  if (app.local.fibreScan) {
    try {
      const r = scanRecord(s, app.local.fibreScan, target);
      if (r.kind === 'lot') {
        result = panel(
          'Scanned ' + (r.bale ? 'bale ' + r.bale.no + ' in lot ' : 'lot ') + r.lot.id,
          <>
            {facts([
              ['Material', h(r.lot.material + ' · ' + r.lot.stage)],
              ['On hand', showQty(r.lot.qty, r.lot.unit)],
              ['Bale', r.bale ? h(r.bale.no + ' · ' + fmt(r.bale.netKg) + ' kg net') : '—'],
              ['Variety / lot mark', h([r.lot.variety, r.lot.fibre?.lotMark].filter(Boolean).join(' · ') || '—')],
              ['Standard eligibility', ok(r.standard)],
              ['Physical availability', ok(r.physical, 'Available')],
              ['Blend plan fit', r.blend ? ok(r.blend, 'Fits plan') : '—'],
            ])}
            {details(
              'Supplier and origin',
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
            {details(
              'Evidence used at receipt and processing',
              table(
                ['Evidence', 'Scheme / type', 'Holder', 'Valid until', 'Current status'],
                r.evidence.map((e) => [
                  h(e.number),
                  h([e.scheme, e.kind].filter(Boolean).join(' · ')),
                  h(e.party || '—'),
                  h(e.until || '—'),
                  txStatus(e.status),
                ]),
                'No certificate was required or recorded for this lot.',
              ),
              true,
            )}
            {target &&
            r.physical.ok &&
            r.standard.ok &&
            (!r.blend || r.blend.ok) &&
            r.lot.qty > 0 &&
            app.user.actions.includes('blend-issue')
              ? button('Add ' + r.lot.id + ' to the bale issue draft', {
                  'data-blend-add': h(r.lot.id),
                })
              : ''}
          </>,
        );
      } else {
        const b = r.batch;
        result = panel(
          'Scanned ' + b.process.toLowerCase() + ' ' + b.number,
          <>
            {facts([
              ['Work order', h(r.workOrder?.number || '—')],
              ['Plan', h(recipeText(b))],
              ['Status', txStatus(b.status)],
              ['Outputs', joinContent(b.outputs.map(lotLink), ', ') || '—'],
            ])}
            {table(
              ['Issued lot', 'Issued / consumed kg', 'Component', 'Origin and supplier', 'Evidence', 'Standard now'],
              r.lines.map((x) => [
                lotLink(x.lot.id),
                h(fmt(x.line.issuedKg) + ' / ' + fmt(x.line.consumedKg) + ' kg'),
                h(x.line.component || '—'),
                h(
                  x.sources.map((src) => [src.origin, src.party, src.grower].filter(Boolean).join(' · ')).join(' | ') ||
                    '—',
                ),
                h(x.evidence.map((e) => e.number + ' (' + e.status + ')').join(', ') || '—'),
                ok(x.standard),
              ]),
            )}
            {linkButton('Open ' + b.number + ' details', 'fibre-batch', b.id)}
          </>,
        );
      }
    } catch (error) {
      result = note(error.message, true);
    }
  }
  return (
    <>
      {panel(
        'Scan a bale, bale lot or blend',
        <>
          {form(
            'fibre-scan',
            <>
              {field('Scanned label or ID', 'query', {
                value: app.local.fibreScan || '',
                placeholder: 'HZ:LOT:LINT-A, PB-102 or BL-26-01',
              })}
              {choose('Check against blend', 'target', open(s, PREPARATION), batchTitle, {
                required: false,
                initial: target,
                blank: 'No blend selected',
              })}
            </>,
            'Look up',
          )}
          {note(
            'A keyboard or USB scanner types into the field. A scan only retrieves the record and its eligibility. Stock moves only when you post an issue.',
          )}
        </>,
      )}
      {result}
    </>
  );
}
function history(app) {
  const s = app.data;
  const lot = ref(s.lots, app.local.fibreLot);
  return (
    <>
      {panel(
        'Find a lot',
        form(
          'fibre-history',
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
function FibrePage({ app }) {
  const p = params();
  const tab = tabs.some(([key]) => key === p.get('tab')) ? p.get('tab') : 'setup';
  const body = {
    setup,
    seed,
    gin,
    bales,
    blend,
    scan,
    history,
  }[tab](app, p.get('batch') || '');
  return (
    <>
      {heading(
        'Ginning and fibre preparation',
        'Receive seed cotton or purchased lint, gin seed cotton into bales, then select bales into a blend through laydown, opening and cleaning. Each handoff to spinning links to the actual bale weights issued.',
        <a className="button secondary" href="#trace">
          {'Scan & trace'}
        </a>,
      )}
      {tabBar(tab)}
      {body}
    </>
  );
}
export { FibrePage };
export function addToBlendDraft(app, lotId) {
  const lot = ref(app.data.lots, lotId);
  if (!lot) return;
  const lines = (app.local.blendIssueDraft || '')
    .split('\n')
    .filter(Boolean)
    .filter((line) => line.split(',')[0] !== lot.id);
  lines.push(lot.id + ',' + lot.qty);
  app.local.blendIssueDraft = joinContent(lines, '\n');
}
