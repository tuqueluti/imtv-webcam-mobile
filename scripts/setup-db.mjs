import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
import { readDatabaseConfig } from '../lib/database.mjs';
const { url, authToken } = readDatabaseConfig();
if (!url || url.includes('SEU-BANCO')) throw new Error('Configure a URL da conexão Turso/IMTV em .env.local antes de executar db:setup.');
if (!url.startsWith('file:') && !authToken) throw new Error('Configure o token da mesma conexão Turso/IMTV em .env.local.');
const client = createClient({ url, authToken });
try {
  const sql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
  await client.batch(statements, 'write');
  console.log('Banco IMTV preparado. Agora configure as mesmas variáveis na Vercel e publique.');
} finally { client.close(); }
