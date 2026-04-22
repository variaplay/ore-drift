import { WORLD, SHIP, METEOR, NPC, NPC_PALETTE, COLORS } from '../config.js';
import { Ship } from '../entities/Ship.js';
import { Meteor } from '../entities/Meteor.js';
import { Ore } from '../entities/Ore.js';
import { LocalInputController } from '../controllers/LocalInputController.js';
import { NpcController } from '../controllers/NpcController.js';
import { makePlaceholderTextures } from '../util/placeholderArt.js';
import { Audio } from '../util/audio.js';

export class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  preload() {
    // Placeholder retro sprites generated at runtime so the project runs with
    // zero assets. Replace by dropping real PixelLab PNGs into /assets/sprites
    // and switching this to this.load.image('ship_player', 'assets/sprites/ship_player.png') etc.
    makePlaceholderTextures(this, NPC_PALETTE);
  }

  create(data = {}) {
    this.playerName = data.playerName || this.playerName || 'PILOT';
    Audio.attachToPhaser(this);
    this.physics.world.setBounds(-WORLD.size / 2, -WORLD.size / 2, WORLD.size, WORLD.size);
    this.cameras.main.setBackgroundColor('#05060c');

    this._drawStarfield();
    this._drawBoundary();

    this.meteors = this.physics.add.group({ classType: Meteor });
    this.ores = this.physics.add.group({ classType: Ore });
    this.ships = [];

    this._spawnMeteors();
    this._spawnPlayer();
    this._spawnNpcs();

    // collisions
    this.physics.add.collider(this.meteors, this.meteors);
    this.physics.add.overlap(this.ships, this.ores, (ship, ore) => {
      if (!ship.alive) return;
      // brief no-pickup window after a collision so the ship doesn't instantly
      // re-absorb the ore it just dropped
      if (ship._noPickupUntil && this.time.now < ship._noPickupUntil) return;
      ship.addOre(ore.value);
      if (ship.isPlayer) Audio.playPickup();
      ore.destroy();
    });
    // ship-vs-ship ram detection runs manually each frame in update() —
    // physics.add.overlap on a mutating array (NPCs respawn) is unreliable.

    this.physics.add.collider(this.ships, this.meteors, (ship, meteor) => {
      // hard hits cost fuel AND spill ore — higher-tier ships are bigger
      // targets and leak more, giving trailers a natural catch-up current
      const v = Math.hypot(ship.body.velocity.x, ship.body.velocity.y);
      if (v <= SHIP.baseSpeed * 0.9) return;
      ship.fuel = Math.max(0, ship.fuel - 4);
      const now = this.time.now;
      if ((ship._noPickupUntil || 0) > now) return; // already spilled recently
      if (ship.ore <= 0) return;
      const dropAmt = Math.min(ship.ore, Math.max(1, Math.floor(ship.ore * 0.08) + ship.tier * 2));
      ship.ore -= dropAmt;
      for (let i = 0; i < dropAmt; i++) this.ores.add(new Ore(this, ship.x, ship.y, 1, null));
      ship._noPickupUntil = now + 1200;
    });

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.setZoom(1);

    this.scene.launch('HUD', { player: this.player });

    // resize handling
    this.scale.on('resize', (size) => {
      this.cameras.main.setSize(size.width, size.height);
    });
  }

  update(_time, deltaMs) {
    const dt = deltaMs / 1000;

    // drive all ships through their controllers
    for (const ship of this.ships) ship.tick(dt);

    // keep everything inside the circular world boundary
    for (const ship of this.ships) this._clampToWorld(ship, SHIP.radius);
    for (const m of this.meteors.getChildren()) {
      if (!m.active) continue;
      m.wander();
      this._clampToWorld(m, m.radius || 0);
    }

    // lasers + mining — each ship auto-fires at nearest meteor in range
    for (const ship of this.ships) {
      if (!ship.alive) { ship.drawLaser(null); continue; }
      const target = this._nearestMeteor(ship, SHIP.laserRange);
      ship.laserTarget = target;
      ship.drawLaser(target);
      if (target) {
        const dead = target.damage(SHIP.laserDps * dt);
        // player-only laser crackle, rate-limited so it doesn't become a drone
        if (ship.isPlayer) {
          this._lastLaserTick = this._lastLaserTick || 0;
          if (_time - this._lastLaserTick > 90) {
            Audio.playLaserTick();
            this._lastLaserTick = _time;
          }
        }
        if (dead) {
          if (ship.isPlayer || Phaser.Math.Distance.Squared(this.player.x, this.player.y, target.x, target.y) < 500 * 500) {
            Audio.playShatter();
          }
          this._shatterMeteor(target, ship);
        }
      }
    }

    // ship-vs-ship ram detection: pairwise circle test each frame
    this._resolveShipRams();

    // ore magnet + cleanup
    for (const ore of this.ores.getChildren()) ore.tickMagnet(this.ships);

    // keep meteor pool topped up
    if (this.meteors.countActive(true) < METEOR.count * 0.7) this._spawnMeteors(10);
  }

  // ---------- spawns ----------

  _spawnPlayer() {
    this.player = new Ship(this, 0, 0, { isPlayer: true });
    this.player.displayName = this.playerName;
    this.player.setController(new LocalInputController(this));
    this.ships.push(this.player);
  }

  _spawnNpcs() {
    // shuffle palette indices so color assignment isn't always the same order
    const indices = Array.from({ length: NPC_PALETTE.length }, (_, i) => i);
    Phaser.Utils.Array.Shuffle(indices);
    for (let i = 0; i < NPC.count; i++) {
      const colorIndex = indices[i % indices.length];
      this._spawnNpc(colorIndex);
    }
  }

  _spawnNpc(colorIndex) {
    const palette = NPC_PALETTE[colorIndex];
    // spawn off-screen so the player never sees an NPC materialize in view
    let x = 0, y = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = Phaser.Math.Between(500, WORLD.size * 0.4);
      x = Math.cos(a) * r;
      y = Math.sin(a) * r;
      if (!this._isVisibleToPlayer(x, y, 220)) break;
    }
    const npc = new Ship(this, x, y, {
      isPlayer: false,
      colorIndex,
      accentColor: palette.accent,
    });
    npc.setController(new NpcController(this));
    this.ships.push(npc);
    return npc;
  }

  _resolveShipRams() {
    // iterate a snapshot — _killShip removes NPCs from this.ships, which
    // would shift indices mid-loop otherwise
    const ships = this.ships.slice();
    for (let i = 0; i < ships.length; i++) {
      const a = ships[i];
      if (!a.alive || a.isInvulnerable()) continue;
      const ra = SHIP.radius * (a.scaleX || 1);
      for (let j = i + 1; j < ships.length; j++) {
        const b = ships[j];
        if (!b.alive || b.isInvulnerable()) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const rb = SHIP.radius * (b.scaleX || 1);
        // small expansion so visible touch always counts as contact
        const rSum = (ra + rb) * 1.05;
        if (dx * dx + dy * dy > rSum * rSum) continue;

        // decide who rammed: "any forward-half-plane contact is a head-ram".
        // dot > 0 means the other ship is in the ship's forward hemisphere,
        // i.e. the collision happened on this ship's nose side (not butt).
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len, uy = dy / len;
        const aFx = Math.cos(a.heading), aFy = Math.sin(a.heading);
        const bFx = Math.cos(b.heading), bFy = Math.sin(b.heading);

        const aDot = aFx * ux + aFy * uy;       // A's facing vs A→B
        const bDot = bFx * -ux + bFy * -uy;     // B's facing vs B→A
        const aRams = aDot > 0;
        const bRams = bDot > 0;

        // tie-breaker for rare tangential cases: if neither is clearly a
        // head-ram, the one with a *higher* dot still dies — otherwise the
        // pair would clip with no consequence.
        if (!aRams && !bRams) {
          if (aDot >= bDot) this._killShip(a);
          else this._killShip(b);
        } else {
          if (aRams) this._killShip(a);
          if (bRams) this._killShip(b);
        }
        if (!a.alive) break;
      }
    }
  }

  _killShip(ship) {
    const dropped = ship.die();
    // scatter the dead ship's ore as free-floating pickups
    for (let i = 0; i < dropped; i++) this.ores.add(new Ore(this, ship.x, ship.y, 1, null));
    Audio.playExplosion();
    // shake the camera proportional to proximity — bigger nearby deaths feel weightier
    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, ship.x, ship.y);
    const near = Phaser.Math.Clamp(1 - d / 700, 0, 1);
    if (near > 0) this.cameras.main.shake(260, 0.005 + near * 0.015);

    if (ship.isPlayer) {
      Audio.playDeath();
      Audio.stopMusic();
      this.cameras.main.shake(500, 0.025);
      this.cameras.main.flash(220, 255, 120, 140);
      this.events.emit('player-dead', 'ram');
      return;
    }
    // NPC — remove from active list and respawn after a pause
    const idx = this.ships.indexOf(ship);
    if (idx >= 0) this.ships.splice(idx, 1);
    const colorIndex = ship.colorIndex;
    const displayName = ship.displayName;
    this.time.delayedCall(2500, () => {
      if (!this.scene.isActive()) return;
      const revived = this._spawnNpc(colorIndex);
      if (displayName) revived.displayName = displayName;
    });
    ship.destroy();
  }

  _spawnMeteors(count = METEOR.count) {
    for (let i = 0; i < count; i++) {
      let x = 0, y = 0;
      // retry until the position is outside the player's current viewport
      // (plus a margin) so nothing visibly pops in. Unrestricted fallback
      // after a few attempts in case the player is near the arena edge.
      for (let attempt = 0; attempt < 12; attempt++) {
        const a = Math.random() * Math.PI * 2;
        const r = Phaser.Math.FloatBetween(WORLD.size * 0.08, WORLD.size * 0.48);
        x = Math.cos(a) * r;
        y = Math.sin(a) * r;
        if (!this._isVisibleToPlayer(x, y, 180)) break;
      }
      const radius = Phaser.Math.Between(METEOR.minR, METEOR.maxR);
      const tier = this._rollTier();
      this.meteors.add(new Meteor(this, x, y, radius, { tier }));
    }
  }

  _isVisibleToPlayer(x, y, margin = 0) {
    const cam = this.cameras.main;
    if (!cam) return false;
    const halfW = cam.width / (2 * cam.zoom) + margin;
    const halfH = cam.height / (2 * cam.zoom) + margin;
    return Math.abs(x - cam.midPoint.x) < halfW && Math.abs(y - cam.midPoint.y) < halfH;
  }

  _rollTier() {
    return Math.random() < METEOR.crystalChance ? 'crystal' : 'normal';
  }

  _shatterMeteor(meteor, miner = null) {
    // Bias the ore spray toward the ship that shattered the meteor so
    // chunks drift toward the miner instead of flying off in random
    // directions — makes catching much less fiddly.
    const toward = miner ? Math.atan2(miner.y - meteor.y, miner.x - meteor.x) : null;
    const yield_ = meteor.oreYield();
    for (let i = 0; i < yield_; i++) this.ores.add(new Ore(this, meteor.x, meteor.y, 1, toward));
    // if large, spawn a smaller fragment
    if (meteor.radius > METEOR.minR * 2) {
      const frag = new Meteor(this, meteor.x, meteor.y, Math.max(METEOR.minR, meteor.radius * 0.55));
      this.meteors.add(frag);
    }
    meteor.destroy();
  }

  _nearestMeteor(ship, maxRange) {
    let best = null;
    let bd2 = maxRange * maxRange;
    for (const m of this.meteors.getChildren()) {
      if (!m.active || m.hp <= 0) continue;
      const d2 = Phaser.Math.Distance.Squared(ship.x, ship.y, m.x, m.y);
      if (d2 < bd2) { bd2 = d2; best = m; }
    }
    return best;
  }

  _drawBoundary() {
    // circular edge of the playable world — ships can't cross this
    const g = this.add.graphics();
    g.setDepth(-6);
    g.lineStyle(2, 0x3a4a78, 0.7);
    g.strokeCircle(0, 0, WORLD.size / 2);
    g.lineStyle(10, 0x3a4a78, 0.12);
    g.strokeCircle(0, 0, WORLD.size / 2);
  }

  _clampToWorld(obj, bodyRadius = 0) {
    const R = WORLD.size / 2 - bodyRadius;
    const d2 = obj.x * obj.x + obj.y * obj.y;
    if (d2 <= R * R) return;
    const d = Math.sqrt(d2) || 1;
    const nx = obj.x / d;
    const ny = obj.y / d;
    obj.x = nx * R;
    obj.y = ny * R;
    // cancel outward radial velocity so the body doesn't keep trying to escape
    // (for meteors this also makes them appear to bounce along the edge)
    if (obj.body) {
      const vr = obj.body.velocity.x * nx + obj.body.velocity.y * ny;
      if (vr > 0) {
        obj.body.velocity.x -= vr * nx;
        obj.body.velocity.y -= vr * ny;
      }
    }
  }

  _drawStarfield() {
    // three parallax layers of static stars
    const { size } = WORLD;
    for (let layer = 0; layer < WORLD.starLayers; layer++) {
      const g = this.add.graphics();
      g.setDepth(-10 + layer);
      g.fillStyle(COLORS.star, 0.3 + layer * 0.2);
      const count = 200 - layer * 50;
      for (let i = 0; i < count; i++) {
        const x = Phaser.Math.Between(-size / 2, size / 2);
        const y = Phaser.Math.Between(-size / 2, size / 2);
        g.fillRect(x, y, 1 + layer, 1 + layer);
      }
      g.setScrollFactor(0.3 + layer * 0.2);
    }
  }

  onPlayerOutOfFuel() {
    Audio.playDeath();
    Audio.stopMusic();
    this.events.emit('player-dead', 'fuel');
  }
}
