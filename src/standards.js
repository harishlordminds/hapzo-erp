import {
  SCHEMES, MATERIALS, EXTRA_EVIDENCE, id, choice, req, clean, ensure, date, ref, record,
  quantity, round, unique, lock, genealogy, UNITS,
} from './model.js';
import { schemesOf } from './commerce.js';
import { CLAIM_KINDS, CLAIM_POINTS, CLAIM_PROGRAMMES, CLAIM_REVIEW_METHODS, CLAIM_SCOPES, coveredSites, evidenceDecision, same, scopeRefs } from './claim-scope.js';

const points = CLAIM_POINTS;
const evidenceKinds = [...new Set([...Object.values(SCHEMES).flat(), ...EXTRA_EVIDENCE, ...CLAIM_KINDS])];
export const EVIDENCE_KINDS = evidenceKinds;
export const EVIDENCE_ROLES = ['Supplier', 'Processor'];
const operations = (input, required = true) => {
  const values = [...new Set(clean(input, 1800).split(',').map(x => x.trim()).filter(Boolean))];
  ensure((!required || values.length) && values.every(x => points.includes(x)), 'Enter exact operations from the operation catalogue.');
  return values;
};
const readAnnexes = (input, ctx) => [...new Set(clean(input, 2400).split(',').map(value => value.trim()).filter(Boolean))]
  .map(key => ctx.document(key, ['evidence'], true));
export function schemeNames(s) {
  return [...new Set([...Object.keys(SCHEMES), ...s.policies.map(p => p.scheme)])];
}
export const evidenceProgrammes = s => [...new Set([...schemeNames(s), ...Object.keys(CLAIM_PROGRAMMES), ...s.claimRules.map(rule => rule.scheme)])]
  .filter(name => name !== 'Conventional');

export function addPolicy(s, x, ctx) {
  const scheme = req(x.scheme, 'Scheme', 100);
  ensure(scheme !== 'Conventional', 'Choose a scheme other than Conventional.');
  const role = choice(x.role, EVIDENCE_ROLES, 'rule role');
  const operation = choice(x.operation, points, 'lock point');
  const version = req(x.version, 'Rule revision', 80);
  const effective = date(x.effective);
  const kinds = [...new Set(clean(x.kinds, 600).split(',').map(v => v.trim()).filter(Boolean))];
  ensure(kinds.length && kinds.every(k => evidenceKinds.includes(k)), 'Enter evidence types from the catalogue.');
  ensure(!s.policies.some(r => r.scheme === scheme && r.role === role && r.operation === operation && r.effective === effective), 'A rule for this lock point is already effective on that date.');
  const row = {
    id: id(s, 'RULE'), scheme, role, operation, version, effective, kinds, allowCoveringScope: x.allowCoveringScope === 'yes',
    reference: req(x.reference, 'Approved rule source or clause'), actor: ctx.actor,
  };
  s.policies.push(row);
  return row;
}

