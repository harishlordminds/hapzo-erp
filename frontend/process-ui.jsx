import { joinContent } from './react-ui.jsx';
// Views shared by process screens (yarn dyeing, ginning, fibre preparation).
import { ref, genealogy, today } from '../src/model.js';
import { schemesOf } from '../src/commerce.js';
import { stageLabel } from '../src/routes.js';
import { batchSummary, lineRemaining, lineRemainingKg, wipLabel } from '../src/process-batch.js';
import {
  h,
  fmt,
  badge,
  txStatus,
  valueOf,
  showQty,
  panel,
  split,
  details,
  table,
  field,
  numberField,
  facts,
  cards,
  lotLink,
} from './ui.jsx';
export const optional = (label, name, value = '') =>
  field(label, name, {
    required: false,
    value,
  });
export const optionalNumber = (label, name, value = '', min = 0) =>
  numberField(label, name, {
    required: false,
    value,
    min,
  });
export const requiredNumber = (label, name, value = '') =>
  numberField(label, name, {
    value,
  });
export const now = (hour) => today() + 'T' + hour;
export const stamp = (label, name, value) =>
  field(label, name, {
    type: 'datetime-local',
    value,
  });
export const params = () => new URLSearchParams(window.location.hash.split('?')[1] || '');
export const ownerName = (s, l) => ref(s.parties, l.ownerId)?.name || s.settings.name;
export const recipeText = (b) =>
  [b.recipe.code && b.recipe.code + ' r' + b.recipe.version, b.recipe.shade || b.recipe.blend || b.recipe.variety]
    .filter(Boolean)
    .join(' · ') || '—';
