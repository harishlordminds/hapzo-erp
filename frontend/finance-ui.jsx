import { EditableContent, RowList, RowTemplate, SelectControl, appendRow, joinContent, setContents } from './react-ui.jsx';
import { CURRENCIES, norm, ref, today, validDate } from '../src/model.js';
import {
  ACCOUNTS,
  LEDGER_GROUPS,
  accountTotals,
  activeAt,
  availableToApply,
  book,
  isCashLedger,
  ledgerGroupOf,
  ledgerStatement,
  openBalances,
  orderedVouchers,
  partyLedgers,
  settlementAllocations,
} from '../src/finance.js';
import { lotCost } from '../src/fulfilment.js';
import {
  h,
  valueOf,
  money,
  fmt,
  showQty,
  badge,
  txStatus,
  heading,
  panel,
  split,
  cards,
  facts,
  table,
  actions,
  button,
  docs,
  editor,
  empty,
  field,
  form,
  hidden,
  linkButton,
  lotLink,
  navLink,
  numberField,
  option,
  washLink,
  embroideryBatchLink,
  select,
  choose,
  file,
  text,
  day,
  titles,
} from './ui.jsx';
const currency = (name = 'currency') =>
  select('Currency', name, CURRENCIES, {
    initial: 'INR',
  });
const optional = (label, name, value = '') =>
  field(label, name, {
    required: false,
    value,
  });
const num = (label, name, value = '', required = false) =>
  numberField(label, name, {
    value,
    required,
  });
const amount = (label, name, value = '', required = true) =>
  numberField(label, name, {
    value,
    required,
    step: '0.01',
  });
const cents = (p) => h(money(p / 100));
const taxInputs = () =>
  joinContent(
    ['CGST', 'SGST', 'UTGST', 'IGST', 'Cess'].map((name) => amount(name, name.toLowerCase(), '', false)),
    '',
  );
const costs = (s) =>
  s.costs.filter((c) => c.supplier || s.events.some((e) => e.kind === 'Goods receipt' && e.output === c.lot));
