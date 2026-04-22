import { METEOR, COLORS } from '../config.js';

export class Meteor extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, radius, { tier = 'normal' } = {}) {
    super(scene, x, y, 'meteor');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.tier = tier; // 'normal' | 'crystal'
    const finalRadius = tier === 'crystal' ? radius * METEOR.crystalRadiusMult : radius;

    this.radius = finalRadius;
    // HP and yield both scale with AREA (r²) — bigger rocks take longer to
    // break AND drop proportionally more ore. This makes large meteors a
    // deliberate commitment and small ones quick snacks.
    const area = finalRadius * finalRadius;
    this.hp = area * METEOR.hpPerArea * (tier === 'crystal' ? METEOR.crystalHpMult : 1);
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

    // Precompute the yield count once so the label text and the shatter
    // payout always agree.
    this._cachedYield = this._computeYield();

    // yield label — small number drawn on the meteor so players can eyeball
    // how much ore a rock is worth before committing to mine it
    const labelColor = tier === 'crystal' ? '#9bffe5' : '#e8c46a';
    this.yieldLabel = scene.add.text(x, y, String(this._cachedYield), {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '12px',
      fontStyle: 'bold',
      color: labelColor,
      stroke: '#05060c',
      strokeThickness: 3,
    }).setOrigin(0.5, 0.5).setDepth(4);

    if (tier === 'crystal') {
      // denser inner + wispier outer emitter reads as a real glow instead of
      // a few stray sparks
      this.glowInner = scene.add.particles(0, 0, 'spark', {
        follow: this,
        speed: { min: 20, max: 60 },
        lifespan: { min: 260, max: 520 },
        scale: { start: 1.0, end: 0 },
        alpha: { start: 0.9, end: 0 },
        blendMode: 'ADD',
        tint: COLORS.crystal,
        frequency: 50,
      });
      this.glowOuter = scene.add.particles(0, 0, 'spark', {
        follow: this,
        speed: { min: 4, max: 16 },
        lifespan: { min: 700, max: 1200 },
        scale: { start: 1.8, end: 0 },
        alpha: { start: 0.45, end: 0 },
        blendMode: 'ADD',
        tint: COLORS.crystal,
        frequency: 90,
      });

      // animated halo ring drawn beneath the sprite — strongest signal at a
      // glance that this one is a high-value target
      this.halo = scene.add.graphics();
      this.halo.setDepth(-1);
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

  _computeYield() {
    const base = Math.max(1, Math.round(this.radius * this.radius * METEOR.oreYield));
    return this.tier === 'crystal' ? base * METEOR.crystalYieldMult : base;
  }

  oreYield() { return this._cachedYield; }

  wander() {
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

  updateVisuals(time) {
    // keep the yield label pinned to the meteor, hide it once the rock is
    // visibly beaten-up (no point advertising yield once it's about to pop)
    if (this.yieldLabel) {
      this.yieldLabel.setPosition(this.x, this.y);
      this.yieldLabel.setAlpha(Phaser.Math.Clamp(this.hp / this.maxHp, 0.15, 1));
    }

    if (this.tier !== 'crystal' || !this.halo) return;
    // pulsing halo: breathes on a ~1400ms cycle, always visible, so crystals
    // are impossible to miss against the starfield
    const pulse = 0.5 + 0.5 * Math.sin(time / 220);
    const rBase = this.radius;
    this.halo.clear();
    // outer wide glow
    this.halo.lineStyle(2 + pulse * 3, COLORS.crystal, 0.25 + pulse * 0.35);
    this.halo.strokeCircle(this.x, this.y, rBase + 6 + pulse * 10);
    // inner tighter glow
    this.halo.lineStyle(1 + pulse * 2, COLORS.crystalHot, 0.4 + pulse * 0.3);
    this.halo.strokeCircle(this.x, this.y, rBase + 2 + pulse * 3);
    // faint filled core to add a warm center
    this.halo.fillStyle(COLORS.crystal, 0.1 + pulse * 0.08);
    this.halo.fillCircle(this.x, this.y, rBase - 2);
  }

  destroy(fromScene) {
    this.glowFx?.destroy();
    this.glowInner?.destroy();
    this.glowOuter?.destroy();
    this.halo?.destroy();
    this.yieldLabel?.destroy();
    super.destroy(fromScene);
  }
}
