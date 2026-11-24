import { EditableContent, joinContent, setContents } from './react-ui.jsx';
import { ref, ROUTES } from '../src/model.mjs';
import {
  FABRIC_TYPES,
  FABRIC_CONDITIONS,
  FABRIC_INPUTS,
  FABRIC_METRICS,
  YARN_COUNT_UNITS,
  compareFabric,
  fabricCondition,
  fabricMetrics,
  fabricObservation,
  fabricSpecInput,
  fabricSpecification,
  fabricTargetsForLot,
  toleranceField,
} from '../src/fabric.mjs';
import { applyKnitYarnSystems } from '../src/garment.mjs';
import { PO_AI_PROVIDERS, PO_IMPORT_ACTION } from '../src/po-import.mjs';
import {
  badge,
  button,
  can,
  details,
  docs,
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
  panel,
  select,
  showQty,
  table,
  text,
} from './ui.jsx';
const numeric = (label, key, x, props = {}) =>
  numberField(label, key, {
    value: x[key] ?? '',
    required: false,
    min: 0.000001,
    ...props,
  });
function formulaDetails(type, measured) {
  const rows =
    type === 'Woven'
      ? [
          ['EPI and PPI', 'Warp ends or weft picks counted ÷ span in inches'],
          ['Crimp-adjusted densities', 'Warp = EPI × (1 + warp crimp % ÷ 100). Weft = PPI × (1 + weft crimp % ÷ 100).'],
          ['Estimated GSM', '(Adjusted warp × warp tex + adjusted weft × weft tex) ÷ 25.4'],
          ['Ideal equal yarn count in tex', 'Target GSM × 25.4 ÷ (adjusted warp + adjusted weft)'],
          [
            'Ideal count with one yarn fixed',
            '(Target GSM − GSM of the fixed yarn) × 25.4 ÷ adjusted density of the other yarn',
          ],
          [
            'Required missing density',
            '(Target GSM − GSM of the fixed direction) × 25.4 ÷ (yarn tex × crimp factor of the missing direction)',
          ],
        ]
      : [
          ['WPI and CPI', 'Wales or courses counted ÷ span in inches'],
          [
            'Stitch density and loops per inch of yarn',
            'WPI × CPI gives loops per square inch for plain single jersey. 25.4 ÷ stitch length in mm gives loops per inch of yarn.',
          ],
          ['Machine gauge', 'Needle positions ÷ (π × cylinder diameter in inches), or 25.4 ÷ needle pitch in mm'],
          [
            'Estimated GSM',
            'WPI × CPI × yarn mm per cell × yarn tex ÷ 645.16. Use stitch length for plain single jersey or divide the measured yarn length by the cells in the repeat.',
          ],
          ['Ideal yarn count in tex', 'Target GSM × 645.16 ÷ (WPI × CPI × yarn mm per cell)'],
        ];
  if (type === 'Knitted' && measured)
    rows.push([
      'GSM with multiple yarns',
      'Calculate the GSM of each yarn from its length per cell and tex. Add all yarn contributions.',
    ]);
  if (measured) rows.push(['Swatch GSM', 'Mass in grams × 10,000 ÷ area in cm²']);
  rows.push(
    [
      'Yarn count in tex',
      '590.541 ÷ Ne, 1,000 ÷ Nm, or denier ÷ 9. The calculator converts ideal counts back to your selected unit.',
    ],
    [
      'Tolerance limits',
      'Subtract the lower allowance and add the upper allowance to the target. A percentage allowance equals target × percentage ÷ 100.',
    ],
  );
  return (
    <details className="wide fabric-options">
      <summary>Calculation formulas</summary>
      {table(
        ['Result', 'Formula'],
        rows.map((row) => row.map(h)),
      )}
    </details>
  );
}
function structureOrConstruction(type, x, mode) {
  const woven = type === 'Woven';
  const fields = Object.fromEntries(
    FABRIC_INPUTS[type].map(([key, label]) => [
      key,
      numeric(
        label,
        key,
        x,
        key.endsWith('Crimp')
          ? {
              min: 0,
            }
          : ['repeatCells', 'needlePositions'].includes(key)
            ? {
                min: 1,
                step: 1,
              }
            : {},
      ),
    ]),
  );
  const primary = [
    fields[woven ? 'warpThreads' : 'waleThreads'],
    fields[woven ? 'weftThreads' : 'courseThreads'],
    numeric('Count span in each direction (in)', 'countSpanIn', x, {
      placeholder: '1 in if blank',
    }),
    select('Yarn count system', 'countUnit', YARN_COUNT_UNITS, {
      initial: x.countUnit || 'Ne',
    }),
  ];
  const more = woven
    ? [
        fields.warpCount,
        fields.weftCount,
        fields.warpCrimp,
        fields.weftCrimp,
        <p className="wide sub muted">
          GSM estimates use 0% for blank crimp. Enter the resultant count for plied yarn.
        </p>,
      ]
    : [
        fields.loopLength,
        fields.yarnCount,
        fields.gauge,
        <details className="wide fabric-options" open={x.needlePositions || x.needlePitchMm}>
          <summary>Calculate machine gauge from dimensions</summary>
          <div className="fields">
            {fields.needlePositions}
            {fields.cylinderIn}
            {fields.needlePitchMm}
            <p className="wide sub muted">
              Use needle positions around one cylinder and its diameter, or the pitch between adjacent needle positions.
            </p>
          </div>
        </details>,
        <details className="wide fabric-options" open={x.repeatYarnMm}>
          <summary>Use a measured knit repeat</summary>
          <div className="fields">
            {fields.repeatYarnMm}
            {fields.repeatCells}
            <p className="wide sub muted">
              For a single yarn across the fabric, enter the total yarn length and the number of wale × course cells in
              the same repeat. Plain single jersey can use stitch length directly.
            </p>
          </div>
        </details>,
      ];
  if (!woven && mode === 'calculator')
    more.push(
      <details className="wide fabric-options" open={x.yarnSystems}>
        <summary>Use multiple yarns in a measured knit repeat</summary>
        <div className="fields">
          {numeric('Wale × course cells in the repeat', 'yarnRepeatCells', x, {
            min: 1,
            step: 1,
          })}
          {text(
            'Yarn systems, one per row (name, count, unit, length in mm)',
            'yarnSystems',
            'Ground,30,Ne,10.8\nPlating,40,denier,9.5',
            false,
            x.yarnSystems,
          )}
        </div>
      </details>,
    );
  const tolerances =
    mode !== 'inspection' ? (
      <details className="wide fabric-options" open={fabricMetrics(type).some((key) => x[toleranceField(key)])}>
        <summary>Buyer tolerances</summary>
        <p className="sub muted">
          Enter 3 for ±3 units, ±5% for 5% each way, or −3% / +5% for different lower and upper allowances.
        </p>
        <div className="fields">
          {joinContent(
            fabricMetrics(type).map((key) =>
              field(FABRIC_METRICS[key].label + ' tolerance', toleranceField(key), {
                required: false,
                value: x[toleranceField(key)] ?? '',
              }),
            ),
            '',
          )}
        </div>
      </details>
    ) : (
      ''
    );
  return (
    <fieldset className="fields wide fabric-group" data-fabric-kind={type} hidden disabled>
      {field('Structure', 'fabricStructure', {
        value: x.fabricStructure,
        required: false,
        placeholder: woven ? 'e.g. Plain weave' : 'e.g. Single jersey 100% cotton',
      })}
      {joinContent(primary, '')}
      {joinContent(more, '')}
      {tolerances}
      {mode === 'inspection' ? '' : formulaDetails(type, mode === 'calculator')}
    </fieldset>
  );
}
function measurementFields(x) {
  return (
    <div className="wide fields fabric-measurements" data-fabric-measurements="">
      {numeric('Measured lab GSM', 'measuredGsm', x)}
      {numeric('Swatch mass (g)', 'swatchMassG', x)}
      {numeric('Swatch area (cm²)', 'swatchAreaCm2', x)}
      <p className="wide sub muted">Enter a lab GSM, or use swatch mass and area to calculate it.</p>
    </div>
  );
}
function fabricEditor(mode, spec, gsm, draft) {
  const x = draft ?? {
    ...fabricSpecInput(spec),
    gsm: gsm ?? spec?.values.gsm,
    fabricType: spec?.type || (mode === 'calculator' ? 'Woven' : ''),
  };
  return (
    <div className="wide fabric-editor" data-fabric-editor={mode}>
      <div className="fields">
        {select('Fabric type', 'fabricType', FABRIC_TYPES, {
          required: false,
          blank: 'Choose fabric type',
          initial: x.fabricType,
        })}
        {mode === 'inspection' ? (
          ''
        ) : (
          <>
            {numeric('Target GSM', 'gsm', x)}
            <div data-fabric-condition="" className="wide">
              {select('Fabric stage for this specification', 'fabricCondition', FABRIC_CONDITIONS, {
                initial: x.fabricCondition || (mode === 'calculator' && draft ? '' : 'Finished'),
              })}
            </div>
          </>
        )}
        {mode === 'spec' ? '' : measurementFields(x)}
        {joinContent(
          FABRIC_TYPES.map((type) =>
            structureOrConstruction(
              type,
              type === x.fabricType || (mode === 'calculator' && !x.fabricType) ? x : {},
              mode,
            ),
          ),
          '',
        )}
      </div>
      <EditableContent as="div" className="fabric-preview" data-fabric-preview="" aria-live="polite" />
    </div>
  );
}
export function fabricSpecFields(line) {
  return (
    <details className="wide fabric-options" open={line?.fabricSpec || line?.gsm != null}>
      <summary>Fabric specification and calculator</summary>
      {fabricEditor('spec', line?.fabricSpec, line?.gsm)}
    </details>
  );
}
export const componentConstructionFields = (component) =>
  fabricEditor('spec', component?.construction, component?.gsm, component?.constructionDraft);