function Invoices({ app }) {
  const s = app.data;
  const open = s.shipments.filter((sh) => !s.invoices.some((i) => i.shipmentId === sh.id));
  const query = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const returnLot = ref(s.lots, query.get('washLot') || query.get('embroideryLot'));
  const service = ref(s.processBatches, returnLot?.washBatchId || returnLot?.embroideryBatchId);
  return (
    <>
      {heading(
        'Invoicing and landed costs',
        'Issue invoices from shipment quantities or approved service orders. Record approved GST amounts and track recoverable tax separately.',
      )}
      {split(
        editor(
          app,
          'invoice',
          'Issue invoice',
          <>
            {field('Invoice number', 'number')}
            {choose('Dispatched shipment', 'shipmentId', open, (sh) => sh.number + ' · ' + sh.customer, {
              required: false,
            })}
            {choose(
              'Service order if shipment is blank',
              'orderId',
              s.orders.filter((o) => o.kind === 'Service'),
              titles.order,
              {
                required: false,
              },
            )}
            {day('Invoice date')}
            {day('Payment due date', 'due', false)}
            {amount('Taxable value override', 'net', '', false)}
            {optional('Pricing adjustment reference', 'adjustmentRef')}
            {taxInputs()}
            {optional('GSTIN', 'gstin')}
            {optional('Place of supply', 'placeOfSupply')}
            {optional('HSN / SAC', 'hsn')}
            {optional('Tax / export reference', 'taxRef')}
            {optional('Payment terms', 'terms')}
            {text('Service or invoice description', 'description')}
            {file('Signed or external invoice document', 'invoice')}
          </>,
          'Issue invoice',
          'Shipment invoices use the quantities and unit prices captured at dispatch. Enter a reason for a different approved invoice amount.',
          open.length > 0,
        ),
        editor(
          app,
          'cost',
          'Allocate approved cost addition',
          <>
            {choose('Affected lot', 'lotId', s.lots, titles.lot, {
              initial: returnLot?.id,
            })}
            {choose(
              'Billing supplier or processor',
              'supplierId',
              s.parties.filter((p) => p.type !== 'Buyer'),
              titles.party,
              {
                required: false,
                initial: service?.processorId,
              },
            )}
            {select(
              'Category',
              'category',
              [
                'Material',
                'Labour',
                'Machine',
                'Energy',
                'Water',
                'Steam',
                'Chemicals',
                'Waste',
                'Job work',
                'Freight',
                'Insurance',
                'Duty',
                'Other',
              ],
              {
                initial: service?.jobId ? 'Job work' : '',
              },
            )}
            {field('Vendor bill or charge reference', 'reference')}
            {currency()}
            {num('Approved accounting rate to INR', 'rate', '1')}
            {optional('Rate source and date', 'rateRef')}
            {amount('Net payable before GST', 'net')}
            {amount('GST taxable basis if different', 'taxable', '', false)}
            {amount('Net addition to inventory or WIP', 'capitalized', '', false)}
            {taxInputs()}
            {amount('Confirmed recoverable GST', 'credit', '', false)}
            {amount('GST added to inventory cost', 'taxToCost', '', false)}
            {select('ITC review', 'itcStatus', ['Pending review', 'Eligible', 'Ineligible', 'Reversed'], {
              initial: 'Pending review',
            })}
            {optional('Tax or customs reference', 'taxRef')}
            {optional('Allocation basis or supporting calculation', 'basis')}
            {day()}
            {file('Cost, duty, tax or supplier document', 'cost')}
          </>,
          'Post cost',
          '',
          Boolean(service?.jobId),
        ),
      )}
      {panel(
        'Invoice register',
        table(
          ['Invoice', 'Source', 'Buyer', 'Issued / due', 'Net', 'GST', 'Total'],
          s.invoices
            .slice()
            .reverse()
            .map((i) => [
              linkButton(i.number, 'invoice', i.id),
              h(ref(s.shipments, i.shipmentId)?.number || ref(s.orders, i.serviceOrderId)?.po),
              h(i.customer),
              h(i.date + ' / ' + i.due),
              h(money(i.net, i.currency)),
              h(money(i.tax, i.currency)),
              h(money(i.amount, i.currency)),
            ]),
        ),
      )}
      {panel(
        'Charges and GST additions',
        table(
          ['Bill / category', 'Lot', 'Payable', 'Taxable', 'GST / ITC', 'Landed INR', 'Source'],
          s.costs
            .slice()
            .reverse()
            .map((c) => [
              h(c.reference + ' · ' + c.category),
              lotLink(c.lot),
              h(money(c.payable, c.currency)),
              h(money(c.taxable, c.currency)),
              <>
                {h(money(c.gst, c.currency) + ' / ' + money(c.credit, c.currency))}
                <br />
                {txStatus(c.itcStatus)}
              </>,
              h(money(c.landed)),
              <>
                {c.washBatchId ? (
                  <>
                    {washLink(c.washBatchId, c.challan)}
                    <br />
                  </>
                ) : c.embroideryBatchId ? (
                  <>
                    {embroideryBatchLink(c.embroideryBatchId, c.challan)}
                    <br />
                  </>
                ) : (
                  ''
                )}
                {docs(c.document)}
              </>,
            ]),
        ),
      )}
      {panel(
        'Actual cost by lot',
        <>
          {form(
            'cost-search',
            choose('Lot', 'lotId', s.lots, titles.lot, {
              initial: app.local.costLot || '',
            }),
            'View cost',
          )}
          {ref(s.lots, app.local.costLot)
            ? facts([
                ['Lot', lotLink(app.local.costLot)],
                ['Direct and proportional source costs', h(money(lotCost(s, ref(s.lots, app.local.costLot))))],
              ])
            : ''}
        </>,
      )}
    </>
  );
}
export { Invoices };
export function invoiceDetail(app, i) {
  return (
    <>
      {heading('Invoice ' + i.number, app.data.settings.name + (i.customer ? ' · ' + i.customer : ''))}
      {facts([
        ['Date', h(i.date)],
        ['Status', txStatus(i.status)],
        ['Due date', valueOf(i.due)],
        ['Invoice document', docs(i.document)],
        ['GST registration', valueOf(i.gstin)],
        ['Place of supply', valueOf(i.placeOfSupply)],
        ['HSN / SAC', valueOf(i.hsn)],
        ['Terms', valueOf(i.terms)],
        ['Description', valueOf(i.description)],
        ['Reference', valueOf(i.taxRef)],
      ])}
      {i.lines?.length
        ? panel(
            'Invoice contents',
            table(
              ['Lot', 'Buyer PO line', 'Style', 'Quantity', 'Net'],
              i.lines.map((l) => [
                h(l.lotId),
                h(l.po + ' / ' + l.lineNo),
                h(l.style),
                showQty(l.qty, l.unit),
                h(money(l.net, i.currency)),
              ]),
            ),
          )
        : ''}
      {i.currency
        ? panel(
            'Invoice amounts',
            table(
              ['Entry', i.currency],
              [
                ['Taxable value', h(money(i.net, i.currency))],
                ...['cgst', 'sgst', 'utgst', 'igst', 'cess']
                  .filter((k) => i[k])
                  .map((k) => [k.toUpperCase(), h(money(i[k], i.currency))]),
                ['Tax total', h(money(i.tax, i.currency))],
                ['Invoice total', <strong>{h(money(i.amount, i.currency))}</strong>],
              ],
            ),
          )
        : ''}
    </>
  );
}
const voucherLabel = (v) => v.number + ' · ' + v.type + (v.party ? ' · ' + v.party : '');
const byName = (a, b) => a.name.localeCompare(b.name);
const accountList = (accounts) => accounts.map((a) => [a.id, [a.code, a.name].filter(Boolean).join(' · ')]);
const ledgerList = (b) => [...b.charts, ...partyLedgers(b)];
const ledgerGroupChoices = Object.keys(LEDGER_GROUPS).filter(
  (group) => !['Sundry Debtors', 'Sundry Creditors'].includes(group),
);
const cashList = (b) => accountList(b.charts.filter(isCashLedger));
const allDates = () => ({
  start: '',
  end: today(),
});
const reportPeriod = (app) =>
  app.local.period || {
    ...allDates(),
    ledger: '',
  };
