import { METEOR, MOTHER_METEOR, COLORS } from '../config.js';
import { METEOR_VARIANTS } from '../util/placeholderArt.js';

// Per-tier visual and stat parameters. Keeps the tier-specific branches
// in the constructor readable and easy to extend.
const TIER_PARAMS = {
  normal:  { base: COLORS.meteor,  hot: COLORS.meteorHot,  glow: false },
  crystal: {
    base: COLORS.crystal, hot: COLORS.crystalHot, glow: true,
    innerScale: 1.0, innerFreq: 50, outerScale: 1.8, outerFreq: 90,
    haloInner: COLORS.crystalHot, crackColor: COLORS.crystalHot,
  },
  mother: {
    base: COLORS.mother, hot: COLORS.motherHot, glow: true,
    innerScale: 1.6, innerFreq: 30, outerScale: 2.6, outerFreq: 60,
    haloInner: COLORS.motherHot, crackColor: COLORS.motherHot,
  },
};

export class Meteor extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, radius, { tier = 'normal' } = {}) {
    // pick one of the irregular variant textures so neighbors don't look
    // identical. Falls back to the legacy 'meteor' key if a variant doesn't
    // exist (e.g. if preload() was customized to load real PNGs).
    const variant = Phaser.Math.Between(0, METEOR_VARIANTS - 1);
    const texKey = scene.textures.exists(`meteor_${variant}`) ? `meteor_${variant}` : 'meteor';
    super(scene, x, y, texKey);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.tier = tier; // 'normal' | 'crystal' | 'mother'
    const finalRadius = tier === 'crystal' ? radius * METEOR.crystalRadiusMult : radius;

    this.radius = finalRadius;
    // HP and yield both scale with AREA (r²) — bigger rocks take longer to
    // break AND drop proportionally more ore. This makes large meteors a
    // deliberate commitment and small ones quick snacks.
    const area = finalRadius * finalRadius;
    const hpMult = tier === 'crystal' ? METEOR.crystalHpMult
                 : tier === 'mother'  ? MOTHER_METEOR.hpMult
                 : 1;
    this.hp = area * METEOR.hpPerArea * hpMult;
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

    // Precompute the yield count once so shatter payouts are stable.
    this._cachedYield = this._computeYield();

    // Cracks overlay — procedural jagged lines appear as damage crosses
    // thresholds. Stored in the meteor's local frame so they rotate with
    // the rock and look like they're actually on its surface.
    this._cracks = scene.add.graphics();
    this._cracks.setDepth(0.5);
    this._crackLines = [];
    this._crackThresholds = [0.12, 0.28, 0.45, 0.62, 0.78, 0.9];
    this._nextCrackIdx = 0;

