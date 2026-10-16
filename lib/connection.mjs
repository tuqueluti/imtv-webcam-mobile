import { applyBitrate, preferCodec, readRtpStats, EMPTY_STATS } from './camera.mjs';
import { randomToken, TOKEN_RE } from './signal.mjs';
import { AdaptiveQuality } from './quality.mjs';

let clientToken;
function browserToken() {
  if (clientToken) return clientToken;
  try { clientToken = localStorage.getItem('luticam.client.v2'); } catch {}
  if (!TOKEN_RE.test(clientToken || '')) clientToken = randomToken();
  try { localStorage.setItem('luticam.client.v2', clientToken); } catch {}
  return clientToken;
}
async function request(path, method = 'GET', data, credentials, signal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 10000);
  let response;
  try {
    response = await fetch(path, { method, credentials: 'omit', cache: 'no-store', signal: controller.signal, keepalive: method === 'DELETE',
      headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(credentials ? { 'X-Luticam-Token': credentials.token, 'X-Luticam-Role': credentials.role } : { 'X-Luticam-Client': browserToken() }) },
      ...(method !== 'GET' ? { body: JSON.stringify(data || {}) } : {}),
    });
  } catch (e) { if (e.name === 'AbortError' && signal?.aborted) throw e; throw new Error('Sem acesso ao pareamento. Verifique a internet nos dois dispositivos.'); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('O pareamento não respondeu. Atualize a página e tente novamente.');
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.error || 'Não foi possível conectar.'); error.status = response.status; throw error; }
  return body;
}
export class StudioConnection {
  constructor(callbacks = {}) {
    this.callbacks = callbacks; this.pc = null; this.session = null; this.cancelled = false;
    this.revision = -1; this.generation = 0; this.previousStats = new Map(); this.abort = new AbortController();
    this.busyStats = false; this.polling = false; this.restarts = []; this.parameterTask = Promise.resolve();
    this.resetIce();
  }
  emit(name, ...args) { if (!this.cancelled) this.callbacks[name]?.(...args); }
  state(value) { this.emit('onState', value); }
  resetIce() { this.pendingAnswer = null; this.localCandidates = []; this.remoteCandidateCount = 0; this.sentCandidateCount = 0; this.signalReady = false; this.negotiated = false; }
  async post(body) {
    for (let attempt = 0; ; attempt++) {
      if (this.cancelled) throw new DOMException('Cancelled', 'AbortError');
      try { return await request(`/api/sessions/${this.session.id}`, 'POST', body, this.session, this.abort.signal); }
      catch (e) {
        if (this.cancelled || e.name === 'AbortError' || (e.status && e.status < 500) || attempt >= 2) throw e;
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }
  async createReceiver() {
    this.state('preparing');
    const data = await request('/api/sessions', 'POST', {}, null, this.abort.signal);
    if (this.cancelled) { request(`/api/sessions/${data.id}`, 'DELETE', {}, { role: 'receiver', token: data.receiverToken }).catch(() => {}); return; }
    this.session = { ...data, role: 'receiver', token: data.receiverToken };
    this.state('waiting'); this.emit('onSession', data); this.poll();
  }
  async startSender(invite, stream, options) {
    this.state('preparing'); this.options = options; this.stream = stream;
    this.quality = new AdaptiveQuality({ ...options, fps: Math.min(options.fps, stream.getVideoTracks?.()[0]?.getSettings?.().frameRate || options.fps) });
    const senderToken = randomToken();
    await request(`/api/sessions/${invite.id}`, 'POST', { senderToken }, { role: 'join', token: invite.joinToken }, this.abort.signal);
    if (this.cancelled) return;
    this.session = { id: invite.id, role: 'sender', token: senderToken };
    const pc = this.makePeer(); stream.getTracks().forEach(track => pc.addTrack(track, stream));
    preferCodec(pc, options.codec || 'auto');
    this.attachChannel(pc.createDataChannel('health', { ordered: false, maxRetransmits: 0 }));
    await this.sendOffer(false);
    if (this.cancelled) return;
    this.state('connecting'); this.poll(); this.armRecovery(15000);
  }
  async sendOffer(restart) {
    if (this.offering || this.cancelled) return;
    this.offering = true;
    try {
      if (!this.pendingOffer) {
        this.generation++; this.resetIce();
        await this.pc.setLocalDescription(await this.pc.createOffer({ iceRestart: restart }));
        this.pendingOffer = this.pc.localDescription.toJSON();
      }
      await this.post({ description: this.pendingOffer, generation: this.generation });
      this.pendingOffer = null;
      if (this.cancelled) return;
      this.signalReady = true; this.queueCandidates();
      await this.setBitrate(this.options.bitrate, this.options.fps);
    } finally { this.offering = false; }
  }
  makePeer() {
    // Same-LAN transport. No third-party relay receives media or network metadata.
    const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    this.pc = pc;
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || this.cancelled || this.pc !== pc || this.localCandidates.length >= 64) return;
      const value = candidate.toJSON();
      if (value.usernameFragment && !pc.localDescription?.sdp.includes(`a=ice-ufrag:${value.usernameFragment}`)) return;
      this.localCandidates.push(value); this.queueCandidates();
    };
    pc.ondatachannel = ({ channel }) => this.attachChannel(channel);
    pc.ontrack = ({ track, streams }) => {
      if (!this.remoteStream) this.remoteStream = streams[0] || new MediaStream();
      if (!this.remoteStream.getTracks().some(t => t.id === track.id)) this.remoteStream.addTrack(track);
      this.emit('onStream', this.remoteStream);
    };
    pc.onconnectionstatechange = () => {
      if (this.cancelled || this.pc !== pc) return;
      const status = pc.connectionState;
      if (status === 'connected') {
        clearTimeout(this.recoveryTimer); this.state('connected'); this.beginStats();
        if (this.session.role === 'sender') this.setBitrate(this.options.bitrate, this.options.fps).catch(() => {});
      } else if (status === 'connecting') this.state('connecting');
      else if (status === 'disconnected' || status === 'failed') { this.state('reconnecting'); this.armRecovery(status === 'failed' ? 100 : 4000); }
    };
    return pc;
  }
  attachChannel(channel) {
    this.channel = channel;
    channel.onmessage = event => {
      // Only small numeric telemetry is accepted; no remote commands or SDP here.
      if (this.session?.role !== 'sender' || typeof event.data !== 'string' || event.data.length > 1024) return;
      try {
        const value = JSON.parse(event.data);
        if (value.type === 'health' && [value.fps, value.decodeMs, value.lossPercent].every(n => n == null || (Number.isFinite(n) && n >= 0 && n < 100000))) this.receiverHealth = { ...value, receivedAt: Date.now() };
      } catch {}
    };
  }
  queueCandidates() {
    if (this.cancelled || !this.signalReady || this.candidateTimer) return;
    this.candidateTimer = setTimeout(() => { this.candidateTimer = null; this.flushCandidates(); }, 40);
  }
  async flushCandidates() {
    if (this.sendingCandidates || this.cancelled || !this.signalReady || this.sentCandidateCount >= this.localCandidates.length) return;
    this.sendingCandidates = true;
    const generation = this.generation, candidates = [...this.localCandidates];
    try {
      await this.post({ candidates, generation });
      if (generation === this.generation) this.sentCandidateCount = candidates.length;
    } catch (e) { if (!this.cancelled) this.emit('onNotice', 'A rede oscilou durante o pareamento. Tentando novamente.'); }
    finally { this.sendingCandidates = false; }
    // The regular poll retries failed batches, avoiding a busy retry loop.
    if (this.sentCandidateCount === candidates.length && this.localCandidates.length > candidates.length) this.queueCandidates();
  }
  armRecovery(ms) {
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = setTimeout(() => this.recover(), ms);
  }
  async recover() {
    if (this.cancelled || !this.pc || this.pc.connectionState === 'connected') return;
    this.restarts = this.restarts.filter(t => Date.now() - t < 60000);
    if (this.restarts.length >= 3) { this.state('failed'); this.emit('onError', 'A rede não permitiu reconectar. Confira o Wi-Fi nos dois dispositivos e crie uma nova conexão.'); return; }
    this.restarts.push(Date.now()); this.state('reconnecting');
    try {
      if (this.session.role === 'sender') await this.sendOffer(true);
      else if (this.generation) await this.post({ restart: true, generation: this.generation });
    } catch (e) { this.emit('onNotice', 'Tentando recuperar a conexão…'); }
    if (!this.cancelled) this.armRecovery(12000);
  }
  async setBitrate(mbps, fps) {
    if (this.options) this.options = { ...this.options, bitrate: mbps, fps };
    this.parameterTask = this.parameterTask.catch(() => {}).then(async () => {
      if (!this.pc || this.cancelled) return;
      const sender = this.pc.getSenders().find(s => s.track?.kind === 'video');
      const applied = await applyBitrate(sender, mbps, fps, this.quality?.scale || 1);
      if (!applied) this.emit('onNotice', 'O navegador está controlando o envio automaticamente. Veja a resolução e o bitrate reais no painel.');
    });
    return this.parameterTask;
  }
  async poll() {
    if (this.cancelled || !this.session || this.polling) return;
    clearTimeout(this.pollTimer); this.polling = true;
    try {
      const s = await request(`/api/sessions/${this.session.id}?revision=${this.revision}`, 'GET', null, this.session, this.abort.signal);
      if (this.cancelled) return;
      this.failures = 0;
      if (!s.unchanged) {
        this.emit('onClaimed', s.claimed);
        if (this.session.role === 'receiver' && s.description && (s.generation > this.generation || !this.negotiated)) {
          if (s.generation > this.generation) {
            this.state(this.pc ? 'reconnecting' : 'connecting');
            this.generation = s.generation; this.resetIce();
          }
          if (!this.pendingAnswer) {
            const pc = this.pc || this.makePeer();
            await pc.setRemoteDescription(s.description);
            await pc.setLocalDescription(await pc.createAnswer());
            this.pendingAnswer = pc.localDescription.toJSON();
          }
          await this.post({ description: this.pendingAnswer, generation: this.generation });
          if (this.cancelled) return;
          this.pendingAnswer = null; this.signalReady = true; this.negotiated = true; this.queueCandidates();
          this.armRecovery(15000);
        } else if (this.session.role === 'sender' && s.description && s.generation === this.generation && !this.negotiated) {
          await this.pc.setRemoteDescription(s.description); this.negotiated = true;
        }
        if (s.generation === this.generation && this.pc?.remoteDescription) {
          for (const c of (s.candidates || []).slice(this.remoteCandidateCount)) {
            await this.pc.addIceCandidate(c); this.remoteCandidateCount++;
          }
        }
        if (s.restartRequested && this.session.role === 'sender' && s.generation === this.generation && !this.offering) {
          // The receiver can detect a path failure before the sender does.
          this.restarts = this.restarts.filter(t => Date.now() - t < 60000);
          if (this.restarts.length < 3) { this.restarts.push(Date.now()); this.state('reconnecting'); await this.sendOffer(true); this.armRecovery(12000); }
        }
        this.revision = s.revision;
      }
      this.queueCandidates();
    } catch (e) {
      if (this.cancelled || e.name === 'AbortError') return;
      if ([403, 404, 409, 410].includes(e.status)) {
        this.emit('onError', [404, 410].includes(e.status) ? 'A conexão foi encerrada. Crie uma nova no computador.' : e.message);
        this.state('ended'); await this.stop(false); this.callbacks.onEnded?.(); return;
      }
      this.failures = (this.failures || 0) + 1;
      if (this.failures === 3) this.emit('onNotice', 'Pareamento temporariamente indisponível. O vídeo conectado continua; tentando recuperar o controle.');
      if (this.failures >= 12 && this.pc?.connectionState !== 'connected') { this.state('failed'); await this.stop(false); this.callbacks.onEnded?.(); return; }
    } finally { this.polling = false; }
    if (!this.cancelled) this.pollTimer = setTimeout(() => this.poll(), this.failures ? Math.min(1000 * this.failures, 10000) : this.pc?.connectionState === 'connected' ? 2500 : this.session.role === 'receiver' && !this.pc ? 700 : 300);
  }
  beginStats() {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(() => this.sampleStats(), 1500);
  }
  async sampleStats() {
    if (this.busyStats || this.cancelled || !this.pc) return;
    this.busyStats = true;
    try {
      const { stats, next } = readRtpStats(await this.pc.getStats(), this.session.role, this.previousStats);
      this.previousStats = next;
      if (this.session.role === 'sender') {
        const health = this.receiverHealth && Date.now() - this.receiverHealth.receivedAt < 6000 ? this.receiverHealth : null;
        const decision = this.quality.sample({ ...stats, fps: health?.fps != null && stats.fps != null ? Math.min(stats.fps, health.fps) : stats.fps, lossPercent: Math.max(stats.lossPercent || 0, health?.lossPercent || 0), quality: health?.decodeMs > 1000 / this.quality.fps ? 'cpu' : stats.quality });
        if (decision) { await this.setBitrate(this.options.bitrate, this.options.fps); this.emit('onNotice', decision.reason); }
        stats.scale = this.quality.scale;
      } else if (this.channel?.readyState === 'open' && this.channel.bufferedAmount < 1024) {
        this.channel.send(JSON.stringify({ type: 'health', fps: stats.fps, decodeMs: stats.decodeMs, lossPercent: stats.lossPercent }));
      }
      this.emit('onStats', stats);
    } catch { /* Optional telemetry cannot interrupt media. */ }
    finally { this.busyStats = false; }
  }
  async stop(notify = true) {
    if (this.cancelled) return;
    this.cancelled = true; this.abort.abort();
    for (const t of [this.pollTimer, this.recoveryTimer, this.candidateTimer]) clearTimeout(t);
    clearInterval(this.statsTimer);
    if (this.channel) { this.channel.onmessage = null; this.channel.close(); }
    if (this.pc) { this.pc.onconnectionstatechange = null; this.pc.ontrack = null; this.pc.onicecandidate = null; this.pc.ondatachannel = null; this.pc.close(); this.pc = null; }
    this.remoteStream?.getTracks().forEach(t => t.stop());
    if (notify && this.session) await request(`/api/sessions/${this.session.id}`, 'DELETE', {}, this.session).catch(() => {});
    this.callbacks.onStats?.({ ...EMPTY_STATS });
  }
}
