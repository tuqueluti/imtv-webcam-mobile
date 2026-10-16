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
let database;
export function getDatabase() {
  if (database) return database;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) return null;
  if (process.env.VERCEL && (!authToken || !/^(libsql|https):\/\//.test(url))) return null;
  database = createDatabaseAdapter(createClient({ url, authToken }));
  return database;
}
