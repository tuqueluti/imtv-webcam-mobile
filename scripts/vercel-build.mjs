import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readDatabaseConfig } from '../lib/database.mjs';
const require = createRequire(import.meta.url);
function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const { url, authToken } = readDatabaseConfig();
if (url && authToken) {
  console.log('Preparando as tabelas da conexão Turso/IMTV…');
  run([fileURLToPath(new URL('./setup-db.mjs', import.meta.url))]);
} else {
  console.log('Conexão Turso pendente. Conecte o banco e faça Redeploy para ativar o pareamento.');
}
run([require.resolve('next/dist/bin/next'), 'build', '--webpack']);
