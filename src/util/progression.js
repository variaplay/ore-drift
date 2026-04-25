export const BANK_KEY = 'oredrift.oreBank';
export const UPGRADES_KEY = 'oredrift.upgrades';

export const UPGRADE_DEFS = [
  {
    key: 'fuelTank',
    label: 'FUEL TANK',
    desc: '+8% max fuel',
    maxLevel: 5,
    baseCost: 80,
    costStep: 55,
  },
  {
    key: 'magnet',
    label: 'MAGNET',
    desc: '+7% pull range',
    maxLevel: 5,
    baseCost: 90,
    costStep: 60,
  },
  {
    key: 'laser',
    label: 'LASER',
    desc: '+6% mining DPS',
    maxLevel: 5,
    baseCost: 100,
    costStep: 70,
  },
  {
    key: 'boost',
    label: 'BOOST',
    desc: '-6% boost drain',
    maxLevel: 5,
    baseCost: 75,
    costStep: 50,
  },
];

export function loadOreBank() {
  try {
    const n = parseInt(localStorage.getItem(BANK_KEY), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveOreBank(amount) {
  const n = Math.max(0, Math.floor(amount));
  try { localStorage.setItem(BANK_KEY, String(n)); } catch {}
  return n;
}

export function addOreBank(amount) {
  return saveOreBank(loadOreBank() + Math.max(0, Math.floor(amount)));
}

export function loadUpgrades() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(UPGRADES_KEY) || '{}') || {}; } catch {}
  const upgrades = {};
  for (const def of UPGRADE_DEFS) {
    const level = Math.floor(raw[def.key] || 0);
    upgrades[def.key] = Math.max(0, Math.min(def.maxLevel, level));
  }
  return upgrades;
}

export function saveUpgrades(upgrades) {
  try { localStorage.setItem(UPGRADES_KEY, JSON.stringify(upgrades)); } catch {}
  return upgrades;
}

export function upgradeCost(def, level) {
  if (level >= def.maxLevel) return null;
  return def.baseCost + level * def.costStep;
}

export function buyUpgrade(key) {
  const def = UPGRADE_DEFS.find((u) => u.key === key);
  if (!def) return { ok: false, reason: 'missing' };
  const upgrades = loadUpgrades();
  const level = upgrades[key] || 0;
  const cost = upgradeCost(def, level);
  if (cost === null) return { ok: false, reason: 'maxed' };
  const bank = loadOreBank();
  if (bank < cost) return { ok: false, reason: 'poor', cost, bank };
  upgrades[key] = level + 1;
  saveUpgrades(upgrades);
  const nextBank = saveOreBank(bank - cost);
  return { ok: true, bank: nextBank, upgrades };
}

export function playerStatMultipliers(upgrades = loadUpgrades()) {
  return {
    fuelMax: 1 + (upgrades.fuelTank || 0) * 0.08,
    magnetRadius: 1 + (upgrades.magnet || 0) * 0.07,
    laserDps: 1 + (upgrades.laser || 0) * 0.06,
    boostDrain: 1 - (upgrades.boost || 0) * 0.06,
  };
}
