import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality } from '../lib/quality.mjs';
const good={width:1920,height:1080,fps:30,mbps:10,quality:'none',lossPercent:0,availableMbps:30};
test('brief jitter does not trigger a resolution change; sustained overload does',()=>{
 const q=new AdaptiveQuality();assert.equal(q.sample({...good,fps:10}),null);assert.equal(q.sample(good),null);assert.equal(q.scale,1);
 q.sample({...good,quality:'cpu'});q.sample({...good,quality:'cpu'});assert.equal(q.sample({...good,quality:'cpu'}).scale,1.5);
});
test('resolution recovers slowly only with sustained healthy samples and bandwidth headroom',()=>{
 const q=new AdaptiveQuality();for(let i=0;i<3;i++)q.sample({...good,lossPercent:10});assert.equal(q.scale,1.5);
 for(let i=0;i<19;i++)assert.equal(q.sample(good),null);assert.equal(q.sample(good).scale,1);
});
test('loss and bandwidth starvation trade pixels for motion without upscaling or unbounded degradation',()=>{
 const q=new AdaptiveQuality();for(let i=0;i<100;i++)q.sample({...good,quality:'bandwidth',mbps:1});assert.equal(q.scale,3);
 for(let i=0;i<100;i++)q.sample({...good,availableMbps:10});assert.equal(q.scale,3);
 for(let i=0;i<100;i++)q.sample(good);assert.equal(q.scale,1);
});
test('missing browser metrics never invent a quality decision',()=>{
 const q=new AdaptiveQuality();for(let i=0;i<30;i++)assert.equal(q.sample({...good,fps:null,mbps:null}),null);assert.equal(q.scale,1);
});
