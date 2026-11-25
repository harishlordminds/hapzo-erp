import { DPP_FIELDS, date, clean, req, record, ensure, ref, id, genealogy, round, number, choice, key, norm, csvLines } from './model.js';
import { schemesOf } from './commerce.js';
import { checkClaimRules, claimContextForLot } from './claim-scope.js';
import { checkHistory, checkEvidence } from './standards.js';

export const PASSPORT_PRODUCTS = ['Finished fabric', 'Inspected fabric', 'Released garment', 'Packed carton', 'Yarn', 'Dyed yarn'];
export const APPLICABILITY = ['Unassessed', 'Applicable', 'Not applicable'];
const REQUIRED = new Set([3, 7, 10, 11, 22, 47]);
const PROFILE_PRODUCTS = ['Fabric', 'Garment', 'Yarn'];
const family = lot => ['Finished fabric', 'Inspected fabric'].includes(lot.material) ? 'Fabric' :
  ['Yarn', 'Dyed yarn'].includes(lot.material) ? 'Yarn' : 'Garment';
const requiredPoint = (p, n) => REQUIRED.has(n) || p.profileSnapshot?.requiredPoints.includes(n);
const pointNumber = value => {
  const n = Number(value);
  ensure(Number.isInteger(n) && n >= 1 && n <= DPP_FIELDS.length, 'Use valid HAPZO point numbers from 1 to ' + DPP_FIELDS.length + '.');
  return n;
};

export function approveDppProfile(s, x, ctx) {
  const code = key(x.code, 'Profile code');
  const version = req(x.version, 'Profile revision');
  ensure(!s.processSetups.some(row => row.process === 'DPP profile' && norm(row.code) === norm(code) && norm(row.version) === norm(version)),
    'This product and market profile revision already exists.');
  const requiredPoints = [...new Set(clean(x.requiredPoints, 500).split(/[\s,]+/).filter(Boolean).map(pointNumber))];
  const excludedPoints = csvLines(x.excludedPoints, 'Profile exclusions', 2).map(([n, reason]) => ({
    number: pointNumber(n), reason: req(reason, 'Applicability rationale'),
  }));
  ensure(new Set(excludedPoints.map(p => p.number)).size === excludedPoints.length &&
    excludedPoints.every(p => !REQUIRED.has(p.number) && !requiredPoints.includes(p.number)), 'Required fields cannot be excluded from the profile.');
  const p = {
    id: id(s, 'DPF'), process: 'DPP profile', status: 'Approved', code, version,
    product: choice(x.product, PROFILE_PRODUCTS, 'product family'), market: req(x.market, 'Product market'),
    effective: date(x.effective), reference: req(x.reference, 'Approved profile source or buyer instructions'),
    requiredPoints, excludedPoints, actor: ctx.actor, at: ctx.at,
    document: ctx.document(x.document, ['passport', 'evidence']),
  };
  s.processSetups.push(p);
  return p;
}

