import { SelectControl, joinContent } from './react-ui.jsx';
import { today, ref } from '../src/model.js';
export const h = (input) => String(input ?? '');
export const fmt = (n) =>
  Number(n ?? 0).toLocaleString('en-IN', {
    maximumFractionDigits: 6,
  });
export const money = (n, currency = 'INR') =>
  Number(n ?? 0).toLocaleString('en-IN', {
    style: 'currency',
    currency,
  });
export const can = (app, action) => app.user.actions.includes(action);
export const valueOf = (value, fallback = '—') => (value ? h(value) : fallback);
export const showQty = (value, unit) => h(fmt(value) + (unit ? ' ' + unit : ''));
export const badge = (label, kind = '') => <span className={'badge ' + kind}>{h(label)}</span>;
export const txStatus = (s) =>
  badge(
    s,
    [
      'Pending inspection',
      'Draft',
      'With processor',
      'Part returned',
      'Hold',
      'Under review',
      'Pending verification',
      'Rework',
    ].includes(s)
      ? 'warn'
      : ['Rejected', 'Suspended', 'Withdrawn', 'Blocked'].includes(s)
        ? 'bad'
        : '',
  );
export const button = (label, attrs, kind = 'secondary') => (
  <button className={'button ' + kind} type="button" {...attrs}>
    {h(label)}
  </button>
);
export const linkButton = (label, type, data) => (
  <button
    type="button"
    className="link"
    {...{
      ['data-' + type]: h(data),
    }}>
    {h(label)}
  </button>
);
export const navLink = (label, page) => (
  <a className="button secondary" href={'#' + encodeURIComponent(page)}>
    {h(label)}
  </a>
);
export const lotLink = (id) => (id ? linkButton(id, 'lot', id) : '—');
export const washLink = (id, label = 'Open wash batch') => (
  <a href={'#washing?batch=' + encodeURIComponent(id)}>{h(label)}</a>
);
export const finishBatchLink = (id, label) => (
  <a href={'#fabric-finishing?batch=' + encodeURIComponent(id)}>{h(label)}</a>
);
export const printBatchLink = (id, label) => <a href={'#printing?batch=' + encodeURIComponent(id)}>{h(label)}</a>;
export const embroideryBatchLink = (id, label) => (
  <a href={'#embroidery?batch=' + encodeURIComponent(id)}>{h(label)}</a>
);
export const docs = (d) => (d?.id ? <a href={'/api/documents/' + encodeURIComponent(d.id)}>{h(d.label)}</a> : '—');
export const heading = (title, desc, actions = '') => (
  <div className="heading">
    <div className="heading-copy">
      <small className="heading-eyebrow">HAPZO WORKSPACE</small>
      <h1>{h(title)}</h1>
      {desc ? <p>{h(desc)}</p> : ''}
    </div>
    {actions ? <div className="actions">{actions}</div> : ''}
  </div>
);
export const panel = (title, body) => (
  <section className="panel">
    <h2>{h(title)}</h2>
    {body}
  </section>
);
export const split = (...items) => <div className="split">{joinContent(items, '')}</div>;
export const actions = (...items) => <div className="actions">{joinContent(items.filter(Boolean), '')}</div>;
export const note = (text, warn = false) => <p className={'note' + (warn ? ' warn' : '')}>{h(text)}</p>;
export const empty = (text = 'No records yet.') => <p className="empty">{h(text)}</p>;
export const details = (title, body, open = false) => (
  <details className="panel" open={open}>
    <summary>{h(title)}</summary>
    {body}
  </details>
);
export const cards = (pairs) => (
  <div className="cards">
    {joinContent(
      pairs.map(([k, v]) => (
        <div className="tile">
          <small>{h(k)}</small>
          <strong>{h(v)}</strong>
        </div>
      )),
      '',
    )}
  </div>
);
export const facts = (rows) => (
  <dl className="facts">
    {joinContent(
      rows.map(([k, v]) => (
        <div>
          <dt>{h(k)}</dt>
          <dd>{v}</dd>
        </div>
      )),
      '',
    )}
  </dl>
);
export function table(cols, rows, noRows) {
  return rows.length ? (
    <div className="table">
      <table>
        <thead>
          <tr>
            {joinContent(
              cols.map((head) => <th scope="col">{h(head)}</th>),
              '',
            )}
          </tr>
        </thead>
        <tbody>
          {joinContent(
            rows.map((row) => (
              <tr>
                {joinContent(
                  row.map((v) => <td>{v ?? '—'}</td>),
                  '',
                )}
              </tr>
            )),
            '',
          )}
        </tbody>
      </table>
    </div>
  ) : (
    empty(noRows)
  );
}
export const option = (value, label, selected) => (
  <option value={h(value)} selected={String(selected ?? '') === String(value)}>
    {h(label ?? value)}
  </option>
);
export function select(label, name, values, { required = true, initial = '', blank = 'Select…', hook = '', hidden = false } = {}) {
  return (
    <label hidden={hidden}>
      {h(label)}
      <SelectControl name={h(name)} required={required} data-hook={hook ? h(hook) : undefined}>
        {option('', blank, initial)}
        {joinContent(
          values.map((x) => (Array.isArray(x) ? option(x[0], x[1], initial) : option(x, x, initial))),
          '',
        )}
      </SelectControl>
    </label>
  );
}
const geminiStatuses = {
  live: 'Live',
  timeout: 'Timed out',
  unavailable: 'Unavailable',
  failed: 'Read failed',
  untested: 'Untested',
};
const geminiChoice = (model) => model.label + ' · ' + (geminiStatuses[model.status] || geminiStatuses.untested);
export const geminiModelOptions = (models, selected) => (
  <>
    {option('', 'Automatic', selected)}
    {joinContent(
      models.map((model) => option(model.id, geminiChoice(model), selected)),
      '',
    )}
  </>
);
export function geminiModelField(models = []) {
  return (
    <>
      <label className="wide">
        Gemini model
        <SelectControl name="geminiModel">{geminiModelOptions(models, '')}</SelectControl>
        <small className="muted">Status reflects reads in this workspace over the last 15 minutes.</small>
      </label>
      <p className="sub note wide" data-gemini-notice="" role="status" hidden />
    </>
  );
}
export function geminiRetryMessage(retry, pending = false) {
  const reason =
    retry.status === 'timeout' ? 'timed out' : retry.status === 'unavailable' ? 'was unavailable' : 'could not finish';
  const first = retry.from + ' ' + reason + '. ';
  return first + (pending ? 'Retrying with ' : 'Retried with ') + retry.to + '.';
}
export function field(
  label,
  name,
  { type = 'text', required = true, value = '', placeholder = '', min, step, max, autocomplete, wide } = {},
) {
  return (
    <label className={wide ? 'wide' : undefined}>
      {h(label)}
      <input
        type={h(type)}
        name={h(name)}
        defaultValue={h(value)}
        required={required}
        placeholder={placeholder ? h(placeholder) : undefined}
        min={min != null ? h(min) : undefined}
        max={max != null ? h(max) : undefined}
        step={step ? h(step) : undefined}
        autoComplete={autocomplete ? h(autocomplete) : undefined}
      />
    </label>
  );
}
export const numberField = (label, name, props = {}) =>
  field(label, name, {
    type: 'number',
    min: 0,
    step: 'any',
    ...props,
  });
