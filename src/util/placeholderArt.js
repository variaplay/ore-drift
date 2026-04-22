// Generates chunky retro-pixel placeholder textures at runtime so the game
// is playable without any art files. Swap these out by loading real sprites
// in GameScene.preload(): this.load.image('ship_player', 'assets/sprites/ship_player.png').
// Target sprite sizes (matches the placeholders; good target for PixelLab):
//   ship_player, ship_npc : 32x32  (pointing up)
//   meteor_0..5           : 64x64  (six irregular silhouettes)
//   ore                   : 10x10
//   spark                 : 6x6

export function makePlaceholderTextures(scene, npcPalette = []) {
  // player-selectable ship variants (shape + signature colors)
  SHIP_DESIGNS.forEach((d) => _renderDesignTexture(scene, d));
  // legacy player texture key (now an alias for the default design)
  _renderDesignTexture(scene, SHIP_DESIGNS[0], 'ship_player');
  // one texture per (palette color × ship design) so NPCs can vary both
  // silhouette AND hull color. Tinting alone won't work — the base sprite
  // has two colors and a tint multiplies both, muddying the accent.
  npcPalette.forEach((p, i) => {
    // legacy per-color arrow (kept for any spawn path that doesn't pick a design)
    _drawToTexture(scene, `ship_npc_${i}`, (g) => _drawArrow(g, p.accent, p.hull));
    SHIP_DESIGNS.forEach((d) => {
      _drawToTexture(scene, `ship_npc_${i}_${d.key}`, (g) => d.draw(g, p.accent, p.hull));
    });
  });
  // fallback texture for any NPC spawned without a palette index
  _drawToTexture(scene, 'ship_npc', (g) => _drawArrow(g, 0xff7bd1, 0xa4357a));
  // six irregular meteor silhouettes — Meteor picks one at random so the
  // field reads as a real asteroid belt, not a parade of identical circles
  for (let i = 0; i < METEOR_VARIANTS; i++) _meteorTexture(scene, `meteor_${i}`);
  _meteorTexture(scene, 'meteor'); // legacy fallback
  _oreTexture(scene, 'ore');
  _sparkTexture(scene, 'spark');
}

export const METEOR_VARIANTS = 6;

// Player ship variants — each has a distinct silhouette and signature colors.
// Added purely additively so existing ship_player calls still work via the
// legacy alias generated above.
export const SHIP_DESIGNS = [
  { key: 'arrow',  name: 'ARROW',  accent: 0x7df9ff, hull: 0x2c6fff, draw: _drawArrow },
  { key: 'wing',   name: 'WING',   accent: 0xff7bd1, hull: 0xa4357a, draw: _drawWing },
  { key: 'dart',   name: 'DART',   accent: 0x8abde3, hull: 0x3d5a7a, draw: _drawDart },
  { key: 'saucer', name: 'SAUCER', accent: 0xffde5c, hull: 0xb39a2a, draw: _drawSaucer },
  { key: 'heavy',  name: 'HEAVY',  accent: 0xb77dff, hull: 0x6b3fb5, draw: _drawHeavy },
];

function _renderDesignTexture(scene, design, keyOverride = null) {
  const key = keyOverride || `ship_design_${design.key}`;
  _drawToTexture(scene, key, (g) => design.draw(g, design.accent, design.hull));
}

function _drawToTexture(scene, key, drawFn) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  drawFn(g);
  g.generateTexture(key, 32, 32);
  g.destroy();
}

// Pixel helper shared across all ship shapes.
const _px = (g, x, y, w, h, c) => { g.fillStyle(c, 1); g.fillRect(x, y, w, h); };

function _drawArrow(g, accent, hull) {
  // original pointed arrow — narrow, speedy silhouette
  _px(g, 14, 4, 4, 4, accent);
  _px(g, 12, 8, 8, 4, hull);
  _px(g, 10, 12, 12, 4, hull);
  _px(g, 8, 16, 16, 6, hull);
  _px(g, 6, 22, 20, 4, hull);
  _px(g, 14, 10, 4, 4, accent); // cockpit
  _px(g, 8, 26, 4, 4, 0x333a55); // thrusters
  _px(g, 20, 26, 4, 4, 0x333a55);
  _px(g, 13, 3, 6, 1, accent);   // tip highlight
}

