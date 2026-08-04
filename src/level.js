// level.js — the GRIMHOLD labyrinth-castle, built from the Synty POLYGON Dark
// Fantasy kit. ALL structure is data-driven (src/leveldata.js): colliders,
// floor rects, torch lights and spawn tables are generated synchronously from
// the placement tables; the FBX visuals load async and instance per module
// type (one InstancedMesh per module, ~45 draw calls for the whole castle).
//
// Map flow: ruined bailey (spawn) -> gatehouse chokepoint -> great hall
// (two levels, balconies) -> chapel / armory wings -> two stair shafts down
// into the labyrinth (vault, boss arena, extraction gate room). A collapsed
// hall floor is a one-way drop shortcut. Training room lives far to the east.
import * as THREE from 'three';
import { CFG } from './config.js';
import {
  CELL, STORY, DUNGEON_Y, ASSET_BASE, MODULES,
  MAZE, MAZE_COL0, MAZE_ROW0, MAZE_DOORS, SHAFTS,
  GROUND_RECTS, BOUNDS, BAILEY_WALLS, ROOMS, BALCONY, HALL_PILLARS, DAIS,
  PROPS, TORCH_POINTS, TRAINING, LOOT_SPAWNS, ENEMY_SPAWNS, AMBUSH_VOLUMES,
  SPAWN, EXTRACT, VAULT_CELL, GATE_CELL, parseMaze, mazePath,
} from './leveldata.js';
import { expandRooms } from './rooms.js';
// buildLevel — returns a lightweight fallback arena immediately (flat courtyard
// with perimeter walls). The real Dark Fantasy castle is loaded async from a
// Unity-exported .glb (see main.js -> mapglb) and overrides visuals/colliders.
export function buildLevel(scene) {
  const colliders = [];   // {min:{x,y,z}, max:{x,y,z}, active}
  const floors = [];      // {x1,z1,x2,z2,y}
  const torches = [];      // {light, base, phase}
  const placements = new Map();

  const place = (mod, x, y, z, ry = 0, s = 1) => {
    if (!placements.has(mod)) placements.set(mod, []);
    placements.get(mod).push({ x, y, z, ry, s });
  };

  function addCollider(cx, yBase, cz, w, h, d) {
    const col = {
      min: { x: cx - w / 2, y: yBase, z: cz - d / 2 },
      max: { x: cx + w / 2, y: yBase + h, z: cz + d / 2 },
      active: true,
    };
    colliders.push(col);
    return col;
  }

  function addBoxVisual(cx, yBase, cz, w, h, d, color) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(cx, yBase + h / 2, cz);
    scene.add(mesh);
    return mesh;
  }

  // ---- fallback flat arena (overridden by castle.glb) ----
  const A = 40; // half-size
  const floorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(A * 2, 1, A * 2),
    new THREE.MeshLambertMaterial({ color: 0x2a2a30 }));
  floorMesh.position.set(0, -0.5, 0);
  scene.add(floorMesh);
  floors.push({ x1: -A, z1: -A, x2: A, z2: A, y: 0 });
  // perimeter walls
  const wh = 6;
  addBoxVisual(0, 0, -A, A * 2, wh, 1, 0x1a1a20);
  addBoxVisual(0, 0, A, A * 2, wh, 1, 0x1a1a20);
  addBoxVisual(-A, 0, 0, 1, wh, A * 2, 0x1a1a20);
  addBoxVisual(A, 0, 0, 1, wh, A * 2, 0x1a1a20);
  addCollider(0, 0, -A, A * 2, wh, 1);
  addCollider(0, 0, A, A * 2, wh, 1);
  addCollider(-A, 0, 0, 1, wh, A * 2);
  addCollider(A, 0, 0, 1, wh, A * 2);

  const SPAWN = { x: 0, z: A - 6 };
  const EXTRACT = { x: 0, z: -A + 4 };
  const TRAINING = { spawn: { x: 0, z: 0 }, dummySpawns: [
    { x: -4, z: -4 }, { x: 4, z: -4 }, { x: -4, z: 4 }, { x: 4, z: 4 } ] };
  const ENEMY_SPAWNS = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    ENEMY_SPAWNS.push({ type: ['bandit', 'knight', 'skeleton'][i % 3], x: Math.cos(a) * 18, z: Math.sin(a) * 18 });
  }
  const LOOT_SPAWNS = [
    { x: 8, z: 8 }, { x: -8, z: -8 }, { x: 8, z: -8 }, { x: -8, z: 8 }, { x: 0, z: 0 }];
  const AMBUSH_VOLUMES = [];
  const gate = { open: false, collider: { active: true }, mesh: { position: { y: 1.7 } } };
  const rune = { material: { color: { setHex() {} } } };
  const wispPath = [{ x: 0, z: 0 }];

  function floorHeightAt(x, z, refY) {
    for (const f of floors) {
      if (x >= f.x1 && x <= f.x2 && z >= f.z1 && z <= f.z2) return f.y;
    }
    return refY - 8;
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
        pos.z += radius;
      }
    }
  }
  function raycastWall(origin, dir, maxDist = 50) {
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
  function wallDistance(x, z, maxD = 6) { return raycastWall({ x, y: 1, z }, { x: 1, y: 0, z: 0 }, maxD); }

  return {
    colliders, floors, torches,
    lootSpawns: LOOT_SPAWNS, enemySpawns: ENEMY_SPAWNS, ambushVolumes: AMBUSH_VOLUMES,
    gate, rune,
    training: { spawn: TRAINING.spawn, dummySpawns: TRAINING.dummySpawns },
    spawn: SPAWN,
    extractPos: EXTRACT,
    wispPath,
    floorHeightAt, collideCircle, raycastWall, wallDistance,
    ready: false,        // set true once castle.glb overrides this
  };
}

