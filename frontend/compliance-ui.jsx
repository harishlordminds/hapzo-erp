import { EditableContent, joinContent } from './react-ui.jsx';
import { UNITS, STAGES, DPP_FIELDS, ref, norm, genealogy, sum, freeStock, ROLES } from '../src/model.mjs';
import { schemesOf } from '../src/commerce.mjs';
import { APPLICABILITY, PASSPORT_PRODUCTS } from '../src/passports.mjs';
import { lineRemaining } from '../src/process-batch.mjs';
import { EVIDENCE_KINDS, EVIDENCE_ROLES, evidenceProgrammes } from '../src/standards.mjs';
import {
  CLAIM_POINTS,
  CLAIM_PROGRAMMES,
  CLAIM_REVIEW_METHODS,
  CLAIM_SCOPES,
  productClaimNames,
} from '../src/claim-scope.mjs';
import { inspectionChecks, resultStatus, shipmentListTable } from './pages.jsx';
import { PO_NUMBER_READERS, poNumberReader } from '../src/po-import.mjs';
import { finishingTracePanel } from './fabric-finishing-ui.jsx';
import { printingTracePanel } from './printing-ui.jsx';
import { garmentTracePanel } from './garment-production-ui.jsx';
import {
  h,
  fmt,
  valueOf,
  showQty,
  badge,
  txStatus,
  heading,
  panel,
  split,
  cards,
  facts,
  table,
  details,
  empty,
  note,
  actions,
  button,
  linkButton,
  navLink,
  lotLink,
  washLink,
  docs,
  field,
  text,
  check,
  day,
  numberField,
  select,
  choose,
  file,
  hidden,
  form,
  editor,
  can,
  titles,
  lineLabel,
  passportUrl,
} from './ui.jsx';
const optional = (label, name, value = '') =>
  field(label, name, {
    required: false,
    value,
  });
const num = (label, name) =>
  numberField(label, name, {
    required: false,
  });
const lotList = (s, label, filter = () => true) => choose(label, 'lotId', s.lots.filter(filter), titles.lot);
const scopeInput = (label = 'Coverage type', required = false) =>
  select(label, 'scopeType', CLAIM_SCOPES, {
    required,
    blank: 'General material and operations scope',
  });
const annexes = (e) => joinContent((e.annexes ?? (e.annex ? [e.annex] : [])).map(docs), <br />);
const sourceLink = (label, url) =>
  url ? (
    <a className="button secondary" target="_blank" rel="noopener" href={h(url)}>
      {h(label)}
    </a>
  ) : (
    ''
  );