const ledgerPeriod = (app) => app.local.ledgerPeriod || allDates();
const dayPeriod = (app) =>
  app.local.dayPeriod || {
    ...allDates(),
    kind: '',
    query: '',
  };
const displayBalance = (n) => (n ? money(Math.abs(n) / 100) + (n < 0 ? ' Cr' : ' Dr') : money(0));
const shownBalance = (n) => h(displayBalance(n));
const voucherLink = (v, label = v.number) => linkButton(label, 'voucher', v.id);
export const ledgerHash = (id) => 'ledgers?ledger=' + encodeURIComponent(id);
const ledgerLink = (id, label) => <a href={'#' + h(ledgerHash(id))}>{h(label)}</a>;
const periodFields = (f) => (
  <>
    {field('From', 'start', {
      type: 'date',
      required: false,
      value: f.start,
    })}
    {field('Through', 'end', {
      type: 'date',
      value: f.end,
    })}
  </>
);
const cashLedgerSelect = (b) =>
  select('Cash or bank ledger', 'bank', cashList(b), {
    initial: 'BANK',
  });
const partyFields = (s) => (
  <>
    {choose('ERP buyer, supplier or processor', 'partyId', s.parties.slice().sort(byName), titles.party, {
      required: false,
    })}
    {optional('Party name for an unlinked bill', 'party')}
  </>
);
const booksNav = (includeLedger = true) =>
  actions(
    navLink('Day book', 'day-book'),
    includeLedger ? navLink('Ledgers', 'ledgers') : navLink('Accounts & vouchers', 'accounts'),
  );
