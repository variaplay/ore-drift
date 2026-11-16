import { WORLD, SHIP, METEOR, MOTHER_METEOR, NPC, NPC_PALETTE, COLORS } from '../config.js';
import { Ship } from '../entities/Ship.js';
import { Meteor } from '../entities/Meteor.js';
import { Ore } from '../entities/Ore.js';
import { LocalInputController } from '../controllers/LocalInputController.js';
import { NpcController, NPC_PERSONALITIES, npcPersonalityByIndex } from '../controllers/NpcController.js';
import { makePlaceholderTextures, SHIP_DESIGNS } from '../util/placeholderArt.js';
import { Nebula, addStarfield } from '../util/backdrop.js';
import { Audio } from '../util/audio.js';
import { addOreBank, loadUpgrades, playerStatMultipliers } from '../util/progression.js';

const DEATH_CLOUD = {
  radiusBase: 80,
  radiusPerScale: 22,
  flingSpeedMin: 90,
  flingSpeedMax: 190,
  lifetime: 16000,
  markerLifetime: 6500,
  tint: 0xfff0a8,
};

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
    this.playerDesignKey = data.playerDesignKey || this.playerDesignKey || SHIP_DESIGNS[0].key;
    this.playerUpgrades = data.playerUpgrades || loadUpgrades();
    // aiCount is chosen on the title screen; fall back to the config default
    // if the scene was started without one (e.g. dev hot-restart).
    this.aiCount = Number.isFinite(data.aiCount)
      ? data.aiCount
      : (Number.isFinite(this.aiCount) ? this.aiCount : NPC.count);
    Audio.attachToPhaser(this);
    this.physics.world.setBounds(-WORLD.size / 2, -WORLD.size / 2, WORLD.size, WORLD.size);
    this.cameras.main.setBackgroundColor('#05060c');

    this.nebula = new Nebula(this);
    this._drawStarfield();
    this._drawBoundary();
    this._createFx();
    this._setupPostFx();

    this.meteors = this.physics.add.group({ classType: Meteor });
    this.ores = this.physics.add.group({ classType: Ore });
    this.ships = [];
    // music keeps playing across restarts (HUD restarts this scene directly,
    // skipping Title's startMusic call); startMusic is a no-op if running
    Audio.setMusicIntensity(0.5);
    Audio.startMusic();
    // scene restarts reuse this instance, so swap listeners instead of stacking
    this.events.off('pause', this._onPause, this);
    this.events.on('pause', this._onPause, this);
    this.events.once('shutdown', () => Audio.stopLoops());
    this.deathClouds = [];
    this._npcSerial = 0;
    this.runStats = {
      startedAt: this.time.now,
      survivedMs: 0,
      oreCollected: 0,
      meteorsShattered: 0,
      crystalsShattered: 0,
      motherMeteorsShattered: 0,
      rivalsDestroyed: 0,
      deathReason: null,
    };

    this._spawnMeteors();
    this._spawnPlayer();
    this._spawnNpcs();
    // first mother meteor is a bit after game start so players get oriented
    this._nextMotherAt = this.time.now + MOTHER_METEOR.firstSpawnMs;

    // collisions
    this.physics.add.collider(this.meteors, this.meteors);
    this.physics.add.overlap(this.ships, this.ores, (ship, ore) => {
      if (!ship.alive) return;
      // brief no-pickup window after a collision so the ship doesn't instantly
      // re-absorb the ore it just dropped
      if (ship._noPickupUntil && this.time.now < ship._noPickupUntil) return;
      ship.addOre(ore.value);
      if (ship.isPlayer) {
        this.runStats.oreCollected += ore.value;
        Audio.playPickup();
        this.pickupFx.emitParticleAt(ore.x, ore.y, 2);
      }
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
    if (this.player?.alive) this.runStats.survivedMs = this.time.now - this.runStats.startedAt;
    const cam = this.cameras.main;
    this.nebula.update(cam.scrollX, cam.scrollY, _time);
    // ease the camera out a touch while boosting — sells the speed and
    // shows a little more of what's ahead
    const targetZoom = this.player?.alive && this.player._wasBoosting ? 0.92 : 1;
    cam.setZoom(cam.zoom + (targetZoom - cam.zoom) * Math.min(1, dt * 3));
    Audio.setEngine(!!this.player?.alive, !!this.player?._wasBoosting);
    let playerMining = false;

    // drive all ships through their controllers
    for (const ship of this.ships) ship.tick(dt);

    // keep everything inside the circular world boundary
    for (const ship of this.ships) this._clampToWorld(ship, SHIP.radius);
    for (const m of this.meteors.getChildren()) {
      if (!m.active) continue;
      m.wander();
      m.updateVisuals?.(_time);
      this._clampToWorld(m, m.radius || 0);
    }

    // lasers + mining — each ship auto-fires at nearest meteor in range
    for (const ship of this.ships) {
      if (!ship.alive) { ship.drawLaser(null); continue; }
      const target = this._nearestMeteor(ship, SHIP.laserRange);
      ship.laserTarget = target;
      ship.drawLaser(target);
      if (target) {
        const dead = target.damage((ship.stats?.laserDps ?? SHIP.laserDps) * dt);
        // visible impact flash at the meteor edge facing the shooting ship,
        // throttled so it reads as punctuated "chunks flying" not a lightshow
        ship._lastImpactFxAt = ship._lastImpactFxAt || 0;
        if (_time - ship._lastImpactFxAt > 80) {
          ship._lastImpactFxAt = _time;
          this._spawnLaserImpactFx(target, ship);
        }
        if (ship.isPlayer) playerMining = true;
        if (dead) {
          const { pan, vol } = this._spatial(target.x, target.y, 650);
          if (ship.isPlayer || vol > 0) {
            const opts = { pan, vol: ship.isPlayer ? 1 : vol };
            if (target.tier === 'crystal') Audio.playCrystalShatter(opts);
            else if (target.tier !== 'mother') {
              const size = Phaser.Math.Clamp((target.radius - METEOR.minR) / (METEOR.maxR - METEOR.minR), 0, 1);
              Audio.playShatter({ ...opts, size });
            }
          }
          this._shatterMeteor(target, ship);
        }
      }
    }
    Audio.setLaser(playerMining && this.player.alive);

    // ship-vs-ship ram detection: pairwise circle test each frame
    this._resolveShipRams();

    // ore magnet + cleanup
    for (const ore of this.ores.getChildren()) ore.tickMagnet(this.ships);
    this._cleanupDeathClouds();

    // keep meteor pool topped up
    if (this.meteors.countActive(true) < METEOR.count * 0.7) this._spawnMeteors(10);

    // scheduled mother meteor event — at most one alive at a time
    if (this.time.now >= this._nextMotherAt && !this._hasMotherMeteor()) {
      this._spawnMotherMeteor();
      this._nextMotherAt = this.time.now + Phaser.Math.Between(
        MOTHER_METEOR.spawnIntervalMsMin,
        MOTHER_METEOR.spawnIntervalMsMax,
      );
    }
  }

  _hasMotherMeteor() {
    for (const m of this.meteors.getChildren()) {
      if (m.active && m.tier === 'mother') return true;
    }
    return false;
  }

  _spawnMotherMeteor() {
    // drop it on the outer ring at a random angle and nudge it inward so it
    // drifts across the map (players see a "thing" approaching)
    const angle = Math.random() * Math.PI * 2;
    const dist = WORLD.size * MOTHER_METEOR.edgeDistanceFrac;
    const x = Math.cos(angle) * dist;
    const y = Math.sin(angle) * dist;
    const m = new Meteor(this, x, y, MOTHER_METEOR.radius, { tier: 'mother' });
    // subtle inward drift so the mother visibly moves toward the center
    m.setVelocity(-Math.cos(angle) * 30, -Math.sin(angle) * 30);
    this.meteors.add(m);
    Audio.playMotherIncoming?.();
    Audio.setMusicIntensity(1);
    this.events.emit('mother-spawned');
  }

  // ---------- spawns ----------

  _spawnPlayer() {
    const design = SHIP_DESIGNS.find((d) => d.key === this.playerDesignKey) || SHIP_DESIGNS[0];
    this.player = new Ship(this, 0, 0, {
      isPlayer: true,
      designKey: design.key,
      accentColor: design.accent,
      statMultipliers: playerStatMultipliers(this.playerUpgrades),
    });
    this.player.displayName = this.playerName;
    this.player.setController(new LocalInputController(this));
    this.ships.push(this.player);
  }

  _spawnNpcs() {
    // shuffle palette indices so color assignment isn't always the same order
    const indices = Array.from({ length: NPC_PALETTE.length }, (_, i) => i);
    Phaser.Utils.Array.Shuffle(indices);
    for (let i = 0; i < this.aiCount; i++) {
      const colorIndex = indices[i % indices.length];
      this._spawnNpc(colorIndex, npcPersonalityByIndex(i));
    }
  }

  _spawnNpc(colorIndex, personalityKey = 'miner', displayName = null) {
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
    // random silhouette per NPC so the field reads as a mix of rival classes,
    // not five arrows. Color is still assigned per palette entry.
    const design = SHIP_DESIGNS[Phaser.Math.Between(0, SHIP_DESIGNS.length - 1)];
    const npc = new Ship(this, x, y, {
      isPlayer: false,
      colorIndex,
      designKey: design.key,
      accentColor: palette.accent,
    });
    const key = NPC_PERSONALITIES[personalityKey] ? personalityKey : 'miner';
    const profile = NPC_PERSONALITIES[key];
    npc.personalityKey = key;
    npc.displayName = displayName || `${profile.label}-${++this._npcSerial}`;
    npc.setController(new NpcController(this, key));
    this.ships.push(npc);
    return npc;
  }

  _spawnLaserImpactFx(meteor, ship) {
    // contact point: the meteor's edge facing the shooting ship
    const ang = Math.atan2(ship.y - meteor.y, ship.x - meteor.x);
    const ix = meteor.x + Math.cos(ang) * meteor.radius;
    const iy = meteor.y + Math.sin(ang) * meteor.radius;
    const color = ship.accentColor;

    // expanding ring flash — quick, small, additive
    const flash = this.add.graphics();
    flash.setDepth(6);
    flash.setBlendMode(Phaser.BlendModes.ADD);
    const state = { r: 3, a: 0.9, w: 2.5 };
    this.tweens.add({
      targets: state,
      r: 14,
      a: 0,
      w: 0.5,
      duration: 220,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        flash.clear();
        flash.fillStyle(color, state.a * 0.35);
        flash.fillCircle(ix, iy, state.r);
        flash.lineStyle(state.w, color, state.a);
        flash.strokeCircle(ix, iy, state.r);
      },
      onComplete: () => flash.destroy(),
    });

    // spark tendrils — two short accent-colored streaks in random directions
    for (let i = 0; i < 2; i++) {
      const t = this.add.graphics();
      t.setDepth(6);
      t.setBlendMode(Phaser.BlendModes.ADD);
      const a = ang + Math.PI + (Math.random() - 0.5) * 1.2;
      const len = 14 + Math.random() * 14;
      const dx = Math.cos(a) * len;
      const dy = Math.sin(a) * len;
      t.lineStyle(2, color, 1);
      t.lineBetween(ix, iy, ix + dx, iy + dy);
      this.tweens.add({
        targets: t,
        alpha: 0,
        duration: 180,
        ease: 'Quad.easeOut',
        onComplete: () => t.destroy(),
      });
    }
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

        // Head-rams only. aDot/bDot is cos(angle between ship's facing and
        // contact normal), i.e. *where on this ship's hull the contact is*:
        //   1.0 → straight on the nose
        //   0.0 → a side-graze at 90°
        //  −1.0 → on the back of the hull (rammed from behind)
        // A ship only dies if contact is within its forward "head" cone —
        // otherwise the player would die just for clipping someone tangentially.
        // cos(53°) ≈ 0.6 → ~106° head cone, which matches the nose area of
        // the sprite visually. Sidewipes and rear collisions pass through.
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len, uy = dy / len;
        const aFx = Math.cos(a.heading), aFy = Math.sin(a.heading);
        const bFx = Math.cos(b.heading), bFy = Math.sin(b.heading);

        const aDot = aFx * ux + aFy * uy;       // A's facing vs A→B
        const bDot = bFx * -ux + bFy * -uy;     // B's facing vs B→A
        const HEAD = 0.6;
        if (aDot > HEAD) this._killShip(a, b);
        if (bDot > HEAD) this._killShip(b, a);
        // No tangential tie-breaker — if both ships' noses are pointed away
        // from the contact, the collision is a side-brush and nobody dies.
        if (!a.alive) break;
      }
    }
  }

  _killShip(ship, killer = null) {
    const dropped = ship.die();
    this._spawnDeathCloud(ship, dropped);
    // optional-chain guard: if the player's browser has a stale cached
    // audio.js from before this method existed, don't crash the game loop
    const { pan, vol } = this._spatial(ship.x, ship.y, 1100);
    Audio.playExplosion?.({ pan, vol: ship.isPlayer ? 1 : Math.max(0.15, vol) });
    // shake the camera proportional to proximity — bigger nearby deaths feel weightier
    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, ship.x, ship.y);
    const near = Phaser.Math.Clamp(1 - d / 700, 0, 1);
    if (near > 0) this.cameras.main.shake(260, 0.005 + near * 0.015);

    if (ship.isPlayer) {
      Audio.playDeath();
      Audio.stopMusic();
      Audio.stopLoops();
      this.cameras.main.shake(500, 0.025);
      this.cameras.main.flash(220, 255, 120, 140);
      this._finalizeRunStats('ram');
      this.events.emit('player-dead', 'ram');
      return;
    }
    if (killer?.isPlayer) this.runStats.rivalsDestroyed++;
    // NPC — remove from active list and respawn after a pause
    const idx = this.ships.indexOf(ship);
    if (idx >= 0) this.ships.splice(idx, 1);
    const colorIndex = ship.colorIndex;
    const displayName = ship.displayName;
    const personalityKey = ship.personalityKey;
    this.time.delayedCall(2500, () => {
      if (!this.scene.isActive()) return;
      this._spawnNpc(colorIndex, personalityKey, displayName);
    });
    ship.destroy();
  }

  _spawnDeathCloud(ship, dropped) {
    if (dropped <= 0) return;
    const scale = ship.scaleX || 1;
    const count = dropped;
    const radius = DEATH_CLOUD.radiusBase + scale * DEATH_CLOUD.radiusPerScale;
    const marker = {
      x: ship.x,
      y: ship.y,
      bornAt: this.time.now,
      expiresAt: this.time.now + DEATH_CLOUD.markerLifetime,
      value: count,
      color: ship.accentColor ?? DEATH_CLOUD.tint,
    };
    this.deathClouds.push(marker);

    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.35, 0.35);
      const r = Phaser.Math.FloatBetween(radius * 0.25, radius);
      const x = ship.x + Math.cos(a) * r * 0.25;
      const y = ship.y + Math.sin(a) * r * 0.25;
      const ore = new Ore(this, x, y, 1, a, {
        deathCloud: true,
        flingSpeedMin: DEATH_CLOUD.flingSpeedMin,
        flingSpeedMax: DEATH_CLOUD.flingSpeedMax,
        lifetime: DEATH_CLOUD.lifetime,
        tint: DEATH_CLOUD.tint,
        scale: 1.15,
      });
      ore.body.velocity.x += Math.cos(a) * r;
      ore.body.velocity.y += Math.sin(a) * r;
      this.ores.add(ore);
    }

    this._drawDeathCloudMarker(marker, radius);
    this.events.emit('death-cloud-spawned', marker);
  }

  _drawDeathCloudMarker(marker, radius) {
    const g = this.add.graphics();
    g.setDepth(4);
    g.setBlendMode(Phaser.BlendModes.ADD);
    const state = { r: radius * 0.35, a: 0.7, w: 4 };
    this.tweens.add({
      targets: state,
      r: radius,
      a: 0,
      w: 1,
      duration: 900,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        g.clear();
        g.lineStyle(state.w, marker.color, state.a);
        g.strokeCircle(marker.x, marker.y, state.r);
        g.lineStyle(1, DEATH_CLOUD.tint, state.a * 0.7);
        g.strokeCircle(marker.x, marker.y, state.r * 0.62);
      },
      onComplete: () => g.destroy(),
    });
  }

  _cleanupDeathClouds() {
    const now = this.time.now;
    if (!this.deathClouds.length) return;
    this.deathClouds = this.deathClouds.filter((cloud) => cloud.expiresAt > now);
  }

  _spawnMeteors(count = METEOR.count) {
    for (let i = 0; i < count; i++) {
      let x = 0, y = 0;
      // retry until the position is outside the player's current viewport
      // (plus a margin) so nothing visibly pops in. Unrestricted fallback
      // after a few attempts in case the player is near the arena edge.
      // Power-biased radial sampling: u^2 concentrates spawns near center,
      // tapering off toward the edge. A plain uniform `r` already gives
      // 1/r areal density (center-heavy) but the player wanted the contrast
      // sharper, so squaring the sample makes the edge visibly sparse.
      const rMin = WORLD.size * 0.04;
      const rMax = WORLD.size * 0.49;
      for (let attempt = 0; attempt < 12; attempt++) {
        const a = Math.random() * Math.PI * 2;
        const u = Math.random();
        const r = rMin + (rMax - rMin) * (u * u);
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
    if (miner?.isPlayer) {
      this.runStats.meteorsShattered++;
      if (meteor.tier === 'crystal') this.runStats.crystalsShattered++;
      if (meteor.tier === 'mother') this.runStats.motherMeteorsShattered++;
    }
    // Bias the ore spray toward the ship that shattered the meteor so
    // chunks drift toward the miner instead of flying off in random
    // directions — makes catching much less fiddly.
    const toward = miner ? Math.atan2(miner.y - meteor.y, miner.x - meteor.x) : null;
    const yield_ = meteor.oreYield();
    const R = meteor.radius;
    this._spawnShatterFx(meteor, miner);
    for (let i = 0; i < yield_; i++) {
      // spawn across the meteor's disk (sqrt for uniform area distribution)
      // so chunks are visually distinct instead of piling up at the center
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * R * 0.9;
      const sx = meteor.x + Math.cos(ang) * rr;
      const sy = meteor.y + Math.sin(ang) * rr;
      this.ores.add(new Ore(this, sx, sy, 1, toward));
    }
    if (meteor.tier === 'mother') {
      // mother shatters into a ring of mid-sized fragments flying outward,
      // turning the event into a scramble for the pieces
      const N = MOTHER_METEOR.fragmentCount;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + Math.random() * 0.25;
        const off = meteor.radius * 0.35;
        const fx = meteor.x + Math.cos(a) * off;
        const fy = meteor.y + Math.sin(a) * off;
        const fr = Phaser.Math.Between(MOTHER_METEOR.fragmentRadiusMin, MOTHER_METEOR.fragmentRadiusMax);
        const frag = new Meteor(this, fx, fy, fr, { tier: 'normal' });
        frag.setVelocity(Math.cos(a) * MOTHER_METEOR.fragmentOutwardSpeed,
                         Math.sin(a) * MOTHER_METEOR.fragmentOutwardSpeed);
        this.meteors.add(frag);
      }
      // big punchy kaboom for the event
      Audio.playExplosion?.(this._spatial(meteor.x, meteor.y, 1400));
      Audio.setMusicIntensity(0.5);
      this.cameras.main.shake(320, 0.012);
    } else if (meteor.radius > METEOR.minR * 2) {
      // normal/crystal: spawn a single smaller fragment
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
    // circular edge of the playable world — ships can't cross this. Layered
    // strokes read as a soft energy barrier rather than a plain line.
    const g = this.add.graphics();
    g.setDepth(-6);
    g.setBlendMode(Phaser.BlendModes.ADD);
    const R = WORLD.size / 2;
    g.lineStyle(40, 0x3a4a78, 0.05);
    g.strokeCircle(0, 0, R + 14);
    g.lineStyle(14, 0x4a64b0, 0.12);
    g.strokeCircle(0, 0, R + 4);
    g.lineStyle(2, 0x7f9cff, 0.7);
    g.strokeCircle(0, 0, R);
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
    // three parallax layers of tinted stars + twinkling bright ones
    const half = WORLD.size / 2;
    addStarfield(this, { layers: WORLD.starLayers, halfW: half, halfH: half, twinkles: 220 });
  }

  _setupPostFx() {
    // Soft bloom makes lasers, thrust and glowing rocks actually glow.
    // Desktop WebGL only — it's a full-screen multi-pass blur that costs
    // too much on low-end phones.
    const cam = this.cameras.main;
    if (this.renderer.type !== Phaser.WEBGL || !cam.postFX) return;
    if (!this.sys.game.device.os.desktop) return;
    this._bloom = cam.postFX.addBloom(0xffffff, 1, 1, 1.1, 0.9, 4);
  }

  _createFx() {
    // pooled emitters reused for every shatter / pickup — cheaper than
    // spinning up a new emitter per event
    this.debrisFx = this.add.particles(0, 0, 'chunk', {
      emitting: false,
      speed: { min: 40, max: 170 },
      lifespan: { min: 500, max: 1100 },
      scale: { start: 1.6, end: 0.4 },
      rotate: { min: 0, max: 360 },
      alpha: { start: 1, end: 0 },
    }).setDepth(6);
    this.dustFx = this.add.particles(0, 0, 'glow', {
      emitting: false,
      speed: { min: 8, max: 45 },
      lifespan: { min: 600, max: 1000 },
      scale: { start: 0.6, end: 1.8 },
      alpha: { start: 0.28, end: 0 },
      blendMode: 'ADD',
    }).setDepth(5);
    this.shardFx = this.add.particles(0, 0, 'spark', {
      emitting: false,
      speed: { min: 80, max: 240 },
      lifespan: { min: 300, max: 650 },
      scale: { start: 1.3, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: 'ADD',
    }).setDepth(6);
    this.pickupFx = this.add.particles(0, 0, 'glow', {
      emitting: false,
      speed: { min: 20, max: 70 },
      lifespan: 280,
      scale: { start: 0.35, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: COLORS.ore,
      blendMode: 'ADD',
    }).setDepth(6);
  }

  _spawnShatterFx(meteor, miner) {
    const { x, y, radius: R } = meteor;
    const tint = meteor._baseTint();
    const big = R / 32;
    this.debrisFx.setParticleTint(tint);
    this.debrisFx.explode(Math.round(8 + big * 14), x, y);
    this.dustFx.setParticleTint(tint);
    this.dustFx.explode(Math.round(4 + big * 6), x, y);
    if (meteor.tier !== 'normal') {
      this.shardFx.setParticleTint(meteor._hotTint());
      this.shardFx.explode(meteor.tier === 'mother' ? 60 : 24, x, y);
    }

    // bright flash + expanding ring at the break point
    const g = this.add.graphics().setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
    const state = { r: R * 0.5, a: 1 };
    this.tweens.add({
      targets: state,
      r: R * 1.8,
      a: 0,
      duration: 360,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        g.clear();
        g.fillStyle(0xffffff, state.a * 0.25);
        g.fillCircle(x, y, state.r * 0.6);
        g.lineStyle(3 * state.a + 1, tint, state.a * 0.8);
        g.strokeCircle(x, y, state.r);
      },
      onComplete: () => g.destroy(),
    });

    // tiny kick when the player breaks a rock on screen — scaled by size
    if (miner?.isPlayer && meteor.tier !== 'mother') {
      this.cameras.main.shake(90, 0.0015 + big * 0.002);
    }
  }

  // stereo pan + distance falloff for a world-space sound source
  _spatial(x, y, range) {
    if (!this.player) return { pan: 0, vol: 1 };
    const dx = x - this.player.x;
    const d = Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y);
    return {
      pan: Phaser.Math.Clamp(dx / 600, -0.8, 0.8),
      vol: Phaser.Math.Clamp(1 - d / range, 0, 1),
    };
  }

  _onPause() {
    Audio.stopLoops();
  }

  onPlayerOutOfFuel() {
    Audio.playDeath();
    Audio.stopMusic();
    Audio.stopLoops();
    this._finalizeRunStats('fuel');
    this.events.emit('player-dead', 'fuel');
  }

  _finalizeRunStats(reason) {
    if (this.runStats.deathReason) return this.runStats;
    this.runStats.deathReason = reason;
    this.runStats.survivedMs = this.time.now - this.runStats.startedAt;
    this.runStats.finalOre = this.player?.ore ?? 0;
    this.runStats.finalRank = this._playerRank();
    this.runStats.persistentOreEarned = Math.max(0, Math.floor(this.runStats.finalOre));
    this.runStats.oreBank = addOreBank(this.runStats.persistentOreEarned);
    return this.runStats;
  }

  _playerRank() {
    if (!this.player) return null;
    const ranked = [...this.ships].sort((a, b) => b.ore - a.ore);
    const idx = ranked.indexOf(this.player);
    return idx >= 0 ? idx + 1 : null;
  }
}
