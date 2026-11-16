// Shared space backdrop: tiling nebula + layered, tinted, twinkling stars.
// Used by both Title (screen space) and Game (world space with parallax)
// so the transition between them feels continuous.

const STAR_TINTS = [0xffffff, 0xffffff, 0xcfe0ff, 0xb8c8ff, 0xfff1d6, 0xffd9c2];

export class Nebula {
  // Two tile layers of the same texture at different scales/offsets.
  // They sit in screen space (scrollFactor 0) and scroll their tile
  // position slowly with the camera, which reads as very distant parallax.
  constructor(scene, { depth = -20 } = {}) {
    this.scene = scene;
    const { width, height } = scene.scale;
    this.far = scene.add.tileSprite(0, 0, width, height, 'nebula')
      .setOrigin(0.5).setScrollFactor(0).setDepth(depth).setTileScale(2);
    this.near = scene.add.tileSprite(0, 0, width, height, 'nebula')
      .setOrigin(0.5).setScrollFactor(0).setDepth(depth + 1).setTileScale(1.15)
      .setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD)
      .setTilePosition(173, 291);
    this._onResize = (size) => this.resize(size.width, size.height);
    scene.scale.on('resize', this._onResize);
    scene.events.once('shutdown', () => scene.scale.off('resize', this._onResize));
    this.resize(width, height);
  }

  resize(w, h) {
    // oversize so camera zoom-out (boost) never reveals the edges
    for (const t of [this.far, this.near]) {
      t.setPosition(w / 2, h / 2);
      t.setSize(w * 1.35, h * 1.35);
    }
  }

  update(scrollX, scrollY, time = 0) {
    this.far.setTilePosition(scrollX * 0.012 + time * 0.0015, scrollY * 0.012);
    this.near.setTilePosition(173 + scrollX * 0.05, 291 + scrollY * 0.05 + time * 0.002);
  }
}

// Static star layers baked into Graphics plus a handful of twinkling
// sprites on top, scattered over (cx ± halfW, cy ± halfH). `parallax`
// gives each layer its scroll factor; pass false for screen-space stars.
export function addStarfield(scene, { layers = 3, cx = 0, cy = 0, halfW, halfH, parallax = true, twinkles = 60 } = {}) {
  const objs = [];
  for (let layer = 0; layer < layers; layer++) {
    const g = scene.add.graphics();
    g.setDepth(-10 + layer);
    const count = 220 - layer * 55;
    const size = 1 + layer;
    for (let i = 0; i < count; i++) {
      const tint = STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)];
      g.fillStyle(tint, (0.25 + layer * 0.2) * (0.5 + Math.random() * 0.5));
      g.fillRect(
        cx + Phaser.Math.Between(-halfW, halfW),
        cy + Phaser.Math.Between(-halfH, halfH),
        size, size,
      );
    }
    if (parallax) g.setScrollFactor(0.3 + layer * 0.2);
    objs.push(g);
  }
  for (let i = 0; i < twinkles; i++) {
    const s = scene.add.image(
      cx + Phaser.Math.Between(-halfW, halfW),
      cy + Phaser.Math.Between(-halfH, halfH),
      'star',
    ).setDepth(-7).setBlendMode(Phaser.BlendModes.ADD)
      .setTint(STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)])
      .setScale(0.8 + Math.random() * 0.9)
      .setAlpha(0.15);
    if (parallax) s.setScrollFactor(0.85);
    scene.tweens.add({
      targets: s,
      alpha: { from: 0.15, to: 0.6 + Math.random() * 0.4 },
      duration: Phaser.Math.Between(900, 2600),
      delay: Phaser.Math.Between(0, 3000),
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    objs.push(s);
  }
  return objs;
}
