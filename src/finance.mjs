import { choice, clean, csvLines, date, ensure, id, norm, number as num, record, ref, req } from './model.mjs';
import { lotCost } from './fulfilment.mjs';

export const ACCOUNT_GROUPS = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];
export const LEDGER_GROUPS = {
  'Cash-in-hand': 'Asset', 'Bank Accounts': 'Asset', 'Sundry Debtors': 'Asset', 'Stock-in-Hand': 'Asset',
  'Fixed Assets': 'Asset', 'GST Input Credit': 'Asset', 'Deposits and Advances': 'Asset', 'Other Assets': 'Asset',
  'Sundry Creditors': 'Liability', 'Duties and Taxes': 'Liability', 'Loans and Borrowings': 'Liability', 'Other Liabilities': 'Liability',
  'Capital Account': 'Equity', 'Reserves and Surplus': 'Equity',
  'Sales Accounts': 'Income', 'Direct Income': 'Income', 'Indirect Income': 'Income',
  'Purchase Accounts': 'Expense', 'Direct Expenses': 'Expense', 'Indirect Expenses': 'Expense',
};
const fallbackGroups = {
  Asset: 'Other Assets', Liability: 'Other Liabilities', Equity: 'Capital Account', Income: 'Indirect Income', Expense: 'Indirect Expenses',
};
const controlGroups = new Set(['Sundry Debtors', 'Sundry Creditors']);
const controls = new Set(['AR', 'AP']);
const openingGroups = new Set(['Asset', 'Liability', 'Equity']);
export const ACCOUNTS = [
  ['CASH', 'Cash in hand', 'Cash-in-hand'], ['BANK', 'Bank account', 'Bank Accounts'],
  ['AR', 'Trade receivables', 'Sundry Debtors'], ['STOCK', 'Inventory', 'Stock-in-Hand'], ['ITC', 'GST input credit', 'GST Input Credit'],
  ['AP', 'Trade payables', 'Sundry Creditors'], ['GSTOUT', 'GST output payable', 'Duties and Taxes'], ['CAPITAL', 'Capital', 'Capital Account'],
  ['SALES', 'Sales', 'Sales Accounts'], ['OTHERINC', 'Other income', 'Indirect Income'], ['COGS', 'Cost of goods sold', 'Direct Expenses'],
  ['JOB', 'Job work expense', 'Direct Expenses'], ['FREIGHT', 'Freight expense', 'Direct Expenses'],
  ['GENERAL', 'General expenses', 'Indirect Expenses'], ['FX', 'Exchange difference', 'Indirect Expenses'],
].map(([code, name, ledgerGroup]) => ({ id: code, code, name, group: LEDGER_GROUPS[ledgerGroup], ledgerGroup }));
const systemAccounts = new Map(ACCOUNTS.map(account => [account.id, account]));
export const ledgerGroupOf = account => account.ledgerGroup || systemAccounts.get(account.id)?.ledgerGroup || fallbackGroups[account.group] || account.group;
export const isCashLedger = account => Boolean(account && ['Cash-in-hand', 'Bank Accounts'].includes(ledgerGroupOf(account)));
export const book = s => ({ charts: s.accounts.length ? s.accounts : ACCOUNTS, vouchers: s.vouchers, parties: s.parties, invoices: s.invoices });

function initBook(s) {
  if (!s.accounts.length) s.accounts = structuredClone(ACCOUNTS);
  return book(s);
}

function paise(value, label) {
  const raw = String(value ?? '').trim();
  ensure(/^\d+(?:\.\d{1,2})?$/.test(raw), label + ' must have up to two decimal places.');
  const [whole, fraction = ''] = raw.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  ensure(Number.isSafeInteger(result), label + ' exceeds the supported amount.');
  return result;
}

