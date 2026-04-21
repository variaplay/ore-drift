import { METEOR, COLORS } from '../config.js';

export class Meteor extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, radius, { tier = 'normal' } = {}) {
    super(scene, x, y, 'meteor');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.tier = tier; // 'normal' | 'crystal'
    const finalRadius = tier === 'crystal' ? radius * METEOR.crystalRadiusMult : radius;

    this.radius = finalRadius;
    this.hp = finalRadius * METEOR.hpPerRadius * (tier === 'crystal' ? METEOR.crystalHpMult : 1);
    this.maxHp = this.hp;
    const s = finalRadius / 32;
    this.setScale(s);
    this.setCircle(32, 0, 0);
    this.setAngularVelocity(Phaser.Math.FloatBetween(-20, 20));
    const a = Math.random() * Math.PI * 2;
    this.setVelocity(Math.cos(a) * METEOR.driftSpeed, Math.sin(a) * METEOR.driftSpeed);
    this.setBounce(1, 1);
    this.setTint(this._baseTint());
    this._nextWanderAt = scene.time.now
      + Phaser.Math.Between(METEOR.wanderEveryMsMin, METEOR.wanderEveryMsMax);

    if (tier === 'crystal') {
      // soft cyan glow pulse to telegraph high-value targets from far away
      this.glowFx = scene.add.particles(0, 0, 'spark', {
        follow: this,
        speed: { min: 10, max: 30 },
        lifespan: 500,
        scale: { start: 0.6, end: 0 },
        alpha: { start: 0.6, end: 0 },
        blendMode: 'ADD',
        tint: COLORS.crystal,
        frequency: 120,
      });
    }
  }

  _baseTint() { return this.tier === 'crystal' ? COLORS.crystal : COLORS.meteor; }
  _hotTint()  { return this.tier === 'crystal' ? COLORS.crystalHot : COLORS.meteorHot; }

  damage(amount) {
    this.hp -= amount;
    const t = 1 - Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.IntegerToColor(this._baseTint()),
      Phaser.Display.Color.IntegerToColor(this._hotTint()),
      100,
      Math.floor(t * 100),
    );
    this.setTint(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
    return this.hp <= 0;
  }

  oreYield() {
    const base = Math.max(1, Math.round(this.radius * METEOR.oreYield));
    return this.tier === 'crystal' ? base * METEOR.crystalYieldMult : base;
  }

  wander() {
    // periodic random nudge — shifts heading over time so meteors don't fly
    // in straight lines forever. Speed is clamped to driftMax so bouncing
    // off neighbors can't compound into a runaway.
    const now = this.scene.time.now;
    if (now < this._nextWanderAt) return;
    const a = Math.random() * Math.PI * 2;
    this.body.velocity.x += Math.cos(a) * METEOR.wanderImpulse;
    this.body.velocity.y += Math.sin(a) * METEOR.wanderImpulse;
    const vmag = Math.hypot(this.body.velocity.x, this.body.velocity.y);
    if (vmag > METEOR.driftMax) {
      this.body.velocity.x *= METEOR.driftMax / vmag;
      this.body.velocity.y *= METEOR.driftMax / vmag;
    }
    this._nextWanderAt = now
      + Phaser.Math.Between(METEOR.wanderEveryMsMin, METEOR.wanderEveryMsMax);
  }

  destroy(fromScene) {
    this.glowFx?.destroy();
    super.destroy(fromScene);
  }
}