function _drawWing(g, accent, hull) {
  // blunt nose + pronounced swept wings
  _px(g, 14, 5, 4, 4, accent);
  _px(g, 12, 9, 8, 4, hull);
  _px(g, 10, 13, 12, 4, hull);
  _px(g, 4, 17, 24, 4, hull);   // full-width wings
  _px(g, 2, 21, 28, 4, hull);   // extended wingtips
  _px(g, 6, 25, 20, 2, hull);
  _px(g, 14, 11, 4, 4, accent); // cockpit
  _px(g, 9, 27, 4, 3, 0x333a55);
  _px(g, 19, 27, 4, 3, 0x333a55);
  _px(g, 13, 4, 6, 1, accent);
}

function _drawDart(g, accent, hull) {
  // long, thin racing needle
  _px(g, 15, 2, 2, 4, accent);  // sharp tip
  _px(g, 14, 6, 4, 6, hull);
  _px(g, 13, 12, 6, 10, hull);
  _px(g, 12, 22, 8, 4, hull);
  _px(g, 10, 24, 3, 3, hull);   // small fins
  _px(g, 19, 24, 3, 3, hull);
  _px(g, 15, 10, 2, 5, accent); // narrow cockpit stripe
  _px(g, 14, 27, 2, 3, 0x333a55);
  _px(g, 16, 27, 2, 3, 0x333a55);
}

function _drawSaucer(g, accent, hull) {
  // disc/diamond — rounded hex with glowing core
  _px(g, 14, 5, 4, 2, hull);
  _px(g, 12, 7, 8, 2, hull);
  _px(g, 10, 9, 12, 2, hull);
  _px(g, 8, 11, 16, 2, hull);
  _px(g, 6, 13, 20, 6, hull);   // wide belly
  _px(g, 8, 19, 16, 2, hull);
  _px(g, 10, 21, 12, 2, hull);
  _px(g, 12, 23, 8, 2, hull);
  _px(g, 14, 25, 4, 2, hull);
  _px(g, 13, 14, 6, 4, accent); // glowing core
  _px(g, 14, 13, 4, 1, accent);
  _px(g, 14, 18, 4, 1, accent);
  _px(g, 11, 27, 3, 3, 0x333a55);
  _px(g, 18, 27, 3, 3, 0x333a55);
}

function _drawHeavy(g, accent, hull) {
  // squat, wide cargo hauler — chunky and intimidating
  _px(g, 12, 4, 8, 4, accent);
  _px(g, 10, 8, 12, 2, hull);
  _px(g, 8, 10, 16, 4, hull);
  _px(g, 6, 14, 20, 6, hull);   // very broad body
  _px(g, 4, 20, 24, 4, hull);
  _px(g, 8, 24, 16, 3, hull);
  _px(g, 12, 10, 8, 4, accent); // big cockpit slab
  _px(g, 5, 27, 5, 3, 0x333a55);
  _px(g, 13, 27, 6, 3, 0x333a55);
  _px(g, 22, 27, 5, 3, 0x333a55);
}

function _meteorTexture(scene, key) {
  // 64x64 smooth-irregular rock silhouette. Radius is a sum of low-frequency
  // sine waves so the outline curves instead of jags. Each variant picks its
  // own phase offsets so no two look alike.
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  const cx = 32, cy = 32;

  // many vertices → the polygon edges are short enough to read as a curve
  const N = 64;
  const baseR = 26;
  // three sine layers: slow big lobes, mid undulation, tiny wobble
  const aAmp = 2.2, bAmp = 1.4, cAmp = 0.7;
  const aFreq = 2 + Math.floor(Math.random() * 2); // 2 or 3
  const bFreq = 4 + Math.floor(Math.random() * 2); // 4 or 5
  const cFreq = 7 + Math.floor(Math.random() * 2); // 7 or 8
  const aPh = Math.random() * Math.PI * 2;
  const bPh = Math.random() * Math.PI * 2;
  const cPh = Math.random() * Math.PI * 2;

  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = baseR
      + Math.sin(a * aFreq + aPh) * aAmp
      + Math.sin(a * bFreq + bPh) * bAmp
      + Math.sin(a * cFreq + cPh) * cAmp;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }

  // filled silhouette
  g.fillStyle(0xffffff, 1);
  g.fillPoints(pts, true);

  // scatter three pixel craters inside the shape
  g.fillStyle(0x000000, 0.22);
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * 12;
    const size = 3 + Math.floor(Math.random() * 4);
    g.fillRect(Math.round(cx + Math.cos(a) * rr - size / 2),
               Math.round(cy + Math.sin(a) * rr - size / 2),
               size, size);
  }

  // subtle off-center highlight bar
  g.fillStyle(0xffffff, 0.18);
  const hAng = Math.random() * Math.PI * 2;
  const hx = cx + Math.cos(hAng) * 8;
  const hy = cy + Math.sin(hAng) * 8;
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