function accountGroup(input) {
  const ledgerGroup = Object.hasOwn(fallbackGroups, input) ? fallbackGroups[input] : input;
  ensure(Object.hasOwn(LEDGER_GROUPS, ledgerGroup), 'Choose a valid ledger group.');
  return ledgerGroup;
}

function uniqueLedgerName(b, name, except = '') {
  ensure(!b.charts.some(account => account.id !== except && norm(account.name) === norm(name)), 'A ledger already uses this name.');
}

export function newAccount(s, x) {
  const b = initBook(s);
  const code = req(x.code, 'Ledger code').toUpperCase();
  const name = req(x.name, 'Ledger name');
  const ledgerGroup = accountGroup(x.ledgerGroup || x.group);
  ensure(/^[A-Z0-9_-]{1,20}$/.test(code), 'Use up to 20 letters, numbers, underscores or hyphens for the ledger code.');
  ensure(!ref(b.charts, code), 'A ledger already uses this code.');
  ensure(!controlGroups.has(ledgerGroup), 'Use a buyer or supplier party ledger for debtors and creditors.');
  uniqueLedgerName(b, name);
  const account = { id: code, code, name, group: LEDGER_GROUPS[ledgerGroup], ledgerGroup };
  s.accounts.push(account);
  return account;
}

export function editAccount(s, x) {
  const b = initBook(s);
  const account = record(b.charts, x.ledgerId, 'ledger');
  const ledgerGroup = accountGroup(x.ledgerGroup || x.group || ledgerGroupOf(account));
  const name = req(x.name, 'Ledger name');
  if (ledgerGroup !== ledgerGroupOf(account)) {
    ensure(!systemAccounts.has(account.id) && !b.vouchers.some(v => v.lines.some(line => line.a === account.id)),
      'Change the group of an unused custom ledger. Use a journal transfer to reclassify a posted balance.');
    ensure(!controlGroups.has(ledgerGroup), 'Use a buyer or supplier party ledger for debtors and creditors.');
  }
  uniqueLedgerName(b, name, account.id);
  Object.assign(account, { name, group: LEDGER_GROUPS[ledgerGroup], ledgerGroup });
  return account;
}

const debit = (a, amount) => ({ a, d: amount, c: 0 });
const credit = (a, amount) => ({ a, d: 0, c: amount });
const voucherInput = x => ({ number: x.number, date: x.date, note: x.note });

function postVoucher(s, x, lines, ctx) {
  const b = initBook(s);
  const number = req(x.number, 'Voucher number');
  const day = date(x.date);
  ensure(!b.vouchers.some(v => norm(v.number) === norm(number)), 'Voucher number already posted.');
  const rows = lines.filter(row => row.d || row.c);
  ensure(rows.length >= 2 && rows.every(row => ref(b.charts, row.a) && Number.isSafeInteger(row.d) && Number.isSafeInteger(row.c) &&
    row.d >= 0 && row.c >= 0 && Boolean(row.d) !== Boolean(row.c)), 'Each voucher line requires one debit or credit and a valid ledger.');
  const total = rows.reduce((sum, row) => sum + row.d, 0);
  ensure(Number.isSafeInteger(total) && total > 0 && total === rows.reduce((sum, row) => sum + row.c, 0), 'Debits and credits must match.');
  const voucher = {
    id: id(s, 'VCH'), number, date: day, type: x.type, party: clean(x.party, 200), partyId: x.partyId || '', note: clean(x.note, 5000),
    source: x.source || null, against: x.against || null, reverses: x.reverses || null,
    currency: x.currency || 'INR', rate: x.rate || 1, documentAmount: x.documentAmount ?? null,
    ...(x.due ? { due: x.due } : {}), ...(x.documentDate ? { documentDate: x.documentDate } : {}),
    ...(x.allocations ? { allocations: x.allocations } : {}),
    ...(ctx ? { postedBy: ctx.actor, postedAt: ctx.at } : {}), lines: rows, total,
  };
  b.vouchers.push(voucher);
  return voucher;
}