// ---- FBX instancing ----------------------------------------------------------
async function loadVisuals(scene, placements, gate) {
  try {
    const [{ FBXLoader }, { mergeGeometries }] = await Promise.all([
      import('three/addons/loaders/FBXLoader.js'),
      import('three/addons/utils/BufferGeometryUtils.js'),
    ]);
    const texLoader = new THREE.TextureLoader();
    const loadTex = (u) => new Promise((res, rej) => texLoader.load(u, res, undefined, rej));
    const [tex, emis] = await Promise.all([
      loadTex(`${ASSET_BASE}/PolygonDarkFantasy_Texture_01_A.png`),
      loadTex(`${ASSET_BASE}/PolygonDarkFantasy_Emissive_01_A.png`),
    ]);
    tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
    emis.colorSpace = THREE.SRGBColorSpace; emis.flipY = false;
    const mat = new THREE.MeshLambertMaterial({
      map: tex, emissiveMap: emis,
      emissive: new THREE.Color(0xffb060), emissiveIntensity: CFG.world?.emissive ?? 1.0,
    });

    const loader = new FBXLoader();
    const geoCache = new Map();
    const loadGeo = async (key) => {
      if (geoCache.has(key)) return geoCache.get(key);
      const resp = await fetch(`${ASSET_BASE}/${MODULES[key].file}`);
      if (!resp.ok) throw new Error('fetch failed: ' + MODULES[key].file);
      const buf = await resp.arrayBuffer();
      const obj = loader.parse(buf, '');
      obj.updateMatrixWorld(true);
      const parts = [];
      obj.traverse((o) => {
        if (!o.isMesh) return;
        let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
        g.scale(0.01, 0.01, 0.01); // Synty FBX are authored in cm
        // keep position / normal / uv only (Synty FBX ship proper UVs)
        if (!g.attributes.uv) {
          g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        }
        parts.push(g.index ? g.toNonIndexed() : g);
      });
      const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
      if (!merged || !merged.attributes.uv) throw new Error('merge lost geometry/uv for ' + key);
      geoCache.set(key, merged);
      return merged;
    };

    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(),
      S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    const jobs = [...placements.keys()].map(async (key) => {
      const list = placements.get(key);
      let geo;
      try { geo = await loadGeo(key); } catch (e) { console.warn('[level] skip module', key, e); return; }
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => {
        Q.setFromAxisAngle(UP, p.ry || 0);
        V.set(p.x, p.y, p.z);
        S.setScalar(p.s || 1);
        M.compose(V, Q, S);
        inst.setMatrixAt(i, M);
      });
      inst.instanceMatrix.needsUpdate = true;
      scene.add(inst);
    });
    await Promise.all(jobs);

    // extraction portcullis: unique mesh (slides open), wrapped so
    // position.y=1.7 is closed and -1.8 is fully sunk (main.js semantics)
    try {
      const geo = await loadGeo('gate');
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const cx = (bb.min.x + bb.max.x) / 2;
      const scale = 2.7 / (bb.max.x - bb.min.x);
      geo.translate(-cx, -bb.min.y, 0);
      geo.scale(scale, scale, scale);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, -1.7, 0); // inner offset: closed pose at wrapper y=1.7
      const wrap = new THREE.Group();
      wrap.add(mesh);
      wrap.position.set(gate.x, 1.7, gate.z);
      scene.add(wrap);
      if (gate.mesh) scene.remove(gate.mesh); // drop the placeholder
      gate.mesh = wrap;
    } catch (e) { console.warn('[level] portcullis visual unavailable', e); }

    console.log('[level] Dark Fantasy kit loaded:', placements.size, 'module types,',
      [...placements.values()].reduce((s, l) => s + l.length, 0), 'instances');
  } catch (e) {
    console.warn('[level] visuals unavailable — colliders/floors still live:', e);
  }
}
