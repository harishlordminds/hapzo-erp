import { SelectControl, appendContents, joinContent, removeRow, renderApp, renderDialog, setContents } from './react-ui.jsx';
import { norm, ref, STAGES, validDate } from '../src/model.js';
import {
  can,
  h,
  button,
  form,
  field,
  check,
  option,
  note,
  details,
  empty,
  geminiModelOptions,
  geminiRetryMessage,
  table,
} from './ui.jsx';
import * as operations from './pages.jsx';
import * as compliance from './compliance-ui.jsx';
import * as geminiUi from './gemini-ui.jsx';
import * as finance from './finance-ui.jsx';
import {
  FabricPage,
  fabricReportDetail,
  fabricTechPackReview,
  loadFabricCalculator,
  refreshFabricEditor,
  selectFabricLot,
} from './fabric-ui.jsx';
import * as garments from './garment-ui.jsx';
import * as dyeing from './yarn-dyeing-ui.jsx';
import * as fibreUi from './fibre-ui.jsx';
import * as spinUi from './spinning-ui.jsx';
import * as knitUi from './knitting-ui.jsx';
import * as weaveUi from './weaving-ui.jsx';
import * as fdUi from './fabric-dyeing-ui.jsx';
import * as ffUi from './fabric-finishing-ui.jsx';
import * as washUi from './washing-ui.jsx';
import * as printUi from './printing-ui.jsx';
import * as garmentProduction from './garment-production-ui.jsx';
import { same } from '../src/claim-scope.js';
import { PO_IMPORT_ACTION } from '../src/po-import.js';
import { previewApi, previewFile } from './preview-store.js';
import jsQR from 'jsqr';
const nodeWorkspace = document.documentElement.dataset.runtime === 'node';
const localWorkspace = nodeWorkspace && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const companyRequested = new URLSearchParams(window.location.search).get('workspace') === 'company';
let useSampleData = !nodeWorkspace;
const app = {
  user: null,
  data: null,
  initialized: true,
  local: {},
};
const root = document.querySelector('#app');
const dialog = document.querySelector('#detail-dialog');
const brands = (
  <>
    <span className="mark" aria-hidden="true">
      <svg viewBox="0 0 36 36">
        <path
          d="M29.6 5.2C17.2 5.7 9 10.8 7.1 18.5c-1.7 6.8 3.7 12.7 10.4 11.5 8.7-1.6 13.3-10.7 12.1-24.8Z"
          fill="currentColor"
        />
        <path
          d="M7.8 19.5c5.2 1.4 10.5 4.8 14 9.8M11.2 13.5c5.7 1.5 10.7 4.4 14.1 8.8M16.6 9.6c4.1 1.1 7.6 3.3 10.1 6.1"
          fill="none"
          stroke="var(--mark-line,#fff)"
          strokeLinecap="round"
          strokeWidth="1.4"
        />
      </svg>
    </span>
    <span>
      HAPZO
      <small>Decaste · Endless Business</small>
    </span>
  </>
);
const themes = [
  ['aqua', 'Aqua / Mint'],
  ['blush', 'Blush / Rose'],
  ['warm', 'Warm Ivory / Sand'],
  ['lime', 'Fresh Lime / Sage'],
];
function applyTheme(name) {
  const theme = themes.some(([key]) => key === name) ? name : 'warm';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('hapzo-theme', theme);
  } catch {}
  for (const button of document.querySelectorAll('[data-theme-choice]')) {
    const selected = button.dataset.themeChoice === theme;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('selected', selected);
  }
}
try {
  applyTheme(localStorage.getItem('hapzo-theme') || 'warm');
} catch {
  applyTheme('warm');
}
const themePicker = () => (
  <div className="theme-picker" role="group" aria-label="Choose a color theme">
    <span>Choose a theme</span>
    {joinContent(
      themes.map(([key, label]) => (
        <button type="button" data-theme-choice={key} aria-label={label + ' theme'} title={label} />
      )),
      '',
    )}
  </div>
);
const pages = new Map([
  ['overview', ['Overview', 'Workspace', operations.Overview]],
  ['orders', ['Buyer orders', 'Commercial', operations.Orders]],
  ['po-flow', ['PO flowchart', 'Commercial', operations.PoFlow]],
  ['fabric', ['Fabric specs', 'Commercial', FabricPage]],
  ['tech-pack', ['Garment tech packs', 'Commercial', garments.GarmentPage]],
  ['purchase', ['Planning & purchase', 'Commercial', operations.Procurement]],
  ['stock', ['Inventory', 'Manufacturing', operations.Stock]],
  ['floor', ['Work orders', 'Manufacturing', operations.Floor]],
  ['fibre', ['Ginning & fibre', 'Manufacturing', fibreUi.FibrePage]],
  ['spinning', ['Spinning', 'Manufacturing', spinUi.SpinningPage]],
  ['knitting', ['Knitting', 'Manufacturing', knitUi.KnittingPage]],
  ['weaving', ['Weaving', 'Manufacturing', weaveUi.WeavingPage]],
  ['fabric-dyeing', ['Fabric dyeing', 'Manufacturing', fdUi.FabricDyeingPage]],
  ['fabric-finishing', ['Fabric finishing', 'Manufacturing', ffUi.FabricFinishingPage]],
  ['yarn-dyeing', ['Yarn dyeing', 'Manufacturing', dyeing.YarnDyeing]],
  ['washing', ['Washing', 'Manufacturing', washUi.WashingPage]],
  ['printing', ['Printing', 'Manufacturing', printUi.PrintingPage]],
  ['cutting', ['Cutting', 'Manufacturing', garmentProduction.CuttingPage]],
  ['embroidery', ['Embroidery', 'Manufacturing', printUi.EmbroideryPage]],
  ['stitching', ['Stitching', 'Manufacturing', garmentProduction.StitchingPage]],
  ['garment-finishing', ['Garment finishing', 'Manufacturing', garmentProduction.GarmentFinishingPage]],
  ['quality', ['Quality & lab', 'Manufacturing', operations.Quality]],
  ['jobwork', ['Outside job work', 'Manufacturing', operations.Jobwork]],
  ['equipment', ['Machines & readings', 'Manufacturing', operations.Equipment]],
  ['packing', ['Packing', 'Fulfilment', garmentProduction.PackingPage]],
  ['logistics', ['Dispatch & logistics', 'Fulfilment', operations.Logistics]],
  ['invoices', ['Invoices & costs', 'Finance', finance.Invoices]],
  ['accounts', ['Accounts & vouchers', 'Finance', finance.Accounts]],
  ['ledgers', ['Ledgers', 'Finance', finance.Ledgers]],
  ['day-book', ['Day book', 'Finance', finance.DayBook]],
  ['reports', ['Financial reports', 'Finance', finance.Reports]],
  ['trace', ['Scan & trace', 'Product records', compliance.Trace]],
  ['standards', ['Standards & evidence', 'Product records', compliance.Standards]],
  ['passports', ['Digital Product Passports', 'Product records', compliance.Passports]],
  ['masters', ['Company masters', 'Administration', operations.Masters]],
  ['settings', ['Settings & data', 'Administration', compliance.Settings]],
  ['gemini-models', ['Gemini Model API', 'AI settings', geminiUi.GeminiSettings]],
  ['buyer', ['My orders', 'Buyer portal', compliance.Buyer]],
]);
const allowed = (key) =>
  key === 'gemini-models'
    ? app.user.role === 'Admin'
    : app.user.role === 'Buyer'
      ? ['buyer', 'settings'].includes(key)
      : key !== 'buyer' && (pages.get(key)?.[1] !== 'Finance' || ['Admin', 'Finance'].includes(app.user.role));
