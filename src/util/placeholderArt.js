// Generates chunky retro-pixel placeholder textures at runtime so the game
// is playable without any art files. Swap these out by loading real sprites
// in GameScene.preload(): this.load.image('ship_player', 'assets/sprites/ship_player.png').
// Target sprite sizes (matches the placeholders; good target for PixelLab):
//   ship_player, ship_npc : 32x32  (pointing up)
//   meteor_0..5           : 64x64  (six irregular silhouettes)
//   ore                   : 10x10
//   spark                 : 6x6

export function makePlaceholderTextures(scene, npcPalette = []) {
  _shipTexture(scene, 'ship_player', 0x7df9ff, 0x2c6fff);
  // one texture per NPC palette entry so ships render in distinct colors
  // (tinting alone wouldn't work: the base sprite has two colors, a tint
  // multiplies both uniformly and muddies the accent)
  npcPalette.forEach((p, i) => _shipTexture(scene, `ship_npc_${i}`, p.accent, p.hull));
  // fallback texture for any NPC spawned without a palette index
  _shipTexture(scene, 'ship_npc', 0xff7bd1, 0xa4357a);
  // six irregular meteor silhouettes — Meteor picks one at random so the
  // field reads as a real asteroid belt, not a parade of identical circles
  for (let i = 0; i < METEOR_VARIANTS; i++) _meteorTexture(scene, `meteor_${i}`);
  _meteorTexture(scene, 'meteor'); // legacy fallback
  _oreTexture(scene, 'ore');
  _sparkTexture(scene, 'spark');
}

export const METEOR_VARIANTS = 6;

function _shipTexture(scene, key, accent, hull) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  // pixel-art triangle ship, 32x32, pointing up
  const px = (x, y, w, h, c) => { g.fillStyle(c, 1); g.fillRect(x, y, w, h); };
  // hull
  px(14, 4, 4, 4, accent);
  px(12, 8, 8, 4, hull);
  px(10, 12, 12, 4, hull);
  px(8, 16, 16, 6, hull);
  px(6, 22, 20, 4, hull);
  // cockpit
  px(14, 10, 4, 4, accent);
  // thrusters
  px(8, 26, 4, 4, 0x333a55);
  px(20, 26, 4, 4, 0x333a55);
  // outline accents
  px(13, 3, 6, 1, accent);
  g.generateTexture(key, 32, 32);
  g.destroy();
}

function _meteorTexture(scene, key) {
  // 64x64 irregular rock silhouette. Radius varies per-vertex so each
  // variant has its own jagged profile. Drawn white — the Meteor entity
  // tints per-instance at runtime.
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  const cx = 32, cy = 32;

  // build an irregular polygon by sampling radii around a circle
  const N = 18 + Math.floor(Math.random() * 5); // 18–22 vertices
  const minR = 18, maxR = 30; // must stay inside the 32-px physics circle
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // bias: mostly mid-range, with occasional spikes and notches
    let r = minR + Math.random() * (maxR - minR);
    if (Math.random() < 0.12) r = maxR;           // spike
    else if (Math.random() < 0.1) r = minR + 1;   // notch
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }

  // filled silhouette
  g.fillStyle(0xffffff, 1);
  g.fillPoints(pts, true);

  // a soft inner "inset" ring so the shape reads rounder in the middle,
  // keeping the crack lines from looking too pasted-on
  g.fillStyle(0xffffff, 0.08);
  g.fillCircle(cx, cy, 22);

  // scatter three pixel craters inside the shape (darker = alpha overlay)
  g.fillStyle(0x000000, 0.22);
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * 12;
    const size = 3 + Math.floor(Math.random() * 4);
    g.fillRect(Math.round(cx + Math.cos(a) * rr - size / 2),
               Math.round(cy + Math.sin(a) * rr - size / 2),
               size, size);
  }

  // subtle highlight bar (off-center toward upper-left)
  g.fillStyle(0xffffff, 0.18);
  const hx = cx + Math.cos(Math.random() * Math.PI * 2) * 8;
  const hy = cy + Math.sin(Math.random() * Math.PI * 2) * 8;
  g.fillRect(Math.round(hx) - 4, Math.round(hy) - 1, 8, 2);

  g.generateTexture(key, 64, 64);
  g.destroy();
}

function _oreTexture(scene, key) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  g.fillStyle(0xffffff, 1);
  // diamond chip, 10x10
  g.fillRect(4, 1, 2, 2);
  g.fillRect(2, 3, 6, 2);
  g.fillRect(1, 5, 8, 2);
  g.fillRect(3, 7, 4, 2);
  g.fillStyle(0xffffff, 0.5);
  g.fillRect(4, 2, 1, 1);
  g.generateTexture(key, 10, 10);
  g.destroy();
}

function _sparkTexture(scene, key) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  g.fillStyle(0xffffff, 1);
  g.fillRect(2, 0, 2, 6);
  g.fillRect(0, 2, 6, 2);
  g.generateTexture(key, 6, 6);
  g.destroy();
}
