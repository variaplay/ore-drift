import { Controller } from './Controller.js';
import { NPC, SHIP } from '../config.js';

export const NPC_PERSONALITIES = {
  miner: {
    label: 'MINER',
    distancePenalty: 1.0,
    normalBias: 80,
    crystalBias: 750,
    motherBias: 900,
    oreBias: 0.4,
    deathCloudBias: 120,
    huntBias: -900,
    boostChance: 0.007,
    boostFuelGate: 35,
  },
  scavenger: {
    label: 'SCAV',
    distancePenalty: 0.75,
    normalBias: 20,
    crystalBias: 420,
    motherBias: 650,
    oreBias: 8,
    deathCloudBias: 1800,
    huntBias: -700,
    boostChance: 0.014,
    boostFuelGate: 25,
  },
  hunter: {
    label: 'HUNTER',
    distancePenalty: 0.65,
    normalBias: -40,
    crystalBias: 300,
    motherBias: 500,
    oreBias: 0.2,
    deathCloudBias: 500,
    huntBias: 1500,
    boostChance: 0.018,
    boostFuelGate: 20,
  },
};

const PERSONALITY_KEYS = Object.keys(NPC_PERSONALITIES);

export function npcPersonalityByIndex(index) {
  return PERSONALITY_KEYS[index % PERSONALITY_KEYS.length];
}

// Simulates another player: picks a nearby meteor, steers toward it,
// occasionally boosts. Output shape is identical to LocalInputController
// so swapping in a network-fed controller later is a drop-in change.
export class NpcController extends Controller {
  constructor(scene, personalityKey = 'miner') {
    super();
    this.scene = scene;
    this.personalityKey = NPC_PERSONALITIES[personalityKey] ? personalityKey : 'miner';
    this.profile = NPC_PERSONALITIES[this.personalityKey];
    this.target = null;
    this.retargetAt = 0;
    this.boostUntil = 0;
    this.jitter = (Math.random() - 0.5) * NPC.seekJitter;
  }

  _isTargetValid(target) {
    if (!target) return false;
    if (target.kind === 'meteor') return target.ref.active && target.ref.hp > 0;
    if (target.kind === 'ore') return target.ref.active;
    if (target.kind === 'ship') return target.ref.alive && !target.ref.isInvulnerable?.();
    if (target.kind === 'deathCloud') return this.scene.time.now < target.ref.expiresAt;
    return false;
  }

  _targetPoint(target) {
    if (target.kind === 'deathCloud') return { x: target.ref.x, y: target.ref.y };
    return { x: target.ref.x, y: target.ref.y };
  }

  _pickTarget(ship) {
    const candidates = [];
    const p = this.profile;
    const scoreDist = (x, y) => Phaser.Math.Distance.Between(ship.x, ship.y, x, y) * p.distancePenalty;

    for (const m of this.scene.meteors.getChildren()) {
      if (!m.active || m.hp <= 0) continue;
      const tierBias = m.tier === 'mother' ? p.motherBias
                     : m.tier === 'crystal' ? p.crystalBias
                     : p.normalBias;
      const value = m.oreYield?.() ?? 1;
      candidates.push({
        kind: 'meteor',
        ref: m,
        x: m.x,
        y: m.y,
        score: tierBias + value * 4 - scoreDist(m.x, m.y),
      });
    }

    if (p.oreBias > 0) {
      for (const ore of this.scene.ores.getChildren()) {
        if (!ore.active) continue;
        const cloudBonus = ore.isDeathCloudOre ? p.deathCloudBias * 0.25 : 0;
        candidates.push({
          kind: 'ore',
          ref: ore,
          x: ore.x,
          y: ore.y,
          score: p.oreBias * (ore.value ?? 1) * 100 + cloudBonus - scoreDist(ore.x, ore.y),
        });
      }
    }

    for (const cloud of this.scene.deathClouds || []) {
      if (this.scene.time.now >= cloud.expiresAt) continue;
      candidates.push({
        kind: 'deathCloud',
        ref: cloud,
        x: cloud.x,
        y: cloud.y,
        score: p.deathCloudBias + (cloud.value ?? 0) * 20 - scoreDist(cloud.x, cloud.y),
      });
    }

    if (p.huntBias > 0) {
      for (const other of this.scene.ships) {
        if (other === ship || !other.alive || other.isInvulnerable?.()) continue;
        const d = Phaser.Math.Distance.Between(ship.x, ship.y, other.x, other.y);
        if (d > SHIP.laserRange * 2.8) continue;
        const sizeReward = (other.scaleX || 1) * 180;
        const playerReward = other.isPlayer ? 300 : 0;
        candidates.push({
          kind: 'ship',
          ref: other,
          x: other.x,
          y: other.y,
          score: p.huntBias + sizeReward + playerReward - scoreDist(other.x, other.y),
        });
      }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    const pick = Phaser.Math.Between(0, Math.min(3, candidates.length - 1));
    return candidates[pick];
  }

  update(ship, _ctx, _dt) {
    const now = this.scene.time.now;
    if (!this._isTargetValid(this.target) || now > this.retargetAt) {
      this.target = this._pickTarget(ship);
      this.retargetAt = now + NPC.retargetMs + Math.random() * 800;
    }

    let heading = ship.heading;
    if (this.target) {
      const point = this._targetPoint(this.target);
      heading = Math.atan2(point.y - ship.y, point.x - ship.x) + this.jitter;
    }

    // occasional boost when far from target and has fuel
    if (now > this.boostUntil && Math.random() < this.profile.boostChance && ship.fuel > this.profile.boostFuelGate) {
      this.boostUntil = now + 800 + Math.random() * 600;
    }
    const boost = now < this.boostUntil && ship.fuel > 5;

    return { heading, boost };
  }
}