export function activeAt(b, voucher, asOf = '9999-12-31') {
  return voucher.date <= asOf && !b.vouchers.some(row => row.reverses === voucher.id && row.date <= asOf);
}

const overlapsPosting = (b, voucher, from) => activeAt(b, voucher, voucher.date > from ? voucher.date : from);

export const billSide = voucher => ['Sales', 'Opening receivable'].includes(voucher.type) ? 'AR' :
  ['Purchase', 'Opening payable'].includes(voucher.type) ? 'AP' : '';

export function settlementAllocations(voucher) {
  return voucher.allocations ?? (voucher.against ? [{ billId: voucher.against, amount: voucher.total }] : []);
}

function partyMatches(b, control, name) {
  return (b.parties ?? []).filter(party => (party.type === 'Buyer') === (control === 'AR') &&
    [party.name, ...(party.history ?? []).map(row => row.name)].some(value => norm(value) === norm(name)));
}

function partyForBill(b, x, control) {
  if (x.partyId) {
    const party = record(b.parties, x.partyId, 'party');
    ensure((party.type === 'Buyer') === (control === 'AR'), control === 'AR' ? 'Choose a buyer for a receivable.' : 'Choose a supplier or processor for a payable.');
    return { party: party.name, partyId: party.id };
  }
  const name = req(x.party, 'Party');
  const matches = partyMatches(b, control, name);
  ensure(matches.length < 2, 'More than one party uses this name. Select the party master.');
  return { party: name, partyId: matches[0]?.id || '' };
}

const partyKey = (control, id, name) => control + (id ? ':party:' + id : ':name:' + norm(name));

export function partyLedgerKey(b, voucher) {
  const control = voucher.lines.find(line => controls.has(line.a))?.a;
  if (!control || !voucher.party && !voucher.partyId) return '';
  const matches = voucher.partyId ? [] : partyMatches(b, control, voucher.party);
  const key = voucher.partyId || (matches.length === 1 ? matches[0].id : '');
  return partyKey(control, key, voucher.party);
}

