import { joinContent } from './react-ui.jsx';
import { ref } from '../src/model.js';
import { schemeNames } from '../src/standards.js';
import { RATE_KEYS, wipKg, latestActive } from '../src/process-batch.js';
import {
  FABRIC_DYEING,
  FABRIC_KINDS,
  FD_PRETREATMENTS,
  FD_STEPS,
  DRY_BASIS,
  commissionBalance,
  fabricKind,
} from '../src/fabric-dyeing.js';
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
  cards,
} from './ui.jsx';
const tabs = [
  ['setup', 'Setup'],
  ['inward', 'Roll inward'],
  ['batch', 'Dye batch'],
  ['unload', 'Unload rolls'],
  ['commission', 'Commission and outward'],
  ['history', 'Lot history'],
];
const open = (s) =>
  s.processBatches.filter((b) => b.process === FABRIC_DYEING && ['Open', 'In process'].includes(b.status));
const recipes = (s) => s.processSetups.filter((r) => r.process === FABRIC_DYEING);
const batchTitle = (b) =>
  b.number +
  ' · ' +
  recipeText(b) +
  (b.commission ? ' · for ' + b.customer + ' ' + b.commissionRef : '') +
  ' · WIP ' +
  fmt(wipKg(b)) +
  ' kg';
const batchChoice = (s, selected) =>
  choose('Dye batch', 'batchId', open(s), batchTitle, {
    initial: selected,
  });
const selectedBatch = (s, selected) =>
  ref(s.processBatches, selected) || open(s)[0] || s.processBatches.filter((b) => b.process === FABRIC_DYEING).at(-1);