export function addEvidence(s, x, ctx) {
  const scheme = choice(x.scheme, evidenceProgrammes(s), 'scheme');
  const kind = choice(x.kind, evidenceKinds, 'evidence type');
  const scopeType = x.scopeType ? choice(x.scopeType, CLAIM_SCOPES, 'coverage type') : '';
  const scoped = Boolean(scopeType);
  ensure(scoped || schemeNames(s).includes(scheme), 'Select the exact coverage type for this programme.');
  const role = choice(x.role, EVIDENCE_ROLES, 'evidence role');
  const owner = x.partyId ? record(s.parties, x.partyId, 'party') : null;
  ensure(!owner || owner.type === role, 'The selected party does not match this evidence role.');
  const cert = ['Scope certificate', 'Article certificate', 'Transaction certificate', 'Subcontractor annex', 'Chemical approval',
    'Product certificate', 'Facility certificate', 'Licence', 'Material Health certificate'].includes(kind);
  const issue = x.issue ? date(x.issue) : '';
  const from = x.from ? date(x.from) : issue;
  const until = x.until ? date(x.until) : '';
  ensure(scoped || !cert || (issue && until), 'Enter the issue and expiry dates for this document.');
  ensure(!until || ((!issue || until >= issue) && (!from || until >= from)), 'Expiry must follow its issue and start dates.');
  const covers = [...new Set(clean(x.materials, 1000).split(',').map(x => x.trim()).filter(Boolean))];
  ensure(covers.every(material => MATERIALS.includes(material) || material === '*'), 'Use exact material types or * for all materials explicitly covered.');
  ensure(scoped || covers.length > 0, 'Identify the covered material or article types.');
  const limited = kind === 'Transaction certificate';
  const unit = limited ? choice(x.unit, UNITS, 'evidence unit') : '';
  const number = req(x.number, 'Document, registration or declaration number');
  const issuer = cert ? req(x.issuer, 'Issuing certification body') : clean(x.issuer);
  const tx = limited ? transactionEvidence(x) : null;
  if (limited) ensure(!s.evidence.some(e => e.scheme === scheme && e.kind === kind && same(e.number, number) && same(e.issuer, issuer)),
    'This transaction certificate is already registered. Use its remaining eligible quantity.');
  const site = scoped && scopeType !== 'Facility' ? clean(x.site, 400) : req(x.site, 'Covered site', 400);
  const refs = scopeRefs(x.scopeRefs);
  if (scopeType === 'Facility' && !refs.length) refs.push(site);
  const holder = owner?.name || req(x.party, 'Certificate holder');
  if (scopeType === 'Company' && !refs.length) refs.push(holder);
  ensure(!scoped || refs.length, 'Enter the exact product, component or chemical identifiers covered by this evidence.');
  const requiredSites = coveredSites(x.requiredSites);
  ensure(kind !== 'Supply-chain confirmation' || requiredSites.length > 0, 'Identify the facilities requiring verification for this supply-chain confirmation.');
  const covering = x.coveringCertificateId ? record(s.evidence, x.coveringCertificateId, 'main scope certificate') : null;
  ensure(!covering || kind === 'Subcontractor annex' && covering.scheme === scheme && covering.kind === 'Scope certificate' &&
    same(covering.party, holder) && requiredSites.length, 'Link the verified holder’s main scope certificate and the actual subcontractor facilities for this annex.');
  const annexes = readAnnexes(x.annex, ctx);
  const row = {
    id: id(s, 'EV'), scheme, kind, role, partyId: owner?.id || '',
    party: holder, site, number, issuer, issue, from, until,
    operations: operations(x.operations, !scoped), materials: covers, status: 'Pending verification',
    scoped, scopeType, scopeRefs: refs, requiredSites, programmeVersion: clean(x.programmeVersion, 100), criteria: clean(x.criteria, 300),
    scopeText: clean(x.scopeText, 8000), analysisWarnings: clean(x.analysisWarnings, 8000), annexRequired: x.annexRequired === 'yes', tx,
    coveringCertificateId: covering?.id || '',
    notes: clean(x.notes, 5000), document: ctx.document(x.document, ['evidence']),
    annex: annexes[0] || null, annexes, reviewHistory: [], capacity: limited ? quantity(x.capacity, 'Eligible quantity', unit) : null,
    used: 0, unit,
  };
  s.evidence.push(row);
  return row;
}

export function reviewEvidence(s, x, ctx) {
  const evidence = record(s.evidence, x.evidenceId, 'evidence');
  const status = choice(x.status, ['Verified', 'Withdrawn', 'Scope mismatch', 'Pending verification'], 'verification decision');
  const source = req(x.source, 'Verification source, lookup or issuer confirmation', 800);
  ensure(status !== 'Verified' || x.scopeConfirmed === 'yes', 'Confirm the issuer, matching site and scope before verifying.');
  const method = x.method ? choice(x.method, CLAIM_REVIEW_METHODS, 'verification method') : '';
  const on = date(x.verifiedOn, ctx.at.slice(0, 10));
  const notes = clean(x.reviewNotes, 4000);
  const annexes = [...new Map([...(evidence.annexes ?? (evidence.annex ? [evidence.annex] : [])), ...readAnnexes(x.annex, ctx)]
    .map(document => [document.id, document])).values()];
  if (status === 'Verified') {
    ensure(!evidence.analysisWarnings || notes, 'Record how the extraction flags were resolved before verifying.');
    ensure(!evidence.annexRequired || annexes.length, 'Upload the referenced annexes before verifying this evidence.');
    if (evidence.scoped) {
      ensure(method, 'Record how the reviewer verified this evidence.');
      const issuerVerification = ['Official lookup', 'Issuer confirmation'].includes(method);
      ensure(!evidence.issuer || issuerVerification, 'Use the official lookup or issuer confirmation for an issuer document.');
      ensure(evidence.kind !== 'Product ID' || issuerVerification, 'Confirm the Product ID through the official lookup or issuer.');
      ensure(evidence.kind !== 'Supply-chain confirmation' || issuerVerification, 'Confirm the supplied chain through the official programme or issuer.');
    }
    if (evidence.kind === 'Transaction certificate' && !evidence.tx) evidence.tx = transactionEvidence(x);
  }
  evidence.status = status;
  evidence.source = source;
  evidence.annexes = annexes;
  evidence.annex = annexes[0] ?? null;
  evidence.reviewHistory.push({ status, source, method, on, notes, actor: ctx.actor, at: ctx.at });
  return evidence;
}

