import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { createDatabaseAdapter, readDatabaseConfig } from '../lib/database.mjs';
import { handleSignal } from '../lib/signal-service.mjs';
import { randomToken } from '../lib/signal.mjs';
const sql=readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8');
const origin='https://imtv.example';
async function setup(){
 const client=createClient({url:':memory:'});await client.batch(sql.split(';').map(s=>s.trim()).filter(Boolean),'write');
 const db=createDatabaseAdapter(client),nonce=randomToken();
 const call=async(method,id,role,token,body={})=>{
  const response=await handleSignal(new Request(origin+'/api/sessions'+(id?'/'+id:''),{method,headers:{Origin:origin,'Content-Type':'application/json','X-Luticam-Client':nonce,'X-Vercel-Forwarded-For':'192.0.2.1',...(role?{'X-Luticam-Role':role,'X-Luticam-Token':token}:{})},...(method!=='GET'?{body:JSON.stringify(body)}:{})}),db,id||null);
  return {status:response.status,data:await response.json()};
 };return {client,db,call};
}
test('libSQL adapter handles full anonymous pairing, JSON candidates and deletion',async()=>{
 const e=await setup();try{
 const created=await e.call('POST');assert.equal(created.status,201);const s=created.data,token=randomToken();
 assert.equal((await e.call('POST',s.id,'join',s.joinToken,{senderToken:token})).status,200);
 const description={type:'offer',sdp:'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'};
 assert.equal((await e.call('POST',s.id,'sender',token,{generation:1,description})).status,200);
 const candidate={candidate:'candidate:1 1 udp 100 192.168.1.2 9000 typ host',sdpMid:'0',sdpMLineIndex:0,usernameFragment:null};
 assert.equal((await e.call('POST',s.id,'sender',token,{generation:1,candidates:[candidate]})).status,200);
 const state=await e.call('GET',s.id,'receiver',s.receiverToken);assert.deepEqual(state.data.description,description);assert.deepEqual(state.data.candidates,[candidate]);
 assert.equal((await e.call('GET',s.id,'receiver',randomToken())).status,403);
 assert.equal((await e.call('POST',s.id,'receiver',s.receiverToken,{generation:1,description:{...description,type:'answer'}})).status,200);
 assert.equal((await e.call('DELETE',s.id,'receiver',s.receiverToken)).status,200);
 assert.equal((await e.call('GET',s.id,'sender',token)).status,404);
 }finally{e.client.close()}
});
test('libSQL creation caps and RETURNING counters work on the exported schema',async()=>{
 const e=await setup();try{for(let i=0;i<8;i++)assert.equal((await e.call('POST')).status,201);assert.equal((await e.call('POST')).status,429)}finally{e.client.close()}
});
test('database initialization is repeatable and preserves existing sessions',async()=>{
 const e=await setup();try{const {data:s}=await e.call('POST');await e.client.batch(sql.split(';').map(s=>s.trim()).filter(Boolean),'write');assert.equal((await e.call('GET',s.id,'receiver',s.receiverToken)).status,200)}finally{e.client.close()}
});

test('IMTV integration overrides stale default variables without mixing credentials',()=>{
 const old={TURSO_DATABASE_URL:'libsql://SEU-BANCO.turso.io',TURSO_AUTH_TOKEN:'old-token'};
 for(const [key,tokenKey] of [['IMTV_URL','IMTV_AUTH_TOKEN'],['IMTV_DATABASE_URL','IMTV_AUTH_TOKEN'],['IMTV_TURSO_DATABASE_URL','IMTV_TURSO_AUTH_TOKEN']]){
  assert.deepEqual(readDatabaseConfig({...old,[key]:'libsql://imtv.turso.io',[tokenKey]:'new-token'}),{url:'libsql://imtv.turso.io',authToken:'new-token'});
  assert.equal(readDatabaseConfig({...old,[key]:'libsql://imtv.turso.io'}).authToken,undefined);
 }
 assert.deepEqual(readDatabaseConfig(old),{url:old.TURSO_DATABASE_URL,authToken:old.TURSO_AUTH_TOKEN});
});