const owner = (s, l) => ref(s.parties, l.ownerId)?.name || s.settings.name;
const bal = (n) => fmt(Math.abs(n) < 1e-6 ? 0 : n);
function tabBar(selected) {
  return (
    <nav className="actions" aria-label="Fabric dyeing screens">
      {joinContent(
        tabs.map(([key, label]) => (
          <a
            className={'button ' + (key === selected ? '' : 'secondary')}
            href={'#fabric-dyeing?tab=' + key}
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
  return (
    <>
      {split(
        editor(
          app,
          'fdye-setup',
          'Approve a fabric dye recipe',
          <>
            {field('Recipe code', 'code')}
            {field('Revision', 'version', {
              value: '1',
            })}
            {day('Effective date', 'effective')}
            {choose(
              'Revises (supersedes)',
              'revises',
              recipes(s).filter((r) => r.status === 'Approved'),
              (r) => r.code + ' r' + r.version,
              {
                required: false,
                blank: 'New recipe',
              },
            )}
            {optional('Reason for the revision', 'revisionReason')}
            {optional('Colour', 'colour')}
            {field('Shade', 'shade')}
            {select('Fabric', 'fabricKind', FABRIC_KINDS, {
              initial: 'Knitted',
            })}
            {select('Pretreatment for this route', 'pretreatment', FD_PRETREATMENTS, {
              initial: 'Scouring and bleaching',
            })}
            {optional('Pretreatment specification (bath, temperature, time)', 'pretreatmentSpec')}
            {optional('Machine type (jet, jigger, winch)', 'machineType')}
            {optionalNumber('Liquor ratio (1 : n)', 'liquorRatio')}
            {text('Dyes and chemicals: item code and dose per kg fabric', 'chemicals', 'FDYE-RED,0.02\nSALT-03,0.6')}
            {optionalNumber('Planned water L per kg', 'waterPerKg')}
            {optionalNumber('Planned steam kg per kg', 'steamPerKg')}
            {optionalNumber('Planned electricity kWh per kg', 'electricityPerKg')}
            {optionalNumber('Planned yield %', 'yieldPct', '97')}
            {joinContent(
              Object.entries(RATE_KEYS).map(([k, label]) => optionalNumber(label, k + 'Rate')),
              '',
            )}
            {optional('Approved rate card reference', 'rateRef')}
            {field('Recipe or lab dip approval', 'reference')}
          </>,
          'Approve recipe',
          'Woven rolls from a sized warp that have not been desized need a recipe whose pretreatment includes desizing. The recipe fixes the required steps in order.',
          !recipes(s).length,
        ),
      )}
      {panel(
        'Fabric dye recipes',
        table(
          ['Recipe', 'Colour and fabric', 'Pretreatment and steps', 'Dose per kg', 'Approval'],
          recipes(s)
            .slice()
            .reverse()
            .map((r) => [
              <>
                {h(r.code + ' r' + r.version)}
                <br />
                {txStatus(r.status)}
              </>,
              h(
                [r.colour, r.shade].filter(Boolean).join(' · ') +
                  ' · ' +
                  r.fabricKind +
                  (r.machineType ? ' · ' + r.machineType : ''),
              ),
              <>
                {h(r.pretreatment + (r.pretreatmentSpec ? ': ' + r.pretreatmentSpec : ''))}
                <br />
                <small>{h(r.requiredSteps.join(' → '))}</small>
              </>,
              h(r.chemicals.map((c) => c.code + ' ' + fmt(c.per) + ' ' + c.unit).join(', ') || '—'),
              h(r.reference + (r.revisionReason ? ' · ' + r.revisionReason : '')),
            ]),
          'No recipes yet.',
        ),
      )}
    </>
  );
}
function inward(app) {
  const s = app.data;
  const rolls = s.lots.filter((l) => l.material === 'Greige fabric' && l.qty > 0 && l.custody === 'Own site');
  return (
    <>
      {split(
        editor(
          app,
          'fabric-inward',
          'Receive greige rolls roll-wise',
          <>
            {select(
              'Ownership',
              'mode',
              [
                ['Direct inward', 'Own material'],
                ['Customer inward', 'Customer material (commission)'],
              ],
              {
                initial: 'Customer inward',
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
            {choose(
              'Supplier (own material)',
              'supplierId',
              s.parties.filter((p) => p.type === 'Supplier'),
              titles.party,
              {
                required: false,
              },
            )}
            {optional('Customer job order', 'commissionRef')}
            {choose(
              'Greige item',
              'itemId',
              s.items.filter((i) => i.type === 'Greige fabric' && i.unit === 'kg'),
              titles.item,
            )}
            {select('Fabric', 'fabricKind', ['Knitted', 'Woven'])}
            {field('Construction', 'construction')}
            {optionalNumber('GSM', 'gsm')}
            {optional('Width', 'width')}
            {check('Woven from a sized warp (not desized)', 'sized')}
            {text(
              'Rolls: roll ID, kg, metres where measured, customer roll number',
              'rolls',
              'CG-101,120.4,310,ABC-11',
              true,
            )}
            {field('Origin or customer store', 'origin')}
            {choose('Receiving location', 'locationId', s.locations, titles.location)}
            {select('Standard claimed', 'scheme', schemeNames(s), {
              initial: 'Conventional',
            })}
            {day('Receipt date')}
            {field('Challan or GRN', 'reference')}
          </>,
          'Post roll inward',
          'Each roll is its own lot. Customer rolls keep the customer as owner and this mill as custodian.',
        ),
      )}
      {panel(
        'Greige rolls on hand',
        table(
          ['Roll', 'Fabric', 'kg / metres', 'Owner / job', 'Custodian and location', 'Quality / claim'],
          rolls.map((l) => [
            lotLink(l.id),
            h(
              fabricKind(s, l) +
                (l.fabric ? ' · ' + l.fabric.construction : '') +
                (l.fabric?.customerRoll ? ' · customer roll ' + l.fabric.customerRoll : ''),
            ),
            h(fmt(l.qty) + ' kg' + (l.lengthM ? ' · ' + fmt(l.lengthM) + ' m' : '')),
            h(owner(s, l) + (l.commissionRef ? ' · ' + l.commissionRef : '')),
            <>
              {h(s.settings.name + ' · ' + l.custody)}
              <br />
              <small>{h(l.location)}</small>
            </>,
            <>
              {l.standardHold ? badge('Standard Hold', 'bad') : txStatus(l.qualityStatus)}
              <br />
              <small>{h([l.scheme, ...(l.additionalSchemes ?? [])].join(', '))}</small>
            </>,
          ]),
          'No greige rolls on hand.',
        ),
      )}
    </>
  );
}
function batch(app, selected) {
  const s = app.data;
  const b = selectedBatch(s, selected);
  const works = s.workOrders.filter((w) => w.stage === FABRIC_DYEING && ['Released', 'In progress'].includes(w.status));
  return (
    <>
      {split(
        editor(
          app,
          'work-order',
          'Release a fabric dyeing order',
          <>
            {hidden('stage', FABRIC_DYEING)}
            {hidden('unit', 'kg')}
            {field('Work order number', 'number')}
            {choose(
              'Approved component route',
              'componentRouteId',
              s.componentRoutes.filter((r) => r.status === 'Approved' && r.stages.includes(FABRIC_DYEING)),
              (r) => r.lineId + ' · ' + r.component + ' · route ' + r.template,
              {
                required: false,
                blank: 'Stock or commission order',
              },
            )}
            {choose('Output location', 'locationId', s.locations, titles.location)}
            {requiredNumber('Planned dyed kg', 'plannedQty')}
            {check('Re-dye of rolls held for rework', 'rework')}
            {select('Standard for stock orders', 'scheme', schemeNames(s), {
              initial: 'Conventional',
            })}
            {day('Release date')}
          </>,
          'Release order',
        ),
        editor(
          app,
          'fdye-open',
          'Form a dye batch',
          <>
            {choose('Fabric dyeing order', 'workOrderId', works, titles.wo)}
            {field('Batch number', 'number')}
            {choose(
              'Dyeing machine',
              'machineId',
              s.machines.filter((m) => m.status === 'In service'),
              (m) => m.code + ' · ' + m.name,
            )}
            {choose(
              'Recipe',
              'recipeId',
              recipes(s).filter((r) => r.status === 'Approved'),
              (r) =>
                r.code +
                ' r' +
                r.version +
                ' · ' +
                [r.colour, r.shade].filter(Boolean).join(' ') +
                ' · ' +
                r.fabricKind,
            )}
            {choose(
              'Commission customer',
              'customerId',
              s.parties.filter((p) => p.type === 'Buyer'),
              titles.party,
              {
                required: false,
                blank: 'Own material',
              },
            )}
            {optional('Customer job order', 'commissionRef')}
            {requiredNumber('Planned batch kg', 'plannedKg')}
            {day('Batch date')}
          </>,
          'Form batch',
          'A commission batch takes only that customer’s rolls for the named job.',
          works.length > 0,
        ),
        editor(
          app,
          'fdye-issue',
          'Load greige rolls into the batch',
          <>
            {batchChoice(s, b?.id)}
            {text('Rolls and kg', 'lines', 'CG-001,120.4\nCG-002,118.9\nCG-003,121.1', true)}
            {day('Loading date')}
            {field('Loading slip', 'reference')}
          </>,
          'Post loading',
          'Each roll is checked for owner, job, fabric kind against the recipe, desizing need, standard claim and availability.',
        ),
        editor(
          app,
          'fdye-entry',
          'Record a process step',
          <>
            {batchChoice(s, b?.id)}
            {select('Step', 'step', FD_STEPS, {
              initial: 'Dyeing',
            })}
            {stamp('Start', 'start', now('06:00'))}
            {stamp('End', 'end', now('10:00'))}
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
            {text('Dye and chemical lots consumed', 'chemicals', 'CHEM-FD-R1,7.2\nCHEM-SALT-03,216')}
            {optionalNumber('Temperature °C', 'temperature', '', -20)}
            {optionalNumber('Actual liquor ratio', 'liquorRatio')}
            {optionalNumber('Water L', 'water', '0')}
            {optionalNumber('Steam kg', 'steam', '0')}
            {optionalNumber('Electricity kWh', 'electricity', '0')}
            {optionalNumber('Labour hours', 'labourHours', '0')}
            {field('Process log reference', 'reference')}
          </>,
          'Post step',
        ),
      )}
      {b ? (
        <>
          {stepPanel(s, b)}
          {batchDetail(s, b)}
        </>
      ) : (
        ''
      )}
    </>
  );
}
function stepPanel(s, b) {
  const done = s.events.filter((e) => e.batchId === b.id && e.kind === 'Process entry' && !e.reversedBy);
  return panel(
    'Recipe steps · ' + b.number,
    table(
      ['Step', 'Recorded', 'Machine / shift', 'Chemical lots', 'Resources'],
      (b.requiredSteps ?? []).map((step) => {
        const rows = done.filter((e) => e.step === step);
        return [
          h(step),
          rows.length ? badge('Recorded') : badge('Pending', 'warn'),
          h(rows.map((e) => e.machineName + ' · shift ' + e.shift).join(', ') || '—'),
          joinContent(
            rows
              .flatMap((e) => e.inputs ?? [])
              .map((i) => (
                <>
                  {lotLink(i.id)} {h(fmt(i.qty) + ' ' + i.unit)}
                </>
              )),
            ', ',
          ) || '—',
          h(
            rows
              .map((e) =>
                [
                  e.water && fmt(e.water) + ' L',
                  e.steam && fmt(e.steam) + ' kg steam',
                  e.electricity && fmt(e.electricity) + ' kWh' + (e.readingId ? ' (meter ' + e.readingId + ')' : ''),
                ]
                  .filter(Boolean)
                  .join(' · '),
              )
              .join(' | ') || '—',
          ),
        ];
      }),
    ),
  );
}
function unload(app, selected) {
  const s = app.data;
  const b = selectedBatch(s, selected);
  const latest = open(s).flatMap((x) => {
    const e = ref(s.events, latestActive(x)?.eventId);
    return e ? [[x.id + '|' + e.id, x.number + ' · ' + e.id + ' · ' + (e.step || e.kind) + ' · ' + e.reference]] : [];
  });
  const dyed = b ? s.lots.filter((l) => l.batchId === b.id && l.dyed) : [];
  return (
    <>
      {split(
        editor(
          app,
          'fdye-rolls',
          'Unload dyed rolls (a receipt)',
          <>
            {batchChoice(s, b?.id)}
            {text(
              'Rolls: roll ID, dry-equivalent kg, wet kg, metres, source greige rolls joined with +, L for a leftover piece',
              'rolls',
              'CD-001,116.5,186.4,302,CG-001',
              true,
            )}
            {select('Dry-equivalent basis', 'dryBasis', DRY_BASIS, {
              initial: 'Conditioned weighing',
            })}
            {select('Result', 'result', ['Accepted', 'Rework'], {
              initial: 'Accepted',
            })}
            {optionalNumber('Waste kg (dry basis)', 'waste', '0')}
            {optionalNumber('Rejects kg', 'rejects', '0')}
            {optionalNumber('Measured gain / loss kg', 'adjustment', '', -100000000)}
            {optional('Gain / loss basis', 'adjustmentRef')}
            {optional('Shift', 'shift')}
            {optional('Operator', 'operator')}
            {day('Unloading date')}
            {field('Unloading reference', 'reference')}
          </>,
          'Post receipt',
          'Stock is held in dry-equivalent kg; the wet weight is kept as a separate measurement. Each roll draws from its listed source rolls, or from the batch when none is listed.',
        ),
        editor(
          app,
          'fdye-return',
          'Return unloaded greige or leftovers',
          <>
            {batchChoice(s, b?.id)}
            {text('Rolls and kg', 'lines', '', true)}
            {text('Notes', 'notes')}
            {day('Return date')}
            {field('Return reference', 'reference')}
          </>,
          'Post return',
        ),
        editor(
          app,
          'fdye-close',
          'Close the batch',
          <>
            {batchChoice(s, b?.id)}
            {day('Closure date')}
            {field('Closure reason', 'reason')}
            {check('Confirm remainder as measured loss', 'lossConfirmed')}
            {optional('Measured loss reference', 'lossRef')}
          </>,
          'Close batch',
        ),
        editor(
          app,
          'fdye-reverse',
          'Reverse the latest posting',
          <>
            {select('Batch and latest active posting', 'pick', latest)}
            {day('Reversal date')}
            {text('Reason', 'reason', '', true)}
          </>,
          'Post reversal',
        ),
      )}
      {b ? (
        <>
          {panel(
            'Dyed rolls · ' + b.number,
            table(
              [
                'Roll',
                'Source greige rolls',
                'Dry-equivalent / wet kg',
                'Moisture',
                'Metres',
                'Receipt',
                'Quality / on hand',
              ],
              dyed.map((l) => [
                <>
                  {lotLink(l.id)}
                  {l.dyed.leftover ? <> {badge('Leftover', 'warn')}</> : ''}
                </>,
                joinContent(l.dyed.sources.map(lotLink), ', '),
                h(fmt(l.dyed.dryKg) + ' / ' + fmt(l.dyed.wetKg)),
                h(fmt(Math.round(l.dyed.moisturePct * 10) / 10) + '% · ' + l.dyed.basis),
                h(l.lengthM ? fmt(l.lengthM) : '—'),
                h(ref(s.events, l.eventId)?.reference || ''),
                <>
                  {txStatus(l.qualityStatus)}
                  {' · '}
                  {showQty(l.qty, l.unit)}
                </>,
              ]),
              'No rolls unloaded yet.',
            ),
          )}
          {batchDetail(s, b)}
        </>
      ) : (
        ''
      )}
    </>
  );
}
function commission(app) {
  const s = app.data;
  const jobs = [
    ...new Map(
      s.processBatches
        .filter((b) => b.process === FABRIC_DYEING && b.commission)
        .map((b) => [b.customerId + '|' + b.commissionRef, b]),
    ).values(),
  ];
  const pick = app.local.fdJob || (jobs[0] ? jobs[0].customerId + '|' + jobs[0].commissionRef : '');
  const [customerId, jobRef] = pick.split('|');
  const r = customerId ? commissionBalance(s, customerId, jobRef) : null;
  return (
    <>
      {panel(
        'Commission balance',
        <>
          {form(
            'fd-job',
            select(
              'Customer job',
              'job',
              jobs.map((b) => [b.customerId + '|' + b.commissionRef, b.customer + ' · ' + b.commissionRef]),
              {
                initial: pick,
              },
            ),
            'Show balance',
          )}
          {r ? (
            <>
              {cards([
                ['Greige received', fmt(r.receivedKg) + ' kg · ' + r.receivedRolls + ' rolls'],
                ['Consumed in batches', fmt(r.consumedKg) + ' kg'],
                ['Dyed (dry-equivalent)', fmt(r.dyedKg) + ' kg'],
                ['Dyed (wet as unloaded)', fmt(r.wetKg) + ' kg'],
                ['Waste and rejects', fmt(r.wasteKg) + ' kg'],
                ['Delivered dyed', fmt(r.dyedDeliveredKg) + ' kg'],
                ['Greige returned', fmt(r.greigeDeliveredKg) + ' kg'],
                ['Still held', fmt(r.dyedHeldKg + r.greigeHeldKg + r.inProcessKg) + ' kg'],
              ])}
              {table(
                ['Check', 'Calculation', 'Balance'],
                [
                  [
                    h('Greige'),
                    h('received − consumed − in process − close loss − greige held − greige returned'),
                    r.greigeBalance ? badge(bal(r.greigeBalance) + ' kg', 'bad') : badge('0 kg'),
                  ],
                  [
                    h('Process'),
                    h('consumed + measured gain/loss − dyed − waste − rejects'),
                    r.processBalance ? badge(bal(r.processBalance) + ' kg', 'bad') : badge('0 kg'),
                  ],
                  [
                    h('Dyed'),
                    h('dyed − delivered − held'),
                    r.dyedBalance ? badge(bal(r.dyedBalance) + ' kg', 'bad') : badge('0 kg'),
                  ],
                ],
              )}
              {r.reconciled
                ? note(
                    'The job reconciles: every kg received is consumed, held or returned, and every dyed kg is delivered or held.',
                  )
                : note('The job does not reconcile. Check unposted returns or deliveries.', true)}
              {table(
                ['Challan', 'Date', 'Lots', 'Carrier'],
                r.deliveries.map((e) => [
                  h(e.reference),
                  h(e.date),
                  joinContent(
                    e.inputs.map((i) => (
                      <>
                        {lotLink(i.id)} {h(fmt(i.qty) + ' ' + i.unit)}
                      </>
                    )),
                    <br />,
                  ),
                  h(e.carrier || '—'),
                ]),
                'No deliveries yet.',
              )}
            </>
          ) : (
            note('No commission batches yet.')
          )}
        </>,
      )}
      {split(
        editor(
          app,
          'fdye-deliver',
          'Deliver to the owner (delivery challan)',
          <>
            {choose(
              'Customer',
              'customerId',
              s.parties.filter((p) => p.type === 'Buyer'),
              titles.party,
            )}
            {field('Challan number', 'number')}
            {text('Lots and kg (dyed rolls, leftovers or returned greige)', 'lines', 'CD-001,116.5', true)}
            {optional('Carrier', 'carrier')}
            {text('Notes', 'notes')}
            {day('Delivery date')}
          </>,
          'Post delivery',
        ),
        editor(
          app,
          'job-out',
          'Issue rolls to an outside dye house (outward challan)',
          <>
            {choose(
              'Roll',
              'lotId',
              s.lots.filter((l) => l.material === 'Greige fabric' && l.qty > 0),
              titles.lot,
            )}
            {choose(
              'Processor',
              'processorId',
              s.parties.filter((p) => p.type === 'Processor'),
              titles.party,
            )}
            {field('Processor facility', 'site')}
            {hidden('stage', FABRIC_DYEING)}
            {requiredNumber('Quantity kg', 'qty')}
            {field('Outward challan', 'number')}
            {day('Outward date')}
            {optional('Carrier', 'carrier')}
          </>,
          'Post outward issue',
          'Claimed rolls need the processor’s verified scope to cover fabric dyeing at that facility. Returns post under Outside job work.',
        ),
      )}
    </>
  );
}
function history(app) {
  const s = app.data;
  const lot = ref(s.lots, app.local.fdLot);
  return (
    <>
      {panel(
        'Find a roll',
        form(
          'fd-history',
          field('Roll ID or scanned label', 'lotId', {
            value: lot?.id || '',
            required: false,
          }),
          'Show history',
        ),
      )}
      {lot?.dyed
        ? panel(
            'Dyed roll ' + lot.id,
            facts([
              ['Source greige rolls', joinContent(lot.dyed.sources.map(lotLink), ', ')],
              ['Batch and recipe', h(lot.dyed.batch + ' · ' + lot.dyed.recipe)],
              [
                'Dry-equivalent / wet',
                h(fmt(lot.dyed.dryKg) + ' kg / ' + fmt(lot.dyed.wetKg) + ' kg (' + lot.dyed.basis + ')'),
              ],
              ['Owner', h(owner(s, lot) + (lot.commissionRef ? ' · ' + lot.commissionRef : ''))],
            ]),
          )
        : ''}
      {lot ? lotHistory(s, lot) : ''}
    </>
  );
}
function FabricDyeingPage({ app }) {
  const p = params();
  const tab = tabs.some(([key]) => key === p.get('tab')) ? p.get('tab') : 'setup';
  const body = {
    setup,
    inward,
    batch,
    unload,
    commission,
    history,
  }[tab](app, p.get('batch') || '');
  return (
    <>
      {heading(
        'Fabric dyeing',
        'Receive knitted or woven greige roll by roll, form dye batches for own or customer material, and unload dyed rolls that keep their source rolls and both wet and dry-equivalent weights.',
        <a className="button secondary" href="#jobwork">
          Outside job work
        </a>,
      )}
      {tabBar(tab)}
      {body}
    </>
  );
}
export { FabricDyeingPage };