export function reverseInput(input) {
  const [batchId, eventId] = String(input.pick || '').split('|');
  return {
    batchId,
    eventId,
    date: input.date,
    reason: input.reason,
  };
}
export function stockHint(s, rows, empty) {
  return table(
    ['Lot', 'Material', 'On hand', 'Measured kg basis', 'Owner / custodian / location', 'Quality / claim'],
    rows.map((l) => [
      lotLink(l.id),
      h(l.label || l.material),
      showQty(l.qty, l.unit),
      h(
        l.unit === 'kg'
          ? 'Stock unit kg'
          : l.netKg
            ? fmt(l.netKg) + ' kg for ' + fmt(l.initialQty) + ' ' + l.unit
            : 'Weigh at issue',
      ),
      <>
        {h(ownerName(s, l))}
        <br />
        <small>{h(s.settings.name + ' · ' + l.custody + ' · ' + l.location)}</small>
      </>,
      <>
        {l.standardHold ? badge('Standard Hold', 'bad') : txStatus(l.qualityStatus)}
        <br />
        <small>{h(schemesOf(l).join(', ') || 'Conventional')}</small>
      </>,
    ]),
    empty,
  );
}
export function plannedActual(s, b) {
  const sum = batchSummary(s, b);
  return (
    <>
      {cards([
        ['Issued', fmt(sum.issuedKg) + ' kg'],
        ['Work in progress', fmt(sum.wipKg) + ' kg'],
        ['Accepted output', fmt(sum.acceptedKg) + ' kg'],
        ['Rework', fmt(sum.reworkKg) + ' kg'],
        ['Waste / rejects', fmt(sum.waste) + ' / ' + fmt(sum.rejects) + ' kg'],
        ['Returned unused', fmt(sum.returnedKg) + ' kg'],
        ['Yield on consumed', sum.yieldPct == null ? '—' : fmt(sum.yieldPct) + '%'],
      ])}
      {table(
        ['Measure', 'Planned', 'Actual', 'Unit', 'Plan basis'],
        sum.rows.map(([label, plan, actual, unit, basis]) => [
          h(label),
          plan == null ? '—' : h(fmt(plan)),
          h(fmt(actual)),
          h(unit),
          h(basis),
        ]),
      )}
    </>
  );
}
export function batchDetail(s, b) {
  const wo = ref(s.workOrders, b.workOrderId);
  const events = s.events.filter((e) => e.batchId === b.id);
  return panel(
    'Batch ' + b.number,
    <>
      {facts([
        ['Work order', h(wo?.number || b.workOrderId)],
        [
          'Route',
          h(
            wo?.componentRoute
              ? wo.componentRoute.template + ' r' + wo.componentRoute.version + ' · ' + wo.componentRoute.component
              : wo?.route || 'Stock job',
          ),
        ],
        ['BOM revision', valueOf(wo?.revisionPins?.bom)],
        ['Plan / recipe', h(recipeText(b))],
        ['Handoff', valueOf(b.handoff)],
        ['Machine', h(b.machineName)],
        ['Site', h(b.site)],
        ['Owner', h(b.ownerId ? ref(s.parties, b.ownerId)?.name : s.settings.name)],
        ['Custodian', h(s.settings.name + ' · ' + wipLabel(b))],
        ['Status', txStatus(b.status)],
      ])}
      {plannedActual(s, b)}
      {details(
        'Issued lots and work in progress',
        table(
          ['Line', 'Lot', 'Issued', 'Consumed', 'Returned', 'In process', 'Conversion basis'],
          b.lines.map((l) => [
            h(l.key),
            lotLink(l.lotId),
            <>
              {showQty(l.issued, l.unit)}
              <br />
              <small>{h(fmt(l.issuedKg) + ' kg')}</small>
            </>,
            h(fmt(l.consumedKg) + ' kg'),
            showQty(l.returned, l.unit),
            <>
              {showQty(lineRemaining(l), l.unit)}
              <br />
              <small>{h(fmt(lineRemainingKg(l)) + ' kg')}</small>
            </>,
            h([l.component && 'Blend component ' + l.component, l.basis, l.basisRef].filter(Boolean).join(' · ')),
          ]),
        ),
        true,
      )}
      {details('Postings and corrections', postingTable(s, events))}
    </>,
  );
}
export function postingTable(s, events) {
  return table(
    ['Posted', 'Type', 'Reference', 'Inputs', 'Output', 'Operator / machine', 'Resources', 'Evidence / status'],
    events
      .slice()
      .reverse()
      .map((e) => [
        <>
          {h(e.date)}
          <br />
          <small>{h(e.actor)}</small>
        </>,
        <>
          {h(e.step || e.type || e.kind)}
          {e.kind === 'Production' ? (
            <>
              <br />
              <small>Output</small>
            </>
          ) : (
            ''
          )}
        </>,
        <>
          {h(e.reference)}
          {e.start ? (
            <>
              <br />
              <small>{h(e.start.replace('T', ' ') + ' → ' + e.end.slice(11))}</small>
            </>
          ) : (
            ''
          )}
        </>,
        joinContent(
          (e.inputs ?? []).map((a) => (
            <>
              {lotLink(a.id)}
              {' · '}
              {showQty(a.qty, a.unit)}
              {a.kg != null && a.unit !== 'kg' ? ' (' + h(fmt(a.kg)) + ' kg)' : ''}
            </>
          )),
          <br />,
        ) || '—',
        e.output && e.kind === 'Production' ? (
          <>
            {joinContent((e.outputs ?? [e.output]).map(lotLink), ', ')}
            {' · '}
            {showQty(e.qty, e.unit)}
            <br />
            <small>
              {h(
                'Consumed ' +
                  fmt(e.reconciliation.input) +
                  ' kg' +
                  (e.reconciliation.byProduct ? ' · by-product ' + fmt(e.reconciliation.byProduct) + ' kg' : '') +
                  ' · waste ' +
                  fmt(e.reconciliation.waste) +
                  ' · rejects ' +
                  fmt(e.reconciliation.rejects) +
                  (e.canNo ? ' · can ' + e.canNo : '') +
                  (e.reconciliation.adjustment ? ' · adjustment ' + fmt(e.reconciliation.adjustment) : ''),
              )}
            </small>
          </>
        ) : (
          '—'
        ),
        h([e.operator, e.shift && 'Shift ' + e.shift, e.machineName].filter(Boolean).join(' · ') || '—'),
        h(
          [
            e.electricity && fmt(e.electricity) + ' kWh',
            e.water && fmt(e.water) + ' L',
            e.steam && fmt(e.steam) + ' kg steam',
            e.labourHours && fmt(e.labourHours) + ' h labour',
            e.machineHours && fmt(e.machineHours) + ' h machine',
            e.temperature != null && e.temperature !== undefined ? e.temperature + ' °C' : '',
            e.moisture != null && e.moisture !== undefined ? 'moisture ' + e.moisture + '%' : '',
            e.droppings ? fmt(e.droppings) + ' kg droppings' : '',
            e.laydown ? e.laydown.number + ': ' + e.laydown.lots.join(', ') : '',
          ]
            .filter(Boolean)
            .join(' · ') || '—',
        ),
        <>
          {h(
            (e.checks ?? []).map((c) => c.scheme + ' / ' + c.evidence.map((x) => x.number).join(', ')).join(' · ') ||
              e.reason ||
              '',
          )}
          {e.reversedBy ? (
            <>
              <br />
              {badge('Reversed by ' + e.reversedBy, 'bad')}
            </>
          ) : e.kind === 'Reversal' ? (
            <>
              <br />
              {badge('Reverses ' + e.reverses, 'warn')}
            </>
          ) : (
            ''
          )}
        </>,
      ]),
    'No postings on this batch yet.',
  );
}
export function lotHistory(s, lot) {
  const back = genealogy(s, lot.id);
  const ahead = genealogy(s, lot.id, true);
  const related = new Set([lot.id, ...back.map((l) => l.id), ...ahead.map((l) => l.id)]);
  const touches = (e) =>
    [e.output, e.input, e.lotId].includes(lot.id) ||
    e.inputs?.some((i) => i.id === lot.id) ||
    e.moves?.some((m) => m.lotId === lot.id);
  const chain = (rows) =>
    table(
      ['Lot', 'Material / stage', 'Batch / work order', 'Owner', 'On hand'],
      rows.map((x) => [
        lotLink(x.id),
        h(x.material + ' · ' + stageLabel(x.stage)),
        h(
          [ref(s.processBatches, x.batchId)?.number, ref(s.workOrders, x.workOrderId)?.number]
            .filter(Boolean)
            .join(' · ') || '—',
        ),
        h(ref(s.parties, x.ownerId)?.name || s.settings.name),
        showQty(x.qty, x.unit),
      ]),
      'None recorded.',
    );
  const parentRows = (lot.parents ?? []).map((p) => [
    lotLink(p.id),
    h(p.role || 'Input'),
    showQty(p.qty, p.unit),
    p.kg != null ? h(fmt(p.kg) + ' kg') : '—',
  ]);
  return panel(
    'Lot ' + lot.id + ' · ' + lot.material,
    <>
      {facts([
        [
          'On hand',
          <>
            {showQty(lot.qty, lot.unit)}
            {lot.netKg && lot.unit !== 'kg' ? (
              <>
                {' '}
                <small>
                  ({h(fmt(lot.netKg))}
                  {' kg measured for '}
                  {h(fmt(lot.initialQty) + ' ' + lot.unit)})
                </small>
              </>
            ) : (
              ''
            )}
          </>,
        ],
        ['Owner', h(ref(s.parties, lot.ownerId)?.name || s.settings.name)],
        ['Custodian', h(s.settings.name + ' · ' + lot.custody)],
        ['Location', h(lot.location)],
        ['Stage', h(stageLabel(lot.stage))],
        ['Shade', valueOf(lot.shade)],
        ['Conversion basis', valueOf(lot.conversionBasis)],
        ['Origin / supplier', h([lot.originCountry, lot.origin, lot.party].filter(Boolean).join(' · ') || '—')],
        ...(lot.intake
          ? [
              [
                'Seed cotton intake',
                h(
                  lot.intake.grower +
                    (lot.intake.farmId ? ' (' + lot.intake.farmId + ')' : '') +
                    ' · ' +
                    fmt(lot.intake.grossKg) +
                    ' − ' +
                    fmt(lot.intake.tareKg) +
                    ' = ' +
                    fmt(lot.intake.netKg) +
                    ' kg · ' +
                    lot.intake.basis +
                    ' · ticket ' +
                    lot.intake.ticket +
                    (lot.intake.moisture != null ? ' · moisture ' + lot.intake.moisture + '%' : '') +
                    (lot.intake.trash != null ? ' · trash ' + lot.intake.trash + '%' : ''),
                ),
              ],
            ]
          : []),
        ...(lot.fibre
          ? [
              [
                'Lint',
                h(
                  [
                    lot.fibre.ginner && 'Ginner ' + lot.fibre.ginner,
                    lot.fibre.ginRun && 'Gin run ' + lot.fibre.ginRun,
                    lot.variety,
                    lot.fibre.lotMark,
                    lot.fibre.baleCount +
                      ' bale' +
                      (lot.fibre.baleCount === 1 ? '' : 's') +
                      ' (' +
                      lot.fibre.tracking +
                      ')',
                    lot.fibre.basis,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ),
              ],
            ]
          : []),
        ...(lot.yarn
          ? [
              [
                'Yarn',
                h(
                  lot.yarn.count.actual +
                    ' ' +
                    lot.yarn.count.system +
                    ' measured (nominal ' +
                    lot.yarn.count.nominal +
                    ', ' +
                    lot.yarn.count.deviation +
                    '%, ' +
                    lot.yarn.count.test +
                    ') · ' +
                    lot.yarn.route +
                    (lot.yarn.twist ? ' · ' + lot.yarn.twist : '') +
                    ' · spin lot ' +
                    lot.yarn.spinLot +
                    ' · blend ' +
                    (lot.yarn.blends.join(', ') || '—') +
                    ' · ' +
                    lot.yarn.packages.cones +
                    ' cones ' +
                    (lot.yarn.packages.first ? lot.yarn.packages.first + ' to ' + lot.yarn.packages.last : '(listed)'),
                ),
              ],
            ]
          : []),
        [
          'Quality',
          <>
            {txStatus(lot.qualityStatus)}
            {lot.qualityNote ? (
              <>
                {' '}
                <small>{h(lot.qualityNote)}</small>
              </>
            ) : (
              ''
            )}
          </>,
        ],
        [
          'Standard',
          lot.standardHold
            ? badge('Standard Hold · ' + lot.holdReason, 'bad')
            : h(schemesOf(lot).join(', ') || 'Conventional'),
        ],
      ])}
      {lot.fibre?.bales?.length
        ? details(
            'Bales',
            table(
              ['Bale', 'Net kg', 'Gross kg', 'Micronaire', 'Staple mm', 'Strength g/tex'],
              lot.fibre.bales.map((b) => [
                h(b.no),
                h(fmt(b.netKg)),
                b.grossKg ? h(fmt(b.grossKg)) : '—',
                b.mic ?? '—',
                b.staple ?? '—',
                b.strength ?? '—',
              ]),
            ),
          )
        : ''}
      {parentRows.length
        ? details('Direct inputs', table(['Input lot', 'Role', 'Quantity', 'Measured kg'], parentRows), true)
        : ''}
      {split(details('Trace backward', chain(back), true), details('Trace forward', chain(ahead), true))}
      {details('Postings for this lot', postingTable(s, s.events.filter(touches)), true)}
      {details('Related lots in the chain', h([...related].join(', ')))}
    </>,
  );
}
