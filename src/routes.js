// Fabric route templates approved per BOM or tech pack component.
// Existing PO line routes (ROUTES in model.js) are unchanged. A work order uses a component
// route only when it was released against one, so earlier work orders keep their meaning.
import { STAGES, clean, req, choice, ensure, id, norm, record, date } from './model.js';

export const FABRIC_ROUTE_TEMPLATES = {
  A: { name: 'A · Yarn dyeing → Knitting → Fabric finishing', legacy: 'Yarn-dyed knitted', type: 'Knitted',
    stages: ['Yarn dyeing', 'Knitting', 'Fabric finishing'] },
  B: { name: 'B · Yarn dyeing → Warp and weft preparation → Weaving → Fabric finishing', legacy: 'Yarn-dyed woven', type: 'Woven',
    stages: ['Yarn dyeing', 'Warping', 'Weaving', 'Fabric finishing'] },
  C: { name: 'C · Knitting → Fabric dyeing → Fabric finishing', legacy: 'Fabric-dyed knitted', type: 'Knitted',
    stages: ['Knitting', 'Fabric dyeing', 'Fabric finishing'] },
  D: { name: 'D · Warp and weft preparation → Weaving → Fabric dyeing → Fabric finishing', legacy: 'Fabric-dyed woven', type: 'Woven',
    stages: ['Warping', 'Weaving', 'Fabric dyeing', 'Fabric finishing'] },
};

// 'Warping' is the existing operation code for warp and weft preparation.
export const STAGE_LABELS = { Warping: 'Warp and weft preparation', Printing: 'Cut-panel printing' };
export const stageLabel = stage => STAGE_LABELS[stage] || stage;

// Fabric-level conditional operations and where they sit on the approved route.
export const CONDITIONAL_OPERATIONS = {
  Sizing: { after: 'Warping', note: 'Warp sizing for woven routes' },
  Desizing: { after: 'Weaving', note: 'Size removal before wet processing; required with sizing' },
  'Fabric washing': { before: 'Fabric finishing', note: 'Washing or scouring before finishing' },
  'Fabric printing': { before: 'Fabric finishing', note: 'Fabric printing before finishing' },
};

export function routeStages(template, conditional) {
  const stages = [...FABRIC_ROUTE_TEMPLATES[template].stages];
  for (const op of Object.keys(CONDITIONAL_OPERATIONS)) {
    if (!conditional.includes(op)) continue;
    const rule = CONDITIONAL_OPERATIONS[op];
    const anchor = stages.indexOf(rule.after || rule.before);
    ensure(anchor >= 0, op + ' does not apply to route ' + template + '.');
    stages.splice(rule.after ? anchor + 1 : anchor, 0, op);
  }
  return stages;
}

function componentsOf(line) {
  const fabrics = (line.garmentSpec?.fabrics ?? []).map(f => ({ code: f.code, type: f.construction?.type || '', source: 'Tech pack ' + line.specRev }));
  const bom = (line.bom ?? []).map(b => ({ code: b.code, type: '', source: 'BOM ' + line.bomRev }));
  return [...fabrics, ...bom.filter(b => !fabrics.some(f => norm(f.code) === norm(b.code)))];
}
export const lineComponents = componentsOf;

