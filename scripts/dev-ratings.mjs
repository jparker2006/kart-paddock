import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import ratings from '../server/ratings.mjs';
import gameHealth from '../server/game-health.mjs';
const root=resolve('.vercel/output/static');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.md':'text/plain'};
createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.replace(/\/$/,'')==='/api/game-health')return gameHealth(req,res);
 if(url.pathname.replace(/\/$/,'')==='/api/ratings')return ratings(req,res);
 let path=resolve(root,'.'+decodeURIComponent(url.pathname));
 if(!path.startsWith(root+'/')&&path!==root){res.writeHead(403).end();return;}
 try{if((await stat(path)).isDirectory())path+='/index.html';const data=await readFile(path);res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404).end('Not found');}
}).listen(Number(process.env.REVIEW_PORT||4310),'127.0.0.1',()=>console.log('Ratings review at http://localhost:'+(process.env.REVIEW_PORT||4310)));