function journalEntrySheet(b, opening = false) {
  const choices = b.charts.filter(
    (a) => !['AR', 'AP'].includes(a.id) && (!opening || ['Asset', 'Liability', 'Equity'].includes(a.group)),
  );
  const codes = (
    <>
      {option('', 'Select ledger')}
      {joinContent(
        choices.map((a) => option(a.id, a.code + ' · ' + a.name)),
        '',
      )}
    </>
  );
  const row = (
    <tr>
      <td>
        <SelectControl aria-label="Ledger code" data-entry="ledger">
          {codes}
        </SelectControl>
      </td>
      <td>
        <input type="number" min="0" step="0.01" inputMode="decimal" aria-label="Debit INR" data-entry="debit" />
      </td>
      <td>
        <input type="number" min="0" step="0.01" inputMode="decimal" aria-label="Credit INR" data-entry="credit" />
      </td>
    </tr>
  );
  return (
    <div className="wide ledger-entry-sheet" data-entry-sheet="">
      <div className="table">
        <table>
          <thead>
            <tr>
              <th scope="col">Ledger</th>
              <th scope="col">Debit INR</th>
              <th scope="col">Credit INR</th>
            </tr>
          </thead>
          <RowList as="tbody" data-ledger-entries="">
            {row}
            {row}
          </RowList>
        </table>
      </div>
      <RowTemplate data-ledger-row="">{row}</RowTemplate>
      <div className="actions">
        {button('Add ledger line', {
          'data-add-ledger-line': 'yes',
        })}
      </div>
    </div>
  );
}
export function addLedgerLine(form) {
  const target = form.querySelector('[data-ledger-entries]');
  const template = form.querySelector('[data-ledger-row]');
  if (target.children.length >= 200) return;
  appendRow(target, template);
  target.lastElementChild.querySelector('select').focus();
}
export function accountingInput(el, input) {
  const rows = el.querySelector('[data-ledger-entries]');
  if (rows) {
    input.entries = [...rows.rows]
      .map((row) => ['ledger', 'debit', 'credit'].map((key) => row.querySelector('[data-entry="' + key + '"]').value))
      .filter((row) => row.some(Boolean))
      .map((row) => row.join(','))
      .join('\n');
  }
  if (el.querySelector('[data-settlement-bills]')) {
    input.allocations = [...el.querySelectorAll('[data-bill-id]')]
      .filter((node) => Number(node.value) > 0)
      .map((node) => [node.dataset.billId, node.value].join(','))
      .join('\n');
    if (!input.allocations) throw new Error('Enter an amount against at least one outstanding bill.');
  }
  return input;
}
export function showAppliedTotal(el) {
  const output = el.querySelector('[data-settlement-total]');
  if (!output) return;
  const total = [...el.querySelectorAll('[data-bill-id]')].reduce(
    (sum, node) => sum + Math.round((Number(node.value) || 0) * 100),
    0,
  );
  output.value = money(total / 100);
}
export function refreshSettlement(el, app) {
  const target = el.querySelector('[data-settlement-bills]');
  const bankDate = el.elements.date.value;
  const ledgerId = el.elements.settlementLedger.value;
  const draft = new Map(
    [...target.querySelectorAll('[data-bill-id]')].map((node) => [node.dataset.billId, node.value]),
  );
  if (!ledgerId || !validDate(bankDate)) {
    setContents(target, empty('Select a party ledger and voucher date.'));
  } else {
    const b = book(app.data);
    const rows = openBalances(b, bankDate)
      .filter((v) => v.ledgerId === ledgerId && activeAt(b, v))
      .map((v) => ({
        voucher: v,
        available: availableToApply(b, v, bankDate),
      }))
      .filter((row) => row.available > 0);
    setContents(
      target,
      table(
        ['Bill', 'Due', 'Available', 'Apply INR'],
        rows.map(({ voucher: v, available }) => [
          voucherLink(v, v.source?.reference || v.number),
          h(v.due),
          cents(available),
          <input
            type="number"
            className="bill-allocation"
            min="0"
            max={h(available / 100)}
            step="0.01"
            inputMode="decimal"
            aria-label={h('Apply to ' + v.number)}
            data-bill-id={h(v.id)}
            defaultValue={h(draft.get(v.id) || '')}
          />,
        ]),
        'No bills for this party are available on the voucher date.',
      ),
    );
  }
  showAppliedTotal(el);
}
function settlementFields(b) {
  const due = new Set(openBalances(b).map((v) => v.ledgerId));
  const ledgers = partyLedgers(b).filter((ledger) => due.has(ledger.id));
  return (
    <>
      {select(
        'Party ledger',
        'settlementLedger',
        ledgers.map((l) => [l.id, l.name + ' · ' + l.ledgerGroup]),
      )}
      {cashLedgerSelect(b)}
      {field('Voucher number', 'number')}
      {day('Voucher date')}
      {optional('Bank or payment reference', 'note')}
      <EditableContent as="div" className="wide" data-settlement-bills="" />
      <p className="wide finance-apply-total">
        {'Amount to post '}
        <output data-settlement-total="" />
      </p>
    </>
  );
}
function voucherRows(b, rows, end) {
  return table(
    ['Date', 'Voucher', 'Type', 'Party', 'Reference', 'Total INR', 'Status'],
    rows.map((v) => [
      h(v.date),
      voucherLink(v),
      h(v.type),
      valueOf(v.party),
      v.reverses ? valueOf(ref(b.vouchers, v.reverses)?.number) : valueOf(v.source?.reference || v.note),
      cents(v.total),
      v.reverses ? badge('Reversal', 'neutral') : activeAt(b, v, end) ? badge('Posted') : badge('Reversed', 'warn'),
    ]),
    'No vouchers match this period and filter.',
  );
}
function Accounts({ app }) {
  const s = app.data;
  const b = book(s);
  const end = today();
  const open = openBalances(b, end);
  const total = (control) =>
    money(open.filter((v) => v.control === control).reduce((sum, v) => sum + v.balance, 0) / 100);
  const balances = accountTotals(b, '', end);
  const cashBalance = balances.filter(isCashLedger).reduce((sum, a) => sum + a.d - a.c, 0);
  return (
    <>
      {heading(
        'Accounts and vouchers',
        'Post sales, purchases, receipts, payments, journals and contra entries in INR.',
        booksNav(),
      )}
      {cards([
        ['Receivables', total('AR')],
        ['Payables', total('AP')],
        ['Cash and bank', displayBalance(cashBalance)],
        ['Posted vouchers', b.vouchers.length],
      ])}
      {split(
        editor(
          app,
          'account-erp-sales',
          'Post ERP sales invoice',
          <>
            {choose('Issued invoice', 'sourceId', s.invoices, (i) => i.number + ' · ' + i.customer)}
            {optional('Voucher number override', 'number')}
            {day('Voucher date')}
            {num('Approved INR rate for foreign invoice', 'rate')}
          </>,
          'Post receivable',
        ),
        editor(
          app,
          'account-erp-purchase',
          'Post ERP charge or supplier bill',
          <>
            {choose('Charge or receipt cost', 'sourceId', costs(s), (c) => c.reference + ' · ' + c.category)}
            {optional('Voucher number override', 'number')}
            {day('Voucher date')}
            {day('Payment due date', 'due', false)}
          </>,
          'Post payable',
        ),
        editor(
          app,
          'account-settle',
          'Post receipt or payment against bills',
          settlementFields(b),
          'Post settlement',
          'Apply one voucher to one or more bills for the selected party.',
          open.length > 0,
        ),
        editor(
          app,
          'account-cash',
          'Post direct receipt or payment',
          <>
            {select('Type', 'kind', ['Receipt', 'Payment'])}
            {cashLedgerSelect(b)}
            {select(
              'Counterpart ledger',
              'ledger',
              accountList(b.charts.filter((a) => !isCashLedger(a) && !['AR', 'AP'].includes(a.id))),
            )}
            {field('Voucher number', 'number')}
            {day('Voucher date')}
            {amount('Amount INR', 'amount')}
            {optional('Party or payee', 'party')}
            {optional('Narration / reference', 'note')}
          </>,
          'Post receipt or payment',
        ),
        editor(
          app,
          'account-bill',
          'Post manual sales or purchase bill',
          <>
            {select('Type', 'kind', ['Sales', 'Purchase'])}
            {partyFields(s)}
            {field('External invoice number', 'reference')}
            {field('Voucher number', 'number')}
            {day('Voucher date')}
            {day('Original bill date', 'documentDate', false)}
            {day('Due date', 'due', false)}
            {select(
              'Income, inventory or expense ledger',
              'ledger',
              accountList(
                b.charts.filter(
                  (a) =>
                    ['Income', 'Asset', 'Expense'].includes(a.group) &&
                    !['AR', 'ITC'].includes(a.id) &&
                    !isCashLedger(a),
                ),
              ),
            )}
            {amount('Taxable value INR', 'net')}
            {amount('GST INR', 'tax', '0')}
            {amount('Recoverable GST for purchase INR', 'recoverable', '0')}
          </>,
          'Post bill',
        ),
        editor(
          app,
          'account-journal',
          'Post journal or contra',
          <>
            {field('Voucher number', 'number')}
            {select('Type', 'kind', ['Journal', 'Contra'], {
              initial: 'Journal',
            })}
            {day('Voucher date')}
            {optional('Narration', 'note')}
            {journalEntrySheet(b)}
          </>,
          'Post voucher',
        ),
        editor(
          app,
          'account-cogs',
          'Post cost of goods sold',
          <>
            {choose('Dispatch', 'shipmentId', s.shipments, (sh) => sh.number + ' · ' + sh.customer)}
            {optional('Voucher number override', 'number')}
            {day('Voucher date')}
            {amount('Approved valuation override INR', 'amount', '', false)}
            {field('Valuation approval reference', 'note')}
          </>,
          'Post inventory relief',
          'The default uses the share of posted lot costs attributed to shipped company-owned stock.',
        ),
        editor(
          app,
          'account-reverse',
          'Reverse posted voucher',
          <>
            {choose(
              'Active voucher',
              'voucherId',
              b.vouchers.filter((v) => !v.reverses && activeAt(b, v)),
              voucherLabel,
            )}
            {field('Reversal voucher number', 'number')}
            {day('Reversal date')}
            {text('Reversal reason', 'note', '', true)}
          </>,
          'Post reversal',
        ),
      )}
      {panel(
        'Recent vouchers',
        <>
          {voucherRows(b, orderedVouchers(b).reverse().slice(0, 12), '9999-12-31')}
          {actions(navLink('Open day book', 'day-book'))}
        </>,
      )}
    </>
  );
}
export { Accounts };
export function voucherDetail(app, v) {
  const b = book(app.data);
  const matches = settlementAllocations(v).map((row) => ({
    ...row,
    bill: ref(b.vouchers, row.billId),
  }));
  const reverse = ref(b.vouchers, v.reverses);
  const counter = b.vouchers.find((other) => other.reverses === v.id);
  const source = ref(app.data.invoices, v.source?.type === 'Sales invoice' ? v.source.id : '');
  const financeFacts = [
    ['Party', valueOf(v.party)],
    ['Source', source ? linkButton(source.number, 'invoice', source.id) : valueOf(v.source?.reference)],
    ['Narration', valueOf(v.note)],
    ['Recorded by', valueOf(v.postedBy)],
  ];
  if (v.due) financeFacts.push(['Due date', h(v.due)]);
  if (v.documentDate) financeFacts.push(['Document date', h(v.documentDate)]);
  if (reverse) financeFacts.push(['Reverses', voucherLink(reverse)]);
  if (counter) financeFacts.push(['Reversed by', voucherLink(counter)]);
  return (
    <>
      {heading('Voucher ' + v.number, v.type + ' · ' + v.date)}
      {facts(financeFacts)}
      {panel(
        'Journal lines',
        table(
          ['Ledger', 'Debit INR', 'Credit INR'],
          v.lines.map((l) => [ledgerLink(l.a, l.a + ' · ' + (ref(b.charts, l.a)?.name || '')), cents(l.d), cents(l.c)]),
        ),
      )}
      {matches.length
        ? panel(
            'Applied to bills',
            table(
              ['Bill', 'Applied INR'],
              matches.map((row) => [
                row.bill ? voucherLink(row.bill, row.bill.source?.reference || row.bill.number) : h(row.billId),
                cents(row.amount),
              ]),
            ),
          )
        : ''}
    </>
  );
}
function booksRows(b, f) {
  return orderedVouchers(b, f.start, f.end)
    .filter(
      (v) =>
        (!f.kind || v.type === f.kind) &&
        (!f.query ||
          [v.number, v.party, v.source?.reference, v.note].some((value) => norm(value).includes(norm(f.query)))),
    )
    .reverse();
}
function DayBook({ app }) {
  const b = book(app.data);
  const f = dayPeriod(app);
  const rows = booksRows(b, f);
  const types = [...new Set(b.vouchers.map((v) => v.type))].sort();
  return (
    <>
      {heading(
        'Day book',
        'Find and open vouchers by posting date, type, party or reference.',
        actions(navLink('Accounts & vouchers', 'accounts'), navLink('Ledgers', 'ledgers')),
      )}
      {panel(
        'Voucher filter',
        form(
          'day-book-filter',
          <>
            {periodFields(f)}
            {select('Voucher type', 'kind', types, {
              required: false,
              initial: f.kind,
              blank: 'All voucher types',
            })}
            {optional('Voucher, party, reference or narration', 'query', f.query)}
          </>,
          'Apply filter',
        ),
      )}
      {panel(
        'Voucher register',
        <>
          {voucherRows(b, rows, f.end)}
          {actions(
            button('Export day book CSV', {
              'data-voucher-export': 'day-book',
            }),
          )}
        </>,
      )}
    </>
  );
}
export { DayBook };
function overdueDays(due, end) {
  if (due >= end) return '—';
  return h(Math.round((Date.parse(end) - Date.parse(due)) / 86400000) + ' days');
}
function billsTable(open, end, showParty = true) {
  const headers = [
    'Bill',
    ...(showParty ? ['Party'] : []),
    'Type',
    'Bill date',
    'Due',
    'Overdue',
    'Posted INR',
    'Outstanding INR',
  ];
  return table(
    headers,
    open.map((v) => [
      voucherLink(v, v.source?.reference || v.number),
      ...(showParty ? [v.ledgerId ? ledgerLink(v.ledgerId, v.party) : h(v.party)] : []),
      h(v.control === 'AR' ? 'Receivable' : 'Payable'),
      h(v.documentDate || v.date),
      h(v.due),
      overdueDays(v.due, end),
      cents(v.total),
      cents(v.balance),
    ]),
    'No outstanding bills as of this date.',
  );
}
function statementPanel(b, ledger, f, allowExport = false) {
  const statement = ledgerStatement(b, ledger, f.start, f.end);
  const rows = statement.entries.map(({ voucher: v, d, c, balance, counterparts }) => [
    h(v.date),
    voucherLink(v),
    h(v.type),
    h([counterparts.join(', '), ledger.account ? '' : v.party, v.note].filter(Boolean).join(' · ')),
    cents(d),
    cents(c),
    shownBalance(balance),
  ]);
  return (
    <section className="panel" id="ledger-statement">
      <h2>{h(ledger.name)}</h2>
      {cards([
        ['Opening', displayBalance(statement.opening)],
        ['Debits', money(statement.debit / 100)],
        ['Credits', money(statement.credit / 100)],
        ['Closing', displayBalance(statement.closing)],
      ])}
      {table(
        ['Date', 'Voucher', 'Type', 'Particulars', 'Debit INR', 'Credit INR', 'Running balance'],
        rows,
        'No ledger activity in this period.',
      )}
      {allowExport
        ? actions(
            button('Export ledger statement CSV', {
              'data-ledger-export': h(ledger.id),
            }),
          )
        : ''}
    </section>
  );
}
function Ledgers({ app, params: args }) {
  const b = book(app.data);
  const f = ledgerPeriod(app);
  const general = b.charts
    .slice()
    .sort((a, other) => ledgerGroupOf(a).localeCompare(ledgerGroupOf(other)) || byName(a, other));
  const parties = partyLedgers(b);
  const key = args.get('ledger') || '';
  const selected = ref([...general, ...parties], key);
  const open = openBalances(b, f.end);
  const closing = new Map(accountTotals(b, '', f.end).map((a) => [a.id, a.d - a.c]));
  const canChangeGroup =
    selected &&
    !selected.account &&
    !ref(ACCOUNTS, selected.id) &&
    !b.vouchers.some((v) => v.lines.some((line) => line.a === selected.id));
  return (
    <>
      {heading(
        'Ledger accounts',
        'Review cash, bank, general and party ledgers with running balances and bill-wise dues.',
        booksNav(false),
      )}
      {panel(
        'Ledger and period',
        form(
          'ledger-filter',
          <>
            {select('Ledger', 'ledger', accountList([...general, ...parties]), {
              initial: key,
            })}
            {periodFields(f)}
          </>,
          'View ledger',
        ),
      )}
      {selected ? statementPanel(b, selected, f, true) : ''}
      {selected?.account
        ? panel(
            'Outstanding bills · ' + selected.name,
            billsTable(
              open.filter((v) => v.ledgerId === key),
              f.end,
              false,
            ),
          )
        : ''}
      {split(
        panel(
          'Chart of accounts',
          table(
            ['Ledger', 'Group', 'Closing balance'],
            general.map((a) => [
              ledgerLink(a.id, a.code + ' · ' + a.name),
              h(ledgerGroupOf(a)),
              shownBalance(closing.get(a.id)),
            ]),
          ),
        ),
        panel(
          'Buyer and supplier ledgers',
          table(
            ['Party ledger', 'Group', 'Closing balance'],
            parties.map((l) => [
              ledgerLink(l.id, [l.code, l.name].filter(Boolean).join(' · ')),
              h(l.ledgerGroup),
              shownBalance(ledgerStatement(b, l, f.end, f.end).closing),
            ]),
            'Add a party master or post a bill to start a party ledger.',
          ),
        ),
      )}
      {split(
        editor(
          app,
          'account-new',
          'Create ledger',
          <>
            {field('Ledger code', 'code')}
            {field('Ledger name', 'name')}
            {select('Ledger group', 'ledgerGroup', ledgerGroupChoices)}
          </>,
          'Create ledger',
        ),
        selected && !selected.account
          ? editor(
              app,
              'account-edit',
              'Maintain ' + selected.code,
              <>
                {hidden('ledgerId', selected.id)}
                {field('Ledger name', 'name', {
                  value: selected.name,
                })}
                {canChangeGroup
                  ? select('Ledger group', 'ledgerGroup', ledgerGroupChoices, {
                      initial: ledgerGroupOf(selected),
                    })
                  : ''}
              </>,
              'Save ledger',
            )
          : '',
        editor(
          app,
          'account-opening',
          'Post opening balances',
          <>
            {field('Voucher number', 'number')}
            {day('Books opening date')}
            {optional('Opening balance reference', 'note')}
            {journalEntrySheet(b, true)}
          </>,
          'Post opening balances',
          'Enter the debits and credits for your balance sheet ledgers.',
        ),
        editor(
          app,
          'account-opening-bill',
          'Post opening party bill',
          <>
            {select('Opening bill type', 'kind', ['Opening receivable', 'Opening payable'])}
            {partyFields(app.data)}
            {field('Original bill reference', 'reference')}
            {field('Voucher number', 'number')}
            {day('Books opening date')}
            {day('Original bill date', 'documentDate')}
            {day('Due date', 'due', false)}
            {select('Opening equity ledger', 'ledger', accountList(b.charts.filter((a) => a.group === 'Equity')), {
              initial: 'CAPITAL',
            })}
            {amount('Outstanding opening amount INR', 'amount')}
          </>,
          'Post opening bill',
        ),
      )}
    </>
  );
}
export { Ledgers };
function Reports({ app }) {
  const b = book(app.data);
  const f = reportPeriod(app);
  const closing = accountTotals(b, '', f.end);
  const movement = accountTotals(b, f.start, f.end);
  const open = openBalances(b, f.end);
  const total = (rows, groups, credit = false) =>
    rows
      .filter((a) => groups.includes(a.group))
      .reduce((sum, row) => sum + (credit ? row.c - row.d : row.d - row.c), 0);
  const income = total(movement, ['Income'], true);
  const expenses = total(movement, ['Expense']);
  const equity = total(closing, ['Equity'], true);
  const liabilities = total(closing, ['Liability'], true);
  const earnings = total(closing, ['Income', 'Expense'], true);
  const dr = (n) => Math.max(n, 0);
  const cr = (n) => Math.max(-n, 0);
  const ledgers = [...b.charts, ...partyLedgers(b)];
  const ledger = ref(ledgers, f.ledger);
  const closingById = new Map(closing.map((row) => [row.id, row.d - row.c]));
  const dTotal = closing.reduce((sum, row) => sum + dr(row.d - row.c), 0);
  const cTotal = closing.reduce((sum, row) => sum + cr(row.d - row.c), 0);
  return (
    <>
      {heading(
        'Financial reports',
        'Review the trial balance, period activity, open bills, and GST ledger entries.',
        booksNav(),
      )}
      {panel(
        'Period and ledger',
        <>
          {form(
            'report-filter',
            <>
              {periodFields(f)}
              {select('Ledger detail', 'ledger', accountList(ledgers), {
                initial: f.ledger,
                required: false,
              })}
            </>,
            'Apply filter',
          )}
          {actions(
            button('Export voucher lines CSV', {
              'data-voucher-export': 'reports',
            }),
          )}
        </>,
      )}
      {split(
        panel(
          'Profit and loss',
          table(
            ['Ledger', 'Activity INR'],
            movement
              .filter((a) => ['Income', 'Expense'].includes(a.group) && (a.c || a.d))
              .map((a) => [h(a.name), cents(a.group === 'Income' ? a.c - a.d : a.d - a.c)])
              .concat([
                ['Income', cents(income)],
                ['Expenses', cents(expenses)],
                ['Net profit / loss', cents(income - expenses)],
              ]),
          ),
        ),
        panel(
          'Balance sheet',
          table(
            ['Closing balance', 'INR'],
            [
              ['Assets', cents(total(closing, ['Asset']))],
              ['Liabilities', cents(liabilities)],
              ['Equity before earnings', cents(equity)],
              ['Cumulative earnings', cents(earnings)],
              ['Liabilities and equity', cents(liabilities + equity + earnings)],
            ],
          ),
        ),
      )}
      {panel(
        'Trial balance',
        table(
          ['Ledger / group', 'Opening', 'Debit activity', 'Credit activity', 'Closing Dr', 'Closing Cr'],
          movement
            .filter((a) => a.d || a.c || closingById.get(a.id))
            .map((a) => {
              const net = closingById.get(a.id);
              return [
                <>
                  {ledgerLink(a.id, a.name)}
                  <br />
                  <small>{h(ledgerGroupOf(a))}</small>
                </>,
                shownBalance(net - a.d + a.c),
                cents(a.d),
                cents(a.c),
                cents(dr(net)),
                cents(cr(net)),
              ];
            })
            .concat([
              [
                'Total',
                '—',
                cents(movement.reduce((sum, a) => sum + a.d, 0)),
                cents(movement.reduce((sum, a) => sum + a.c, 0)),
                cents(dTotal),
                cents(cTotal),
              ],
            ]),
        ),
      )}
      {panel('Open receivables and payables', billsTable(open, f.end))}
      {panel(
        'Posted GST register',
        table(
          ['Date', 'Voucher', 'Party', 'Output GST', 'ITC'],
          orderedVouchers(b, f.start, f.end)
            .filter((v) => v.lines.some((l) => ['GSTOUT', 'ITC'].includes(l.a)))
            .map((v) => [
              h(v.date),
              voucherLink(v),
              h(v.party),
              cents(v.lines.filter((l) => l.a === 'GSTOUT').reduce((sum, l) => sum + l.c - l.d, 0)),
              cents(v.lines.filter((l) => l.a === 'ITC').reduce((sum, l) => sum + l.d - l.c, 0)),
            ]),
        ),
      )}
      {ledger ? statementPanel(b, ledger, f) : ''}
    </>
  );
}
export { Reports };
function csv(rows) {
  return (
    '\ufeff' +
    rows
      .map((row) =>
        row
          .map((value) => {
            const cell = typeof value === 'string' && /^\s*[=+\-@]/.test(value) ? "'" + value : String(value ?? '');
            return '"' + cell.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}
export function voucherCsv(app, view = 'reports') {
  const b = book(app.data);
  const f = view === 'day-book' ? dayPeriod(app) : reportPeriod(app);
  const rows = view === 'day-book' ? booksRows(b, f) : orderedVouchers(b, f.start, f.end);
  return csv([
    [
      'Date',
      'Voucher',
      'Type',
      'Party',
      'Source reference',
      'Ledger',
      'Debit INR',
      'Credit INR',
      'Document currency',
      'INR rate',
    ],
    ...rows.flatMap((v) =>
      v.lines.map((l) => [
        v.date,
        v.number,
        v.type,
        v.party,
        v.source?.reference || '',
        l.a,
        l.d / 100,
        l.c / 100,
        v.currency,
        v.rate,
      ]),
    ),
  ]);
}
export function ledgerCsv(app, key) {
  const b = book(app.data);
  const f = ledgerPeriod(app);
  const ledger = ref(ledgerList(b), key);
  if (!ledger) throw new Error('Select a ledger.');
  const { opening, entries, closing } = ledgerStatement(b, ledger, f.start, f.end);
  return csv([
    ['Ledger', ledger.name, 'From', f.start, 'Through', f.end],
    [
      'Date',
      'Voucher',
      'Type',
      'Particulars',
      'Debit INR',
      'Credit INR',
      'Balance INR (positive debit, negative credit)',
    ],
    [f.start, '', 'Opening', '', '', '', opening / 100],
    ...entries.map(({ voucher: v, d, c, balance, counterparts }) => [
      v.date,
      v.number,
      v.type,
      [counterparts.join(', '), ledger.account ? '' : v.party, v.note].filter(Boolean).join(' · '),
      d / 100,
      c / 100,
      balance / 100,
    ]),
    [f.end, '', 'Closing', '', '', '', closing / 100],
  ]);
}
