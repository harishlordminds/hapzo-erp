import { joinContent, setContents } from './react-ui.jsx';
import { PRINT_STAGES, STAGES, ref, sum } from '../src/model.mjs';
import { stageLabel } from '../src/routes.mjs';
import { EMBROIDERY, PRINTING, PRINT_FINISHES, unprintedQty } from '../src/printing.mjs';
import { lineRemaining } from '../src/process-batch.mjs';
import {
  h,
  fmt,
  showQty,
  valueOf,
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
  field,
  day,
  text,
  check,
  choose,
  select,
  option,
  file,
  hidden,
  numberField,
  lotLink,
  printBatchLink,
  embroideryBatchLink,
  linkButton,
  navLink,
  docs,
  titles,
  lineLabel,
  can,
  money,
} from './ui.jsx';
const artTitle = (a) => a.code + ' r' + a.version;
const optional = (label, name) =>
  field(label, name, {
    required: false,
  });
const num = (label, name, required = true) =>
  numberField(label, name, {
    required,
  });
const workList = (s, embroidery) =>
  s.workOrders.filter(
    (w) =>
      w.printArtworkId && (w.stage === EMBROIDERY) === embroidery && ['Released', 'In progress'].includes(w.status),
  );
const batchDoc = (b) => (b.jobId ? 'logistics' : 'production');
const stateFor = (s, b) => ref(s.jobs, b.jobId)?.status || b.status;
const isEmbroidery = (b) => b.process === EMBROIDERY;
const recordFor = (b, row) => (isEmbroidery(b) ? row.embroidery : row.printing);
const decorationLink = (b, label = b.number) => (isEmbroidery(b) ? embroideryBatchLink : printBatchLink)(b.id, label);
export function selectPrintWork(form, s) {
  const wo = ref(s.workOrders, form.elements.workOrderId.value);
  const embroidery = wo?.stage === EMBROIDERY;
  const fill = wo
    ? s.lots.filter(
        (lot) =>
          lot.qty > 0 &&
          !lot.standardHold &&
          lot.custody === 'Own site' &&
          lot.site === wo.site &&
          lot.unit === wo.unit &&
          (wo.rework
            ? lot.qualityStatus === 'Rework' &&
              (embroidery ? lot.embroidery : lot.printing)?.artworkId === wo.printArtworkId &&
              (embroidery ? lot.embroidery : lot.printing).disposition === (embroidery ? 'Rework' : 'Misprint')
            : lot.qualityStatus === 'Released' && STAGES[wo.stage].primary.includes(lot.material)),
      )
    : [];
  setContents(
    form.elements.lotPicker,
    <>
      {option('', 'Select…')}
      {joinContent(
        fill.map((lot) => option(lot.id, titles.lot(lot))),
        '',
      )}
    </>,
  );
}
function setupForms(app, list, embroidery) {
  const s = app.data;
  const stages = embroidery ? [EMBROIDERY] : PRINT_STAGES;
  const label = embroidery ? 'embroidery' : 'print';
  const routes = s.componentRoutes.filter(
    (r) => r.status === 'Approved' && r.stages.some((stage) => stages.includes(stage)),
  );
  const lines = s.lines.filter(
    (line) =>
      line.status === 'Approved' &&
      (line.stages.some((stage) => stages.includes(stage)) || routes.some((r) => r.lineId === line.id)),
  );
  return split(
    editor(
      app,
      'print-artwork',
      'Approve ' + label + ' artwork',
      <>
        {choose('Approved buyer PO line', 'lineId', lines, (line) => lineLabel(s, line))}
        {choose(
          'Approved fabric component route',
          'componentRouteId',
          routes,
          (r) => r.lineId + ' · ' + r.component + ' · Route ' + r.template,
          {
            required: false,
            blank: 'Use the PO line route',
          },
        )}
        {embroidery
          ? hidden('stage', EMBROIDERY)
          : select(
              'Operation placement',
              'stage',
              stages.map((stage) => [stage, stageLabel(stage)]),
            )}
        {field('Artwork code', 'code')}
        {field('Artwork revision', 'version')}
        {field(embroidery ? 'Embroidery method' : 'Print method', 'method', {
          placeholder: embroidery ? 'Multihead embroidery' : 'Screen printing',
        })}
        {field('Design or artwork reference', 'design')}
        {field('Placement on the article', 'placement')}
        {embroidery
          ? field('Design file name or reference', 'designFile')
          : select('Required post-print treatment', 'finish', Object.keys(PRINT_FINISHES), {
              initial: 'None',
            })}
        {field('Approval reference', 'reference')}
        {day('Effective date', 'effective')}
        {text('Artwork instructions', 'instructions')}
        {file('Approved artwork file', app.user.role === 'Merchandising' ? 'tech-pack' : 'production')}
      </>,
      'Approve artwork revision',
    ),
    editor(
      app,
      'print-order',
      'Release a ' + label + ' work order',
      <>
        {choose(
          'Approved artwork revision',
          'artworkId',
          list,
          (a) => artTitle(a) + ' · ' + stageLabel(a.stage) + ' · ' + a.lineId,
          {
            hook: 'print-artwork',
          },
        )}
        {field('Work order number', 'number')}
        {choose('Output location', 'locationId', s.locations, titles.location)}
        {num('Planned accepted quantity', 'plannedQty')}
        {select(
          'Stock unit',
          'unit',
          embroidery ? ['pcs', 'bundle'] : ['pcs', 'bundle', 'm', 'kg', 'roll', 'cm', 'g'],
          {
            initial: 'pcs',
          },
        )}
        {check('Rework order', 'rework')}
        {day('Release date')}
        {day('Due date', 'due', false)}
        {text('Work instructions', 'notes')}
      </>,
      'Release work order',
    ),
  );
}
function issueEditor(app, mode, embroidery) {
  const s = app.data;
  const outside = mode === 'Commission';
  const label = embroidery ? 'embroidery' : 'printing';
  return editor(
    app,
    'print-issue',
    outside ? 'Send ' + label + ' to a processor' : 'Issue stock to in-house ' + label,
    <>
      {hidden('mode', mode)}
      {choose('Open work order', 'workOrderId', workList(s, embroidery), (w) => titles.wo(w) + ' · ' + w.unit, {
        hook: 'print-work',
      })}
      {field('Batch number', 'number')}
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
          {optional('Carrier or vehicle', 'carrier')}
        </>
      ) : (
        ''
      )}
      {day('Issue date')}
      {select('Add an input lot', 'lotPicker', [], {
        required: false,
        hook: 'process-input-lot',
      })}
      {text('Source lot ID and quantity in its stock unit, one per line', 'inputs', 'CUT-BUNDLE-001,100', true)}
      {text('Issue notes', 'notes')}
      {file(outside ? 'Outward challan attachment' : 'Issue slip attachment', outside ? 'logistics' : 'production')}
    </>,
    outside ? 'Post outward challan' : 'Post material issue',
  );
}
function artworkFacts(b) {
  const a = b.artwork;
  const embroidery = isEmbroidery(b);
  return (
    <>
      {facts([
        ['Operation placement', h(stageLabel(b.stage) + (b.rework ? ' · Rework' : ''))],
        ['Artwork revision', h(artTitle(a))],
        ['Approval', h(a.reference)],
        ['Artwork file', docs(a.document)],
        ['Design', h(a.design)],
        ['Placement', h(a.placement)],
        ['Method', h(a.method)],
        embroidery
          ? ['Design file reference', h(a.designFile)]
          : ['Post-print treatment', h(a.aftercare.join(' → ') || 'None specified')],
        ['Approved PO / spec', h(a.lineId + ' · r' + a.lineRevision + ' · spec ' + a.specRev)],
        [
          'Approved route',
          h(a.componentRoute ? 'Route ' + a.componentRoute.template + ' · ' + a.componentRoute.component : b.route),
        ],
      ])}
      {a.instructions ? note(a.instructions) : ''}
    </>
  );
}
function printChemicals(rows) {
  return (
    joinContent(
      rows.map((c) => (
        <>
          {c.lotId ? lotLink(c.lotId) : h(c.lotRef)}
          {' · '}
          {h(c.code)}
          {' · '}
          {showQty(c.qty, c.unit)}
        </>
      )),
      <br />,
    ) || '—'
  );
}
function operationEditor(app, b, run = null) {
  const s = app.data;
  const embroidery = isEmbroidery(b);
  const next = run ? b.artwork.aftercare[run.aftercare.length] : embroidery ? EMBROIDERY : 'Print';
  return editor(
    app,
    'print-operation',
    run ? 'Record ' + next.toLowerCase() + ' · ' + run.reference : 'Record a ' + next.toLowerCase() + ' run',
    <>
      {hidden('batchId', b.id)}
      {hidden('operation', next)}
      {run ? (
        hidden('runId', run.id)
      ) : (
        <>
          {select(
            'Input lot',
            'lotId',
            b.lines
              .filter((row) => unprintedQty(b, row) > 0)
              .map((row) => [
                row.lotId,
                row.lotId + ' · ' + fmt(unprintedQty(b, row)) + ' ' + b.unit + ' available for run',
              ]),
          )}
          {num('Run quantity (' + b.unit + ')', 'qty')}
          {embroidery ? (
            <>
              {num('Active machine heads', 'heads')}
              {num('Stitches per piece', 'stitches', false)}
            </>
          ) : (
            field('Ink, paste or transfer batch', 'inkBatch')
          )}
        </>
      )}
      {b.jobId
        ? field('Processor machine ID or name', 'machine')
        : choose(
            'Actual machine',
            'machineId',
            s.machines.filter((m) => m.status === 'In service' && ref(s.locations, m.locationId)?.site === b.site),
            (m) => m.code + ' · ' + m.name,
          )}
      {day('Operation date')}
      {field('Run or treatment reference', 'reference')}
      {text(
        run ? 'Actual conditions or cycle reference' : 'Actual machine settings',
        'settings',
        run ? 'Temperature, time, or cycle record' : '',
        Boolean(run),
      )}
      {embroidery ? (
        b.jobId ? (
          text(
            'Thread or backing item code, processor lot, quantity',
            'supplies',
            'THREAD-NAVY,PROCESSOR-THREAD-01,0.1',
            true,
          )
        ) : (
          text(
            'Thread or backing lot ID, quantity in lot unit',
            'supplies',
            'THREAD-LOT-01,0.1\nBACKING-LOT-01,0.03',
            true,
          )
        )
      ) : (
        <>
          {b.jobId
            ? text('Chemical item code, processor lot, quantity', 'chemicals', 'PRINT-INK-NAVY,PROCESSOR-INK-01,0.5')
            : text('Chemical stock lot ID, quantity in lot unit', 'chemicals', 'INK-LOT-01,0.5')}
          {run ? '' : check('No chemicals used at this operation', 'noChemicals')}
        </>
      )}
      {file('Operation report', batchDoc(b))}
    </>,
    run ? 'Record ' + next.toLowerCase() : 'Post run',
  );
}
function receiptEditor(app, b, run = null) {
  const s = app.data;
  const rework = isEmbroidery(b) ? 'Rework' : 'Misprint';
  return editor(
    app,
    'print-output',
    run
      ? (b.jobId ? 'Receive processed stock' : 'Post processed output') + ' · ' + run.reference
      : 'Return unused stock',
    <>
      {hidden('batchId', b.id)}
      {run ? (
        hidden('runId', run.id)
      ) : (
        <>
          {hidden('unused', 'yes')}
          {select(
            'Unprocessed lot',
            'lotId',
            b.lines
              .filter((row) => unprintedQty(b, row) > 0)
              .map((row) => [row.lotId, row.lotId + ' · ' + fmt(unprintedQty(b, row)) + ' ' + b.unit + ' available']),
          )}
        </>
      )}
      {num('Quantity reconciled (' + b.unit + ')', 'used')}
      {field(b.jobId ? 'Inward challan or loss reference' : 'Output reference', 'reference')}
      {day()}
      {choose(
        'Receiving location',
        'locationId',
        s.locations.filter((l) => l.site === ref(s.workOrders, b.workOrderId)?.site),
        titles.location,
        {
          required: false,
          blank: 'Use work order location',
        },
      )}
      {run ? (
        <>
          {text(
            'Disposition, new lot ID, quantity, optional net kg, optional metres',
            'outputs',
            'Accepted,GOOD-01,60\n' + rework + ',REWORK-01,6\nRejected,REJECT-01,1',
          )}
          {num('Waste (' + b.unit + ')', 'waste', false)}
          {['kg', 'g', 'm', 'cm'].includes(b.unit)
            ? numberField('Measured quantity adjustment', 'adjustment', {
                required: false,
                min: -1e8,
              })
            : ''}
        </>
      ) : (
        field('Returned lot ID', 'unusedId')
      )}
      {text('Disposition, loss or adjustment reason', 'notes')}
      {file('Return or inspection report', batchDoc(b))}
    </>,
    run ? (b.jobId ? 'Post actual return' : 'Post output') : 'Return unused material',
    run
      ? fmt(run.remaining) +
          ' ' +
          b.unit +
          ' remain on this run. Use Accepted, ' +
          rework +
          ', or Rejected for each returned lot.'
      : '',
  );
}
function batchHistory(app, b) {
  const s = app.data;
  const embroidery = isEmbroidery(b);
  const returns = b.postings
    .filter((p) => ['Output', 'Unused return'].includes(p.kind))
    .map((p) => ref(s.events, p.eventId))
    .filter(Boolean);
  const lots = returns.flatMap((e) => e.lotIds.map((id) => ref(s.lots, id))).filter(Boolean);
  const misprints = new Set(
    lots.filter((lot) => recordFor(b, lot)?.disposition === (embroidery ? 'Rework' : 'Misprint')).map((lot) => lot.id),
  );
  const rework = s.processBatches.filter(
    (batch) => batch.process === b.process && batch.rework && batch.lines.some((line) => misprints.has(line.lotId)),
  );
  const relatedIds = new Set([b.id, ...rework.map((batch) => batch.id)]);
  const ready = new Set(
    s.lots
      .filter((lot) => relatedIds.has(recordFor(b, lot)?.batchId) && recordFor(b, lot)?.disposition === 'Accepted')
      .map((lot) => lot.id),
  );
  const handoffs = s.events.filter(
    (e) =>
      e.stage !== b.stage &&
      ['Process issue', 'Production'].includes(e.kind) &&
      e.inputs?.some((input) => ready.has(input.id)),
  );
  const bills = embroidery && b.jobId && can(app, 'cost') ? s.costs.filter((c) => c.embroideryBatchId === b.id) : [];
  return (
    <>
      {panel(
        'Actual runs and treatments',
        table(
          [
            'Run or treatment',
            'Source lot',
            'Run quantity',
            'Machine',
            embroidery ? 'Heads / stitches per piece' : 'Ink / paste batch',
            embroidery ? 'Thread and backing lots' : 'Chemical lots',
            'Conditions',
          ],
          b.runs.flatMap((run) =>
            [run, ...run.aftercare].map((step) => [
              <>
                {h(step.reference)}
                <br />
                <small>{h(step.operation + ' · ' + step.date)}</small>
              </>,
              lotLink(run.lotId),
              showQty(run.qty, b.unit),
              h(step.machineName),
              embroidery ? h(run.heads + ' / ' + (run.stitches || '—')) : h(run.inkBatch),
              printChemicals(embroidery ? step.supplies || [] : step.chemicals),
              valueOf(step.settings),
            ]),
          ),
        ),
      )}
      {panel(
        'Actual receipts and dispositions',
        table(
          [
            'Receipt',
            'Original lot reconciled',
            'Output lots',
            'Waste',
            'Outstanding after return',
            'Disposition reason',
          ],
          returns.map((e) => [
            <>
              {h(e.reference)}
              <br />
              <small>{h(e.date)}</small>
            </>,
            <>
              {lotLink(e.inputs[0].id)}
              {' · '}
              {showQty(e.inputs[0].qty, b.unit)}
            </>,
            joinContent(
              e.lotIds.map((id) => {
                const lot = ref(s.lots, id);
                const disposition = e.kind === 'Unused return' ? 'Unused' : recordFor(b, lot).disposition;
                return (
                  <>
                    {lotLink(id)}
                    {' · '}
                    {showQty(lot.initialQty, b.unit)}
                    {' · '}
                    {txStatus(lot.standardHold ? 'Hold' : disposition)}
                    {embroidery && b.jobId && can(app, 'cost') && disposition !== 'Unused' ? (
                      <>
                        <br />
                        <a href={'#invoices?embroideryLot=' + encodeURIComponent(id)}>Record service bill</a>
                      </>
                    ) : (
                      ''
                    )}
                  </>
                );
              }),
              <br />,
            ) || '—',
            showQty(e.reconciliation.waste, b.unit),
            recordFor(b, e).outstanding == null ? '—' : showQty(recordFor(b, e).outstanding, b.unit),
            valueOf(recordFor(b, e).reason),
          ]),
          'No output or return posted yet.',
        ),
      )}
      {bills.length
        ? panel(
            'Linked processor service bills',
            table(
              ['Vendor bill', 'Inward return', 'Affected lot', 'Landed amount', 'Accounts voucher'],
              bills.map((c) => {
                const v = s.vouchers.find((row) => row.source?.id === c.id);
                return [
                  h(c.reference),
                  valueOf(ref(s.events, c.returnEventId)?.reference),
                  lotLink(c.lot),
                  h(money(c.landed)),
                  v ? linkButton(v.number, 'voucher', v.id) : '—',
                ];
              }),
            ),
          )
        : ''}
      {misprints.size || rework.length
        ? panel(
            'Rework history',
            table(
              ['Rework input', 'Rework batch', 'Recovered', 'Rejected', 'Status'],
              rework.map((batch) => [
                joinContent(
                  batch.lines.map((line) => lotLink(line.lotId)),
                  <br />,
                ),
                decorationLink(batch),
                showQty(batch.acceptedQty, batch.unit),
                showQty(batch.rejectedQty, batch.unit),
                txStatus(stateFor(s, batch)),
              ]),
              'Release a rework order against the same artwork revision.',
            ),
          )
        : ''}
      {handoffs.length
        ? panel(
            'Accepted stock issued to the next job',
            table(
              ['Next operation', 'Work order', 'Accepted input lots', 'Next output'],
              handoffs.map((e) => [
                h(e.stage),
                linkButton(ref(s.workOrders, e.workOrderId)?.number || e.workOrderId, 'work-order', e.workOrderId),
                joinContent(
                  e.inputs
                    .filter((row) => ready.has(row.id))
                    .map((row) => (
                      <>
                        {lotLink(row.id)}
                        {' · '}
                        {showQty(row.qty, row.unit)}
                      </>
                    )),
                  <br />,
                ),
                e.kind === 'Process issue'
                  ? '—'
                  : joinContent((e.lotIds ?? e.outputs ?? [e.output]).map(lotLink), <br />),
              ]),
            ),
          )
        : ''}
    </>
  );
}
function detail(app, b) {
  const s = app.data;
  const unprinted = b.lines.some((row) => unprintedQty(b, row) > 0);
  const work = ref(s.workOrders, b.workOrderId);
  const evidence = [...new Map(b.checks.flatMap((row) => row.evidence.map((ev) => [ev.id, ev]))).values()];
  return (
    <>
      {panel(
        (isEmbroidery(b) ? 'Embroidery batch ' : 'Print batch ') + b.number,
        <>
          {cards([
            [b.jobId ? 'Sent on challan' : 'Issued to production', fmt(b.issuedQty) + ' ' + b.unit],
            [b.jobId ? 'Processed stock received' : 'Processed output posted', fmt(b.returnedQty) + ' ' + b.unit],
            [b.jobId ? 'Remaining at processor' : 'Remaining in production', fmt(b.remainingQty) + ' ' + b.unit],
            ['Accepted from this batch', fmt(b.acceptedQty) + ' ' + b.unit],
          ])}
          {facts([
            ['Status', txStatus(stateFor(s, b))],
            ['Process site', h([b.processor, b.site, b.mode].filter(Boolean).join(' · '))],
            ['Work order', linkButton(work?.number || b.workOrderId, 'work-order', b.workOrderId)],
            ['Outward challan', valueOf(b.challan)],
            [
              'Rework / rejected / waste',
              showQty(b.misprintQty, b.unit) +
                ' / ' +
                showQty(b.rejectedQty, b.unit) +
                ' / ' +
                showQty(b.wasteQty, b.unit),
            ],
            ['Unused stock returned', showQty(b.unusedQty, b.unit)],
          ])}
          {artworkFacts(b)}
          {evidence.length
            ? facts([['Issue evidence for this site', h(evidence.map((ev) => ev.number).join(', '))]])
            : ''}
        </>,
      )}
      {panel(
        'Input lots and custody',
        table(
          [
            'Original roll, bundle or garment lot',
            'Issued',
            'Awaiting processing',
            'Run stock still in custody',
            'Total remaining',
          ],
          b.lines.map((line) => [
            lotLink(line.lotId),
            showQty(line.issued, b.unit),
            showQty(unprintedQty(b, line), b.unit),
            showQty(
              sum(
                b.runs.filter((r) => r.lotId === line.lotId),
                (r) => r.remaining,
              ),
              b.unit,
            ),
            showQty(lineRemaining(line), b.unit),
          ]),
        ),
      )}
      {batchHistory(app, b)}
      {b.remainingQty
        ? split(
            unprinted ? operationEditor(app, b) : '',
            unprinted ? receiptEditor(app, b) : '',
            ...b.runs
              .filter((run) => run.remaining > 0)
              .map((run) =>
                run.aftercare.length < b.artwork.aftercare.length
                  ? operationEditor(app, b, run)
                  : receiptEditor(app, b, run),
              ),
          )
        : ''}
    </>
  );
}
export function printingTracePanel(s, lot) {
  return joinContent(
    [lot.printBatchId, lot.embroideryBatchId].filter(Boolean).map((id) => {
      const b = ref(s.processBatches, id);
      const data = b && recordFor(b, lot);
      if (!data) return '';
      const run = ref(b.runs, data.runId);
      return panel(
        b.process + ' history',
        <>
          {facts([
            ['Production batch', decorationLink(b)],
            ['Original input lot', lotLink(data.sourceLotId)],
            ['Disposition', h(data.disposition)],
            ['Actual site', h([b.processor, b.site].filter(Boolean).join(' · '))],
            ['Outward / inward reference', valueOf([b.challan, data.reference].filter(Boolean).join(' · '))],
            ['Machine', valueOf(run?.machineName)],
            ...(isEmbroidery(b)
              ? [
                  ['Heads / stitches per piece', run ? h(run.heads + ' / ' + (run.stitches || '—')) : '—'],
                  ['Thread and backing lots', printChemicals(run?.supplies || [])],
                ]
              : [
                  ['Ink / paste batch', valueOf(run?.inkBatch)],
                  ['Chemical lots', printChemicals(run?.chemicals || [])],
                  [
                    'Recorded treatment',
                    valueOf(
                      run?.aftercare
                        .map((step) => step.operation + ' · ' + step.machineName + ' · ' + step.reference)
                        .join(' / '),
                    ),
                  ],
                ]),
          ])}
          {artworkFacts(b)}
        </>,
      );
    }),
    '',
  );
}
function decorationPage(app, params, process) {
  const s = app.data;
  const embroidery = process === EMBROIDERY;
  const list = s.processBatches.filter((b) => b.process === process).toReversed();
  const artwork = s.processSetups.filter((row) => row.process === process && row.status === 'Approved').toReversed();
  const batch = ref(list, params.get('batch')) || list.find((b) => b.remainingQty > 0) || list[0];
  return (
    <>
      {heading(
        process,
        embroidery
          ? 'Track approved designs, actual thread and backing, accepted panels and returns from the processor.'
          : 'Run approved prints on fabric rolls, cut panels, and sewn garments. Track accepted stock, misprints, and processor balances.',
        navLink('Outside job work', 'jobwork'),
      )}
      {batch ? detail(app, batch) : note('Approve an artwork revision and release a work order to start.')}
      {panel(
        'Batch register',
        table(
          ['Batch', 'Operation', 'Artwork', 'Factory / processor', 'Issued', 'Outstanding', 'Status'],
          list.map((b) => [
            decorationLink(b),
            h(stageLabel(b.stage) + (b.rework ? ' · Rework' : '')),
            h(artTitle(b.artwork)),
            h([b.processor, b.site].filter(Boolean).join(' · ')),
            showQty(b.issuedQty, b.unit),
            showQty(b.remainingQty, b.unit),
            txStatus(stateFor(s, b)),
          ]),
        ),
      )}
      {split(issueEditor(app, 'In-house', embroidery), issueEditor(app, 'Commission', embroidery))}
      {setupForms(app, artwork, embroidery)}
      {details(
        'Approved artwork',
        table(
          ['Artwork / revision', 'PO line', 'Operation', 'Design', 'Placement', 'Effective'],
          artwork.map((a) => [
            h(artTitle(a)),
            h(a.lineId),
            h(stageLabel(a.stage)),
            h(a.design),
            h(a.placement),
            h(a.effective),
          ]),
        ),
      )}
    </>
  );
}
const PrintingPage = ({ app, params }) => decorationPage(app, params, PRINTING);
export { PrintingPage };
const EmbroideryPage = ({ app, params }) => decorationPage(app, params, EMBROIDERY);
export { EmbroideryPage };