export const day = (label = 'Posting date', name = 'date', required = true) =>
  field(label, name, {
    type: 'date',
    required,
    value: required ? today() : '',
  });
export const text = (label, name, placeholder = '', required = false, value = '') => (
  <label className="wide">
    {h(label)}
    <textarea name={h(name)} required={required} placeholder={h(placeholder)} defaultValue={h(value)} />
  </label>
);
export const check = (label, name, checked = false) => (
  <label className="check">
    <input type="checkbox" name={name} value="yes" defaultChecked={checked} /> {label}
  </label>
);
export const file = (
  label = 'Supporting document',
  bucket = 'stock',
  name = 'document',
  multiple = false,
  { accept = '.pdf,image/png,image/jpeg', required = false } = {},
) => (
  <label className="wide">
    {h(label)}
    <input
      type="file"
      name={h(name)}
      data-bucket={h(bucket)}
      accept={h(accept)}
      multiple={multiple}
      required={required}
    />
  </label>
);
export const hidden = (name, value) => <input type="hidden" name={h(name)} defaultValue={h(value)} />;
export const form = (action, fields, label, message = '') => (
  <form data-form={h(action)}>
    <div className="fields">{fields}</div>
    {message ? note(message) : ''}
    <button className="button">{h(label)}</button>
  </form>
);
export function editor(app, action, title, fields, label, message, open = false) {
  return can(app, action) ? details(title, form(action, fields, label, message), open) : '';
}
export const choose = (label, name, rows, fn, opts) =>
  select(
    label,
    name,
    rows.map((r) => [r.id, fn(r)]),
    opts,
  );
export const titles = {
  party: (p) => p.code + ' · ' + p.name,
  item: (i) => i.code + ' · ' + i.name + ' (' + i.unit + ')',
  location: (l) => l.code + ' · ' + [l.site, l.warehouse, l.bin].filter(Boolean).join(' / '),
  lot: (l) => l.id + ' · ' + l.material + ' · ' + fmt(l.qty) + ' ' + l.unit,
  order: (o) => o.po + ' · ' + o.buyer,
  wo: (w) => w.number + ' · ' + w.stage,
};
export const lineLabel = (s, l) =>
  (ref(s.orders, l.orderId)?.po || '') +
  ' · ' +
  l.lineNo +
  ' · ' +
  l.style +
  ' / ' +
  l.color +
  ' / ' +
  l.size +
  ' · ' +
  l.id;
export const shortDate = (d) => (d ? h(String(d).slice(0, 10)) : '—');
export const passportUrl = (app, p) => app.user.publishedOrigin + '/p/' + encodeURIComponent(p.token);
