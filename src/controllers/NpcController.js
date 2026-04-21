import { Controller } from './Controller.js';
import { NPC } from '../config.js';

// Simulates another player: picks a nearby meteor, steers toward it,
// occasionally boosts. Output shape is identical to LocalInputController
// so swapping in a network-fed controller later is a drop-in change.
export class NpcController extends Controller {
  constructor(scene) {
    super();
    this.scene = scene;
    this.target = null;
    this.retargetAt = 0;
    this.boostUntil = 0;
    this.jitter = (Math.random() - 0.5) * NPC.seekJitter;
  }

  _pickTarget(ship) {
    const meteors = this.scene.meteors.getChildren().filter(m => m.active && m.hp > 0);
    if (!meteors.length) return null;
    // score: closer is better (−distance), crystals are much more desirable.
    // NPCs now compete with the player for crystal hotspots, which is what
    // makes #1 a real strategic lever rather than just a cosmetic tier.
    const score = (m) => {
      const d = Math.sqrt(Phaser.Math.Distance.Squared(ship.x, ship.y, m.x, m.y));
      const tierBonus = m.tier === 'crystal' ? 900 : 0;
      return tierBonus - d;
    };
    meteors.sort((a, b) => score(b) - score(a));
    const pick = Phaser.Math.Between(0, Math.min(3, meteors.length - 1));
    return meteors[pick];
  }

  update(ship, _ctx, _dt) {
    const now = this.scene.time.now;
    if (!this.target || !this.target.active || this.target.hp <= 0 || now > this.retargetAt) {
      this.target = this._pickTarget(ship);
      this.retargetAt = now + NPC.retargetMs + Math.random() * 800;
    }

    let heading = ship.heading;
    if (this.target) {
      heading = Math.atan2(this.target.y - ship.y, this.target.x - ship.x) + this.jitter;
    }

    // occasional boost when far from target and has fuel
    if (now > this.boostUntil && Math.random() < 0.01 && ship.fuel > 30) {
      this.boostUntil = now + 800 + Math.random() * 600;
    }
    const boost = now < this.boostUntil && ship.fuel > 5;

    return { heading, boost };
  }
}
