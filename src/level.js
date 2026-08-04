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

const HPI = Math.PI / 2;

export function buildLevel(scene) {
  const colliders = [];   // {min:{x,y,z}, max:{x,y,z}, active}
  const floors = [];      // {x1,z1,x2,z2,y}
  const torches = [];     // {light, base, phase}
  const placements = new Map(); // moduleKey -> [{x,y,z,ry,s}]

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

  // ---- wall segments ---------------------------------------------------------
  // One 2.5 m wall module on a grid line. axis 'X': line z=lz, module spans
  // x[lx, lx+2.5]. axis 'Z': line x=lx, module spans z[lz, lz+2.5].
  function wallSeg(axis, lx, lz, y, variant, opts = {}) {
    if (variant === 'none') return;
    if (variant === 'door') variant = 'wallDoor';
    const mod = MODULES[variant];
    if (!mod) return;
    const h = mod.h || STORY;
    const key = variant;
    if (axis === 'X') place(key, lx, y, lz, 0);
    else place(key, lx, y, lz, -HPI);

    // colliders
    const t = (mod.t || 0.25);
    const opening = mod.opening;
    if (!opening) {
      if (axis === 'X') addCollider(lx + CELL / 2, y, lz, CELL, h, t);
      else addCollider(lx, y, lz + CELL / 2, t, h, CELL);
    } else {
      // two stubs + a lintel over the opening
      const stub = (CELL - opening.w) / 2;
      if (axis === 'X') {
        addCollider(lx + stub / 2, y, lz, stub, h, t);
        addCollider(lx + CELL - stub / 2, y, lz, stub, h, t);
        addCollider(lx + CELL / 2, y + opening.h, lz, opening.w, h - opening.h, t);
      } else {
        addCollider(lx, y, lz + stub / 2, t, h, stub);
        addCollider(lx, y, lz + CELL - stub / 2, t, h, stub);
        addCollider(lx, y + opening.h, lz + CELL / 2, t, h - opening.h, opening.w);
      }
    }
  }

  // Wall run from a data entry {x, z, dir:'X'|'Z', segs:[variants]} at tier y.
  function wallRun(run, y) {
    for (let i = 0; i < run.segs.length; i++) {
      if (run.dir === 'X') wallSeg('X', run.x + i * CELL, run.z, y, run.segs[i]);
      else wallSeg('Z', run.x, run.z + i * CELL, y, run.segs[i]);
    }
  }

  // floor def merge: add one def per contiguous run of cells in a row
  function floorDefsFromCells(cells, y) {
    const rows = new Map();
    for (const c of cells) {
      if (!rows.has(c.z)) rows.set(c.z, []);
      rows.get(c.z).push(c.x);
    }
    for (const [z, xs] of rows) {
      xs.sort((a, b) => a - b);
      let start = xs[0], prev = xs[0];
      for (let i = 1; i <= xs.length; i++) {
        if (i === xs.length || xs[i] !== prev + 1) {
          floors.push({ x1: start * CELL, z1: z * CELL, x2: (prev + 1) * CELL, z2: (z + 1) * CELL, y });
          start = xs[i];
        }
        prev = xs[i];
      }
    }
  }

  // ==========================================================================
  // 1. THE LABYRINTH (y = DUNGEON_Y)
  // ==========================================================================
  const { open, at } = parseMaze();
  const isRoomHigh = (c) => c === 'G' || c === 'B';   // 2-story dungeon rooms
  const stairCell = (c) => c === 'W' || c === 'E';

  // door lookup: boundaries between open cells
  const doorMap = new Map(); // "x,z,nx,nz" -> kind
  for (const d of MAZE_DOORS) {
    const dx = d.dir === 'E' ? 1 : d.dir === 'W' ? -1 : 0;
    const dz = d.dir === 'S' ? 1 : d.dir === 'N' ? -1 : 0;
    doorMap.set(`${d.x},${d.z},${d.x + dx},${d.z + dz}`, d.kind);
  }
  const doorAt = (x, z, nx, nz) =>
    doorMap.get(`${x},${z},${nx},${nz}`) || doorMap.get(`${nx},${nz},${x},${z}`);

  const mazeFloorCells = [];
  const highWallDone = new Set();
  for (let r = 0; r < MAZE.length; r++) {
    for (let c = 0; c < MAZE[r].length; c++) {
      const x = MAZE_COL0 + c, z = MAZE_ROW0 + r;
      const ch = at(x, z);
      if (!open(x, z)) continue;
      mazeFloorCells.push({ x, z });
      // floor + ceiling instances (stair shafts + landings stay open upward)
      place('floor', x * CELL, DUNGEON_Y, z * CELL, 0);
      if (!stairCell(ch) && ch !== 'L' && ch !== 'M') {
        place('ceiling', x * CELL, isRoomHigh(ch) ? DUNGEON_Y + 2 * STORY : DUNGEON_Y + STORY, z * CELL, 0);
      }
      // walls on boundaries toward solid/stair cells or the grid edge
      for (const [dx, dz, axis] of [[1, 0, 'Z'], [-1, 0, 'Z'], [0, 1, 'X'], [0, -1, 'X']]) {
        const nx = x + dx, nz = z + dz;
        const nch = at(nx, nz);
        const lx = dx === 1 ? (x + 1) * CELL : x * CELL;
        const lz = dz === 1 ? (z + 1) * CELL : z * CELL;
        if (open(nx, nz)) {
          // open-open boundary: only doors/arches, placed once
          const kind = doorAt(x, z, nx, nz);
          if (kind && (dx === 1 || dz === 1) && kind !== 'gate') {
            const blx = dx !== 0 ? (x + (dx === 1 ? 1 : 0)) * CELL : x * CELL;
            const blz = dz !== 0 ? (z + (dz === 1 ? 1 : 0)) * CELL : z * CELL;
            wallSeg(axis, blx, blz, DUNGEON_Y, kind === 'door' ? 'wallDoor' : 'arch');
            // tall rooms: close the second tier above the doorway
            if (isRoomHigh(ch) || isRoomHigh(nch)) wallSeg(axis, blx, blz, DUNGEON_Y + STORY, 'wall');
          }
          continue;
        }
        // solid neighbor -> wall (skip the portcullis boundary)
        const kind = doorAt(x, z, nx, nz);
        if (kind === 'gate') {
          // second tier above the portcullis opening
          wallSeg(axis, lx, lz, DUNGEON_Y + STORY, 'wall');
          continue;
        }
        // a landing's north face toward its own stair run stays OPEN —
        // that is where the stairs walk out into the labyrinth
        if ((ch === 'L' || ch === 'M') && stairCell(nch) && nz === z - 1) continue;
        const tiers = (isRoomHigh(ch) || isRoomHigh(nch) || stairCell(nch)) ? 2 : 1;
        for (let t = 0; t < tiers; t++) {
          const key2 = `${axis},${lx},${lz},${DUNGEON_Y + t * STORY}`;
          if (highWallDone.has(key2)) continue;
          highWallDone.add(key2);
          wallSeg(axis, lx, lz, DUNGEON_Y + t * STORY, 'wall');
        }
      }
    }
  }
  floorDefsFromCells(mazeFloorCells, DUNGEON_Y);

  // ---- stair shafts (0 -> DUNGEON_Y) ----
  // straight 4-module runs, 2 cells wide, descending toward +Z ('S')
  const stairSteps = (x0Cells, z0, modulesDown, yTop) => {
    // returns nothing; places stair modules + step colliders + floor defs
    for (let k = 0; k < modulesDown; k++) {
      const yB = yTop - (k + 1) * 1.5;
      for (const xc of x0Cells) place('stairs', xc * CELL, yB, z0 + (k + 1) * CELL, 0);
      // 5 collider steps of 0.3 rise per module
      for (let j = 0; j < 5; j++) {
        const stepY = yTop - k * 1.5 - (j + 1) * 0.3;
        const sz = z0 + k * CELL + j * (CELL / 5);
        const w = x0Cells.length * CELL;
        addCollider(x0Cells[0] * CELL + w / 2, stepY - 0.6, sz + CELL / 10, w, 0.6, CELL / 5);
        floors.push({
          x1: x0Cells[0] * CELL, z1: sz,
          x2: x0Cells[0] * CELL + w, z2: sz + CELL / 5, y: stepY,
        });
      }
    }
  };

  for (const sh of SHAFTS) {
    const xs = [...new Set(sh.cells.map(c => c.x))].sort((a, b) => a - b);
    const zs = sh.cells.map(c => c.z).sort((a, b) => a - b);
    stairSteps(xs, zs[0] * CELL, sh.cells.length / xs.length, 0);
    // shaft perimeter walls below ground (-6..0): ONLY on faces that abut
    // solid rock / grid edge. Corridor-side faces are walled by the maze
    // pass; the face toward the landing stays open (the stairs walk out).
    const done = new Set();
    for (const c of sh.cells) {
      for (const [dx, dz, axis] of [[1, 0, 'Z'], [-1, 0, 'Z'], [0, 1, 'X'], [0, -1, 'X']]) {
        const nx = c.x + dx, nz = c.z + dz;
        if (at(nx, nz) !== '#') continue; // open or stair cells handled elsewhere
        const lx = dx === 1 ? (c.x + 1) * CELL : c.x * CELL;
        const lz = dz === 1 ? (c.z + 1) * CELL : c.z * CELL;
        for (let t = 0; t < 2; t++) {
          const k = `${axis},${lx},${lz},${t}`;
          if (done.has(k)) continue;
          done.add(k);
          wallSeg(axis, lx, lz, DUNGEON_Y + t * STORY, 'wall');
        }
      }
    }
    // top railings around the open stairwell hole (half walls at y=0) on the
    // floored side, entry gap at the top stair row (you step onto the stairs)
    const x2 = (xs[xs.length - 1] + 1) * CELL;
    for (let z = zs[0]; z <= sh.landing.z; z++) {
      if (z !== zs[0]) wallSeg('Z', x2, z * CELL, 0, 'wallHalf');
    }
  }

  // vault / arena / gate-room door modules are handled by the maze pass.

  // ==========================================================================
  // 2. GROUND LEVEL
  // ==========================================================================
  // outdoor ground: one big dirt plane + floor defs
  {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 65),
      new THREE.MeshLambertMaterial({ color: 0x23231f }));
    plane.rotation.x = -HPI;
    plane.position.set(10, -0.02, 1.25);
    scene.add(plane);
    for (const g of GROUND_RECTS) floors.push({ x1: g.x1, z1: g.z1, x2: g.x2, z2: g.z2, y: 0 });
  }
  // playable bounds (fog walls)
  addCollider((BOUNDS.x1 + BOUNDS.x2) / 2, 0, BOUNDS.z1 - 0.5, BOUNDS.x2 - BOUNDS.x1 + 2, 8, 1);
  addCollider((BOUNDS.x1 + BOUNDS.x2) / 2, 0, BOUNDS.z2 + 0.5, BOUNDS.x2 - BOUNDS.x1 + 2, 8, 1);
  addCollider(BOUNDS.x1 - 0.5, 0, (BOUNDS.z1 + BOUNDS.z2) / 2, 1, 8, BOUNDS.z2 - BOUNDS.z1 + 2);
  addCollider(13.75, 0, BOUNDS.z2 + 0.5, 8.5, 8, 1); // south edge of the tower door approach
  // east bound = the keep itself (walls); gatehouse/stairtower cover z[-5,17.5],
  // bailey connector ruins cover z[-15,-5]

  // bailey ruined perimeter
  for (const run of BAILEY_WALLS) wallRun(run, 0);

  // keep rooms
  for (const room of ROOMS) {
    const [x0, x1] = room.x, [z0, z1] = room.z;
    // floors (skip shaft holes + floor holes)
    const cells = [];
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (room.shaftCells &&
            x >= room.shaftCells.x[0] && x <= room.shaftCells.x[1] &&
            z >= room.shaftCells.z[0] && z <= room.shaftCells.z[1]) continue;
        if (room.floorHole && room.floorHole.x === x && room.floorHole.z === z) continue;
        cells.push({ x, z });
        place('floor', x * CELL, 0, z * CELL, 0);
        if (room.ceiling != null) place('ceiling', x * CELL, room.ceiling, z * CELL, 0);
      }
    }
    floorDefsFromCells(cells, 0);
    // walls per face
    const faces = {
      N: { axis: 'X', lx: (i) => (x0 + i) * CELL, lz: z0 * CELL, n: x1 - x0 + 1 },
      S: { axis: 'X', lx: (i) => (x0 + i) * CELL, lz: (z1 + 1) * CELL, n: x1 - x0 + 1 },
      W: { axis: 'Z', lx: x0 * CELL, lz: (i) => (z0 + i) * CELL, n: z1 - z0 + 1 },
      E: { axis: 'Z', lx: (x1 + 1) * CELL, lz: (i) => (z0 + i) * CELL, n: z1 - z0 + 1 },
    };
    for (const [face, variants] of Object.entries(room.walls || {})) {
      const f = faces[face];
      for (let i = 0; i < f.n && i < variants.length; i++) {
        wallSeg(f.axis, f.axis === 'X' ? f.lx(i) : f.lx, f.axis === 'X' ? f.lz : f.lz(i), 0, variants[i]);
      }
    }
    if (room.stories > 1 && room.upper) {
      for (const [face, variants] of Object.entries(room.upper)) {
        const f = faces[face];
        for (let i = 0; i < f.n && i < variants.length; i++) {
          wallSeg(f.axis, f.axis === 'X' ? f.lx(i) : f.lx, f.axis === 'X' ? f.lz : f.lz(i), STORY, variants[i]);
        }
      }
    }
  }

  // hall floor hole dressing: broken edges (rubble piles handled by PROPS)
  // balcony
  for (const strip of BALCONY.strips) {
    const cells = [];
    for (let x = strip.x[0]; x <= strip.x[1]; x++) {
      for (let z = strip.z[0]; z <= strip.z[1]; z++) {
        cells.push({ x, z });
        place('floor', x * CELL, STORY, z * CELL, 0);
        place('ceiling', x * CELL, STORY - 0.02, z * CELL, 0); // visible underside
      }
    }
    floorDefsFromCells(cells, STORY);
  }
  for (const run of BALCONY.rails) wallRun(run, STORY);
  // balcony access stairs (0 -> 3)
  for (const st of BALCONY.stairs) {
    for (let k = 0; k < st.modules; k++) {
      const yB = k * 1.5;
      if (st.dir === 'N') {
        place('stairs', st.x * CELL, yB, (st.z + 1 - k) * CELL, 0);
        for (let j = 0; j < 5; j++) {
          const stepY = yB + (j + 1) * 0.3;
          const sz = (st.z + 1 - k) * CELL - (j + 1) * (CELL / 5);
          addCollider(st.x * CELL + CELL / 2, stepY - 0.6, sz + CELL / 10, CELL, 0.6, CELL / 5);
          floors.push({ x1: st.x * CELL, z1: sz, x2: (st.x + 1) * CELL, z2: sz + CELL / 5, y: stepY });
        }
      } else { // 'S' — rotated PI: ascends toward +Z
        place('stairs', (st.x + 1) * CELL, yB, (st.z + k) * CELL, Math.PI);
        for (let j = 0; j < 5; j++) {
          const stepY = yB + (j + 1) * 0.3;
          const sz = (st.z + k) * CELL + j * (CELL / 5);
          addCollider(st.x * CELL + CELL / 2, stepY - 0.6, sz + CELL / 10, CELL, 0.6, CELL / 5);
          floors.push({ x1: st.x * CELL, z1: sz, x2: (st.x + 1) * CELL, z2: sz + CELL / 5, y: stepY });
        }
      }
    }
  }

  // hall pillars (stacked 2 stories)
  for (const p of HALL_PILLARS) {
    const px = p.x * CELL + CELL / 2, pz = p.z * CELL + CELL / 2;
    place('pillar', px, 0, pz, 0);
    place('pillar2', px, STORY, pz, 0);
    addCollider(px, 0, pz, 0.45, STORY * 2, 0.45);
  }

  // dais (hall east end)
  {
    const w = DAIS.x2 - DAIS.x1, d = DAIS.z2 - DAIS.z1;
    addBoxVisual((DAIS.x1 + DAIS.x2) / 2, 0, (DAIS.z1 + DAIS.z2) / 2, w, DAIS.y, d, 0x2c2a33);
    addCollider((DAIS.x1 + DAIS.x2) / 2, 0, (DAIS.z1 + DAIS.z2) / 2, w, DAIS.y, d);
    floors.push({ x1: DAIS.x1, z1: DAIS.z1, x2: DAIS.x2, z2: DAIS.z2, y: DAIS.y });
  }

  // ==========================================================================
  // 3. PROPS
  // ==========================================================================
  for (const p of PROPS) {
    place(p.mod, p.x, p.y, p.z, p.ry || 0, p.s || 1);
    if (p.collide) {
      const m = MODULES[p.mod];
      const s = p.s || 1;
      const w = (m.w || m.len || 1) * s, d = (m.d || m.t || m.w || 1) * s;
      addCollider(p.x, p.y, p.z, Math.min(w, 2.2), (m.h || 1) * s, Math.min(d, 2.2));
    }
  }

  // ==========================================================================
  // 3b. AUTHOR ROOMS (Diablo-style prefab chambers from src/rooms.js)
  // Collects room torch LIGHTS locally; they are merged into lightCandidates
  // in section 4 (where that array is declared) to avoid a TDZ ReferenceError.
  // ==========================================================================
  const roomLights = [];
  {
    const rooms = expandRooms();
    for (const p of rooms.placements) place(p.mod, p.x, p.y, p.z, p.ry || 0, p.s || 1);
    for (const t of rooms.torchPoints) {
      place('torch1', t.x, t.y - 1.0, t.z, t.ry || 0);
      roomLights.push({
        x: t.x + Math.sin(t.ry || 0) * 0.45, y: t.y + 0.35, z: t.z + Math.cos(t.ry || 0) * 0.45,
        base: 34, dist: 14,
      });
    }
    // enemy / loot slots surfaced for the spawner (consumed by enemy.js later)
    if (rooms.enemySlots.length) console.log('[rooms] enemy slots:', rooms.enemySlots.length);
    if (rooms.lootSlots.length) console.log('[rooms] loot slots:', rooms.lootSlots.length);
  }

  // ==========================================================================
  // 4. TORCHES + LIGHT BUDGET
  // ==========================================================================
  const lightCandidates = [];
  // merge author-room torch lights collected in section 3b
  for (const L of roomLights) lightCandidates.push(L);
  for (const t of TORCH_POINTS) {
    place('torch1', t.x, t.y - 1.0, t.z, t.ry || 0);
    if (t.lit) lightCandidates.push({
      x: t.x + Math.sin(t.ry || 0) * 0.45, y: t.y + 0.35, z: t.z + Math.cos(t.ry || 0) * 0.45,
      base: 34, dist: 14,
    });
  }
  for (const p of PROPS) {
    if (!p.light) continue;
    const m = MODULES[p.mod];
    lightCandidates.push({ x: p.x, y: p.y + (m.h || 1) * (p.s || 1) + 0.25, z: p.z, base: 42, dist: 16 });
  }
  // training torches are guaranteed (far east, tutorial space)
  const trainLights = TRAINING.torches.map(t => ({
    x: t.x + Math.sin(t.ry || 0) * 0.45, y: t.y + 0.35, z: t.z + Math.cos(t.ry || 0) * 0.45,
    base: 36, dist: 15,
  }));
  const budget = Math.max(0, (CFG.world?.lightBudget ?? 26) - trainLights.length);
  const lit = [...lightCandidates.slice(0, budget), ...trainLights];
  for (const L of lit) {
    const light = new THREE.PointLight(0xff7722, L.base, L.dist, 2);
    light.position.set(L.x, L.y, L.z);
    scene.add(light);
    torches.push({ light, base: L.base, phase: Math.random() * 10 });
  }

  // ==========================================================================
  // 5. TRAINING ROOM (x 108..128, z -10..10)
  // ==========================================================================
  {
    const R = TRAINING.rect;
    // floor + ceiling
    for (let x = R.x1; x < R.x2; x += CELL) {
      for (let z = R.z1; z < R.z2; z += CELL) {
        place('floor', x, 0, z, 0);
        place('ceiling', x, STORY * 2, z, 0);
      }
    }
    floors.push({ x1: R.x1, z1: R.z1, x2: R.x2, z2: R.z2, y: 0 });
    // walls (2 tiers)
    for (let t = 0; t < 2; t++) {
      const y = t * STORY;
      for (let x = R.x1; x < R.x2; x += CELL) {
        wallSeg('X', x, R.z1, y, t === 1 && ((x - R.x1) / CELL) % 3 === 1 ? 'wallWindow' : 'wall');
        wallSeg('X', x, R.z2, y, 'wall');
      }
      for (let z = R.z1; z < R.z2; z += CELL) {
        wallSeg('Z', R.x1, z, y, 'wall');
        wallSeg('Z', R.x2, z, y, 'wall');
      }
    }
    // torch props (lights already added above)
    for (const t of TRAINING.torches) place('torch1', t.x, t.y - 1.0, t.z, t.ry || 0);
    for (const p of TRAINING.props) {
      place(p.mod, p.x, p.y, p.z, p.ry || 0, 1);
      if (p.collide) {
        const m = MODULES[p.mod];
        addCollider(p.x, p.y, p.z, Math.min(m.w || m.len || 1, 2.2), m.h || 1, Math.min(m.d || m.t || m.w || 1, 2.2));
      }
    }
    // sparring mat (kept from the old blockout — pure GRIMHOLD dressing)
    addBoxVisual(118, 0, 0, 9, 0.06, 9, 0x4a3d28);
    floors.push({ x1: 113.5, z1: -4.5, x2: 122.5, z2: 4.5, y: 0.06 });
  }

  // ==========================================================================
  // 6. EXTRACTION GATE (portcullis in the gate room's north wall)
  // ==========================================================================
  // closed = mesh.position.y 1.7, open = slides to -1.8 (main.js drives this)
  const gateX = GATE_CELL.x * CELL + CELL / 2;             // north face of cell x5 = 13.75
  const gateZ = (MAZE_ROW0) * CELL;                        // north face z=-22.5
  const gatePlaceholder = addBoxVisual(gateX, DUNGEON_Y, gateZ, 2.5, 3.2, 0.4, 0x54422a);
  gatePlaceholder.position.y = 1.7; // matches main.js closed semantics
  const gate = {
    mesh: gatePlaceholder,
    collider: addCollider(gateX, DUNGEON_Y, gateZ, 2.6, 3.4, 0.5),
    open: false, x: gateX, z: gateZ,
  };
  const rune = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 24),
    new THREE.MeshBasicMaterial({ color: 0x882222, transparent: true, opacity: 0.75 }));
  rune.rotation.x = -HPI;
  rune.position.set(EXTRACT.x, DUNGEON_Y + 0.03, EXTRACT.z);
  scene.add(rune);

  // wisp path: vault -> gate through the maze (for the post-open hint trail)
  const wispCells = mazePath(VAULT_CELL, GATE_CELL) || [];
  const wispPath = wispCells.map(c => ({
    x: c.x * CELL + CELL / 2, y: DUNGEON_Y + 1.3, z: c.z * CELL + CELL / 2,
  }));

  // ==========================================================================
  // 7. QUERIES (unchanged physics contract)
  // ==========================================================================
  function floorHeightAt(x, z, refY) {
    let best = -Infinity;
    for (const f of floors) {
      if (x >= f.x1 - 0.05 && x <= f.x2 + 0.05 && z >= f.z1 - 0.05 && z <= f.z2 + 0.05) {
        if (f.y <= refY + 0.55 && f.y > best) best = f.y;
      }
    }
    return best === -Infinity ? refY : best;
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

  function raycastWall(origin, dir, maxDist) {
    let best = null;
    for (const c of colliders) {
      if (!c.active) continue;
      let tmin = 0, tmax = maxDist;
      let nAxis = -1, nSign = 0;
      let ok = true;
      for (const [axis, o, d, mn, mx] of [
        ['x', origin.x, dir.x, c.min.x, c.max.x],
        ['y', origin.y, dir.y, c.min.y, c.max.y],
        ['z', origin.z, dir.z, c.min.z, c.max.z],
      ]) {
        if (Math.abs(d) < 1e-8) {
          if (o < mn || o > mx) { ok = false; break; }
          continue;
        }
        let t1 = (mn - o) / d, t2 = (mx - o) / d;
        let sign = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sign = 1; }
        if (t1 > tmin) { tmin = t1; nAxis = axis; nSign = sign; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
      if (!ok || tmin <= 0.01 || tmin >= maxDist) continue;
      if (!best || tmin < best.dist) {
        const normal = { x: 0, y: 0, z: 0 };
        if (nAxis !== -1) normal[nAxis] = nSign;
        best = {
          dist: tmin,
          point: new THREE.Vector3(origin.x + dir.x * tmin, origin.y + dir.y * tmin, origin.z + dir.z * tmin),
          normal: new THREE.Vector3(normal.x, normal.y, normal.z),
        };
      }
    }
    return best;
  }

  // Horizontal distance (m) from pos to the nearest wall, capped at 3.0.
  // Four axis-aligned probes; Infinity when nothing is within the cap.
  function wallDistance(pos) {
    const MAXD = 3.0;
    const o = new THREE.Vector3(pos.x, (pos.y || 0) + 1.0, pos.z);
    let best = Infinity;
    for (const d of [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
    ]) {
      const hit = raycastWall(o, d, MAXD);
      if (hit && hit.dist < best) best = hit.dist;
    }
    return best;
  }

  // ==========================================================================
  // 8. ASYNC VISUALS — one InstancedMesh per module type
  // ==========================================================================
  loadVisuals(scene, placements, gate);

  return {
    colliders, floors, torches,
    lootSpawns: LOOT_SPAWNS, enemySpawns: ENEMY_SPAWNS, ambushVolumes: AMBUSH_VOLUMES,
    gate, rune,
    training: { spawn: TRAINING.spawn, dummySpawns: TRAINING.dummySpawns },
    spawn: SPAWN,
    extractPos: EXTRACT,
    wispPath,
    floorHeightAt, collideCircle, raycastWall, wallDistance,
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
        for (const name of Object.keys(g.attributes)) {
          if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
        }
        if (!g.attributes.uv) {
          g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        }
        parts.push(g.index ? g.toNonIndexed() : g);
      });
      const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
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
