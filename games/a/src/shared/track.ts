export const N = 480;
export const WIDTH = 14;
export const GATES = 16;
export const GAP_START = 106, GAP_END = 116, LAUNCH = 104;
export type Vec = { x:number; y:number; z:number };
export type RoadPoint = Vec & { tx:number; tz:number; nx:number; nz:number; index:number; gap:boolean };
const raw = (i:number):Vec => {
 const t = (i / N) * Math.PI * 2;
 // The two crossings are 14m apart vertically. A ramp climbs before the real gap.
 let y = 5 + 14 * Math.pow(Math.sin(t/2), 4);
 if(i>=82 && i<=106)y += 4 * (i-82)/24;
 if(i>106 && i<130)y += 4 * (130-i)/24;
 return {x:90*Math.sin(t), y, z:65*Math.sin(2*t)};
};
export const TRACK:RoadPoint[] = Array.from({length:N},(_,i)=>{
 const p=raw(i),a=raw((i+N-1)%N),b=raw((i+1)%N); const d=Math.hypot(b.x-a.x,b.z-a.z);
 const tx=(b.x-a.x)/d,tz=(b.z-a.z)/d;
 return {...p,tx,tz,nx:tz,nz:-tx,index:i,gap:i>=GAP_START&&i<GAP_END};
});
export const wrap=(n:number)=>((n%N)+N)%N;
export const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
export const angleDiff=(a:number,b:number)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
export function sample(index:number):RoadPoint {
 const i=wrap(index),a=TRACK[Math.floor(i)]!,b=TRACK[(Math.floor(i)+1)%N]!,f=i%1;
 return {...a,x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f};
}
export type Surface = { index:number; x:number; y:number; z:number; lateral:number; distance:number; point:RoadPoint };
export function surfaces(x:number,z:number):Surface[] {
 const out:Surface[]=[];
 for(let i=0;i<N;i++){
  const a=TRACK[i]!,b=TRACK[(i+1)%N]!;
  if(a.gap)continue;
  const dx=b.x-a.x,dz=b.z-a.z,f=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);
  const px=a.x+dx*f,pz=a.z+dz*f,distance=Math.hypot(x-px,z-pz);
  if(distance<WIDTH/2+.8)out.push({index:i+f,x:px,y:a.y+(b.y-a.y)*f,z:pz,lateral:(x-px)*a.nx+(z-pz)*a.nz,distance,point:a});
 }
 return out;
}
export const ITEM_SPOTS=[38,155,220,290,365,431];
export const COLORS=[0xec653c,0x278bd2,0xb65ccc,0x35a477,0xf1b82d,0xec7596,0x6c79d7,0x657c83];
