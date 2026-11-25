import { EditableContent, RowList, RowTemplate, appendRow, joinContent, setContents } from './react-ui.jsx';
import { ref, norm, CURRENCIES, FULFILMENT, ROUTES } from '../src/model.js';
import {
  AREA_BASES,
  FABRIC_ROLES,
  FABRIC_WIDTHS,
  MARKER_BASES,
  TRIM_BASES,
  garmentPlan,
  garmentSpecification,
  garmentTargetsForLot,
} from '../src/garment.js';
import { FABRIC_TYPES, FABRIC_CONDITIONS, YARN_COUNT_UNITS } from '../src/fabric.js';
import {
  matchPoBuyer,
  PO_AI_PROVIDERS,
  PO_IMPORT_ACTION,
  PO_NUMBER_READERS,
  poNumberReader,
} from '../src/po-import.js';
import {
  componentConstructionFields,
  componentConstructionInput,
  fabricSpecCard,
  refreshFabricEditor,
} from './fabric-ui.jsx';
import {
  actions,
  badge,
  button,
  can,
  cards,
  check,
  choose,
  details,
  docs,
  empty,
  facts,
  field,
  file,
  form,
  geminiModelField,
  geminiRetryMessage,
  h,
  heading,
  hidden,
  lineLabel,
  linkButton,
  lotLink,
  navLink,
  note,
  numberField,
  option,
  panel,
  select,
  showQty,
  table,
  text,
  titles,
  valueOf,
} from './ui.jsx';
const optional = (label, name, value = '') =>
  field(label, name, {
    value,
    required: false,
  });
const number = (label, name, value = '', min = 0, step = 'any') =>
  numberField(label, name, {
    value: value ?? '',
    min,
    step,
    required: false,
  });
const value = (number, unit) => (number == null ? '—' : showQty(Number(number.toFixed(6)), unit));
const list = (label, name, options, selected) =>
  select(label, name, options, {
    initial: selected || options[0],
  });
const limits = (min, max, unit) =>
  min == null && max == null
    ? '—'
    : min == null
      ? '≤ ' + value(max, unit)
      : max == null
        ? '≥ ' + value(min, unit)
        : value(min) + '–' + value(max, unit);
const joinValid = (values, sep = ' · ') => values.filter(Boolean).join(sep);
export function garmentHash(companyId, lineId = '', revision = '') {
  const args = new URLSearchParams();
  if (companyId && lineId) {
    args.set('company', companyId);
    args.set('line', lineId);
  }
  if (revision !== '') args.set('revision', revision);
  return 'tech-pack' + (args.size ? '?' + args : '');
}
export const garmentLink = (app, lineId, revision = '', label = 'Garment tech pack') => (
  <a className="button secondary" href={'#' + h(garmentHash(app.user.companyId, lineId, revision))}>
    {h(label)}
  </a>
);
export const poImportLink = (app) =>
  can(app, PO_IMPORT_ACTION) ? (
    <a className="button secondary" href="#tech-pack?import=1">
      {app.user.poAi?.ready ? 'Import buyer PO with AI' : 'Import buyer PO from PDF'}
    </a>
  ) : (
    ''
  );
export const autoReadBuyerPo = (app) =>
  can(app, PO_IMPORT_ACTION) && app.user.poAi?.ready && app.user.poAi.provider === 'gemini';
