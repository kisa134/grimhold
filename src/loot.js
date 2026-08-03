// loot.js — world loot spawns, enemy drops, pickups, run inventory
import * as THREE from 'three';
import { makeWeaponItem, buildViewmodel, weaponStats, RARITY } from './weapons.js';

const ARMOR_POOL = [
  { name: 'Rusted Helm', hp: 10, value: 25 },
  { name: 'Chainmail', hp: 18, value: 45 },
  { name: 'Plate Cuirass', hp: 25, value: 70 },
];
const WEAPON_KEYS = ['sword', 'axe', 'mace'];

let iid = 1;
function armorItem(def) {
  return { kind: 'armor', id: 'a' + (iid++) + '_' + Math.floor(Math.random() * 1e6), ...def };
}

function rollRarity() {
  const r = Math.random();
  if (r < 0.08) return 'cursed';
  if (r < 0.30) return 'rare';
  return 'common';
}

export class LootSystem {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.entries = []; // {item, mesh, baseY, spin}
  }

  _meshFor(item, x, y, z) {
    let mesh;
    if (item.kind === 'gold') {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.22, 0.34),
        new THREE.MeshLambertMaterial({ color: 0xd8a820, emissive: 0x664400 })
      );
    } else if (item.kind === 'weapon') {
      mesh = buildViewmodel(item);
      mesh.scale.setScalar(0.9);
      const s = weaponStats(item);
      // rarity glow marker under the weapon
      const glow = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.05, 0.3),
        new THREE.MeshBasicMaterial({ color: s.glow })
      );
      glow.position.y = -0.25;
      mesh.add(glow);
    } else if (item.kind === 'armor') {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.4, 0.3),
        new THREE.MeshLambertMaterial({ color: 0x7a8088, emissive: 0x1a2028 })
      );
    } else { // relic
      mesh = new THREE.Group();
      const cup = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.34, 0.3),
        new THREE.MeshLambertMaterial({ color: 0xe8c85a, emissive: 0x7a5a10 })
      );
      const stem = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.2, 0.1),
        new THREE.MeshLambertMaterial({ color: 0xc8a84a, emissive: 0x5a4508 })
      );
      stem.position.y = -0.25;
      mesh.add(cup); mesh.add(stem);
    }
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    return mesh;
  }

  add(item, x, y, z, id) {
    const mesh = this._meshFor(item, x, y, z);
    // stable id lets the mp host/clients refer to the same world entry
    const entry = {
      item, mesh, baseY: y, spin: Math.random() * 6,
      id: id || ('l' + (iid++) + '_' + Math.floor(Math.random() * 1e6)),
    };
    this.entries.push(entry);
    return entry;
  }

  spawnWorldLoot(spawns) {
    for (const s of spawns) {
      const y = (s.y !== undefined ? s.y : 0) + 0.55;
      if (s.table === 'gold') {
        this.add({ kind: 'gold', name: 'Gold Pouch', amount: 15 + Math.floor(Math.random() * 25) }, s.x, y, s.z);
      } else if (s.table === 'weapon') {
        this.add(makeWeaponItem(WEAPON_KEYS[Math.floor(Math.random() * 3)], rollRarity()), s.x, y + 0.2, s.z);
      } else if (s.table === 'cursed') {
        this.add(makeWeaponItem(WEAPON_KEYS[Math.floor(Math.random() * 3)], 'cursed'), s.x, y + 0.2, s.z);
      } else if (s.table === 'armor') {
        this.add(armorItem(ARMOR_POOL[Math.floor(Math.random() * ARMOR_POOL.length)]), s.x, y, s.z);
      } else if (s.table === 'relic') {
        this.add({ kind: 'relic', id: 'r' + (iid++), name: 'Gilded Relic', value: 100 }, s.x, y + 0.1, s.z);
      }
    }
  }

  // Drops when an enemy dies
  rollDrop(x, y, z, boss) {
    const goldAmt = boss ? 60 + Math.floor(Math.random() * 40) : 10 + Math.floor(Math.random() * 25);
    this.add({ kind: 'gold', name: 'Gold Pouch', amount: goldAmt }, x + 0.3, y + 0.55, z + 0.3);
    const roll = Math.random();
    if (boss) {
      this.add(makeWeaponItem(WEAPON_KEYS[Math.floor(Math.random() * 3)], 'rare'), x - 0.4, y + 0.75, z);
    } else if (roll < 0.30) {
      this.add(makeWeaponItem(WEAPON_KEYS[Math.floor(Math.random() * 3)], rollRarity()), x - 0.4, y + 0.75, z);
    } else if (roll < 0.55) {
      this.add(armorItem(ARMOR_POOL[Math.floor(Math.random() * ARMOR_POOL.length)]), x - 0.4, y + 0.55, z);
    }
  }

  nearest(pos, radius) {
    let best = null, bestD = radius;
    for (const e of this.entries) {
      const d = e.mesh.position.distanceTo(pos);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  take(entry) {
    this.scene.remove(entry.mesh);
    this.entries.splice(this.entries.indexOf(entry), 1);
  }

  update(dt) {
    for (const e of this.entries) {
      e.spin += dt * 1.6;
      e.mesh.rotation.y = e.spin;
      e.mesh.position.y = e.baseY + Math.sin(e.spin * 1.4) * 0.08;
    }
  }

  reset() {
    for (const e of this.entries) this.scene.remove(e.mesh);
    this.entries.length = 0;
  }
}
