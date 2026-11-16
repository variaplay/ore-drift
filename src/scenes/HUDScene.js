import { WORLD, COLORS } from '../config.js';
import { Audio } from '../util/audio.js';

const MINIMAP = {
  size: 140,
  margin: 16,
  bgAlpha: 0.55,
  borderColor: 0x3a4a78,
  bgColor: 0x0a0f1f,
};

const LEADERBOARD = {
  width: 170,
  margin: 16,
  rowHeight: 18,
  headerHeight: 22,
  padX: 10,
  bgAlpha: 0.55,
  bgColor: 0x0a0f1f,
  borderColor: 0x3a4a78,
  maxRows: 10,
};

const FUEL_GAUGE = {
  x: 16,
  y: 16,
  width: 246,
  height: 46,
  segments: 24,
  segW: 6,
  segGap: 2,
  barH: 10,
  barX: 40,       // bar left edge, relative to the panel
  barY: 25,
  bgColor: 0x0a0f1f,
  bgAlpha: 0.55,
  borderColor: 0x3a4a78,
  emptyColor: 0x16203a,
  full: 0x7df9ff,
  mid: 0xffc04d,
  low: 0xff5a6a,
};

const SUMMARY = {
  width: 340,
  height: 290,
  bgColor: 0x081126,
  borderColor: 0xffd66b,
  padX: 28,
};

export class HUDScene extends Phaser.Scene {
  constructor() { super('HUD'); }

  create(data) {
    this.player = data.player;
    this.gameScene = this.scene.get('Game');
    const style = { fontFamily: 'ui-monospace, monospace', fontSize: '14px', color: '#cfe4ff' };

    // screen-edge vignette (added first so it sits under every HUD element);
    // a second red copy pulses in as fuel runs out
    this.vignette = this.add.image(0, 0, 'vignette').setOrigin(0).setTint(0x000000).setAlpha(0.8);
    this.fuelVignette = this.add.image(0, 0, 'vignette').setOrigin(0).setTint(0xff2a3a).setAlpha(0);

    // player ore count lives in the leaderboard (row "YOU"); top-left is
    // just the fuel gauge now
    this._buildFuelGauge();

    this.msg = this.add.text(0, 0, '', { ...style, fontSize: '20px', color: '#ffd66b' })
      .setOrigin(0.5).setVisible(false);

    this._buildMinimap();
    this._buildLeaderboard();
    this._buildSummaryPanel();
    this._lowFuelNextBeep = 0;
    // M key still toggles mute; the on-screen label was removed by request
    this.input.keyboard.on('keydown-M', () => Audio.toggleMute());

    this.scale.on('resize', () => {
      this._layoutVignette();
      this._layoutMsg();
      this._layoutMinimap();
      this._layoutLeaderboard();
      this._layoutSummaryPanel();
    });
    this._layoutVignette();
    this._layoutMsg();
    this._layoutMinimap();
    this._layoutLeaderboard();
    this._layoutSummaryPanel();

    this.gameScene.events.on('player-dead', (reason) => {
      this._showRunSummary(reason);
    });
    this.gameScene.events.on('mother-spawned', () => this._showToast('MOTHER METEOR DETECTED'));
    this.input.on('pointerdown', () => {
      if (!this.player.alive) {
        const playerName = this.gameScene.playerName;
        const playerDesignKey = this.gameScene.playerDesignKey;
        const aiCount = this.gameScene.aiCount;
        const playerUpgrades = this.gameScene.playerUpgrades;
        this.scene.stop('HUD');
        this.scene.stop('Game');
        this.scene.start('Game', { playerName, playerDesignKey, aiCount, playerUpgrades });
      }
    });

    this.paused = false;
    this.input.keyboard.on('keydown-ESC', () => this._togglePause());

    // debug: backtick (`) grants 500 ore for quick tier/size testing
    this.input.keyboard.on('keydown-BACKTICK', () => {
      if (!this.player?.alive) return;
      this.player.addOre(500);
      this._showToast('DEBUG +500 ORE');
    });
  }

