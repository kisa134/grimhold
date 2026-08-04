// rooms.js — author-built rooms (Diablo-style), not random scatter.
//
// Each room is a fixed, hand-authored layout of Synty modules from
// src/leveldata.js MODULES. The generator (level.js) only (a) picks which
// rooms to include and (b) stamps them at a world offset + connects their
// door ports. Geometry itself is authored here — that's what makes rooms
// read as intentional spaces instead of procedural noise.
//
// Coordinate frame per room: local meters, floor at y=0, north = -z.
// A room's ports are door openings on its perimeter; the graph connector
// drops a short corridor between two rooms' facing ports.
//
// A placement: { mod, x, y, z, ry } where mod is a MODULES key.
// A decor/enemy/loot slot: { type, x, z, ry } resolved by level.js spawner.

// ---- shared wall-ring builder (rectangular room, inner W x D cells) --------
// Returns wall placements for a closed rectangle of given footprint (meters).
function ring(W, D, opts = {}) {
  const out = [];
  const t = 2.5; // cell size
  const cols = Math.round(W / t);
  const rows = Math.round(D / t);
  const x0 = -W / 2, z0 = -D / 2;
  const wallMod = opts.wall || 'wall';
  const doorMod = opts.door || 'wallDoor';
  // north (-z) & south (+z): run along X
  for (let c = 0; c < cols; c++) {
    const x = x0 + c * t + t / 2;
    const isDoorN = opts.doors?.includes('N' + c);
    const isDoorS = opts.doors?.includes('S' + c);
    out.push({ mod: isDoorN ? doorMod : wallMod, x, y: 0, z: z0, ry: 0 });
    out.push({ mod: isDoorS ? doorMod : wallMod, x, y: 0, z: z0 + D, ry: 0 });
  }
  // east (+x) & west (-x): run along Z
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * t + t / 2;
    const isDoorE = opts.doors?.includes('E' + r);
    const isDoorW = opts.doors?.includes('W' + r);
    out.push({ mod: isDoorE ? doorMod : wallMod, x: x0 + W, y: 0, z, ry: -Math.PI / 2 });
    out.push({ mod: isDoorW ? doorMod : wallMod, x: x0, y: 0, z, ry: -Math.PI / 2 });
  }
  return out;
}

function floorGrid(W, D, y = 0) {
  const out = [];
  const t = 2.5;
  const cols = Math.round(W / t), rows = Math.round(D / t);
  const x0 = -W / 2, z0 = -D / 2;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      out.push({ mod: 'floor', x: x0 + c * t + t / 2, y, z: z0 + r * t + t / 2 });
  return out;
}

function ceilingGrid(W, D, y) {
  const out = [];
  const t = 2.5;
  const cols = Math.round(W / t), rows = Math.round(D / t);
  const x0 = -W / 2, z0 = -D / 2;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      out.push({ mod: 'ceiling', x: x0 + c * t + t / 2, y, z: z0 + r * t + t / 2 });
  return out;
}

// ============================ ROOM TEMPLATES ===============================

// --- THRONE HALL: vaulted castle throne room, dark fortress vibe ------------
const Throne = {
  id: 'Throne',
  size: [15, 12.5],          // meters (W x D)
  ports: ['N', 'S'],          // door sides available for connection
  build: [
    ...floorGrid(15, 12.5),
    ...ceilingGrid(15, 12.5, 3),
    ...ring(15, 12.5, { doors: ['N6', 'S6'] }),
    // center spine pillars (2x2 colonnade feel)
    { mod: 'pillar', x: -5, y: 0, z: -2.5 },
    { mod: 'pillar', x: 5, y: 0, z: -2.5 },
    { mod: 'pillar', x: -5, y: 0, z: 2.5 },
    { mod: 'pillar', x: 5, y: 0, z: 2.5 },
    // throne dais at the north end (depth)
    { mod: 'altar', x: 0, y: 0, z: -4.5, ry: Math.PI }, // reused dais-like prop
    { mod: 'statue2', x: -3.5, y: 0, z: -5, ry: 0.3 },
    { mod: 'statue2', x: 3.5, y: 0, z: -5, ry: -0.3 },
    // braziers flanking the approach
    { mod: 'brazier', x: -3, y: 0, z: 0 },
    { mod: 'brazier', x: 3, y: 0, z: 0 },
    // wall dressing
    { mod: 'flagDark', x: -6.5, y: 0, z: -6.2, ry: 0 },
    { mod: 'flagDark', x: 6.5, y: 0, z: -6.2, ry: 0 },
    { mod: 'tombStone', x: -6.8, y: 0, z: 3, ry: 1.2 },
    { mod: 'tombStone', x: 6.8, y: 0, z: 3, ry: -1.2 },
  ],
  torches: [
    { x: -7, y: 2.2, z: -6.2, ry: 0 }, { x: 7, y: 2.2, z: -6.2, ry: 0 },
    { x: -7.4, y: 2.2, z: 6.2, ry: 0 }, { x: 7.4, y: 2.2, z: 6.2, ry: 0 },
  ],
  enemySlots: [
    { type: 'knight', x: -3, z: 2 }, { type: 'knight', x: 3, z: 2 },
  ],
  lootSlots: [{ type: 'chest', x: 0, z: 5 }],
};

