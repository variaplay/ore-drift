import { WORLD, COLORS } from '../config.js';
import { Audio } from '../util/audio.js';

const NAME_KEY = 'oredrift.playerName';
const NAME_MAX = 14;

export class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

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
  }

  _launch(rawName) {
    const name = this._sanitize(rawName);
    try { localStorage.setItem(NAME_KEY, name); } catch {}
    Audio.attachToPhaser(this);
    Audio.unlock();
    Audio.playLaunch();
    Audio.startMusic();
    this.scene.start('Game', { playerName: name });
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
    this.title.setPosition(cx, cy - 140);
    this.subtitle.setPosition(cx, cy - 90);
    this.prompt.setPosition(cx, cy - 30);
    this.form.setPosition(cx, cy + 40);
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
