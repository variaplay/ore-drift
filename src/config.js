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
  fuelPerOre: 0.8,
  magnetRadius: 170,
  laserRange: 220,
  laserDps: 40,
};

export const METEOR = {
  count: 70,
  minR: 18,
  maxR: 46,
  hpPerRadius: 1.6,
  oreYield: 0.6,
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
  { hull: 0x2f8f5a, accent: 0x7bffa0 }, // mint
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
  crystal: 0x9bffe5,
  crystalHot: 0x3be0b8,
  ore: 0xffd66b,
  star: 0xffffff,
};
