# Ore Drift

Slither-style space mining. Drag to steer, hold to boost. Auto-mine
meteors, scoop the ore, don't run out of fuel.

See [`DESIGN.md`](./DESIGN.md) for the full gameplay design.

## Run it

No build step — it's plain HTML + ES modules + Phaser 3 from a CDN.
Any static file server works. From this directory:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Or with Node:

```sh
npx serve .
```

## Structure

```
index.html              # entry, loads Phaser from CDN + main.js
assets/sprites/         # drop PixelLab PNGs here (see README)
src/
  main.js               # Phaser game config
  config.js             # all tunable numbers
  scenes/
    GameScene.js        # world, spawning, collisions
    HUDScene.js         # fuel bar, ore count, restart
  entities/
    Ship.js             # one class used for player + NPCs
    Meteor.js
    Ore.js
  controllers/
    Controller.js       # base interface: update() → {heading, boost}
    LocalInputController.js
    NpcController.js    # simulates other players today;
                        # swap for RemoteController for multiplayer
  util/
    placeholderArt.js   # runtime-generated pixel sprites
```

## Swapping in real sprites

Put PNGs in `assets/sprites/` and update `GameScene.preload()` —
details in `assets/sprites/README.md`.