export const componentConstructionInput = (editor) => fieldsIn(editor);
export function fabricInspectionFields() {
  return (
    <fieldset className="wide fabric-group" data-fabric-slot="" hidden disabled>
      <details className="fabric-options">
        <summary>Fabric measurements</summary>
        {fabricEditor('inspection')}
      </details>
    </fieldset>
  );
}
function fabricValues(spec, measured = null) {
  const { type, countUnit, values: v } = spec;
  const rows = [
    ['Measured GSM', measured, 'g/m²'],
    ['Estimated GSM from construction', v.estimatedGsm, 'g/m²'],
  ];
  if (type === 'Woven') {
    rows.push(
      ['Warp ends per inch', v.epi, 'EPI'],
      ['Weft picks per inch', v.ppi, 'PPI'],
      ['Estimated EPI for target GSM', v.requiredEpi, 'EPI'],
      ['Estimated PPI for target GSM', v.requiredPpi, 'PPI'],
      ['Ideal equal warp and weft count', v.idealEqualCount, countUnit],
      ['Ideal warp count with weft fixed', v.idealWarpCount, countUnit],
      ['Ideal weft count with warp fixed', v.idealWeftCount, countUnit],
    );
  } else {
    rows.push(
      ['Wales per inch', v.wpi, 'WPI'],
      ['Courses per inch', v.cpi, 'CPI'],
      ['Loops per square inch', v.stitchDensity, 'loops/in²'],
      ['Loops per inch of yarn', v.loopsPerYarnInch, 'loops/in'],
      ['Calculated machine gauge', v.calculatedGauge, 'needles/in'],
      ['Ideal yarn count for target GSM', v.idealYarnCount, countUnit],
    );
  }
  const recorded = rows.filter(([, n]) => n != null);
  return recorded.length
    ? facts(
        recorded.map(([name, n, unit]) => [
          name,
          h(
            n.toLocaleString('en-IN', {
              maximumFractionDigits: 3,
            }) +
              ' ' +
              unit,
          ),
        ]),
      )
    : '';
}
function targetsTable(spec) {
  const rows = fabricMetrics(spec.type).flatMap((key) => {
    const value = spec.values[key];
    if (value == null) return [];
    const { label, unit = spec.countUnit } = FABRIC_METRICS[key];
    const range = spec.ranges[key];
    return [
      [
        h(label),
        showQty(value, unit),
        range ? h(spec.tolerances[key]) : '—',
        range ? showQty(range.min) + '–' + showQty(range.max, unit) : '—',
      ],
    ];
  });
  return rows.length ? table(['Metric', 'Target', 'Tolerance', 'Allowed range'], rows) : '';
}
export function fabricSpecCard(spec, fallbackGsm) {
  if (!spec) return fallbackGsm == null ? '' : facts([['Target GSM', showQty(fallbackGsm, 'g/m²')]]);
  return (
    <>
      {facts([
        ['Fabric type', h(spec.type)],
        ['Structure', h(spec.structure)],
        ['Fabric stage', h(spec.condition)],
      ])}
      {targetsTable(spec)}
      {fabricValues(spec)}
    </>
  );
}
const resultBadge = (status) =>
  badge(status, status === 'Outside limits' ? 'bad' : status.includes('missing') || status === 'Missing' ? 'warn' : '');