function ruleAt(s, scheme, role, operation, on) {
  return s.policies.filter(r => r.scheme === scheme && r.role === role && r.operation === operation && r.effective <= on)
    .sort((a, b) => b.effective.localeCompare(a.effective))[0];
}

function transactionEvidence(x) {
  return { seller: req(x.txSeller, 'Transaction seller'), buyer: req(x.txBuyer, 'Transaction buyer'),
    shipment: req(x.txShipment, 'Transaction shipment reference'), material: req(x.txMaterial, 'Exact transaction material code') };
}

function withinDates(evidence, date) {
  return (!evidence.from || evidence.from <= date) && (!evidence.until || evidence.until >= date);
}

function eligibleTransaction(s, evidence, { tx, amount, unit, subject }) {
  if (evidence.capacity == null) return true;
  if (!tx || !evidence.tx || !subject || !same(evidence.tx.material, subject) || amount == null || evidence.unit !== unit ||
    !['seller', 'buyer', 'shipment'].every(key => same(evidence.tx[key], tx[key]))) return false;
  const group = s.evidence.filter(row => row.capacity != null && row.kind === evidence.kind && row.scheme === evidence.scheme &&
    same(row.number, evidence.number) && same(row.issuer, evidence.issuer));
  return round(Math.min(...group.map(row => row.capacity)) - group.reduce((n, row) => n + row.used, 0)) >= amount;
}

function applicableHolder(s, evidence, rule, { name, partyId, site, operation, material, on }) {
  if (evidence.coveringCertificateId) {
    const main = ref(s.evidence, evidence.coveringCertificateId);
    return rule?.allowCoveringScope && main?.status === 'Verified' && withinDates(main, on) &&
      main.operations.includes(operation) && (main.materials.includes(material) || main.materials.includes('*')) &&
      evidence.requiredSites.some(row => same(row.holder, name) && same(row.site, site) && row.operation === operation);
  }
  return evidence.partyId ? evidence.partyId === partyId : same(evidence.party, name);
}

export function checkEvidence(s, { schemes, role, partyId, name, site, operation, material, on, amount, unit, consume = false, tx, planning = false, subject }) {
  const results = [];
  for (const scheme of schemes) {
    const rule = ruleAt(s, scheme, role, operation, on);
    const defaultKinds = SCHEMES[scheme] ?? [];
    // Built-in rules are scope checks. Configure mandatory transaction documents per lock point.
    const groups = rule ? rule.kinds.filter(kind => !planning || kind !== 'Transaction certificate').map(kind => [kind]) : [defaultKinds];
    const evidence = [];
    const placement = { name, partyId, site, operation, material, on };
    for (const kinds of groups) {
      const selected = s.evidence.find(e =>
        e.scheme === scheme && e.role === role && e.status === 'Verified' && kinds.includes(e.kind) &&
        applicableHolder(s, e, rule, placement) && (e.coveringCertificateId || same(e.site, site)) &&
        e.operations.includes(operation) && (e.materials.includes(material) || e.materials.includes('*')) &&
        (scheme !== 'OEKO-TEX STANDARD 100' || e.scoped && subject && e.scopeRefs.some(value => same(value, subject))) &&
        withinDates(e, on) && eligibleTransaction(s, e, { tx, amount, unit, subject }),
      );
      if (!selected) {
        // Name the verified certificate that exists for this holder and site but does not cover the operation or material.
        const near = s.evidence.find(e => e.scheme === scheme && e.role === role && e.status === 'Verified' && kinds.includes(e.kind) &&
          (e.partyId ? e.partyId === partyId : same(e.party, name)) && same(e.site, site) && withinDates(e, on));
        const gap = near ? (!near.operations.includes(operation) ? ' Verified ' + near.kind.toLowerCase() + ' ' + near.number + ' for this site covers ' + near.operations.join(', ') + ' but not ' + operation + '.'
          : !near.materials.includes(material) && !near.materials.includes('*') ? ' Verified ' + near.number + ' covers ' + near.materials.join(', ') + ' but not ' + material + '.' : '') : '';
        lock(false, scheme + ' requires verified ' + (kinds.join(' or ') || 'configured') + ' evidence for ' + name + ' at ' + site + ' / ' + operation + ' / ' + material + ' on ' + on + '.' + gap);
      }
      evidence.push(evidenceDecision(selected));
      if (selected.coveringCertificateId) evidence.push(evidenceDecision(ref(s.evidence, selected.coveringCertificateId)));
    }
    results.push({ scheme, evidence, rule: rule?.id || 'Local scope check', version: rule?.version || '1', operation, on });
  }
  if (consume) for (const decision of results) for (const item of decision.evidence) {
    const selected = ref(s.evidence, item.id);
    if (selected.capacity != null) selected.used = round(selected.used + amount);
  }
  return results;
}

