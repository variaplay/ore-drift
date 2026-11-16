// Generates retro-pixel textures at runtime so the game is playable without
// any art files. Swap these out by loading real sprites in
// GameScene.preload(): this.load.image('ship_player', 'assets/sprites/ship_player.png').
// Target sprite sizes (matches the generated textures; good target for PixelLab):
//   ship_player, ship_npc : 32x32  (pointing up)
//   meteor_0..5           : 64x64  (six irregular silhouettes)
//   ore                   : 16x16  (diamond chip + baked glow)
//   spark                 : 6x6
//
// Everything is drawn into canvas textures so we can post-process pixels:
// ships get a 1px dark outline and top-left lighting, rocks are per-pixel
// shaded spheres with craters. Textures are grayscale/white where the game
// tints them at runtime (meteors, ore, particles) so tier colors still work.
// Generation is skipped when a key already exists, so Title and Game can
// both call makePlaceholderTextures() without redoing the work.

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
  for (let i = 0; i < METEOR_VARIANTS; i++) _rockTexture(scene, `meteor_${i}`);
  _rockTexture(scene, 'meteor'); // legacy fallback
  for (let i = 0; i < CRYSTAL_VARIANTS; i++) _crystalTexture(scene, `crystal_${i}`);
  _rockTexture(scene, 'meteor_mother', { veins: true });
  _oreTexture(scene, 'ore');
  _sparkTexture(scene, 'spark');
  _glowTexture(scene, 'glow');
  _starTexture(scene, 'star');
  _chunkTexture(scene, 'chunk');
  _nebulaTexture(scene, 'nebula');
  _vignetteTexture(scene, 'vignette');
}

export const METEOR_VARIANTS = 6;
export const CRYSTAL_VARIANTS = 3;

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

// ---------- canvas plumbing ----------

function _canvasTexture(scene, key, w, h, drawFn) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  drawFn(tex.context, w, h);
  tex.refresh();
}

const _rgba = (c, a = 1) => `rgba(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${c & 0xff},${a})`;

// Minimal Graphics-like adapter so the ship draw functions below (written
// against Phaser.Graphics) can paint straight onto a 2D canvas context.
function _canvasPen(ctx) {
  return {
    fillStyle(c, a = 1) { ctx.fillStyle = _rgba(c, a); },
    fillRect(x, y, w, h) { ctx.fillRect(x, y, w, h); },
  };
}

function _renderDesignTexture(scene, design, keyOverride = null) {
  const key = keyOverride || `ship_design_${design.key}`;
  _drawToTexture(scene, key, (g) => design.draw(g, design.accent, design.hull));
}

function _drawToTexture(scene, key, drawFn) {
  _canvasTexture(scene, key, 32, 32, (ctx, w, h) => {
    drawFn(_canvasPen(ctx));
    _shadeSprite(ctx, w, h);
  });
}