function fabricInspectionBadges(entry) {
  return entry
    ? joinContent(
        entry.comparisons.map((row) => resultBadge(row.status)),
        ' ',
      ) || badge('Measurements recorded', 'neutral')
    : '—';
}
export function fabricInspectionReport(entry) {
  if (!entry) return '';
  const { condition, observation, comparisons } = entry;
  const fields = observation
    ? fabricMetrics(observation.type).flatMap((key) => {
        const value = observation.values[key];
        const { label, unit = observation.countUnit } = FABRIC_METRICS[key];
        return value == null ? [] : [[key === 'gsm' ? 'Measured GSM' : label, showQty(value, unit)]];
      })
    : [];
  const measuredSwatch = observation?.swatchMassG != null && observation.swatchAreaCm2 != null;
  if (measuredSwatch)
    fields.push([
      'Swatch mass and area',
      showQty(observation.swatchMassG, 'g') + ' / ' + showQty(observation.swatchAreaCm2, 'cm²'),
    ]);
  const observed = observation
    ? facts([
        ['Fabric', h([observation.type, observation.structure, condition].filter(Boolean).join(' · '))],
        ...fields,
      ])
    : '';
  const checks = comparisons.map((row) => (
    <>
      <p className="fabric-result-title">
        {linkButton(row.lineId, 'line', row.lineId)}
        {' · '}
        {h([row.specRev, row.component].filter(Boolean).join(' · '))}
        {' · '}
        {resultBadge(row.status)}
      </p>
      {table(
        ['Metric', 'Target', 'Allowed range', 'Measured', 'Result'],
        row.checks.map((check) => {
          const { actual, target, min, max, unit, status } = check;
          return [
            h(check.label),
            unit ? showQty(target, unit) : h(target),
            unit ? showQty(min) + '–' + showQty(max, unit) : '—',
            actual == null ? '—' : unit ? showQty(actual, unit) : h(actual),
            resultBadge(status),
          ];
        }),
      )}
    </>
  ));
  return (
    <>
      {observed}
      {joinContent(checks, '')}
    </>
  );
}
function fieldsIn(editor) {
  return Object.fromEntries(
    [...editor.querySelectorAll('input:not(:disabled), select:not(:disabled)')].map((el) => [el.name, el.value]),
  );
}
function gsmInputHint({ type, inputs, values }, hasYarnSystems) {
  if (values.estimatedGsm != null)
    return values.gsm == null ? 'Enter a target GSM to calculate ideal yarn counts or GSM tolerance limits.' : '';
  if (type === 'Woven') {
    return values.epi == null || values.ppi == null
      ? 'Enter warp ends and weft picks over the count span. The default span is 1 inch.'
      : 'Enter both yarn counts to estimate woven GSM.';
  }
  if (values.wpi == null || values.cpi == null)
    return 'Enter wales and courses over the count span. The default span is 1 inch.';
  if (hasYarnSystems) return '';
  if ((inputs.repeatYarnMm == null) !== (inputs.repeatCells == null))
    return 'Enter both yarn length and cells in the measured repeat.';
  if (values.yarnCount == null) return 'Enter the yarn count to estimate knit GSM.';
  return 'For plain single jersey, enter the structure and stitch length. For other structures, enter the yarn length and cells in a measured repeat.';
}
export function refreshFabricEditor(editor, app) {
  const mode = editor.dataset.fabricEditor;
  const type = editor.querySelector('[name="fabricType"]').value;
  for (const group of editor.querySelectorAll('[data-fabric-kind]'))
    group.hidden = group.disabled = group.dataset.fabricKind !== type;
  const stage = editor.querySelector('[name="fabricCondition"]');
  if (stage) stage.disabled = stage.closest('[data-fabric-condition]').hidden = !type;
  const measurements = editor.querySelector('[data-fabric-measurements]');
  if (measurements) {
    measurements.hidden = !type;
    for (const input of measurements.querySelectorAll('input')) input.disabled = !type;
  }
  const preview = editor.querySelector('[data-fabric-preview]');
  try {
    const x = fieldsIn(editor);
    if (mode === 'inspection') {
      const lot = ref(app.data.lots, editor.closest('form')?.elements.lotId.value);
      const targets = fabricTargetsForLot(app.data, lot, editor.closest('form')?.elements.techTarget?.value || '');
      const observation = fabricObservation(x, {
        partial: true,
      });
      const comparisons = compareFabric(targets, observation);
      setContents(
        preview,
        observation || comparisons.length
          ? fabricInspectionReport({
              condition: fabricCondition(lot),
              observation,
              comparisons,
            })
          : '',
      );
      return;
    }
    if (!type) {
      setContents(preview, '');
      return;
    }
    const route = editor.closest('form')?.elements.route?.value;
    const stages = Object.hasOwn(ROUTES, route) ? ROUTES[route] : ref(app.data.routes, route)?.stages || [];
    const options = {
      partial: true,
      stages,
    };
    const spec = fabricSpecification(x, options);
    const component =
      mode === 'calculator'
        ? editor.querySelector('[data-fabric-kind="Knitted"]:not(:disabled)')
        : editor.closest('[data-tech-row="fabrics"]');
    const yarnSystems = component?.querySelector('[name="yarnSystems"]')?.value.trim();
    if (yarnSystems) {
      try {
        applyKnitYarnSystems(
          {
            yarnSystems,
            yarnRepeatCells: component.querySelector('[name="yarnRepeatCells"]').value,
          },
          spec,
        );
      } catch (error) {
        spec.values.estimatedGsm = spec.values.idealYarnCount = null;
        spec.warnings.push(error.message);
      }
    }
    const measured = mode === 'calculator' ? fabricObservation(x, options)?.values.gsm : null;
    const hint = gsmInputHint(spec, Boolean(yarnSystems));
    setContents(
      preview,
      <>
        {fabricValues(spec, measured)}
        {targetsTable(spec)}
        {hint ? <p className="sub muted">{h(hint)}</p> : ''}
        {joinContent(
          spec.warnings.map((message) => note(message, true)),
          '',
        )}
      </>,
    );
  } catch (error) {
    setContents(preview, note(error.message, true));
  }
}
export function selectFabricLot(lotField, app) {
  const slot = lotField.form.querySelector('[data-fabric-slot]');
  if (!slot) return;
  if (slot.dataset.lotId && slot.dataset.lotId !== lotField.value) {
    for (const input of slot.querySelectorAll('input')) input.value = input.defaultValue;
    for (const select of slot.querySelectorAll('select'))
      select.value = [...select.options].find((option) => option.defaultSelected)?.value ?? '';
  }
  slot.dataset.lotId = lotField.value;
  const lot = ref(app.data.lots, lotField.value);
  slot.hidden = slot.disabled = !fabricCondition(lot);
  if (slot.hidden) return;
  const editor = slot.querySelector('[data-fabric-editor]');
  const types = [
    ...new Set(
      fabricTargetsForLot(app.data, lot, lotField.form.elements.techTarget?.value || '').map((row) => row.spec.type),
    ),
  ];
  const typeField = editor.querySelector('[name="fabricType"]');
  if (types.length === 1) typeField.value = types[0];
  slot.querySelector('details').open = types.length > 0;
  refreshFabricEditor(editor, app);
}
export const fabricInspectionCell = (event) =>
  event.fabric ? (
    <>
      {fabricInspectionBadges(event.fabric)}
      <br />
      {linkButton('Fabric results', 'fabric-report', event.id)}
    </>
  ) : (
    '—'
  );
