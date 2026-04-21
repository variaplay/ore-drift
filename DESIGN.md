# Ore Drift — Game Design

A slither.io-inspired space mining game. Steer a ship through an asteroid
field, auto-mine meteors, bank ore. Runs in any browser, plays on phones
with one thumb. Single-player today with NPC rivals that simulate real
players; drop-in multiplayer later.

## 1. Pitch

> **60 seconds at a time.** You glide through a starfield. Meteors drift
> past. Your laser locks on automatically — all you do is *steer where
> the good rocks are* without crashing or running out of fuel. Ore you
> collect refills your tank and levels you up. Rival ships are chasing
> the same rocks.

## 2. Design pillars

1. **One-gesture control.** Drag to steer, hold to boost. Nothing else.
2. **Constant motion.** The ship never stops, slither-style. Decisions
   are about *direction*, not stop/go.
3. **Reward pass-through, not precision.** You never aim. The game
   rewards flying near valuable things.
4. **Always 2D, always readable.** Retro pixel sprites on a dark
   starfield. Every object's role (ship / rock / ore / rival) is
   recognizable at a glance, even on a phone.
5. **Multiplayer-shaped from day one.** Players and NPCs share one
   code path. NPC AI produces the same `{heading, boost}` intent a
   remote peer would send.

## 3. Core loop

```
steer → pass near meteor → laser auto-mines → meteor shatters →
ore magnetizes to you → fuel refills + ore bank grows → steer to next
```

Failure state: fuel hits zero → game over → tap to restart.
(Future: death drops your ore as a cloud rivals can scoop — slither's
"you die, you feed the leaderboard" loop.)

## 4. Controls

| Input             | Desktop                  | Mobile                        |
| ----------------- | ------------------------ | ----------------------------- |
| Steer             | Move mouse               | Drag finger                   |
| Boost             | Hold left mouse button   | Press & hold anywhere         |
| Restart after death | Click                  | Tap                           |

- No keyboard needed. No buttons. No menus mid-run.
- Ship smoothly rotates toward the pointer — you never feel a snap.
- Boost burns fuel faster but gets you to distant ore before rivals do.

## 5. Ship mechanics

| Stat         | Value (tune in `src/config.js`)             |
| ------------ | -------------------------------------------- |
| Base speed   | 180 px/s — always moving                     |
| Boost speed  | 340 px/s — costs fuel                        |
| Turn rate    | 2.8 rad/s — wide, feels weighty              |
| Laser range  | 220 px — auto-fires at nearest meteor        |
| Laser DPS    | 40 — a medium meteor breaks in ~1–2 s        |
| Magnet range | 90 px — ore you pass close to flies to you   |
| Fuel max     | 100, drains 1.4/s baseline, 6/s boosting     |
| Ore → fuel   | +3.5 fuel per 1 ore picked up                |

The ship's wide turn radius *is* the "space-physics feel" without true
inertia; it avoids fiddly braking on a touchscreen.

## 6. Meteors

- Spawn in a ring around world origin, ~70 on screen at once.
- Radius ∈ [18, 46] px. HP scales with radius.
- When shattered:
  - Drop ore chunks equal to `round(radius * 0.6)`.
  - Large ones split into one smaller fragment (replayable field).
- Drift slowly; bounce off each other.
- Tint shifts from cool gray → hot orange as HP drops — visual damage
  feedback, no health bars needed.

## 7. Ore

- Magnetizes to the nearest ship within 90 px radius (player OR NPC).
- Rivals can steal it — first-come-first-served creates micro-races.
- Each chunk: +1 ore, +3.5 fuel.
- Lifetime 12 s if unclaimed, then fades (keeps world tidy).

## 8. NPC rivals (simulating other players)

Five NPCs spawn around the arena. Each:

- Picks a nearby meteor as its target (biased random from the 4
  closest so they don't all dogpile the same rock).
- Retargets every ~1.5 s or when its target dies.
- Occasionally boosts (1% per frame, with fuel gate).
- Drives the exact same `Ship` class as the player — same laser,
  same magnet, same fuel rules.

Their `update()` returns `{heading, boost}` — the same packet a
real networked peer would send. Swapping in multiplayer later means
replacing `NpcController` with a `RemoteController` that reads
WebSocket messages; no changes to `Ship`, physics, rendering, or scene.

## 9. Session shape

- Run length: 60–180 s (until fuel hits zero).
- Keep running while you're collecting well; die if you choke on a
  fuel-poor stretch.
- Restart is instant — tap once, back in.
- Meta layer (future): persistent ore bank between runs → upgrade
  shop (bigger tank, stronger laser, faster turn, bigger magnet).

## 10. Art direction

- **Style:** retro 8/16-bit pixel art. Chunky silhouettes.
- **Palette:** deep blue-black space, cyan player, magenta rivals,
  warm gold ore, cool gray meteors that flare orange when damaged.
- **Source:** placeholder sprites are generated in-code on boot
  (`src/util/placeholderArt.js`) so the game runs with zero assets.
  Real art drops into `assets/sprites/` as PNGs — see the README
  there for sizes and PixelLab prompt hints.
- **VFX:** additive particle thrusters, 2-layer laser beam
  (thin bright core + soft glow), parallax starfield (3 layers).

## 11. Technical architecture

```
main.js
  └── GameScene (world, collisions, spawning)
        ├── Ship (shared — player & NPC)
        │     └── controller: {update() → {heading, boost}}
        │           ├── LocalInputController   (human)
        │           ├── NpcController          (AI, today)
        │           └── RemoteController       (network, future)
        ├── Meteor (HP, shatter)
        ├── Ore    (magnetize, expire)
        └── HUDScene (fuel bar, ore count, restart)
```

All physics go through Phaser's Arcade physics system (see
`src/main.js` config) — ship↔meteor collision, ore↔ship overlap,
meteor↔meteor bouncing are all Arcade-driven.

**Why this shape matters for multiplayer:**

- Game state lives in one scene, one source of truth.
- Entities are identified by `Ship` instances, not by "is it me?".
- Ship behavior is 100% a function of `{heading, boost}` intent +
  world state — deterministic enough to replay server snapshots.

## 12. Roadmap

**Now — v0 (this scaffold)**
- Steer, boost, auto-mine, auto-pickup, NPC rivals, fuel death.

**v0.1 — feel**
- Screen shake on shatter, hit-stop micro-frame, post-fx bloom.
- Death drops ore cloud.
- Sound: laser hum, shatter, pickup chime, low-fuel warning.

**v0.2 — meta**
- Persistent ore → upgrade shop between runs.
- Daily seeded arena + leaderboard (local).

**v1 — multiplayer**
- Colyseus or PartyKit server authoritative on positions.
- Replace `NpcController` with `RemoteController`.
- Server runs its own NPCs to fill empty lobbies (same class!).
- Lag compensation: client predicts with local Ship, reconciles on
  server snapshots.

## 13. Non-goals

- True Newtonian inertia. Too fiddly on mobile; the wide turn radius
  already carries the "mass" feeling.
- Shooting other ships in v0. Ramming + laser-trail kills is a
  v1 multiplayer feature, not single-player padding.
- 3D anything. Phaser is 2D, the pixel-art direction is 2D, and
  mobile screens are small — 2D reads better.
- Tutorials. The control scheme is one gesture; the on-screen hint
  "Drag to steer · Hold to boost" is the tutorial.
