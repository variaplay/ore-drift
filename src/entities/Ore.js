import { ORE, SHIP } from '../config.js';

export class Ore extends Phaser.Physics.Arcade.Sprite {
  // `towardAngle` (optional): preferred fling direction — usually the angle
  // pointing from the meteor toward the miner. Keeps ore drifting toward
  // whoever cracked the rock instead of uniformly spraying.
  constructor(scene, x, y, value = 1, towardAngle = null, options = {}) {
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
    const s = Phaser.Math.FloatBetween(
      options.flingSpeedMin ?? ORE.flingSpeedMin,
      options.flingSpeedMax ?? ORE.flingSpeedMax,
    );
    this.setVelocity(Math.cos(a) * s, Math.sin(a) * s);
    this.setDamping(true);
    this.setDrag(ORE.drag);
    this.bornAt = scene.time.now;
    this.lifetime = options.lifetime ?? ORE.lifetime;
    this.isDeathCloudOre = !!options.deathCloud;
    this.setTint(options.tint ?? 0xffd66b);
    if (options.scale) this.setScale(options.scale);
  }

  tickMagnet(ships) {
    // each ship's magnet reach scales with its visual size (scale^1.5) so
    // bigger ships visibly pull from further out — a real felt reward for
    // growth. pick whichever ship we're relatively closest to inside its reach.
    let nearest = null;
    let nearestD = 0;
    let nearestRange = 1;
    const now = this.scene.time.now;
    for (const s of ships) {
      if (!s.alive) continue;
      if (s._noPickupUntil && now < s._noPickupUntil) continue;
      const sc = s.scaleX || 1;
      const range = SHIP.magnetRadius * Math.pow(sc, 1.5);
      const d = Phaser.Math.Distance.Between(this.x, this.y, s.x, s.y);
      if (d >= range) continue;
      if (nearest === null || d / range < nearestD / nearestRange) {
        nearest = s;
        nearestD = d;
        nearestRange = range;
      }
    }
    if (nearest) {
      const a = Math.atan2(nearest.y - this.y, nearest.x - this.x);
      // proximity boost: the closer the ore, the harder it's yanked — gives
      // the pickup a satisfying "snap-to" instead of a slow drift
      const proximity = 1 - Phaser.Math.Clamp(nearestD / nearestRange, 0, 1);
      const accel = ORE.magnetAccel * (1 + proximity * (ORE.proximityBoost || 0));
      this.body.velocity.x += Math.cos(a) * accel * (1 / 60);
      this.body.velocity.y += Math.sin(a) * accel * (1 / 60);
      const vmag = Math.hypot(this.body.velocity.x, this.body.velocity.y);
      if (vmag > ORE.maxSpeed) {
        this.body.velocity.x *= ORE.maxSpeed / vmag;
        this.body.velocity.y *= ORE.maxSpeed / vmag;
      }
    }
    if (this.scene.time.now - this.bornAt > this.lifetime) this.destroy();
  }
}
