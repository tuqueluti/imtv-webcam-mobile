import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSignal } from '../lib/signal-service.mjs';
import { randomToken, hashToken, MAX_BODY } from '../lib/signal.mjs';
import { setup,pair,offer,answer,candidate,origin } from './support.mjs';
const send = (env,s,role,body)=>env.call('POST',s.id,role,role==='sender'?s.sender:s.receiverToken,{generation:1,...body});
test('anonymous devices negotiate without cookies, identity headers or an account',async()=>{
 const e=setup(),s=await pair(e);assert.ok(s.id);assert.notEqual(s.joinToken,s.receiverToken);
 assert.equal(e.sql.prepare('SELECT viewer_hash FROM camera_sessions').get().viewer_hash,await hashToken(s.receiverToken));
 assert.equal((await send(e,s,'sender',{description:offer})).status,200);
 assert.deepEqual((await e.call('GET',s.id,'receiver',s.receiverToken)).data.description,offer);
 assert.equal((await send(e,s,'receiver',{description:answer})).status,200);
 const rx=await e.call('GET',s.id,'sender',s.sender);assert.deepEqual(rx.data.description,answer);assert.ok(!JSON.stringify(rx.data).includes('hash'));
 await e.call('DELETE',s.id,'receiver',s.receiverToken);assert.equal((await e.call('GET',s.id,'sender',s.sender)).status,404);e.sql.close();
});
test('knowing the session ID grants no read, write, restart or delete access',async()=>{
 const e=setup(),s=await pair(e);
 for(const method of ['GET','POST','DELETE']) assert.equal((await e.call(method,s.id,'receiver',randomToken(),{generation:1,restart:true})).status,403);
 assert.equal((await e.call('GET',s.id)).status,403);e.sql.close();
});
test('capabilities cannot be swapped between sessions or roles',async()=>{
 const e=setup(),s=await pair(e),other=await pair(e);
 for(const [role,token] of [['receiver',s.joinToken],['receiver',s.sender],['sender',s.receiverToken],['admin',s.receiverToken],['receiver',other.receiverToken],['receiver','bad']]) assert.equal((await e.call('GET',s.id,role,token)).status,403);e.sql.close();
});
test('old account-scoped sessions remain inaccessible after public upgrade',async()=>{
 const e=setup(),s=await pair(e);e.sql.prepare('UPDATE camera_sessions SET owner=?').run('old-account-id');
 assert.equal((await e.call('GET',s.id,'receiver',s.receiverToken)).status,404);e.sql.close();
});
test('origin checks and JSON content type apply before public creation',async()=>{
 const e=setup();for(const Origin of ['https://other.test','null','']) assert.equal((await e.call('POST',null,null,null,{}, {Origin})).status,403);
 assert.equal((await e.call('POST',null,null,null,{}, {'Content-Type':'text/plain'})).status,415);e.sql.close();
});
test('creation requires a valid browser nonce but never authenticates a ChatGPT user',async()=>{
 const e=setup();assert.equal((await e.call('POST',null,null,null,{}, {'X-Luticam-Client':''})).status,403);assert.ok((await e.create()).id);e.sql.close();
});
test('one invite admits one phone, with idempotent retries including after invite expiry',async()=>{
 const e=setup(),s=await pair(e);assert.equal((await e.call('POST',s.id,'join',s.joinToken,{senderToken:s.sender})).status,200);
 assert.equal((await e.call('POST',s.id,'join',s.joinToken,{senderToken:randomToken()})).status,409);
 e.sql.prepare('UPDATE camera_sessions SET join_expires_at=?').run(Date.now()-1);assert.equal((await e.call('POST',s.id,'join',s.joinToken,{senderToken:s.sender})).status,200);e.sql.close();
});
test('simultaneous phone claims have one winner',async()=>{
 const e=setup(),s=await e.create();const r=await Promise.all([randomToken(),randomToken()].map(senderToken=>e.call('POST',s.id,'join',s.joinToken,{senderToken})));assert.deepEqual(r.map(v=>v.status).sort(),[200,409]);e.sql.close();
});
test('expired invitations and sessions cannot admit devices or expose signaling',async()=>{
 const e=setup(),s=await e.create();e.sql.prepare('UPDATE camera_sessions SET join_expires_at=?').run(Date.now()-1);
 assert.equal((await e.call('POST',s.id,'join',s.joinToken,{senderToken:randomToken()})).status,410);assert.equal((await e.call('GET',s.id,'receiver',s.receiverToken)).status,200);
 e.sql.prepare('UPDATE camera_sessions SET expires_at=?').run(Date.now()-1);assert.equal((await e.call('GET',s.id,'receiver',s.receiverToken)).status,410);await e.create();assert.equal(e.sql.prepare('SELECT * FROM camera_sessions WHERE id=?').get(s.id),undefined);e.sql.close();
});
test('SDP direction and sequence are validated, duplicate writes are idempotent',async()=>{
 const e=setup(),s=await pair(e);
 for(const description of [null,{},answer,{type:'offer',sdp:'bad'},{type:'offer',sdp:'v=0\r\nm=audio 9 ...'}]) assert.equal((await send(e,s,'sender',{description})).status,400);
 await send(e,s,'sender',{description:offer});assert.equal((await send(e,s,'sender',{description:offer})).status,200);
 assert.equal((await send(e,s,'sender',{description:{...offer,sdp:offer.sdp+'a=x\r\n'}})).status,409);e.sql.close();
});
test('trickle candidates are role-isolated, bounded, cumulative and retry-safe',async()=>{
 const e=setup(),s=await pair(e);await send(e,s,'sender',{description:offer});
 assert.equal((await send(e,s,'sender',{candidates:[candidate]})).status,200);assert.equal((await send(e,s,'sender',{candidates:[candidate]})).status,200);
 assert.deepEqual((await e.call('GET',s.id,'receiver',s.receiverToken)).data.candidates,[candidate]);assert.deepEqual((await e.call('GET',s.id,'sender',s.sender)).data.candidates,[]);
 assert.equal((await send(e,s,'sender',{candidates:[{...candidate,candidate:'candidate:changed'}]})).status,409);
 assert.equal((await send(e,s,'sender',{candidates:Array(65).fill(candidate)})).status,400);
 assert.equal((await send(e,s,'sender',{candidates:[{candidate:'garbage'}]})).status,400);e.sql.close();
});
test('ICE restart clears the old answer/candidates and rejects delayed old packets',async()=>{
 const e=setup(),s=await pair(e);await send(e,s,'sender',{description:offer});await send(e,s,'receiver',{description:answer});await send(e,s,'receiver',{candidates:[candidate]});
 assert.equal((await send(e,s,'receiver',{restart:true})).status,200);assert.equal((await e.call('GET',s.id,'sender',s.sender)).data.restartRequested,true);
 await send(e,s,'sender',{description:{...offer,sdp:offer.sdp+'a=ice-ufrag:new\r\n'},generation:2});
 const state=(await e.call('GET',s.id,'sender',s.sender)).data;assert.equal(state.generation,2);assert.equal(state.description,null);assert.equal(state.restartRequested,false);assert.deepEqual(state.candidates,[]);
 assert.equal((await send(e,s,'receiver',{description:answer})).data.stale,true);assert.equal((await send(e,s,'receiver',{candidates:[candidate]})).data.stale,true);
 assert.equal((await send(e,s,'receiver',{generation:2,description:answer})).status,200);e.sql.close();
});
test('invalid negotiation generations are rejected',async()=>{
 const e=setup(),s=await pair(e);for(const generation of [null,'1',-1,0,65,1.5]) assert.equal((await send(e,s,'sender',{generation,description:offer})).status,400);
 assert.equal((await send(e,s,'sender',{generation:3,description:offer})).status,409);e.sql.close();
});
test('unchanged polling never retransmits SDP or caches session data',async()=>{
 const e=setup(),s=await e.create();const r=await handleSignal(new Request(`${origin}/api/sessions/${s.id}?revision=0`,{headers:{'X-Luticam-Role':'receiver','X-Luticam-Token':s.receiverToken}}),e.db,s.id);
 assert.deepEqual(await r.json(),{unchanged:true});assert.equal(r.headers.get('cache-control'),'no-store, private');e.sql.close();
});
test('streamed oversized and malformed bodies are bounded even without Content-Length',async()=>{
 const e=setup();for(const [body,status] of [[JSON.stringify({x:'x'.repeat(MAX_BODY)}),413],['{',400]]) {const req=new Request(`${origin}/api/sessions`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Luticam-Client':e.client},body});assert.equal((await handleSignal(req,e.db)).status,status);}e.sql.close();
});
test('concurrent creations cannot overrun the eight-session browser cap',async()=>{
 const e=setup();const r=await Promise.all(Array.from({length:10},()=>e.call('POST')));assert.equal(r.filter(v=>v.status===201).length,8);assert.equal(e.sql.prepare('SELECT COUNT(*) n FROM camera_sessions').get().n,8);e.sql.close();
});
test('network rate cap cannot be bypassed by rotating browser nonces',async()=>{
 const e=setup();for(let i=0;i<30;i++) assert.ok((await e.create({'X-Luticam-Client':randomToken()})).id);
 assert.equal((await e.call('POST',null,null,null,{}, {'X-Luticam-Client':randomToken()})).status,429);e.sql.close();
});
