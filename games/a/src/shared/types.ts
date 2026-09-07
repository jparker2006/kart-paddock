export type Input={ throttle:number; steer:number; drift:boolean; use:boolean; respawn:boolean; seq:number };
export type Item='turbo'|'pulse';
export type Kart={
 id:string;name:string;color:number;connected:boolean;active:boolean;
 x:number;y:number;z:number;heading:number;speed:number;vx:number;vz:number;vy:number;
 grounded:boolean;segment:number;lap:number;nextGate:number;passed:number;
 driftCharge:number;drifting:boolean;boost:number;stun:number;item:Item|null;
 finish:number|null;dnf:boolean;place:number;respawns:number;airTime:number;
};
export type Phase='lobby'|'countdown'|'racing'|'results';
export type Snapshot={code:string;host:string;phase:Phase;players:Kart[];serverTime:number;startAt:number;endAt:number;raceId:number;items:boolean[];effects:{x:number;y:number;z:number;until:number;owner:string}[]};
export type Reply={ok:boolean;error?:string;id?:string;token?:string;code?:string};