export function partyLedgers(b) {
  const result = new Map((b.parties ?? []).map(party => {
    const account = party.type === 'Buyer' ? 'AR' : 'AP';
    const key = partyKey(account, party.id, party.name);
    return [key, { id: key, name: party.name, code: party.code, account, ledgerGroup: account === 'AR' ? 'Sundry Debtors' : 'Sundry Creditors' }];
  }));
  for (const voucher of b.vouchers) {
    const key = partyLedgerKey(b, voucher);
    if (!key || result.has(key)) continue;
    const account = key.slice(0, 2);
    result.set(key, { id: key, name: voucher.party, code: '', account, ledgerGroup: account === 'AR' ? 'Sundry Debtors' : 'Sundry Creditors' });
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function uniqueBill(b, control, identity, reference, day) {
  const key = partyKey(control, identity.partyId, identity.party);
  ensure(!b.vouchers.some(v => billSide(v) === control && norm(v.source?.reference) === norm(reference) && partyLedgerKey(b, v) === key && overlapsPosting(b, v, day)),
    'This party document already has an active voucher.');
}

export function accountingInvoice(s, x, ctx) {
  const b = initBook(s);
  const isSale = choice(x.kind, ['Sales', 'Purchase'], 'bill type') === 'Sales';
  const row = isSale ? record(s.invoices, x.sourceId, 'issued invoice') : record(s.costs, x.sourceId, 'posted charge');
  const receipt = isSale ? null : s.events.find(event => event.kind === 'Goods receipt' && event.output === row.lot);
  ensure(isSale || receipt || row.supplier, 'Select a charge with a supplier or linked receipt.');
  const partyId = isSale ? row.buyerId : row.supplierId || ref(s.lots, row.lot)?.partyId;
  const party = req(isSale ? row.customer : row.supplier || receipt?.party, isSale ? 'Buyer' : 'Supplier');
  const master = ref(b.parties, partyId);
  const control = isSale ? 'AR' : 'AP';
  const fallbacks = partyMatches(b, control, party);
  const identity = { party, partyId: master && (master.type === 'Buyer') === isSale ? master.id : fallbacks.length === 1 ? fallbacks[0].id : '' };
  const docNumber = isSale ? row.number : row.reference;
  const source = { type: isSale ? 'Sales invoice' : row.washBatchId ? 'Wash service' : row.embroideryBatchId ? 'Embroidery service' : 'Receipt cost', id: row.id, reference: docNumber };
  if (!isSale && (row.washBatchId || row.embroideryBatchId)) Object.assign(source, {
    ...(row.washBatchId ? { washBatchId: row.washBatchId } : { embroideryBatchId: row.embroideryBatchId }),
    challan: row.challan, jobId: row.jobId, returnEventId: row.returnEventId,
  });
  const day = date(x.date);
  ensure(!row.date || day >= row.date, 'Voucher date cannot precede the source document.');
  ensure(!b.vouchers.some(v => v.source?.type === source.type && v.source.id === source.id && overlapsPosting(b, v, day)), 'This source already has an active voucher.');
  uniqueBill(b, control, identity, docNumber, day);
  const docDate = row.date || day;
  const due = date(isSale ? row.due : x.due, docDate);
  ensure(due >= docDate, 'Due date cannot precede the bill date.');
  const currency = row.currency;
  const net = paise(row.net, 'Bill value');
  const tax = paise(isSale ? row.tax : row.gst, 'GST');
  const recoverable = isSale ? tax : paise(row.credit, 'Recoverable GST');
  const rate = currency === 'INR' ? 1 : num(isSale ? x.rate : row.rate ?? x.rate, 'INR conversion rate', 0.000001);
  const total = Math.round((net + tax) * rate);
  const gst = Math.round(recoverable * rate);
  const stock = isSale ? 0 : paise(row.landed, 'Landed value');
  ensure(isSale || stock <= total - gst, 'Allocated inventory cost exceeds cost of the charge.');
  const lines = isSale ? [debit('AR', total), credit('SALES', total - gst), credit('GSTOUT', gst)] :
    [debit('STOCK', stock), debit('ITC', gst), debit('GENERAL', total - gst - stock), credit('AP', total)];
  return postVoucher(s, { number: x.number || (isSale ? 'S-' : 'P-') + docNumber, date: day, type: x.kind,
    ...identity, source, currency, rate, due, documentDate: docDate, documentAmount: net + tax }, lines, ctx);
}

export function manualBill(s, x, ctx) {
  const b = initBook(s);
  const sale = choice(x.kind, ['Sales', 'Purchase'], 'bill type') === 'Sales';
  const control = sale ? 'AR' : 'AP';
  const identity = partyForBill(b, x, control);
  const reference = req(x.reference, 'Document reference');
  const day = date(x.date);
  const documentDate = date(x.documentDate, day);
  const due = date(x.due, documentDate);
  ensure(documentDate <= day && due >= documentDate, 'Use a bill date on or before the voucher date and a due date on or after the bill date.');
  const tax = paise(x.tax || '0', 'GST');
  const net = paise(x.net, 'Taxable value');
  const total = tax + net;
  const recoverable = sale ? tax : paise(x.recoverable || '0', 'Recoverable GST');
  ensure(recoverable <= tax, 'Recoverable GST cannot exceed tax charged.');
  uniqueBill(b, control, identity, reference, day);
  const ledger = ref(b.charts, x.ledger);
  ensure(ledger && (sale ? ledger.group === 'Income' : ['Expense', 'Asset'].includes(ledger.group) &&
    !controls.has(ledger.id) && !isCashLedger(ledger) && ledger.id !== 'ITC'), 'Select an eligible bill ledger.');
  const lines = sale ? [debit('AR', total), credit(ledger.id, net), credit('GSTOUT', tax)] :
    [debit(ledger.id, total - recoverable), debit('ITC', recoverable), credit('AP', total)];
  return postVoucher(s, { ...voucherInput(x), ...identity, date: day, due, documentDate, type: x.kind,
    source: { type: 'Manual bill', id: null, reference }, documentAmount: total }, lines, ctx);
}

function journalLines(entries, label) {
  return csvLines(entries, label, 3).map(([code, d, c]) => ({ a: code.toUpperCase(), d: paise(d || '0', 'Debit'), c: paise(c || '0', 'Credit') }));
}

export function recordOpening(s, x, ctx) {
  const b = initBook(s);
  const day = date(x.date);
  const rows = journalLines(x.entries, 'Opening balances').filter(row => row.d || row.c);
  const codes = new Set(rows.map(row => row.a));
  ensure(rows.length === codes.size, 'Enter each ledger once in an opening balance voucher.');
  ensure(rows.every(row => !controls.has(row.a) && openingGroups.has(ref(b.charts, row.a)?.group)),
    'Use balance sheet ledgers here. Enter receivable and payable bills in Opening party bill.');
  ensure(!b.vouchers.some(v => v.type === 'Opening balance' && overlapsPosting(b, v, day) && v.lines.some(row => codes.has(row.a))),
    'An opening voucher already includes one of these ledgers. Reverse it before replacing those opening amounts.');
  return postVoucher(s, { ...voucherInput(x), date: day, type: 'Opening balance' }, rows, ctx);
}

export function openingBill(s, x, ctx) {
  const b = initBook(s);
  const type = choice(x.kind, ['Opening receivable', 'Opening payable'], 'opening bill type');
  const control = billSide({ type });
  const identity = partyForBill(b, x, control);
  const reference = req(x.reference, 'Original bill reference');
  const openingDate = date(x.date);
  const documentDate = date(x.documentDate, openingDate);
  const due = date(x.due, documentDate);
  ensure(documentDate <= openingDate && due >= documentDate, 'Use an original bill date on or before the opening date and a due date on or after the bill date.');
  const offset = record(b.charts, x.ledger || 'CAPITAL', 'opening equity ledger');
  ensure(offset.group === 'Equity', 'Use an equity ledger to balance the opening bill.');
  uniqueBill(b, control, identity, reference, openingDate);
  const amount = paise(x.amount, 'Outstanding opening amount');
  const entries = control === 'AR' ? [debit('AR', amount), credit(offset.id, amount)] : [debit(offset.id, amount), credit('AP', amount)];
  return postVoucher(s, { ...voucherInput(x), ...identity, date: openingDate, type, due, documentDate,
    source: { type: 'Opening bill', id: null, reference } }, entries, ctx);
}

function relatedSettlements(b, billId) {
  return b.vouchers.flatMap(v => {
    if (v.reverses) return [];
    const row = settlementAllocations(v).find(allocation => allocation.billId === billId);
    return row ? [{ voucher: v, amount: row.amount }] : [];
  });
}

export function settlementTotal(b, v, asOf = '9999-12-31') {
  return relatedSettlements(b, v.id).reduce((sum, row) => sum + (activeAt(b, row.voucher, asOf) ? row.amount : 0), 0);
}

export function availableToApply(b, bill, day) {
  const changes = new Map();
  const add = (on, amount) => changes.set(on, (changes.get(on) ?? 0) + amount);
  for (const { voucher, amount } of relatedSettlements(b, bill.id)) {
    add(voucher.date, amount);
    const reversal = b.vouchers.find(v => v.reverses === voucher.id);
    if (reversal) add(reversal.date, -amount);
  }
  let committed = 0;
  let highest = 0;
  if (!changes.has(day)) changes.set(day, 0);
  for (const on of [...changes.keys()].sort()) {
    committed += changes.get(on);
    if (on >= day) highest = Math.max(highest, committed);
  }
  return bill.total - highest;
}

export function settleBill(s, x, ctx) {
  const b = initBook(s);
  const day = date(x.date);
  const cash = ref(b.charts, x.bank);
  ensure(isCashLedger(cash), 'Choose a cash or bank ledger.');
  const multi = clean(x.allocations, 40000);
  ensure(!multi || !x.voucherId, 'Enter either the single bill or the bill allocation list.');
  const rows = multi ? csvLines(multi, 'Bill allocation', 2) : [[x.voucherId, x.amount]];
  ensure(rows.length > 0 && new Set(rows.map(row => row[0])).size === rows.length, 'Enter each outstanding bill once.');
  const allocations = [];
  let first;
  for (const [billId, value] of rows) {
    const bill = ref(b.vouchers, billId);
    ensure(bill && billSide(bill) && !bill.reverses && activeAt(b, bill) && day >= bill.date, 'Select an active bill and a valid settlement date.');
    first ??= bill;
    ensure(billSide(first) === billSide(bill) && partyLedgerKey(b, first) === partyLedgerKey(b, bill), 'Apply a receipt or payment to bills for one party.');
    const amount = paise(value, 'Settlement amount');
    ensure(amount > 0 && amount <= availableToApply(b, bill, day), 'Settlement would exceed the available balance on ' + bill.number + '.');
    allocations.push({ billId, amount });
  }
  const amount = allocations.reduce((sum, row) => sum + row.amount, 0);
  const sale = billSide(first) === 'AR';
  const entries = sale ? [debit(cash.id, amount), credit('AR', amount)] : [debit('AP', amount), credit(cash.id, amount)];
  return postVoucher(s, { ...voucherInput(x), date: day, type: sale ? 'Receipt' : 'Payment', party: first.party, partyId: first.partyId,
    against: allocations.length === 1 ? first.id : null, allocations }, entries, ctx);
}

export function cashEntry(s, x, ctx) {
  const b = initBook(s);
  const type = choice(x.kind, ['Receipt', 'Payment'], 'cash or bank voucher type');
  const cash = ref(b.charts, x.bank);
  const other = ref(b.charts, x.ledger);
  ensure(isCashLedger(cash) && other && !controls.has(other.id) && !isCashLedger(other), 'Use a cash or bank ledger and a non-party counterpart. Use Contra for transfers between cash and bank.');
  const amount = paise(x.amount, 'Voucher amount');
  const entries = type === 'Receipt' ? [debit(cash.id, amount), credit(other.id, amount)] : [debit(other.id, amount), credit(cash.id, amount)];
  return postVoucher(s, { ...voucherInput(x), type, party: x.party }, entries, ctx);
}

export function journal(s, x, ctx) {
  const kind = choice(x.kind, ['Journal', 'Contra'], 'journal voucher type');
  const b = initBook(s);
  const lines = journalLines(x.entries, 'Journal');
  ensure(lines.every(row => !controls.has(row.a)), 'Use bills and settlements for receivable and payable ledgers.');
  if (kind === 'Contra') ensure(lines.every(row => isCashLedger(ref(b.charts, row.a))), 'Contra vouchers only use cash or bank ledgers.');
  return postVoucher(s, { ...voucherInput(x), type: kind }, lines, ctx);
}

export function reverseVoucher(s, x, ctx) {
  const b = initBook(s);
  const voucher = ref(b.vouchers, x.voucherId);
  const day = date(x.date);
  ensure(voucher && !voucher.reverses && activeAt(b, voucher) && day >= voucher.date, 'Select an active voucher and a valid reversal date.');
  const linked = relatedSettlements(b, voucher.id);
  ensure(linked.every(row => !activeAt(b, row.voucher) && row.voucher.date <= day && !b.vouchers.some(v => v.reverses === row.voucher.id && v.date > day)),
    'Reverse linked settlements first, with a reversal date on or before this voucher reversal.');
  return postVoucher(s, { ...voucherInput(x), date: day, type: 'Reversal', party: voucher.party, partyId: voucher.partyId, reverses: voucher.id,
    note: req(x.note, 'Reversal reason') }, voucher.lines.map(line => ({ a: line.a, d: line.c, c: line.d })), ctx);
}

export const orderedVouchers = (b, start = '', end = '9999-12-31') => b.vouchers.filter(v => v.date >= start && v.date <= end).sort((a, b) => a.date.localeCompare(b.date));

export function accountTotals(b, start = '', end = '9999-12-31') {
  const columns = new Map(b.charts.map(account => [account.id, { ...account, d: 0, c: 0 }]));
  for (const voucher of b.vouchers) {
    if (voucher.date < start || voucher.date > end) continue;
    for (const line of voucher.lines) {
      const account = columns.get(line.a);
      if (account) {
        account.d += line.d;
        account.c += line.c;
      }
    }
  }
  return [...columns.values()];
}

export function ledgerStatement(b, ledger, start = '', end = '9999-12-31') {
  let balance = 0;
  let opening = 0;
  let debit = 0;
  let credit = 0;
  const entries = [];
  const account = ledger.account || ledger.id;
  for (const voucher of orderedVouchers(b, '', end)) {
    if (ledger.account && partyLedgerKey(b, voucher) !== ledger.id) continue;
    const matching = voucher.lines.filter(line => line.a === account);
    if (!matching.length) continue;
    const d = matching.reduce((sum, line) => sum + line.d, 0);
    const c = matching.reduce((sum, line) => sum + line.c, 0);
    balance += d - c;
    if (voucher.date < start) { opening = balance; continue; }
    debit += d;
    credit += c;
    const counterparts = [...new Set(voucher.lines.filter(line => line.a !== account).map(line => ref(b.charts, line.a)?.name || line.a))];
    entries.push({ voucher, d, c, balance, counterparts });
  }
  return { opening, debit, credit, closing: balance, entries };
}

export function postCogs(s, x, ctx) {
  const dispatch = ref(s.shipments, x.shipmentId);
  const day = date(x.date);
  ensure(dispatch && day >= dispatch.date, 'Use a dispatch and accounting date on or after the shipment.');
  const b = initBook(s);
  const source = { type: 'Shipment valuation', id: dispatch.id, reference: dispatch.number };
  ensure(!b.vouchers.some(v => v.source?.type === source.type && v.source.id === source.id && overlapsPosting(b, v, day)), 'This dispatch already has a valuation voucher.');
  let total = 0;
  const costed = dispatch.contents.filter(c => !ref(s.lots, c.lotId)?.ownerId);
  for (const row of costed) {
    const lot = ref(s.lots, row.lotId);
    total += lotCost(s, lot, day) * row.qty / lot.initialQty;
  }
  const amount = x.amount ? paise(x.amount, 'Approved inventory relief') : Math.round(total * 100);
  ensure(costed.length && Number.isSafeInteger(amount) && amount > 0, 'Enter an approved cost or post the lot charges first.');
  return postVoucher(s, {
    number: x.number || 'COGS-' + dispatch.number, date: day, type: 'Inventory relief', party: dispatch.customer,
    partyId: dispatch.buyerId, note: req(x.note, 'Valuation approval reference'), source,
  }, [debit('COGS', amount), credit('STOCK', amount)], ctx);
}

export function openBalances(b, end = '9999-12-31') {
  return b.vouchers.filter(v => billSide(v) && !v.reverses && activeAt(b, v, end)).map(v => ({
    ...v, balance: v.total - settlementTotal(b, v, end), due: v.due || ref(b.invoices ?? [], v.source?.id)?.due || v.date,
    control: billSide(v), ledgerId: partyLedgerKey(b, v),
  })).filter(v => v.balance > 0).sort((a, b) => a.due.localeCompare(b.due));
}
