import { TRACK } from '../../shared/track.ts';

export interface MinimapDot {
  x: number;
  z: number;
  color: string;
  isLocal: boolean;
  label?: string;
}

/** Top-down 2D map of the track drawn on a canvas element. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private minX = Infinity;
  private maxX = -Infinity;
  private minZ = Infinity;
  private maxZ = -Infinity;
  private scale = 1;
  private offX = 0;
  private offZ = 0;
  private trackPath: Path2D | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    for (const s of TRACK.samples) {
      this.minX = Math.min(this.minX, s.x);
      this.maxX = Math.max(this.maxX, s.x);
      this.minZ = Math.min(this.minZ, s.z);
      this.maxZ = Math.max(this.maxZ, s.z);
    }
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 180;
    const h = this.canvas.clientHeight || 180;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const margin = 14;
    const sx = (w - margin * 2) / (this.maxX - this.minX);
    const sz = (h - margin * 2) / (this.maxZ - this.minZ);
    this.scale = Math.min(sx, sz);
    this.offX = (w - (this.maxX - this.minX) * this.scale) / 2;
    this.offZ = (h - (this.maxZ - this.minZ) * this.scale) / 2;
    this.trackPath = new Path2D();
    TRACK.samples.forEach((s, i) => {
      const [px, py] = this.project(s.x, s.z);
      if (i === 0) this.trackPath!.moveTo(px, py);
      else this.trackPath!.lineTo(px, py);
    });
    this.trackPath.closePath();
  }

  private project(x: number, z: number): [number, number] {
    return [this.offX + (x - this.minX) * this.scale, this.offZ + (z - this.minZ) * this.scale];
  }

  draw(dots: MinimapDot[]): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (!this.trackPath) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 9;
    ctx.stroke(this.trackPath);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 5;
    ctx.stroke(this.trackPath);
    // start line
    const s0 = TRACK.samples[0];
    const [sx, sy] = this.project(s0.x, s0.z);
    ctx.fillStyle = '#ffb703';
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
    // racers (local last so it is on top)
    const sorted = [...dots].sort((a, b) => Number(a.isLocal) - Number(b.isLocal));
    for (const d of sorted) {
      const [px, py] = this.project(d.x, d.z);
      ctx.beginPath();
      ctx.arc(px, py, d.isLocal ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = d.isLocal ? 2.5 : 1.5;
      ctx.strokeStyle = d.isLocal ? '#ffffff' : 'rgba(0,0,0,0.7)';
      ctx.stroke();
    }
  }
}
