import { SHIP, COLORS } from '../config.js';
import { Audio } from '../util/audio.js';

// Single ship class used for both player and NPCs.
// Steering intent comes from a Controller — the ship itself doesn't know
// whether it's driven by a human, AI, or (later) a remote network peer.
export class Ship extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, { isPlayer = false } = {}) {
    const tex = isPlayer ? 'ship_player' : 'ship_npc';
    super(scene, x, y, tex);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.isPlayer = isPlayer;
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

    // thrust particles
    this.thrustFx = scene.add.particles(0, 0, 'spark', {
      follow: this,
      speed: { min: 40, max: 90 },
      lifespan: 260,
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.8, end: 0 },
      blendMode: 'ADD',
      tint: isPlayer ? COLORS.laserPlayer : COLORS.laserNpc,
      frequency: 40,
      emitting: false,
    });

    this.laserGfx = scene.add.graphics();
    this.laserGfx.setDepth(5);
  }

  setController(ctrl) {
    this.controller = ctrl;
    return this;
  }

  tick(dt) {
    if (!this.alive || !this.controller) return;
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
    const color = this.isPlayer ? COLORS.laserPlayer : COLORS.laserNpc;
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