    const tp = TIER_PARAMS[tier];
    if (tp?.glow) {
      // denser inner + wispier outer emitter reads as a real glow instead of
      // a few stray sparks. Mother meteors get bigger/faster versions so the
      // event reads as a huge molten rock, not just "a big crystal".
      this.glowInner = scene.add.particles(0, 0, 'spark', {
        follow: this,
        speed: { min: 20 * tp.innerScale, max: 60 * tp.innerScale },
        lifespan: { min: 260, max: 520 },
        scale: { start: tp.innerScale, end: 0 },
        alpha: { start: 0.9, end: 0 },
        blendMode: 'ADD',
        tint: tp.base,
        frequency: tp.innerFreq,
      });
      this.glowOuter = scene.add.particles(0, 0, 'spark', {
        follow: this,
        speed: { min: 4, max: 16 },
        lifespan: { min: 700, max: 1200 },
        scale: { start: tp.outerScale, end: 0 },
        alpha: { start: 0.45, end: 0 },
        blendMode: 'ADD',
        tint: tp.base,
        frequency: tp.outerFreq,
      });

      // animated halo ring drawn beneath the sprite — strongest signal at a
      // glance that this one is a high-value target
      this.halo = scene.add.graphics();
      this.halo.setDepth(-1);
    }
  }

  _baseTint() { return TIER_PARAMS[this.tier]?.base ?? COLORS.meteor; }
  _hotTint()  { return TIER_PARAMS[this.tier]?.hot ?? COLORS.meteorHot; }

  damage(amount) {
    this.hp -= amount;
    const t = 1 - Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);

    // Grow the crack network as damage passes each threshold. Each crossing
    // adds one new jagged line so players can *see* the rock weakening.
    while (this._nextCrackIdx < this._crackThresholds.length
           && t >= this._crackThresholds[this._nextCrackIdx]) {
      this._addCrack();
      this._nextCrackIdx++;
    }

    // Manual RGB lerp. Phaser's Color.Interpolate.ColorWithColor has leaked
    // NaN through GetColor in some edge cases (maxHp=0, Clamp(NaN)) and
    // silently produced black tints — that's the "meteor turns black" bug.
    const base = this._baseTint();
    const hot = this._hotTint();
    const br = (base >> 16) & 0xff, bg = (base >> 8) & 0xff, bb = base & 0xff;
    const hr = (hot >> 16) & 0xff, hg = (hot >> 8) & 0xff, hb = hot & 0xff;
    const r = Math.round(br + (hr - br) * t);
    const g = Math.round(bg + (hg - bg) * t);
    const b = Math.round(bb + (hb - bb) * t);
    this.setTint((r << 16) | (g << 8) | b);

    return this.hp <= 0;
  }

  _addCrack() {
    // jagged polyline from an inner point out to the rock's edge, stored
    // in local meteor coords (rotated with the sprite at draw time).
    //
    // The meteor silhouette varies between ~0.69× and ~0.94× of `this.radius`
    // (sum-of-sines in placeholderArt.js). We target 0.85× as the end-point,
    // which sits comfortably inside the silhouette at every angle — so cracks
    // reach the visible edge but don't poke into the halo/glow beyond it.
    const angle = Math.random() * Math.PI * 2;
    const maxExtent = this.radius * 0.85;
    const startR = this.radius * 0.1;
    const steps = 4 + Math.floor(Math.random() * 3);
    const jitter = this.radius * 0.08;
    const points = [];
    // first point: inner
    points.push({ x: Math.cos(angle) * startR, y: Math.sin(angle) * startR });
    // intermediate + end points along the ray, with small sideways jitter
    for (let i = 1; i <= steps; i++) {
      const frac = i / steps;
      const r = startR + (maxExtent - startR) * frac;
      // tangent direction for sideways jitter
      const jx = -Math.sin(angle) * (Math.random() - 0.5) * jitter * 2;
      const jy =  Math.cos(angle) * (Math.random() - 0.5) * jitter * 2;
      let px = Math.cos(angle) * r + jx;
      let py = Math.sin(angle) * r + jy;
      // extra safety: clamp any point whose jitter pushed it past maxExtent
      const d = Math.hypot(px, py);
      if (d > maxExtent) { px *= maxExtent / d; py *= maxExtent / d; }
      points.push({ x: px, y: py });
    }
    this._crackLines.push(points);
  }

  _computeYield() {
    const base = Math.max(1, Math.round(this.radius * this.radius * METEOR.oreYield));
    if (this.tier === 'crystal') return base * METEOR.crystalYieldMult;
    if (this.tier === 'mother')  return Math.round(base * MOTHER_METEOR.yieldMult);
    return base;
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
    this._drawCracks();

    const tp = TIER_PARAMS[this.tier];
    if (!tp?.glow || !this.halo) return;
    // pulsing halo: breathes on a ~1400ms cycle. Mother pulses a touch
    // faster (feels like a molten / unstable rock).
    const cycle = this.tier === 'mother' ? 180 : 220;
    const pulse = 0.5 + 0.5 * Math.sin(time / cycle);
    const rBase = this.radius;
    this.halo.clear();
    // outer wide glow
    this.halo.lineStyle(2 + pulse * 3, tp.base, 0.25 + pulse * 0.35);
    this.halo.strokeCircle(this.x, this.y, rBase + 6 + pulse * 10);
    // inner tighter glow
    this.halo.lineStyle(1 + pulse * 2, tp.haloInner, 0.4 + pulse * 0.3);
    this.halo.strokeCircle(this.x, this.y, rBase + 2 + pulse * 3);
    // faint filled core to add a warm center
    this.halo.fillStyle(tp.base, 0.1 + pulse * 0.08);
    this.halo.fillCircle(this.x, this.y, rBase - 2);
  }

  _drawCracks() {
    this._cracks.clear();
    if (!this._crackLines.length) return;
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    // glowing tiers use their hot tint for cracks (reads as lava in the rock);
    // normal meteors use near-black hairlines
    const tp = TIER_PARAMS[this.tier];
    const color = tp?.crackColor ?? 0x0c1018;
    this._cracks.lineStyle(1.2, color, 0.9);
    for (const pts of this._crackLines) {
      this._cracks.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const lx = pts[i].x, ly = pts[i].y;
        const wx = this.x + lx * cos - ly * sin;
        const wy = this.y + lx * sin + ly * cos;
        if (i === 0) this._cracks.moveTo(wx, wy);
        else this._cracks.lineTo(wx, wy);
      }
      this._cracks.strokePath();
    }
  }

  destroy(fromScene) {
    this.glowFx?.destroy();
    this.glowInner?.destroy();
    this.glowOuter?.destroy();
    this.halo?.destroy();
    this._cracks?.destroy();
    super.destroy(fromScene);
  }
}