// Pixel-art finishing pass: light from the top-left, a soft top→bottom
// gradient across the hull, and a 1px near-black outline so ships stay
// readable against bright nebula and glowing ore.
function _shadeSprite(ctx, w, h) {
  const src = ctx.getImageData(0, 0, w, h);
  const d = src.data;
  const out = new Uint8ClampedArray(d);
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] > 0) {
        let k;
        if (!solid(x, y - 1) || !solid(x - 1, y)) k = 1.4;        // lit edge
        else if (!solid(x, y + 1) || !solid(x + 1, y)) k = 0.62;  // shadow edge
        else k = 1.1 - 0.28 * (y / h);                            // body gradient
        for (let c = 0; c < 3; c++) {
          const v = d[i + c];
          out[i + c] = k >= 1 ? v + (255 - v) * (k - 1) : v * k;
        }
      } else if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
        out[i] = 7; out[i + 1] = 9; out[i + 2] = 18; out[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(new ImageData(out, w, h), 0, 0);
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

// ---------- noise ----------

// Smooth value noise on a wrapping 32×32 lattice. Cheap and good enough
// for rock grain and nebula dust at these texture sizes.
function _valueNoise() {
  const N = 32;
  const lattice = new Float32Array(N * N);
  for (let i = 0; i < lattice.length; i++) lattice[i] = Math.random();
  const at = (x, y) => lattice[((y % N + N) % N) * N + ((x % N + N) % N)];
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = fade(x - xi), v = fade(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi);
    const c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

const _smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------- meteors ----------

// Light direction shared by every rock so the whole field is lit from the
// same "sun" (top-left, slightly in front).
const LIGHT = (() => {
  const v = [-0.55, -0.65, 0.55];
  const m = Math.hypot(...v);
  return { x: v[0] / m, y: v[1] / m, z: v[2] / m };
})();

// Radius as a sum of low-frequency sines so the outline curves instead of
// jags. Each call picks its own phases so no two variants look alike.
function _blobShape(baseR) {
  const aFreq = 2 + Math.floor(Math.random() * 2);
  const bFreq = 4 + Math.floor(Math.random() * 2);
  const cFreq = 7 + Math.floor(Math.random() * 2);
  const aPh = Math.random() * Math.PI * 2;
  const bPh = Math.random() * Math.PI * 2;
  const cPh = Math.random() * Math.PI * 2;
  return (a) => baseR
    + Math.sin(a * aFreq + aPh) * 2.2
    + Math.sin(a * bFreq + bPh) * 1.4
    + Math.sin(a * cFreq + cPh) * 0.7;
}

function _rockTexture(scene, key, { veins = false } = {}) {
  // 64x64 per-pixel shaded rock: fake-sphere normal + crater bowls + grain
  // noise, quantized to a handful of tones so it still reads as pixel art.
  // Output is grayscale; Meteor tints it per tier.
  _canvasTexture(scene, key, 64, 64, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    const shape = _blobShape(26);
    const noise = _valueNoise();
    const craters = [];
    const craterCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < craterCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * 16;
      craters.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, r: 2.5 + Math.random() * 4.5 });
    }
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - cx, py = y + 0.5 - cy;
        const dist = Math.hypot(px, py);
        const R = shape(Math.atan2(py, px));
        const i = (y * w + x) * 4;
        if (dist > R + 1) continue;
        if (dist > R) {
          // dark rim outline — survives any tint since it's near-black
          d[i] = 10; d[i + 1] = 12; d[i + 2] = 20; d[i + 3] = 220;
          continue;
        }
        let nx = px / R, ny = py / R;
        let ao = 1;
        for (const c of craters) {
          const dx = px - c.x, dy = py - c.y;
          const dc = Math.hypot(dx, dy);
          if (dc < c.r) {
            // bowl: surface slopes toward the crater center
            nx -= (dx / c.r) * 0.6;
            ny -= (dy / c.r) * 0.6;
            ao *= 0.84 + 0.16 * (dc / c.r);
          } else if (dc < c.r + 1.4) {
            // raised rim catches light on the outside
            nx += (dx / dc) * 0.25;
            ny += (dy / dc) * 0.25;
          }
        }
        const nz = Math.sqrt(Math.max(0.05, 1 - Math.min(1, (px * px + py * py) / (R * R))));
        const nm = Math.hypot(nx, ny, nz);
        const lam = Math.max(0, (nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z) / nm);
        const grain = noise(x / 9, y / 9) * 0.28 + (noise(x / 3.5 + 50, y / 3.5 + 50) - 0.5) * 0.12;
        let v = (0.3 + 0.75 * lam) * (0.84 + grain) * ao;
        v *= 1 - _smoothstep(0.82, 1, dist / R) * 0.22;
        v = Math.round(v * 9) / 9;
        if (veins) {
          // molten seams: thin ridges of the noise field glow at full
          // brightness while the crust darkens, so the orange tint reads as lava
          const ridge = Math.abs(noise(x / 7 + 20, y / 7 + 20) - 0.5);
          v = ridge < 0.04 ? 1 : ridge < 0.07 ? Math.max(v, 0.8) : v * 0.55;
        }
        const g = Math.round(Math.min(1, Math.max(0, v)) * 255);
        d[i] = g; d[i + 1] = g; d[i + 2] = g; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

function _crystalTexture(scene, key) {
  // angular gem: sharp polygon outline split into flat-shaded facets with
  // bright facet edges and a few sparkle pixels
  _canvasTexture(scene, key, 64, 64, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    const V = 7 + Math.floor(Math.random() * 3);
    const verts = [];
    for (let i = 0; i < V; i++) {
      const a = (i / V) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      verts.push({ a, r: 22 + Math.random() * 6 });
    }
    // polygon radius at angle a: interpolate along the edge between vertices
    const radiusAt = (a) => {
      let ang = (a + Math.PI * 2) % (Math.PI * 2);
      for (let i = 0; i < V; i++) {
        const p = verts[i], q = verts[(i + 1) % V];
        let a0 = (p.a + Math.PI * 2) % (Math.PI * 2);
        let a1 = (q.a + Math.PI * 2) % (Math.PI * 2);
        if (a1 < a0) a1 += Math.PI * 2;
        let t = ang;
        if (t < a0) t += Math.PI * 2;
        if (t >= a0 && t <= a1) {
          const k = (t - a0) / (a1 - a0);
          // straight edge in cartesian space, not an arc
          const x0 = Math.cos(a0) * p.r, y0 = Math.sin(a0) * p.r;
          const x1 = Math.cos(a1) * q.r, y1 = Math.sin(a1) * q.r;
          const ex = x0 + (x1 - x0) * k, ey = y0 + (y1 - y0) * k;
          return Math.hypot(ex, ey);
        }
      }
      return 24;
    };
    const seeds = [];
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * 20;
      const nx = (Math.random() - 0.5) * 1.4, ny = (Math.random() - 0.5) * 1.4;
      const nm = Math.hypot(nx, ny, 1);
      const lam = Math.max(0, (nx * LIGHT.x + ny * LIGHT.y + LIGHT.z) / nm);
      seeds.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, v: 0.4 + 0.6 * lam });
    }
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - cx, py = y + 0.5 - cy;
        const dist = Math.hypot(px, py);
        const R = radiusAt(Math.atan2(py, px));
        const i = (y * w + x) * 4;
        if (dist > R + 1) continue;
        if (dist > R) { d[i] = 14; d[i + 1] = 8; d[i + 2] = 28; d[i + 3] = 230; continue; }
        let best = Infinity, second = Infinity, facet = seeds[0];
        for (const s of seeds) {
          const ds = (px - s.x) ** 2 + (py - s.y) ** 2;
          if (ds < best) { second = best; best = ds; facet = s; } else if (ds < second) second = ds;
        }
        let v = facet.v;
        if (Math.sqrt(second) - Math.sqrt(best) < 1.1) v = 0.98;   // facet edge
        if (dist > R - 1.5) v = Math.min(v, 0.55);                 // dark rim
        v = Math.round(v * 8) / 8;
        const g = Math.round(v * 255);
        d[i] = g; d[i + 1] = g; d[i + 2] = g; d[i + 3] = 255;
      }
    }
    for (let k = 0; k < 4; k++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * 14;
      const sx = Math.round(cx + Math.cos(a) * rr), sy = Math.round(cy + Math.sin(a) * rr);
      for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i = ((sy + oy) * w + (sx + ox)) * 4;
        if (d[i + 3]) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; }
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