  _togglePause() {
    // don't let pause stomp the death-restart prompt
    if (!this.player.alive) return;
    if (this.paused) {
      this.scene.resume('Game');
      this.msg.setVisible(false);
      this.paused = false;
    } else {
      this.scene.pause('Game');
      this._showMessage('PAUSED — press ESC to resume');
      this.paused = true;
    }
  }

  _buildMinimap() {
    // container lets us reposition the whole minimap on resize with one call
    this.minimap = this.add.container(0, 0);

    const r = MINIMAP.size / 2;
    this.minimapBg = this.add.circle(r, r, r, MINIMAP.bgColor, MINIMAP.bgAlpha)
      .setStrokeStyle(1, MINIMAP.borderColor, 0.9);
    this.minimapDots = this.add.graphics();
    this.minimapViewport = this.add.graphics();
    this.minimapPlayer = this.add.graphics();

    this.minimap.add([this.minimapBg, this.minimapDots, this.minimapViewport, this.minimapPlayer]);

    // geometry mask clips dots/viewport/player to the circular bg.
    // Mask graphics live outside the container because geometry masks ignore
    // parent transforms — we move the mask manually in _layoutMinimap.
    this.minimapMaskGfx = this.make.graphics({ x: 0, y: 0, add: false });
    this.minimapMaskGfx.fillStyle(0xffffff);
    this.minimapMaskGfx.fillCircle(0, 0, r);
    const mask = this.minimapMaskGfx.createGeometryMask();
    this.minimapDots.setMask(mask);
    this.minimapViewport.setMask(mask);
    this.minimapPlayer.setMask(mask);
  }

  _layoutMinimap() {
    const cam = this.cameras.main;
    const x = cam.width - MINIMAP.size - MINIMAP.margin;
    const y = cam.height - MINIMAP.size - MINIMAP.margin;
    this.minimap.setPosition(x, y);
    // keep the mask aligned with the circular bg (bg is offset by r inside the container)
    const r = MINIMAP.size / 2;
    this.minimapMaskGfx.setPosition(x + r, y + r);
  }

  _layoutVignette() {
    const cam = this.cameras.main;
    this.vignette.setDisplaySize(cam.width, cam.height);
    this.fuelVignette.setDisplaySize(cam.width, cam.height);
  }

  _layoutMsg() {
    const cam = this.cameras.main;
    this.msg.setPosition(cam.width / 2, cam.height / 2);
  }