export function approveComponentRoute(s, x, ctx) {
  const line = record(s.lines, x.lineId, 'PO line');
  ensure(line.status === 'Approved', 'Approve the PO line and its BOM before approving a component route.');
  const code = req(x.component, 'BOM component', 64).toUpperCase();
  const component = componentsOf(line).find(c => norm(c.code) === norm(code));
  ensure(component, 'Choose a component from the approved BOM or tech pack of ' + line.id + '.');
  const template = choice(x.template, Object.keys(FABRIC_ROUTE_TEMPLATES), 'route template');
  const spec = FABRIC_ROUTE_TEMPLATES[template];
  ensure(!component.type || component.type === spec.type, 'Component ' + component.code + ' is ' + component.type.toLowerCase() + '. Route ' + template + ' is ' + spec.type.toLowerCase() + '.');
  const conditional = [...new Set(clean(x.conditional, 400).split(',').map(v => v.trim()).filter(Boolean))];
  ensure(conditional.every(op => Object.hasOwn(CONDITIONAL_OPERATIONS, op)), 'Choose conditional operations from: ' + Object.keys(CONDITIONAL_OPERATIONS).join(', ') + '.');
  ensure(!conditional.includes('Sizing') || conditional.includes('Desizing'), 'A sized warp must be desized before wet processing. Add Desizing to the route.');
  const stages = routeStages(template, conditional);
  const reason = req(x.reference, 'Approval reference');
  const previous = s.componentRoutes.filter(r => r.lineId === line.id && norm(r.component) === norm(component.code) && r.status === 'Approved');
  for (const row of previous) {
    row.status = 'Superseded';
    row.supersededAt = ctx.at;
  }
  const row = {
    id: id(s, 'CRT'), lineId: line.id, lineRevision: line.revision, bomRev: line.bomRev, specRev: line.specRev,
    component: component.code, componentSource: component.source, template, templateName: spec.name, legacy: spec.legacy,
    conditional, stages, version: String(previous.length + 1), status: 'Approved', effective: date(x.effective),
    reference: reason, actor: ctx.actor, at: ctx.at,
  };
  s.componentRoutes.push(row);
  return row;
}

// Snapshot pinned on the work order. Later route revisions do not change released work.
export function routeSnapshot(route) {
  return { id: route.id, template: route.template, name: route.templateName, legacy: route.legacy, component: route.component,
    stages: [...route.stages], version: route.version, bomRev: route.bomRev, lineRevision: route.lineRevision };
}

// Reject unauthorised route skips. Inputs must come from earlier operations on the approved route
// and at least one must come from the operation immediately before this one.
export function checkRouteStep(wo, lots) {
  const route = wo.componentRoute;
  if (!route || wo.rework) return;
  const stages = route.stages;
  const at = stages.indexOf(wo.stage);
  ensure(at >= 0, 'Operation ' + wo.stage + ' is not on approved route ' + route.name + '.', 422, 'route-skip');
  for (const lot of lots) {
    const index = stages.indexOf(lot.stage);
    // Weft yarn reaches the loom directly. On a yarn-dyed route it must be dyed; otherwise it may come straight from stock or spinning.
    if (wo.stage === 'Weaving' && ['Yarn', 'Dyed yarn'].includes(lot.material)) {
      if (stages.includes('Yarn dyeing')) ensure(lot.stage === 'Yarn dyeing', 'Route skip · weft lot ' + lot.id + ' must be dyed on route ' + route.template + ' before weaving.', 422, 'route-skip');
      else ensure(index < 0, 'Route skip · weft lot ' + lot.id + ' is at ' + stageLabel(lot.stage) + ' and cannot be woven as weft on route ' + route.template + '.', 422, 'route-skip');
      continue;
    }
    if (at === 0) ensure(index < 0, 'Route skip · lot ' + lot.id + ' has already passed ' + lot.stage + ' on route ' + route.template + '.', 422, 'route-skip');
    else ensure(index >= 0 && index < at, 'Route skip · lot ' + lot.id + ' is at ' + stageLabel(lot.stage) + '. Route ' + route.template +
      ' requires ' + stages.slice(0, at).map(stageLabel).join(' → ') + ' before ' + stageLabel(wo.stage) + '.', 422, 'route-skip');
  }
  // A weft-only issue to a loom run adds yarn to a run that already holds its beam; the roll posting checks the warp.
  const weftOnly = wo.stage === 'Weaving' && lots.every(lot => ['Yarn', 'Dyed yarn'].includes(lot.material));
  if (at > 0 && !weftOnly) ensure(lots.some(lot => lot.stage === stages[at - 1]), 'Route skip · post ' + stageLabel(stages[at - 1]) + ' before ' +
    stageLabel(wo.stage) + ' on approved route ' + route.template + '.', 422, 'route-skip');
}

export const isConditional = stage => Boolean(STAGES[stage]?.conditional);
