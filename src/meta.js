// meta.js — persistence (localStorage) + loadout presets + derived run stats
const KEY = 'grimhold_save_v1';

export const PRESETS = {
  knight: {
    key: 'knight', name: 'KNIGHT',
    desc: 'Sword and plate. Balanced, stubborn, hard to move.',
    weapon: 'sword',
    armor: { kind: 'armor', id: 'preset_plate', name: 'Squire Plate', hp: 20, value: 40 },
    stats: { vigor: 3, strength: 2, agility: 1, resolve: 3 },
  },
  raider: {
    key: 'raider', name: 'RAIDER',
    desc: 'Axe and speed. Hit first, sever often, loot fast.',
    weapon: 'axe',
    armor: null,
    stats: { vigor: 1, strength: 3, agility: 3, resolve: 1 },
  },
  penitent: {
    key: 'penitent', name: 'PENITENT',
    desc: 'Mace and iron faith. High vigor, little else.',
    weapon: 'mace',
    armor: null,
    stats: { vigor: 4, strength: 1, agility: 1, resolve: 2 },
  },
};

// Stat effects: Vigor = +15 max HP, Strength = +8% damage,
// Agility = +12 stamina & +4% move speed, Resolve = -12% stagger/knockback
// taken & +10% stamina regen. Heavy armor (20+ HP) = -8% move speed but
// +15% stagger resist.
export function deriveStats(s, armor) {
  const heavy = armor && armor.hp >= 20;
  return {
    maxHp: 100 + s.vigor * 15 + (armor ? armor.hp : 0),
    maxStamina: 100 + s.agility * 12,
    dmgMult: 1 + s.strength * 0.08,
    speedMult: 1 + s.agility * 0.04 - (heavy ? 0.08 : 0),
    staggerRes: Math.min(0.6, s.resolve * 0.12 + (heavy ? 0.15 : 0)),
    regenMult: 1 + s.resolve * 0.10,
    heavyArmor: heavy,
  };
}

function def() {
  return { gold: 0, stash: [], equipWeaponId: null, equipArmorId: null };
}

export function getMeta() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return def();
    const m = JSON.parse(raw);
    return { ...def(), ...m };
  } catch (e) {
    return def();
  }
}

export function saveMeta(m) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) { /* private mode etc. */ }
}

export function addRunRewards(items, gold) {
  const m = getMeta();
  m.gold += gold;
  m.stash.push(...items);
  saveMeta(m);
  return m;
}

export function setEquip(weaponId, armorId) {
  const m = getMeta();
  m.equipWeaponId = weaponId;
  m.equipArmorId = armorId;
  saveMeta(m);
}