export function fabricReportDetail(_app, event) {
  return (
    <>
      {heading('Fabric results · ' + event.output, event.date + ' · ' + event.reference, lotLink(event.output))}
      {fabricInspectionReport(event.fabric)}
    </>
  );
}
function fabricComponentName(fabric, index) {
  const names = [...new Set([fabric.code, fabric.role, fabric.description].filter(Boolean))];
  return [...(names.length ? names : ['Fabric ' + (index + 1)]), fabric.construction.fabricCondition, fabric.source]
    .filter(Boolean)
    .join(' · ');
}
export function fabricTechPackReview(files = []) {
  const choices = [];
  const results = joinContent(
    files.map(({ result, filename, error, retry = result?.retry }, fileIndex) => {
      if (!result) return note([filename, error, retry && geminiRetryMessage(retry)].filter(Boolean).join(' · '), true);
      const model = result.modelLabel || PO_AI_PROVIDERS[result.provider];
      const method = [result.layoutMethod, model].filter(Boolean).join(' · ');
      result.fabrics.forEach((fabric, index) => {
        choices.push([fileIndex + ':' + index, result.document.label + ' · ' + fabricComponentName(fabric, index)]);
      });
      return (
        <>
          <p className="sub">
            {docs(result.document)}
            {method ? ' · ' + h(method) : ''}
            {retry ? (
              <>
                <br />
                {h(geminiRetryMessage(retry))}
              </>
            ) : (
              ''
            )}
          </p>
          {result.review.length
            ? details(
                'Review extraction notes for ' + result.document.label,
                <ul>
                  {joinContent(
                    result.review.map((row) => <li>{h(row)}</li>),
                    '',
                  )}
                </ul>,
              )
            : ''}
        </>
      );
    }),
    '',
  );
  return (
    <>
      {results}
      {choices.length ? (
        <>
          <div className="fields">
            {select('Fabric component', 'fabricComponent', choices, {
              initial: choices[0][0],
            })}
          </div>
          {button('Load into calculator', {
            'data-load-fabric-component': 'yes',
          })}
        </>
      ) : (
        ''
      )}
    </>
  );
}
export function loadFabricCalculator(container, result, index, app) {
  const fabric = result.fabrics[index];
  const { construction, measuredGsm, swatchMassG, swatchAreaCm2, yarnSystems, yarnRepeatCells } = fabric;
  setContents(
    container,
    <>
      <p className="sub">
        {docs(result.document)}
        {' · '}
        {h(fabricComponentName(fabric, index))}
      </p>
      {construction.fabricType ? '' : note('Choose the fabric type to see the construction fields and calculations.')}
      {fabricEditor('calculator', null, null, {
        ...construction,
        measuredGsm,
        swatchMassG,
        swatchAreaCm2,
        yarnSystems,
        yarnRepeatCells,
      })}
    </>,
  );
  const editor = container.querySelector('[data-fabric-editor]');
  refreshFabricEditor(editor, app);
  editor.querySelector('[name="fabricType"]').focus();
}
function fabricTechPackPanel(app) {
  if (!can(app, PO_IMPORT_ACTION)) return '';
  const ai = app.user.poAi;
  if (!ai?.ready)
    return panel(
      'Upload tech packs',
      <p className="note">
        {'Configure Gemini from '}
        <a href="#gemini-models">Gemini Model API settings</a>
        {' to read tech packs.'}
      </p>,
    );
  const name = PO_AI_PROVIDERS[ai.provider];
  return panel(
    'Upload tech packs',
    <>
      {form(
        'read-fabric-tech-pack',
        <>
          {hidden('provider', ai.provider)}
          {ai.provider === 'gemini' ? geminiModelField(ai.models) : ''}
          {file('Garment tech packs', 'tech-pack', 'document', true, {
            accept: '.pdf,.xlsx,image/png,image/jpeg',
            required: true,
          })}
          <p className="sub wide" data-fabric-read-status="" role="status" hidden />
        </>,
        'Read fabric specifications',
        'Select one or more PDF, XLSX, PNG or JPEG files up to 10 MB each. HAPZO reads each file with ' + name + '.',
      )}
      <EditableContent as="div" data-fabric-tech-pack-review="">
        {fabricTechPackReview(app.local.fabricTechPacks)}
      </EditableContent>
    </>,
  );
}
function FabricPage({ app }) {
  const rows = app.data.lines.flatMap((line) => {
    const fabrics =
      line.garmentSpec?.fabrics ??
      (line.fabricSpec
        ? [
            {
              construction: line.fabricSpec,
              gsm: line.fabricSpec.values.gsm,
              structure: line.fabricSpec.structure,
            },
          ]
        : []);
    return fabrics.map((fabric) => [
      linkButton(lineLabel(app.data, line), 'line', line.id),
      h([fabric.code, fabric.role].filter(Boolean).join(' · ') || '—'),
      h(fabric.construction?.type || 'Other textile'),
      h(fabric.structure),
      h(fabric.construction?.condition || 'Finished'),
      fabric.gsm == null ? '—' : showQty(fabric.gsm, 'g/m²'),
      h(line.specRev),
    ]);
  });
  return (
    <>
      {heading(
        'Fabric specifications',
        'Calculate fabric construction and check buyer tolerances.',
        navLink('Garment tech packs', 'tech-pack'),
      )}
      {fabricTechPackPanel(app)}
      {panel(
        'Fabric calculator',
        <EditableContent as="div" data-fabric-calculator="">
          {fabricEditor('calculator')}
        </EditableContent>,
      )}
      {panel(
        'PO fabric specifications',
        table(
          ['PO line', 'Component', 'Fabric type', 'Structure', 'Stage', 'Target GSM', 'Spec revision'],
          rows,
          'Add fabric components in a garment tech pack or set the fabric specification on a buyer PO line.',
        ),
      )}
    </>
  );
}
export { FabricPage };
