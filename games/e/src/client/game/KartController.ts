import * as THREE from 'three';
import { KartTransform, PlayerInput } from '../../shared/types.js';
import { PHYSICS_CONFIG } from '../../shared/constants.js';
import { trackCircuit } from '../../shared/trackData.js';
import { soundSystem } from '../audio/SoundSystem.js';

export class KartController {
  public position = new THREE.Vector3(0, 0.2, 0);
  public quaternion = new THREE.Quaternion();
  public velocity = new THREE.Vector3();
  public speed = 0;
  public steerAngle = 0;
  public driftDirection = 0; // -1 = left, 1 = right, 0 = none
  public driftTime = 0;
  public driftLevel = 0; // 0, 1, 2, 3
  public isBoosting = false;
  public boostTimer = 0;
  public isShielded = false;
  public shieldTimer = 0;
  public isSpunOut = false;
  public spinOutTimer = 0;
  public isAirborne = false;
  public verticalVelocity = 0;
  public currentLap = 1;
  public lastCheckpoint = 0;
  public progressDistance = 0;
  public respawnTimer = 0;
  public invulnerableTimer = 0;

  private input: PlayerInput = {
    throttle: 0,
    steer: 0,
    drift: false,
    useItem: false,
    respawn: false,
  };

  private forward = new THREE.Vector3(0, 0, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private right = new THREE.Vector3(1, 0, 0);

  constructor() {
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
  }

  public setInput(input: PlayerInput) {
    this.input = input;
    if (input.respawn && this.respawnTimer <= 0) {
      this.triggerRespawn();
    }
  }

  public resetPosition(x: number, y: number, z: number, forwardAngle: number = 0) {
    this.position.set(x, y, z);
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), forwardAngle);
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.steerAngle = 0;
    this.driftDirection = 0;
    this.driftTime = 0;
    this.driftLevel = 0;
    this.isBoosting = false;
    this.boostTimer = 0;
    this.isSpunOut = false;
    this.spinOutTimer = 0;
    this.isAirborne = false;
    this.verticalVelocity = 0;
    this.currentLap = 1;
    this.lastCheckpoint = 0;
    this.progressDistance = 0;
    this.respawnTimer = 0;
    this.invulnerableTimer = 2.0;
  }

  public triggerRespawn() {
    this.respawnTimer = 1.0;
    const respawn = trackCircuit.getRespawnPoint(this.lastCheckpoint);
    this.resetPosition(respawn.x, respawn.y, respawn.z, respawn.forwardAngle);
    soundSystem.playCountdown(false);
  }

  public triggerHit() {
    if (this.isShielded || this.invulnerableTimer > 0) return;
    this.isSpunOut = true;
    this.spinOutTimer = PHYSICS_CONFIG.spinOutDuration;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    soundSystem.playHitExplosion();
  }

  public applyBoost(duration: number) {
    this.isBoosting = true;
    this.boostTimer = Math.max(this.boostTimer, duration);
    this.speed = Math.max(this.speed, PHYSICS_CONFIG.boostSpeed * 0.8);
    soundSystem.playBoostPad();
  }

  public applyShield(duration: number) {
    this.isShielded = true;
    this.shieldTimer = Math.max(this.shieldTimer, duration);
  }

  public update(dt: number) {
    // Timers
    if (this.invulnerableTimer > 0) this.invulnerableTimer -= dt;

    if (this.isBoosting) {
      this.boostTimer -= dt;
      if (this.boostTimer <= 0) this.isBoosting = false;
    }

    if (this.isShielded) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) this.isShielded = false;
    }

    if (this.isSpunOut) {
      this.spinOutTimer -= dt;
      if (this.spinOutTimer <= 0) this.isSpunOut = false;
      this.speed = 0;
      return;
    }

    // Query 3D track surface at current localized checkpoint
    const query = trackCircuit.querySurface(
      this.position.x,
      this.position.y,
      this.position.z,
      this.lastCheckpoint
    );

    // Out of bounds fall detection
    if (query.isOutOfBounds || this.position.y < -15.0) {
      this.triggerRespawn();
      return;
    }

    // Boost pad contact
    if (query.isBoostPad && !this.isAirborne) {
      this.applyBoost(1.6);
    }

    // Launch ramp lip detection
    if (query.isJumpLip && !this.isAirborne && this.speed > 15.0) {
      this.isAirborne = true;
      this.verticalVelocity = PHYSICS_CONFIG.jumpForce;
      soundSystem.playJumpLaunch();
    }

    // Update Orientation Vectors
    this.forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);

    // Steering & Drifting
    const steerInput = this.input.steer;
    const isDriftKeyDown = this.input.drift;

    if (
      isDriftKeyDown &&
      this.driftDirection === 0 &&
      Math.abs(steerInput) > 0.1 &&
      this.speed > PHYSICS_CONFIG.driftMinSpeed &&
      !this.isAirborne
    ) {
      // Start drift hop!
      this.driftDirection = steerInput > 0 ? 1 : -1;
      this.driftTime = 0;
      this.driftLevel = 0;
      this.verticalVelocity = 3.5;
      this.isAirborne = true;
    }

    if (this.driftDirection !== 0) {
      if (!isDriftKeyDown || this.speed < PHYSICS_CONFIG.driftMinSpeed || this.isAirborne) {
        // Release drift -> Trigger Mini-Turbo Boost!
        if (this.driftLevel > 0) {
          const boostDur =
            this.driftLevel === 3
              ? PHYSICS_CONFIG.driftBoost3Duration
              : this.driftLevel === 2
              ? PHYSICS_CONFIG.driftBoost2Duration
              : PHYSICS_CONFIG.driftBoost1Duration;
          this.applyBoost(boostDur);
          soundSystem.playDriftBoost(this.driftLevel);
        }
        this.driftDirection = 0;
        this.driftTime = 0;
        this.driftLevel = 0;
      } else {
        // Accumulate drift sparks
        this.driftTime += dt;
        if (this.driftTime > PHYSICS_CONFIG.driftTier3Time) {
          this.driftLevel = 3;
        } else if (this.driftTime > PHYSICS_CONFIG.driftTier2Time) {
          this.driftLevel = 2;
        } else if (this.driftTime > PHYSICS_CONFIG.driftTier1Time) {
          this.driftLevel = 1;
        }
      }
    }

    // Turning rate
    const turnSensitivity =
      this.driftDirection !== 0
        ? PHYSICS_CONFIG.steerSpeed * PHYSICS_CONFIG.driftSteerMultiplier
        : PHYSICS_CONFIG.steerSpeed;
    const steerTarget =
      this.driftDirection !== 0
        ? this.driftDirection * 0.85 + steerInput * 0.35
        : steerInput;

    this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, steerTarget, dt * 10);
    const turnAmount = -this.steerAngle * turnSensitivity * dt * (this.speed / 28.0);
    const yawDelta = new THREE.Quaternion().setFromAxisAngle(this.up, turnAmount);
    this.quaternion.multiply(yawDelta);

    // Throttle, Acceleration, Braking
    const maxSpd = this.isBoosting
      ? PHYSICS_CONFIG.boostSpeed
      : query.isOffroad && !this.isBoosting
      ? PHYSICS_CONFIG.maxSpeed * PHYSICS_CONFIG.offroadSpeedMultiplier
      : PHYSICS_CONFIG.maxSpeed;

    const throttle = this.input.throttle;
    if (throttle > 0) {
      const accel = this.isBoosting
        ? PHYSICS_CONFIG.boostAcceleration
        : PHYSICS_CONFIG.acceleration;
      this.speed += accel * throttle * dt;
      if (this.speed > maxSpd) this.speed = maxSpd;
    } else if (throttle < 0) {
      if (this.speed > 0) {
        // Braking
        this.speed -= PHYSICS_CONFIG.braking * dt;
        if (this.speed < 0) this.speed = 0;
      } else {
        // Reverse
        this.speed -= PHYSICS_CONFIG.acceleration * 0.5 * dt;
        if (this.speed < -PHYSICS_CONFIG.reverseMaxSpeed) {
          this.speed = -PHYSICS_CONFIG.reverseMaxSpeed;
        }
      }
    } else {
      // Natural rolling friction & drag
      const dragLoss = (this.speed * PHYSICS_CONFIG.drag + PHYSICS_CONFIG.rollingFriction) * dt;
      if (this.speed > 0) {
        this.speed = Math.max(0, this.speed - dragLoss);
      } else if (this.speed < 0) {
        this.speed = Math.min(0, this.speed + dragLoss);
      }
    }

    // Forward displacement
    const forwardStep = this.forward.clone().multiplyScalar(this.speed * dt);
    this.position.add(forwardStep);

    // Vertical Physics (Ground snapping vs Airborne ballistic arc)
    const targetSurfaceY = query.surfaceY;
    if (this.isAirborne) {
      this.verticalVelocity -= PHYSICS_CONFIG.gravity * dt;
      this.position.y += this.verticalVelocity * dt;

      // Landing check (only if not falling into the jump chasm)
      if (this.position.y <= targetSurfaceY + 0.1 && !query.isChasm) {
        this.position.y = targetSurfaceY + 0.1;
        this.verticalVelocity = 0;
        this.isAirborne = false;
      }
    } else {
      // Snap smoothly to 3D track surface
      this.position.y = THREE.MathUtils.lerp(this.position.y, targetSurfaceY + 0.1, dt * 18);

      // Align kart normal with track surface normal
      const surfaceNorm = new THREE.Vector3(query.normal.x, query.normal.y, query.normal.z);
      const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), surfaceNorm);
      // Blend gently to preserve yaw
      this.quaternion.slerp(targetQuat.multiply(this.quaternion), dt * 8.0);
    }

    // Engine Audio updates
    const speedRatio = Math.min(1.0, Math.abs(this.speed) / PHYSICS_CONFIG.maxSpeed);
    soundSystem.updateEngine(speedRatio, throttle);
  }

  public getTransform(): KartTransform {
    return {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      qx: this.quaternion.x,
      qy: this.quaternion.y,
      qz: this.quaternion.z,
      qw: this.quaternion.w,
      vx: this.velocity.x,
      vy: this.velocity.y,
      vz: this.velocity.z,
      speed: this.speed,
      steerAngle: this.steerAngle,
      driftLevel: this.driftLevel,
      driftDirection: this.driftDirection,
      isBoosting: this.isBoosting,
      isShielded: this.isShielded,
      isSpunOut: this.isSpunOut,
      isAirborne: this.isAirborne,
    };
  }
}
