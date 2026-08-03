// weapons.js — weapon definitions, rarity, first-person viewmodels
// (Synty models when loaded, boxes as fallback)
// TUNING: WEAPONS holds the base table; numeric stats are overridden live by
// CFG.weapons (src/config.js) inside weaponStats() — panel edits apply on the
// next stat read (every frame for the wielded weapon).
import * as THREE from 'three';
import { MODELS, buildWeaponVisual } from './models.js';
import { CFG } from './config.js';

export const WEAPONS = {
  sword: {
    key: 'sword', name: 'Arming Sword', type: 'slash',
    damage: 22, cooldown: 0.50, windup: 0.10, swing: 0.22, recover: 0.20,
    range: 2.5, stagger: 0.35, sever: 0.35,
    heavyMult: 2.0, heavyWindup: 0.28,
  },
  axe: {
    key: 'axe', name: 'Headsman Axe', type: 'chop',
    damage: 34, cooldown: 0.77, windup: 0.16, swing: 0.26, recover: 0.30,
    range: 2.4, stagger: 0.55, sever: 0.55,
    heavyMult: 2.2, heavyWindup: 0.38,
  },
  mace: {
    key: 'mace', name: 'Morningstar', type: 'blunt',
    damage: 26, cooldown: 0.63, windup: 0.14, swing: 0.24, recover: 0.26,
    range: 2.3, stagger: 1.5, sever: 0.08,
    heavyMult: 1.9, heavyWindup: 0.32,
  },
};

export const RARITY = {
  common: { key: 'common', label: 'Common', mult: 1.0,  severBonus: 0,    color: '#b9b9b9', glow: 0x888888, cursed: false },
  rare:   { key: 'rare',   label: 'Rare',   mult: 1.35, severBonus: 0.10, color: '#4d8dff', glow: 0x3366ff, cursed: false },
  cursed: { key: 'cursed', label: 'Cursed', mult: 1.65, severBonus: 0.15, color: '#b04dff', glow: 0x8a2be2, cursed: true  },
};

let uid = 1;
export function makeWeaponItem(key, rarity = 'common') {
  const w = WEAPONS[key];
  const r = RARITY[rarity];
  return {
    kind: 'weapon',
    id: 'w' + (uid++) + '_' + Math.floor(Math.random() * 1e6),
    key, rarity,
    name: `${r.label} ${w.name}`,
    value: Math.round(25 * r.mult + w.damage),
  };
}

// Accepts a weapon item ({key,rarity}) or a bare weapon key string.
// Numeric stats come from the live CFG store so tuning applies immediately.
export function weaponStats(itemOrKey) {
  const key = typeof itemOrKey === 'string' ? itemOrKey : itemOrKey.key;
  const rar = typeof itemOrKey === 'string' ? 'common' : (itemOrKey.rarity || 'common');
  const w = { ...WEAPONS[key] };
  Object.assign(w, CFG.weapons[key] || {});
  const r = RARITY[rar];
  return {
    ...w,
    rarity: r.key, rarityLabel: r.label, color: r.color, glow: r.glow, cursed: r.cursed,
    damage: Math.round(w.damage * r.mult),
    sever: Math.min(0.9, w.sever + r.severBonus),
    itemName: typeof itemOrKey === 'string' ? w.name : itemOrKey.name,
  };
}

// First-person weapon model. Uses the Synty weapon FBX when the model layer is
// ready; otherwise builds the original box placeholder. Origin at the grip.
export function buildViewmodel(itemOrKey) {
  const s = weaponStats(itemOrKey);
  if (MODELS.ready) {
    const v = buildWeaponVisual(s.key);
    if (v) {
      if (s.cursed) {
        v.traverse((o) => {
          if (o.isMesh) {
            o.material.color.setHex(0x8a5aaa);
            o.material.emissive = new THREE.Color(0x2a0a3a);
          }
        });
      }
      const g = new THREE.Group();
      g.add(v);
      g.userData.stats = s;
      return g;
    }
  }
  const g = new THREE.Group();
  const metal = new THREE.MeshLambertMaterial({ color: s.cursed ? 0x6a4a7a : 0x9aa0ad });
  if (s.cursed) metal.emissive = new THREE.Color(0x2a0a3a);
  const edge = new THREE.MeshLambertMaterial({ color: s.cursed ? 0x8a5aaa : 0xc8ccd6 });
  const wood = new THREE.MeshLambertMaterial({ color: 0x4a3520 });
  const box = (mat, w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  if (s.key === 'sword') {
    box(wood, 0.05, 0.24, 0.05, 0, 0.06, 0);          // grip
    box(metal, 0.24, 0.045, 0.07, 0, 0.20, 0);        // crossguard
    box(metal, 0.065, 0.72, 0.025, 0, 0.58, 0);       // blade
    box(edge, 0.02, 0.72, 0.028, 0.034, 0.58, 0);     // edge glint
  } else if (s.key === 'axe') {
    box(wood, 0.05, 0.78, 0.05, 0, 0.24, 0);          // haft
    box(metal, 0.30, 0.24, 0.045, 0.14, 0.56, 0);     // head
    box(edge, 0.06, 0.28, 0.05, 0.30, 0.56, 0);       // biting edge
    box(metal, 0.07, 0.10, 0.05, -0.05, 0.60, 0);     // back spike
  } else {
    box(wood, 0.05, 0.62, 0.05, 0, 0.18, 0);          // handle
    box(metal, 0.16, 0.16, 0.16, 0, 0.56, 0);         // head
    box(edge, 0.06, 0.06, 0.22, 0, 0.56, 0);          // spikes
    box(edge, 0.22, 0.06, 0.06, 0, 0.56, 0);
    box(edge, 0.06, 0.22, 0.06, 0, 0.56, 0);
  }
  g.userData.stats = s;
  return g;
}
