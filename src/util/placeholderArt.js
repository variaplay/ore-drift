// Generates chunky retro-pixel placeholder textures at runtime so the game
// is playable without any art files. Swap these out by loading real sprites
// in GameScene.preload(): this.load.image('ship_player', 'assets/sprites/ship_player.png').
// Target sprite sizes (matches the placeholders; good target for PixelLab):
//   ship_player, ship_npc : 32x32  (pointing up)
//   meteor                : 64x64
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
  _meteorTexture(scene, 'meteor');
  _oreTexture(scene, 'ore');
  _sparkTexture(scene, 'spark');
}

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
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  // blocky rock, 64x64, roughly circular
  const base = 0xffffff; // we tint per-meteor so draw white
  g.fillStyle(base, 1);
  const R = 28;
  for (let y = -R; y <= R; y++) {
    const w = Math.floor(Math.sqrt(R * R - y * y));
    g.fillRect(32 - w, 32 + y, w * 2, 1);
  }
  // pixel craters (slightly darker = alpha overlay)
  g.fillStyle(0x000000, 0.22);
  g.fillRect(20, 20, 6, 6);
  g.fillRect(38, 30, 8, 4);
  g.fillRect(26, 40, 4, 6);
  // highlight
  g.fillStyle(0xffffff, 0.18);
  g.fillRect(18, 16, 8, 2);
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
