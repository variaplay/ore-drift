import { SHIP, COLORS } from '../config.js';
import { Audio } from '../util/audio.js';

// Single ship class used for both player and NPCs.
// Steering intent comes from a Controller — the ship itself doesn't know
// whether it's driven by a human, AI, or (later) a remote network peer.
export class Ship extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, {
    isPlayer = false,
    colorIndex = null,
    accentColor = null,
    designKey = null,
    statMultipliers = null,
  } = {}) {
    // Player can pick a silhouette from SHIP_DESIGNS; if none selected, fall
    // back to the legacy ship_player texture (which is an alias for 'arrow').
    // NPCs keep per-palette colored variants of the classic hull.
    let tex;
    if (isPlayer) {
      tex = (designKey && scene.textures.exists(`ship_design_${designKey}`))
        ? `ship_design_${designKey}`
        : 'ship_player';
    } else if (colorIndex != null && designKey
               && scene.textures.exists(`ship_npc_${colorIndex}_${designKey}`)) {
      // color-tinted variant of the chosen silhouette
      tex = `ship_npc_${colorIndex}_${designKey}`;
    } else if (colorIndex != null && scene.textures.exists(`ship_npc_${colorIndex}`)) {
      tex = `ship_npc_${colorIndex}`;
    } else {
      tex = 'ship_npc';
    }
    super(scene, x, y, tex);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.isPlayer = isPlayer;
    this.colorIndex = colorIndex;
    // color used for thrust particles & laser — prefer explicit accentColor
    // so player ships can match their selected design's signature color
    this.accentColor = accentColor ?? (isPlayer ? COLORS.laserPlayer : COLORS.laserNpc);
    const mult = statMultipliers || {};
    this.stats = {
      fuelMax: SHIP.fuelMax * (mult.fuelMax ?? 1),
      boostDrain: SHIP.boostDrain * (mult.boostDrain ?? 1),
      magnetRadius: SHIP.magnetRadius * (mult.magnetRadius ?? 1),
      laserDps: SHIP.laserDps * (mult.laserDps ?? 1),
    };
    this.heading = -Math.PI / 2;
    this.fuel = this.stats.fuelMax;
    this.ore = 0;
    this.alive = true;
    this.controller = null;
    this.laserTarget = null;

    this.setCircle(SHIP.radius, 16 - SHIP.radius, 16 - SHIP.radius);
    this.setDamping(true);
    this.setDrag(0.02);
    this.setMaxVelocity(SHIP.boostSpeed);

    // Engine exhaust tinted to this ship's accent color. The trail is always
    // on (the ship never stops); the flame layers in on boost. Particle size
    // tracks ship scale so big late-game ships don't trail tiny specks.
    const sizeOp = (base) => ({
      onEmit: (p) => (p._s0 = base * (this.scaleX || 1)),
      onUpdate: (p, _key, t) => p._s0 * (1 - t),
    });
    this.thrustFx = scene.add.particles(0, 0, 'glow', {
      follow: this,
      speed: { min: 4, max: 18 },
      lifespan: 420,
      scale: sizeOp(0.32),
      alpha: { start: 0.55, end: 0 },
      blendMode: 'ADD',
      tint: this.accentColor,
      frequency: 28,
    });
    this.boostFx = scene.add.particles(0, 0, 'glow', {
      follow: this,
      speed: { min: 20, max: 60 },
      lifespan: 300,
      scale: sizeOp(0.6),
      alpha: { start: 0.9, end: 0 },
      blendMode: 'ADD',
      tint: [0xffffff, this.accentColor, this.accentColor],
      frequency: 12,
      emitting: false,
    });
    this.thrustFx.setDepth(-0.5);
    this.boostFx.setDepth(-0.4);

    this.laserGfx = scene.add.graphics();
    this.laserGfx.setDepth(5);
    this.laserGfx.setBlendMode(Phaser.BlendModes.ADD);

    this._lastScaleApplied = -1;
    // brief invuln on spawn so rivals can't insta-ram fresh respawns
    this.spawnInvulnUntil = scene.time.now + 1500;
  }

  isInvulnerable() {
    return this.scene.time.now < this.spawnInvulnUntil;
  }

  // Called when a ship is killed (by ram or future causes). Caller decides
  // respawn; Ship just becomes inert, runs a small VFX, and reports the
  // amount of cargo to scatter as free-floating ore.
  die() {
    if (!this.alive) return 0;
    this.alive = false;
    this.setVelocity(0, 0);
    this.thrustFx.emitting = false;
    this.boostFx.emitting = false;
    this.laserGfx.clear();
    this._spawnDeathFx();
    // scale-up + fade, then hide — reads as an overpressure flash more than
    // a cartoon poof because the sprite actually grows before vanishing
    const s0 = this.scaleX;
    this.scene.tweens.add({
      targets: this,
      scaleX: s0 * 1.6,
      scaleY: s0 * 1.6,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.easeOut',
      onComplete: () => this.setVisible(false),
    });
    // Drop scales with ship area (scale²) so a visibly bigger ship spills
    // a visibly bigger cloud. Capped by actual ore so a late-game giant
    // doesn't spawn thousands of pellets at once (perf + readability).
    return Math.min(this.ore, Math.floor(s0 * s0 * 10));
  }

  _spawnDeathFx() {
    const scene = this.scene;
    const x = this.x, y = this.y;
    const R = SHIP.radius * (this.scaleX || 1);

    // debris burst — a big cone of accent-tinted sparks
    const burst = scene.add.particles(x, y, 'spark', {
      speed: { min: 120, max: 320 },
      lifespan: { min: 420, max: 780 },
      quantity: 0,
      scale: { start: 1.4, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: 'ADD',
      tint: this.accentColor,
      emitting: false,
    });
    burst.setDepth(6);
    burst.explode(42);
    scene.time.delayedCall(900, () => burst.destroy());

    // white-hot flash core — short, additive, fades fast
    const flash = scene.add.graphics();
    flash.setDepth(7);
    flash.fillStyle(0xffffff, 0.9);
    flash.fillCircle(x, y, R * 1.2);
    flash.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 140,
      onComplete: () => flash.destroy(),
    });

    // expanding shockwave ring — thick, cubic-ease out
    const ring = scene.add.graphics();
    ring.setDepth(5);
    const state = { r: R * 0.6, a: 0.9, w: 4 };
    scene.tweens.add({
      targets: state,
      r: R * 6,
      a: 0,
      w: 1,
      duration: 520,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        ring.clear();
        ring.lineStyle(state.w, this.accentColor, state.a);
        ring.strokeCircle(x, y, state.r);
      },
      onComplete: () => ring.destroy(),
    });
  }

  // ore → tier: hand-tuned stops to T5, then doubles forever (no cap)
  //   T0 <80, T1 >=80, T2 >=200, T3 >=400, T4 >=800, T5 >=1500,
  //   T6 >=3000, T7 >=6000, T8 >=12000, ...
  get tier() {
    const o = this.ore;
    if (o < 80) return 0;
    if (o < 200) return 1;
    if (o < 400) return 2;
    if (o < 800) return 3;
    if (o < 1500) return 4;
    return 5 + Math.floor(Math.log2(o / 1500));
  }

  setController(ctrl) {
    this.controller = ctrl;
    return this;
  }

  _applyGrowthVisuals() {
    // smooth sqrt curve; divisor=18 is ~5× the original rate so the ship
    // visibly fattens within the first handful of pickups. No cap — the
    // curve tapers naturally (sqrt) but the ship keeps getting bigger forever.
    const target = 1 + Math.sqrt(Math.max(0, this.ore)) / 18;

    // Ease toward the target instead of snapping. A per-pickup scale jump
    // triggers setScale → Phaser re-derives body bounds mid-motion → the ship
    // visibly hiccups. Lerping spreads each jump over ~8 frames which reads
    // as smooth growth and removes the jitter entirely.
    const current = this._lastScaleApplied > 0 ? this._lastScaleApplied : target;
    const smoothed = current + (target - current) * 0.15;
    // Skip setScale when we're within a tiny epsilon so we don't do a write
    // every frame when sitting idle.
    if (Math.abs(smoothed - current) > 0.0005) {
      this._lastScaleApplied = smoothed;
      this.setScale(smoothed);
    } else if (this._lastScaleApplied < 0) {
      // first-ever tick: snap to target so spawning doesn't animate in
      this._lastScaleApplied = target;
      this.setScale(target);
    }
  }

  tick(dt) {
    if (!this.alive || !this.controller) {
      if (!this.alive) {
        this.thrustFx.emitting = false;
        this.boostFx.emitting = false;
      }
      this._applyGrowthVisuals();
      return;
    }
    this._applyGrowthVisuals();
    const intent = this.controller.update(this, null, dt);

    // smooth rotate toward intent heading
    const delta = Phaser.Math.Angle.Wrap(intent.heading - this.heading);
    const step = SHIP.turnRate * dt;
    this.heading += Phaser.Math.Clamp(delta, -step, step);
    this.rotation = this.heading + Math.PI / 2;

    // fuel / speed
    const hasFuel = this.fuel > 0;
    const boosting = intent.boost && hasFuel;
    const speed = hasFuel ? (boosting ? SHIP.boostSpeed : SHIP.baseSpeed) : SHIP.baseSpeed * 0.3;
    this.setVelocity(Math.cos(this.heading) * speed, Math.sin(this.heading) * speed);

    this.fuel = Math.max(0, this.fuel - (boosting ? this.stats.boostDrain : SHIP.fuelDrain) * dt);
    // spawn thrust particles behind the hull, not at center — followOffset is
    // world-space, so rotate the offset with the current heading each frame
    const rearDist = SHIP.radius * (this.scaleX || 1) + 2;
    for (const fx of [this.thrustFx, this.boostFx]) {
      fx.followOffset.x = -Math.cos(this.heading) * rearDist;
      fx.followOffset.y = -Math.sin(this.heading) * rearDist;
    }
    this.boostFx.emitting = boosting;
    if (this.isPlayer && boosting && !this._wasBoosting) Audio.playBoostStart();
    this._wasBoosting = boosting;

    if (this.fuel <= 0 && this.isPlayer) {
      this.alive = false;
      this.scene.onPlayerOutOfFuel?.();
    }
  }

  drawLaser(targetMeteor) {
    this.laserGfx.clear();
    if (!targetMeteor) return;
    const color = this.accentColor;
    const g = this.laserGfx;
    // beam runs nose → rock surface (not rock center) so the impact point
    // matches the hit flash GameScene spawns at the meteor's edge
    const ang = Math.atan2(targetMeteor.y - this.y, targetMeteor.x - this.x);
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const nose = SHIP.radius * 0.6 * (this.scaleX || 1);
    const sx = this.x + cos * nose, sy = this.y + sin * nose;
    const ex = targetMeteor.x - cos * targetMeteor.radius * 0.85;
    const ey = targetMeteor.y - sin * targetMeteor.radius * 0.85;
    // per-frame width flicker makes the beam feel energized
    const f = 0.8 + Math.random() * 0.4;
    g.lineStyle(11 * f, color, 0.1);
    g.lineBetween(sx, sy, ex, ey);
    g.lineStyle(5 * f, color, 0.35);
    g.lineBetween(sx, sy, ex, ey);
    g.lineStyle(1.6, 0xffffff, 0.9);
    g.lineBetween(sx, sy, ex, ey);
    g.fillStyle(color, 0.35);
    g.fillCircle(ex, ey, 7 * f);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(ex, ey, 2.5 * f);
    g.fillStyle(color, 0.5);
    g.fillCircle(sx, sy, 3 * f);
  }

  addOre(amount) {
    this.ore += amount;
    this.fuel = Math.min(this.stats.fuelMax, this.fuel + amount * SHIP.fuelPerOre);
  }

  destroy(fromScene) {
    this.thrustFx?.destroy();
    this.boostFx?.destroy();
    this.laserGfx?.destroy();
    super.destroy(fromScene);
  }
}
