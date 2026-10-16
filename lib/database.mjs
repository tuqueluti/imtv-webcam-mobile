import { createClient } from '@libsql/client';

// Thin adapter: the signaling SQL and atomic updates keep their original semantics.
export function createDatabaseAdapter(client) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              const result = await client.execute({ sql, args });
              return result.rows.length ? { ...result.rows[0] } : null;
            },
            async run() {
              const result = await client.execute({ sql, args });
              return { meta: { changes: result.rowsAffected } };
            },
          };
        },
      };
    },
  };
}
// The Vercel dialog requires a prefix when default names already exist.
// Keep the new IMTV connection ahead of manually entered legacy values.
export function readDatabaseConfig(env = process.env) {
  for (const [urlKey, tokenKey] of [
    ['IMTV_TURSO_DATABASE_URL', 'IMTV_TURSO_AUTH_TOKEN'],
    ['IMTV_DATABASE_URL', 'IMTV_AUTH_TOKEN'],
    ['IMTV_URL', 'IMTV_AUTH_TOKEN'],
    ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'],
  ]) {
    if (env[urlKey]) return { url: env[urlKey], authToken: env[tokenKey] };
  }
  return { url: undefined, authToken: undefined };
}
let database;
export function getDatabase() {
  if (database) return database;
  const { url, authToken } = readDatabaseConfig();
  if (!url) return null;
  if (process.env.VERCEL && (!authToken || !/^(libsql|https):\/\//.test(url))) return null;
  database = createDatabaseAdapter(createClient({ url, authToken }));
  return database;
}
