// mapglb.js — load a Dark Fantasy castle scene exported from Unity (.glb) as the
// GRIMHOLD level. Builds AABB colliders + floor height lookup from mesh bounds so
// the existing combat/movement code (which expects a `level` object) keeps working.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BASE = import.meta.env.BASE_URL + 'assets';

// On GitHub Pages the repo glb is a Git-LFS pointer (not the real file), so for
// *.github.io we load from the CORS-enabled cloudflared tunnel serving the real
// 263 MB file. Locally we use the same-origin public/ asset.
const IS_PROD = typeof location !== 'undefined' && location.hostname.endsWith('github.io');
export const CASTLE_URL = IS_PROD
  ? 'https://williams-those-questionnaire-focused.trycloudflare.com/cathedral.glb'
  : `${BASE}/castle/cathedral.glb`;

// Build a level-compatible object from a loaded glb scene.
// Returns: { root, colliders, floors, floorHeightAt, raycastWall, gate, training,
//            ambushVolumes, enemySpawns, spawn, extract, vaultCell, gateCell, rune }
export async function loadCastle(url, opts = {}) {
  const loader = new GLTFLoader();
  const gltf = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const colliders = [];
  const floors = [];
  const meshes = [];

  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes.push(o);
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o);
    if (box.isEmpty()) return;
    const min = box.min, max = box.max;
    const size = new THREE.Vector3().subVectors(max, min);
    // skip tiny decorative props (torches, flags, foliage) from collision
    if (size.y < 0.4 || (size.x < 0.3 && size.z < 0.3)) return;
    colliders.push({ min: { x: min.x, y: min.y, z: min.z }, max: { x: max.x, y: max.y, z: max.z }, active: true });
    // treat broad horizontal surfaces as floors (top plate walkable)
    if (size.y < 0.6 && (size.x > 1.2 || size.z > 1.2)) {
      floors.push({ x1: min.x, z1: min.z, x2: max.x, z2: max.z, y: max.y });
    }
  });

  // ---- apply Dark Fantasy stone texture to all meshes (glb has no materials) ----
  const texLoader = new THREE.TextureLoader();
  const tex = await new Promise((res) => texLoader.load(`${BASE}/darkfantasy/PolygonDarkFantasy_Texture_01_A.png`, res, undefined, () => res(null)));
  if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
  const mat = new THREE.MeshStandardMaterial({
    map: tex || null,
    color: tex ? 0xffffff : 0x6a6a72,
    roughness: 0.85, metalness: 0.05,
  });
  for (const o of meshes) {
    o.material = mat;
    o.castShadow = false; o.receiveShadow = false;
  }

  // ---- level API (mirrors buildLevel return shape) ----
  function floorHeightAt(x, z, refY) {
    let best = -Infinity;
    const step = (opts.stepHeight) || 0.6;
    for (const f of floors) {
      if (x >= f.x1 && x <= f.x2 && z >= f.z1 && z <= f.z2) {
        if (f.y <= refY + step && f.y > best) best = f.y;
      }
    }
    return best === -Infinity ? refY - 8 : best;
  }

  function collideCircle(pos, radius, height) {
    for (const c of colliders) {
      if (!c.active) continue;
      if (c.max.y < pos.y + 0.3 || c.min.y > pos.y + height) continue;
      const cx = Math.max(c.min.x, Math.min(pos.x, c.max.x));
      const cz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
      } else {
        const px = Math.min(pos.x - c.min.x + radius, c.max.x - pos.x + radius);
        const pz = Math.min(pos.z - c.min.z + radius, c.max.z - pos.z + radius);
        if (px < pz) pos.x += (pos.x - (c.min.x + c.max.x) / 2 > 0) ? px : -px;
        else pos.z += (pos.z - (c.min.z + c.max.z) / 2 > 0) ? pz : -pz;
      }
    }
  }

  function raycastWall(origin, dir, maxDist = 50) {
    // simple AABB raycast (slab method) returning hit dist or maxDist
    let best = maxDist;
    for (const c of colliders) {
      let tmin = -Infinity, tmax = Infinity;
      for (const ax of ['x', 'y', 'z']) {
        const o = origin[ax], d = dir[ax];
        const lo = c.min[ax], hi = c.max[ax];
        if (Math.abs(d) < 1e-8) { if (o < lo || o > hi) break; }
        else {
          let t1 = (lo - o) / d, t2 = (hi - o) / d;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
          if (tmin > tmax) break;
        }
      }
      if (tmin > 0 && tmin < best) best = tmin;
    }
    return best;
  }

  // player spawn: front-center of the cathedral footprint (approx)
  const bbox = new THREE.Box3().setFromObject(root);
  const cx = (bbox.min.x + bbox.max.x) / 2;
  const cz = (bbox.min.z + bbox.max.z) / 2;

  return {
    root,
    colliders,
    floors,
    meshCount: meshes.length,
    floorHeightAt,
    collideCircle,
    raycastWall,
    spawn: { x: cx, z: cz + (bbox.max.z - bbox.min.z) * 0.35 },
    extract: { x: bbox.max.x - 2, z: cz },
    vaultCell: { x: cx, z: bbox.min.z + 2 },
    gateCell: { x: cx, z: cz },
    gate: { open: false, collider: { active: true }, mesh: { position: { y: 1.7 } } },
    rune: { material: { color: { setHex() {} } } },
    training: { spawn: { x: cx, z: cz } },
    ambushVolumes: [],
    enemySpawns: deriveEnemySpawns(bbox, floors),
  };
}

function deriveEnemySpawns(bbox, floors) {
  // place a ring of enemy spawns around the footprint
  const cx = (bbox.min.x + bbox.max.x) / 2;
  const cz = (bbox.min.z + bbox.max.z) / 2;
  const rx = (bbox.max.x - bbox.min.x) / 2 - 2;
  const rz = (bbox.max.z - bbox.min.z) / 2 - 2;
  const types = ['bandit', 'knight', 'skeleton'];
  const out = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    out.push({ type: types[i % 3], x: cx + Math.cos(a) * rx * 0.7, z: cz + Math.sin(a) * rz * 0.7 });
  }
  return out;
}