  _buildSummaryPanel() {
    this.summary = this.add.container(0, 0).setDepth(50).setVisible(false);
    this.summaryBg = this.add.rectangle(0, 0, SUMMARY.width, SUMMARY.height, SUMMARY.bgColor, 0.9)
      .setOrigin(0.5)
      .setStrokeStyle(2, SUMMARY.borderColor, 0.95);
    this.summaryGlow = this.add.rectangle(0, 0, SUMMARY.width + 12, SUMMARY.height + 12, SUMMARY.borderColor, 0.08)
      .setOrigin(0.5);
    this.summaryTitle = this.add.text(0, -104, 'RUN COMPLETE', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#ffd66b',
      letterSpacing: 2,
    }).setOrigin(0.5);
    this.summaryCause = this.add.text(0, -76, '', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '12px',
      color: '#8ea1c7',
      letterSpacing: 2,
    }).setOrigin(0.5);

    this.summaryRows = [];
    const labelStyle = { fontFamily: 'ui-monospace, monospace', fontSize: '14px', color: '#8ea1c7' };
    const valueStyle = { fontFamily: 'ui-monospace, monospace', fontSize: '14px', color: '#cfe4ff', fontStyle: 'bold' };
    for (let i = 0; i < 6; i++) {
      const y = -40 + i * 24;
      const label = this.add.text(-SUMMARY.width / 2 + SUMMARY.padX, y, '', labelStyle).setOrigin(0, 0.5);
      const value = this.add.text(SUMMARY.width / 2 - SUMMARY.padX, y, '', valueStyle).setOrigin(1, 0.5);
      this.summaryRows.push({ label, value });
    }

    this.summaryRestart = this.add.text(0, 108, 'TAP TO LAUNCH AGAIN', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#7df9ff',
      letterSpacing: 2,
    }).setOrigin(0.5);
    this.summaryShop = this.add.text(0, 130, 'SHOP', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#ffd66b',
      letterSpacing: 2,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.summaryShop.on('pointerdown', (_pointer, _lx, _ly, event) => {
      event?.stopPropagation?.();
      this._returnToTitle();
    });

    this.summary.add([
      this.summaryGlow,
      this.summaryBg,
      this.summaryTitle,
      this.summaryCause,
      ...this.summaryRows.flatMap((r) => [r.label, r.value]),
      this.summaryRestart,
      this.summaryShop,
    ]);
  }

  _returnToTitle() {
    const playerName = this.gameScene.playerName;
    const playerDesignKey = this.gameScene.playerDesignKey;
    const aiCount = this.gameScene.aiCount;
    this.scene.stop('HUD');
    this.scene.stop('Game');
    this.scene.start('Title', { playerName, playerDesignKey, aiCount });
  }

  _layoutSummaryPanel() {
    const cam = this.cameras.main;
    this.summary.setPosition(cam.width / 2, cam.height / 2);
    this._summaryScale = Math.min(1, (cam.width - 24) / SUMMARY.width, (cam.height - 24) / SUMMARY.height);
    this.summary.setScale(this._summaryScale);
  }

  _buildFuelGauge() {
    const G = FUEL_GAUGE;
    this.fuelPanel = this.add.graphics();
    this.fuelPanel.fillStyle(G.bgColor, G.bgAlpha);
    this.fuelPanel.fillRoundedRect(G.x, G.y, G.width, G.height, 6);
    this.fuelPanel.lineStyle(1, G.borderColor, 0.9);
    this.fuelPanel.strokeRoundedRect(G.x + 0.5, G.y + 0.5, G.width - 1, G.height - 1, 6);
    // redrawn every frame: icon, segments, damage trail, shimmer
    this.fuelGfx = this.add.graphics();
    this.fuelLabel = this.add.text(G.x + G.barX, G.y + 8, 'FUEL', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '10px',
      fontStyle: 'bold',
      color: '#8ea1c7',
      letterSpacing: 2,
    });
    this.fuelValue = this.add.text(G.x + G.width - 12, G.y + 7, '', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '11px',
      fontStyle: 'bold',
      color: '#cfe4ff',
    }).setOrigin(1, 0);
    // "ghost" level trails behind real fuel so sudden losses (rams into
    // rocks) show up as a white chunk that drains away
    this._fuelGhost = 1;
    this._fuelPrev = 1;
    this._fuelGhostHoldUntil = 0;
    this._fuelFlashUntil = 0;
  }

  _fuelColor(pct) {
    // cyan → amber across 50%..25%, amber → red below that
    const G = FUEL_GAUGE;
    // manual RGB mix — Phaser's Interpolate.ColorWithColor has produced
    // NaN tints before (see Meteor.damage)
    const lerp = (a, b, t) => {
      const ch = (shift) => {
        const ca = (a >> shift) & 0xff, cb = (b >> shift) & 0xff;
        return Math.round(ca + (cb - ca) * t) << shift;
      };
      return ch(16) | ch(8) | ch(0);
    };
    if (pct >= 0.5) return G.full;
    if (pct >= 0.25) return lerp(G.mid, G.full, (pct - 0.25) / 0.25);
    return lerp(G.low, G.mid, Math.max(0, pct) / 0.25);
  }

  _drawFuelGauge(time, dt, pct) {
    const G = FUEL_GAUGE;
    const g = this.fuelGfx;
    g.clear();

    // trailing ghost: hold briefly after a sharp drop, then chase down
    if (pct >= this._fuelGhost) {
      this._fuelGhost = pct;
    } else {
      if (this._fuelPrev - pct > 0.015) this._fuelGhostHoldUntil = time + 450;
      if (time > this._fuelGhostHoldUntil) this._fuelGhost = Math.max(pct, this._fuelGhost - dt * 0.35);
    }
    if (pct > this._fuelPrev + 0.001) this._fuelFlashUntil = time + 160;
    this._fuelPrev = pct;

    const low = pct < 0.25 && this.player.alive;
    const blink = low ? 0.55 + 0.45 * Math.sin(time / (pct < 0.12 ? 70 : 130)) : 1;
    const flash = time < this._fuelFlashUntil ? 0.4 : 0;
    const base = this._fuelColor(pct);
    const lighten = (c, t) => {
      const r = (c >> 16) & 0xff, gg = (c >> 8) & 0xff, b = c & 0xff;
      return (Math.round(r + (255 - r) * t) << 16) | (Math.round(gg + (255 - gg) * t) << 8) | Math.round(b + (255 - b) * t);
    };
    const color = lighten(base, flash);
    const hi = lighten(base, 0.55);

    // fuel-can icon in the current gauge color
    const ix = G.x + 13, iy = G.y + 13;
    g.fillStyle(color, blink);
    g.fillRect(ix + 2, iy + 4, 14, 16);    // body
    g.fillRect(ix + 5, iy + 1, 6, 3);      // cap
    g.fillRect(ix + 12, iy + 1, 4, 2);     // handle
    g.fillRect(ix + 14, iy + 1, 2, 5);
    g.fillStyle(G.bgColor, 1);
    g.fillRect(ix + 5, iy + 8, 8, 2);      // label band
    g.fillRect(ix + 5, iy + 13, 8, 2);
    g.fillStyle(0xffffff, 0.35 * blink);
    g.fillRect(ix + 3, iy + 5, 1, 14);     // lit edge

    // segments: filled, partial, ghost (recent loss), empty
    const bx = G.x + G.barX, by = G.y + G.barY;
    const step = G.segW + G.segGap;
    const barW = G.segments * step - G.segGap;
    // soft glow behind the filled run
    const fillW = barW * pct;
    if (fillW > 0) {
      g.fillStyle(base, 0.12 * blink);
      g.fillRect(bx - 3, by - 3, fillW + 6, G.barH + 6);
    }
    for (let i = 0; i < G.segments; i++) {
      const sx = bx + i * step;
      const s0 = i / G.segments, s1 = (i + 1) / G.segments;
      g.fillStyle(G.emptyColor, 1);
      g.fillRect(sx, by, G.segW, G.barH);
      // ghost part of this segment
      const gf = Phaser.Math.Clamp((this._fuelGhost - s0) / (s1 - s0), 0, 1);
      if (gf > 0) {
        g.fillStyle(0xffffff, 0.55);
        g.fillRect(sx, by, G.segW * gf, G.barH);
      }
      const f = Phaser.Math.Clamp((pct - s0) / (s1 - s0), 0, 1);
      if (f <= 0) continue;
      const w = Math.max(1, Math.round(G.segW * f));
      g.fillStyle(color, blink);
      g.fillRect(sx, by, w, G.barH);
      g.fillStyle(hi, blink);
      g.fillRect(sx, by, w, 2);                     // top highlight
      g.fillStyle(0x000000, 0.25);
      g.fillRect(sx, by + G.barH - 2, w, 2);        // bottom shade
    }

    // boost shimmer: a bright band sweeping along the filled run
    if (this.player._wasBoosting && this.player.alive && fillW > 8) {
      const t = (time % 600) / 600;
      const sx = bx + t * fillW - 6;
      g.fillStyle(0xffffff, 0.4);
      g.fillRect(Math.max(bx, sx), by, Math.min(12, bx + fillW - Math.max(bx, sx)), G.barH);
    }

    this.fuelLabel.setText(low ? 'LOW FUEL' : 'FUEL');
    this.fuelLabel.setColor(low ? '#ff8a96' : '#8ea1c7');
    this.fuelLabel.setAlpha(low ? blink : 1);
    this.fuelValue.setText(`${Math.ceil(pct * 100)}%`);
    this.fuelValue.setColor('#' + base.toString(16).padStart(6, '0'));
  }

  update(time, deltaMs = 16) {
    if (!this.player) return;
    const pct = Phaser.Math.Clamp(this.player.fuel / this.player.stats.fuelMax, 0, 1);
    this._drawFuelGauge(time, deltaMs / 1000, pct);
    if (this.player.alive && pct < 0.25 && time > this._lowFuelNextBeep) {
      Audio.playLowFuel();
      // blip faster as fuel gets more critical
      this._lowFuelNextBeep = time + (pct < 0.12 ? 380 : 700);
    }
    const danger = this.player.alive ? Phaser.Math.Clamp((0.25 - pct) / 0.25, 0, 1) : 0;
    this.fuelVignette.setAlpha(danger * (0.5 + 0.3 * Math.sin(time / (pct < 0.12 ? 90 : 160))));
    this._drawMinimap(time);
    this._drawLeaderboard();
  }

  _drawMinimap(time) {
    const s = MINIMAP.size;
    const scale = s / WORLD.size; // world px → minimap px
    // mask clips anything outside the circle, so no need to clamp
    const toMap = (wx, wy) => [wx * scale + s / 2, wy * scale + s / 2];

    // dots layer — meteors/ore/NPCs
    const g = this.minimapDots;
    g.clear();

    // meteors: tiny specks for normal, brighter squares for crystals,
    // a pulsing amber ring for the mother meteor event
    for (const m of this.gameScene.meteors.getChildren()) {
      if (!m.active) continue;
      const [mx, my] = toMap(m.x, m.y);
      if (m.tier === 'mother') {
        const pulse = 0.5 + 0.5 * Math.sin(time / 200);
        g.fillStyle(COLORS.mother, 0.4 + pulse * 0.4);
        g.fillCircle(mx, my, 4 + pulse * 2);
        g.lineStyle(1, COLORS.motherHot, 0.9);
        g.strokeCircle(mx, my, 4.5 + pulse * 2);
      } else if (m.tier === 'crystal') {
        g.fillStyle(COLORS.crystal, 1);
        g.fillRect(mx - 1.5, my - 1.5, 3, 3);
      } else {
        g.fillStyle(COLORS.meteor, 0.55);
        g.fillRect(mx - 0.5, my - 0.5, 1.5, 1.5);
      }
    }

    // ore: the thing the player actually wants to find
    g.fillStyle(COLORS.ore, 1);
    for (const o of this.gameScene.ores.getChildren()) {
      if (!o.active) continue;
      const [ox, oy] = toMap(o.x, o.y);
      g.fillRect(ox - 1, oy - 1, 2, 2);
    }

    // death clouds: recent kill sites get a pulsing ring so they read as
    // scavenging opportunities instead of just another loose ore cluster.
    for (const cloud of this.gameScene.deathClouds || []) {
      const [dx, dy] = toMap(cloud.x, cloud.y);
      const age = Math.max(0, time - cloud.bornAt);
      const life = Math.max(1, cloud.expiresAt - cloud.bornAt);
      const fade = 1 - Phaser.Math.Clamp(age / life, 0, 1);
      const pulse = 0.5 + 0.5 * Math.sin(time / 140);
      g.lineStyle(1.5, cloud.color ?? COLORS.ore, fade * (0.45 + pulse * 0.45));
      g.strokeCircle(dx, dy, 5 + pulse * 3);
      g.fillStyle(COLORS.ore, fade * 0.75);
      g.fillCircle(dx, dy, 2);
    }

    // NPC ships: each in its own hull color so players can pick them apart
    for (const ship of this.gameScene.ships) {
      if (ship === this.player || !ship.alive) continue;
      const [sx, sy] = toMap(ship.x, ship.y);
      g.fillStyle(ship.accentColor ?? COLORS.hullNpc, 1);
      g.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    }

    // current camera viewport as a faint rectangle
    const cam = this.gameScene.cameras.main;
    const vw = cam.width / cam.zoom * scale;
    const vh = cam.height / cam.zoom * scale;
    const [cx, cy] = toMap(cam.midPoint.x, cam.midPoint.y);
    const vp = this.minimapViewport;
    vp.clear();
    vp.lineStyle(1, 0x8ea1c7, 0.5);
    vp.strokeRect(cx - vw / 2, cy - vh / 2, vw, vh);

    // player: pulsing cyan dot on top
    const p = this.minimapPlayer;
    p.clear();
    if (this.player.alive) {
      const [px, py] = toMap(this.player.x, this.player.y);
      const pulse = 0.5 + 0.5 * Math.sin(time / 180);
      p.fillStyle(COLORS.hullPlayer, 0.35);
      p.fillCircle(px, py, 4 + pulse * 2);
      p.fillStyle(COLORS.hullPlayer, 1);
      p.fillCircle(px, py, 2.5);
    }
  }

  _buildLeaderboard() {
    const ships = this.gameScene.ships;
    // top N rows + (if more ships exist) one extra slot for the player when
    // their rank falls outside the top N
    const topN = LEADERBOARD.maxRows;
    this._youSlotIdx = ships.length > topN ? topN : -1; // -1 = no separate row
    const rowCount = ships.length > topN ? topN + 1 : ships.length;
    const height = LEADERBOARD.headerHeight + rowCount * LEADERBOARD.rowHeight + 8;

    // assign stable display names so AI labels don't reshuffle as ranks change;
    // the player's name may already be set from the title screen
    let aiN = 0;
    for (const ship of ships) {
      if (ship.displayName) continue;
      ship.displayName = ship.isPlayer ? 'YOU' : `AI-${++aiN}`;
    }

    this.leaderboard = this.add.container(0, 0);
    this.leaderboardBg = this.add.rectangle(0, 0, LEADERBOARD.width, height, LEADERBOARD.bgColor, LEADERBOARD.bgAlpha)
      .setOrigin(0, 0)
      .setStrokeStyle(1, LEADERBOARD.borderColor, 0.9);

    const headerStyle = { fontFamily: 'ui-monospace, monospace', fontSize: '12px', color: '#8ea1c7' };
    this.leaderboardHeader = this.add.text(LEADERBOARD.padX, 6, 'LEADERBOARD', headerStyle);

    this.leaderboard.add([this.leaderboardBg, this.leaderboardHeader]);

    this.leaderboardRows = [];
    const rowStyle = { fontFamily: 'ui-monospace, monospace', fontSize: '13px', color: '#cfe4ff' };
    for (let i = 0; i < rowCount; i++) {
      const y = LEADERBOARD.headerHeight + i * LEADERBOARD.rowHeight;
      const name = this.add.text(LEADERBOARD.padX, y, '', rowStyle);
      const value = this.add.text(LEADERBOARD.width - LEADERBOARD.padX, y, '', rowStyle).setOrigin(1, 0);
      this.leaderboardRows.push({ name, value });
      this.leaderboard.add([name, value]);
    }

    // faint separator above the reserved "YOU" row
    if (this._youSlotIdx >= 0) {
      const sepY = LEADERBOARD.headerHeight + this._youSlotIdx * LEADERBOARD.rowHeight;
      const sep = this.add.rectangle(
        LEADERBOARD.padX, sepY - 2,
        LEADERBOARD.width - 2 * LEADERBOARD.padX, 1,
        LEADERBOARD.borderColor, 0.6,
      ).setOrigin(0, 0);
      this.leaderboard.add(sep);
    }
  }

  _layoutLeaderboard() {
    const cam = this.cameras.main;
    const x = cam.width - LEADERBOARD.width - LEADERBOARD.margin;
    this.leaderboard.setPosition(x, LEADERBOARD.margin);
  }

  _drawLeaderboard() {
    // alive ships ranked by ore desc; dead ships sink to the bottom keeping their last order
    const ranked = [...this.gameScene.ships].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.ore - a.ore;
    });

    const topN = LEADERBOARD.maxRows;
    let rank = 1;
    // fill the top N rows (or fewer if there are fewer ships)
    for (let i = 0; i < topN; i++) {
      const row = this.leaderboardRows[i];
      if (!row) break;
      const ship = ranked[i];
      if (!ship) {
        row.name.setText('');
        row.value.setText('');
        continue;
      }
      const prefix = ship.alive ? `${rank++}.` : ' x';
      row.name.setText(`${prefix} ${ship.displayName}`);
      row.value.setText(String(ship.ore));
      this._applyRowColor(row, ship);
    }

    // reserved "YOU" row when the player is below the top N
    if (this._youSlotIdx >= 0) {
      const row = this.leaderboardRows[this._youSlotIdx];
      const playerIdx = ranked.indexOf(this.player);
      if (playerIdx >= topN) {
        // since alive ships sort before dead, playerIdx == playerRank-1 when alive
        const pRank = this.player.alive ? playerIdx + 1 : null;
        const prefix = this.player.alive ? `${pRank}.` : ' x';
        row.name.setText(`${prefix} ${this.player.displayName}`);
        row.value.setText(String(this.player.ore));
        this._applyRowColor(row, this.player);
      } else {
        // player is already shown in the top N — leave the slot blank
        row.name.setText('');
        row.value.setText('');
      }
    }
  }

  _applyRowColor(row, ship) {
    const color = !ship.alive
      ? '#6b7490'
      : '#' + (ship.accentColor ?? 0xcfe4ff).toString(16).padStart(6, '0');
    row.name.setColor(color);
    row.value.setColor(color);
  }

  _showMessage(text) {
    this.msg.setText(text).setVisible(true);
  }

  _showRunSummary(reason) {
    const stats = this.gameScene.runStats || {};
    this.msg.setVisible(false);
    this.summaryCause.setText(reason === 'ram' ? 'HULL BREACHED' : 'OUT OF FUEL');

    const rows = [
      ['TIME', this._formatTime(stats.survivedMs || 0)],
      ['RANK', stats.finalRank ? `#${stats.finalRank}` : '-'],
      ['ORE BANKED', String(stats.finalOre ?? this.player.ore ?? 0)],
      ['BANK EARNED', String(stats.persistentOreEarned ?? 0)],
      ['ORE SCOOPED', String(stats.oreCollected ?? 0)],
      ['METEORS CRACKED', String(stats.meteorsShattered ?? 0)],
    ];
    for (let i = 0; i < this.summaryRows.length; i++) {
      const row = this.summaryRows[i];
      const data = rows[i];
      row.label.setText(data?.[0] || '');
      row.value.setText(data?.[1] || '');
    }
    this.summary.setVisible(true);
    this.summary.setAlpha(0);
    const scale = this._summaryScale || 1;
    this.summary.setScale(scale * 0.96);
    this.tweens.add({
      targets: this.summary,
      alpha: 1,
      scale,
      duration: 180,
      ease: 'Cubic.easeOut',
    });
  }

  _formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }

  _showToast(text) {
    // transient banner near the top of the screen — used for events like the
    // mother meteor spawn so we don't hijack the center "game over" slot
    if (this._toast) this._toast.destroy();
    const cam = this.cameras.main;
    this._toast = this.add.text(cam.width / 2, 70, text, {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '16px',
      fontStyle: 'bold',
      color: '#ff9248',
      stroke: '#05060c',
      strokeThickness: 4,
      letterSpacing: 3,
    }).setOrigin(0.5);
    this._toast.setAlpha(0);
    this.tweens.add({
      targets: this._toast,
      alpha: 1,
      duration: 180,
      yoyo: true,
      hold: 1200,
      onComplete: () => { this._toast?.destroy(); this._toast = null; },
    });
  }
}
