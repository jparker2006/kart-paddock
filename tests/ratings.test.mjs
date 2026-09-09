import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import handler from '../server/ratings.mjs';
const sql=neon(process.env.DATABASE_URL);
process.env.VERCEL_ENV='development';process.env.RATINGS_NAMESPACE=`test-${randomBytes(8).toString('hex')}`;
const ns=process.env.RATINGS_NAMESPACE;
const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const token=()=>randomBytes(32).toString('hex');
async function call(body,key,options={}){const headers={'Content-Type':'application/json',Origin:base,...options.headers};if(key)headers['X-Voter-Token']=key;const response=await fetch(base,{method:options.method||(body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}
await test('Community ratings API with real isolated Neon storage',async t=>{
 try{
 await t.test('empty response has five games and no fabricated votes',async()=>{const {data,status}=await call();assert.equal(status,200);assert.equal(data.games.length,5);assert.ok(data.games.every(g=>g.count===0&&g.average===null));assert.deepEqual(data.mine,{});});
 const alice=token();
 await t.test('save, private restore, edit and retry preserve one voter',async()=>{let r=await call({game:'a',stars:5},alice);assert.equal(r.status,200);assert.equal(r.data.games[0].count,1);assert.equal(r.data.mine.a,5);r=await call({game:'a',stars:2},alice);assert.equal(r.data.games[0].count,1);assert.equal(r.data.games[0].average,2);assert.equal((await call(undefined,alice)).data.mine.a,2);assert.deepEqual((await call()).data.mine,{});});
 await t.test('concurrent duplicate writes cannot inflate counts',async()=>{const r=await Promise.all(Array.from({length:8},()=>call({game:'a',stars:4},alice)));assert.ok(r.every(x=>x.status===200));const a=(await call()).data.games[0];assert.equal(a.count,1);assert.equal(a.average,4);});
 await t.test('different browsers count separately, eligibility starts at five',async()=>{for(const stars of [1,2,3])assert.equal((await call({game:'a',stars},token())).status,200);let a=(await call()).data.games[0];assert.equal(a.count,4);assert.equal(a.eligible,false);await call({game:'a',stars:5},token());a=(await call()).data.games[0];assert.equal(a.count,5);assert.equal(a.eligible,true);assert.equal(a.average,3);assert.deepEqual(a.distribution,[1,1,1,1,1]);});
 await t.test('reject invalid submissions and cross-origin requests',async()=>{for(const body of [{game:'f',stars:3},{game:'a',stars:0},{game:'a',stars:6},{game:'a',stars:2.5},{game:'a',stars:'5'},null]){const result=body?await call(body,token()):await call({},token());assert.equal(result.status,400);}assert.equal((await call({game:'a',stars:1})).status,400);assert.equal((await call({game:'a',stars:1},'bad')).status,400);assert.equal((await call({game:'a',stars:1},token(),{headers:{Origin:'https://elsewhere.invalid'}})).status,403);assert.equal((await call(undefined,undefined,{method:'DELETE'})).status,405);assert.equal((await call({game:'a',stars:1,extra:'x'.repeat(1500)},token())).status,413);});
 await t.test('durable throttling stops rapid edits without losing saved vote',async()=>{const key=token();for(let i=0;i<30;i++)assert.equal((await call({game:'b',stars:3},key)).status,200);assert.equal((await call({game:'b',stars:1},key)).status,429);assert.equal((await call(undefined,key)).data.mine.b,3);});
 await t.test('service failure is explicit and does not invent results',async()=>{const db=process.env.DATABASE_URL;delete process.env.DATABASE_URL;try{assert.equal((await call()).status,503);}finally{process.env.DATABASE_URL=db;}});
 await t.test('test namespace never writes public poll',async()=>{const rows=await sql`SELECT count(*)::int AS count FROM community_ratings WHERE namespace=${ns}`;assert.equal(rows[0].count,6);});
 }finally{await sql`DELETE FROM community_ratings WHERE namespace=${ns}`;await sql`DELETE FROM rating_write_limits WHERE namespace=${ns}`;await new Promise(r=>server.close(r));}
});
