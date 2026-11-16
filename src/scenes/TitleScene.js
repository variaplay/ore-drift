import { WORLD, COLORS, NPC_PALETTE } from '../config.js';
import { Audio } from '../util/audio.js';
import { makePlaceholderTextures, SHIP_DESIGNS, METEOR_VARIANTS } from '../util/placeholderArt.js';
import { Nebula, addStarfield } from '../util/backdrop.js';
import { UPGRADE_DEFS, buyUpgrade, loadOreBank, loadUpgrades, upgradeCost } from '../util/progression.js';

const NAME_KEY = 'oredrift.playerName';
const DESIGN_KEY = 'oredrift.shipDesign';
const AI_KEY = 'oredrift.aiCount';
const NAME_MAX = 14;
const THUMB_SCALE = 1.7;
const THUMB_GAP = 62;
const AI_MIN = 0;
// no upper cap — _spawnNpcs wraps `i % NPC_PALETTE.length`, so a 12th rival
// just reuses a palette color. Large values will cost frame rate, but that's
// the player's call.
const AI_DEFAULT = 5;
const SHOP_W = 300;
const SHOP_H = 204;

export class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  preload() {
    // TitleScene renders ship thumbnails, so it needs the design textures
    // available before create() builds the picker. GameScene will regenerate
    // these on its own preload, which is idempotent.
    makePlaceholderTextures(this, NPC_PALETTE);
  }

  create() {
    document.body.classList.remove('in-game');
    const cam = this.cameras.main;
    cam.setBackgroundColor('#05060c');

    this.nebula = new Nebula(this);
    this._drawStarfield();
    this._spawnDriftRocks();

    this.title = this.add.text(0, 0, 'ORE DRIFT', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '64px',
      color: '#7df9ff',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    // neon glow that breathes slowly (WebGL only; canvas renderer has no FX)
    if (this.title.preFX) {
      const glow = this.title.preFX.addGlow(0x2c9fff, 3, 0, false, 0.1, 14);
      this.tweens.add({
        targets: glow,
        outerStrength: 6,
        duration: 1800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    this.subtitle = this.add.text(0, 0, 'mine more ore than the rivals', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '16px',
      color: '#ffd66b',
    }).setOrigin(0.5);

    this.oreBank = loadOreBank();
    this.upgrades = loadUpgrades();

    this.shipPrompt = this.add.text(0, 0, 'SHIP TYPE', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '12px',
      color: '#8ea1c7',
      letterSpacing: 2,
    }).setOrigin(0.5);

    this.selectedDesignKey = this._loadDesign();
    this.selectRing = this.add.graphics().setDepth(1);
    // thumbnails: one Image per design, clickable, shows ring when selected
    this.thumbs = SHIP_DESIGNS.map((d) => {
      const img = this.add.image(0, 0, `ship_design_${d.key}`)
        .setScale(THUMB_SCALE)
        .setInteractive({ useHandCursor: true });
      img.on('pointerdown', () => this._selectDesign(d.key));
      return { img, design: d };
    });
    this.shipName = this.add.text(0, 0, '', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '13px',
      color: '#cfe4ff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // AI rivals count picker (0–8) — compact horizontal row: label · − · N · +
    this.aiCount = this._loadAiCount();
    const btnStyle = {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#7df9ff',
      backgroundColor: '#0a0f1f',
      padding: { left: 10, right: 10, top: 2, bottom: 4 },
    };
    const labelStyle = {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '12px',
      color: '#8ea1c7',
      letterSpacing: 2,
    };
    const countStyle = {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '20px',
      fontStyle: 'bold',
      color: '#cfe4ff',
    };
    this.aiLabel = this.add.text(0, 0, 'AI RIVALS', labelStyle).setOrigin(1, 0.5);
    this.aiMinus = this.add.text(0, 0, '−', btnStyle).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._setAiCount(this.aiCount - 1));
    this.aiCountLabel = this.add.text(0, 0, String(this.aiCount), countStyle).setOrigin(0.5);
    this.aiPlus = this.add.text(0, 0, '+', btnStyle).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._setAiCount(this.aiCount + 1));

    this._buildShop();

    this.prompt = this.add.text(0, 0, 'SHIP NAME', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '12px',
      color: '#8ea1c7',
      letterSpacing: 2,
    }).setOrigin(0.5);

    const saved = this._loadName();
    // DOM overlay: text input + launch button, styled to match the HUD palette
    this.form = this.add.dom(0, 0).createFromHTML(`
      <div style="display:flex;flex-direction:column;align-items:center;gap:14px;font-family:ui-monospace,monospace;">
        <input id="od-name" type="text" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false"
          value="${this._escape(saved)}" placeholder="PILOT"
          style="
            width:240px;padding:10px 14px;
            background:#0a0f1f;color:#cfe4ff;
            border:1px solid #3a4a78;border-radius:4px;
            font:16px ui-monospace,monospace;
            letter-spacing:0.15em;text-align:center;text-transform:uppercase;
            outline:none;caret-color:#7df9ff;
          " />
        <button id="od-launch" type="button"
          style="
            width:240px;padding:10px 14px;
            background:#7df9ff;color:#05060c;
            border:none;border-radius:4px;cursor:pointer;
            font:bold 14px ui-monospace,monospace;
            letter-spacing:0.3em;text-transform:uppercase;
          ">LAUNCH</button>
      </div>
    `);

    const input = this.form.getChildByID('od-name');
    const button = this.form.getChildByID('od-launch');

    // hover click for UI feedback; unlocks audio ctx as a bonus on desktop
    button.addEventListener('pointerdown', () => {
      Audio.attachToPhaser(this);
      Audio.unlock();
      Audio.playUiClick();
    });
    button.addEventListener('click', () => this._launch(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._launch(input.value); }
    });
    // focus once layout is stable so the caret appears on the input
    this.time.delayedCall(50, () => input.focus());

    this.scale.on('resize', () => this._layout());
    this._layout();
    this._refreshSelection();
  }

  _selectDesign(key) {
    this.selectedDesignKey = key;
    try { localStorage.setItem(DESIGN_KEY, key); } catch {}
    this._refreshSelection();
    Audio.attachToPhaser(this);
    Audio.unlock();
    Audio.playUiClick();
  }

  _refreshSelection() {
    const selected = this.thumbs.find((t) => t.design.key === this.selectedDesignKey) || this.thumbs[0];
    if (!selected) return;
    const ringColor = selected.design.accent;
    const r = 28;
    this.selectRing.clear();
    // soft outer glow + crisp inner ring pins the picked ship
    this.selectRing.lineStyle(2, ringColor, 0.9);
    this.selectRing.strokeCircle(selected.img.x, selected.img.y, r);
    this.selectRing.lineStyle(8, ringColor, 0.18);
    this.selectRing.strokeCircle(selected.img.x, selected.img.y, r);
    // dim non-selected thumbs so the pick pops
    for (const t of this.thumbs) {
      t.img.setAlpha(t.design.key === this.selectedDesignKey ? 1 : 0.55);
    }
    // show the name directly under the selected ship thumbnail
    this.shipName.setText(selected.design.name);
    this.shipName.setColor('#' + ringColor.toString(16).padStart(6, '0'));
    this.shipName.setPosition(selected.img.x, selected.img.y + 48);
  }

  _loadDesign() {
    try {
      const k = localStorage.getItem(DESIGN_KEY);
      if (SHIP_DESIGNS.some((d) => d.key === k)) return k;
    } catch {}
    return SHIP_DESIGNS[0].key;
  }

  _setAiCount(n) {
    const clamped = Math.max(AI_MIN, Math.floor(n));
    if (clamped === this.aiCount) return;
    this.aiCount = clamped;
    this.aiCountLabel.setText(String(clamped));
    try { localStorage.setItem(AI_KEY, String(clamped)); } catch {}
    // only the − button dims at the 0 floor; no upper cap so + is always lit
    this.aiMinus.setAlpha(clamped > AI_MIN ? 1 : 0.35);
    Audio.attachToPhaser(this);
    Audio.unlock();
    Audio.playUiClick();
  }

  _loadAiCount() {
    try {
      const n = parseInt(localStorage.getItem(AI_KEY), 10);
      if (Number.isFinite(n) && n >= AI_MIN) return n;
    } catch {}
    return AI_DEFAULT;
  }

  _launch(rawName) {
    const name = this._sanitize(rawName);
    try { localStorage.setItem(NAME_KEY, name); } catch {}
    Audio.attachToPhaser(this);
    Audio.unlock();
    Audio.playLaunch();
    Audio.startMusic();
    // hide the About / Privacy / Terms footer while in-game — it overlaps
    // the bottom-right minimap. CSS in index.html flips on body.in-game.
    document.body.classList.add('in-game');
    this.scene.start('Game', {
      playerName: name,
      playerDesignKey: this.selectedDesignKey,
      aiCount: this.aiCount,
      playerUpgrades: this.upgrades,
    });
  }

  _loadName() {
    try { return this._sanitize(localStorage.getItem(NAME_KEY) || ''); } catch { return ''; }
  }

  _sanitize(s) {
    return (s || '').trim().toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, NAME_MAX) || 'PILOT';
  }

  _escape(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  _buildShop() {
    this.shop = this.add.container(0, 0).setDepth(20);
    this.shopBg = this.add.rectangle(0, 0, SHOP_W, SHOP_H, 0x081126, 0.92)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x3a4a78, 0.9);
    this.shopTitle = this.add.text(14, 12, 'UPGRADE SHOP', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#ffd66b',
      letterSpacing: 2,
    });
    this.bankText = this.add.text(SHOP_W - 14, 12, '', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#7df9ff',
    }).setOrigin(1, 0);
    this.shop.add([this.shopBg, this.shopTitle, this.bankText]);

    this.shopRows = UPGRADE_DEFS.map((def, i) => {
      const y = 42 + i * 38;
      const name = this.add.text(14, y, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#cfe4ff',
      });
      const desc = this.add.text(14, y + 16, def.desc, {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '10px',
        color: '#8ea1c7',
      });
      const buy = this.add.text(SHOP_W - 14, y + 7, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#05060c',
        backgroundColor: '#7df9ff',
        padding: { left: 8, right: 8, top: 4, bottom: 4 },
      }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
      buy.on('pointerdown', () => this._buyUpgrade(def.key));
      this.shop.add([name, desc, buy]);
      return { def, name, desc, buy };
    });
    this._refreshShop();
  }

  _buyUpgrade(key) {
    const result = buyUpgrade(key);
    if (!result.ok) {
      Audio.attachToPhaser(this);
      Audio.unlock();
      Audio.playUiClick();
      return;
    }
    this.oreBank = result.bank;
    this.upgrades = result.upgrades;
    this._refreshShop();
    Audio.attachToPhaser(this);
    Audio.unlock();
    Audio.playPurchase();
  }

  _refreshShop() {
    this.bankText.setText(`${this.oreBank} ORE`);
    for (const row of this.shopRows) {
      const level = this.upgrades[row.def.key] || 0;
      const cost = upgradeCost(row.def, level);
      row.name.setText(`${row.def.label} ${level}/${row.def.maxLevel}`);
      if (cost === null) {
        row.buy.setText('MAX');
        row.buy.setAlpha(0.5);
        row.buy.disableInteractive();
      } else {
        row.buy.setText(String(cost));
        row.buy.setAlpha(this.oreBank >= cost ? 1 : 0.35);
        row.buy.setInteractive({ useHandCursor: true });
      }
    }
  }

  _layout() {
    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;
    this.title.setPosition(cx, cy - 230);
    this.subtitle.setPosition(cx, cy - 185);

    // ship picker row — centered, spaced by THUMB_GAP
    this.shipPrompt.setPosition(cx, cy - 140);
    const n = this.thumbs.length;
    const rowW = (n - 1) * THUMB_GAP;
    const startX = cx - rowW / 2;
    const thumbY = cy - 95;
    this.thumbs.forEach((t, i) => t.img.setPosition(startX + i * THUMB_GAP, thumbY));
    // shipName position is set to sit under the selected thumbnail in
    // _refreshSelection(); no fixed center position here

    // AI rivals picker row: [AI RIVALS] [−] [N] [+]
    const aiY = cy + 5;
    this.aiLabel.setPosition(cx - 30, aiY);
    this.aiMinus.setPosition(cx - 2, aiY);
    this.aiCountLabel.setPosition(cx + 36, aiY);
    this.aiPlus.setPosition(cx + 74, aiY);
    // apply min dim on initial layout (no upper cap to dim at)
    this.aiMinus.setAlpha(this.aiCount > AI_MIN ? 1 : 0.35);
    this.aiPlus.setAlpha(1);

    // name prompt + DOM form below the AI picker
    this.prompt.setPosition(cx, cy + 45);
    this.form.setPosition(cx, cy + 115);

    const shopScale = Math.min(1, (cam.width - 32) / SHOP_W, (cam.height - 32) / SHOP_H);
    const shopW = SHOP_W * shopScale;
    const shopH = SHOP_H * shopScale;
    const desiredX = cam.width >= 920 ? cx + 230 : cx - shopW / 2;
    const desiredY = cam.width >= 920 ? cy - 90 : cy + 160;
    const x = Phaser.Math.Clamp(desiredX, 16, cam.width - shopW - 16);
    const y = Phaser.Math.Clamp(desiredY, 16, cam.height - shopH - 16);
    this.shop.setPosition(x, y);
    this.shop.setScale(shopScale);

    // redraw selection ring at the new position
    if (this.thumbs.length) this._refreshSelection();
  }

  _drawStarfield() {
    // match the in-game starfield so the transition into Game feels continuous.
    // Scatter a bit past the larger screen dimension so modest resizes
    // don't reveal empty edges.
    const span = Math.max(this.scale.width, this.scale.height) * 0.6;
    addStarfield(this, {
      layers: WORLD.starLayers,
      cx: this.scale.width / 2,
      cy: this.scale.height / 2,
      halfW: span,
      halfH: span,
      parallax: false,
      twinkles: 40,
    });
  }

  _spawnDriftRocks() {
    // a few dim meteors tumbling behind the menu give the scene depth
    this.driftRocks = [];
    for (let i = 0; i < 8; i++) {
      // start in the left/right thirds so the menu column begins clear;
      // kept dim enough that a rock passing behind the UI never hides it
      const side = i % 2 === 0 ? 0 : 0.7;
      const rock = this.add.image(
        (side + Math.random() * 0.3) * this.scale.width,
        Phaser.Math.Between(0, this.scale.height),
        `meteor_${i % METEOR_VARIANTS}`,
      ).setDepth(-5)
        .setTint(COLORS.meteor)
        .setAlpha(0.18 + Math.random() * 0.14)
        .setScale(0.4 + Math.random() * 1.0);
      rock.vx = Phaser.Math.FloatBetween(-9, 9);
      rock.vy = Phaser.Math.FloatBetween(-6, 6);
      rock.spin = Phaser.Math.FloatBetween(-0.3, 0.3);
      this.driftRocks.push(rock);
    }
  }

  update(time, deltaMs) {
    const dt = deltaMs / 1000;
    this.nebula.update(0, 0, time);
    const w = this.scale.width, h = this.scale.height;
    for (const r of this.driftRocks) {
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.rotation += r.spin * dt;
      // wrap with a margin so rocks slide fully off before reappearing
      const m = 80 * r.scaleX;
      if (r.x < -m) r.x = w + m; else if (r.x > w + m) r.x = -m;
      if (r.y < -m) r.y = h + m; else if (r.y > h + m) r.y = -m;
    }
  }
}
