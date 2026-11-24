import { badge, button, empty, field, form, heading, h, note, panel, select, table } from './ui.jsx';
const modelStatus = (status) =>
  ({
    live: 'Live',
    timeout: 'Timed out',
    unavailable: 'Unavailable',
    failed: 'Read failed',
    untested: 'Not tested',
  })[status] || 'Not tested';
function GeminiSettings({ app }) {
  const ai = app.user.poAi || {};
  const catalogue = app.local.geminiCatalogue || {};
  const models = catalogue.models || ai.models || [];
  const selected = catalogue.defaultModel || models[0]?.id || '';
  const canManage = ai.canManage !== false;
  const source = ai.geminiSaved
    ? 'Saved in this server’s .env file'
    : ai.geminiReady
      ? 'Provided by the server environment'
      : 'No key configured';
  const modelRows = models.map((model) => [
    h(model.label),
    <code>{h(model.id)}</code>,
    badge(modelStatus(model.status), model.status === 'live' ? '' : 'warn'),
    model.id === selected ? badge('Default') : '',
  ]);
  const catalogNote = app.local.geminiCatalogueError
    ? note(app.local.geminiCatalogueError, true)
    : catalogue.issue
      ? note(catalogue.issue, true)
      : catalogue.source === 'account'
        ? note('Showing the text and document generation models available to this Gemini API key.')
        : note('Showing built-in Gemini model choices. Save an API key to load the models available to your account.');
  const connection = canManage ? (
    <>
      {form(
        'gemini-api-key',
        field('Gemini API key', 'key', {
          type: 'password',
          placeholder: ai.geminiReady ? 'Enter a replacement key' : 'Paste your Google AI Studio API key',
          autocomplete: 'off',
          wide: true,
        }),
        'Save API key',
        'The key is stored on the HAPZO server and is never displayed again.',
      )}
      {ai.geminiSaved ? (
        <div className="gemini-key-actions">
          {button(
            'Remove saved key',
            {
              'data-remove-gemini-key': 'yes',
            },
            'secondary',
          )}
        </div>
      ) : (
        ''
      )}
    </>
  ) : (
    note(
      'This hosted workspace reads its Gemini key from the server environment. Configure it in the deployment settings.',
    )
  );
  const defaultSetting = canManage
    ? form(
        'gemini-default-model',
        select(
          'Default model for Gemini requests',
          'model',
          models.map((model) => [
            model.id,
            model.label +
              (model.status === 'live'
                ? ' · Live'
                : model.status === 'untested'
                  ? ' · Not tested'
                  : ' · ' + modelStatus(model.status)),
          ]),
          {
            initial: selected,
          },
        ),
        'Save default model',
        'Individual document forms can still choose another model or use Automatic.',
      )
    : note('The default model is managed through this server’s environment settings.');
  return (
    <>
      {heading('Gemini Model API', 'Manage the Gemini API connection and the models used by document reading.')}
      <div className="gemini-overview">
        <div className="gemini-status-card">
          <span className={'gemini-status-dot' + (ai.geminiReady ? ' is-ready' : '')} />
          <span>
            <small>API connection</small>
            <strong>{ai.geminiReady ? 'Connected' : 'Not configured'}</strong>
          </span>
        </div>
        <div className="gemini-status-card">
          <span className="gemini-status-icon">⌕</span>
          <span>
            <small>Key source</small>
            <strong>{h(source)}</strong>
          </span>
        </div>
        <div className="gemini-status-card">
          <span className="gemini-status-icon">◇</span>
          <span>
            <small>Available models</small>
            <strong>{h(String(models.length))}</strong>
          </span>
        </div>
      </div>
      {panel('API connection', connection)}
      {panel('Default model', defaultSetting)}
      <section className="panel gemini-model-panel">
        <div className="gemini-model-heading">
          <div>
            <h2>Gemini models</h2>
            <p className="sub">Choose a default above or select a model in an individual import form.</p>
          </div>
          {canManage
            ? button(
                catalogue.loading ? 'Loading…' : 'Refresh model list',
                {
                  'data-refresh-gemini': 'yes',
                  ...(catalogue.loading
                    ? {
                        disabled: true,
                      }
                    : {}),
                },
                'secondary',
              )
            : ''}
        </div>
        {catalogNote}
        {modelRows.length
          ? table(['Model', 'API model ID', 'Last status', ''], modelRows)
          : empty('No Gemini models are available. Add a key or refresh the model list.')}
      </section>
    </>
  );
}
export { GeminiSettings };
