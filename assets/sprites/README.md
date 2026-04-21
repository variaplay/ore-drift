# Sprite assets

Drop pixel-art PNGs here to replace the runtime-generated placeholders.

## Expected files & sizes

All sprites are top-down, facing **up** (north). Transparent background.

| File               | Size   | Notes                                                  |
| ------------------ | ------ | ------------------------------------------------------ |
| `ship_player.png`  | 32×32  | Main color should read as cyan/teal                    |
| `ship_npc.png`     | 32×32  | Rival color (pink/magenta default)                     |
| `meteor.png`       | 64×64  | Pure white-ish; game tints it per meteor (damage heat) |
| `ore.png`          | 10×10  | Gold chip, bright center                               |
| `spark.png`        | 6×6    | Additive thrust particle, white                        |

## PixelLab prompt hints

- "top-down 2D pixel art, 32x32, retro arcade, 8-bit palette"
- Ships: "small mining starship, pointing up, glowing thruster at tail"
- Meteor: "64x64 asteroid, chunky pixels, grayscale so it can be tinted"
- Ore: "10x10 shiny ore crystal, yellow, single frame"

## Wiring real sprites

In `src/scenes/GameScene.js` → `preload()`, replace the placeholder call with:

```js
this.load.image('ship_player', 'assets/sprites/ship_player.png');
this.load.image('ship_npc',    'assets/sprites/ship_npc.png');
this.load.image('meteor',      'assets/sprites/meteor.png');
this.load.image('ore',         'assets/sprites/ore.png');
this.load.image('spark',       'assets/sprites/spark.png');
```

Keep dimensions identical or adjust `setCircle(...)` hit-box calls in the
entity files accordingly.