// Attribute each run along actual consumption edges. Shared stages can appear on several paths.
export function runActivity(s, lot) {
  const fraction = new Map();
  const byId = new Map(s.lots.map(l => [l.id, l]));
  const events = new Map(s.events.map(e => [e.id, e]));
  const graph = [lot, ...genealogy(s, lot.id)];
  // Child readiness gives a topological order even when paths have different lengths.
  const waiting = new Map(graph.map(l => [l.id, 0]));
  for (const child of graph) for (const p of child.parents) {
    if (waiting.has(p.id)) waiting.set(p.id, waiting.get(p.id) + 1);
  }
  const queue = graph.filter(l => waiting.get(l.id) === 0);
  fraction.set(lot.id, 1);
  const rows = [];
  for (let i = 0; i < queue.length; i++) {
    const l = queue[i];
    const share = fraction.get(l.id) || 0;
    const event = events.get(l.eventId);
    if (event?.kind === 'Production' || event?.kind === 'Processed return' && ['Washing', 'Printing', 'Embroidery'].includes(event.process)) rows.push({
      eventId: event.id, lotId: l.id, stage: event.stage, site: event.site, share: round(share),
      // A posting with several outputs (lint bales and seed) stores each lot's mass share of the run on the lot.
      electricity: round(((l.resources ?? event).electricity || 0) * share), water: round(((l.resources ?? event).water || 0) * share),
      steam: round(((l.resources ?? event).steam || 0) * share), units: { electricity: 'kWh', water: 'L', steam: 'kg' },
      measured: Object.fromEntries(['electricity', 'water', 'steam'].map(k => [k, (l.resources ?? event)[k] != null])),
      readingId: event.readingId || '', method: 'Share of output stock units consumed' + (event.allocationBasis ? ' · ' + event.allocationBasis : '') +
        (event.operationAllocations ? ' · Actual recorded operation pieces' : ''),
      methodVersion: event.methodVersion || (event.operationAllocations ? 'HZ-GARMENT-1' : 'HZ-RUN-1'),
      evidence: (event.checks ?? []).flatMap(c => (c.evidence ?? []).map(e => e.number)),
    });
    for (const parent of l.parents) {
      const p = byId.get(parent.id);
      if (!p?.initialQty || !waiting.has(p.id)) continue;
      fraction.set(p.id, (fraction.get(p.id) || 0) + share * parent.qty / p.initialQty);
      waiting.set(p.id, waiting.get(p.id) - 1);
      if (waiting.get(p.id) === 0) queue.push(p);
    }
  }
  return rows;
}

function productionSources(s, lot) {
  const graph = [lot, ...genealogy(s, lot.id)];
  const lotIds = new Set(graph.map(row => row.id));
  const batchIds = new Set(graph.flatMap(l => [l.batchId, l.printBatchId, l.embroideryBatchId, l.panel?.layId].filter(Boolean)));
  const jobIds = new Set(graph.map(l => l.jobId).filter(Boolean));
  const sourceIds = new Set(graph.flatMap(l => [l.eventId, l.inspectionId, ...(l.garmentFinish?.inspectionHistory ?? [])].filter(Boolean)));
  return {
    method: 'HZ-LOT-2',
    lots: graph.map(row => ({
      lotId: row.id, material: row.material, stage: row.stage, unit: row.unit, originalQty: row.initialQty, site: row.site, origin: row.origin,
      composition: row.composition || '', allocations: row.allocations, parents: row.parents, panel: row.panel, packing: row.packing,
      processBatchId: row.batchId, ownerId: row.ownerId, workOrderId: row.workOrderId,
      assembly: row.assembly, garmentFinish: row.garmentFinish, embroidery: row.embroidery, printing: row.printing,
      checks: row.checks, netKg: row.netKg, lengthM: row.lengthM,
    })),
    batches: s.processBatches.filter(b => batchIds.has(b.id)).map(b => ({
      id: b.id, number: b.number, process: b.process, stage: b.stage, site: b.site, recipe: b.recipe, artwork: b.artwork, marker: b.marker,
      plan: b.plan, jobId: b.jobId, checks: b.checks, postings: b.postings,
    })),
    processors: s.jobs.filter(j => jobIds.has(j.id)).map(j => ({
      jobId: j.id, challan: j.number, operation: j.stage, processor: j.processor, site: j.site, date: j.date, checks: j.checks,
    })),
    events: s.events.filter(e => !e.reversedBy && (sourceIds.has(e.id) || batchIds.has(e.batchId) || jobIds.has(e.jobId) ||
      e.kind === 'Quality inspection' && lotIds.has(e.output))).map(e => ({
      id: e.id, kind: e.kind, operation: e.operation || e.step || e.stage, date: e.date, reference: e.reference, site: e.site,
      output: e.output, lotIds: e.lotIds ?? e.outputs, inputs: e.inputs, resources: e.resources, reconciliation: e.reconciliation,
      evidence: e.checks, document: e.document, decision: e.decision, fabric: e.fabric, measurements: e.techPack, recipe: e.recipe,
      machine: e.machineName, settings: e.settings, supplies: e.supplies, chemicals: e.chemicals,
      operationAllocations: e.operationAllocations,
    })),
  };
}

