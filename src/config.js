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
  fuelPerOre: 3.5,
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
  driftSpeed: 6,
  crystalChance: 0.04,        // 4% of new meteors are crystals in open space
  crystalChanceInRadiation: 0.55, // but >50% inside radiation zones
  crystalHpMult: 3,
  crystalYieldMult: 8,
  crystalRadiusMult: 1.1,
};

export const ORE = {
  magnetAccel: 900,
  maxSpeed: 280,
  lifetime: 12000,
  flingSpeedMin: 30,
  flingSpeedMax: 70,
  drag: 0.6,
  biasTowardMiner: 0.6, // 0 = uniform spray, 1 = all toward miner
};

export const NPC = {
  count: 5,
  seekJitter: 0.35,
  retargetMs: 1500,
};

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
  zoneStorm: 0xa86b3d,
  zoneRadiation: 0xff4c6b,
};

export const ZONE = {
  radiation: {
    count: 3,
    radius: { min: 320, max: 520 },
    fuelDrainMult: 2.4,    // player fuel drain is multiplied while inside
  },
  storm: {
    count: 3,
    radius: { min: 360, max: 620 },
    extraMeteors: 22,      // extra meteors spawned inside per zone on init
    crystalBoost: 0.15,    // additional crystal chance inside storm zones
  },
  minSeparation: 300,      // don't overlap zones heavily
};
