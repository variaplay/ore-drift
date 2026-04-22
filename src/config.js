export const WORLD = {
  size: 4000,
  starLayers: 3,
};

export const SHIP = {
  baseSpeed: 180,
  boostSpeed: 340,
  turnRate: 2.8,
  radius: 14,
  fuelMax: 100,
  fuelDrain: 1.4,
  boostDrain: 6,
  fuelPerOre: 1.6,
  magnetRadius: 170,
  laserRange: 220,
  laserDps: 40,
};

export const METEOR = {
  count: 70,
  minR: 18,
  maxR: 46,
  // Area-based scaling so a meteor twice as wide is 4× as much work AND
  // 4× the payoff. Feels intuitive: big rocks look like big rocks.
  hpPerArea: 0.09,
  oreYield: 0.0075,
  driftSpeed: 14,
  driftMax: 36,               // cap so random nudges can't accumulate into rockets
  wanderImpulse: 18,          // px/s added in a random direction per nudge
  wanderEveryMsMin: 1400,
  wanderEveryMsMax: 3800,
  crystalChance: 0.04,        // 4% of new meteors are rare crystals
  crystalHpMult: 3,
  crystalYieldMult: 8,
  crystalRadiusMult: 1.1,
};

// Large "mother" meteor event — spawns periodically, drifts in from the
// edge, shatters into a cluster of fragments. Gives runs a rhythm instead
// of flat farming.
export const MOTHER_METEOR = {
  radius: 90,
  hpMult: 0.6,                // on top of area*hpPerArea; ~11s to break solo
  yieldMult: 2.5,             // generous direct drop in addition to fragments
  fragmentCount: 10,
  fragmentRadiusMin: 28,
  fragmentRadiusMax: 38,
  fragmentOutwardSpeed: 50,
  firstSpawnMs: 18000,
  spawnIntervalMsMin: 45000,
  spawnIntervalMsMax: 90000,
  edgeDistanceFrac: 0.42,     // how far from center to spawn (0.5 = at rim)
};

export const ORE = {
  magnetAccel: 1500,
  maxSpeed: 420,
  lifetime: 12000,
  flingSpeedMin: 30,
  flingSpeedMax: 70,
  drag: 0.4,
  biasTowardMiner: 0.6, // 0 = uniform spray, 1 = all toward miner
  // extra pull as ore nears the ship — makes pickup feel "locked on"
  proximityBoost: 1.8,
};

export const NPC = {
  count: 5,
  seekJitter: 0.35,
  retargetMs: 1500,
};

// Distinct hull colors so each rival reads individually on the map & in combat.
// `hull` is the main body, `accent` is the cockpit/tip highlight (brighter tone).
// Laser and thrust particles use `accent`.
export const NPC_PALETTE = [
  { hull: 0xa4357a, accent: 0xff7bd1 }, // magenta
  { hull: 0xc26a2a, accent: 0xffa84d }, // orange
  { hull: 0x6b3fb5, accent: 0xb77dff }, // purple
  { hull: 0x994355, accent: 0xef9aa4 }, // coral (replaces mint — space-appropriate warm)
  { hull: 0xb39a2a, accent: 0xffde5c }, // yellow
  { hull: 0xa83340, accent: 0xff6f7b }, // red
  { hull: 0x2f78a6, accent: 0x6ec9f0 }, // azure
  { hull: 0x855321, accent: 0xe6a55a }, // amber
];

export const COLORS = {
  hullPlayer: 0x7df9ff,
  hullNpc: 0xff7bd1,
  laserPlayer: 0x9ff7ff,
  laserNpc: 0xff9ad4,
  meteor: 0x6b7ea8,
  meteorHot: 0xd98a3d,
  // Crystals were mint-teal; shifted to violet so they read as rare space
  // crystals rather than candy, and stay distinct from the cyan player laser.
  crystal: 0xc99eff,
  crystalHot: 0x6e2ec8,
  // Mother meteor: warm molten amber so it reads as a "burning alien rock"
  // at a glance against the starfield and the violet crystals.
  mother: 0xff9248,
  motherHot: 0xd44214,
  ore: 0xffd66b,
  star: 0xffffff,
};