function applyProfile(s, p, profileId, on) {
  const profile = record(s.processSetups, profileId, 'approved product and market profile');
  const lot = record(s.lots, p.lotId, 'passport lot');
  ensure(profile.process === 'DPP profile' && profile.status === 'Approved' && profile.product === family(lot) && profile.effective <= on,
    'Use the effective approved profile for this product family.');
  p.profileSnapshot = structuredClone(profile);
  p.profile = [profile.product, profile.market, profile.code + ' r' + profile.version].join(' · ');
  for (const field of p.points) {
    if (requiredPoint(p, field.number)) {
      field.applicability = 'Applicable';
    } else {
      const excluded = profile.excludedPoints.find(row => row.number === field.number);
      if (excluded) Object.assign(field, { applicability: 'Not applicable', reason: excluded.reason, verified: false, visibility: 'Internal', assessedBy: profile.actor });
    }
  }
}

function sourcePoints(s, lot, p) {
  const graph = [lot, ...genealogy(s, lot.id)];
  const production = new Map(s.events.map(e => [e.id, e]));
  const names = list => [...new Set(list.filter(Boolean))].join(', ');
  const sites = list => {
    const found = graph.filter(l => list.includes(l.stage));
    return [names(found.map(l => production.get(l.eventId)?.site || l.origin || l.site)), names(found.map(l => l.eventId))];
  };
  const fields = DPP_FIELDS.map((name, index) => ({
    number: index + 1, name, applicability: REQUIRED.has(index + 1) ? 'Applicable' : 'Unassessed',
    value: '', source: '', reason: '', verified: false, visibility: 'Internal',
  }));
  const fill = (n, value, source, system = false, publicField = false) => {
    if (!value) return;
    Object.assign(fields[n - 1], { applicability: 'Applicable', value, source, verified: system, visibility: publicField ? 'Public' : 'Internal' });
  };
  fill(3, lot.id, 'Lot ' + lot.id, true, true);
  fill(7, lot.material, 'Lot ' + lot.id, true, true);
  fill(10, 'Draft', p.id, true, true);
  fill(11, s.settings.name, 'Company master', true, true);
  fill(12, s.settings.identifier, 'Company master');
  fill(13, s.settings.address, 'Company master');
  fill(14, s.settings.contact, 'Company master');
  if (!schemesOf(lot).includes('CMiA Mass Balance')) {
    const receipts = graph.filter(l => l.claimSource === 'receipt');
    fill(18, names(receipts.map(l => l.origin)), names(receipts.map(l => l.eventId)));
  }
  fill(19, ...sites(['Spinning']));
  fill(20, ...sites(['Weaving', 'Knitting']));
  fill(21, ...sites(['Cutting', 'Stitching']));
  fill(22, p.composition, p.compositionSource, false, true);
  if (p.recycled !== null) {
    fill(28, p.recycled + '%', p.factorRef);
    fill(29, p.pre + '%', p.factorRef);
    fill(30, p.post + '%', p.factorRef);
  }
  if (p.co2 !== null) fill(33, p.co2 + ' kg CO₂e/kg · electricity subtotal', p.factorRef);
  if (p.water !== null) fill(34, p.water + ' L/kg · physical consumption', p.factorRef);
  fill(47, p.id + ' · ' + p.activity.length + ' linked run records · ' + p.calculationVersion, 'Retained calculation and lot source snapshots', true);
  return fields;
}