export function buyerPoFile(app, label, { mapBuyer = false, ...fileOptions } = {}) {
  const reader = poNumberReader(app.data.settings);
  return (
    <>
      {hidden('poNumberReader', reader)}
      <p className="sub muted wide">
        {app.user.frontendPreview
          ? 'Select a text PDF to review the buyer, dates, prices and size quantities.'
          : reader === 'hosted-oxr'
          ? 'PDF and image uploads are sent to SoMark’s hosted OXR service to read the buyer PO number.'
          : h(PO_NUMBER_READERS[reader] + ' reads the buyer PO number on this computer.')}
      </p>
      {mapBuyer && app.user.poAi?.geminiReady ? (
        <>
          <p className="sub muted wide">
            {autoReadBuyerPo(app)
              ? 'Selecting a PO sends the original and extracted layout to Gemini and opens an editable draft of the order and size variants.'
              : 'Selecting a PO sends the original file to Gemini to identify the buyer.'}
          </p>
          {geminiModelField(app.user.poAi.models)}
        </>
      ) : (
        ''
      )}
      {file(label, 'buyer-po', 'document', false, fileOptions)}
      <p className="sub wide" data-po-number-status="" role="status" hidden />
    </>
  );
}
export function buyerPoIdentityFields(app, order = {}) {
  const buyers = app.data.parties.filter((row) => row.type === 'Buyer');
  const mapping = matchPoBuyer(buyers, { name: order.buyer, code: order.buyerCode, taxId: order.buyerTaxId });
  const matched = mapping.status === 'matched' ? mapping.candidates[0].id : '';
  return (
    <>
      {choose('Saved buyer (optional)', 'buyerId', buyers, titles.party, {
        initial: matched, required: false, hidden: buyers.length === 0, blank: 'Use the buyer name on this PO',
      })}
      {optional('Buyer name on PO (optional)', 'newBuyerName', order.buyer)}
      {mapping.status === 'ambiguous' ? note('Several saved buyers match. Choose one to link it, or keep the name on this PO.', true) : ''}
      <p className="sub wide" data-po-buyer-status="" role="status" hidden />
      {can(app, 'po-buyer-create') ? newPoBuyerFields(order, app.data.settings.currency, matched) : ''}
    </>
  );
}
function newPoBuyerFields(order, defaultCurrency, matched) {
  return (
    <details className="wide tech-subsection" data-new-po-buyer="" hidden={Boolean(matched)}>
      <summary>Add the PO buyer to Company masters</summary>
      <div className="fields">
        {select('Buyer default currency', 'newBuyerCurrency', CURRENCIES, {
          required: false,
          initial: order.currency || defaultCurrency,
        })}
        {optional('Buyer country', 'newBuyerCountry')}
        {optional('Buyer GST registration', 'newBuyerTax', order.buyerTaxId)}
      </div>
      {actions(
        button('Save and select buyer', {
          'data-create-po-buyer': 'yes',
        }),
      )}
    </details>
  );
}
export function poNumberMessage(result) {
  if (!result) return '';
  if (result.status === 'suggested')
    return 'The AI draft suggests PO ' + result.value + '. Check it against the original document before saving.';
  if (result.status === 'matched')
    return joinValid(
      ['Read PO ' + result.value + ' on page ' + result.page + ' with ' + result.method + '.', result.notice],
      ' ',
    );
  if (result.status === 'ambiguous' || result.status === 'review') {
    const intro = result.status === 'ambiguous' ? 'Found more than one PO number.' : 'The scan needs review.';
    const candidates = result.candidates.map((row) => row.value + ' (page ' + row.page + ')').join(', ');
    return joinValid([intro, 'Check the buyer document for ' + candidates + '.', result.notice], ' ');
  }
  if (result.status === 'unsupported') return 'The workbook’s PO number is read during AI import.';
  if (result.status === 'unreadable') return result.notice;
  return joinValid(['No buyer PO number was found. Enter the number printed on the original order.', result.notice], ' ');
}
function retainedWidths(f) {
  const raw = (label, key, sample = {}) => (
    <>
      {number(label + ' %', key, sample.value, -1000)}
      {number(label + ' before wash (cm)', key + 'Before', sample.before)}
      {number(label + ' after wash (cm)', key + 'After', sample.after)}
    </>
  );
  return (
    <>
      {raw('Length shrinkage', 'lengthShrink', f.lengthChange)}
      {raw('Width shrinkage', 'widthShrink', f.widthChange)}
    </>
  );
}
function fabricFields(s, f) {
  const fabricItems = s.items.filter((item) =>
    ['Greige fabric', 'Dyed fabric', 'Finished fabric', 'Inspected fabric', 'Other'].includes(item.type),
  );
  return (
    <>
      {field('Component code', 'code', {
        value: f.code,
      })}
      {list('Fabric use', 'role', FABRIC_ROLES, f.role)}
      {optional('Fabric description', 'description', f.description)}
      {choose('Stock item', 'itemId', fabricItems, titles.item, {
        required: false,
        initial: f.item?.itemId,
      })}
      {optional('Mill and approved article reference', 'millRef', f.millRef)}
      {optional('Buyer shade / colour reference', 'colourRef', f.colourRef)}
      {optional('Lab dip or strike-off reference', 'labDip', f.labDip)}
      {list('Width basis', 'widthMode', FABRIC_WIDTHS, f.widthMode)}
      {number('Full roll width (cm)', 'grossWidth', f.grossWidth)}
      {number('Usable cutting width (cm)', 'usableWidth', f.usableWidth)}
      {optional('Full width tolerance', 'grossTolerance', f.grossTolerance?.tolerance)}
      {optional('Usable width tolerance', 'usableTolerance', f.usableTolerance?.tolerance)}
      <p className="sub muted wide">
        For tubular fabric, enter the width of one face as laid flat. The calculation uses both faces.
      </p>
      <details className="wide tech-subsection" open={f.construction || f.constructionDraft?.fabricType || f.gsm}>
        <summary>Construction, yarn count and GSM</summary>
        {componentConstructionFields(f)}
      </details>
      {optional('Structure for other textiles', 'structure', f.construction ? '' : f.structure)}
      {text(
        'Fibre composition, fibre and percent per line',
        'blend',
        'Cotton,98\nElastane,2',
        false,
        f.blendDraft ?? f.blend?.map((row) => [row.fibre, row.percent].join(',')).join('\n'),
      )}
      <details className="wide tech-subsection">
        <summary>Yarn, machine and finishing details</summary>
        <div className="fields">
          {text(
            'Warp or ground yarn',
            'warpGround',
            'Fibre, ply, spinning type, twist, supplier code',
            false,
            f.warpGround,
          )}
          {text(
            'Weft, plating or secondary yarn',
            'weftPlating',
            'Fibre, ply, spinning type, twist, supplier code',
            false,
            f.weftPlating,
          )}
          {number('Wale × course cells in measured knit repeat', 'yarnRepeatCells', f.yarnSystems?.cells, 0, 1)}
          {text(
            'Knitted yarn systems, name, count, unit and mm in the same repeat',
            'yarnSystems',
            'Ground,30,Ne,10.8\nPlating,40,denier,9.5',
            false,
            f.yarnSystemsDraft ??
              f.yarnSystems?.yarns.map((row) => [row.name, row.count, row.unit, row.length].join(',')).join('\n'),
          )}
          {text(
            'Loom or knitting machine setup',
            'machine',
            'Reed / denting or feeders, cylinder and settings',
            false,
            f.machine,
          )}
          {text('Grainline, face, nap and motif repeat', 'grainRepeat', '', false, f.grainRepeat)}
          {text('Dye, print and shade-banding requirements', 'dyePrint', '', false, f.dyePrint)}
          {text(
            'Finishing and handfeel',
            'finish',
            'For example brushing, compaction, coating or sanforising',
            false,
            f.finish,
          )}
          {text('Roll, inspection and handling instructions', 'notes', '', false, f.notes)}
        </div>
      </details>
      <details className="wide tech-subsection" open>
        <summary>Pattern, marker and consumption</summary>
        <div className="fields">
          {list('Pattern area basis', 'areaBasis', AREA_BASES, f.areaBasis)}
          {list('Marker calculation', 'markerBasis', MARKER_BASES, f.markerBasis)}
          {text(
            'Pattern pieces, piece count and area per piece in cm²',
            'pattern',
            'Front,2,2400\nBack,1,3800',
            false,
            f.patternDraft ?? f.pattern?.map((row) => [row.name, row.repeats, row.area].join(',')).join('\n'),
          )}
          <p className="sub muted wide">
            Use pattern areas that include seam allowances. Only finished-pattern areas use the entered shrinkage to
            calculate cut area.
          </p>
          {number('Marker efficiency % for area-based estimate', 'markerEfficiency', f.markerEfficiency)}
          {number('CAD marker length (m)', 'markerLength', f.markerLength)}
          {number('Garments of this PO size in the CAD marker', 'markerPieces', f.markerPieces, 0, 1)}
          {number('Extra spreading and cutting loss % of input', 'extraLoss', f.extraLoss)}
          <p className="sub muted wide">
            Use a marker for the selected size at the recorded width. For tubular fabric, count the garments from both
            faces.
          </p>
          {text(
            'Wash method and cycles for dimensional change',
            'washMethod',
            'For example the buyer-approved wash method and conditioning',
            false,
            f.washMethod,
          )}
          {retainedWidths(f)}
          <p className="sub muted wide">
            Enter the shrinkage percentage or the before and after measurements for each direction. Positive means
            shrinkage.
          </p>
          {checked('Use calculated quantity for this stock item in PO planning', 'preparePurchase', f.preparePurchase)}
        </div>
      </details>
    </>
  );
}
function checked(label, name, on) {
  return check(label, name, on);
}
function measurementFields(_s, p) {
  return (
    <>
      {field('POM code', 'code', {
        value: p.code,
      })}
      {field('Point of measure', 'name', {
        value: p.name,
      })}
      {number('Approved target for this PO size', 'target', p.specified)}
      {number('Base size measurement', 'base', p.base)}
      {number('Grade per size step', 'grade', p.grade, -10000)}
      {optional('Tolerance', 'tolerance', p.tolerance)}
      {text('Measurement location and method', 'method', '', true, p.method)}
    </>
  );
}
function sewingFields(_s, row) {
  return (
    <>
      {field('Operation', 'operation', {
        value: row.operation,
      })}
      {optional('Seam class and construction', 'seam', row.seam)}
      {optional('Stitch type', 'stitch', row.stitch)}
      {optional('Thread and needle specification', 'thread', row.thread)}
      {number('Seam allowance (mm)', 'allowance', row.allowance)}
      {number('Stitches counted', 'stitches', row.stitches, 0, 1)}
      {number('Span counted (cm)', 'span', row.span)}
      {number('Total seam length per garment (cm)', 'length', row.length)}
      {number('Approved thread-to-seam length ratio', 'ratio', row.ratio)}
      {text('Assembly instructions and placements', 'notes', '', false, row.notes)}
    </>
  );
}
function trimFields(s, row) {
  return (
    <>
      {choose('Trim, thread, label or packaging item', 'itemId', s.items, titles.item, {
        initial: row.item?.itemId,
      })}
      {row.itemCode ? (
        <>
          <div className="sub">
            {'Buyer trim reference '}
            {h(row.itemCode)}
          </div>
          {hidden('itemCode', row.itemCode)}
        </>
      ) : (
        ''
      )}
      {list('Usage basis', 'basis', TRIM_BASES, row.basis)}
      {number('Quantity in item stock unit', 'per', row.per)}
      {number('Loss % of input', 'loss', row.loss)}
      {text('Size, finish, colour, placement and supplier reference', 'description', '', false, row.description)}
      {checked('Use calculated quantity for this item in PO planning', 'preparePurchase', row.preparePurchase)}
    </>
  );
}
function labFields(_s, row) {
  return (
    <>
      {field('Test code', 'code', {
        value: row.code,
      })}
      {optional('GARMENT or fabric component code', 'scope', row.scope || 'GARMENT')}
      {field('Buyer test or performance property', 'name', {
        value: row.name,
        placeholder: 'For example dry rubbing or length shrinkage',
      })}
      {field('Approved method and version', 'method', {
        value: row.method,
      })}
      {field('Result unit', 'unit', {
        value: row.unit,
        placeholder: '%, N, kPa or grade',
      })}
      {number('Minimum', 'min', row.min, -1000000)}
      {number('Maximum', 'max', row.max, -1000000)}
      {text('Test direction, conditioning and wash cycles', 'condition', '', false, row.condition)}
    </>
  );
}
const fieldGroups = {
  fabrics: ['Fabric components', 'fabric component', fabricFields],
  poms: ['Measurement chart', 'measurement point', measurementFields],
  operations: ['Seams and sewing', 'sewing operation', sewingFields],
  trims: ['Trims, labels and packing BOM', 'trim or packing item', trimFields],
  tests: ['Buyer lab test matrix', 'lab test', labFields],
};
function rowFields(s, kind, row = {}, open = false) {
  const [, label, renderer] = fieldGroups[kind];
  const summary =
    kind === 'fabrics'
      ? joinValid([row.code, row.role, row.description])
      : row.name || row.operation || row.item?.itemCode;
  return (
    <details className="tech-row" data-tech-row={kind} open={open}>
      <summary>{h(summary || label)}</summary>
      <div className="fields">{renderer(s, row)}</div>
      <div className="actions">
        {button('Remove ' + label, {
          'data-tech-remove': 'yes',
        })}
      </div>
    </details>
  );
}
function reviewNotes(items) {
  return items?.length ? (
    <ul className="note warn wide ai-review-notes">
      {joinContent(
        items.map((item) => <li>{h(item)}</li>),
        '',
      )}
    </ul>
  ) : (
    ''
  );
}
function draftForEditor(s, pack) {
  const matchOption = (options, value) => options.find((label) => norm(label) === norm(value)) || '';
  const shrinkage = (row, key) => ({
    value: row[key],
    before: row[key + 'Before'],
    after: row[key + 'After'],
  });
  return {
    ...pack,
    fabrics: pack.fabrics.map((f) => ({
      ...f,
      role: matchOption(FABRIC_ROLES, f.role) || 'Other',
      widthMode: matchOption(FABRIC_WIDTHS, f.widthMode),
      areaBasis: matchOption(AREA_BASES, f.areaBasis),
      markerBasis:
        matchOption(MARKER_BASES, f.markerBasis) || (f.markerLength && f.markerPieces ? MARKER_BASES[1] : ''),
      gsm: f.construction.gsm,
      grossTolerance: {
        tolerance: f.grossTolerance,
      },
      usableTolerance: {
        tolerance: f.usableTolerance,
      },
      constructionDraft: {
        ...f.construction,
        fabricType: matchOption(FABRIC_TYPES, f.construction.fabricType),
        fabricStructure: f.construction.fabricStructure || f.structure,
        fabricCondition: matchOption(FABRIC_CONDITIONS, f.construction.fabricCondition),
        countUnit: matchOption(YARN_COUNT_UNITS, f.construction.countUnit),
      },
      blendDraft: f.blend,
      patternDraft: f.pattern,
      yarnSystemsDraft: f.yarnSystems,
      yarnSystems: {
        cells: f.yarnRepeatCells,
      },
      item: f.itemId
        ? {
            itemId: f.itemId,
          }
        : null,
      lengthChange: shrinkage(f, 'lengthShrink'),
      widthChange: shrinkage(f, 'widthShrink'),
      preparePurchase: f.preparePurchase === 'yes',
    })),
    poms: pack.poms.map((pom) => ({
      ...pom,
      specified: pom.target,
    })),
    trims: pack.trims.map((trim) => ({
      ...trim,
      basis: matchOption(TRIM_BASES, trim.basis),
      preparePurchase: trim.preparePurchase === 'yes',
      item: {
        itemId: trim.itemId ?? s.items.find((item) => norm(item.code) === norm(trim.itemCode) && trim.itemCode)?.id,
      },
    })),
  };
}
function packEditor(app, line, imported = null) {
  const s = app.data;
  const pack = imported
    ? draftForEditor(s, imported.pack)
    : (line.garmentSpec ?? {
        fabrics: [
          {
            code: 'SHELL',
            role: 'Shell',
            structure: '',
            construction: line.fabricSpec,
            gsm: line.gsm,
          },
        ],
      });
  const main = (
    <div className="fields wide" data-tech-main="">
      {optional('Garment category', 'category', pack.category)}
      {optional('Fit or block reference', 'fit', pack.fit)}
      {optional('Pattern and CAD revision', 'patternRef', pack.patternRef)}
      {optional('Approved fit / PP sample reference', 'sampleRef', pack.sampleRef)}
      {list('Garment measurement unit', 'measurementUnit', ['cm', 'in'], pack.measurementUnit)}
      {optional('Base size for grading', 'baseSize', pack.baseSize)}
      {number('Size steps from base', 'sizeSteps', pack.sizeSteps, -100, 1)}
      {number('Expected garment reject % of units cut', 'garmentLoss', pack.garmentLoss)}
      {number('Garments per carton', 'cartonCapacity', pack.cartonCapacity, 0, 1)}
      {text(
        'Measurement condition',
        'measurementStage',
        'For example after conditioning or after the specified wash',
        false,
        pack.measurementStage,
      )}
      {text('Assembly and handling instructions', 'assembly', '', false, pack.assembly)}
      {text('Artwork, branding and label placement', 'artwork', '', false, pack.artwork)}
      {text('Care labelling and finishing', 'care', '', false, pack.care)}
      {text('Packing, folding and carton markings', 'packaging', '', false, pack.packaging)}
    </div>
  );
  const groups = joinContent(
    Object.entries(fieldGroups).map(([kind, [title, label]]) => (
      <details className="wide tech-section" open={kind === 'fabrics' || (imported && pack[kind]?.length)}>
        <summary>{h(title)}</summary>
        <RowList data-tech-list={kind}>
          {joinContent(
            (pack[kind] ?? []).map((row) => rowFields(s, kind, row, kind === 'fabrics')),
            '',
          )}
        </RowList>
        <RowTemplate data-tech-template={kind}>{rowFields(s, kind, {}, true)}</RowTemplate>
        <div className="actions">
          {button('Add ' + label, {
            'data-tech-add': kind,
          })}
        </div>
      </details>
    )),
    '',
  );
  const draftInfo = imported ? (
    <>
      {hidden('draftToken', imported.token)}
      <div className="wide">
        {note('Review the buyer values and complete any missing fields before saving the specification.')}
        <p className="sub">
          {joinContent(imported.documents.map(docs), ' · ')}
          {imported.lineSource || imported.source ? ' · ' + h(joinValid([imported.lineSource, imported.source])) : ''}
        </p>
      </div>
      {reviewNotes(imported.review)}
    </>
  ) : (
    ''
  );
  return details(
    imported ? 'Edit imported AI draft' : 'Edit garment tech pack',
    form(
      'garment-spec',
      <>
        {hidden('lineId', line.id)}
        {draftInfo}
        {field('Specification revision', 'specRev', {
          value: imported?.specRev ?? line.specRev,
        })}
        {line.status === 'Approved'
          ? field('Reason and buyer approval reference', 'techApprovalNote', {
              wide: true,
            })
          : ''}
        {main}
        {groups}
        {file('Buyer tech pack, sketch or approved sample document', 'tech-pack')}
        <div className="wide">
          {(imported?.attachment ?? pack.document) ? (
            <p className="sub">
              {'Current attachment '}
              {docs(imported?.attachment ?? pack.document)}
            </p>
          ) : (
            ''
          )}
          {actions(
            button('Preview calculations', {
              'data-tech-preview': 'yes',
            }),
            imported ? (
              <button className="button secondary" type="submit" formNoValidate data-tech-save-draft="">
                Keep as editable draft
              </button>
            ) : (
              ''
            ),
          )}
          <EditableContent as="div" className="tech-preview" data-tech-preview-output="" />
        </div>
      </>,
      line.status === 'Approved' ? 'Release specification revision' : 'Save draft tech pack',
    ),
    Boolean(imported) || !line.garmentSpec,
  );
}
function fieldValues(root, ownedBy) {
  return Object.fromEntries(
    [...root.querySelectorAll('input[name]:not(:disabled), select[name]:not(:disabled), textarea[name]:not(:disabled)')]
      .filter((el) => !ownedBy || !el.closest('[data-fabric-editor]'))
      .map((el) => [el.name, el.type === 'checkbox' ? (el.checked ? 'yes' : '') : el.value]),
  );
}
export function techPackInput(form) {
  return {
    ...fieldValues(form.querySelector('[data-tech-main]')),
    ...Object.fromEntries(
      Object.keys(fieldGroups).map((kind) => [
        kind,
        [...form.querySelectorAll('[data-tech-row="' + kind + '"]')].map((row) => {
          const fields = fieldValues(row, kind === 'fabrics');
          if (kind === 'fabrics')
            fields.construction = componentConstructionInput(row.querySelector('[data-fabric-editor]'));
          return fields;
        }),
      ]),
    ),
  };
}
export function addTechPackRow(form, kind, app) {
  const list = form.querySelector('[data-tech-list="' + kind + '"]');
  const template = form.querySelector('[data-tech-template="' + kind + '"]');
  if (list.children.length >= (kind === 'fabrics' ? 24 : 150)) return;
  appendRow(list, template);
  const row = list.lastElementChild;
  const editor = row.querySelector('[data-fabric-editor]');
  if (editor) refreshFabricEditor(editor, app);
  row.querySelector('input, select')?.focus();
}
function fabricSheet(row) {
  const r = row.result;
  const shrink = (label, change) => [
    label,
    change.percent == null
      ? '—'
      : value(change.percent, '%') +
        (change.before != null ? ' · ' + value(change.before) + ' → ' + value(change.after, 'cm') : ''),
  ];
  const specs = [
    ['Stock item', h(joinValid([row.item?.itemCode, row.item?.itemName]))],
    ['Width basis', h(row.widthMode)],
    ['Full width', value(row.grossWidth, 'cm')],
    ['Usable width', value(row.usableWidth, 'cm')],
    ['Full width limits', limits(row.grossTolerance.limits?.min, row.grossTolerance.limits?.max, 'cm')],
    ['Usable width limits', limits(row.usableTolerance.limits?.min, row.usableTolerance.limits?.max, 'cm')],
    ['Fibre composition', h(row.blend.map((fibre) => fibre.percent + '% ' + fibre.fibre).join(', '))],
    ['Mill / article', h(row.millRef)],
    ['Shade reference', h(row.colourRef)],
    ['Lab dip', h(row.labDip)],
    ['Warp / ground yarn', h(row.warpGround)],
    ['Weft / plating yarn', h(row.weftPlating)],
    ['Machine setup', h(row.machine)],
    ['Grain, face and repeat', h(row.grainRepeat)],
    ['Dyeing and printing', h(row.dyePrint)],
    ['Finishing', h(row.finish)],
    ['Handling', h(row.notes)],
  ].filter(([, v]) => v && v !== '—');
  return (
    <>
      {facts(specs)}
      {row.construction
        ? fabricSpecCard(row.construction)
        : facts([
            ['Structure', h(row.structure)],
            ['Target GSM', value(row.gsm, 'g/m²')],
          ])}
      {row.yarnSystems?.yarns.length
        ? table(
            ['Knit yarn system', 'Count', 'Yarn in repeat', 'Estimated contribution'],
            row.yarnSystems.yarns.map((yarn) => [
              h(yarn.name),
              value(yarn.count, yarn.unit),
              value(yarn.length, 'mm'),
              value(yarn.gsm, 'g/m²'),
            ]),
          )
        : ''}
      <h3>Fabric consumption</h3>
      {facts([
        ['Calculation basis', h(row.markerBasis)],
        ['Pattern area basis', h(row.areaBasis)],
        shrink('Length shrinkage', row.lengthChange),
        shrink('Width shrinkage', row.widthChange),
        ['Wash method', valueOf(row.washMethod)],
        ['Pattern area per garment', value(r.patternArea, 'm²')],
        ['Cut area per garment', value(r.cutArea, 'm²')],
        ['Marker efficiency', value(r.markerEfficiency, '%')],
        ['Extra spreading / cutting loss', value(row.extraLoss, '%')],
        ['Full-roll linear weight', value(r.gramsPerMetre, 'g/m')],
        ['Roll length per garment cut', value(r.metresPerGarmentCut, 'm')],
        ['Total roll length', value(r.metres, 'm')],
        ['Total fabric weight', value(r.kg, 'kg')],
      ])}
      {row.pattern.length
        ? table(
            ['Pattern piece', 'Count per garment', 'Area each (cm²)'],
            row.pattern.map((piece) => [h(piece.name), h(piece.repeats), value(piece.area)]),
          )
        : ''}
    </>
  );
}
export function garmentPackSheet(line, includeBuyerSource = false) {
  const pack = line.garmentSpec;
  if (!pack) return '';
  const plan = garmentPlan(pack, line.qty);
  const attributes = [
    ['Category', pack.category],
    ['Fit / block', pack.fit],
    ['Pattern revision', pack.patternRef],
    ['Approved sample', pack.sampleRef],
    ['Assembly', pack.assembly],
    ['Artwork and labels', pack.artwork],
    ['Care and finishing', pack.care],
    ['Packing', pack.packaging],
  ]
    .filter(([, v]) => v)
    .map(([key, v]) => [key, <span className="tech-text">{h(v)}</span>]);
  if (pack.document) attributes.push(['Supporting tech pack', docs(pack.document)]);
  if (includeBuyerSource && pack.importSource) {
    const { documents, source, lineSource } = pack.importSource;
    attributes.push(['Imported buyer documents', joinContent(documents.map(docs), ' · ')]);
    if (source || lineSource) attributes.push(['Source references', h(joinValid([lineSource, source]))]);
  }
  return (
    <>
      {cards([
        ['Ordered garments', line.qty],
        ['Planned cut quantity', plan.cutQty],
        ['Planned cartons', plan.cartons ?? '—'],
        ['Fabric components', plan.fabrics.length],
      ])}
      {attributes.length ? panel('Garment instructions', facts(attributes)) : ''}
      {joinContent(
        plan.fabrics.map((row) =>
          details('Fabric ' + joinValid([row.code, row.role, row.description]), fabricSheet(row), true),
        ),
        '',
      )}
      {pack.poms.length
        ? panel(
            'Measurement chart · ' + line.size,
            <>
              {facts([
                ['Condition', valueOf(pack.measurementStage)],
                ['Base size / steps', h(joinValid([pack.baseSize, String(pack.sizeSteps)]))],
              ])}
              {table(
                ['POM', 'Method', 'Base', 'Grade per step', 'Target', 'Allowed range'],
                pack.poms.map((pom) => [
                  h(pom.code + ' · ' + pom.name),
                  h(pom.method),
                  value(pom.base, pack.measurementUnit),
                  value(pom.grade, pack.measurementUnit),
                  value(pom.target, pack.measurementUnit),
                  limits(pom.limits?.min, pom.limits?.max, pack.measurementUnit),
                ]),
              )}
            </>,
          )
        : ''}
      {pack.operations.length
        ? panel(
            'Seams and sewing',
            table(
              ['Operation', 'Seam / stitch', 'Allowance', 'SPI', 'Thread per garment', 'Thread and instructions'],
              pack.operations.map((op) => [
                h(op.operation),
                h(joinValid([op.seam, op.stitch])),
                value(op.allowance, 'mm'),
                value(op.spi),
                value(op.threadM, 'm'),
                h(joinValid([op.thread, op.notes])),
              ]),
            ),
          )
        : ''}
      {plan.trims.length
        ? panel(
            'Trims, labels and packing BOM',
            table(
              ['Item', 'Placement and specification', 'Basis', 'Usage', 'Loss', 'PO requirement'],
              plan.trims.map((row) => [
                h(row.item.itemCode + ' · ' + row.item.itemName),
                valueOf(row.description),
                h(row.basis),
                value(row.per, row.item.unit),
                value(row.loss, '%'),
                value(row.total, row.item.unit),
              ]),
            ),
          )
        : ''}
      {plan.bom.length
        ? panel(
            'Calculated items included in PO planning',
            table(
              ['Item', 'Requirement', 'Stock unit'],
              plan.bom.map((row) => [h(row.code + ' · ' + row.label), value(row.qty), h(row.unit)]),
            ),
          )
        : ''}
      {pack.tests.length
        ? panel(
            'Buyer lab test matrix',
            table(
              ['Scope', 'Test', 'Method / condition', 'Limits'],
              pack.tests.map((row) => [
                h(row.scope),
                h(row.code + ' · ' + row.name),
                h(joinValid([row.method, row.condition])),
                limits(row.min, row.max, row.unit),
              ]),
            ),
          )
        : ''}
      {details(
        'Calculation formulas',
        <ul className="tech-formulas">
          <li>Planned cut quantity = ordered pieces ÷ retained garment fraction, rounded up.</li>
          <li>
            Cut area = finished pattern area ÷ (length retention × width retention) when the pattern area is after
            shrinkage. Shrinkage % = (before − after) ÷ before × 100.
          </li>
          <li>
            Cut roll length per garment = cut area ÷ (usable width × marker efficiency), or CAD marker length ÷ garments
            in the marker.
          </li>
          <li>
            Total roll length = length per garment × planned cut quantity ÷ retained spreading and cutting fraction.
            Weight in kg = length × full material width × GSM ÷ 1,000.
          </li>
          <li>
            Measured GSM = swatch mass in grams × 10,000 ÷ area in cm². Woven GSM estimate = [EPI × warp tex × warp
            crimp factor + PPI × weft tex × weft crimp factor] ÷ 25.4.
          </li>
          <li>
            Knitted yarn GSM = sum of the mass from each yarn system across one measured repeat × repeats per square
            metre.
          </li>
          <li>
            Graded measurement = base measurement + grade per step × size steps. Measurement limits use the entered
            lower and upper tolerances. SPI = stitches counted ÷ span in inches.
          </li>
          <li>
            Trim requirement = trim usage × cut garments, shipped garments or cartons ÷ retained trim fraction. Carton
            count is rounded up.
          </li>
        </ul>,
      )}
    </>
  );
}
export function previewGarmentPack(form, app) {
  const destination = form.querySelector('[data-tech-preview-output]');
  const line = ref(app.data.lines, form.elements.lineId.value);
  try {
    const pack = garmentSpecification(app.data, techPackInput(form));
    setContents(
      destination,
      <>
        <h3>Calculated preview</h3>
        {garmentPackSheet({
          ...line,
          garmentSpec: pack,
        })}
      </>,
    );
  } catch (error) {
    setContents(destination, note(error.message, true));
  }
}
function packTitle(s, line) {
  const order = ref(s.orders, line.orderId);
  return [order.po, 'line ' + line.lineNo, line.style, line.color, line.size].join(' · ');
}
export function printableGarmentPack(app, lineId, revision) {
  const line = ref(app.data.lines, lineId);
  const snapshot =
    revision && Number(revision) !== line?.revision
      ? line?.revisions.find((row) => row.revision === Number(revision))
      : line;
  if (!snapshot?.garmentSpec) return empty('No garment tech pack for this revision.');
  return (
    <>
      {heading('Garment tech pack · ' + snapshot.specRev, packTitle(app.data, snapshot))}
      {garmentPackSheet(snapshot, can(app, PO_IMPORT_ACTION))}
    </>
  );
}
function poReviewLine(row, index, specifications) {
  const title =
    joinValid([
      row.articleNo && 'Article ' + row.articleNo,
      row.lineNo && 'Line ' + row.lineNo,
      row.style,
      row.color,
      row.size && 'Size ' + row.size,
    ]) || 'Variant ' + (index + 1);
  const spec = specifications.find((value) => row.specKey && norm(value.key) === norm(row.specKey));
  const detail = joinValid([
    row.qty != null ? row.qty + ' pcs' : 'Check quantity',
    spec ? 'Technical details found' : 'Technical details to enter',
    row.source,
  ]);
  return (
    <details className="tech-row ai-variant" data-import-index={index} open={index === 0}>
      <summary>
        {h(title)}
        {detail ? <small>{h(detail)}</small> : ''}
      </summary>
      <div className="fields">
        <label className="check wide">
          <input
            type="checkbox"
            name="include"
            {...(row.qty === 0
              ? {}
              : {
                  defaultChecked: true,
                })}
          />
          {' Include this variant in the draft'}
        </label>
        {optional('Article number', 'articleNo', row.articleNo)}
        {optional('Article name', 'articleName', row.articleName)}
        {optional('Client order reference for this variant', 'clientOrderNo', row.clientOrderNo)}
        {optional('Buyer lot reference', 'lot', row.lot)}
        {optional('Buyer line number', 'lineNo', row.lineNo)}
        {optional('Style', 'style', row.style)}
        {optional('Colour', 'color', row.color)}
        {optional('Colour code', 'colorCode', row.colorCode)}
        {optional('Size', 'size', row.size)}
        {optional('SKU', 'sku', row.sku)}
        {number('Ordered pieces', 'qty', row.qty, 0, 1)}
        {number('Price per ordered piece', 'price', row.price)}
        {field('Delivery date', 'delivery', {
          type: 'date',
          required: false,
          value: row.delivery,
        })}
        {optional('Specification revision', 'specRev', row.specRev)}
        {text('Buyer line description', 'description', '', false, row.description)}
      </div>
    </details>
  );
}
const importedAnnexes = (result) => result.annexes ?? (result.annex ? [result.annex] : []);
function poImportReview(app, result) {
  const { order, lines, specifications, review, document, details: sourceDetails = [] } = result;
  const routeChoices = [
    ...Object.keys(ROUTES),
    ...app.data.routes.map((row) => [row.id, row.name + ' · ' + row.version]),
  ];
  const recognition = result.poNumber;
  const numberSource = recognition?.status === 'unsupported' ? '' : poNumberMessage(recognition);
  const sourceMethod = joinValid([result.layoutMethod, result.modelLabel || PO_AI_PROVIDERS[result.provider]]);
  const pieces = lines.reduce((sum, row) => sum + (row.qty ?? 0), 0);
  const fields = (
    <>
      <div className="wide">
        <p className="sub">
          {joinContent([document, ...importedAnnexes(result)].map(docs), ' · ')}
          {document?.id && /\.pdf$/i.test(document.label) && !importedAnnexes(result).length ? <>
            {' · '}<a href={'#tech-pack?import=1&pdf=' + encodeURIComponent(document.id)} target="_blank" rel="noopener">Re-read PDF in a new tab</a>
          </> : ''}
          {sourceMethod ? ' · ' + h(sourceMethod) : ''}
          {order.source ? ' · ' + h(order.source) : ''}
        </p>
        {numberSource ? note(numberSource, recognition.status !== 'matched') : ''}
        {result.retry ? note(geminiRetryMessage(result.retry)) : ''}
        {result.readNotice ? note(result.readNotice) : ''}
        {result.aiDiagnostic ? <details><summary>AI reader details</summary><p>{h(result.aiDiagnostic)}</p></details> : ''}
        {note(
          'Check the buyer, PO number, size variants and quantities. Exact matches receive an editable tech pack draft. New variants are saved as draft PO lines.',
        )}
      </div>
      {reviewNotes(review)}
      {field('Buyer PO number', 'po', {
        value: order.po,
      })}
      {buyerPoIdentityFields(app, order)}
      {optional('Client order number', 'clientOrderNo', order.clientOrderNo)}
      {optional('Client on document', 'client', order.client)}
      {optional('Division', 'division', order.division)}
      {field('Buyer PO date', 'poDate', {
        type: 'date',
        required: false,
        value: order.date,
      })}
      {field('Buyer ship-by date', 'shipDate', {
        type: 'date',
        required: false,
        value: order.shipDate,
      })}
      {number('Printed total pieces', 'totalPieces', order.totalPieces, 1, 1)}
      {select('Currency', 'currency', CURRENCIES, {
        required: false,
        initial: order.currency,
        blank: 'Buyer default',
      })}
      {optional('Payment terms', 'terms', order.terms)}
      {text('Ship-to address', 'shipTo', '', false, order.shipTo)}
      {sourceDetails.length ? (
        <details className="wide tech-subsection">
          <summary>Other details from the PO</summary>
          <div className="fields">
            {joinContent(
              sourceDetails.map((row, i) => (
                <div className="wide" data-po-detail-index={i}>
                  {text(row.label, 'poDetailValue', '', false, row.value)}
                  {row.source ? <small className="sub">{h(row.source)}</small> : ''}
                </div>
              )),
              '',
            )}
          </div>
        </details>
      ) : (
        ''
      )}
      {select('Production route (optional for drafts)', 'route', routeChoices, {
        required: false,
        blank: 'Choose at line approval',
      })}
      {select('Deliverable for new PO lines', 'product', FULFILMENT, {
        initial: 'Packed carton',
      })}
      <div className="wide">
        <h3>Order variants</h3>
        <p className="sub">{h(lines.length + ' variants · ' + pieces.toLocaleString('en-IN') + ' extracted pieces')}</p>
        {order.shipDate && lines.some((row) => !row.delivery)
          ? note('A blank variant date uses the buyer ship-by date above when saved.')
          : ''}
        {joinContent(
          lines.map((row, i) => poReviewLine(row, i, specifications)),
          '',
        )}
        {check('Replace any matching AI drafts already in review', 'replaceDraft')}
      </div>
    </>
  );
  return panel(
    'Review extracted buyer PO',
    <>
      {form(PO_IMPORT_ACTION, fields, 'Save PO and tech pack drafts')}
      {actions(
        button('Import a different PO', {
          'data-clear-po-import': 'yes',
        }),
      )}
    </>,
  );
}
export function poImportInput(form, input, result) {
  if (!result) throw new Error('Read the buyer PO to prepare a draft.');
  const lines = [...form.querySelectorAll('[data-import-index]')]
    .filter((row) => row.querySelector('[name="include"]').checked)
    .map((row) => {
      const original = result.lines[Number(row.dataset.importIndex)];
      return {
        ...fieldValues(row),
        specKey: original.specKey,
        source: original.source,
      };
    });
  if (!lines.length) throw new Error('Select at least one order variant to save.');
  const required = new Set(lines.map((row) => norm(row.specKey)));
  const details = [...form.querySelectorAll('[data-po-detail-index]')].map((row) => ({
    ...result.details[Number(row.dataset.poDetailIndex)],
    value: row.querySelector('textarea').value,
  }));
  const {
    po,
    buyerId,
    clientOrderNo,
    client,
    division,
    poDate,
    shipDate,
    totalPieces,
    currency,
    terms,
    shipTo,
    route,
    product,
    replaceDraft,
  } = input;
  return {
    po,
    buyerId,
    buyerName: input.newBuyerName,
    clientOrderNo,
    client,
    division,
    poDate,
    shipDate,
    totalPieces,
    currency,
    terms,
    shipTo,
    route,
    product,
    replaceDraft,
    document: result.document.id,
    annex: importedAnnexes(result)
      .map((document) => document.id)
      .join(','),
    importData: JSON.stringify({
      lines,
      details,
      specifications: result.specifications.filter((row) => required.has(norm(row.key))),
      review: result.review,
    }),
  };
}
function poImportPanel(app, open) {
  if (!can(app, PO_IMPORT_ACTION)) return '';
  if (app.local.poImport) return poImportReview(app, app.local.poImport);
  const provider = app.user.poAi?.provider || 'gemini';
  const name = PO_AI_PROVIDERS[provider];
  if (!app.user.poAi?.ready)
    return details(
      'Import buyer PO from PDF',
      form('read-buyer-po', <>
        {app.user.frontendPreview && app.data.buyerPoUploads?.length ? select('Previously uploaded buyer PO', 'savedDocument',
          app.data.buyerPoUploads.filter(doc => doc.mime === 'application/pdf').map(doc => [doc.id, doc.label]), {
            required: false, blank: 'Select a saved PDF',
          }) : ''}
        {file('Buyer purchase order', 'buyer-po', 'document', false, { accept: '.pdf', required: !app.data.buyerPoUploads?.length || !app.user.frontendPreview })}
        {app.user.frontendPreview ? <p className="sub wide">Download a test PO · {' '}
          <a download href="/sample-orders/01-standard-purchase-order.pdf">Standard order</a> · {' '}
          <a download href="/sample-orders/02-size-matrix-purchase-order.pdf">Size matrix</a> · {' '}
          <a download href="/sample-orders/03-mixed-styles-purchase-order.pdf">Mixed styles</a>
        </p> : ''}
      </>, 'Read PDF', 'Choose a text PDF to review the order and size variants.'),
      open,
    );
  const accept = '.pdf,.xlsx,image/png,image/jpeg';
  const uploads = (app.data.buyerPoUploads ?? []).map((row) => [
    row.id,
    row.label +
      ' · ' +
      new Date(row.addedAt).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
  ]);
  return details(
    'Import buyer PO with AI',
    form(
      'read-buyer-po',
      <>
        {hidden('provider', provider)}
        {provider === 'gemini' ? geminiModelField(app.user.poAi.models) : ''}
        {uploads.length
          ? select('Previously uploaded buyer PO', 'savedDocument', uploads, {
              required: false,
              initial: uploads.length === 1 ? uploads[0][0] : '',
            })
          : ''}
        {buyerPoFile(app, uploads.length ? 'Or upload a new buyer PO' : 'Buyer purchase order', {
          accept,
          required: !uploads.length,
        })}
        {file('Technical sheets or annexes (optional)', 'tech-pack', 'annex', true, {
          accept,
        })}
      </>,
      'Read files with ' + name,
      'Choose a saved or new buyer PO and any supporting files. Use PDF, XLSX, PNG or JPEG, up to 10 MB each and 50 MB combined. HAPZO sends the files to ' +
        name +
        ' for an editable draft.',
    ),
    open,
  );
}
function GarmentPage({ app, params: args }) {
  const s = app.data;
  const orders = new Set(s.orders.filter((order) => order.kind === 'Goods').map((order) => order.id));
  const lines = s.lines.filter((line) => line.unit === 'pcs' && orders.has(line.orderId));
  const inCompany = !args.has('company') || args.get('company') === app.user.companyId;
  const line = inCompany ? (ref(lines, args.get('line')) ?? (!args.has('line') ? lines[0] : null)) : null;
  const revision = args.get('revision');
  const snapshot =
    revision && Number(revision) !== line?.revision
      ? line?.revisions.find((row) => row.revision === Number(revision))
      : line;
  const draft = line?.garmentDraft;
  const editSaved = args.get('edit') === 'saved';
  const draftOptions =
    draft && line.garmentSpec
      ? actions(
          editSaved ? (
            garmentLink(app, line.id, '', 'Review AI draft')
          ) : (
            <a className="button secondary" href={'#' + h(garmentHash(app.user.companyId, line.id)) + '&edit=saved'}>
              Edit saved specification
            </a>
          ),
        )
      : '';
  return (
    <>
      {heading(
        'Garment tech packs',
        line ? packTitle(s, line) : 'Select a buyer PO line ordered in pieces.',
        navLink('Buyer orders', 'orders'),
      )}
      {poImportPanel(app, args.has('import') || !lines.length)}
      {panel(
        'Buyer PO and size',
        form(
          'tech-pack-filter',
          choose('Buyer PO line', 'lineId', lines, (row) => lineLabel(s, row), {
            initial: line?.id,
          }),
          'Open tech pack',
        ),
      )}
      {!line ? (
        empty('Create or select a garment PO line to prepare its specification.')
      ) : !snapshot ? (
        note('This specification revision could not be found.', true)
      ) : (
        <>
          {panel(
            'Specification ' +
              snapshot.specRev +
              ' · ' +
              (snapshot.status === 'Draft' ? 'Draft' : 'Approved revision ' + snapshot.revision),
            <>
              {actions(
                snapshot.garmentSpec
                  ? button('Print tech pack', {
                      'data-print-tech': h(line.id),
                      'data-tech-revision': h(snapshot.revision),
                    })
                  : '',
                snapshot !== line ? garmentLink(app, line.id, '', 'Current revision') : '',
              )}
              {snapshot.garmentSpec
                ? garmentPackSheet(snapshot, can(app, PO_IMPORT_ACTION))
                : empty('Add the fabric components and garment measurements for this PO line.')}
            </>,
          )}
          {snapshot === line && can(app, 'garment-spec') ? (
            <>
              {draftOptions}
              {packEditor(app, line, editSaved ? null : draft)}
            </>
          ) : (
            ''
          )}
        </>
      )}
    </>
  );
}
export { GarmentPage };
export const garmentInspectionFields = () => (
  <fieldset data-tech-qc="" className="wide fabric-group" hidden disabled>
    <details className="tech-subsection">
      <summary>Tech pack measurements</summary>
      <div className="fields">
        {select('PO revision and component', 'techTarget', [], {
          required: false,
        })}
        <EditableContent as="div" className="wide" data-tech-readings="" />
      </div>
    </details>
  </fieldset>
);
export function refreshGarmentInspection(form, app, reset = false) {
  const slot = form.querySelector('[data-tech-qc]');
  if (!slot) return;
  const lot = ref(app.data.lots, form.elements.lotId.value);
  const targets = garmentTargetsForLot(app.data, lot);
  const field = form.elements.techTarget;
  const from = reset ? '' : field.value;
  slot.hidden = slot.disabled = !targets.length;
  const selected = targets.find((row) => row.key === from) || (targets.length === 1 ? targets[0] : null);
  setContents(
    field,
    <>
      {option('', 'Select…', selected?.key)}
      {joinContent(
        targets.map((row) =>
          option(
            row.key,
            lineLabel(app.data, ref(app.data.lines, row.lineId)) + ' · ' + row.specRev + ' · ' + row.component,
            selected?.key,
          ),
        ),
        '',
      )}
    </>,
  );
  if (reset) slot.querySelector('details').open = Boolean(targets.length);
  const rows = selected?.checks ?? [];
  setContents(
    slot.querySelector('[data-tech-readings]'),
    rows.length
      ? table(
          ['Check / method', 'Target', 'Allowed range', 'Actual'],
          rows.map((check) => [
            <>
              {h(check.name)}
              {check.method || check.condition ? (
                <>
                  <br />
                  <small>{h(joinValid([check.method, check.condition]))}</small>
                </>
              ) : (
                ''
              )}
            </>,
            value(check.target, check.unit),
            limits(check.min, check.max, check.unit),
            <input type="number" step="any" aria-label={h(check.name + ' actual')} data-tech-reading={h(check.key)} />,
          ]),
        )
      : selected
        ? empty('Use the fabric measurements above for this component.')
        : empty('Select the PO revision and component for this sample.'),
  );
}
export function techInspectionInput(form) {
  const target = form.elements.techTarget?.value;
  const actual = Object.fromEntries(
    [...form.querySelectorAll('[data-tech-reading]')]
      .filter((el) => el.value !== '')
      .map((el) => [el.dataset.techReading, el.value]),
  );
  return target && Object.keys(actual).length
    ? JSON.stringify({
        target,
        actual,
      })
    : '';
}
const resultBadge = (result) =>
  badge(
    result,
    result === 'Outside limits' ? 'bad' : result === 'Missing' || result === 'Measurements missing' ? 'warn' : '',
  );
export const garmentInspectionCell = (e) =>
  e.techPack ? (
    <>
      {resultBadge(e.techPack.status)}
      <br />
      {linkButton('Tech pack results', 'tech-inspection', e.id)}
    </>
  ) : (
    ''
  );
export function garmentInspectionDetail(app, event) {
  const result = event.techPack;
  if (!result) return empty('No tech pack results for this inspection.');
  return (
    <>
      {heading('Tech pack inspection · ' + event.output, event.date + ' · ' + event.reference, lotLink(event.output))}
      {facts([
        ['Specification', h(result.specRev + ' · ' + result.component)],
        ['Result', resultBadge(result.status)],
      ])}
      {garmentLink(app, result.lineId, result.revision, 'Open pinned tech pack')}
      {panel(
        'Measured results',
        table(
          ['Measurement or test', 'Condition / method', 'Target', 'Allowed range', 'Actual', 'Result'],
          result.checks.map((check) => [
            h(check.name),
            h(joinValid([check.condition, check.method])),
            value(check.target, check.unit),
            limits(check.min, check.max, check.unit),
            value(check.actual, check.unit),
            resultBadge(check.status),
          ]),
        ),
      )}
    </>
  );
}