export function evidenceSourceLinks(scheme, scope) {
  const profile = Object.hasOwn(CLAIM_PROGRAMMES, scheme) ? CLAIM_PROGRAMMES[scheme] : null;
  if (!profile) return '';
  const source =
    scheme === 'bluesign / bluepass' && scope === 'Chemical'
      ? 'https://www.bluesignfinder.com/'
      : scheme === 'bluesign / bluepass' && scope === 'Component'
        ? 'https://www.bluesignguide.com/'
        : profile.source;
  return actions(
    sourceLink('Open official lookup', source),
    sourceLink('Authorised issuer directory', profile.issuers),
  );
}
function requirements(app) {
  const s = app.data;
  return editor(
    app,
    'claim-rule',
    'Require evidence for a buyer PO or site',
    <>
      {select('Programme name', 'scheme', evidenceProgrammes(s))}
      {scopeInput('Required coverage type', true)}
      {choose('Buyer PO', 'orderId', s.orders, titles.order, {
        required: false,
      })}
      {choose('Buyer PO line', 'lineId', s.lines, (row) => lineLabel(s, row), {
        required: false,
      })}
      {optional('Apply at this exact site', 'site')}
      {select('Lock point', 'operation', CLAIM_POINTS)}
      {optional('Exact SKU, component or chemical code', 'subject')}
      {optional('Required certificate holder', 'holder')}
      {optional('Criteria, product group or MRSL version', 'criteria')}
      {field('Accepted evidence types, comma separated', 'kinds', {
        placeholder: 'Facility certificate, Audit report',
      })}
      {field('Rule revision', 'version')}
      {day('Effective from', 'effective')}
      {field('Buyer or programme rule source', 'source')}
      {check('Require independent confirmation', 'independent')}
    </>,
    'Save conditional rule',
    'Select a buyer PO, PO line or exact site. Enter the evidence types the buyer accepts for this requirement.',
  );
}
function claimReleases(app) {
  const s = app.data;
  return editor(
    app,
    'claim-release',
    'Release a product or label claim',
    <>
      {select('Product claim', 'scheme', productClaimNames)}
      {select('Claim scope', 'scopeType', ['Product', 'Component', 'Chemical'], {
        initial: 'Product',
      })}
      {lotList(s, 'Quality-released lot', (lot) => lot.qualityStatus === 'Released' && !lot.standardHold)}
      {choose(
        'Approved buyer PO line',
        'lineId',
        s.lines.filter((row) => row.status === 'Approved'),
        (row) => lineLabel(s, row),
        {
          required: false,
        },
      )}
      {optional('Exact SKU, component or chemical code', 'subject')}
      {optional('Textile product group and criteria reference', 'criteria')}
      {day('Claim release date')}
    </>,
    'Check and release claim',
    'Select the exact lot and SKU. The programme checks use verified evidence valid on the release date.',
  );
}
function Standards({ app }) {
  const s = app.data;
  const schemes = evidenceProgrammes(s);
  const enabled = can(app, 'evidence');
  const dates = (
    <>
      {day('Issue date', 'issue', false)}
      {day('Valid from', 'from', false)}
      {day('Expiry', 'until', false)}
    </>
  );
  const formBody = (
    <>
      {select('Scheme / programme', 'scheme', schemes)}
      {optional('Scheme version', 'programmeVersion')}
      {select('Evidence type', 'kind', EVIDENCE_KINDS)}
      {scopeInput()}
      {select('Party role', 'role', EVIDENCE_ROLES)}
      {choose(
        'Party master',
        'partyId',
        s.parties.filter((p) => p.type !== 'Buyer'),
        titles.party,
        {
          required: false,
        },
      )}
      {optional('Certificate holder if not in master', 'party')}
      {optional('Exact covered facility', 'site')}
      {field('Certificate / registration or declaration number', 'number')}
      {optional('Issuing certification body', 'issuer')}
      {dates}
      {field('Covered operations, comma separated', 'operations', {
        required: false,
        placeholder: 'Supply, Yarn dyeing, Weaving',
      })}
      {field('Covered material types or *', 'materials', {
        required: false,
        placeholder: 'Yarn, Dyed yarn',
      })}
      {optional('Product group, criteria or MRSL reference', 'criteria')}
      {text('Exact covered identifiers, one per line', 'scopeRefs', 'SKU, component or chemical item codes')}
      <details className="wide">
        <summary>Covered sites, annexes and transaction certificate</summary>
        <div className="fields">
          {choose(
            'Main certificate for a subcontractor annex',
            'coveringCertificateId',
            s.evidence.filter((row) => row.kind === 'Scope certificate'),
            (row) => row.number + ' · ' + row.party,
            {
              required: false,
            },
          )}
          {text(
            'Facilities covered by the parent scope or supply-chain confirmation',
            'requiredSites',
            'Certificate holder or processor | exact site | operation',
          )}
          {optional('Transaction seller', 'txSeller')}
          {optional('Transaction buyer', 'txBuyer')}
          {optional('Transaction shipment reference', 'txShipment')}
          {optional('Exact transaction material code', 'txMaterial')}
          {num('Eligible transaction quantity', 'capacity')}
          {select('Transaction certificate unit', 'unit', UNITS, {
            required: false,
          })}
          {check('Separate annexes are referenced and required', 'annexRequired')}
        </div>
      </details>
      {file('Certificate PDF or scan', 'evidence')}
      {file('Supporting annexes', 'evidence', 'annex', true)}
      <div className="wide">
        {button('Read certificate and annexes', {
          'data-analyse': 'all',
        })}
        <EditableContent as="div" data-analysis="" />
      </div>
      {hidden('analysisWarnings', '')}
      {text('Covered products, processes and addresses from the document', 'scopeText')}
      {text('Scope, custody model and notes', 'notes')}
    </>
  );
  return (
    <>
      {heading(
        'Standards and evidence',
        'Verify the issuer, validity, exact site, material and operation before releasing a claim.',
      )}
      {split(
        enabled
          ? details(
              'Add supplier or processor evidence',
              form(
                'evidence',
                formBody,
                'Save for verification',
                'Extraction proposes values for review. Record the official lookup or issuer confirmation in the verification step. Registration and details-only entries can be saved without a certificate.',
              ),
              !s.evidence.length,
            )
          : '',
        editor(
          app,
          'review-evidence',
          'Record verification decision',
          <>
            {choose('Evidence record', 'evidenceId', s.evidence, (e) => e.number + ' · ' + e.party, {
              hook: 'evidence-source',
            })}
            <EditableContent as="div" data-evidence-source="" className="wide" />
            {select('Decision', 'status', ['Verified', 'Withdrawn', 'Scope mismatch', 'Pending verification'])}
            {select('Verification method', 'method', CLAIM_REVIEW_METHODS, {
              required: false,
            })}
            {day('Verification date', 'verifiedOn')}
            {field('Verification source or confirmation reference', 'source')}
            {text('Resolution of any extraction flags', 'reviewNotes')}
            {file('Additional supporting annexes', 'evidence', 'annex', true)}
            {check('Issuer authorisation, holder, site, scope and dates confirmed', 'scopeConfirmed')}
            <details className="wide">
              <summary>Complete previously registered transaction evidence</summary>
              <div className="fields">
                {optional('Transaction seller', 'txSeller')}
                {optional('Transaction buyer', 'txBuyer')}
                {optional('Transaction shipment reference', 'txShipment')}
                {optional('Exact transaction material code', 'txMaterial')}
              </div>
            </details>
          </>,
          'Save decision',
        ),
        requirements(app),
        claimReleases(app),
        editor(
          app,
          'release-standard',
          'Recheck a lot on Standard Hold',
          <>
            {lotList(s, 'Held lot', (l) => l.standardHold)}
            {optional('Reported processor chemical codes, comma separated', 'chemicalItems')}
            {check('Processor confirmed no chemicals were used', 'noChemicals')}
          </>,
          'Recheck gate',
        ),
        editor(
          app,
          'policy',
          'Configure versioned lock rule',
          <>
            {field('Scheme name', 'scheme', {
              placeholder: 'GOTS',
            })}
            {select('Party role', 'role', EVIDENCE_ROLES)}
            {select(
              'Lock point',
              'operation',
              CLAIM_POINTS.filter((key) => key !== 'Label release'),
            )}
            {field('Approved revision', 'version')}
            {day('Effective from', 'effective')}
            {field('Mandatory evidence types, comma separated', 'kinds', {
              placeholder: 'Scope certificate, Transaction certificate',
            })}
            {field('Rule source or clause', 'reference')}
            {check('Scheme permits the named subcontractor under the main certificate', 'allowCoveringScope')}
          </>,
          'Register rule',
          'Every listed evidence type is required at this lock point. Use approved criteria for your programme, sites and claims.',
        ),
        editor(
          app,
          'claim-credit',
          'Add CMiA Mass Balance volume',
          <>
            {choose(
              'Verified tracker evidence',
              'evidenceId',
              s.evidence.filter((e) => e.scheme === 'CMiA Mass Balance' && e.status === 'Verified'),
              (e) => e.number,
            )}
            {field('Unique eligible purchase / tracker transaction', 'reference')}
            {numberField('Eligible kg', 'qty')}
            {day()}
          </>,
          'Post eligible volume',
        ),
      )}
      {panel(
        'Evidence register',
        table(
          ['Reference', 'Programme / role', 'Party and site', 'Scope', 'Issue → expiry', 'Decision', 'Document'],
          s.evidence
            .slice()
            .reverse()
            .map((e) => [
              <>
                {h(e.number)}
                <br />
                <small>{h(e.id)}</small>
              </>,
              <>
                {h([e.scheme, e.programmeVersion, e.role].filter(Boolean).join(' · '))}
                <br />
                <small>{h(e.kind)}</small>
              </>,
              h([e.party, e.site].filter(Boolean).join(' · ')),
              <>
                {h([e.scopeType, ...(e.scopeRefs ?? []), e.criteria].filter(Boolean).join(' · '))}
                <br />
                <small>{h([...e.operations, ...e.materials].join(', '))}</small>
                {e.scopeText ? details('Found in document', h(e.scopeText)) : ''}
                {e.analysisWarnings
                  ? details('Extraction flags', <p className="evidence-excerpt">{h(e.analysisWarnings)}</p>)
                  : ''}
              </>,
              h((e.issue || e.from || '—') + ' → ' + (e.until || '—')),
              <>
                {txStatus(e.status)}
                {e.source ? (
                  <>
                    <br />
                    <small>
                      {h(
                        [
                          e.source,
                          e.reviewHistory?.at(-1)?.method,
                          e.reviewHistory?.at(-1)?.on,
                          e.reviewHistory?.at(-1)?.actor,
                        ]
                          .filter(Boolean)
                          .join(' · '),
                      )}
                    </small>
                  </>
                ) : (
                  ''
                )}
                {e.capacity != null ? (
                  <>
                    <br />
                    <small>
                      {'Used '}
                      {showQty(e.used, e.unit)}
                      {' / '}
                      {showQty(e.capacity, e.unit)}
                    </small>
                  </>
                ) : (
                  ''
                )}
              </>,
              <>
                {docs(e.document)}
                {annexes(e) ? (
                  <>
                    <br />
                    {annexes(e)}
                  </>
                ) : (
                  ''
                )}
              </>,
            ]),
        ),
      )}
      {panel(
        'Buyer and facility requirements',
        table(
          ['Programme', 'Buyer or site', 'Lock point', 'Coverage', 'Accepted evidence', 'Rule'],
          s.claimRules.map((r) => [
            h(r.scheme),
            h([ref(s.orders, r.orderId)?.po, r.lineId, r.site].filter(Boolean).join(' · ')),
            h(r.operation),
            h([r.scope, r.subject, r.holder, r.criteria].filter(Boolean).join(' · ')),
            h(r.kinds.join(' / ')),
            h([r.version, r.effective, r.source].join(' · ')),
          ]),
        ),
      )}
      {panel(
        'Product claim release register',
        table(
          ['Claim and article', 'Lot', 'Reference', 'Release date', 'Evidence'],
          s.claimReleases
            .slice()
            .reverse()
            .map((r) => [
              h([r.scheme, r.scope, r.subject].join(' · ')),
              lotLink(r.lotId),
              h(r.number),
              h(r.on),
              <>
                {h(r.evidence.map((e) => e.number).join(', '))}
                {r.evidence.some((e) => ref(s.evidence, e.id)?.status !== 'Verified') ? (
                  <>
                    <br />
                    {badge('Evidence withdrawn or changed', 'warn')}
                  </>
                ) : (
                  ''
                )}
              </>,
            ]),
        ),
      )}
      {split(
        panel(
          'Configured rules',
          table(
            ['Scope', 'Revision', 'Effective', 'Required evidence', 'Source'],
            s.policies.map((r) => [
              h([r.scheme, r.role, r.operation].join(' / ')),
              h(r.version),
              h(r.effective),
              h(r.kinds.join(', ')),
              h(r.reference),
            ]),
          ),
        ),
        panel(
          'Mass balance register',
          table(
            ['Tracker transaction', 'Date', 'Credit', 'Used', 'Remaining'],
            s.credits.map((c) => [
              h(c.reference),
              h(c.date),
              showQty(c.qty, 'kg'),
              showQty(c.used, 'kg'),
              showQty(c.qty - c.used, 'kg'),
            ]),
          ),
        ),
      )}
    </>
  );
}
export { Standards };
function traceDetails(app, l) {
  const s = app.data;
  const back = genealogy(s, l.id);
  const ahead = genealogy(s, l.id, true);
  const affected = new Set([l.id, ...ahead.map((a) => a.id)]);
  const touched = (e) =>
    e.output === l.id ||
    e.input === l.id ||
    e.lotIds?.includes(l.id) ||
    e.outputs?.includes(l.id) ||
    e.inputs?.some((i) => i.id === l.id);
  const washIds = new Set(s.events.filter((e) => e.process === 'Washing' && touched(e)).map((e) => e.batchId));
  const washBatches = s.processBatches.filter((b) => washIds.has(b.id));
  const shipments = s.shipments.filter((sh) => sh.lotIds.some((id) => affected.has(id)));
  const passport = s.passports.find((p) => p.lotId === l.id && p.status === 'Published');
  const draft = s.passports.findLast((p) => p.lotId === l.id && p.status === 'Draft');
  const upstream = new Set(back.map((a) => a.id));
  const sources = back.filter((a) =>
    ['Weaving', 'Knitting', 'Yarn dyeing', 'Fabric dyeing', 'Fabric finishing'].includes(a.stage),
  );
  const custody = s.processBatches.flatMap((b) =>
    (b.lines ?? [])
      .filter((row) => row.lotId === l.id && lineRemaining(row) > 0)
      .map((row) => ({
        b,
        row,
      })),
  );
  const chain = (rows) => (
    <div className="trace-list">
      {table(
        ['Lot', 'Material / stage', 'Produced or source site', 'On hand'],
        rows.map((x) => [
          lotLink(x.id),
          h(x.material + ' · ' + x.stage),
          h(ref(s.events, x.eventId)?.site || x.origin || x.site),
          showQty(x.qty, x.unit),
        ]),
      )}
    </div>
  );
  return (
    <>
      {panel(
        l.id + ' · ' + l.material,
        <>
          {actions(
            resultStatus(l),
            badge(schemesOf(l).join(', ') || 'Conventional', 'neutral'),
            button('Print lot QR', {
              'data-label-lot': h(l.id),
            }),
            passport ? (
              <a className="button secondary" href={h(passportUrl(app, passport))} target="_blank" rel="noopener">
                Open published passport
              </a>
            ) : (
              ''
            ),
            draft?.points ? linkButton('Open passport draft', 'passport', draft.id) : '',
          )}
          {l.holdReason ? note(l.holdReason, true) : ''}
          {facts([
            ['Stock / not reserved', showQty(l.qty, l.unit) + ' / ' + showQty(freeStock(l), l.unit)],
            ['Facility / location', h(l.location)],
            ['Owner', h(ref(s.parties, l.ownerId)?.name || s.settings.name)],
            ['Origin / supplier', h([l.originCountry, l.origin, l.party, l.supplierLot].filter(Boolean).join(' · '))],
            [
              'Measured at lot creation',
              h(
                [l.netKg ? fmt(l.netKg) + ' kg' : '', l.lengthM ? fmt(l.lengthM) + ' m' : '']
                  .filter(Boolean)
                  .join(' · ') || '—',
              ),
            ],
            ['Composition', valueOf(l.composition)],
            ['Allocation', h(l.allocations.map((a) => a.lineId + ' · ' + fmt(a.qty)).join(', ') || '—')],
            ...washBatches.map((b) => [
              'Wash batch',
              washLink(b.id, [b.number, b.challan].filter(Boolean).join(' · ')),
            ]),
            ['Reservations', h(l.reservations.map((a) => a.lineId + ' · ' + fmt(a.qty)).join(', ') || '—')],
            ...custody.map(({ b, row }) => [
              b.jobId ? 'Held at processor' : 'In process',
              showQty(lineRemaining(row), row.unit || b.unit) +
                ' · ' +
                h([b.processor || b.floorLine, b.site, b.number].filter(Boolean).join(' · ')),
            ]),
          ])}
          {can(app, 'release-standard') && l.standardHold
            ? form('release-standard', hidden('lotId', l.id), 'Recheck evidence')
            : ''}
        </>,
      )}
      {garmentTracePanel(s, l)}
      {printingTracePanel(s, l)}
      {l.packing
        ? joinContent(
            back
              .filter((a) => a.finishing)
              .map((a) => details('Finishing history for ' + a.id, finishingTracePanel(s, a))),
            '',
          )
        : finishingTracePanel(s, l)}
      {split(panel('Trace backward', chain(back)), panel('Trace forward', chain(ahead)))}
      {sources.length
        ? details(
            'Upstream fabric and dye runs',
            table(
              ['Output lot', 'Operation / facility', 'Actual inputs and roles', 'Run reference'],
              sources.map((a) => {
                const event = ref(s.events, a.eventId);
                const weft = new Set(a.weave?.segments?.flatMap((segment) => segment.weft.map((row) => row.lotId)));
                return [
                  lotLink(a.id),
                  h(a.stage + ' · ' + (event?.site || a.site)),
                  joinContent(
                    a.parents
                      .filter((r) => upstream.has(r.id))
                      .map((r) => {
                        const role = r.id === a.weave?.warpBeam ? 'Warp beam' : weft.has(r.id) ? 'Weft yarn' : r.role;
                        return (
                          <>
                            {lotLink(r.id)}
                            {' · '}
                            {showQty(r.qty, r.unit)}
                            {role ? ' · ' + h(role) : ''}
                          </>
                        );
                      }),
                    <br />,
                  ),
                  valueOf(event?.reference),
                ];
              }),
            ),
            true,
          )
        : ''}
      {panel(
        'Affected shipments',
        table(
          ['Shipment', 'Carton or lot', 'Buyer', 'Destination', 'Quantity', 'Date'],
          shipments.flatMap((sh) =>
            sh.contents
              .filter((c) => affected.has(c.lotId))
              .map((c) => [
                linkButton(sh.number, 'shipment', sh.id),
                lotLink(c.lotId),
                h(sh.customer),
                h(sh.destination),
                showQty(c.qty, c.unit),
                h(sh.date),
              ]),
          ),
        ),
      )}
      {panel(
        'Direct material issues and postings',
        table(
          ['Date', 'Action', 'Inputs or movement', 'Output', 'Run / reference', 'Disposition / evidence'],
          s.events
            .filter(touched)
            .slice()
            .reverse()
            .map((e) => [
              h(e.date),
              h(e.stage || e.kind),
              joinContent(
                (e.inputs ?? []).map((a) => (
                  <>
                    {lotLink(a.id)}
                    {' · '}
                    {showQty(a.qty, a.unit)}
                    {a.role ? ' · ' + h(a.role) : ''}
                  </>
                )),
                <br />,
              ) || h([e.from, e.to].filter(Boolean).join(' → ') || '—'),
              joinContent((e.outputs ?? [e.output]).map(lotLink), <br />),
              h([e.reference, e.recipe, e.site].filter(Boolean).join(' · ')),
              <>
                {h(
                  [
                    e.decision,
                    ...(e.checks ?? []).map((c) => c.scheme + ' / ' + c.evidence.map((x) => x.number).join(', ')),
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—',
                )}
                {e.fabric || e.techPack ? (
                  <>
                    <br />
                    {inspectionChecks(e)}
                  </>
                ) : (
                  ''
                )}
              </>,
            ]),
        ),
      )}
    </>
  );
}
function Trace({ app, params }) {
  const s = app.data;
  const query = params?.get('lot') || app.local.trace || '';
  const found = query ? s.lots.find((lot) => norm(lot.id) === norm(query)) : null;
  return (
    <>
      {heading(
        'Scan and trace',
        'Scan a physical label or look up a lot to follow its recorded material and shipment links.',
      )}
      {panel(
        'Find a lot or passport',
        <>
          {form(
            'lookup',
            field('Lot ID or QR payload', 'query', {
              value: query,
              placeholder: 'CTN-26018-01',
            }),
            'Find record',
          )}
          <hr />
          <div className="actions">
            {button('Scan with camera', {
              'data-camera': 'yes',
            })}
            <label className="button secondary">
              {'Read QR image '}
              <input type="file" id="scanImage" accept="image/*" hidden />
            </label>
          </div>
        </>,
      )}
      {found ? traceDetails(app, found) : query ? note('No lot matches this ID in the selected company.', true) : ''}
    </>
  );
}
export { Trace };
function passportPointEditor(p) {
  const first =
    p.points.find((point) => point.number !== 10 && !point.verified && point.applicability === 'Applicable') ||
    p.points[0];
  return form(
    'passport-point',
    <>
      {hidden('passportId', p.id)}
      {select(
        'Mapping point',
        'point',
        p.points.filter((q) => q.number !== 10).map((q) => [q.number, q.number + ' · ' + q.name]),
        {
          initial: first.number,
          hook: 'passport-point',
        },
      )}
      {select('Applicability', 'applicability', APPLICABILITY, {
        initial: first.applicability,
      })}
      {select('Audience', 'visibility', ['Internal', 'Public'], {
        initial: first.visibility,
      })}
      {optional('Evidence / transaction reference', 'source', first.source)}
      {text('Field value', 'value', '', false, first.value)}
      {text('Reason for non-applicability', 'reason', '', false, first.reason)}
      {first.verified ? (
        <label className="check">
          <input type="checkbox" name="verified" defaultValue="yes" defaultChecked />
          {' Evidence verified'}
        </label>
      ) : (
        check('Evidence verified', 'verified')
      )}
      {file('Evidence attachment', 'passport')}
    </>,
    'Save mapping point',
  );
}
const profileName = (r) => r.product + ' · ' + r.market + ' · ' + r.code + ' r' + r.version;
const profileList = (s) =>
  s.processSetups.filter((p) => p.process === 'DPP profile' && p.status === 'Approved').toReversed();
function passportSources(p) {
  const sources = p.sources;
  if (!sources) return '';
  return (
    <>
      {details(
        'Lot allocations and source evidence',
        <>
          {facts([['Genealogy version', h(sources.method)]])}
          {table(
            ['Lot', 'Site and stage', 'Actual parent inputs', 'PO allocation', 'Approved evidence'],
            sources.lots.map((l) => [
              lotLink(l.lotId),
              h([l.site, l.stage].filter(Boolean).join(' · ')),
              joinContent(
                l.parents.map((r) => (
                  <>
                    {lotLink(r.id)}
                    {' · '}
                    {showQty(r.qty, r.unit)}
                    {r.role ? ' · ' + h(r.role) : ''}
                  </>
                )),
                <br />,
              ),
              joinContent(
                l.allocations.map((r) => h(r.lineId) + ' · ' + showQty(r.qty, l.unit)),
                <br />,
              ),
              valueOf(l.checks?.flatMap((c) => (c.evidence || []).map((e) => e.number)).join(' · ')),
            ]),
          )}
        </>,
      )}
      {sources.processors.length
        ? details(
            'Processor and challan evidence',
            table(
              ['Processor / actual site', 'Operation', 'Challan', 'Approved evidence'],
              sources.processors.map((j) => [
                h(j.processor + ' · ' + j.site),
                h(j.operation),
                h(j.challan),
                valueOf(j.checks?.flatMap((c) => (c.evidence || []).map((e) => e.number)).join(' · ')),
              ]),
            ),
          )
        : ''}
      {details(
        'Production and Quality source records',
        table(
          ['Event', 'Operation', 'Reference', 'Date', 'Decision / evidence'],
          sources.events.map((e) => [
            h(e.id),
            h([e.kind, e.operation].filter(Boolean).join(' · ')),
            valueOf(e.reference),
            h(e.date),
            <>
              {valueOf(e.decision)}
              {e.document ? (
                <>
                  <br />
                  {docs(e.document)}
                </>
              ) : (
                ''
              )}
            </>,
          ]),
        ),
      )}
    </>
  );
}
export function passportDetails(app, p) {
  const viewOnly = !p.points;
  const statuses =
    p.status === 'Draft'
      ? ['Submit']
      : p.status === 'Under review'
        ? ['Publish', 'Return to draft']
        : p.status === 'Published'
          ? ['Suspend']
          : [];
  const url = passportUrl(app, p);
  return (
    <>
      {heading(p.lotId + ' · Passport v' + p.version, p.profile || 'Digital Product Passport')}
      {actions(
        txStatus(p.status),
        p.status === 'Published' ? (
          <a className="button secondary" href={h(url)} target="_blank" rel="noopener">
            Open public page
          </a>
        ) : (
          ''
        ),
        p.status === 'Published'
          ? button('Print passport QR', {
              'data-label-pass': h(p.id),
            })
          : '',
      )}
      {viewOnly ? (
        ''
      ) : (
        <>
          {panel(
            'Calculation boundary and profile',
            <>
              {facts([
                ['Boundary', h(p.boundary)],
                ['Evidence', valueOf(p.factorRef)],
                ['Reportable mass', showQty(p.weight, 'kg')],
                ['Attributed energy', showQty(p.electricity, 'kWh')],
                ['Calculation version', valueOf(p.calculationVersion)],
                ['Profile approval', valueOf(p.profileSnapshot?.reference)],
                ['Electricity factor', p.factor != null ? showQty(p.factor, 'kg CO₂e/kWh') : '—'],
                ['Electricity subtotal', p.co2 != null ? showQty(p.co2, 'kg CO₂e/kg') : '—'],
                ['Physical water', p.water != null ? showQty(p.water, 'L/kg') : '—'],
                ['Total recycled share', p.recycled != null ? h(fmt(p.recycled) + '%') : '—'],
                ['Snapshot SHA-256', valueOf(p.digest)],
              ])}
              {details(
                'Attribution from posted runs',
                table(
                  ['Lot', 'Run', 'Stage and site', 'Output share', 'Electricity', 'Water', 'Steam', 'Method'],
                  p.activity.map((r) => [
                    lotLink(r.lotId),
                    h(r.eventId),
                    h(r.stage + ' · ' + r.site),
                    h(fmt(r.share * 100) + '%'),
                    r.measured?.electricity === false ? '—' : showQty(r.electricity, 'kWh'),
                    r.measured?.water === false ? '—' : showQty(r.water, 'L'),
                    r.measured?.steam === false || r.steam == null ? '—' : showQty(r.steam, 'kg'),
                    valueOf([r.methodVersion, r.readingId].filter(Boolean).join(' · ')),
                  ]),
                ),
              )}
            </>,
          )}
          {passportSources(p)}
          {p.status === 'Draft'
            ? editor(
                app,
                'passport-profile',
                'Apply approved product and market profile',
                <>
                  {hidden('passportId', p.id)}
                  {choose('Approved profile revision', 'profileId', profileList(app.data), profileName, {
                    initial: p.profileSnapshot?.id,
                  })}
                  {day('Application date')}
                </>,
                'Apply profile',
              )
            : ''}
          {p.status === 'Draft' && can(app, 'passport-point') ? (
            <>
              {panel('Edit field', passportPointEditor(p))}
              {details(
                'Assess remaining fields as outside the profile',
                form(
                  'passport-assess',
                  <>
                    {hidden('passportId', p.id)}
                    {text('Reason for all remaining unassessed points', 'reason', '', true)}
                  </>,
                  'Save profile applicability',
                ),
              )}
            </>
          ) : (
            ''
          )}
          {statuses.length && can(app, 'passport-status')
            ? panel(
                'Review and publication',
                form(
                  'passport-status',
                  <>
                    {hidden('passportId', p.id)}
                    {select('Status action', 'mode', statuses, {
                      initial: statuses[0],
                    })}
                    {text('Feedback or suspension reason', 'notes')}
                  </>,
                  'Apply status',
                ),
              )
            : ''}
          {panel(
            '49 project mapping points',
            table(
              ['#', 'Field', 'Applicability', 'Value and source', 'Audience / verification'],
              p.points.map((q) => [
                h(q.number),
                h(q.name),
                <>
                  {h(q.applicability)}
                  {q.reason ? (
                    <>
                      <br />
                      <small>{h(q.reason)}</small>
                    </>
                  ) : (
                    ''
                  )}
                </>,
                <>
                  {h(q.value || '—')}
                  {q.source ? (
                    <>
                      <br />
                      <small>{h(q.source)}</small>
                    </>
                  ) : (
                    ''
                  )}
                  {q.document ? (
                    <>
                      <br />
                      {docs(q.document)}
                    </>
                  ) : (
                    ''
                  )}
                </>,
                <>
                  {badge(q.visibility, 'neutral')}
                  {q.verified ? <> {badge('Verified')}</> : ''}
                </>,
              ]),
            ),
          )}
        </>
      )}
    </>
  );
}
function Passports({ app, params }) {
  const s = app.data;
  const selected = ref(s.passports, params?.get('draft') || app.local.passport);
  const profiles = profileList(s);
  return (
    <>
      {heading(
        'Digital Product Passports',
        'Review source evidence for each mapping point and publish a version to a stable QR address.',
      )}
      {panel(
        'Passport register',
        table(
          ['Passport', 'Source lot', 'Version', 'Date', 'State', 'Public link'],
          s.passports
            .slice()
            .reverse()
            .map((p) => [
              linkButton(p.id, 'passport', p.id),
              lotLink(p.lotId),
              h(p.version),
              h(p.date || '—'),
              txStatus(p.status),
              p.status === 'Published' ? (
                <a target="_blank" rel="noopener" href={h(passportUrl(app, p))}>
                  Open
                </a>
              ) : (
                '—'
              ),
            ]),
        ),
      )}
      {selected ? <section id="passport-section">{passportDetails(app, selected)}</section> : ''}
      {editor(
        app,
        'dpp-profile',
        'Approve product and market profile',
        <>
          {field('Profile code', 'code')}
          {field('Revision', 'version')}
          {select('Product family', 'product', ['Fabric', 'Garment', 'Yarn'])}
          {field('Target market', 'market')}
          {day('Effective date', 'effective')}
          {field('Approved buyer, market or standard reference', 'reference')}
          {optional('Additional required points', 'requiredPoints')}
          {text(
            'Excluded point number and applicability rationale, one row per point',
            'excludedPoints',
            '8,Excluded by approved market profile',
          )}
          {file('Profile source document', 'passport')}
        </>,
        'Approve profile',
      )}
      {profiles.length
        ? details(
            'Approved product and market profiles',
            table(
              ['Profile revision', 'Effective', 'Additional required points', 'Evidence'],
              profiles.map((r) => [
                h(profileName(r)),
                h(r.effective),
                valueOf(r.requiredPoints.join(', ')),
                h(r.reference),
              ]),
            ),
          )
        : ''}
      {editor(
        app,
        'passport',
        'Create passport version',
        <>
          {lotList(
            s,
            'Quality released product',
            (l) => PASSPORT_PRODUCTS.includes(l.material) && l.qualityStatus === 'Released',
          )}
          {choose('Approved product and market profile', 'profileId', profiles, profileName, {
            required: false,
            blank: 'Save a draft for later profile selection',
          })}
          {optional('Draft name when profile is pending', 'profile')}
          {optional('Fibre composition override', 'composition')}
          {field('Composition source', 'compositionSource')}
          {num('Reportable kg, defaults to lot measurement', 'weight')}
          {num('Verified pre-consumer recycled kg', 'preKg')}
          {num('Verified post-consumer recycled kg', 'postKg')}
          {num('Electricity factor kg CO₂e / kWh', 'factor')}
          {num('Qualifying water return L', 'waterReturn')}
          {text('Calculation boundary and allocation assumptions', 'boundary', '', true)}
          {text('Measurement, factor and recycled content references', 'factorRef')}
          {day('Draft date')}
        </>,
        'Create draft',
        'Results use the quantities and activity from posted runs. Supply approved factors and evidence for the stated scope.',
        !s.passports.length,
      )}
    </>
  );
}
export { Passports };
function Settings({ app }) {
  const s = app.data;
  const admin = app.user.role === 'Admin';
  const numberReader = details(
    'Buyer PO number recognition',
    <>
      {form(
        'po-number-reader',
        select('PO number reader', 'reader', Object.entries(PO_NUMBER_READERS), {
          initial: poNumberReader(s.settings),
        }),
        'Save PO reader',
        'Hosted SoMark OXR receives the selected PO file. Local SoMark OXR uses the OXR service on this PC and falls back to HAPZO’s local text and OCR reader.',
      )}
      <p className="sub">
        <a href="https://github.com/SoMarkAI/OXR" target="_blank" rel="noopener">
          Powered by SoMark OXR
        </a>
      </p>
    </>,
    true,
  );
  return (
    <>
      {heading('Workspace settings', 'Manage access and local data for ' + s.settings.name + '.')}
      {admin ? (
        <>
          {numberReader}
          {split(
            editor(
              app,
              'settings',
              'Company profile',
              <>
                {field('Company legal name', 'name', {
                  value: s.settings.name,
                })}
                {optional('GST registration', 'gstin', s.settings.gstin)}
                {optional('GLN / EORI', 'identifier', s.settings.identifier)}
                {optional('Published business contact', 'contact', s.settings.contact)}
                {text('Legal address', 'address', '', false, s.settings.address)}
              </>,
              'Save company profile',
            ),
            panel(
              'Workspaces',
              <>
                {form(
                  'new-company',
                  <>
                    {field('Company name', 'name')}
                    {check('Use sample manufacturing and accounting records', 'demo')}
                  </>,
                  'Create company',
                )}
                <hr />
                {button('Open a separate sample company', {
                  'data-demo': 'yes',
                })}
                <small>{' Browse example lots and two shipments.'}</small>
              </>,
            ),
            details(
              'Add or change workspace member',
              form(
                'member',
                <>
                  {field('Local login', 'login')}
                  {optional('Display name for a new user', 'name')}
                  {field('Initial password for a new user', 'password', {
                    required: false,
                    type: 'password',
                    autocomplete: 'new-password',
                  })}
                  {select('Role', 'role', [...ROLES, 'Remove access'])}
                  {choose(
                    'Buyer account scope',
                    'buyerId',
                    s.parties.filter((p) => p.type === 'Buyer'),
                    titles.party,
                    {
                      required: false,
                    },
                  )}
                </>,
                'Save access',
                'Use a company role for staff. A Buyer member can only see that buyer’s own orders and published links.',
              ),
            ),
            panel(
              'Backups and export',
              <>
                <p className="sub">Use Backup HAPZO.cmd for a restorable SQLite copy including documents and users.</p>
                <br />
                <a className="button secondary" href="/api/export">
                  Export company records
                </a>
              </>,
            ),
          )}
          {panel(
            'Workspace members',
            table(
              ['Login', 'Name', 'Role', 'Linked buyer'],
              (app.local.members || []).map((m) => [
                h(m.login),
                h(m.name),
                badge(m.role),
                h(ref(s.parties, m.buyerId)?.name || '—'),
              ]),
            ),
          )}
          {details(
            'Audit log',
            table(
              ['Time', 'User', 'Transaction', 'Result', 'Record', 'Details'],
              (s.audit || []).map((a) => [
                h(new Date(a.at).toLocaleString('en-IN')),
                h(a.actor),
                h(a.action),
                txStatus(a.state),
                valueOf(a.target),
                valueOf(a.details),
              ]),
            ),
          )}
        </>
      ) : (
        ''
      )}
      {details(
        'Change my password',
        form(
          'password',
          <>
            {field('Current password', 'current', {
              type: 'password',
              autocomplete: 'current-password',
            })}
            {field('New password', 'password', {
              type: 'password',
              autocomplete: 'new-password',
            })}
          </>,
          'Change password',
        ),
      )}
    </>
  );
}
export { Settings };
function Buyer({ app }) {
  const s = app.data;
  const received = (id) => sum(s.shipments.flatMap((sh) => sh.allocations).filter((a) => a.lineId === id));
  return (
    <>
      {heading('Buyer portal', s.settings.name)}
      {cards([
        ['Buyer POs', s.orders.length],
        ['Approved order lines', s.lines.length],
        ['Shipments', s.shipments.length],
        ['Issued invoices', s.invoices.length],
      ])}
      {panel(
        'My approved PO lines',
        table(
          ['Buyer PO / line', 'Style / variant', 'Order qty', 'Shipped', 'PO document'],
          s.lines.map((l) => {
            const o = ref(s.orders, l.orderId);
            return [
              linkButton(o.po + ' / ' + l.lineNo, 'line', l.id),
              h(l.style + ' · ' + l.color + ' · ' + l.size),
              showQty(l.qty, l.unit),
              showQty(received(l.id), l.unit),
              docs(o.document),
            ];
          }),
        ),
      )}
      {panel('My shipments', shipmentListTable(s, false))}
      {panel(
        'My invoices',
        table(
          ['Invoice', 'Issue date', 'Amount'],
          s.invoices.map((i) => [linkButton(i.number, 'invoice', i.id), h(i.date), h(i.amount + ' ' + i.currency)]),
        ),
      )}
      {panel(
        'Published passports',
        table(
          ['Carton or lot', 'Version', 'Link'],
          s.passports.map((p) => [
            h(p.lotId),
            h(p.version),
            <a href={h(passportUrl(app, p))} target="_blank" rel="noopener">
              Open passport
            </a>,
          ]),
        ),
      )}
    </>
  );
}
export { Buyer };
