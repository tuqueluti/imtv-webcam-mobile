import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConstraints, captureCamera, describeCapture, cameraError, applyBitrate, parseInvite, readRtpStats, setCameraControl, preferCodec } from '../lib/camera.mjs';
import { randomToken } from '../lib/signal.mjs';
test('4K remains available; auto caps capture at 1080p to avoid sensor-resolution overload',()=>{
  const c=makeConstraints({profile:'4k',fps:60,audio:false});assert.equal(c.video.width.ideal,3840);assert.equal(c.video.height.ideal,2160);assert.equal(c.video.frameRate.max,60);assert.equal(c.audio,false);
  assert.equal(makeConstraints({profile:'auto'}).video.width.max,1920);assert.equal(makeConstraints({profile:'auto'}).video.height.max,1080);
});
test('exact device ID overrides facing mode',()=>{
  const c=makeConstraints({deviceId:'device-2',facing:'user'});assert.deepEqual(c.video.deviceId,{exact:'device-2'});assert.equal(c.video.facingMode,undefined);
});
test('FPS is bounded and audio processing is off for studio capture',()=>{
  const c=makeConstraints({fps:120});assert.equal(c.video.frameRate.max,60);assert.equal(c.audio.echoCancellation,false);assert.equal(c.audio.autoGainControl,false);
});
test('actual resolution and lower FPS are exposed instead of claiming 4K',()=>{
  const note=describeCapture({width:1920,height:1080,frameRate:30},{profile:'4k',fps:60});assert.match(note,/1920 × 1080/);assert.match(note,/30 fps/);assert.match(note,/abaixo/);
});
test('portrait 4K is not incorrectly reported as a resolution downgrade',()=>{
  const note=describeCapture({width:2160,height:3840,frameRate:30},{profile:'4k',fps:30});assert.match(note,/confirmada/);
});
test('capture returns track settings and tolerates unavailable advanced constraints',async()=>{
  let stopped=false;const track={kind:'video',getCapabilities:()=>({width:{max:4096},height:{max:2160}}),applyConstraints:async()=>{throw new Error('not supported')},getSettings:()=>({width:1920,height:1080,frameRate:30}),stop:()=>{stopped=true}};
  const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
  const r=await captureCamera({profile:'auto',fps:30},{getUserMedia:async()=>stream});assert.equal(r.settings.width,1920);assert.equal(stopped,false);assert.match(r.note,/1920/);
});
test('capture stops tracks if setup fails after permissions',async()=>{
  let stopped=false;const track={getSettings:()=>{throw new Error('failed')},stop:()=>{stopped=true}};
  await assert.rejects(()=>captureCamera({profile:'1080'},{getUserMedia:async()=>({getVideoTracks:()=>[track],getTracks:()=>[track]})}));assert.equal(stopped,true);
});
test('permission error becomes actionable Portuguese message',()=>{assert.match(cameraError({name:'NotAllowedError'}),/Permita/);assert.match(cameraError({name:'NotReadableError'}),/ocupada/)});
test('bitrate uses bits per second, preserves encoding identity and never upscales',async()=>{
  let value;const sender={getParameters:()=>({transactionId:'x',encodings:[{rid:'f'}]}),setParameters:async p=>{value=p}};
  assert.equal(await applyBitrate(sender,25,30),true);assert.equal(value.encodings[0].maxBitrate,25_000_000);assert.equal(value.encodings[0].rid,'f');assert.equal(value.encodings[0].scaleResolutionDownBy,1);
});
test('unsupported bitrate is reported as unsupported rather than fake success',async()=>{
  assert.equal(await applyBitrate({getParameters:()=>({encodings:[]})},25,30),false);
  assert.equal(await applyBitrate({getParameters:()=>({encodings:[{}]}),setParameters:async()=>{throw new Error()}},25,30),false);
});
test('bitrate falls back if degradationPreference is not accepted',async()=>{
  let calls=0;const sender={getParameters:()=>({encodings:[{}]}),setParameters:async p=>{calls++;if(p.degradationPreference)throw new Error()}};
  assert.equal(await applyBitrate(sender,25,30),true);assert.equal(calls,2);
});
test('invites round-trip as code and as URL without leaking key into query',()=>{
  const id=crypto.randomUUID(),token=randomToken(),code=`LC2.${id}.${token}`;
  assert.equal(parseInvite(code).joinToken,token);assert.equal(parseInvite(`https://example.test/?mode=camera#join=${code}`).id,id);
  for(const bad of ['1234','LC2.bad.token','https://example.test/?join=secret','javascript:alert(1)'])assert.throws(()=>parseInvite(bad));
});
test('RTP metrics distinguish measured capture from negotiated transmission and RTT',()=>{
  const first=new Map([['v',{id:'v',type:'outbound-rtp',kind:'video',bytesSent:1000,framesEncoded:30,timestamp:1000,frameWidth:1920,frameHeight:1080,codecId:'c'}],['c',{mimeType:'video/H264'}],['t',{type:'transport',selectedCandidatePairId:'p'}],['p',{currentRoundTripTime:.012}]]);
  const a=readRtpStats(first,'sender');assert.equal(a.stats.mbps,null);assert.equal(a.stats.rtt,12);assert.equal(a.stats.codec,'H264');
  first.set('v',{...first.get('v'),bytesSent:3_001_000,framesEncoded:60,timestamp:2000});
  const b=readRtpStats(first,'sender',a.next);assert.equal(b.stats.mbps,24);assert.equal(b.stats.fps,30);assert.equal(b.stats.width,1920);
});
test('missing or reset counters never produce negative fake metrics',()=>{
  const p=new Map([['v',{bytes:999,frames:90,timestamp:1000}]]);const r=new Map([['v',{id:'v',type:'inbound-rtp',kind:'video',bytesReceived:5,framesDecoded:1,timestamp:2000}]]);
  const s=readRtpStats(r,'receiver',p).stats;assert.equal(s.mbps,null);assert.equal(s.fps,null);assert.equal(s.rtt,null);
});
test('camera controls enforce capabilities and zoom bounds',async()=>{
  let sent;const track={getCapabilities:()=>({torch:true,zoom:{min:1,max:4}}),applyConstraints:async p=>{sent=p}};
  await setCameraControl(track,'zoom',2);assert.deepEqual(sent,{advanced:[{zoom:2}]});
  await assert.rejects(()=>setCameraControl(track,'zoom',5));await assert.rejects(()=>setCameraControl({getCapabilities:()=>({})},'torch',true));
});
test('codec preferences keep only platform-provided codecs',()=>{
  let applied;const caps={codecs:[{mimeType:'video/VP8'},{mimeType:'video/H264'},{mimeType:'video/rtx'}]};
  const pc={getTransceivers:()=>[{sender:{track:{kind:'video'}},receiver:{},setCodecPreferences:v=>{applied=v}}]};
  assert.equal(preferCodec(pc,'video/H264',{getCapabilities:()=>caps}),true);assert.equal(applied[0].mimeType,'video/H264');assert.equal(applied.length,3);
});

