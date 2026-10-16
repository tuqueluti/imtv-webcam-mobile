// Original signaling protocol. Video and audio never pass through this API.
export const MAX_BODY = 160_000;
export const SESSION_MS = 4 * 60 * 60 * 1000;
export const INVITE_MS = 15 * 60 * 1000;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export class SignalError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
export async function hashToken(token) {
  if (!TOKEN_RE.test(token ?? "")) throw new SignalError(403, "Chave de conexão inválida.");
  return sha256(token);
}
export async function sha256(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("");
}
export function verifyOrigin(request) {
  if (request.method === "GET") return;
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new SignalError(403, "Origem não autorizada.");
  if (!(request.headers.get("content-type") || "").startsWith("application/json")) throw new SignalError(415, "Envie dados JSON.");
}
export async function readBody(request) {
  const size = Number(request.headers.get("content-length") || 0);
  if (size > MAX_BODY) throw new SignalError(413, "Pedido muito grande.");
  const reader = request.body?.getReader(); if (!reader) return {};
  const chunks = []; let bytes = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY) { await reader.cancel(); throw new SignalError(413, "Pedido muito grande."); }
    chunks.push(value);
  }
  const data = new Uint8Array(bytes); let offset = 0;
  for (const c of chunks) { data.set(c, offset); offset += c.length; }
  try {
    const body = JSON.parse(new TextDecoder().decode(data) || "{}");
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error();
    return body;
  } catch { throw new SignalError(400, "JSON inválido."); }
}
export function validateDescription(value, type) {
  if (!value || value.type !== type || typeof value.sdp !== "string" || value.sdp.length > 120_000 || !value.sdp.startsWith("v=0") || !value.sdp.includes("m=video")) throw new SignalError(400, "Descrição de vídeo inválida.");
  return JSON.stringify({ type, sdp: value.sdp });
}
export function assertSession(row, now = Date.now()) {
  if (!row || !row.owner.startsWith('public:v2:')) throw new SignalError(404, "Conexão não encontrada.");
  if (row.closed || row.expires_at <= now) throw new SignalError(410, "Conexão encerrada ou expirada. Crie uma nova no computador.");
}
export async function authorize(row, role, token) {
  const expected = role === "receiver" ? row.viewer_hash : role === "sender" ? row.sender_hash : null;
  if (!expected || expected !== await hashToken(token)) throw new SignalError(403, "Chave não autorizada para este dispositivo.");
}
export function snapshot(row, role) {
  return { generation: row.generation, restartRequested: !!row.restart_requested, candidates: JSON.parse(role === 'receiver' ? row.sender_candidates : row.receiver_candidates), revision: row.revision, claimed: !!row.sender_hash, expiresAt: row.expires_at, joinExpiresAt: row.join_expires_at, description: (role === "receiver" ? row.offer : row.answer) ? JSON.parse(role === "receiver" ? row.offer : row.answer) : null };
}
export function jsonResponse(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}

export function validateCandidates(value) {
  if (!Array.isArray(value) || value.length > 64) throw new SignalError(400, 'Lista de candidatos inválida.');
  return value.map(c => {
    if (!c || typeof c.candidate !== 'string' || c.candidate.length > 2048 || (c.candidate && !c.candidate.startsWith('candidate:')) || (c.sdpMid != null && (typeof c.sdpMid !== 'string' || c.sdpMid.length > 64)) || (c.sdpMLineIndex != null && (!Number.isInteger(c.sdpMLineIndex) || c.sdpMLineIndex < 0 || c.sdpMLineIndex > 16)) || (c.usernameFragment != null && (typeof c.usernameFragment !== 'string' || c.usernameFragment.length > 256))) throw new SignalError(400, 'Candidato inválido.');
    return { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null, usernameFragment: c.usernameFragment ?? null };
  });
}