export function newPassport(s, x, ctx) {
  const lot = record(s.lots, x.lotId, 'passport lot');
  ensure(PASSPORT_PRODUCTS.includes(lot.material) && lot.qualityStatus === 'Released', 'Choose a quality released product lot.');
  checkHistory(s, lot);
  const versions = s.passports.filter(p => p.lotId === lot.id);
  ensure(versions.every(p => !['Draft', 'Under review'].includes(p.status)), 'Finish reviewing the existing draft for this lot.');
  const activity = runActivity(s, lot);
  const electricity = round(activity.reduce((n, row) => n + row.electricity, 0));
  const withdrawal = round(activity.reduce((n, row) => n + row.water, 0));
  const factor = x.factor === '' || x.factor == null ? null : number(x.factor, 'Electricity factor');
  const waterReturn = number(x.waterReturn || '0', 'Qualifying water return');
  const weight = number(x.weight || lot.netKg, 'Reportable mass kg', 0.000001);
  ensure(waterReturn <= withdrawal && (!lot.netKg || weight <= lot.netKg), 'Check the documented water return and lot mass.');
  const hasRecycled = x.preKg !== '' && x.preKg != null || x.postKg !== '' && x.postKg != null;
  const preKg = number(x.preKg || '0', 'Verified pre-consumer kg');
  const postKg = number(x.postKg || '0', 'Verified post-consumer kg');
  ensure(preKg + postKg <= weight, 'Verified recycled mass cannot exceed reportable mass.');
  const p = {
    id: id(s, 'DPP'), lotId: lot.id, token: versions[0]?.token || ctx.publicToken(), version: versions.length + 1,
    date: date(x.date), status: 'Draft', profile: x.profileId ? '' : req(x.profile, 'Draft profile name'),
    weight, electricity, withdrawal, waterReturn, factor, composition: req(x.composition || lot.composition, 'Composition'),
    compositionSource: req(x.compositionSource, 'Composition source'), co2: factor === null ? null : round(electricity * factor / weight),
    water: withdrawal ? round((withdrawal - waterReturn) / weight) : null,
    pre: hasRecycled ? round(100 * preKg / weight) : null, post: hasRecycled ? round(100 * postKg / weight) : null,
    recycled: hasRecycled ? round(100 * (preKg + postKg) / weight) : null, preKg, postKg,
    boundary: req(x.boundary, 'Calculation boundary'), factorRef: clean(x.factorRef), activity,
    calculationVersion: 'HZ-DPP-2', sources: productionSources(s, lot),
    history: [{ state: 'Draft', actor: ctx.actor, at: ctx.at }],
  };
  ensure(factor === null && !withdrawal && !hasRecycled || p.factorRef, 'Record the approved factor, measurement or recycled content evidence.');
  p.points = sourcePoints(s, lot, p);
  if (x.profileId) applyProfile(s, p, x.profileId, p.date);
  s.passports.push(p);
  return p;
}

function editable(s, id) {
  const p = record(s.passports, id, 'passport');
  ensure(p.status === 'Draft', 'Open or create a draft to change its field values.');
  return p;
}

export function applyPassportProfile(s, x, ctx) {
  const p = editable(s, x.passportId);
  applyProfile(s, p, x.profileId, date(x.date));
  p.history.push({ state: 'Profile applied', actor: ctx.actor, at: ctx.at, note: p.profile });
  return p;
}

export function editPoint(s, x, ctx) {
  const p = editable(s, x.passportId);
  const n = Number(x.point);
  ensure(Number.isInteger(n) && n >= 1 && n <= DPP_FIELDS.length && n !== 10, 'Choose an editable passport field.');
  const applicability = choice(x.applicability, APPLICABILITY, 'applicability');
  ensure(!requiredPoint(p, n) || applicability === 'Applicable', 'This is required by HAPZO or the selected product profile.');
  ensure(!p.profileSnapshot?.excludedPoints.some(row => row.number === n) || applicability === 'Not applicable',
    'This point is excluded by the approved profile. Apply an appropriate revision to change it.');
  const value = clean(x.value, 3000);
  const source = clean(x.source, 500);
  const reason = clean(x.reason, 500);
  const visibility = choice(x.visibility, ['Internal', 'Public'], 'visibility');
  const verified = x.verified === 'yes';
  ensure(applicability !== 'Not applicable' || reason, 'Explain why this field is outside the selected profile.');
  ensure(!verified || (applicability === 'Applicable' && value && source), 'Enter the value and evidence source before verification.');
  if (n === 3) ensure(value === p.lotId, 'The batch field must identify the passport source lot.');
  if (verified && n === 1) ensure(validGtin(value), 'Check the GTIN length and check digit.');
  const lot = record(s.lots, p.lotId, 'passport lot');
  if (n === 18 && schemesOf(lot).includes('CMiA Mass Balance')) {
    ensure(visibility === 'Internal' || applicability !== 'Applicable', 'A mass balance credit cannot establish public physical origin.');
  }
  p.points[n - 1] = { number: n, name: DPP_FIELDS[n - 1], applicability, value, source, reason, visibility, verified,
    verifier: verified ? ctx.actor : '', verifiedAt: verified ? ctx.at : '',
    document: ctx.document(x.document, ['passport', 'quality', 'evidence']),
  };
  return p;
}

