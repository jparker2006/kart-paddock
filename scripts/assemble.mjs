import {mkdir,cp,writeFile} from 'node:fs/promises';
await mkdir('.vercel/output/static',{recursive:true});
await cp('site','.vercel/output/static',{recursive:true});
for(const lane of ['a','b','c'])await cp(`games/${lane}/dist/client`,`.vercel/output/static/games/${lane}`,{recursive:true});
await writeFile('.vercel/output/config.json',JSON.stringify({version:3,routes:[{src:'/(.*)',headers:{'X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'},continue:true},{handle:'filesystem'}]},null,2));