// --- CRYPT: bone-chilled burial chamber --------------------------------------
const Crypt = {
  id: 'Crypt',
  size: [12.5, 12.5],
  ports: ['N', 'E', 'S'],
  build: [
    ...floorGrid(12.5, 12.5),
    ...ceilingGrid(12.5, 12.5, 3),
    ...ring(12.5, 12.5, { door: 'arch', doors: ['N4', 'S4', 'E4'] }),
    // central sarcophagus
    { mod: 'tomb', x: 0, y: 0, z: 0 },
    // flanking bone piles + skull piles
    { mod: 'bonePile', x: -4, y: 0, z: -4 },
    { mod: 'skullPile', x: 4, y: 0, z: -4 },
    { mod: 'bodySkel', x: -4, y: 0, z: 4, ry: 1.0 },
    { mod: 'bodySkel', x: 4, y: 0, z: 4, ry: -1.0 },
    // gothic candles
    { mod: 'candelabra', x: -2.5, y: 0, z: -5 },
    { mod: 'candelabra', x: 2.5, y: 0, z: -5 },
    { mod: 'cage', x: -5.5, y: 0, z: 2 },
    { mod: 'gargoyle', x: 5.5, y: 0, z: 2, ry: 0.5 },
  ],
  torches: [
    { x: -6, y: 2.2, z: -6, ry: 0 }, { x: 6, y: 2.2, z: -6, ry: 0 },
  ],
  enemySlots: [
    { type: 'skeleton', x: -3, z: 3 }, { type: 'skeleton', x: 3, z: 3 },
    { type: 'skeleton', x: 0, z: -2 },
  ],
  lootSlots: [{ type: 'chest', x: 5, z: -5 }],
};

// --- ARMORY: weapon racks, barrels, training dummies ------------------------
const Armory = {
  id: 'Armory',
  size: [12.5, 10],
  ports: ['N', 'W'],
  build: [
    ...floorGrid(12.5, 10),
    ...ceilingGrid(12.5, 10, 3),
    ...ring(12.5, 10, { doors: ['N4', 'W4'] }),
    { mod: 'rack', x: -5, y: 0, z: -3 },
    { mod: 'rack', x: -5, y: 0, z: 0 },
    { mod: 'rack', x: -5, y: 0, z: 3 },
    { mod: 'barrel', x: 4, y: 0, z: -3.5 },
    { mod: 'barrel', x: 5, y: 0, z: -3.5 },
    { mod: 'crate', x: 4, y: 0, z: 3.5 },
    { mod: 'crate', x: 5, y: 0, z: 3.5 },
    { mod: 'table', x: 0, y: 0, z: 0 },
    { mod: 'bookshelf', x: 5.4, y: 0, z: 0, ry: -Math.PI / 2 },
    { mod: 'skullPile', x: -2, y: 0, z: 4 },
  ],
  torches: [
    { x: -6, y: 2.2, z: -5, ry: 0 }, { x: 6, y: 2.2, z: 5, ry: 0 },
  ],
  enemySlots: [{ type: 'knight', x: 0, z: -2 }],
  lootSlots: [{ type: 'chest', x: 0, z: 3 }],
};

// Registry — add more rooms here, generator pulls from this.
export const ROOMS = { Throne, Crypt, Armory };

// Default floor plan: a short Diablo-style chain the generator stamps.
// (N/S/E/W adjacency is resolved by level.js connector logic.)
export const ROOM_PLAN = ['Throne', 'Crypt', 'Armory'];

// Expand the room plan into flat placement lists, stamped along +Z as a chain.
// Each room is dropped at a running Z offset; doors on facing sides line up so
// a short corridor can bridge them (connector logic lives in level.js).
// Returns { placements:[{mod,x,y,z,ry}], torchPoints:[{x,y,z,ry,lit}],
//           enemySlots:[{type,x,z}], lootSlots:[{type,x,z}] } in WORLD space.
const ROOM_GAP = 7.5; // corridor length between rooms
export function expandRooms(plan = ROOM_PLAN) {
  const placements = [];
  const torchPoints = [];
  const enemySlots = [];
  const lootSlots = [];
  let zoff = 0;
  plan.forEach((id, idx) => {
    const room = ROOMS[id];
    if (!room) return;
    const [W, D] = room.size;
    // center the room footprint on x=0, drop at current z
    for (const p of room.build) {
      placements.push({ mod: p.mod, x: p.x, y: p.y || 0, z: p.z + zoff, ry: p.ry || 0 });
    }
    for (const t of (room.torches || [])) {
      torchPoints.push({ x: t.x, y: t.y, z: t.z + zoff, ry: t.ry || 0, lit: true });
    }
    for (const e of (room.enemySlots || [])) {
      enemySlots.push({ type: e.type, x: e.x, z: e.z + zoff });
    }
    for (const l of (room.lootSlots || [])) {
      lootSlots.push({ type: l.type, x: l.x, z: l.z + zoff });
    }
    zoff += D + ROOM_GAP;
  });
  return { placements, torchPoints, enemySlots, lootSlots };
}