test('motion is prioritized and the capture is never raised to the sensor maximum', async()=>{
 let applied=0;const track={getCapabilities:()=>({width:{max:8064},height:{max:6048}}),applyConstraints:async()=>{applied++},getSettings:()=>({width:1920,height:1080,frameRate:30})};
 await captureCamera({profile:'auto',fps:30},{getUserMedia:async()=>({getVideoTracks:()=>[track],getTracks:()=>[track]})});
 assert.equal(applied,0);assert.equal(track.contentHint,'motion');
});
test('encoder preserves motion and can scale down without changing stream identity',async()=>{
 let params;await applyBitrate({getParameters:()=>({encodings:[{rid:'main'}]}),setParameters:async p=>{params=p}},12,30,1.5);
 assert.equal(params.degradationPreference,'maintain-framerate');assert.equal(params.encodings[0].scaleResolutionDownBy,1.5);assert.equal(params.encodings[0].rid,'main');
});
test('automatic codec selection preserves browser ordering',()=>{
 assert.equal(preferCodec({getTransceivers:()=>{throw new Error('must not override')}}),false);
});
test('old invitations explain how to upgrade',()=>{
 assert.throws(()=>parseInvite(`LC1.${crypto.randomUUID()}.${randomToken()}`),/versão anterior/);
});
test('receiver metrics report interval packet loss and buffering rather than cumulative averages',()=>{
 const r=new Map([['v',{id:'v',type:'inbound-rtp',kind:'video',timestamp:1000,bytesReceived:100,framesDecoded:30,packetsReceived:100,packetsLost:1,jitterBufferEmittedCount:30,jitterBufferDelay:1,totalDecodeTime:.3}]]);
 const a=readRtpStats(r,'receiver');r.set('v',{...r.get('v'),timestamp:2000,bytesReceived:100100,framesDecoded:60,packetsReceived:200,packetsLost:3,jitterBufferEmittedCount:60,jitterBufferDelay:1.6,totalDecodeTime:.6});
 const b=readRtpStats(r,'receiver',a.next).stats;assert.ok(Math.abs(b.lossPercent-100*2/102)<.001);assert.ok(Math.abs(b.bufferMs-20)<.001);assert.equal(b.decodeMs,10);
});
