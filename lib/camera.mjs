export const PROFILES = {
  auto: { label: 'Automático · recomendado', width: 1920, height: 1080 },
  '4k': { label: '4K UHD', width: 3840, height: 2160 },
  '1080': { label: 'Full HD', width: 1920, height: 1080 },
  '720': { label: 'HD', width: 1280, height: 720 },
};
export const EMPTY_STATS = { width: 0, height: 0, fps: null, mbps: null, rtt: null, codec: null, quality: null, packetsLost: null, lossPercent: null, jitterMs: null, bufferMs: null, availableMbps: null, encodeMs: null, decodeMs: null, freezes: null };
export function makeConstraints({ profile = 'auto', fps = 30, deviceId = '', facing = 'environment', audio = true } = {}) {
  const p = PROFILES[profile] || PROFILES.auto;
  return { video: {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } }),
    width: { ideal: p.width, max: p.width }, height: { ideal: p.height, max: p.height },
    frameRate: { ideal: Math.min(60, Number(fps) || 30), max: Math.min(60, Number(fps) || 30) },
    resizeMode: { ideal: 'crop-and-scale' },
  }, audio: audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false };
}
export function resolutionLabel(settings) {
  return settings?.width && settings?.height ? `${settings.width} × ${settings.height}` : '—';
}
export function describeCapture(settings, options) {
  const p = PROFILES[options.profile];
  if (!settings.width || !settings.height) return 'O navegador ainda não informou a resolução da câmera.';
  const long = Math.max(settings.width, settings.height), short = Math.min(settings.width, settings.height);
  const notes = [];
  if (options.profile !== 'auto' && p && (long < p.width || short < p.height)) notes.push(`Você pediu ${p.label}; a câmera liberou ${resolutionLabel(settings)}.`);
  if (settings.frameRate && settings.frameRate + 1 < options.fps) notes.push(`O aparelho liberou ${Math.round(settings.frameRate)} fps, abaixo dos ${options.fps} fps solicitados.`);
  if (notes.length) return notes.join(' ');
  return `Captura confirmada: ${resolutionLabel(settings)}${settings.frameRate ? ` a ${Math.round(settings.frameRate)} fps` : ''}. A resolução de envio será medida ao conectar.`;
}
export function cameraError(error) {
  const messages = {
    NotAllowedError: 'Permita o acesso à câmera e ao microfone nas configurações do navegador e tente novamente.',
    NotFoundError: 'Não encontrei essa câmera ou microfone. Selecione outra câmera ou desative o áudio.',
    NotReadableError: 'A câmera está ocupada. Feche outros aplicativos que estejam usando a câmera.',
    OverconstrainedError: 'Este perfil não está disponível. Tente Automático ou HD a 30 fps.',
    SecurityError: 'Abra o LutiCam diretamente no Safari ou Chrome, usando o endereço HTTPS.',
  };
  return messages[error?.name] || error?.message || 'Não foi possível abrir a câmera.';
}
export async function captureCamera(options, mediaDevices = navigator.mediaDevices) {
  if (!mediaDevices?.getUserMedia) throw new Error('Este navegador não oferece câmera. Abra o endereço HTTPS no Safari (iPhone) ou Chrome (Android).');
  const stream = await mediaDevices.getUserMedia(makeConstraints(options));
  try {
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('Nenhuma imagem de câmera recebida.');
    track.contentHint = 'motion';
    const capabilities = track.getCapabilities?.() || {};
    const settings = track.getSettings();
    return { stream, track, capabilities, settings, note: describeCapture(settings, options) };
  } catch (error) { stream.getTracks().forEach(t => t.stop()); throw error; }
}
export async function setCameraControl(track, name, value) {
  const caps = track.getCapabilities?.() || {};
  if (name === 'torch' && !caps.torch) throw new Error('Lanterna não disponível nesta câmera.');
  if (name === 'zoom' && (!caps.zoom || value < caps.zoom.min || value > caps.zoom.max)) throw new Error('Zoom fora do intervalo disponível.');
  if (!['torch', 'zoom'].includes(name)) throw new Error('Controle inválido.');
  await track.applyConstraints({ advanced: [{ [name]: value }] });
}
export function preferCodec(pc, preferred = 'auto', receiverType = globalThis.RTCRtpReceiver) {
  if (preferred === 'auto') return false;
  const caps = receiverType?.getCapabilities?.('video');
  if (!caps?.codecs?.some(c => c.mimeType.toLowerCase() === preferred.toLowerCase())) return false;
  const codecs = [...caps.codecs].sort((a, b) => Number(b.mimeType.toLowerCase() === preferred.toLowerCase()) - Number(a.mimeType.toLowerCase() === preferred.toLowerCase()));
  let applied = false;
  for (const transceiver of pc.getTransceivers()) {
    if ((transceiver.sender.track?.kind === 'video' || transceiver.receiver.track?.kind === 'video') && transceiver.setCodecPreferences) {
      try { transceiver.setCodecPreferences(codecs); applied = true; } catch { /* Use negotiated defaults. */ }
    }
  }
  return applied;
}
export async function applyBitrate(sender, mbps, fps, scale = 1) {
  if (!sender?.getParameters) return false;
  const params = sender.getParameters();
  if (!params.encodings?.length) return false;
  for (const encoding of params.encodings) {
    encoding.maxBitrate = Math.round(Math.max(1, Math.min(60, Number(mbps) || 25)) * 1_000_000);
    encoding.maxFramerate = Math.max(1, Math.min(60, Number(fps) || 30));
    encoding.scaleResolutionDownBy = Math.max(1, Math.min(4, scale));
  }
  params.degradationPreference = 'maintain-framerate';
  try { await sender.setParameters(params); return true; }
  catch {
    delete params.degradationPreference;
    try { await sender.setParameters(params); return true; } catch { return false; }
  }
}
export function parseInvite(value) {
  let code = String(value || '').trim();
  if (code.startsWith('https://') || code.startsWith('http://')) {
    const url = new URL(code); code = new URLSearchParams(url.hash.slice(1)).get('join') || '';
  }
  if (code.startsWith('LC1.')) throw new Error('Este convite é da versão anterior. Atualize o computador e crie uma nova conexão.');
  const match = /^LC2\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i.exec(code);
  if (!match) throw new Error('Cole o link ou código completo criado no computador.');
  return { id: match[1], joinToken: match[2], code };
}
export function readRtpStats(report, role, previous = new Map()) {
  let video = null, pair = null;
  const next = new Map();
  report.forEach(item => {
    if (item.type === (role === 'sender' ? 'outbound-rtp' : 'inbound-rtp') && (item.kind === 'video' || item.mediaType === 'video') && !item.isRemote) {
      if (!video || (item.bytesSent || item.bytesReceived || 0) > (video.bytesSent || video.bytesReceived || 0)) video = item;
    }
    if (item.type === 'transport' && item.selectedCandidatePairId) pair = report.get(item.selectedCandidatePairId);
  });
  if (!pair) report.forEach(i => { if (i.type === 'candidate-pair' && i.state === 'succeeded' && i.nominated) pair = i; });
  const stats = { ...EMPTY_STATS };
  if (video) {
    const bytes = role === 'sender' ? video.bytesSent : video.bytesReceived;
    const frames = role === 'sender' ? video.framesEncoded : video.framesDecoded;
    const old = previous.get(video.id);
    const seconds = old ? (video.timestamp - old.timestamp) / 1000 : 0;
    stats.width = video.frameWidth || 0; stats.height = video.frameHeight || 0;
    stats.mbps = old && seconds > 0 && bytes >= old.bytes ? (bytes - old.bytes) * 8 / seconds / 1_000_000 : null;
    stats.fps = video.framesPerSecond ?? (old && seconds > 0 && frames >= old.frames ? (frames - old.frames) / seconds : null);
    stats.codec = report.get(video.codecId)?.mimeType?.replace('video/', '') || null;
    stats.quality = video.qualityLimitationReason || null; stats.packetsLost = video.packetsLost ?? null;
    const remote = role === 'sender' ? report.get(video.remoteId) : video;
    const packets = role === 'sender' ? video.packetsSent : video.packetsReceived;
    const lost = remote?.packetsLost;
    const lostDelta = old && lost != null && old.lost != null ? Math.max(0, lost - old.lost) : null;
    const packetDelta = old && packets >= old.packets ? packets - old.packets : 0;
    stats.lossPercent = lostDelta != null && packetDelta + lostDelta > 0 ? 100 * lostDelta / (packetDelta + lostDelta) : null;
    stats.packetsLost = lost ?? null;
    stats.jitterMs = remote?.jitter != null ? remote.jitter * 1000 : null;
    const frameDelta = old && frames >= old.frames ? frames - old.frames : 0;
    const duration = role === 'sender' ? video.totalEncodeTime : video.totalDecodeTime;
    const frameMs = frameDelta && old?.duration != null && duration >= old.duration ? (duration - old.duration) * 1000 / frameDelta : null;
    if (role === 'sender') stats.encodeMs = frameMs; else stats.decodeMs = frameMs;
    const emitted = video.jitterBufferEmittedCount, delay = video.jitterBufferDelay;
    stats.bufferMs = old && emitted > old.emitted && delay >= old.delay ? (delay - old.delay) * 1000 / (emitted - old.emitted) : null;
    stats.freezes = video.freezeCount ?? null;
    next.set(video.id, { bytes, frames, timestamp: video.timestamp, packets, lost, duration, emitted, delay });
  }
  stats.rtt = pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null;
  stats.availableMbps = pair?.availableOutgoingBitrate != null ? pair.availableOutgoingBitrate / 1e6 : null;
  return { stats, next };
}
