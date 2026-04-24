import { WORLD, COLORS, NPC_PALETTE } from '../config.js';
import { Audio } from '../util/audio.js';
import { makePlaceholderTextures, SHIP_DESIGNS } from '../util/placeholderArt.js';

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

export class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  preload() {
    // TitleScene renders ship thumbnails, so it needs the design textures
    // available before create() builds the picker. GameScene will regenerate
    // these on its own preload, which is idempotent.
    makePlaceholderTextures(this, NPC_PALETTE);
  }

  create() {
    const cam = this.cameras.main;
    cam.setBackgroundColor('#05060c');

    this._drawStarfield();

    this.title = this.add.text(0, 0, 'ORE DRIFT', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '64px',
      color: '#7df9ff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.subtitle = this.add.text(0, 0, 'mine more ore than the rivals', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '16px',
      color: '#ffd66b',
    }).setOrigin(0.5);

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

    // redraw selection ring at the new position
    if (this.thumbs.length) this._refreshSelection();
  }

  _drawStarfield() {
    // match the in-game starfield so the transition into Game feels continuous
    const w = this.scale.width;
    const h = this.scale.height;
    for (let layer = 0; layer < WORLD.starLayers; layer++) {
      const g = this.add.graphics();
      g.setDepth(-10 + layer);
      g.fillStyle(COLORS.star, 0.3 + layer * 0.2);
      const count = 200 - layer * 50;
      for (let i = 0; i < count; i++) {
        g.fillRect(Phaser.Math.Between(0, w), Phaser.Math.Between(0, h), 1 + layer, 1 + layer);
      }
    }
  }
}