// ---------- small particles & pickups ----------

function _oreTexture(scene, key) {
  // 16x16: soft baked glow + 8px faceted diamond. Tinted gold at runtime.
  _canvasTexture(scene, key, 16, 16, (ctx) => {
    const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 16);
    // rows of the diamond: [y, x0, x1]
    const rows = [[4, 7, 8], [5, 6, 9], [6, 5, 10], [7, 4, 11], [8, 4, 11], [9, 5, 10], [10, 6, 9], [11, 7, 8]];
    for (const [y, x0, x1] of rows) {
      for (let x = x0; x <= x1; x++) {
        const top = y < 8, left = x < 8;
        const v = top ? (left ? 1 : 0.82) : (left ? 0.68 : 0.5);
        const g = Math.round(v * 255);
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(6, 6, 1, 1);
    ctx.fillRect(7, 5, 1, 1);
  });
}

function _sparkTexture(scene, key) {
  _canvasTexture(scene, key, 6, 6, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(2, 0, 2, 6);
    ctx.fillRect(0, 2, 6, 2);
  });
}

function _glowTexture(scene, key) {
  // soft round falloff used for thrust, dust, impacts and twinkles
  _canvasTexture(scene, key, 32, 32, (ctx) => {
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
  });
}

function _starTexture(scene, key) {
  // bright pixel core with a faint cross flare
  _canvasTexture(scene, key, 9, 9, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(4, 0, 1, 9);
    ctx.fillRect(0, 4, 9, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(3, 3, 3, 3);
    ctx.fillStyle = '#fff';
    ctx.fillRect(4, 4, 1, 1);
  });
}

function _chunkTexture(scene, key) {
  // tiny rock shard for shatter debris (tinted per meteor)
  _canvasTexture(scene, key, 6, 6, (ctx) => {
    const px = [[2, 0, 230], [3, 0, 200], [1, 1, 255], [2, 1, 220], [3, 1, 180], [4, 1, 150],
      [0, 2, 210], [1, 2, 200], [2, 2, 170], [3, 2, 140], [4, 2, 120], [1, 3, 160],
      [2, 3, 130], [3, 3, 110], [4, 3, 90], [2, 4, 100], [3, 4, 80]];
    for (const [x, y, g] of px) {
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

// ---------- backdrop ----------

function _nebulaTexture(scene, key) {
  // 512×512 seamlessly tiling nebula: additive colored clouds, then darker
  // dust lanes. Every blob is drawn at all 9 wrap offsets so the edges match.
  const S = 512;
  _canvasTexture(scene, key, S, S, (ctx) => {
    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, S, S);
    const blob = (x, y, r, color, alpha) => {
      for (let ox = -S; ox <= S; ox += S) {
        for (let oy = -S; oy <= S; oy += S) {
          const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          g.addColorStop(0, _rgba(color, alpha));
          g.addColorStop(0.5, _rgba(color, alpha * 0.4));
          g.addColorStop(1, _rgba(color, 0));
          ctx.fillStyle = g;
          ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
    };
    const palette = [0x1b2f7a, 0x3b1a6b, 0x0f4a63, 0x5a1d5e, 0x14306a, 0x23104a];
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 18; i++) {
      blob(Math.random() * S, Math.random() * S, 60 + Math.random() * 170,
        palette[i % palette.length], 0.1 + Math.random() * 0.14);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 10; i++) {
      blob(Math.random() * S, Math.random() * S, 30 + Math.random() * 90, 0x05060c, 0.35 + Math.random() * 0.25);
    }
  });
}

function _vignetteTexture(scene, key) {
  // white with alpha falloff toward the edges — tint black for the normal
  // vignette, red for the low-fuel warning
  _canvasTexture(scene, key, 256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 182);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  });
}
