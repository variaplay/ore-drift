import { ORE, SHIP } from '../config.js';

export class Ore extends Phaser.Physics.Arcade.Sprite {
  // `towardAngle` (optional): preferred fling direction — usually the angle
  // pointing from the meteor toward the miner. Keeps ore drifting toward
  // whoever cracked the rock instead of uniformly spraying.
  constructor(scene, x, y, value = 1, towardAngle = null) {
    super(scene, x, y, 'ore');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.value = value;
    this.setCircle(5, 3, 3);

    // bias a uniform random angle toward `towardAngle` by ORE.biasTowardMiner
    let a;
    if (towardAngle !== null) {
      const spread = Math.PI * (1 - ORE.biasTowardMiner); // smaller spread => more directed
      a = towardAngle + (Math.random() - 0.5) * spread;
    } else {
      a = Math.random() * Math.PI * 2;
    }
    const s = Phaser.Math.FloatBetween(ORE.flingSpeedMin, ORE.flingSpeedMax);
    this.setVelocity(Math.cos(a) * s, Math.sin(a) * s);
    this.setDamping(true);
    this.setDrag(ORE.drag);
    this.bornAt = scene.time.now;
    this.setTint(0xffd66b);
  }

  tickMagnet(ships) {
    // magnetize to nearest ship in range
    let nearest = null;
    let nd2 = SHIP.magnetRadius * SHIP.magnetRadius;
    for (const s of ships) {
      if (!s.alive) continue;
      const d2 = Phaser.Math.Distance.Squared(this.x, this.y, s.x, s.y);
      if (d2 < nd2) { nd2 = d2; nearest = s; }
    }
    if (nearest) {
      const a = Math.atan2(nearest.y - this.y, nearest.x - this.x);
      this.body.velocity.x += Math.cos(a) * ORE.magnetAccel * (1 / 60);
      this.body.velocity.y += Math.sin(a) * ORE.magnetAccel * (1 / 60);
      const vmag = Math.hypot(this.body.velocity.x, this.body.velocity.y);
      if (vmag > ORE.maxSpeed) {
        this.body.velocity.x *= ORE.maxSpeed / vmag;
        this.body.velocity.y *= ORE.maxSpeed / vmag;
      }
    }
    if (this.scene.time.now - this.bornAt > ORE.lifetime) this.destroy();
  }
}
