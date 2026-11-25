import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DATABASE_PATH } from '../src/store.js';

try {
  await stat(DATABASE_PATH);
  const folder = process.argv[2] ? resolve(process.argv[2]) : join(dirname(DATABASE_PATH), 'backups');
  await mkdir(folder, { recursive: true });
  const destination = join(folder, 'HAPZO-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite');
  const source = new DatabaseSync(DATABASE_PATH, { readOnly: true });
  try { await backup(source, destination); }
  finally { source.close(); }
  console.log('Backup saved to ' + destination);
} catch (error) {
  console.error('HAPZO backup: ' + error.message);
  process.exitCode = 1;
}
