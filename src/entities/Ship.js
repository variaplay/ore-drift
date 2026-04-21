import { SHIP, COLORS } from '../config.js';
import { Audio } from '../util/audio.js';

// Single ship class used for both player and NPCs.
// Steering intent comes from a Controller — the ship itself doesn't know
// whether it's driven by a human, AI, or (later) a remote network peer.
export class Ship extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, { isPlayer = false, colorIndex = null, accentColor = null } = {}) {
    // per-NPC-color texture if available; fall back to the shared ship_npc
    const tex = isPlayer
      ? 'ship_player'
      : (colorIndex != null && scene.textures.exists(`ship_npc_${colorIndex}`))
        ? `ship_npc_${colorIndex}`
        : 'ship_npc';
    super(scene, x, y, tex);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.isPlayer = isPlayer;
    this.colorIndex = colorIndex;
    // color used for thrust particles & laser — accent if provided, else legacy default
    this.accentColor = isPlayer
      ? COLORS.laserPlayer
      : (accentColor ?? COLORS.laserNpc);
    this.heading = -Math.PI / 2;
    this.fuel = SHIP.fuelMax;
    this.ore = 0;
    this.alive = true;
    this.controller = null;
    this.laserTarget = null;

    this.setCircle(SHIP.radius, 16 - SHIP.radius, 16 - SHIP.radius);
    this.setDamping(true);
    this.setDrag(0.02);
    this.setMaxVelocity(SHIP.boostSpeed);

    // thrust particles tinted to this ship's accent color
    this.thrustFx = scene.add.particles(0, 0, 'spark', {
      follow: this,
      speed: { min: 40, max: 90 },
      lifespan: 260,
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.8, end: 0 },
      blendMode: 'ADD',
      tint: this.accentColor,
      frequency: 40,
      emitting: false,
    });

    this.laserGfx = scene.add.graphics();
    this.laserGfx.setDepth(5);

    this._appliedTier = -1;
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

  _applyTierVisuals() {
    const t = this.tier;
    if (t === this._appliedTier) return;
    this._appliedTier = t;
    // visual scale caps at T10 so the ship doesn't become comical at T20+,
    // but the gameplay tier itself keeps growing
    const vt = Math.min(t, 10);
    const scale = 1 + vt * 0.05;
    this.setScale(scale);
    // resize the circular collision body to match the visible ship so
    // higher-tier ships really are easier to hit (a key catch-up lever)
    const r = SHIP.radius * scale;
    const off = 16 - r;
    this.body.setCircle(r, off, off);
  }

  tick(dt) {
    if (!this.alive || !this.controller) return;
    this._applyTierVisuals();
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

    this.fuel = Math.max(0, this.fuel - (boosting ? SHIP.boostDrain : SHIP.fuelDrain) * dt);
    this.thrustFx.emitting = boosting;
    this.thrustFx.frequency = boosting ? 18 : 40;
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
    this.laserGfx.lineStyle(2, color, 0.85);
    this.laserGfx.lineBetween(this.x, this.y, targetMeteor.x, targetMeteor.y);
    this.laserGfx.lineStyle(6, color, 0.2);
    this.laserGfx.lineBetween(this.x, this.y, targetMeteor.x, targetMeteor.y);
  }

  addOre(amount) {
    this.ore += amount;
    this.fuel = Math.min(SHIP.fuelMax, this.fuel + amount * SHIP.fuelPerOre);
  }

  destroy(fromScene) {
    this.thrustFx?.destroy();
    this.laserGfx?.destroy();
    super.destroy(fromScene);
  }
}
