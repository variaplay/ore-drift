import { SHIP, WORLD, COLORS } from '../config.js';
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

    // player ore count lives in the leaderboard (row "YOU"); top-left is
    // just the fuel bar now
    this.fuelLabel = this.add.text(16, 16, 'FUEL', style);
    this.fuelBarBg = this.add.rectangle(66, 26, 160, 10, 0x1a2340).setOrigin(0, 0.5);
    this.fuelBar = this.add.rectangle(66, 26, 160, 10, 0x7df9ff).setOrigin(0, 0.5);

    this.msg = this.add.text(0, 0, '', { ...style, fontSize: '20px', color: '#ffd66b' })
      .setOrigin(0.5).setVisible(false);

    this._buildMinimap();
    this._buildLeaderboard();
    this._buildSummaryPanel();
    this._lowFuelNextBeep = 0;
    // M key still toggles mute; the on-screen label was removed by request
    this.input.keyboard.on('keydown-M', () => Audio.toggleMute());

    this.scale.on('resize', () => {
      this._layoutMsg();
      this._layoutMinimap();
      this._layoutLeaderboard();
      this._layoutSummaryPanel();
    });
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
        this.scene.stop('HUD');
        this.scene.stop('Game');
        this.scene.start('Game', { playerName, playerDesignKey, aiCount });
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

    this.summaryRestart = this.add.text(0, 116, 'TAP TO LAUNCH AGAIN', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#7df9ff',
      letterSpacing: 2,
    }).setOrigin(0.5);

    this.summary.add([
      this.summaryGlow,
      this.summaryBg,
      this.summaryTitle,
      this.summaryCause,
      ...this.summaryRows.flatMap((r) => [r.label, r.value]),
      this.summaryRestart,
    ]);
  }

  _layoutSummaryPanel() {
    const cam = this.cameras.main;
    this.summary.setPosition(cam.width / 2, cam.height / 2);
    this._summaryScale = Math.min(1, (cam.width - 24) / SUMMARY.width, (cam.height - 24) / SUMMARY.height);
    this.summary.setScale(this._summaryScale);
  }

  update(time) {
    if (!this.player) return;
    const pct = Phaser.Math.Clamp(this.player.fuel / SHIP.fuelMax, 0, 1);
    this.fuelBar.width = 160 * pct;
    this.fuelBar.fillColor = pct < 0.25 ? 0xff6b7b : 0x7df9ff;
    if (this.player.alive && pct < 0.25 && time > this._lowFuelNextBeep) {
      Audio.playLowFuel();
      // blip faster as fuel gets more critical
      this._lowFuelNextBeep = time + (pct < 0.12 ? 380 : 700);
    }
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
      ['ORE SCOOPED', String(stats.oreCollected ?? 0)],
      ['METEORS CRACKED', String(stats.meteorsShattered ?? 0)],
      ['RIVALS DESTROYED', String(stats.rivalsDestroyed ?? 0)],
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
