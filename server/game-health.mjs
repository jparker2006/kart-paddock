// Launcher-only readiness check. Never proxies gameplay or accepts arbitrary hosts.
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json');
  if(req.method!=='GET'){res.setHeader('Allow','GET');res.statusCode=405;res.end('{"ready":false}');return;}
  const game=new URL(req.url,'http://localhost').searchParams.get('game');
  if(!/^[a-e]$/.test(game||'')){res.statusCode=400;res.end('{"ready":false}');return;}
  try{
    const response=await fetch(`https://kart-paddock-${game}.onrender.com/health`,{signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});
    const body=await response.json();
    const ready=response.ok&&(body.ok===true||body.status==='ok');
    res.statusCode=ready?200:503;res.end(JSON.stringify({ready}));
  }catch{res.statusCode=503;res.end('{"ready":false}');}
}
