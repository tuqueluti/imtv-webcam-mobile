'use client';

import { useEffect, useRef, useState } from 'react';
import { Aperture, ArrowDownToLine, ArrowLeft, ArrowUpRight, Camera, Check, ChevronRight, CircleHelp, Clipboard, Download, Expand, Grid2X2, Info, Link2, LoaderCircle, Maximize, Mic, MicOff, Monitor, Radio, RefreshCw, ShieldCheck, Smartphone, Square, Video, Volume2, VolumeX, Wifi, X, Zap } from 'lucide-react';
import QRCode from 'qrcode';
import { captureCamera, cameraError, setCameraControl, PROFILES, EMPTY_STATS, resolutionLabel, parseInvite } from '../lib/camera.mjs';
import { StudioConnection } from '../lib/connection.mjs';

type Mode = 'camera' | 'receiver';
type Options = { profile: string; fps: number; bitrate: number; deviceId: string; facing: string; audio: boolean; codec: string };
const defaults: Options = { profile: 'auto', fps: 30, bitrate: 12, deviceId: '', facing: 'environment', audio: true, codec: 'auto' };
const states: Record<string, string> = { idle: 'Pronto para começar', preview: 'Prévia local', preparing: 'Preparando conexão', waiting: 'Aguardando celular', connecting: 'Conectando', connected: 'Transmitindo ao vivo', reconnecting: 'Reconectando', failed: 'Conexão interrompida', ended: 'Conexão encerrada' };