export function checkSupply(s, scheme, party, site, material, on, subject) {
  return checkEvidence(s, { schemes: scheme === 'Conventional' ? [] : [scheme], role: 'Supplier', partyId: party.id, name: party.name, site, operation: 'Supply', material, on, subject, planning: true });
}

export function checkHistory(s, lot) {
  for (const node of [lot, ...genealogy(s, lot.id)]) {
    lock(!node.standardHold, 'Lot ' + node.id + ' is on hold. ' + (node.holdReason ?? ''));
    for (const decision of node.checks ?? []) {
      for (const item of decision.evidence ?? []) {
        lock(ref(s.evidence, item.id)?.status === 'Verified', 'Evidence ' + item.number + ' used for lot ' + node.id + ' is no longer verified.');
      }
    }
  }
}

export function checkLotClaims(s, lot, needed, auxiliary = false) {
  checkHistory(s, lot);
  const actual = schemesOf(lot);
  const applicable = auxiliary ? needed.filter(n => ruleAt(s, n, 'Supplier', 'Supply', lot.date)) :
    needed.filter(n => n !== 'CMiA Mass Balance');
  lock(applicable.every(name => actual.includes(name)), 'Lot ' + lot.id + ' is ineligible for ' + applicable.filter(n => !actual.includes(n)).join(', ') + '.');
}

export function addCredit(s, x, ctx) {
  const evidence = record(s.evidence, x.evidenceId, 'tracker evidence');
  lock(evidence.scheme === 'CMiA Mass Balance' && evidence.kind === 'Registration / tracker' && evidence.status === 'Verified',
    'Add and verify the CMiA tracker evidence first.');
  const reference = req(x.reference, 'Eligible purchase or tracker transaction');
  unique(s.credits, 'reference', reference, 'This tracker credit has already been recorded.');
  const day = date(x.date);
  lock((!evidence.from || evidence.from <= day) && (!evidence.until || evidence.until >= day), 'Tracker evidence does not cover the credit date.');
  const quantityKg = quantity(x.qty, 'Eligible kilograms', 'kg');
  const row = { id: id(s, 'CR'), qty: quantityKg, used: 0, reference, evidenceId: evidence.id, date: day, actor: ctx.actor };
  s.credits.push(row);
  return row;
}

export function useCredits(s, kg, on) {
  let rest = quantity(kg, 'Declared claim kilograms', 'kg');
  const applied = [];
  for (const credit of s.credits.filter(c => c.date <= on && ref(s.evidence, c.evidenceId)?.status === 'Verified')) {
    const take = Math.min(rest, round(credit.qty - credit.used));
    if (take <= 0) continue;
    credit.used = round(credit.used + take);
    rest = round(rest - take);
    applied.push({ id: credit.id, kg: take, evidenceId: credit.evidenceId });
  }
  lock(rest === 0, 'Insufficient verified CMiA Mass Balance volume for this shipment (short ' + rest + ' kg).');
  return applied;
}
