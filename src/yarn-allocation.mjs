// Allocates yarn to a specific downstream use: warp (warping or weaving), weft (weaving) or knitting.
// An allocation holds the quantity for that work order; production enforces it when the yarn is issued.
import { req, choice, quantity, date, id, record, ensure, round, sum } from './model.mjs';
import { post, usable } from './stock.mjs';

export const YARN_ROLES = { Warp: ['Warping', 'Weaving'], Weft: ['Weaving'], Knitting: ['Knitting'] };
const open = a => round(a.qty - a.used);
export const openAssignments = (lot, except = '') => (lot.assignments ?? []).filter(a => open(a) > 0 && a.workOrderId !== except);

export function assignYarn(s, x, ctx) {
  const mode = choice(x.mode ?? 'Assign', ['Assign', 'Release'], 'yarn allocation action');
  const lot = record(s.lots, x.lotId, 'yarn lot');
  ensure(['Yarn', 'Dyed yarn'].includes(lot.material), 'Allocate yarn or dyed yarn lots only.');
  const wo = record(s.workOrders, x.workOrderId, 'work order');
  ensure(['Released', 'In progress'].includes(wo.status), 'Choose an open work order.');
  const role = choice(x.role, Object.keys(YARN_ROLES), 'yarn use');
  ensure(YARN_ROLES[role].includes(wo.stage), role + ' yarn goes to ' + YARN_ROLES[role].join(' or ') + ' work orders, not ' + wo.stage + '.');
  const day = date(x.date);
  const qty = quantity(x.qty, 'Allocated quantity', lot.unit);
  lot.assignments ??= [];
  if (mode === 'Release') {
    const mine = lot.assignments.filter(a => a.workOrderId === wo.id && a.role === role && open(a) > 0);
    ensure(qty <= sum(mine, open), 'Release exceeds the open ' + role.toLowerCase() + ' allocation of ' + lot.id + ' to ' + wo.number + '.');
    let left = qty;
    for (const a of mine) {
      const take = Math.min(left, open(a));
      a.qty = round(a.qty - take);
      left = round(left - take);
    }
  } else {
    usable(s, lot, day);
    ensure(lot.site === wo.site, 'Transfer ' + lot.id + ' to ' + wo.site + ' before allocating it.');
    ensure(!lot.assignments.some(a => a.workOrderId === wo.id && a.role !== role && open(a) > 0), lot.id + ' is already allocated to ' + wo.number + ' for another use.');
    const held = sum(openAssignments(lot), open);
    ensure(round(held + qty) <= lot.qty, 'Only ' + round(lot.qty - held) + ' ' + lot.unit + ' of ' + lot.id + ' is unallocated.');
    lot.assignments.push({ id: id(s, 'YAL'), workOrderId: wo.id, workOrder: wo.number, stage: wo.stage, role, qty, used: 0, date: day, reference: req(x.reference, 'Allocation reference') });
  }
  return post(s, mode === 'Release' ? 'Yarn allocation release' : 'Yarn allocation', ctx, {
    date: day, output: lot.id, workOrderId: wo.id, role, qty, unit: lot.unit, reference: x.reference || '',
  });
}

// Called for each primary input at production. Allocated yarn can only be used by its work order and role.
export function useAssignments(s, wo, lot, qty) {
  const all = (lot.assignments ?? []).filter(a => open(a) > 0);
  if (!all.length) return;
  const mine = all.filter(a => a.workOrderId === wo.id);
  if (mine.length) {
    const role = mine[0].role;
    ensure(YARN_ROLES[role].includes(wo.stage), lot.id + ' is allocated as ' + role.toLowerCase() + ' yarn and cannot be used at ' + wo.stage + '.', 422, 'yarn-allocation');
    ensure(qty <= round(sum(mine, open) + Math.max(0, lot.qty - sum(all, open))),
      'Issue of ' + lot.id + ' exceeds its ' + role.toLowerCase() + ' allocation to ' + wo.number + ' and the unallocated balance.', 422, 'yarn-allocation');
    let left = qty;
    for (const a of mine) {
      const take = Math.min(left, open(a));
      a.used = round(a.used + take);
      left = round(left - take);
    }
    return;
  }
  const held = sum(all, open);
  ensure(qty <= round(lot.qty - held), lot.id + ' is allocated to ' + [...new Set(all.map(a => a.workOrder + ' (' + a.role.toLowerCase() + ')'))].join(', ') +
    '. Only ' + round(lot.qty - held) + ' ' + lot.unit + ' is free for ' + wo.number + '.', 422, 'yarn-allocation');
}
