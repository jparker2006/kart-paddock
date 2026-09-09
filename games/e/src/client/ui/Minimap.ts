import { trackCircuit } from '../../shared/trackData.js';
import { KartColorId, KartTransform, PlayerState } from '../../shared/types.js';
import { KART_COLORS } from '../../shared/constants.js';

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private bounds = { minX: -190, maxX: 150, minZ: -150, maxZ: 140 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.width = canvas.width;
    this.height = canvas.height;
  }

  private worldToCanvas(x: number, z: number): { cx: number; cy: number } {
    const pad = 16;
    const nx = (x - this.bounds.minX) / (this.bounds.maxX - this.bounds.minX);
    const nz = (z - this.bounds.minZ) / (this.bounds.maxZ - this.bounds.minZ);
    // Invert Z for screen Y
    const cx = pad + nx * (this.width - pad * 2);
    const cy = pad + (1 - nz) * (this.height - pad * 2);
    return { cx, cy };
  }

  public render(
    localId: string,
    players: Record<string, PlayerState>,
    remoteTransforms: Map<string, KartTransform>
  ) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Draw background track ribbon
    const samples = trackCircuit.samples;
    if (samples.length === 0) return;

    // Track path
    ctx.beginPath();
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#181b36';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const { cx, cy } = this.worldToCanvas(s.x, s.z);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.closePath();
    ctx.stroke();

    // Track inner neon centerline
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00f3ff';
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const { cx, cy } = this.worldToCanvas(s.x, s.z);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.closePath();
    ctx.stroke();

    // Draw Overpass Bridge highlight (high Z/Y section)
    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ff00aa';
    const overpassSamples = samples.filter((s) => s.y > 10);
    for (let i = 0; i < overpassSamples.length; i++) {
      const s = overpassSamples[i];
      const { cx, cy } = this.worldToCanvas(s.x, s.z);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Start / Finish Line marker
    const startPt = this.worldToCanvas(0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(startPt.cx - 2, startPt.cy - 5, 4, 10);

    // Draw Player Blips
    for (const [id, player] of Object.entries(players)) {
      if (!player.connected || player.isSpectator) continue;

      let px = player.transform.x;
      let pz = player.transform.z;

      if (id !== localId) {
        const trans = remoteTransforms.get(id);
        if (trans) {
          px = trans.x;
          pz = trans.z;
        }
      }

      const { cx, cy } = this.worldToCanvas(px, pz);
      const isLocal = id === localId;
      const colorInfo = KART_COLORS[player.color] || KART_COLORS.cyan;
      const hexColor = `#${colorInfo.glow.toString(16).padStart(6, '0')}`;

      // Outer ring for local player
      if (isLocal) {
        ctx.beginPath();
        ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Blip circle
      ctx.beginPath();
      ctx.arc(cx, cy, isLocal ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = hexColor;
      ctx.fill();
    }
  }
}
