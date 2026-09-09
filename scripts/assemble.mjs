import {build} from 'esbuild';
import {mkdir,cp,writeFile} from 'node:fs/promises';
await mkdir('.vercel/output/static',{recursive:true});
await cp('site','.vercel/output/static',{recursive:true});
for(const lane of ['a','b','c','d','e'])await cp(`games/${lane}/dist/client`,`.vercel/output/static/games/${lane}`,{recursive:true});
await writeFile('.vercel/output/config.json',JSON.stringify({version:3,routes:[{src:'/(.*)',headers:{'X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'},continue:true},{src:'/api/ratings/?$',dest:'/api/ratings'},{handle:'filesystem'}]},null,2));

const fn='.vercel/output/functions/api/ratings.func';
await mkdir(fn,{recursive:true});
await build({entryPoints:['server/ratings.mjs'],outfile:`${fn}/bundle.cjs`,bundle:true,platform:'node',target:'node24',format:'cjs',minify:true});
await writeFile(`${fn}/index.cjs`,"module.exports=require('./bundle.cjs').default;\n");
await writeFile(`${fn}/.vc-config.json`,JSON.stringify({runtime:'nodejs24.x',handler:'index.cjs',launcherType:'Nodejs',maxDuration:30}));
