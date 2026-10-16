import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleSignal } from '../lib/signal-service.mjs';
import { randomToken } from '../lib/signal.mjs';
export const origin = 'https://luticam.test';
export const offer = { type:'offer',sdp:'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n' };
export const answer = { type:'answer',sdp:offer.sdp.replace('sendonly','recvonly') };
export const candidate = { candidate:'candidate:1 1 udp 2130706431 192.168.1.10 54321 typ host',sdpMid:'0',sdpMLineIndex:0,usernameFragment:null };
export function setup() {
  const sql = new DatabaseSync(':memory:');
  const directory = new URL('../drizzle/',import.meta.url);
  for (const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(name,directory),'utf8').replaceAll('--> statement-breakpoint',''));
  const db={prepare(q){const s=sql.prepare(q);return {bind(...args){return {first:async()=>s.get(...args)??null,run:async()=>({meta:{changes:Number(s.run(...args).changes)}})}}}}};
  const client = randomToken();
  const call = async(method,id,role,token,body={},extra={})=>{
    const request=new Request(`${origin}/api/sessions${id?'/'+id:''}`,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Luticam-Client':client,...(role?{'X-Luticam-Role':role,'X-Luticam-Token':token}:{}),...extra},...(method!=='GET'?{body:JSON.stringify(body)}:{})});
    const response=await handleSignal(request,db,id??null);return {response,status:response.status,data:await response.json()};
  };
  return {sql,db,call,client,create:async(extra={})=>(await call('POST',null,null,null,{},extra)).data,
    fetch:async(path,opts={})=>{const url=new URL(path,origin),headers=new Headers(opts.headers);headers.set('Origin',origin);return handleSignal(new Request(url,{...opts,headers}),db,url.pathname.split('/')[3]||null)}};
}
export async function pair(env) {const session=await env.create(),sender=randomToken();await env.call('POST',session.id,'join',session.joinToken,{senderToken:sender});return {...session,sender};}
