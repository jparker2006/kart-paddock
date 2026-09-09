import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/game-health.mjs';

async function request(url,method='GET'){
  const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}};
  await handler({url,method},res);return res;
}
test('readiness checks are fixed-host, uncached, bounded, and require a healthy JSON response',async()=>{
  const original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async(url,options)=>{
      calls++;assert.match(url,/^https:\/\/kart-paddock-[a-e]\.onrender\.com\/health$/);
      assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      return {ok:true,json:async()=>({status:'ok'})};
    };
    assert.equal((await request('/api/game-health?game=https://example.com')).statusCode,400);
    assert.equal((await request('/api/game-health?game=a','POST')).statusCode,405);
    assert.equal(calls,0);
    for(const game of 'abcde'){
      const res=await request(`/api/game-health?game=${game}`);
      assert.equal(res.statusCode,200);assert.equal(res.body.ready,true);assert.equal(res.headers['Cache-Control'],'no-store');
    }
    globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true})});
    assert.equal((await request('/api/game-health?game=b')).body.ready,true);
    for(const result of [
      async()=>{throw new Error('timeout');},
      async()=>({ok:true,json:async()=>{throw new Error('Render loading HTML');}}),
      async()=>({ok:false,json:async()=>({ok:true})}),
      async()=>({ok:true,json:async()=>({status:'starting'})})
    ]){globalThis.fetch=result;const res=await request('/api/game-health?game=a');assert.equal(res.statusCode,503);assert.equal(res.body.ready,false);}
  }finally{globalThis.fetch=original;}
});
