import * as THREE from 'three';
import { trackCircuit } from '../../shared/trackData.js';
import { TOTAL_LAPS } from '../../shared/constants.js';

export class CheckpointTracker {
  public currentLap: number = 1;
  public lastCheckpointIndex: number = 0;
  public totalProgressDistance: number = 0;
  public isFinished: boolean = false;
  public lapTimes: number[] = [];
  public currentLapStartTime: number = 0;

  private totalCheckpoints: number;

  constructor() {
    this.totalCheckpoints = trackCircuit.checkpoints.length;
  }

  public reset(startTime: number = Date.now()) {
    this.currentLap = 1;
    this.lastCheckpointIndex = 0;
    this.totalProgressDistance = 0;
    this.isFinished = false;
    this.lapTimes = [];
    this.currentLapStartTime = startTime;
  }

  public update(kartPos: THREE.Vector3): { lapCompleted: boolean; finished: boolean } {
    if (this.isFinished) return { lapCompleted: false, finished: true };

    const checkpoints = trackCircuit.checkpoints;
    const count = this.totalCheckpoints;

    // Check the next expected checkpoint
    const nextIdx = (this.lastCheckpointIndex + 1) % count;
    const nextCp = checkpoints[nextIdx];

    const dx = kartPos.x - nextCp.x;
    const dy = (kartPos.y - nextCp.y) * 2.0; // vertical weighting for overpass
    const dz = kartPos.z - nextCp.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    // Checkpoint radius check (16 meters road width)
    const threshold = 18.0;
    if (distSq < threshold * threshold) {
      // Reached next checkpoint in order!
      this.lastCheckpointIndex = nextIdx;

      // Check if this was the finish line checkpoint (0) completing a lap
      if (nextIdx === 0) {
        const now = Date.now();
        const lapDuration = (now - this.currentLapStartTime) / 1000;
        this.lapTimes.push(lapDuration);
        this.currentLapStartTime = now;

        if (this.currentLap >= TOTAL_LAPS) {
          this.isFinished = true;
          return { lapCompleted: true, finished: true };
        } else {
          this.currentLap++;
          return { lapCompleted: true, finished: false };
        }
      }
    }

    // Compute progress distance along circuit
    const currentCp = checkpoints[this.lastCheckpointIndex];
    const segNextCp = checkpoints[(this.lastCheckpointIndex + 1) % count];

    const segVector = new THREE.Vector3(segNextCp.x - currentCp.x, segNextCp.y - currentCp.y, segNextCp.z - currentCp.z);
    const segLen = segVector.length() || 1;
    const kartOffset = new THREE.Vector3(kartPos.x - currentCp.x, kartPos.y - currentCp.y, kartPos.z - currentCp.z);
    const projAlongSeg = Math.max(0, Math.min(segLen, kartOffset.dot(segVector.clone().normalize())));

    // Approximate cumulative distance
    const distPerCheckpoint = trackCircuit.totalLength / count;
    const lapProgress = this.lastCheckpointIndex * distPerCheckpoint + projAlongSeg;
    this.totalProgressDistance = (this.currentLap - 1) * trackCircuit.totalLength + lapProgress;

    return { lapCompleted: false, finished: false };
  }
}
