// One-time artwork generation; not part of the website runtime or game builds.
// Pass an installed sharp module path, or install sharp in your tooling environment.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {default:sharp}=await import(process.argv[2]?pathToFileURL(process.argv[2]).href:'sharp');
const names=['parcel-panic','bumble-rally','harvest-rush','cinder-peak-rally','hyperkart-nebula-drift'];
const assets=new URL('../site/assets/',import.meta.url);
const shots=await Promise.all(names.map(async(name,i)=>{
  const source=await readFile(new URL(`${name}.png`,assets));
  const {format}=await sharp(source).metadata();
  const x=56+i*220;
  return `<clipPath id="shot-${i}"><rect x="${x}" y="365" width="208" height="184" rx="8"/></clipPath><image x="${x}" y="365" width="208" height="184" preserveAspectRatio="xMidYMid slice" clip-path="url(#shot-${i})" href="data:image/${format};base64,${source.toString('base64')}"/>`;
}));
const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#111415"/>
<g font-family="Helvetica Neue,Arial,sans-serif" fill="#f0f3ec">
<text x="56" y="66" font-size="27" font-weight="700" letter-spacing="-.6">Kart Paddock</text>
<text x="56" y="182" font-size="84" font-weight="700" letter-spacing="-2.5">Five AIs made</text>
<text x="56" y="272" font-size="84" font-weight="700" letter-spacing="-2.5">a racing game.</text>
<text x="58" y="321" font-size="28" fill="#c8d6c3">Play their games. Pick your favorite.</text>
${shots.join('')}
<text x="56" y="596" font-size="22" fill="#a7b1ac">kart-paddock.vercel.app</text>
<text x="1144" y="596" text-anchor="end" font-size="22" fill="#c8d6c3">Play. Rate. Reveal.</text>
</g></svg>`;
await sharp(Buffer.from(svg)).jpeg({quality:90,chromaSubsampling:'4:4:4'}).toFile(new URL('kart-paddock-share-v1.jpg',assets).pathname);
