// Real application controllers + SQL. Only the browser's media engine is simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioConnection } from '../lib/connection.mjs';
import { setup,candidate } from './support.mjs';
let peerID=0;
class FakePeer extends EventTarget {
  iceGatheringState='gathering';connectionState='new';senders=[];remoteDescription=null;localDescription=null;ice=[];offers=[];stats=new Map();
  constructor(){super();this.id=++peerID;this.counter=0;}
  addTrack(track){this.senders.push({track,getParameters:()=>({encodings:[{}]}),setParameters:async p=>{this.lastParameters=p}})}
  getTransceivers(){return []}getSenders(){return this.senders}
  createDataChannel(){return {readyState:'open',bufferedAmount:0,send:()=>{},close:()=>{}}}
  async createOffer(options){this.offers.push(options);return {type:'offer',sdp:`v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=ice-ufrag:p${this.id}g${++this.counter}\r\n`}}
  async createAnswer(){return {type:'answer',sdp:`v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=ice-ufrag:p${this.id}g${++this.counter}\r\n`}}
  async setLocalDescription(d){this.localDescription={...d,toJSON:()=>d};const usernameFragment=/a=ice-ufrag:(.*)\r/.exec(d.sdp)[1];queueMicrotask(()=>this.onicecandidate?.({candidate:{toJSON:()=>({...candidate,usernameFragment})}}))}
  async setRemoteDescription(d){this.remoteDescription=d}
  async addIceCandidate(c){assert.ok(this.remoteDescription);this.ice.push(c)}
  async getStats(){return this.stats}
  close(){this.connectionState='closed';this.dispatchEvent(new Event('connectionstatechange'))}
}
async function settle(check){for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw new Error('did not settle')}
async function poll(c){await settle(()=>!c.polling);clearTimeout(c.pollTimer);await c.poll();clearTimeout(c.pollTimer)}
async function drive(receiver,sender){await poll(receiver);await settle(()=>!receiver.sendingCandidates&&!sender.sendingCandidates);await sender.flushCandidates();await receiver.flushCandidates();await poll(sender);await poll(receiver);clearTimeout(sender.pollTimer);clearTimeout(receiver.pollTimer)}
for(const scenario of ['normal','answer retry','sender recovery','receiver recovery','late candidates','adaptive receiver feedback','lost offer upload','lost offer acknowledgement']) test(`public controller lifecycle: ${scenario}`,async()=>{
 const env=setup(),oldFetch=globalThis.fetch,oldPC=globalThis.RTCPeerConnection;let failures=scenario==='answer retry'?3:0,offerFailures=0,lostAck=false,errors=[],receiver,sender;
 globalThis.RTCPeerConnection=FakePeer;
 globalThis.fetch=async(path,opts)=>{
   assert.equal(opts.credentials,'omit');assert.ok(!opts.headers.Authorization);
   if(failures>0&&opts?.body?.includes('"type":"answer"')){failures--;throw new TypeError('temporary loss')}
   if(offerFailures>0&&opts?.body?.includes('"type":"offer"')){offerFailures--;throw new TypeError('temporary loss')}
   const response=await env.fetch(path,opts);
   if(lostAck&&opts?.body?.includes('"type":"offer"')){lostAck=false;throw new TypeError('response lost after commit')}
   return response;
 };
 try{
  receiver=new StudioConnection({onError:e=>errors.push(e)});sender=new StudioConnection({onError:e=>errors.push(e)});
  await receiver.createReceiver();await settle(()=>!receiver.polling);clearTimeout(receiver.pollTimer);
  const track={kind:'video',getSettings:()=>({frameRate:30})},stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  await sender.startSender({id:receiver.session.id,joinToken:receiver.session.joinToken},stream,{bitrate:12,fps:30});await settle(()=>!sender.polling);clearTimeout(sender.pollTimer);
  // Gathering never completes in this fixture. SDP and candidates must still move.
  assert.equal(sender.pc.iceGatheringState,'gathering');
  if(scenario==='answer retry'){await poll(receiver);assert.equal(receiver.negotiated,false);assert.ok(receiver.pendingAnswer)}
  await drive(receiver,sender);assert.equal(sender.negotiated,true);assert.equal(receiver.negotiated,true);
  assert.equal(sender.pc.remoteDescription.type,'answer');assert.equal(receiver.pc.remoteDescription.type,'offer');assert.equal(sender.pc.ice.length,1);assert.equal(receiver.pc.ice.length,1);
  const originalReceiver=receiver.pc,originalSender=sender.pc;
  if(scenario==='sender recovery'||scenario==='receiver recovery'){
    sender.pc.connectionState='disconnected';receiver.pc.connectionState='disconnected';
    await (scenario==='sender recovery'?sender:receiver).recover();
    if(scenario==='receiver recovery')await poll(sender);
    await drive(receiver,sender);assert.equal(sender.generation,2);assert.equal(receiver.generation,2);assert.equal(sender.pc.offers[1].iceRestart,true);
    assert.equal(receiver.pc,originalReceiver);assert.equal(sender.pc,originalSender);assert.equal(receiver.pc.ice.length,2);
  }
  if(scenario==='lost offer upload'||scenario==='lost offer acknowledgement'){
    offerFailures=scenario==='lost offer upload'?3:0;lostAck=scenario==='lost offer acknowledgement';sender.pc.connectionState='disconnected';
    await sender.recover();
    if(scenario==='lost offer upload'){assert.ok(sender.pendingOffer);assert.equal(sender.generation,2);await sender.recover();assert.equal(sender.generation,2)}
    await drive(receiver,sender);assert.equal(sender.generation,2);assert.equal(receiver.generation,2);assert.equal(sender.negotiated,true);
  }
  if(scenario==='late candidates'){
    sender.localCandidates.push({...candidate,candidate:candidate.candidate.replace('54321','54322')});await sender.flushCandidates();await poll(receiver);assert.equal(receiver.pc.ice.length,2);
    await sender.flushCandidates();await poll(receiver);assert.equal(receiver.pc.ice.length,2);
  }
  if(scenario==='adaptive receiver feedback'){
    sender.channel.onmessage({data:JSON.stringify({type:'health',fps:8,decodeMs:80,lossPercent:0})});
    for(let i=1;i<=4;i++){
      sender.pc.stats=new Map([['v',{id:'v',type:'outbound-rtp',kind:'video',bytesSent:i*1500000,framesEncoded:i*30,timestamp:i*1000,frameWidth:1920,frameHeight:1080,qualityLimitationReason:'none'}]]);await sender.sampleStats();
    }
    assert.equal(sender.quality.scale,1.5);assert.equal(sender.pc.lastParameters.encodings[0].scaleResolutionDownBy,1.5);
  }
  assert.equal(errors.length,0);await sender.stop();assert.equal(originalSender.connectionState,'closed');await poll(receiver);assert.equal(receiver.cancelled,true);
  assert.equal(env.sql.prepare('SELECT COUNT(*) n FROM camera_sessions').get().n,0);
 }finally{await sender?.stop(false);await receiver?.stop(false);globalThis.fetch=oldFetch;globalThis.RTCPeerConnection=oldPC;env.sql.close();}
});
