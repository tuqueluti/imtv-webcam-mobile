import { SignalError, randomToken, hashToken, sha256, verifyOrigin, readBody, validateDescription, validateCandidates, assertSession, authorize, snapshot, jsonResponse, UUID_RE, SESSION_MS, INVITE_MS } from './signal.mjs';

async function rateLimit(db, key, limit, now) {
  const bucket = Math.floor(now / 60000);
  const row = await db.prepare('INSERT INTO connection_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count')
    .bind(`${key}:${bucket}`, (bucket + 2) * 60000).first();
  if (row.count > limit) throw new SignalError(429, 'Muitas tentativas. Aguarde um minuto e tente novamente.');
}

/** Public capability-based signaling.
 * @param {Request} request @param {any} db @param {string | null} id
 */
export async function handleSignal(request, db, id = null) {
  try {
    if (!db) throw new SignalError(503, 'O pareamento ainda não está disponível.');
    verifyOrigin(request);
    const now = Date.now();
    if (!id) {
      if (request.method !== 'POST') throw new SignalError(405, 'Método inválido.');
      await readBody(request);
      const owner = `public:v2:${await hashToken(request.headers.get('x-luticam-client'))}`;
      // Network header is supplied by Vercel. Raw IP addresses are never stored.
      const network = await sha256(`${new URL(request.url).host}:${request.headers.get('x-vercel-forwarded-for') || 'unknown'}`);
      await db.prepare('DELETE FROM connection_limits WHERE expires_at < ?').bind(now).run();
      await rateLimit(db, 'global', 200, now);
      await rateLimit(db, `network:${network}`, 30, now);
      await rateLimit(db, owner, 12, now);
      await db.prepare('DELETE FROM camera_sessions WHERE expires_at < ? OR closed = 1').bind(now).run();
      const sessionId = crypto.randomUUID(), receiverToken = randomToken(), joinToken = randomToken();
      // Atomic storage cap; changing a browser token cannot bypass the network rate cap.
      const created = await db.prepare('INSERT INTO camera_sessions (id, owner, viewer_hash, join_hash, created_at, expires_at, join_expires_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM camera_sessions WHERE owner = ? AND expires_at > ? AND closed = 0) < 8 AND (SELECT COUNT(*) FROM camera_sessions) < 1000')
        .bind(sessionId, owner, await hashToken(receiverToken), await hashToken(joinToken), now, now + SESSION_MS, now + INVITE_MS, owner, now).run();
      if (!created.meta.changes) throw new SignalError(429, 'Limite de conexões abertas. Encerre uma conexão e tente novamente.');
      return jsonResponse({ id: sessionId, receiverToken, joinToken, expiresAt: now + SESSION_MS, joinExpiresAt: now + INVITE_MS }, 201);
    }
    if (!UUID_RE.test(id)) throw new SignalError(400, 'Código de conexão inválido.');
    const row = await db.prepare('SELECT * FROM camera_sessions WHERE id = ?').bind(id).first();
    assertSession(row, now);
    const token = request.headers.get('x-luticam-token'), role = request.headers.get('x-luticam-role');
    if (request.method === 'POST' && role === 'join') {
      const body = await readBody(request);
      if (row.join_hash !== await hashToken(token)) throw new SignalError(403, 'Convite inválido.');
      const senderHash = await hashToken(body.senderToken);
      if (row.sender_hash === senderHash) return jsonResponse({ ok: true });
      if (row.join_expires_at <= now) throw new SignalError(410, 'O QR Code expirou. Crie uma nova conexão no computador.');
      const result = await db.prepare('UPDATE camera_sessions SET sender_hash = ?, revision = revision + 1 WHERE id = ? AND sender_hash IS NULL AND closed = 0 AND join_expires_at > ?')
        .bind(senderHash, id, now).run();
      if (!result.meta.changes) {
        const current = await db.prepare('SELECT sender_hash FROM camera_sessions WHERE id = ?').bind(id).first();
        if (current?.sender_hash !== senderHash) throw new SignalError(409, 'Este QR Code já foi usado. Crie outra conexão.');
      }
      return jsonResponse({ ok: true });
    }
    await authorize(row, role, token);
    if (request.method === 'GET') {
      const revision = new URL(request.url).searchParams.get('revision');
      return jsonResponse(revision !== null && Number(revision) === row.revision ? { unchanged: true } : snapshot(row, role));
    }
    if (request.method === 'DELETE') {
      await readBody(request);
      await db.prepare('DELETE FROM camera_sessions WHERE id = ?').bind(id).run();
      return jsonResponse({ ok: true });
    }
    if (request.method !== 'POST') throw new SignalError(405, 'Método inválido.');
    const body = await readBody(request);
    const generation = body.generation;
    if (!Number.isInteger(generation) || generation < 1 || generation > 64) throw new SignalError(400, 'Negociação inválida. Atualize os dois dispositivos.');
    if (body.restart === true && role === 'receiver') {
      if (generation !== row.generation) return jsonResponse({ stale: true });
      await db.prepare('UPDATE camera_sessions SET restart_requested = 1, revision = revision + 1 WHERE id = ? AND generation = ? AND restart_requested = 0').bind(id, generation).run();
      return jsonResponse({ ok: true });
    }
    if (body.candidates !== undefined) {
      const candidates = validateCandidates(body.candidates);
      if (generation !== row.generation) return jsonResponse({ stale: true });
      const column = role === 'sender' ? 'sender_candidates' : 'receiver_candidates';
      const before = JSON.parse(row[column]);
      if (before.some((c, i) => JSON.stringify(c) !== JSON.stringify(candidates[i]))) throw new SignalError(409, 'Candidatos de conexão inconsistentes.');
      // One cumulative batch per role: retries do not duplicate entries or regress state.
      await db.prepare(`UPDATE camera_sessions SET ${column} = ?, revision = revision + 1 WHERE id = ? AND generation = ? AND json_array_length(${column}) < ?`)
        .bind(JSON.stringify(candidates), id, generation, candidates.length).run();
      return jsonResponse({ ok: true });
    }
    const type = role === 'sender' ? 'offer' : 'answer';
    const description = validateDescription(body.description, type);
    if (type === 'offer') {
      if (generation === row.generation && description === row.offer) return jsonResponse({ ok: true });
      if (generation !== row.generation + 1) throw new SignalError(409, 'Negociação fora de sequência.');
      const result = await db.prepare("UPDATE camera_sessions SET offer = ?, answer = NULL, generation = ?, sender_candidates = '[]', receiver_candidates = '[]', restart_requested = 0, revision = revision + 1 WHERE id = ? AND generation = ?")
        .bind(description, generation, id, row.generation).run();
      if (!result.meta.changes) throw new SignalError(409, 'A conexão já está sendo atualizada.');
    } else {
      if (generation !== row.generation) return jsonResponse({ stale: true });
      if (!row.offer) throw new SignalError(409, 'A câmera ainda não iniciou a conexão.');
      if (row.answer && row.answer !== description) throw new SignalError(409, 'Esta resposta já foi negociada.');
      await db.prepare('UPDATE camera_sessions SET answer = ?, revision = revision + 1 WHERE id = ? AND generation = ? AND answer IS NULL').bind(description, id, generation).run();
    }
    return jsonResponse({ ok: true });
  } catch (e) {
    if (e instanceof SignalError) return jsonResponse({ error: e.message }, e.status);
    console.error('Signaling request failed', e?.name || 'Error');
    return jsonResponse({ error: 'Não foi possível parear agora. Tente novamente.' }, 500);
  }
}