function validGtin(v) {
  if (!/^(?:\d{8}|\d{12,14})$/.test(v)) return false;
  const charge = [...v.slice(0, -1)].reverse().reduce((n, c, i) => n + Number(c) * (i % 2 ? 1 : 3), 0);
  return (10 - charge % 10) % 10 === Number(v.at(-1));
}

export function assessRemaining(s, x, ctx) {
  const p = editable(s, x.passportId);
  const reason = req(x.reason, 'Profile rationale for the unassessed fields', 500);
  for (const field of p.points.filter(q => q.applicability === 'Unassessed')) {
    Object.assign(field, { applicability: requiredPoint(p, field.number) ? 'Applicable' : 'Not applicable', reason, assessedBy: ctx.actor, assessedAt: ctx.at });
  }
  return p;
}

function changeStatus(p, status, ctx, note = '') {
  p.status = status;
  p.points[9].value = status;
  p.history.push({ state: status, actor: ctx.actor, at: ctx.at, note });
}

export function passportStatus(s, x, ctx) {
  const p = record(s.passports, x.passportId, 'passport');
  if (x.mode === 'Return to draft') {
    ensure(p.status === 'Under review', 'Only a version under review can return to draft.');
    changeStatus(p, 'Draft', ctx, req(x.notes, 'Review feedback'));
    return p;
  }
  if (x.mode === 'Suspend') {
    ensure(p.status === 'Published', 'Choose the active published version.');
    changeStatus(p, 'Suspended', ctx, req(x.notes, 'Suspension reason'));
    return p;
  }
  const submit = x.mode === 'Submit';
  ensure(submit ? p.status === 'Draft' : x.mode === 'Publish' && p.status === 'Under review', 'Review the current passport status before changing it.');
  ensure(p.profileSnapshot, 'Apply an approved product and market profile before passport review or publication.');
  const invalid = p.points.find(f => f.applicability === 'Unassessed' ||
    (f.applicability === 'Applicable' && (!f.verified || !f.value || !f.source)) ||
    (f.applicability === 'Not applicable' && (!f.reason || requiredPoint(p, f.number))));
  ensure(!invalid, invalid ? 'Assess or verify field ' + invalid.number + ' · ' + invalid.name + ' first.' : '');
  const lot = record(s.lots, p.lotId, 'passport lot');
  ensure(lot.qualityStatus === 'Released', 'Passport publication requires an approved source lot.');
  checkHistory(s, lot);
  if (submit) changeStatus(p, 'Under review', ctx);
  else {
    const on = date(x.date);
    const required = schemesOf(lot).filter(scheme => s.policies.some(r => r.scheme === scheme && r.role === 'Processor' && r.operation === 'Passport' && r.effective <= on));
    const context = claimContextForLot(s, lot);
    const subjects = context.lineIds.map(id => ref(s.lines, id)?.sku).filter(Boolean);
    p.claimChecks = [
      ...checkEvidence(s, { schemes: required, role: 'Processor', name: s.settings.name, site: lot.site,
        operation: 'Passport', material: lot.material, on, subject: subjects.length === 1 ? subjects[0] : ref(s.items, lot.itemId)?.code }),
      ...checkClaimRules(s, { ...context, operation: 'Passport', holder: s.settings.name, on }),
    ];
    for (const previous of s.passports.filter(r => r.lotId === p.lotId && r.status === 'Published')) changeStatus(previous, 'Superseded', ctx);
    changeStatus(p, 'Published', ctx);
    p.publishDate = on;
    p.publicSnapshot = {
      version: p.version, published: on, profile: p.profile, batch: lot.id, state: 'Published',
      fields: p.points.filter(q => q.visibility === 'Public' && q.verified && q.applicability === 'Applicable')
        .map(q => ({ number: q.number, name: q.name, value: q.value })),
    };
    p.digest = ctx.digest(p.publicSnapshot);
  }
  return p;
}