const moduleItems = [
  {
    id: 'dashboard',
    group: 'Workspace',
    label: 'Dashboard',
    icon: '⌂',
    description: 'A live overview of your people, orders, production, and company records.',
  },
  {
    id: 'commercial',
    group: 'Commercial',
    label: 'Commercial',
    icon: '▤',
    description: 'Buyer orders, product specifications, purchase planning, and supplier workflows.',
  },
  {
    id: 'manufacturing',
    group: 'Manufacturing',
    label: 'Manufacturing',
    icon: '⚙',
    description: 'Plan and track materials, work orders, production routes, and quality.',
  },
  {
    id: 'fulfilment',
    group: 'Fulfilment',
    label: 'Fulfilment',
    icon: '➜',
    description: 'Pack finished goods and manage dispatch, delivery, and logistics.',
  },
  {
    id: 'finance',
    group: 'Finance',
    label: 'Finance',
    icon: '₹',
    description: 'Manage invoices, vouchers, ledgers, and financial reports.',
  },
  {
    id: 'social-compliance-system',
    group: 'Product records',
    label: 'Social Compliance System',
    icon: '◇',
    description: 'Trace materials, manage standards and evidence, and publish product passports.',
  },
  {
    id: 'administrations',
    group: 'Administration',
    label: 'Administrations',
    icon: '⚙',
    description: 'Configure company masters, workspace settings, and access.',
  },
  {
    id: 'gemini-model-api',
    group: 'AI settings',
    label: 'Gemini Model API',
    icon: '✧',
    description: 'Configure the Gemini API key and select the models used for document reading.',
  },
  {
    id: 'buyer-portal',
    group: 'Buyer portal',
    label: 'Buyer portal',
    icon: '▣',
    description: 'Review your orders, shipments, and product records.',
  },
];
const moduleById = new Map(moduleItems.map((item) => [item.id, item]));
const moduleByGroup = new Map(moduleItems.map((item) => [item.group, item]));
const moduleDescription = {
  overview: 'Monitor the main signals from your connected operations.',
  orders: 'Review and update buyer purchase orders.',
  'po-flow': 'Follow a purchase order through each production and delivery stage.',
  fabric: 'Maintain fabric specifications and construction details.',
  'tech-pack': 'Create and review garment product specifications.',
  purchase: 'Plan material demand and manage purchasing.',
  stock: 'Receive, locate, and track inventory.',
  floor: 'Release and track production work orders.',
  fibre: 'Track fibre intake, ginning, and bale genealogy.',
  spinning: 'Manage spinning batches, output, and yarn traceability.',
  knitting: 'Plan knitting orders and record fabric output.',
  weaving: 'Manage warp, weft, loom runs, and fabric rolls.',
  'fabric-dyeing': 'Record fabric dyeing batches and measurable output.',
  'fabric-finishing': 'Track finishing routes and finished fabric lots.',
  'yarn-dyeing': 'Manage yarn dyeing batches and dyed yarn lots.',
  washing: 'Plan and record in-house and commission washing.',
  printing: 'Manage fabric, garment, and panel printing.',
  cutting: 'Plan cutting work and record garment components.',
  embroidery: 'Track embroidery orders and panel movement.',
  stitching: 'Manage sewing lines and production output.',
  'garment-finishing': 'Record garment finishing and inspection.',
  quality: 'Record inspections, test results, and quality decisions.',
  jobwork: 'Track material sent to and received from outside processors.',
  equipment: 'Maintain machines and operational readings.',
  packing: 'Build cartons and prepare finished goods for dispatch.',
  logistics: 'Manage shipments, delivery records, and freight.',
  invoices: 'Review invoices, service costs, and financial documents.',
  accounts: 'Post receipts, payments, journals, and contra vouchers.',
  ledgers: 'Review account activity and balances.',
  'day-book': 'Review posted vouchers by date.',
  reports: 'Review financial position and performance.',
  trace: 'Search lots and inspect their production history.',
  standards: 'Manage standards, evidence, and compliance reviews.',
  passports: 'Create and publish digital product passports.',
  masters: 'Manage company-wide reference data.',
  settings: 'Manage workspace settings, members, and data.',
  buyer: 'Review your company orders and product records.',
};
let current = '';
let scanStream;
let lastDataRequest = 0;
const pending = new WeakMap();
const cachedUploads = new WeakMap();
class ApiError extends Error {
  constructor(body, status) {
    super(body.error || 'Request failed.');
    this.code = body.code;
    this.status = status;
    this.retry = body.retry;
  }
}
async function request(url, data) {
  const response = await fetch(
    url,
    data === undefined
      ? {}
      : {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new ApiError(result, response.status);
  return result;
}
function api(url, data) {
  return useSampleData ? previewApi(url, data) : request(url, data);
}
async function localPoDraft(file, id, aiError) {
  const { readBuyerPdf } = await import('./po-reader.js');
  const draft = await readBuyerPdf(file, { id, label: file.name });
  if (aiError) {
    draft.readNotice = (aiError.code === 'ai-unavailable' ? aiError.message + ' ' : '') +
      'Your browser read the PDF. Review the extracted fields and save when ready.';
    if (aiError.code !== 'ai-unavailable') draft.aiDiagnostic = aiError.message;
  }
  return draft;
}
async function savedPoPdf(id) {
  if (app.user.frontendPreview) return previewFile(id);
  const response = await fetch('/api/documents/' + encodeURIComponent(id));
  if (!response.ok) throw new Error('This uploaded PO is unavailable in the current workspace.');
  if (response.headers.get('Content-Type')?.split(';')[0] !== 'application/pdf') throw new Error('Choose an uploaded PDF.');
  const filename = response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  return new File([await response.blob()], filename ? decodeURIComponent(filename) : 'Purchase order.pdf', { type: 'application/pdf' });
}
const signed = (url, data = {}) =>
  api(url, {
    ...data,
    companyId: app.user.companyId,
  });
const flash = (message = '', error = false) => {
  const el = document.querySelector('#flash');
  if (!el) return;
  el.hidden = !message;
  el.classList.toggle('err', error);
  el.textContent = message;
};
const errorText = (err) => err.message;
function pageFromUrl() {
  const key = window.location.hash.slice(1).split('?')[0];
  if (allowed(key) && pages.has(key)) return key;
  const moduleId = new URLSearchParams(window.location.search).get('module');
  const selectedModule = moduleById.get(moduleId);
  if (selectedModule?.id === 'gemini-model-api' && allowed('gemini-models')) return 'gemini-models';
  if (selectedModule && (selectedModule.group === 'Workspace' || selectedModule.group === 'Buyer portal')) {
    const target = selectedModule.group === 'Buyer portal' ? 'buyer' : 'overview';
    if (allowed(target)) return target;
  }
  if (selectedModule && [...pages].some(([page, [, group]]) => group === selectedModule.group && allowed(page)))
    return 'module:' + selectedModule.group;
  return app.user.role === 'Buyer' ? 'buyer' : 'overview';
}
function routeParams() {
  return new URLSearchParams(window.location.hash.split('?')[1] || '');
}
function go(next) {
  if (window.location.hash === '#' + next) render();
  else window.location.hash = next;
}
function goModule(moduleId) {
  const item = moduleById.get(moduleId);
  if (!item) return;
  const url = new URL(window.location.href);
  url.searchParams.set('module', moduleId);
  url.hash = '';
  window.history.pushState({}, '', url);
  handleRoute();
}
function moduleLanding(group) {
  const item = moduleByGroup.get(group);
  if (!item) return '';
  const links = [...pages].filter(([key, [, pageGroup]]) => pageGroup === group && allowed(key));
  return (
    <section className="module-landing">
      <header className="module-hero">
        <span className="module-hero-icon" aria-hidden="true">
          {h(item.icon)}
        </span>
        <div>
          <p className="heading-eyebrow">HAPZO MODULE</p>
          <h1>{h(item.label)}</h1>
          <p>{h(item.description)}</p>
        </div>
      </header>
      <div className="module-section-heading">
        <div>
          <p className="heading-eyebrow">WORKSPACE</p>
          <h2>Choose a workspace</h2>
        </div>
        <span>
          {links.length}
          {links.length === 1 ? ' workspace' : ' workspaces'}
        </span>
      </div>
      <div className="module-card-grid">
        {joinContent(
          links.map(([key, [label]]) => (
            <a className="module-card" href={'#' + encodeURIComponent(key)}>
              <span className="module-card-icon" aria-hidden="true">
                {h(
                  {
                    overview: '⌂',
                    orders: '▤',
                    standards: '◇',
                    passports: '▱',
                    settings: '⚙',
                  }[key] || item.icon,
                )}
              </span>
              <span className="module-card-copy">
                <strong>{h(label)}</strong>
                <small>{h(moduleDescription[key] || 'Open this workspace to manage its records and workflow.')}</small>
              </span>
              <span className="module-card-arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          )),
          '',
        )}
      </div>
    </section>
  );
}
async function load(renderPage = true) {
  const latest = ++lastDataRequest;
  const result = await api('/api/state');
  const members =
    result.user.role === 'Admin' && window.location.hash === '#settings' ? await api('/api/members') : null;
  if (latest !== lastDataRequest) return;
  const changed = app.user?.companyId !== result.user.companyId;
  if (changed) app.local = {};
  app.user = result.user;
  app.data = result.data;
  if (members) app.local.members = members.members;
  if (renderPage) {
    render();
    await openLinkedPo();
  }
}
async function handleRoute() {
  if (!app.user) return;
  const next = pageFromUrl();
  if (dialog.open) dialog.close();
  if (next !== current || routeParams().has('batch')) {
    window.scrollTo(0, 0);
  }
  render();
  if (next === 'tech-pack') await openLinkedPo();
  if (next === 'ledgers' && routeParams().has('ledger'))
    document.querySelector('#ledger-statement')?.scrollIntoView({
      block: 'start',
    });
  if (next === 'po-flow' && app.local.flowFocus) {
    const target = app.local.flowFocus;
    app.local.flowFocus = '';
    document.querySelector(target)?.focus({
      preventScroll: true,
    });
    if (target === '#flow-phase-title')
      document.querySelector('.po-flow-selection')?.scrollIntoView({
        block: 'start',
      });
  }
  if (next === 'passports' && app.local.focusPassport) {
    app.local.focusPassport = false;
    document.querySelector('#passport-section')?.scrollIntoView({
      block: 'start',
    });
  }
  if (next === 'settings' && app.user.role === 'Admin') {
    const companyId = app.user.companyId;
    try {
      const data = await api('/api/members');
      if (current === 'settings' && app.user?.companyId === companyId) {
        app.local.members = data.members;
        render();
      }
    } catch (err) {
      await showError(err);
    }
  }
}
function SignIn() {
  const initial = !app.initialized;
  const loginFields = initial ? (
    <>
      {field('Company name', 'companyName', {
        value: 'HAPZO Decaste',
      })}
      {field('Your name', 'displayName', {
        autocomplete: 'name',
      })}
    </>
  ) : (
    ''
  );
  return (
    <main className="login-layout" onClick={handleClick} onSubmit={handleSubmit}>
      <section className="auth-story">
        <header className="auth-brand">
          <a className="brand" href="/">
            {brands}
          </a>
          <span className="connected-badge">
            <i />
            {' Connected textile operations'}
          </span>
        </header>
        <div className="story-copy">
          <p className="eyebrow">ENDLESS BUSINESS</p>
          <h1>
            {'Clarity for every thread of your '}
            <em>business.</em>
          </h1>
          <p className="story-description">
            A connected workspace for orders, manufacturing, standards, and product passports across your textile
            business.
          </p>
          <div className="story-points">
            <span>
              <b>✓</b>
              {' Thoughtful access control'}
            </span>
            <span>
              <b>✦</b>
              {' Standards-led foundation'}
            </span>
          </div>
        </div>
        <footer className="auth-attribution">
          {'Developed by '}
          <strong>Lordminds Private Limited</strong>
          <span>·</span>
          {' Powered by '}
          <strong>Mentaguide</strong>
        </footer>
      </section>
      <section className="auth-panel">
        <div className="auth-theme">{themePicker()}</div>
        <section className="auth-card">
          <span className="auth-card-mark" aria-hidden="true">
            ✿
          </span>
          <p className="eyebrow">HAPZO · DECASTE</p>
          <h2>{initial ? 'Create your workspace' : 'Welcome back'}</h2>
          <p className="auth-subtitle">
            {initial
              ? 'Set up your company and administrator login to get started.'
              : 'Sign in to continue to your company workspace.'}
          </p>
          <div id="flash" className="flash" role="status" hidden />
          {form(
            initial ? 'setup' : 'login',
            <>
              {loginFields}
              {field('Login', 'login', {
                autocomplete: 'username',
              })}
              {field('Password', 'password', {
                type: 'password',
                autocomplete: initial ? 'new-password' : 'current-password',
              })}
            </>,
            initial ? 'Create workspace' : 'Sign in',
            initial ? 'Use a password of at least 12 characters.' : '',
          )}
        </section>
        <footer className="auth-copyright">
          {'© '}
          {new Date().getFullYear()}
          {' Hapzo Decaste'}
        </footer>
      </section>
    </main>
  );
}
function Workspace({ selected }) {
  const Screen = pages.get(selected)?.[2];
  const groups = new Map();
  for (const [key, [label, group]] of pages) {
    if (!allowed(key)) continue;
    const links = groups.get(group) ?? [];
    links.push({
      key,
      label,
    });
    groups.set(group, links);
  }
  const activeGroup = selected.startsWith('module:') ? selected.slice(7) : pages.get(selected)?.[1];
  const nav = joinContent(
    [...groups].map(([name, links]) => {
      const module = moduleByGroup.get(name);
      if (!module) return '';
      return (
        <div className="nav-group">
          <a
            href={'?module=' + encodeURIComponent(module.id)}
            data-module-link={h(module.id)}
            aria-current={name === activeGroup ? 'page' : undefined}>
            <span className="nav-icon" aria-hidden="true">
              {h(module.icon)}
            </span>
            <span>{h(module.label)}</span>
          </a>
        </div>
      );
    }),
    '',
  );
  const companies = joinContent(
    app.user.companies.map((c) => option(c.id, c.name, app.user.companyId)),
    '',
  );
  return (
    <div className="shell grid min-h-screen" onClick={handleClick} onSubmit={handleSubmit} onInput={handleInput} onChange={handleChange}>
      <aside className="sidebar">
        <div className="sidebar-brand-row">
          <a className="brand" href={'#' + (app.user.role === 'Buyer' ? 'buyer' : 'overview')}>
            {brands}
          </a>
          <button
            className="sidebar-toggle"
            type="button"
            data-sidebar-toggle=""
            aria-label="Collapse navigation"
            aria-expanded="true"
            title="Collapse navigation">
            ‹
          </button>
        </div>
        <label className="sidebar-search">
          <span aria-hidden="true">⌕</span>
          <input id="module-search" type="search" placeholder="Find a module" aria-label="Search modules" />
        </label>
        <nav aria-label="HAPZO modules">
          {nav}
          <p className="nav-empty" hidden>
            No matching modules.
          </p>
        </nav>
        <div className="sidebar-foot">
          <span className="sidebar-avatar">{h((app.user.name || 'H').slice(0, 1).toUpperCase())}</span>
          <span>
            <strong>{h(app.user.name)}</strong>
            <small>{h(app.user.role)}</small>
          </span>
        </div>
      </aside>
      <main className="main min-w-0">
        <header className="topbar">
          <label className="top-search">
            <span aria-hidden="true">⌕</span>
            <input id="global-search" type="search" placeholder="Search modules…" aria-label="Search modules" />
          </label>
          <div className="topbar-tools">
            <label className="company-picker">
              <span>Company</span>
              <SelectControl id="company-select" aria-label="Active company">
                {companies}
              </SelectControl>
            </label>
            <button
              className="button icon-button"
              type="button"
              data-reload="yes"
              aria-label="Refresh workspace"
              title="Refresh">
              ↻
            </button>
            {themePicker()}
            {app.user.frontendPreview ? <span className="local-bypass-badge">Frontend preview</span> : ''}
            <div className="user-profile">
              <span className="profile-avatar">{h((app.user.name || 'H').slice(0, 1).toUpperCase())}</span>
              <span>
                <strong>{h(app.user.name)}</strong>
                <small>{h(app.user.role)}</small>
              </span>
            </div>
            {app.user.frontendPreview
              ? ''
              : button(
                  'Sign out',
                  {
                    'data-logout': 'yes',
                  },
                  'secondary',
                )}
          </div>
        </header>
        {app.user.frontendPreview ? (
          <div className="local-access-notice" role="status">
            Training workspace · sample data and changes are saved in this browser.
            {localWorkspace && <> <a href="/?workspace=company">Open company workspace</a></>}
          </div>
        ) : (
          ''
        )}
        <div id="flash" className="flash" role="status" hidden />
        <div className="container" id="workspace-page">
          {selected.startsWith('module:') ? (
            moduleLanding(selected.slice(7))
          ) : (
            <Screen app={app} params={routeParams()} />
          )}
        </div>
      </main>
    </div>
  );
}
function render() {
  if (!app.user || !app.data) {
    renderApp(<SignIn />);
    applyTheme(document.documentElement.dataset.theme);
    return;
  }
  const selected = pageFromUrl();
  current = selected;
  renderApp(<Workspace selected={selected} />);
  try {
    root.classList.toggle('sidebar-collapsed', localStorage.getItem('hapzo-sidebar-collapsed') === 'yes');
  } catch {}
  const collapsed = root.classList.contains('sidebar-collapsed');
  const toggle = root.querySelector('[data-sidebar-toggle]');
  if (toggle && collapsed) {
    toggle.textContent = '›';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Expand navigation');
    toggle.title = 'Expand navigation';
  }
  applyTheme(document.documentElement.dataset.theme);
  for (const editor of root.querySelectorAll('[data-fabric-editor]')) refreshFabricEditor(editor, app);
  const settlement = root.querySelector('form[data-form="account-settle"]');
  if (settlement) finance.refreshSettlement(settlement, app);
  if (
    selected === 'gemini-models' &&
    app.local.geminiCatalogCompany !== app.user.companyId &&
    !app.local.geminiCatalogLoading
  ) {
    app.local.geminiCatalogLoading = true;
    queueMicrotask(() => loadGeminiCatalogue(app.user?.companyId));
  }
}
async function showError(error) {
  if (error.code === 'session') {
    if (localWorkspace && !companyRequested) return window.location.reload();
    app.user = null;
    app.data = null;
    app.local = {};
    render();
  }
  if (['workspace-changed', 'ai-provider-changed', 'po-reader-changed'].includes(error.code)) {
    await load();
  }
  flash(errorText(error), true);
}
function fileContent(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',').at(-1));
    reader.onerror = () => reject(new Error('This file could not be read.'));
    reader.readAsDataURL(file);
  });
}
async function upload(input, companyId, file = input.files[0]) {
  if (!file) return '';
  const bucket = input.dataset.bucket;
  const existing = cachedUploads.get(file);
  if (existing?.companyId === companyId && existing.bucket === bucket) return existing.result;
  if (file.size > 10_000_000) throw new Error('Choose a supported file up to 10 MB.');
  const mime = /\.xlsx$/i.test(file.name)
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : file.type ||
      (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg');
  const result = fileContent(file)
    .then((content) =>
      api('/api/documents', {
        companyId,
        bucket,
        name: file.name,
        mime,
        content,
      }),
    )
    .then((doc) => doc.id);
  const uploadState = {
    companyId,
    bucket,
    result,
  };
  cachedUploads.set(file, uploadState);
  try {
    return await result;
  } catch (error) {
    if (cachedUploads.get(file) === uploadState) cachedUploads.delete(file);
    throw error;
  }
}
const poBuyerFields = {
  newBuyerName: 'name',
  newBuyerCurrency: 'currency',
  newBuyerCountry: 'country',
  newBuyerTax: 'taxId',
};
function setPoSuggestion(control, value) {
  if (!control || control.value.trim() || !value) return false;
  control.value = value;
  if (control.value !== value) return false;
  control.dataset.poSuggestion = value;
  return true;
}
function ensureBuyerOption(selector, buyer) {
  if (![...selector.options].some((item) => item.value === buyer.id)) {
    appendContents(selector, option(buyer.id, buyer.code + ' · ' + buyer.name));
  }
  selector.closest('label').hidden = false;
}
function updateGeminiModels(models) {
  if (!app.user?.poAi || !Array.isArray(models)) return;
  const previous = app.user.poAi.models ?? [];
  app.user.poAi.models = models;
  if (
    models.length === previous.length &&
    models.every(
      ({ id, label, status }, i) =>
        id === previous[i].id && label === previous[i].label && status === previous[i].status,
    )
  )
    return;
  for (const field of root.querySelectorAll('select[name="geminiModel"]')) {
    setContents(field, geminiModelOptions(models, field.value));
  }
}
async function loadGeminiCatalogue(companyId = app.user?.companyId, refresh = false) {
  if (!companyId || !app.user?.poAi) return;
  try {
    const result = await api('/api/gemini-models' + (refresh ? '?refresh=1' : ''));
    if (app.user?.companyId !== companyId) return;
    app.local.geminiCatalogue = {
      ...result,
      loading: false,
    };
    app.local.geminiCatalogueError = '';
    app.user.poAi.canManage = result.canManage;
    updateGeminiModels(result.models);
  } catch (error) {
    if (app.user?.companyId === companyId) app.local.geminiCatalogueError = errorText(error);
  } finally {
    if (app.user?.companyId === companyId) {
      app.local.geminiCatalogCompany = companyId;
      app.local.geminiCatalogLoading = false;
      if (current === 'gemini-models') render();
    }
  }
}
async function readWithGeminiNotice(
  path,
  payload,
  form,
  isCurrent = () => form.isConnected && app.user?.companyId === payload.companyId,
) {
  if (payload.provider !== 'gemini') return api(path, payload);
  const companyId = payload.companyId;
  const aiRequestId = crypto.randomUUID();
  const statusUrl = '/api/gemini-models?request=' + aiRequestId;
  const notice = form.querySelector('[data-gemini-notice]');
  const announce = (message = '') => {
    if (!notice || !isCurrent() || notice.textContent === message) return;
    notice.textContent = message;
    notice.hidden = !message;
  };
  announce();
  let polling = false;
  let finished = false;
  const timer = setInterval(async () => {
    if (polling || !isCurrent()) return;
    polling = true;
    try {
      const { models, retry } = await api(statusUrl);
      if (finished || !isCurrent()) return;
      updateGeminiModels(models);
      if (retry) announce(geminiRetryMessage(retry, true));
    } catch {
      /* The document read can finish while status is unavailable. */
    } finally {
      polling = false;
    }
  }, 1500);
  try {
    const result = await api(path, {
      ...payload,
      aiRequestId,
    });
    if (result.retry) announce(geminiRetryMessage(result.retry));
    return result;
  } catch (error) {
    announce(error.retry ? geminiRetryMessage(error.retry) : '');
    throw error;
  } finally {
    finished = true;
    clearInterval(timer);
    if (app.user?.companyId === companyId) {
      api('/api/gemini-models')
        .then(({ models }) => {
          if (app.user?.companyId === companyId) updateGeminiModels(models);
        })
        .catch(() => {});
    }
  }
}
async function readUploadedBuyer(form, payload, isCurrent) {
  const status = form.querySelector('[data-po-buyer-status]');
  if (!status || !app.user.poAi?.geminiReady) return;
  status.hidden = false;
  status.textContent = 'Gemini is identifying the buyer…';
  try {
    const { buyer, mapping } = await readWithGeminiNotice(
      '/api/po-buyer',
      {
        ...payload,
        provider: 'gemini',
        geminiModel: form.elements.geminiModel?.value,
      },
      form,
      isCurrent,
    );
    if (!isCurrent()) return;
    status.title = buyer.source || '';
    for (const [field, key] of Object.entries(poBuyerFields)) setPoSuggestion(form.elements[field], buyer[key]);
    const selector = form.elements.buyerId;
    if (mapping.status === 'matched') {
      const [master] = mapping.candidates;
      if (![...selector.options].some((item) => item.value === master.id)) await load(false);
      if (!isCurrent()) return;
      ensureBuyerOption(selector, master);
      const selected = setPoSuggestion(selector, master.id);
      status.textContent =
        selected || selector.value === master.id
          ? 'Gemini matched ' + master.name + ' in Company masters.'
          : 'Gemini matched ' + master.name + '. The form keeps the buyer you selected.';
      return;
    }
    if (mapping.status === 'ambiguous') {
      status.textContent = 'Several saved buyers match. You can choose one or keep the name on this PO.';
      return;
    }
    if (buyer.name) {
      status.textContent = 'Gemini read ' + buyer.name + '. Review the buyer name on this PO.';
    } else status.textContent = 'Gemini could not identify a buyer. You can leave the PO unassigned.';
  } catch (error) {
    if (isCurrent()) status.textContent = errorText(error);
  }
}
async function readUploadedPoNumber(form, payload, isCurrent) {
  const status = form.querySelector('[data-po-number-status]');
  try {
    const result = await api('/api/po-number', {
      ...payload,
      poNumberReader: form.elements.poNumberReader.value,
    });
    if (!isCurrent()) return;
    status.textContent = garments.poNumberMessage(result);
    if (result.status === 'matched') setPoSuggestion(form.elements.po, result.value);
  } catch (error) {
    if (isCurrent()) status.textContent = errorText(error);
  }
}
function showPoImport(result) {
  app.local.poImport = result;
  if (current !== 'tech-pack') return go('tech-pack?import=1');
  render();
  root.querySelector('form[data-form="' + PO_IMPORT_ACTION + '"]')?.scrollIntoView({
    block: 'start',
  });
}
async function openLinkedPo() {
  const id = routeParams().get('pdf');
  if (current !== 'tech-pack' || !id || !can(app, PO_IMPORT_ACTION)) return;
  const workspace = app.local;
  const hash = location.hash;
  if (workspace.readingPoLink === hash) return;
  workspace.readingPoLink = hash;
  const isCurrent = () => app.local === workspace && location.hash === hash;
  try {
    const result = await localPoDraft(await savedPoPdf(id), id);
    if (isCurrent()) {
      history.replaceState(history.state, '', '#tech-pack?import=1');
      showPoImport(result);
    }
  } catch (error) {
    if (isCurrent()) flash(errorText(error), true);
  } finally {
    if (workspace.readingPoLink === hash) delete workspace.readingPoLink;
  }
}
async function readPoUpload(input) {
  const form = input.form;
  const status = form.querySelector('[data-po-number-status]');
  const buyerStatus = form.querySelector('[data-po-buyer-status]');
  const geminiNotice = form.querySelector('[data-gemini-notice]');
  const file = input.files[0];
  const companyId = app.user?.companyId;
  const isCurrent = () => input.isConnected && input.files[0] === file && app.user?.companyId === companyId;
  for (const control of form.querySelectorAll('[data-po-suggestion]')) {
    if (control.value === control.dataset.poSuggestion) control.value = '';
    delete control.dataset.poSuggestion;
  }
  status.hidden = !file;
  if (buyerStatus) {
    buyerStatus.hidden = true;
    buyerStatus.title = '';
  }
  if (geminiNotice) {
    geminiNotice.hidden = true;
    geminiNotice.textContent = '';
  }
  if (!file) return;
  if (/\.xlsx$/i.test(file.name)) {
    status.textContent = garments.poNumberMessage({
      status: 'unsupported',
    });
    return;
  }
  status.textContent = 'Reading the buyer PO number…';
  try {
    const document = await upload(input, companyId, file);
    if (!isCurrent()) return;
    const payload = {
      companyId,
      document,
    };
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (form.dataset.form === 'buyer-order' && can(app, PO_IMPORT_ACTION) && (isPdf || garments.autoReadBuyerPo(app))) {
      status.textContent = 'Reading the order, articles and size quantities…';
      let aiError;
      if (garments.autoReadBuyerPo(app)) {
        try {
          const result = await readWithGeminiNotice('/api/po-ai-extract', { ...payload, provider: 'gemini',
            geminiModel: form.elements.geminiModel?.value, poNumberReader: form.elements.poNumberReader.value }, form, isCurrent);
          if (isCurrent()) showPoImport(result);
          return;
        } catch (error) {
          if (!isCurrent()) return;
          if (['session', 'workspace-changed', 'ai-provider-changed', 'role'].includes(error.code)) throw error;
          aiError = error;
        }
      }
      if (isPdf) {
        try {
          const result = await localPoDraft(file, document, aiError);
          if (isCurrent()) showPoImport(result);
          return;
        } catch (error) {
          if (!isCurrent()) return;
          const header = error.header || {};
          for (const [field, value] of Object.entries({ po: header.po, newBuyerName: header.buyer,
            currency: header.currency, terms: header.terms, shipTo: header.shipTo })) setPoSuggestion(form.elements[field], value);
          buyerStatus.hidden = false;
          buyerStatus.textContent = [aiError?.message, errorText(error)].filter(Boolean).join(' ');
        }
      }
      if (!isCurrent()) return;
      if (app.user.frontendPreview) status.textContent = 'Review the fields and enter any missing details.';
      else {
        if (aiError && !isPdf) { buyerStatus.hidden = false; buyerStatus.textContent = aiError.message; }
        await readUploadedPoNumber(form, payload, isCurrent);
      }
      return;
    }
    if (app.user.frontendPreview) {
      status.textContent = 'Select a text PDF with a size and quantity table for browser import.';
      return;
    }
    await Promise.all([readUploadedPoNumber(form, payload, isCurrent), readUploadedBuyer(form, payload, isCurrent)]);
  } catch (error) {
    if (isCurrent()) status.textContent = errorText(error);
  }
}
async function saveBuyerFromPo(button) {
  const form = button.form;
  const companyId = app.user.companyId;
  const elements = form.elements;
  const attachment = elements.document?.files?.[0];
  button.disabled = true;
  try {
    const result = await submitAction(
      button,
      'po-buyer-create',
      {
        buyer: elements.newBuyerName.value,
        currency: elements.newBuyerCurrency.value,
        country: elements.newBuyerCountry.value,
        gstin: elements.newBuyerTax.value,
      },
      false,
    );
    if (!form.isConnected || companyId !== app.user?.companyId || elements.document?.files?.[0] !== attachment) return;
    const buyer = ref(app.data.parties, result.id);
    if (!buyer) return;
    ensureBuyerOption(elements.buyerId, buyer);
    elements.buyerId.value = buyer.id;
    delete elements.buyerId.dataset.poSuggestion;
    const newBuyer = form.querySelector('[data-new-po-buyer]');
    newBuyer.open = false;
    newBuyer.hidden = true;
    const status = form.querySelector('[data-po-buyer-status]');
    status.hidden = false;
    status.textContent = 'Added ' + buyer.name + ' to Company masters and selected it for this PO.';
  } finally {
    button.disabled = false;
  }
}
async function fieldsOf(form) {
  const data = Object.fromEntries(new FormData(form));
  const companyId = app.user?.companyId;
  const attachments = [...form.querySelectorAll('input[data-bucket]')].map((input) => [input, [...input.files]]);
  for (const [input, files] of attachments) {
    const ids = [];
    for (const file of files) ids.push(await upload(input, companyId, file));
    data[input.name] = ids.join(',');
  }
  return data;
}
async function readFabricTechPacks(form, companyId) {
  const local = app.local;
  if (local.fabricReading) throw new Error('A tech pack read is already running for this workspace.');
  const input = form.elements.document;
  const files = [...input.files];
  if (!files.length) throw new Error('Choose at least one garment tech pack.');
  const provider = form.elements.provider.value;
  let geminiModel = form.elements.geminiModel?.value;
  const status = form.querySelector('[data-fabric-read-status]');
  const currentWorkspace = () => app.local === local && app.user?.companyId === companyId;
  const items = [];
  input.disabled = true;
  local.fabricReading = true;
  status.hidden = false;
  try {
    for (const [index, file] of files.entries()) {
      if (!currentWorkspace()) return;
      status.textContent = 'Reading ' + (index + 1) + ' of ' + files.length + ' files · ' + file.name;
      try {
        const document = await upload(input, companyId, file);
        if (!currentWorkspace()) return;
        const result = await readWithGeminiNotice(
          '/api/fabric-ai-extract',
          {
            companyId,
            document,
            provider,
            geminiModel,
          },
          form,
        );
        items.push({
          result,
        });
        if (geminiModel && result.retry) geminiModel = result.model;
      } catch (error) {
        items.push({
          filename: file.name,
          error: errorText(error),
          retry: error.retry,
        });
        if (['session', 'workspace-changed', 'ai-provider-changed'].includes(error.code)) throw error;
        if (['ai-busy', 'ai-key', 'ai-quota'].includes(error.code)) break;
      }
    }
  } finally {
    delete local.fabricReading;
    input.disabled = false;
    if (currentWorkspace()) {
      const count = items.filter((item) => item.result).length;
      local.fabricTechPacks = count
        ? items
        : [...(local.fabricTechPacks ?? []).filter((item) => item.result), ...items];
      const output = root.querySelector('[data-fabric-tech-pack-review]');
      if (output) setContents(output, fabricTechPackReview(local.fabricTechPacks));
      const notice = form.querySelector('[data-gemini-notice]');
      if (notice) notice.hidden = true;
      const progress = root.querySelector('[data-fabric-read-status]');
      if (progress) {
        progress.hidden = false;
        progress.textContent = 'Read ' + count + ' of ' + files.length + (files.length === 1 ? ' file.' : ' files.');
      }
    }
  }
}
async function submitAction(element, action, input, renderPage = true) {
  const companyId = app.user.companyId;
  const previous = pending.get(element);
  const signature = JSON.stringify(input);
  const requestId = previous?.action === action && previous.signature === signature ? previous.id : crypto.randomUUID();
  pending.set(element, {
    action,
    signature,
    id: requestId,
  });
  try {
    const result = await signed('/api/actions', {
      revision: app.data.revision,
      requestId,
      action,
      input,
    });
    pending.delete(element);
    if (action === 'passport') app.local.passport = result.id;
    if (action === 'dispatch') app.local.shipItems = '';
    if (action === PO_IMPORT_ACTION && app.user?.companyId === companyId) delete app.local.poImport;
    await load(renderPage);
    if (action === PO_IMPORT_ACTION) {
      if (app.user?.companyId === companyId) go(garments.garmentHash(companyId, result.id));
    } else if (action === 'wash-load' && app.user?.companyId === companyId)
      go('washing?batch=' + encodeURIComponent(result.id));
    else if (action === 'finish-open' && app.user?.companyId === companyId)
      go('fabric-finishing?batch=' + encodeURIComponent(result.id));
    else if (action === 'print-issue' && app.user?.companyId === companyId) {
      const b = ref(app.data.processBatches, result.id);
      go((b?.process === 'Embroidery' ? 'embroidery' : 'printing') + '?batch=' + encodeURIComponent(result.id));
    } else if (['cut-lay', 'garment-issue'].includes(action) && app.user?.companyId === companyId) {
      const b = ref(app.data.processBatches, result.id);
      if (b) go(garmentProduction.garmentBatchHash(b.process, b.id));
    } else if (action === 'pack-carton' && app.user?.companyId === companyId)
      go('trace?lot=' + encodeURIComponent(result.id));
    else if (action === 'master-delete') flash('Master record deleted.');
    else
      flash(
        action === 'garment-import-draft' ? 'Saved changes to the editable AI draft.' : 'Posted ' + result.id + '.',
      );
    return result;
  } catch (error) {
    if (error instanceof ApiError) pending.delete(element);
    if (error.code === 'stale') await load(false);
    throw error;
  }
}
function showDialog(content, print = false, closeLabel = 'Close') {
  if (dialog.open) dialog.close();
  renderDialog(
    <>
      <div className="toolbar">
        {print
          ? button('Print', {
              'data-print': 'yes',
            })
          : ''}
        {button(closeLabel, {
          'data-close': 'yes',
        })}
      </div>
      {content}
    </>,
  );
  dialog.showModal();
}
function findLot(query) {
  const input = String(query || '').trim();
  if (!input) throw new Error('Enter a lot ID or scan a QR label.');
  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);
    if (
      ![window.location.origin, app.user.publishedOrigin].includes(url.origin) ||
      !/^\/p\/[\w-]{32}$/.test(url.pathname)
    ) {
      throw new Error('This QR is outside the configured HAPZO address.');
    }
    showDialog(
      <p>
        <a href={h(url.origin + url.pathname)} target="_blank" rel="noopener">
          Open published passport
        </a>
      </p>,
    );
    return;
  }
  const lot = input.replace(/^HZ:LOT:/i, '');
  app.local.trace = app.data.lots.find((l) => norm(l.id) === norm(lot))?.id || lot;
  if (dialog.open) dialog.close();
  go('trace?lot=' + encodeURIComponent(app.local.trace));
}
async function switchCompany(companyId) {
  const result = await api('/api/switch', {
    companyId,
  });
  if (dialog.open) dialog.close();
  app.user = result.user;
  app.data = result.data;
  app.local = {};
  go(app.user.role === 'Buyer' ? 'buyer' : 'overview');
  render();
}
async function createCompany(input) {
  const result = await signed('/api/company', input);
  await switchCompany(result.id);
  flash('Opened ' + app.data.settings.name + '.');
}
async function handleSubmit(e) {
  const el = e.target.closest('form[data-form]');
  if (!el) return;
  e.preventDefault();
  if (el.dataset.busy) return;
  el.dataset.busy = 'yes';
  const goButton = e.nativeEvent.submitter || el.querySelector('button:not([type="button"])');
  if (goButton) goButton.disabled = true;
  flash();
  const action = el.dataset.form;
  const reading = ['read-buyer-po', 'read-fabric-tech-pack'].includes(action);
  const companyId = app.user?.companyId;
  const buttonText = goButton?.textContent;
  try {
    if (reading) {
      if (!app.user.poAi?.ready && action !== 'read-buyer-po')
        throw new Error('Ask an administrator to configure the Gemini Model API in HAPZO settings.');
      if (goButton) goButton.textContent = action === 'read-buyer-po' ? 'Reading buyer PO…' : 'Reading tech packs…';
    }
    if (action === 'read-fabric-tech-pack') return await readFabricTechPacks(el, companyId);
    const input = await fieldsOf(el);
    if (action === 'buyer-order') input.buyerName = input.newBuyerName;
    if (action === 'setup' || action === 'login') {
      await api('/api/' + action, input);
      app.initialized = true;
      await load();
      return;
    }
    if (action === 'gemini-api-key') {
      const result = await api('/api/po-ai-key', {
        companyId,
        provider: 'gemini',
        key: input.key,
      });
      if (app.user?.companyId !== companyId) return;
      app.user.poAi = {
        ...result.poAi,
        canManage: true,
      };
      el.reset();
      app.local.geminiCatalogCompany = '';
      await loadGeminiCatalogue(companyId);
      render();
      return flash('Gemini API key saved on this server.');
    }
    if (action === 'gemini-default-model') {
      const result = await api('/api/gemini-model', {
        companyId,
        model: input.model,
      });
      if (app.user?.companyId !== companyId) return;
      app.local.geminiCatalogue = {
        ...app.local.geminiCatalogue,
        defaultModel: result.defaultModel,
        models: app.local.geminiCatalogue?.models || result.models,
      };
      render();
      return flash('Default Gemini model saved.');
    }
    if (action === 'lookup') return findLot(input.query);
    if (action === 'tech-pack-filter') return go(garments.garmentHash(app.user.companyId, input.lineId));
    if (action === 'read-buyer-po') {
      if (app.user?.companyId !== companyId) return;
      const file = el.elements.document.files[0];
      const documentId = input.document || input.savedDocument;
      let result;
      if (app.user.poAi?.ready) {
        try { result = await readWithGeminiNotice('/api/po-ai-extract', { ...input, companyId }, el); }
        catch (error) {
          if (input.annex || !documentId || ['session', 'workspace-changed', 'ai-provider-changed', 'role'].includes(error.code)) throw error;
          let source = file;
          if (!source) {
            const saved = app.data.buyerPoUploads?.find(doc => doc.id === documentId);
            if (!saved || !/\.pdf$/i.test(saved.label)) throw error;
            source = await savedPoPdf(documentId);
          }
          if (source.type !== 'application/pdf' && !/\.pdf$/i.test(source.name)) throw error;
          try { result = await localPoDraft(source, documentId, error); }
          catch (localError) { throw new Error(error.message + ' ' + localError.message); }
        }
      } else {
        const source = file || (app.user.frontendPreview && input.savedDocument ? await previewFile(input.savedDocument) : null);
        if (!source) throw new Error('Select a purchase order PDF.');
        result = await localPoDraft(source, documentId);
      }
      if (app.user?.companyId !== companyId) return;
      if (current === 'tech-pack') showPoImport(result);
      else app.local.poImport = result;
      return;
    }
    if (action === PO_IMPORT_ACTION)
      return await submitAction(el, action, garments.poImportInput(el, input, app.local.poImport));
    if (action === 'garment-spec') {
      const posting = goButton?.hasAttribute('data-tech-save-draft') ? 'garment-import-draft' : action;
      return await submitAction(el, posting, {
        lineId: input.lineId,
        specRev: input.specRev,
        draftToken: input.draftToken || '',
        notes: input.techApprovalNote || '',
        document: input.document,
        techPack: JSON.stringify(garments.techPackInput(el)),
      });
    }
    if (action === 'quality') input.techInspection = garments.techInspectionInput(el);
    if (action === 'new-company') return await createCompany(input);
    if (action === 'member') {
      await signed('/api/members', input);
      await load();
      return flash('Workspace membership saved.');
    }
    if (action === 'password') {
      await signed('/api/password', input);
      el.reset();
      return flash('Password changed.');
    }
    if (action === 'component-route') return await submitAction(el, action, dyeing.routeInput(input));
    if (
      [
        'dye-reverse',
        'gin-reverse',
        'blend-reverse',
        'spin-reverse',
        'knit-reverse',
        'warp-reverse',
        'size-reverse',
        'loom-reverse',
        'fdye-reverse',
      ].includes(action)
    )
      return await submitAction(el, action, dyeing.reverseInput(input));
    if (action === 'blend-issue') {
      const result = await submitAction(el, action, input);
      app.local.blendIssueDraft = '';
      render();
      flash('Posted ' + result.id + '.');
      return result;
    }
    if (action === 'stock-search') app.local.stockSearch = input.search;
    else if (action === 'fibre-scan') {
      app.local.fibreScan = String(input.query || '').trim();
      app.local.fibreTarget = input.target || '';
    } else if (action === 'fd-job') app.local.fdJob = input.job || '';
    else if (action === 'fd-history')
      app.local.fdLot = String(input.lotId || '')
        .trim()
        .replace(/^HZ:LOT:/i, '');
    else if (action === 'weave-trace')
      app.local.weaveRoll = String(input.rollId || '')
        .trim()
        .replace(/^HZ:LOT:/i, '');
    else if (action === 'weave-history')
      app.local.weaveLot = String(input.lotId || '')
        .trim()
        .replace(/^HZ:LOT:/i, '');
    else if (action === 'knit-trace')
      app.local.knitRoll = String(input.rollId || '')
        .trim()
        .replace(/^HZ:LOT:/i, '');
    else if (action === 'knit-history')
      app.local.knitLot = String(input.lotId || '')
        .trim()
        .replace(/^HZ:LOT:/i, '');
    else if (action === 'yarn-scan') app.local.yarnScan = String(input.query || '').trim();
    else if (action === 'spin-history')
      app.local.spinLot = String(input.lotId || '')
        .trim()
        .replace(/^HZ:LOT:/i, '');
    else if (action === 'fibre-history')
      app.local.fibreLot = String(input.lotId || '')
        .trim()
        .replace(/^HZ:LOT:/i, '');
    else if (action === 'dye-history') {
      app.local.dyeLot = String(input.lotId || '')
        .trim()
        .replace(/^HZ:LOT:/i, '');
      return go('yarn-dyeing?tab=history' + (input.batchView ? '&batch=' + encodeURIComponent(input.batchView) : ''));
    } else if (action === 'cost-search') app.local.costLot = input.lotId;
    else if (['report-filter', 'ledger-filter', 'day-book-filter'].includes(action)) {
      if (!validDate(input.end) || (input.start && (!validDate(input.start) || input.start > input.end)))
        throw new Error('Enter a valid report period.');
      if (action === 'ledger-filter') {
        app.local.ledgerPeriod = input;
        return go(finance.ledgerHash(input.ledger));
      }
      if (action === 'day-book-filter') app.local.dayPeriod = input;
      else app.local.period = input;
    } else return await submitAction(el, action, finance.accountingInput(el, input));
    render();
  } catch (err) {
    await showError(err);
  } finally {
    if (goButton) {
      goButton.disabled = false;
      if (reading) goButton.textContent = buttonText;
    }
    delete el.dataset.busy;
  }
}
function downloadCsv(csv, filename = 'HAPZO-voucher-lines.csv') {
  const url = URL.createObjectURL(
    new Blob([csv], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const detailsBy = {
  line: ['lines', operations.orderLineDetail],
  shipment: ['shipments', operations.shipmentDetail],
  invoice: ['invoices', finance.invoiceDetail],
  workOrder: ['workOrders', operations.workDetail],
  voucher: ['vouchers', finance.voucherDetail],
  fabricReport: ['events', fabricReportDetail],
  techInspection: ['events', garments.garmentInspectionDetail],
};
async function analyse(button) {
  const el = button.closest('form');
  const inputs = [...el.querySelectorAll('input[data-bucket="evidence"]')];
  if (!inputs.some((input) => input.files.length)) throw new Error('Choose the certificate or annex files first.');
  const output = el.querySelector('[data-analysis]');
  setContents(output, note('Reading the certificate and annexes on this computer…'));
  button.disabled = true;
  try {
    const companyId = app.user.companyId;
    const results = [];
    const scopeLists = {
      scopeText: [],
      scopeRefs: [],
      operations: [],
      materials: [],
    };
    const analysisFlags = [];
    const labels = {
      scheme: 'Programme',
      programmeVersion: 'Version',
      kind: 'Evidence type',
      number: 'Reference',
      issuer: 'Issuer',
      party: 'Holder',
      site: 'Facility',
      issue: 'Issue date',
      from: 'Valid from',
      until: 'Expiry',
      operations: 'Operations',
      materials: 'Materials',
      criteria: 'Criteria',
      scopeText: 'Scope',
      scopeRefs: 'Exact scope codes',
      txSeller: 'Seller',
      txBuyer: 'Buyer',
      txShipment: 'Shipment',
      txMaterial: 'Material code',
    };
    for (const input of inputs)
      for (const file of input.files) {
        const doc = await upload(input, companyId, file);
        const result = await api('/api/certificate-analysis', {
          companyId,
          document: doc,
        });
        const warnings = [...result.warnings];
        const master = ref(app.data.parties, el.elements.partyId.value);
        const picks = [];
        for (const [key, suggestion] of Object.entries(result.suggestions)) {
          const { value, page } = suggestion;
          const target = el.elements.namedItem(key);
          const selected = key === 'party' && master ? master.name : target?.value;
          if ((key === 'party' || key === 'site') && selected && !same(selected, value)) {
            warnings.push(
              (labels[key] || key) + ' on page ' + page + ' differs from the selected record. Confirm the match.',
            );
          }
          if (Object.hasOwn(scopeLists, key)) scopeLists[key].push(value);
          else if (
            target &&
            !target.value &&
            (target.tagName !== 'SELECT' || [...target.options].some((option) => option.value === value))
          )
            target.value = value;
          picks.push([h(labels[key] || key), h(value), h((suggestion.pages ?? [page]).join(', '))]);
        }
        const missing = result.annexExpected && !el.elements.annex.files.length;
        if (missing) {
          el.elements.annexRequired.checked = true;
          warnings.push(
            'This document references an annex. Confirm the complete scope and add the annex before verification.',
          );
        }
        analysisFlags.push(...warnings.map((warning) => file.name + ' · ' + warning));
        const listing = table(
          ['Suggested field', 'Value', 'Source page'],
          picks,
          'No labelled fields were matched. Review the extracted pages.',
        );
        results.push(
          details(
            file.name,
            <>
              {listing}
              {joinContent(
                warnings.map((warning) => note(warning, true)),
                '',
              )}
              {joinContent(
                result.pages.map((p) => details('Page ' + p.page + ' · ' + p.method, <pre>{h(p.text)}</pre>)),
                '',
              )}
            </>,
            true,
          ),
        );
      }
    for (const [key, values] of Object.entries(scopeLists)) {
      if (el.elements[key].value) continue;
      const separator = key === 'operations' || key === 'materials' ? ', ' : '\n';
      el.elements[key].value = [...new Set(values.flatMap((value) => value.split(separator)))]
        .join(separator)
        .slice(0, 7900);
    }
    el.elements.analysisWarnings.value = analysisFlags.join('\n').slice(0, 7900);
    setContents(output, joinContent(results, ''));
  } catch (err) {
    setContents(output, note(errorText(err), true));
    throw err;
  } finally {
    button.disabled = false;
  }
}
function decodeFrame(source, width, height) {
  const scale = Math.min(1, 1300 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d', {
    willReadFrequently: true,
  });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(frame.data, frame.width, frame.height, {
    inversionAttempts: 'attemptBoth',
  })?.data;
}
async function camera() {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error('The camera is unavailable at this address. Use a QR image or a scanner.');
  showDialog(
    <>
      <h2>Scan a HAPZO label</h2>
      <p className="muted">Hold a single QR inside the camera preview.</p>
      <video aria-label="QR camera preview" autoPlay playsInline muted />
      <p id="scan-status" role="status" />
    </>,
  );
  const video = dialog.querySelector('video');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: {
        ideal: 'environment',
      },
    },
    audio: false,
  });
  if (!dialog.open || !video.isConnected) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  scanStream = stream;
  video.srcObject = stream;
  await video.play();
  const detect = () => {
    if (scanStream !== stream || !video.isConnected) return;
    try {
      const result = video.videoWidth ? decodeFrame(video, video.videoWidth, video.videoHeight) : '';
      if (result) {
        findLot(result);
        return;
      }
    } catch (err) {
      const status = dialog.querySelector('#scan-status');
      if (status) status.textContent = err.message;
    }
    setTimeout(detect, 240);
  };
  detect();
}
dialog.addEventListener('close', () => {
  if (scanStream) scanStream.getTracks().forEach((t) => t.stop());
  scanStream = null;
});
async function handleClick(e) {
  const link = e.target.closest('a[href^="/api/documents/"]');
  if (link && app.user?.frontendPreview) {
    e.preventDefault();
    try {
      const file = await previewFile(decodeURIComponent(link.pathname.split('/').pop()));
      const download = document.createElement('a');
      download.href = URL.createObjectURL(file);
      download.download = file.name;
      download.click();
      setTimeout(() => URL.revokeObjectURL(download.href), 30000);
    } catch (error) { flash(errorText(error), true); }
    return;
  }
  const flowLink = e.target.closest('a[data-order-flow]');
  if (flowLink) {
    if (dialog.open) dialog.close();
    if (flowLink.classList.contains('po-flow-card') && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      const narrow = window.matchMedia('(max-width: 760px)').matches;
      if (narrow && flowLink.hash === window.location.hash) {
        e.preventDefault();
        document.querySelector('#flow-phase-title')?.focus({
          preventScroll: true,
        });
        document.querySelector('.po-flow-selection')?.scrollIntoView({
          block: 'start',
        });
      } else if (flowLink.hash !== window.location.hash) {
        app.local.flowFocus = narrow ? '#flow-phase-title' : '.po-flow-card[aria-current="step"]';
      }
    }
    return;
  }
  const moduleLink = e.target.closest('a[data-module-link]');
  if (moduleLink && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.button === 0) {
    e.preventDefault();
    goModule(moduleLink.dataset.moduleLink);
    return;
  }
  const clicked = e.target.closest('button');
  if (!clicked) return;
  const d = clicked.dataset;
  if (d.themeChoice) return applyTheme(d.themeChoice);
  if (clicked.hasAttribute('data-sidebar-toggle')) {
    const collapsed = root.classList.toggle('sidebar-collapsed');
    clicked.setAttribute('aria-expanded', String(!collapsed));
    clicked.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
    clicked.title = collapsed ? 'Expand navigation' : 'Collapse navigation';
    clicked.textContent = collapsed ? '›' : '‹';
    try {
      localStorage.setItem('hapzo-sidebar-collapsed', collapsed ? 'yes' : 'no');
    } catch {}
    return;
  }
  if (!app.user) return;
  try {
    if (d.logout) {
      await signed('/api/logout');
      if (localWorkspace) return window.location.assign('/');
      app.user = null;
      app.data = null;
      app.local = {};
      window.location.hash = '';
      return render();
    }
    if (d.reload) {
      await load();
      return flash('Workspace updated.');
    }
    if (d.refreshGemini) {
      app.local.geminiCatalogCompany = '';
      app.local.geminiCatalogLoading = true;
      await loadGeminiCatalogue(app.user.companyId, true);
      return flash('Gemini model list updated.');
    }
    if (d.removeGeminiKey) {
      const companyId = app.user.companyId;
      const result = await api('/api/po-ai-key', {
        companyId,
        remove: 'yes',
        scope: 'default',
      });
      if (app.user?.companyId !== companyId) return;
      app.user.poAi = {
        ...result.poAi,
        canManage: true,
      };
      app.local.geminiCatalogCompany = '';
      await loadGeminiCatalogue(companyId);
      render();
      return flash('Saved Gemini API key removed.');
    }
    if (d.flowTop) {
      document.querySelector('.po-flow-card[aria-current="step"]')?.focus({
        preventScroll: true,
      });
      return document.querySelector('.po-flow-chart')?.scrollIntoView({
        block: 'start',
      });
    }
    if (d.demo)
      return await createCompany({
        name: 'HAPZO Training Mill',
        demo: 'yes',
      });
    if (d.close) return dialog.close();
    if (d.print) {
      document.body.classList.add('printing');
      try {
        window.print();
      } finally {
        document.body.classList.remove('printing');
      }
      return;
    }
    if (d.lot) return findLot(d.lot);
    if (d.blendAdd) {
      fibreUi.addToBlendDraft(app, d.blendAdd);
      return go(
        'fibre?tab=blend' + (app.local.fibreTarget ? '&batch=' + encodeURIComponent(app.local.fibreTarget) : ''),
      );
    }
    if (d.fibreBatch) {
      const batch = ref(app.data.processBatches, d.fibreBatch);
      return go(
        (batch?.process === 'Yarn dyeing'
          ? 'yarn-dyeing?tab=history'
          : batch?.process === 'Ginning'
            ? 'fibre?tab=gin'
            : 'fibre?tab=blend') +
          '&batch=' +
          encodeURIComponent(d.fibreBatch),
      );
    }
    if (d.camera) return await camera();
    if (d.analyse) return await analyse(clicked);
    if (d.shipLot) {
      const lot = ref(app.data.lots, d.shipLot);
      const lines = lot.allocationBalance.map((a) => [lot.id, a.lineId, a.qty].join(','));
      const draft = document.querySelector('form[data-form="dispatch"] textarea[name="items"]');
      for (const line of lines) {
        if (!draft.value.split('\n').includes(line))
          draft.value = [draft.value.trim(), line].filter(Boolean).join('\n');
      }
      draft.closest('details').open = true;
      draft.focus();
      return;
    }
    if (d.passport) {
      app.local.passport = d.passport;
      app.local.focusPassport = true;
      const target = 'passports?draft=' + encodeURIComponent(d.passport);
      if (location.hash !== '#' + target) return go(target);
      return document.querySelector('#passport-section')?.scrollIntoView({
        block: 'start',
      });
    }
    if (d.labelLot || d.labelPass) {
      const lot = ref(app.data.lots, d.labelLot);
      const p = ref(app.data.passports, d.labelPass);
      const params = new URLSearchParams(
        lot
          ? {
              lot: lot.id,
            }
          : {
              passport: p.id,
            },
      );
      showDialog(
        <>
          <h2>{h(lot ? lot.id + ' · ' + lot.material : p.lotId + ' · Digital Product Passport')}</h2>
          <img
            className="label-image"
            alt={'QR for ' + h(lot?.id || p.lotId)}
            src={'/api/qr?' + h(params.toString())}
          />
          <p>
            <code>{h(lot ? 'HZ:LOT:' + lot.id : app.user.publishedOrigin + '/p/' + p.token)}</code>
          </p>
        </>,
        true,
      );
      return;
    }
    if (d.addLedgerLine) return finance.addLedgerLine(clicked.closest('form'));
    if (d.createPoBuyer) return await saveBuyerFromPo(clicked);
    if (d.deleteMaster)
      return showDialog(operations.masterDeletePrompt(app, d.deleteMaster, d.masterId), false, 'Cancel');
    if (d.confirmDeleteMaster) {
      clicked.disabled = true;
      try {
        await submitAction(clicked, 'master-delete', {
          kind: d.confirmDeleteMaster,
          id: d.masterId,
        });
      } finally {
        clicked.disabled = false;
        if (clicked.isConnected && dialog.open) dialog.close();
      }
      return;
    }
    if (d.loadFabricComponent) {
      const selection = clicked
        .closest('[data-fabric-tech-pack-review]')
        .querySelector('[name="fabricComponent"]').value;
      const [fileIndex, fabricIndex] = selection.split(':').map(Number);
      const result = app.local.fabricTechPacks?.[fileIndex]?.result;
      if (!result?.fabrics[fabricIndex]) throw new Error('Choose a fabric component to load.');
      return loadFabricCalculator(root.querySelector('[data-fabric-calculator]'), result, fabricIndex, app);
    }
    if (d.clearPoImport) {
      delete app.local.poImport;
      return go('tech-pack?import=1');
    }
    if (d.techAdd) return garments.addTechPackRow(clicked.closest('form'), d.techAdd, app);
    if (d.techRemove) return removeRow(clicked.closest('[data-tech-row]'));
    if (d.techPreview) return garments.previewGarmentPack(clicked.closest('form'), app);
    if (d.printTech) return showDialog(garments.printableGarmentPack(app, d.printTech, d.techRevision), true);
    if (d.voucherExport)
      return downloadCsv(
        finance.voucherCsv(app, d.voucherExport),
        d.voucherExport === 'day-book' ? 'HAPZO-day-book.csv' : 'HAPZO-voucher-lines.csv',
      );
    if (d.ledgerExport) return downloadCsv(finance.ledgerCsv(app, d.ledgerExport), 'HAPZO-ledger-statement.csv');
    for (const [key, [collection, screen]] of Object.entries(detailsBy)) {
      if (!d[key]) continue;
      const row = ref(app.data[collection] ?? [], d[key]);
      if (row) showDialog(screen(app, row), ['invoice', 'shipment', 'workOrder', 'voucher'].includes(key));
      return;
    }
  } catch (err) {
    await showError(err);
  }
}
function handleInput(e) {
  if (e.target.dataset.billId) finance.showAppliedTotal(e.target.form);
  if (e.target.dataset.poSuggestion) delete e.target.dataset.poSuggestion;
  const target = e.target;
  if (target.id === 'module-search' || target.id === 'global-search') {
    const query = target.value.trim().toLocaleLowerCase();
    for (const input of document.querySelectorAll('#module-search, #global-search'))
      if (input !== target) input.value = target.value;
    let visible = 0;
    for (const link of root.querySelectorAll('.nav-group a')) {
      const match = !query || link.textContent.toLocaleLowerCase().includes(query);
      link.hidden = !match;
      if (match) visible++;
    }
    for (const group of root.querySelectorAll('.nav-group')) group.hidden = !group.querySelector('a:not([hidden])');
    const emptyNav = root.querySelector('.nav-empty');
    if (emptyNav) emptyNav.hidden = visible !== 0;
  }
  const editor =
    target.closest('[data-fabric-editor]') ??
    (['yarnSystems', 'yarnRepeatCells'].includes(target.name)
      ? target.closest('[data-tech-row="fabrics"]')?.querySelector('[data-fabric-editor]')
      : null);
  if (editor) refreshFabricEditor(editor, app);
}
async function handleChange(e) {
  const el = e.target;
  try {
    if (el.id === 'company-select') return await switchCompany(el.value);
    if (el.dataset.hook === 'approve-draft-line') {
      const line = ref(app.data.lines, el.value);
      const needsRoute = Boolean(line && !line.route);
      const route = el.form.elements.route;
      route.closest('label').hidden = !needsRoute;
      route.required = needsRoute;
      route.value = '';
      return;
    }
    if (el.name === 'document' && el.dataset.bucket === 'buyer-po' && el.form?.querySelector('[data-po-number-status]'))
      return await readPoUpload(el);
    if (el.name === 'buyerId' && ['buyer-order', PO_IMPORT_ACTION].includes(el.form?.dataset.form)) {
      const details = el.form.querySelector('[data-new-po-buyer]');
      if (details) details.hidden = Boolean(el.value);
      el.form.querySelector('[data-po-buyer-status]').hidden = true;
    }
    if (el.form?.dataset.form === 'account-settle' && ['settlementLedger', 'date'].includes(el.name))
      finance.refreshSettlement(el.form, app);
    if (el.dataset.hook === 'fabric-lot') {
      garments.refreshGarmentInspection(el.form, app, true);
      return selectFabricLot(el, app);
    }
    if (el.form?.dataset.form === 'quality' && el.name === 'techTarget') {
      garments.refreshGarmentInspection(el.form, app);
      return selectFabricLot(el.form.elements.lotId, app);
    }
    if (el.dataset.hook === 'tech-work-line') {
      const line = ref(app.data.lines, el.value);
      setContents(
        el.form.elements.techComponent,
        <>
          {option('', 'Use product or stock item')}
          {joinContent(
            (line?.garmentSpec?.fabrics ?? []).map((fabric) => option(fabric.code, fabric.code + ' · ' + fabric.role)),
            '',
          )}
        </>,
      );
    }
    if (el.dataset.hook === 'wash-work') return washUi.selectWashWork(el.form, app.data);
    if (el.dataset.hook === 'print-work') return printUi.selectPrintWork(el.form, app.data);
    if (el.dataset.hook === 'print-artwork') {
      const artwork = ref(app.data.processSetups, el.value);
      el.form.elements.unit.value = artwork?.stage === 'Fabric printing' ? 'm' : 'pcs';
      return;
    }
    if (el.dataset.hook === 'finish-work') {
      const work = ref(app.data.workOrders, el.value);
      if (work?.finishPlanId) el.form.elements.recipeId.value = work.finishPlanId;
      return;
    }
    if (el.dataset.hook === 'process-input-lot' && el.value) {
      const inputs = el.form.elements.inputs;
      inputs.value = (inputs.value.trimEnd() ? inputs.value.trimEnd() + '\n' : '') + el.value + ',';
      el.value = '';
      inputs.focus();
      inputs.setSelectionRange(inputs.value.length, inputs.value.length);
    }
    if (el.dataset.hook === 'evidence-source') {
      const row = ref(app.data.evidence, el.value);
      setContents(
        el.form.querySelector('[data-evidence-source]'),
        row ? (
          <>
            {compliance.evidenceSourceLinks(row.scheme, row.scopeType)}
            {row.analysisWarnings ? <p className="note warn evidence-excerpt">{h(row.analysisWarnings)}</p> : ''}
          </>
        ) : (
          ''
        ),
      );
    }
    if (el.name === 'route') {
      const editor = el.form?.querySelector('[data-fabric-editor]');
      if (editor) refreshFabricEditor(editor, app);
    }
    if (el.dataset.hook === 'flow-order' || el.dataset.hook === 'flow-line') {
      const chooseOrder = el.dataset.hook === 'flow-order';
      const params = routeParams();
      const orderId = chooseOrder ? el.value : document.querySelector('select[name="flowOrder"]')?.value;
      const lineId = chooseOrder ? '' : el.value;
      app.local.flowFocus = 'select[name="' + (chooseOrder ? 'flowOrder' : 'flowLine') + '"]';
      return go(operations.orderFlowHash(app.user.companyId, orderId, lineId, params.get('phase') || '').slice(1));
    }
    if (el.id === 'scanImage' && el.files[0]) {
      const bitmap = await createImageBitmap(el.files[0]);
      try {
        const find = decodeFrame(bitmap, bitmap.width, bitmap.height);
        if (!find) throw new Error('No readable QR found. Try a clear image or type the lot ID.');
        findLot(find);
      } finally {
        bitmap.close();
        el.value = '';
      }
      return;
    }
    if (el.dataset.hook === 'revision') {
      app.local.revise = el.value;
      render();
    }
    if (el.dataset.hook === 'purchase') {
      const purchase = ref(app.data.purchases, el.value);
      setContents(
        el.form.elements.purchaseLineId,
        <>
          {option('', 'Select…')}
          {joinContent(
            (purchase?.lines || [])
              .filter((l) => l.received < l.qty)
              .map((l) => option(l.id, l.id + ' · ' + l.label + ' · ' + (l.qty - l.received) + ' ' + l.unit + ' open')),
            '',
          )}
        </>,
      );
      el.form.elements.purchaseLineId.required = Boolean(purchase);
      if (purchase) el.form.elements.locationId.value = purchase.shipTo;
    }
    if (el.dataset.hook === 'stage') {
      el.form.elements.unit.value = STAGES[el.value]?.count ? 'pcs' : 'kg';
    }
    if (el.dataset.hook === 'work') {
      const work = ref(app.data.workOrders, el.value);
      if (work) el.form.elements.locationId.value = work.locationId;
    }
    if (el.dataset.hook === 'passport-point') {
      const p = ref(app.data.passports, el.form.elements.passportId.value);
      const row = p.points[Number(el.value) - 1];
      if (!row) return;
      for (const key of ['value', 'applicability', 'visibility', 'source', 'reason'])
        el.form.elements.namedItem(key).value = row[key] || '';
      el.form.elements.verified.checked = row.verified;
    }
  } catch (err) {
    await showError(err);
  }
}
dialog.addEventListener('click', handleClick);
dialog.addEventListener('change', handleChange);
dialog.addEventListener('input', handleInput);
window.addEventListener('hashchange', handleRoute);
window.addEventListener('popstate', handleRoute);
try {
  const { initialized, user } = await api('/api/session');
  app.initialized = initialized;
  if (!user && localWorkspace && !companyRequested) useSampleData = true;
  if (user || useSampleData) await load();
  else render();
} catch (error) {
  renderApp(
    <main className="login-layout">
      <section className="paper">
        <h1>HAPZO Local</h1>
        {note(errorText(error), true)}
      </section>
    </main>,
  );
}
