import * as THREE from 'three';
import { ItemType } from '../../shared/types.js';
import { trackCircuit } from '../../shared/trackData.js';
import { soundSystem } from '../audio/SoundSystem.js';

export class ItemManager {
  public heldItem: ItemType | null = null;
  public isRouletteSpinning: boolean = false;
  private rouletteTimer: number = 0;

  constructor() {}

  public startRoulette(finalItem: ItemType, onSpin: (displayItem: ItemType) => void, onComplete: (item: ItemType) => void) {
    this.isRouletteSpinning = true;
    this.rouletteTimer = 1.2;
    soundSystem.playItemBoxCollect();

    const items: ItemType[] = ['rocket', 'mine', 'boost', 'shield'];
    let spinIndex = 0;

    const interval = setInterval(() => {
      if (!this.isRouletteSpinning) {
        clearInterval(interval);
        return;
      }

      spinIndex = (spinIndex + 1) % items.length;
      onSpin(items[spinIndex]);

      this.rouletteTimer -= 0.08;
      if (this.rouletteTimer <= 0) {
        clearInterval(interval);
        this.isRouletteSpinning = false;
        this.heldItem = finalItem;
        onComplete(finalItem);
      }
    }, 80);
  }

  public checkItemBoxCollision(kartPos: THREE.Vector3): number | null {
    if (this.heldItem || this.isRouletteSpinning) return null;

    for (const box of trackCircuit.itemBoxes) {
      if (!box.active) continue;
      const dx = kartPos.x - box.x;
      const dy = kartPos.y - box.y;
      const dz = kartPos.z - box.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      // 2.5 meter pickup radius
      if (distSq < 2.5 * 2.5) {
        return box.id;
      }
    }
    return null;
  }
}
