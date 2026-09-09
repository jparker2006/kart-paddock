import {createHash} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
const games=['a','b','c','d','e'];
const tokenPattern=/^[a-f0-9]{64}$/;
export function namespace(){
  if(process.env.VERCEL_ENV==='production')return 'community';
  return process.env.RATINGS_NAMESPACE || 'preview';
}
function send(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(body));}
export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return send(res,405,{error:'Method not allowed.'});}
  const raw=req.headers['x-voter-token'];
  if(raw!==undefined && (typeof raw!=='string'||!tokenPattern.test(raw)))return send(res,400,{error:'Invalid browser voter token.'});
  const voter=raw?createHash('sha256').update(raw).digest('hex'):null;
  if(req.method==='POST'){
    const host=req.headers['x-forwarded-host']||req.headers.host;
    let origin;try{origin=new URL(req.headers.origin);}catch{return send(res,403,{error:'Please vote from this website.'});}
    if(origin.host!==host || !['http:','https:'].includes(origin.protocol))return send(res,403,{error:'Please vote from this website.'});
    if(!voter)return send(res,400,{error:'A browser voter token is required.'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return send(res,415,{error:'Expected JSON.'});
  }
  try{
    let body;
    if(req.method==='POST'){
      if(Number(req.headers['content-length'])>1024)return send(res,413,{error:'Request too large.'});
      let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>1024)return send(res,413,{error:'Request too large.'});}
      try{body=JSON.parse(text);}catch{return send(res,400,{error:'Invalid JSON.'});}
      if(!body||!games.includes(body.game)||!Number.isInteger(body.stars)||body.stars<1||body.stars>5)return send(res,400,{error:'Choose a game and a rating from 1 to 5.'});
    }
    if(!process.env.DATABASE_URL)return send(res,503,{error:'Community ratings are temporarily unavailable. Please try again.'});
    const sql=neon(process.env.DATABASE_URL,{fetchOptions:{signal:AbortSignal.timeout(12000)}});const ns=namespace();
    if(body){
      const saved=await sql`
        WITH allowance AS (
          INSERT INTO rating_write_limits(namespace,voter_hash) VALUES (${ns},${voter})
          ON CONFLICT(namespace,voter_hash) DO UPDATE SET
            attempts=CASE WHEN rating_write_limits.window_start < now()-interval '1 minute' THEN 1 ELSE rating_write_limits.attempts+1 END,
            window_start=CASE WHEN rating_write_limits.window_start < now()-interval '1 minute' THEN now() ELSE rating_write_limits.window_start END
          RETURNING attempts
        )
        INSERT INTO community_ratings(namespace,voter_hash,game,stars)
        SELECT ${ns},${voter},${body.game},${body.stars} FROM allowance WHERE attempts<=30
        ON CONFLICT(namespace,voter_hash,game) DO UPDATE SET stars=excluded.stars,updated_at=now()
        RETURNING game,stars`;
      if(!saved.length){res.setHeader('Retry-After','60');return send(res,429,{error:'Too many updates. Wait a minute and try again.'});}
    }
    const [counts,mine]=await sql.transaction([
      sql`SELECT game,stars,count(*)::int AS count FROM community_ratings WHERE namespace=${ns} GROUP BY game,stars`,
      sql`SELECT game,stars FROM community_ratings WHERE namespace=${ns} AND voter_hash=${voter}`
    ]);
    const stats=games.map(game=>{const distribution=[1,2,3,4,5].map(star=>Number(counts.find(r=>r.game===game&&Number(r.stars)===star)?.count||0));const count=distribution.reduce((a,b)=>a+b,0);const sum=distribution.reduce((a,b,i)=>a+b*(i+1),0);return {game,count,sum,average:count?sum/count:null,distribution,eligible:count>=5};});
    return send(res,200,{games:stats,mine:Object.fromEntries(mine.map(r=>[r.game,Number(r.stars)])),updatedAt:new Date().toISOString(),testData:ns!=='community'});
  }catch(error){console.error('Ratings request failed',error?.name||'Error');return send(res,503,{error:'Community ratings are temporarily unavailable. Please try again.'});}
}