export default function Studio({ initialMode = 'auto', initialClean = false }: { initialMode?: string; initialClean?: boolean }) {
  const [mode, setMode] = useState<Mode>(initialMode === 'camera' ? 'camera' : 'receiver');
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('idle');
  const [options, setOptions] = useState<Options>(defaults);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capture, setCapture] = useState<any>(null);
  const [caps, setCaps] = useState<any>({});
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [qualityNotice, setQualityNotice] = useState('');
  const [stats, setStats] = useState<any>(EMPTY_STATS);
  const [session, setSession] = useState<any>(null);
  const [invite, setInvite] = useState<any>(null);
  const [inviteText, setInviteText] = useState('');
  const [qr, setQr] = useState('');
  const [pairLink, setPairLink] = useState('');
  const [claimed, setClaimed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [toast, setToast] = useState('');
  const [help, setHelp] = useState<'guide' | 'research' | 'install' | null>(null);
  const [grid, setGrid] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [mic, setMic] = useState(true);
  const [listen, setListen] = useState(false);
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [clean, setClean] = useState(initialClean);
  const [online, setOnline] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const video = useRef<HTMLVideoElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const connection = useRef<any>(null);
  const local = useRef<MediaStream | null>(null);
  const wake = useRef<any>(null);
  const operation = useRef(0);
  const alive = useRef(true);
  const connected = status === 'connected';
  const active = ['preparing', 'waiting', 'connecting', 'connected', 'reconnecting'].includes(status);
  const transmitting = mode === 'camera' && active;
  const cleanView = clean && mode === 'receiver' && !!stream;
  const paired = !!invite;

  useEffect(() => {
    alive.current = true;
    const url = new URL(window.location.href);
    const join = new URLSearchParams(url.hash.slice(1)).get('join');
    if (join) {
      try { const parsed = parseInvite(join); setInvite(parsed); setInviteText(parsed.code); setMode('camera'); history.replaceState(null, '', '/?mode=camera'); }
      catch (e: any) { setError(e.message); }
    } else if (initialMode === 'auto') setMode(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'camera' : 'receiver');
    try { const saved = JSON.parse(localStorage.getItem('luticam.preferences.v2') || 'null'); if (saved) setOptions({ ...defaults, ...saved, deviceId: '' }); } catch {}
    setOnline(navigator.onLine); setReady(true);
    const network = () => setOnline(navigator.onLine);
    const install = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setClean(false); setHelp(null); } };
    const visibility = () => {
      if (document.visibilityState === 'visible' && (local.current || connection.current?.pc)) requestWake();
    };
    const pagehide = () => {
      local.current?.getTracks().forEach(t => t.stop());
      connection.current?.stop();
      wake.current?.release().catch(() => {});
    };
    const pageshow = (e: PageTransitionEvent) => { if (e.persisted) { local.current = null; connection.current = null; setStream(null); setCapture(null); setSession(null); setStatus('ended'); setError('A página foi suspensa. Crie uma nova conexão para continuar.'); } };
    window.addEventListener('online', network); window.addEventListener('offline', network);
    window.addEventListener('beforeinstallprompt', install); window.addEventListener('keydown', key);
    window.addEventListener('pagehide', pagehide); window.addEventListener('pageshow', pageshow);
    document.addEventListener('visibilitychange', visibility);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => {
      alive.current = false; operation.current++; pagehide();
      window.removeEventListener('online', network); window.removeEventListener('offline', network);
      window.removeEventListener('beforeinstallprompt', install); window.removeEventListener('keydown', key);
      window.removeEventListener('pagehide', pagehide); window.removeEventListener('pageshow', pageshow);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => { try { if (ready) localStorage.setItem('luticam.preferences.v2', JSON.stringify({ profile: options.profile, fps: options.fps, bitrate: options.bitrate, facing: options.facing, audio: options.audio, codec: options.codec })); } catch {} }, [options, ready]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = stream;
    if (stream) element.play().catch(() => { if (alive.current) setNote('Toque no vídeo para iniciar a reprodução.'); });
  }, [stream, mode]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3200); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    if (!session?.joinToken) { setQr(''); setPairLink(''); return; }
    const link = `${location.origin}/?mode=camera#join=LC2.${session.id}.${session.joinToken}`;
    setPairLink(link);
    let cancelled = false;
    QRCode.toDataURL(link, { width: 300, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#10201b', light: '#ffffff' } }).then((data: string) => { if (!cancelled) setQr(data); }).catch(() => setNote('Use o botão Copiar convite para parear.'));
    return () => { cancelled = true; };
  }, [session]);
  async function requestWake() {
    try { if ('wakeLock' in navigator && (!wake.current || wake.current.released)) wake.current = await (navigator as any).wakeLock.request('screen'); } catch { /* Keep screen-on instruction visible regardless of availability. */ }
  }
  function stopLocal() {
    local.current?.getTracks().forEach(t => t.stop()); local.current = null;
    wake.current?.release().catch(() => {}); wake.current = null;
    if (alive.current) { setStream(null); setCapture(null); setCaps({}); setTorch(false); }
  }
  async function stopAll() {
    operation.current++;
    stopLocal();
    const old = connection.current; connection.current = null;
    if (old?.session?.role === 'sender') { setInvite(null); setInviteText(''); }
    setStatus('idle'); setSession(null); setClaimed(false); setStats({ ...EMPTY_STATS }); setBusy(false); setNote(''); setQualityNotice(''); setListen(false);
    if (old) old.stop().catch(() => {});
  }
  function makeConnection() {
    const conn = new StudioConnection({
      onState: (s: string) => { if (alive.current) { setStatus(s); if (s === 'connected') setError(''); } },
      onSession: (s: any) => setSession(s), onClaimed: setClaimed,
      onStream: (s: MediaStream) => setStream(s), onStats: setStats,
      onError: (message: string) => setError(message), onNotice: (message: string) => { setNote(message); setQualityNotice(message); },
      onEnded: () => { stopLocal(); setSession(null); setBusy(false); },
    });
    connection.current = conn; return conn;
  }
  async function createReceiver() {
    await stopAll(); setBusy(true); setError('');
    const conn = makeConnection();
    try { await requestWake(); await conn.createReceiver(); }
    catch (e: any) { if (e.name !== 'AbortError') { setError(e.message); setStatus('failed'); await conn.stop(); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function startCamera() {
    setBusy(true); setError(''); setNote('');
    const ticket = ++operation.current;
    try {
      if (!local.current) {
        const result = await captureCamera(options);
        if (ticket !== operation.current || !alive.current) { result.stream.getTracks().forEach((t: MediaStreamTrack) => t.stop()); return; }
        local.current = result.stream; setStream(result.stream); setCapture(result.settings); setCaps(result.capabilities); setNote(result.note); setStatus('preview'); setMic(options.audio); setZoom(result.settings.zoom || (result.capabilities as any).zoom?.min || 1);
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list.filter(d => d.kind === 'videoinput'));
        result.track.onended = () => { if (local.current) { stopAll(); setError('A câmera foi interrompida pelo sistema. Abra o app e inicie novamente.'); } };
      }
      await requestWake();
      if (ticket !== operation.current || !alive.current) return;
      if (invite) { const conn = makeConnection(); await conn.startSender(invite, local.current!, options); }
    } catch (e: any) {
      if (e.name !== 'AbortError' && alive.current && ticket === operation.current) { setError(cameraError(e)); setStatus(local.current ? 'preview' : 'failed'); await connection.current?.stop(); connection.current = null; }
    } finally { if (alive.current && ticket === operation.current) setBusy(false); }
  }
  async function changeMode(next: Mode) {
    if (next === mode) return;
    await stopAll(); setError(''); setMode(next); setClean(false);
    history.replaceState(null, '', `/?mode=${next}`);
  }
  async function copy(value: string, message = 'Copiado!') {
    try { await navigator.clipboard.writeText(value); setToast(message); }
    catch { setInviteText(value); setNote('A cópia automática não foi permitida. Selecione e copie o campo de convite.'); }
  }
  function acceptInvite() {
    try { setInvite(parseInvite(inviteText)); setError(''); setToast('Convite pronto. Agora ative a câmera.'); } catch (e: any) { setError(e.message); }
  }
  async function control(name: string, value: any) {
    try { const track = local.current?.getVideoTracks()[0]; if (!track) return; await setCameraControl(track, name, value); if (name === 'torch') setTorch(value); else setZoom(value); }
    catch (e: any) { setError(e.message); }
  }
  function toggleMic() {
    const tracks = local.current?.getAudioTracks() || [];
    if (!tracks.length) { setToast('Pare a câmera e habilite o microfone no perfil.'); return; }
    tracks.forEach(t => { t.enabled = !mic; }); setMic(!mic);
  }
  async function fullscreen() { try { if (screen.current?.requestFullscreen) await screen.current.requestFullscreen(); else setClean(true); } catch { setClean(true); } }
  async function install() {
    if (installPrompt) { await installPrompt.prompt(); setInstallPrompt(null); }
    else setHelp('install');
  }
  function downloadDiagnostics() {
    const data = { app: 'IMTV webcam mobile', version: '2.0.0', date: new Date().toISOString(), mode, status, requested: { profile: options.profile, fps: options.fps, maxMbps: options.bitrate }, capture: capture ? { width: capture.width, height: capture.height, frameRate: capture.frameRate, facingMode: capture.facingMode } : null, transmission: stats, browser: navigator.userAgent, online: navigator.onLine, adjustment: qualityNotice, reconnectAttempts: connection.current?.restarts?.length || 0 };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'luticam-diagnostico.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const cameraActive = !!capture;
  const displayResolution = mode === 'camera' ? resolutionLabel(capture) : resolutionLabel(stats);
  const statsResolution = resolutionLabel(stats);
  const mainButton = mode === 'receiver' ? (session ? 'Nova conexão' : 'Conectar meu celular') : (paired ? (cameraActive ? 'Transmitir para o estúdio' : 'Ativar câmera e transmitir') : 'Ativar câmera');

  return <div className={`app ${cleanView ? 'clean-output' : ''}`}>
    {!cleanView && <>
      <aside className="sidebar">
        <a className="brand imtv-brand" href="/" aria-label="IMTV webcam mobile — início"><img src="/imtv-logo.png" alt="IMTV Brasil" width={560} height={315}/><span className="brand-caption">webcam mobile</span></a>
        <div className="side-label">ESTÚDIO</div>
        <nav className="mode-nav" aria-label="Modo do aplicativo">
          <button className={mode === 'receiver' ? 'nav-item selected' : 'nav-item'} onClick={() => changeMode('receiver')}><Monitor size={19}/><span>Receptor</span><span className="nav-count">PC</span></button>
          <button className={mode === 'camera' ? 'nav-item selected' : 'nav-item'} onClick={() => changeMode('camera')}><Camera size={19}/><span>Câmera</span><span className="nav-count">MOBILE</span></button>
        </nav>
        <div className="side-label secondary-label">RECURSOS</div>
        <button className="nav-item" onClick={() => setHelp('guide')}><CircleHelp size={19}/><span>Guia de conexão</span></button>
        <button className="nav-item" onClick={() => setHelp('research')}><Info size={19}/><span>Sobre o projeto</span></button>
        <div className="sidebar-bottom"><div className="privacy-card"><ShieldCheck size={20}/><strong>Sua imagem, sua conexão.</strong><p>Vídeo direto entre seus dispositivos na mesma rede.</p></div><button className="install-button" onClick={install}><Download size={16}/> Instalar aplicativo <ArrowUpRight size={15}/></button><span className="version">IMTV WEBCAM MOBILE <b>V2.0 · PWA</b></span></div>
      </aside>
      <div className="mobile-brand"><a className="brand imtv-brand" href="/" aria-label="IMTV webcam mobile — início"><img src="/imtv-logo.png" alt="IMTV Brasil" width={560} height={315}/><span className="brand-caption">webcam mobile</span></a><button className="icon-button" aria-label="Como instalar" onClick={install}><Download size={19}/></button></div>
    </>}
    <main className="workspace">
      {!cleanView && <>
        <header className="topbar"><span className="breadcrumb">Meu estúdio <ChevronRight size={14}/> <b>{mode === 'receiver' ? 'Receptor de vídeo' : 'Câmera do celular'}</b></span><span className={`network-pill ${online ? '' : 'offline'}`}><Wifi size={14}/>{online ? 'Use a mesma rede Wi-Fi' : 'Sem internet'}</span></header>
        <div className="page-heading"><div><p className="eyebrow"><span/> IMTV WEBCAM MOBILE</p><h1>{mode === 'receiver' ? 'Do celular para o seu estúdio.' : 'Sua melhor câmera. Conectada.'}</h1><p className="subtitle">{mode === 'receiver' ? 'Receba a imagem do Android ou iPhone e leve para o OBS ou vMix.' : 'Escolha a qualidade. A gente mostra o que a câmera realmente entrega.'}</p></div><button className="text-button desktop-guide" onClick={() => setHelp('guide')}>Como funciona <ArrowUpRight size={16}/></button></div>
        <div className="mobile-tabs"><button className={mode === 'receiver' ? 'active' : ''} onClick={() => changeMode('receiver')}><Monitor size={16}/> Receptor</button><button className={mode === 'camera' ? 'active' : ''} onClick={() => changeMode('camera')}><Camera size={16}/> Câmera</button></div>
        {!online && <div className="alert warning"><Wifi size={18}/>O pareamento precisa de internet. A transmissão já conectada pode continuar pela rede local.</div>}
        {error && <div className="alert error" role="alert"><Info size={18}/><span>{error}</span><button aria-label="Fechar aviso" onClick={() => setError('')}><X size={16}/></button></div>}
      </>}
      <div className="studio-grid">
        <section className="monitor-column">
          {!cleanView && <div className="section-heading"><span><span className={`tiny-dot ${connected ? 'live' : ''}`}/>{mode === 'receiver' ? 'MONITOR DE VÍDEO' : 'PRÉVIA DA CÂMERA'}</span><span className={`state-label ${connected ? 'live-text' : ''}`}>{states[status]}</span></div>}
          <div className={`monitor ${grid && mode === 'camera' ? 'show-grid' : ''}`} ref={screen}>
            <video ref={video} autoPlay playsInline muted={mode === 'camera' || !listen} className={mirror && mode === 'camera' ? 'mirrored' : ''} onClick={() => video.current?.play().catch(() => setNote('Use o controle de áudio para autorizar a reprodução.'))} onLoadedMetadata={() => { if (mode === 'receiver' && video.current) setStats((s: any) => ({ ...s, width: s.width || video.current!.videoWidth, height: s.height || video.current!.videoHeight })); }}/>
            {!stream && <div className="monitor-empty"><div className="viewfinder"><i/><i/><i/><i/><div className="lens-outer"><div className="lens-inner">{mode === 'receiver' ? <Monitor size={35} strokeWidth={1.3}/> : <Camera size={35} strokeWidth={1.3}/>}</div></div></div><h2>{mode === 'receiver' ? (session ? 'Tudo pronto deste lado.' : 'Sua próxima imagem começa aqui.') : 'Pronto para abrir a câmera.'}</h2><p>{mode === 'receiver' ? (session ? 'Leia o QR Code com o celular e ative a câmera.' : 'Conecte seu celular para receber o vídeo em tempo real.') : 'A prévia só começa quando você permitir o acesso.'}</p><div className="signal-line"><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/></div></div>}
            {stream && !cleanView && <><div className="monitor-top"><span className={connected ? 'live-badge' : 'preview-badge'}><span/>{connected ? 'AO VIVO' : mode === 'camera' ? 'PRÉVIA LOCAL' : 'RECEBENDO'}</span><span className="resolution-tag">{displayResolution}{stats.fps != null ? ` · ${Math.round(stats.fps)} fps` : ''}</span></div>{grid && mode === 'camera' && <div className="grid-overlay"><i/><i/><b/><b/></div>}<div className="monitor-bottom"><span>{mode === 'camera' ? 'CÂMERA DO DISPOSITIVO' : 'IMTV / ENTRADA 01'}</span><button className="monitor-icon" aria-label="Tela cheia" onClick={fullscreen}><Maximize size={18}/></button></div></>}
            {stream && ['reconnecting', 'failed'].includes(status) && <div className="connection-overlay" role="status"><Wifi size={24}/><strong>{status === 'reconnecting' ? 'Recuperando a conexão…' : 'Conexão interrompida'}</strong><span>{status === 'reconnecting' ? 'Mantenha o celular e o receptor abertos.' : 'Volte ao painel para conectar novamente.'}</span></div>}
            {cleanView && <button className="exit-clean" onClick={() => setClean(false)}><ArrowLeft size={16}/> Voltar ao painel</button>}
          </div>
          {!cleanView && <>
            <div className="monitor-toolbar"><div className="toolbar-left">{mode === 'camera' ? <><button disabled={!cameraActive} title="Ativar ou silenciar microfone" aria-label="Ativar ou silenciar microfone" className={`tool-button ${cameraActive && !mic ? 'tool-off' : ''}`} onClick={toggleMic}>{mic ? <Mic size={18}/> : <MicOff size={18}/>}</button><button title="Grade na prévia local" aria-label="Grade na prévia local" className={`tool-button ${grid ? 'tool-selected' : ''}`} onClick={() => setGrid(!grid)}><Grid2X2 size={18}/></button><button title="Espelhar somente a prévia" aria-label="Espelhar somente a prévia" className={`tool-button ${mirror ? 'tool-selected' : ''}`} onClick={() => setMirror(!mirror)}><RefreshCw size={18}/></button>{caps.torch && <button title="Lanterna" aria-label="Lanterna" className={`tool-button ${torch ? 'tool-selected' : ''}`} onClick={() => control('torch', !torch)}><Zap size={18}/></button>}</> : <><button disabled={!stream} title="Ouvir áudio recebido" aria-label="Ouvir áudio recebido" className={`tool-button ${listen ? 'tool-selected' : ''}`} onClick={() => { setListen(!listen); video.current?.play().catch(() => {}); }}>{listen ? <Volume2 size={18}/> : <VolumeX size={18}/>}</button><span className="toolbar-hint">Áudio {listen ? 'ligado' : 'silenciado no monitor'}</span></>}</div><div className="toolbar-right">{mode === 'receiver' && <button className="text-button" disabled={!stream} onClick={() => setClean(true)}><Expand size={16}/> Saída limpa</button>}{(stream || session) && <button className="stop-button" onClick={stopAll}><Square size={13} fill="currentColor"/> Encerrar</button>}</div></div>
            {mode === 'camera' && cameraActive && caps.zoom && <div className="zoom-row"><label htmlFor="zoom">Zoom <b>{zoom.toFixed(1)}×</b></label><input id="zoom" type="range" min={caps.zoom.min} max={caps.zoom.max} step={caps.zoom.step || 0.1} value={zoom} onChange={e => control('zoom', Number(e.target.value))}/></div>}
            <div className="stats-grid"><div><span>{mode === 'camera' ? 'CAPTURA REAL' : 'RECEPÇÃO REAL'}</span><strong>{displayResolution}</strong><small>{mode === 'camera' && capture?.frameRate ? `${Math.round(capture.frameRate)} fps na câmera` : 'pixels por quadro'}</small></div><div><span>{mode === 'camera' ? 'ENVIO REAL' : 'QUADROS'}</span><strong>{mode === 'camera' ? statsResolution : stats.fps == null ? '—' : `${Math.round(stats.fps)} fps`}</strong><small>{mode === 'camera' ? stats.fps == null ? 'aguardando transmissão' : `${Math.round(stats.fps)} fps enviados` : 'medidos no receptor'}</small></div><div><span>BITRATE REAL</span><strong>{stats.mbps == null ? '—' : stats.mbps.toFixed(1)}<em>{stats.mbps != null ? ' Mbps' : ''}</em></strong><small>{stats.codec || 'codec após conectar'}</small></div><div><span>RTT DA REDE</span><strong>{stats.rtt == null ? '—' : stats.rtt}<em>{stats.rtt != null ? ' ms' : ''}</em></strong><small>ida e volta · não é latência total</small></div></div>
            {connected && <div className="health-strip"><span><span className="tiny-dot live"/> Conexão direta · sem login</span><span>{stats.lossPercent == null ? 'Analisando rede' : `${stats.lossPercent.toFixed(1)}% de perda`}</span><span>{stats.bufferMs == null ? (stats.scale > 1 ? 'Fluidez priorizada' : 'Ajuste automático ativo') : `${Math.round(stats.bufferMs)} ms de buffer`}</span></div>}
            {note && <div className="capture-note" aria-live="polite"><Info size={15}/><span>{note}</span></div>}
            {stats.quality && stats.quality !== 'none' && <div className="capture-note warning"><Info size={15}/><span>{stats.quality === 'cpu' ? 'O aparelho está sob carga. O ajuste automático está priorizando a fluidez.' : 'A rede está limitando o detalhe. O ajuste automático está ativo; use Wi-Fi 5 GHz ou 6 GHz, se disponível.'}</span></div>}
            <div className="workflow-strip"><div><span className="step-icon"><Smartphone size={20}/></span><div><strong>Câmera no celular</strong><small>Android ou iPhone</small></div></div><span className="step-connector"/><div><span className="step-icon"><Wifi size={20}/></span><div><strong>Mesma rede</strong><small>Wi-Fi local</small></div></div><span className="step-connector"/><div><span className="step-icon"><Video size={20}/></span><div><strong>Seu estúdio</strong><small>OBS ou vMix</small></div></div></div>
          </>}
        </section>
        {!cleanView && <aside className="controls-column">
          {mode === 'receiver' ? <>
            <div className="control-card pairing-card"><div className="card-heading"><span className="card-icon"><Link2 size={19}/></span><h2>Conecte seu celular</h2><span className="number-tag">01</span></div><p className="card-intro">Leia o QR Code no celular, usando a mesma rede Wi-Fi do computador. Sem cadastro e sem login.</p>
              {session ? <div className="pairing"><div className="qr-wrap">{qr ? <img src={qr} width={190} height={190} alt="QR Code privado para conectar a câmera"/> : <LoaderCircle className="spin"/>}</div><strong>{claimed ? 'Celular pareado' : 'Leia com a câmera do celular'}</strong><span>{claimed ? (connected ? 'Sua câmera está conectada.' : 'Ative a transmissão no celular.') : `Convite válido até ${new Date(session.joinExpiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}</span><button className="secondary-button" onClick={() => copy(pairLink, 'Convite copiado. Abra no celular.') }><Clipboard size={15}/> Copiar convite</button><details className="manual-code"><summary>Ver código para copiar manualmente</summary><textarea readOnly aria-label="Código de pareamento" value={`LC2.${session.id}.${session.joinToken}`}/></details></div> : <div className="pairing-placeholder"><div className="phone-symbol"><Smartphone size={42} strokeWidth={1.3}/><span><Check size={12}/></span></div><p>Um QR Code.<br/><strong>E a câmera é sua.</strong></p></div>}
              <button disabled={!ready || busy || (session && active && connected)} className="primary-button" onClick={createReceiver}>{busy ? <LoaderCircle className="spin" size={18}/> : session ? <RefreshCw size={17}/> : <Link2 size={18}/>} {mainButton}</button>
              <p className="micro-note"><ShieldCheck size={13}/> Sem conta · conexão protegida por convite</p>
            </div>
            <div className="control-card output-card"><div className="card-heading"><span className="card-icon"><Monitor size={18}/></span><h2>Leve para o OBS / vMix</h2><span className="number-tag">02</span></div><p>Depois de conectar, use <b>Saída limpa</b> e capture esta janela no seu programa.</p><button className="secondary-button" onClick={() => setHelp('guide')}>Ver configuração <ArrowUpRight size={16}/></button><p className="micro-note">A captura de janela depende da resolução do monitor. Veja o modo Fonte de navegador para preservar a resolução de entrada.</p></div>
          </> : <>
            <div className="control-card profile-card"><div className="card-heading"><span className="card-icon"><Camera size={19}/></span><h2>Perfil da câmera</h2><span className="mini-tag">AUTO</span></div>
              <div className="quick-presets" aria-label="Perfis rápidos"><button disabled={cameraActive || busy} onClick={() => setOptions({ ...options, profile: 'auto', fps: 30, bitrate: 12, codec: 'auto' })}>Equilibrado<small>Full HD · 30 fps</small></button><button disabled={cameraActive || busy} onClick={() => setOptions({ ...options, profile: '1080', fps: 60, bitrate: 20, codec: 'auto' })}>Mais fluido<small>Full HD · 60 fps</small></button><button disabled={cameraActive || busy} onClick={() => setOptions({ ...options, profile: '4k', fps: 30, bitrate: 35, codec: 'auto' })}>Mais detalhe<small>4K · 30 fps</small></button></div>
              <label className="field-label" htmlFor="camera-select">CÂMERA</label><select id="camera-select" disabled={cameraActive || busy} value={options.deviceId || options.facing} onChange={e => setOptions({ ...options, ...(e.target.value === 'environment' || e.target.value === 'user' ? { facing: e.target.value, deviceId: '' } : { deviceId: e.target.value }) })}><option value="environment">Traseira · automática</option><option value="user">Frontal</option>{devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Câmera ${i + 1}`}</option>)}</select>
              <div className="fields-row"><div><label className="field-label" htmlFor="resolution">RESOLUÇÃO PEDIDA</label><select id="resolution" disabled={cameraActive || busy} value={options.profile} onChange={e => setOptions({ ...options, profile: e.target.value, bitrate: e.target.value === '4k' ? 35 : e.target.value === '720' ? 6 : 12 })}>{Object.entries(PROFILES).map(([key, p]: any) => <option key={key} value={key}>{p.label}</option>)}</select></div><div><label className="field-label" htmlFor="fps">QUADROS</label><select id="fps" disabled={cameraActive || busy} value={options.fps} onChange={e => setOptions({ ...options, fps: Number(e.target.value) })}><option value={24}>24 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></select></div></div>
              <label className="field-label" htmlFor="bitrate">LIMITE DE BITRATE <span>{options.bitrate} Mbps</span></label><input id="bitrate" className="bitrate-range" type="range" min="4" max="60" step="1" value={options.bitrate} onChange={e => { const bitrate = Number(e.target.value); setOptions({ ...options, bitrate }); connection.current?.setBitrate(bitrate, options.fps); }}/><div className="range-labels"><span>Mais leve</span><span>Mais detalhe</span></div>
              <details className="advanced-settings"><summary>Compatibilidade de vídeo</summary><label className="field-label" htmlFor="codec">CODEC</label><select id="codec" disabled={cameraActive || busy} value={options.codec} onChange={e => setOptions({ ...options, codec: e.target.value })}><option value="auto">Automático · recomendado</option><option value="video/H264">Preferir H.264</option><option value="video/VP8">Preferir VP8</option></select><p className="micro-note">Se um computador continuar com dificuldade de decodificação, teste outro codec antes de iniciar.</p></details>
              <label className="switch-row"><span><Mic size={16}/> Capturar microfone</span><input type="checkbox" checked={options.audio} disabled={cameraActive || busy} onChange={e => setOptions({ ...options, audio: e.target.checked })}/></label>
              <div className="profile-tip"><Info size={15}/><p>{cameraActive ? 'Encerre a câmera para trocar lente, resolução ou FPS. O bitrate pode ser ajustado ao vivo.' : 'Automático começa em Full HD e ajusta o envio para manter a fluidez. Para mais detalhe, escolha 4K. A resolução real aparece no painel.'}</p></div>
              <button className="primary-button" disabled={!ready || busy || transmitting} onClick={startCamera}>{busy ? <LoaderCircle size={18} className="spin"/> : <Camera size={18}/>} {mainButton}</button>
              <p className="micro-note">Mantenha o app aberto e a tela ligada.</p>
            </div>
            <div className="control-card"><div className="card-heading"><span className="card-icon"><Link2 size={18}/></span><h2>{paired ? 'Convite carregado' : 'Parear com o computador'}</h2>{paired && <Check size={17} className="live-text"/>}</div><p className="card-intro">{paired ? 'Ao ativar a câmera, a imagem será enviada para esse receptor.' : 'No computador, abra Receptor e crie uma conexão. Leia o QR Code ou cole o convite aqui.'}</p><label className="sr-only" htmlFor="invite">Convite do computador</label><textarea id="invite" className="invite-input" placeholder="Cole o link ou código LC2…" value={inviteText} disabled={transmitting || busy} onChange={e => setInviteText(e.target.value)}/><button className="secondary-button" disabled={transmitting || busy || !inviteText.trim()} onClick={acceptInvite}><Link2 size={15}/> Usar este convite</button></div>
          </>}
        </aside>}
      </div>
      {!cleanView && <footer className="workspace-footer"><span><ShieldCheck size={13}/> Vídeo e áudio não são gravados pelo IMTV webcam mobile.</span><button onClick={downloadDiagnostics}><ArrowDownToLine size={14}/> Diagnóstico</button></footer>}
    </main>
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e => e.stopPropagation()}><button className="modal-close icon-button" onClick={() => setHelp(null)} aria-label="Fechar"><X size={21}/></button><p className="eyebrow">IMTV WEBCAM MOBILE</p><h2 id="modal-title">{help === 'guide' ? 'Da câmera para o estúdio.' : help === 'install' ? 'Um lugar na sua tela inicial.' : 'Feito para o seu fluxo.'}</h2>
      {help === 'guide' ? <div className="guide-content"><ol className="guide-steps"><li><b>No computador</b><p>Abra o modo <strong>Receptor</strong> e clique em Conectar meu celular. Deixe esta página aberta.</p></li><li><b>No celular</b><p>Use o Chrome no Android ou o Safari no iPhone. Leia o QR Code e toque em <strong>Ativar câmera e transmitir</strong>. Não é preciso conta ou senha. Permita a câmera e, se quiser áudio, o microfone.</p></li><li><b>Confira os números</b><p>Compare captura, envio e recepção reais. A resolução pedida e o limite de bitrate são metas; o aparelho e a rede podem entregar menos.</p></li><li><b>No OBS / vMix</b><p>Use Saída limpa e uma fonte de <strong>Captura de janela</strong> (OBS) ou <strong>Desktop Capture</strong> (vMix). A resolução final dessa captura é limitada pelo tamanho da janela e do monitor.</p></li></ol><details open><summary>Como preservar uma entrada em 4K</summary><p>No OBS, adicione uma <strong>Fonte de navegador</strong> com <code>{ready ? `${location.origin}/?mode=receiver&clean=1` : '/?mode=receiver&clean=1'}</code>. Defina a fonte em 3840 × 2160. Em <strong>Interagir</strong>, crie a conexão e pareie o celular diretamente com essa fonte. Só há um receptor por conexão.</p><p>O modo limpo aparece quando o vídeo chega. Para áudio, use Interagir, mova o mouse no canto superior esquerdo e clique em Voltar ao painel. Ative o áudio do monitor e retorne à Saída limpa; marque também Controlar áudio via OBS. Se o navegador interno bloquear WebRTC, use Captura de janela. Não foi validado em todas as versões de OBS/vMix.</p></details><details><summary>Quando a conexão não completa</summary><p>Use a mesma rede Wi-Fi, com internet para o pareamento. Evite redes de convidados, isolamento de clientes e VPN. Esta versão não tem retransmissão TURN e não foi feita para transmitir entre redes diferentes. Em quedas breves, o app tenta reconectar sozinho. Se a rede mudar ou a tela do celular for bloqueada, pode ser necessário parear novamente.</p></details><details><summary>Compatibilidade e limites</summary><p>Aplicativo web instalável (PWA), sem driver USB, APK ou IPA. Mantém um celular e um receptor por conexão, até quatro horas. No iPhone, bloquear a tela ou trocar de app pode suspender a câmera. Recursos e lentes dependem do que Safari/Chrome liberarem. A qualidade máxima do app nativo da câmera não é garantida.</p></details></div> : help === 'install' ? <div className="guide-content"><div className="install-option"><Smartphone/><div><h3>iPhone / iPad</h3><p>Abra no Safari → Compartilhar → <strong>Adicionar à Tela de Início</strong>. Mantenha o aplicativo aberto durante a transmissão.</p></div></div><div className="install-option"><Smartphone/><div><h3>Android</h3><p>Abra no Chrome → menu ⋮ → <strong>Instalar aplicativo</strong> ou Adicionar à tela inicial. Se o navegador exibir a instalação automática, aceite.</p></div></div><div className="install-option"><Monitor/><div><h3>Computador</h3><p>Use Chrome ou Edge. Você pode instalar pelo ícone de instalação na barra de endereço. Não é necessário entrar em uma conta.</p></div></div><p className="profile-tip">Este é um app web. A instalação não remove as limitações de câmera impostas pelo navegador.</p></div> : <div className="guide-content"><p>Um projeto original para transformar o celular em fonte de vídeo para o seu estúdio, inspirado na experiência dos aplicativos comerciais e na arquitetura dos projetos abertos.</p><div className="research-table"><table><thead><tr><th>Referência</th><th>O que orientou o IMTV webcam mobile</th></tr></thead><tbody><tr><td><a href="https://camo.com/pt/support/camo/camo-overview" target="_blank" rel="noreferrer">Camo Pro ↗</a></td><td>Controles de perfil e resolução. O 4K do Camo depende de licença e aparelho.</td></tr><tr><td><a href="https://iriun.com/" target="_blank" rel="noreferrer">Iriun ↗</a></td><td>Fluxo simples de celular para computador. Até 4K em modelos compatíveis.</td></tr><tr><td><a href="https://github.com/steveseguin/vdo.ninja" target="_blank" rel="noreferrer">VDO.Ninja ↗</a></td><td>Transporte WebRTC e entrada em software de estúdio. Código não incorporado.</td></tr><tr><td><a href="https://github.com/flutter-webrtc/flutter-webrtc" target="_blank" rel="noreferrer">flutter-webrtc ↗</a></td><td>Alternativa estudada para uma futura edição nativa Android/iOS.</td></tr><tr><td><a href="https://github.com/anchitanc/OBS-Mobile" target="_blank" rel="noreferrer">OBS-Mobile ↗</a></td><td>Referência de arquitetura em rede local. Código não incorporado.</td></tr></tbody></table></div><p><strong>O que já existe:</strong> captura de câmera, pareamento privado, transmissão direta, bitrate configurável, resolução efetiva e saída limpa.</p><p><strong>Validação:</strong> testes automatizados de protocolo, segurança e cálculo das métricas. Validação de câmera física, Safari/Chrome móvel e integração OBS/vMix ainda necessária.</p><p className="micro-note">Pesquisa de documentação oficial e repositórios em 16/10/2026. Nenhum código proprietário do Camo ou Iriun foi utilizado.</p></div>}
      <button className="primary-button modal-done" onClick={() => setHelp(null)}>Entendi <Check size={17}/></button></section></div>}
  </div>;
}
