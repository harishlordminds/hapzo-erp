import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual, parseEnv } from 'node:util';
import { DomainError, ensure } from './model.mjs';

const envFile = new URL('../.env', import.meta.url);
const name = 'HAPZO_GEMINI_API_KEY';
const geminiNames = [name, 'GEMINI_API_KEY'];
const assignment = /^[\t \uFEFF]*(?:export[\t ]+)?([A-Za-z_][A-Za-z0-9_]*)[\t ]*=[\t ]*(?:"[^"]*"|'[^']*'|`[^`]*`|[^#\r\n]*)([\t ]*#[^\r\n]*)?[\t ]*(\r\n|\n|\r|$)/gm;

function readEnv() {
  try { return readFileSync(envFile, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return '';
    throw new DomainError('HAPZO could not read its local .env file.', 500, 'ai-key-file');
  }
}

let settings = parseEnv(readEnv());
const geminiKey = variables => geminiNames.map(key => variables[key]?.trim()).find(Boolean) || '';

export function geminiConnection() {
  const saved = geminiKey(settings);
  if (saved) return { key: saved, source: 'file' };
  const inherited = geminiKey(process.env);
  return { key: inherited, source: inherited ? 'environment' : '' };
}

export function saveGeminiKey(key) {
  saveSetting(name, key, key ? [name] : geminiNames);
}

export const defaultGeminiModel = () =>
  (settings.HAPZO_GEMINI_MODEL || process.env.HAPZO_GEMINI_MODEL || 'gemini-3.8-flash').trim().replace(/^models\//, '');

export function saveGeminiModel(model) {
  ensure(/^[A-Za-z0-9._-]+$/.test(model), 'Choose a listed Gemini model.');
  saveSetting('HAPZO_GEMINI_MODEL', model, ['HAPZO_GEMINI_MODEL']);
}

function saveSetting(variableName, value, names) {
  const original = readEnv();
  const lineBreak = original.includes('\r\n') ? '\r\n' : '\n';
  let updated = original.replace(assignment, (line, variable, comment, ending) =>
    names.includes(variable) ? (comment ? comment.trimStart() + ending : '') : line);
  if (value) {
    if (updated && !/[\r\n]$/.test(updated)) updated += lineBreak;
    updated += variableName + '=' + value + lineBreak;
  }

  // Verify the edit with Node's dotenv parser before replacing the file.
  const expected = parseEnv(original);
  for (const variable of names) delete expected[variable];
  if (value) expected[variableName] = value;
  const parsed = parseEnv(updated);
  ensure(isDeepStrictEqual(parsed, expected), 'HAPZO could not merge the Gemini key into .env. Check the file format.', 422, 'ai-key-file');

  const temporary = new URL('.env.' + randomUUID() + '.tmp', envFile);
  try {
    writeFileSync(temporary, updated, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, envFile);
  } catch {
    try { rmSync(temporary, { force: true }); } catch {}
    throw new DomainError('HAPZO could not save its local .env file. Check that the folder is writable.', 500, 'ai-key-file');
  }
  settings = parsed;
}
