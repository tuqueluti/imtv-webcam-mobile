-- Fresh installation for the exported Vercel edition. Safe to run again.
CREATE TABLE IF NOT EXISTS camera_sessions (
 id TEXT PRIMARY KEY NOT NULL,
 owner TEXT NOT NULL,
 viewer_hash TEXT NOT NULL,
 join_hash TEXT NOT NULL,
 sender_hash TEXT,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 join_expires_at INTEGER NOT NULL,
 closed INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 0,
 offer TEXT,
 answer TEXT,
 generation INTEGER NOT NULL DEFAULT 0,
 sender_candidates TEXT NOT NULL DEFAULT '[]',
 receiver_candidates TEXT NOT NULL DEFAULT '[]',
 restart_requested INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS camera_sessions_owner_expiry ON camera_sessions(owner,expires_at);
CREATE TABLE IF NOT EXISTS connection_limits (
 key TEXT PRIMARY KEY NOT NULL,
 count INTEGER NOT NULL DEFAULT 1,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS connection_limits_expiry ON connection_limits(expires_at);
