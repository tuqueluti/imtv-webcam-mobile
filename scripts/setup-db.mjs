import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
const url = process.env.TURSO_DATABASE_URL;
if (!url || url.includes('SEU-BANCO')) throw new Error('Preencha TURSO_DATABASE_URL em .env.local antes de executar db:setup.');
if (!url.startsWith('file:') && !process.env.TURSO_AUTH_TOKEN) throw new Error('Preencha TURSO_AUTH_TOKEN em .env.local.');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
try {
  const sql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
  await client.batch(statements, 'write');
  console.log('Banco IMTV preparado. Agora configure as mesmas variáveis na Vercel e publique.');
} finally { client.close(); }
