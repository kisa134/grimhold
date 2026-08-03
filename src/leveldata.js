// leveldata.js — placement data for the GRIMHOLD labyrinth-castle.
// Everything the map is made of lives here as DATA: module inventory (with
// measured dimensions from tools/darkfantasy-dims.json), the labyrinth ASCII
// grid, ground-level zone/wall tables, prop/torch/loot/enemy placements,
// stair shafts, the extraction gate and the wisp-path helper.
//
// Units: meters. Grid cell = 2.5 m, story height = 3 m (Synty Base kit).
// Cell (i,k) spans x[i*2.5, i*2.5+2.5], z[k*2.5, k*2.5+2.5]. North = -z.

export const CELL = 2.5;
export const STORY = 3;
export const DUNGEON_Y = -6;   // labyrinth floor height
export const ASSET_BASE = import.meta.env.BASE_URL + 'assets/darkfantasy';

// ---- module inventory -------------------------------------------------------
// pivot: how the FBX origin sits ('x0' = spans +X from origin, z-centered;
// 'corner' = spans +X/+Z from origin; 'center' = origin-centered, base at y0).
// dims measured headlessly (tools/probe-dims.mjs); source FBX are cm -> x0.01.
export const MODULES = {
  wall:        { file: 'SM_Bld_Base_Wall_01.fbx',        pivot: 'x0',     len: 2.5, h: 3.0, t: 0.225 },
  wallHalf:    { file: 'SM_Bld_Base_Wall_Half_01.fbx',   pivot: 'x0',     len: 2.5, h: 1.5, t: 0.225 },
  wallDoor:    { file: 'SM_Bld_Base_Wall_Door_01.fbx',   pivot: 'x0',     len: 2.5, h: 3.0, t: 0.29,  opening: { w: 1.15, h: 2.1 } },
  wallWindow:  { file: 'SM_Bld_Base_Wall_Window_01.fbx', pivot: 'x0',     len: 2.5, h: 3.0, t: 0.26 },
  pillar:      { file: 'SM_Bld_Base_Pillar_01.fbx',      pivot: 'center', w: 0.43,  h: 3.0 },
  pillar2:     { file: 'SM_Bld_Base_Pillar_02.fbx',      pivot: 'center', w: 0.43,  h: 3.0 },
  floor:       { file: 'SM_Bld_Base_Floor_01.fbx',       pivot: 'corner', len: 2.5 },
  ceiling:     { file: 'SM_Bld_Base_Ceiling_01.fbx',     pivot: 'corner', len: 2.5 },
  stairs:      { file: 'SM_Bld_Base_Stairs_01.fbx',      pivot: 'x0',     len: 2.5, rise: 1.5 }, // ascends toward -Z, top y=1.5 at z=-2.5
  ruin1:       { file: 'SM_Bld_Wall_Ruin_01.fbx',        pivot: 'x0',     len: 2.5, h: 3.0, t: 0.23 },
  ruin2:       { file: 'SM_Bld_Wall_Ruin_02.fbx',        pivot: 'x0',     len: 2.58, h: 3.0, t: 0.6 },
  ruin3:       { file: 'SM_Bld_Wall_Ruin_03.fbx',        pivot: 'x0',     len: 1.94, h: 3.0, t: 0.27 },
  arch:        { file: 'SM_Bld_Wall_Archway_01.fbx',     pivot: 'x0',     len: 2.5, h: 3.0, t: 0.35,  opening: { w: 1.8, h: 2.4 } },
  tallWindow:  { file: 'SM_Bld_Wall_Window_Tall_01.fbx', pivot: 'x0',     len: 2.5, h: 3.0, t: 0.7 },
  window2:     { file: 'SM_Bld_Wall_Window_01.fbx',      pivot: 'x0',     len: 2.5, h: 3.0, t: 0.42 },
  gate:        { file: 'SM_Bld_Gates_Cemetary_01.fbx',   pivot: 'x0',     len: 3.56, h: 3.97 }, // unique mesh (slides open), not instanced

  // environment
  rock1:       { file: 'SM_Env_Rock_01.fbx',             pivot: 'center', w: 2.9, h: 1.5, d: 1.5 },
  rock2:       { file: 'SM_Env_Rock_02.fbx',             pivot: 'center', w: 1.9, h: 1.2, d: 1.4 },
  rocksSmall:  { file: 'SM_Env_Rocks_Small_01.fbx',      pivot: 'center', w: 2.5, h: 0.3, d: 2.1 },
  treeDead1:   { file: 'SM_Env_Tree_Dead_01.fbx',        pivot: 'center', w: 3.0, h: 3.4, d: 2.1 },
  treeDead2:   { file: 'SM_Env_Tree_Dead_02.fbx',        pivot: 'center', w: 4.4, h: 7.9, d: 3.0 },

  // props — flames (emissive via atlas emissive map; some get real lights)
  torch1:      { file: 'SM_Prop_Torch_01.fbx',           pivot: 'center', w: 0.58, h: 1.0 },   // wall bracket, flame +Z out
  torch2:      { file: 'SM_Prop_Torch_02.fbx',           pivot: 'center', w: 0.28, h: 0.92 },
  brazier:     { file: 'SM_Prop_Brazier_01.fbx',         pivot: 'center', w: 0.79, h: 0.9 },
  firePit:     { file: 'SM_Prop_Fire_Pit_01.fbx',        pivot: 'center', w: 2.5, h: 0.5, d: 1.5 },
  candle:      { file: 'SM_Prop_Candle_01.fbx',          pivot: 'center', w: 0.31, h: 0.39 },
  candleBlob:  { file: 'SM_Prop_Candle_Blob_01.fbx',     pivot: 'center', w: 0.49, h: 0.06 },
  candelabra:  { file: 'SM_Prop_Candelabra_01.fbx',      pivot: 'center', w: 0.7, h: 1.76 },

  // props — loot & ritual
  chest:       { file: 'SM_Prop_Chest_01.fbx',           pivot: 'center', w: 0.79, h: 0.56, d: 0.44 },
  altar:       { file: 'SM_Prop_Altar_Table_01.fbx',     pivot: 'center', w: 2.0, h: 0.86, d: 0.9 },
  ritual:      { file: 'SM_Prop_Ritual_Circle_01.fbx',   pivot: 'center', w: 6.06, h: 1.08 },
  tabernacle:  { file: 'SM_Prop_Tabernacle_01.fbx',      pivot: 'center', w: 3.65, h: 1.44, d: 1.23 },

  // props — gothic dressing
  statue1:     { file: 'SM_Prop_Statue_01.fbx',          pivot: 'center', w: 1.78, h: 2.44, d: 1.13 },
  statue2:     { file: 'SM_Prop_Statue_02.fbx',          pivot: 'center', w: 1.86, h: 3.03, d: 1.05 },
  gargoyle:    { file: 'SM_Prop_Gargoyle_01.fbx',        pivot: 'center', w: 1.92, h: 1.25, d: 1.35 },
  gallows:     { file: 'SM_Prop_Gallows_01.fbx',         pivot: 'center', w: 6.13, h: 4.29, d: 2.15 },
  gibbet:      { file: 'SM_Prop_Gibbet_01.fbx',          pivot: 'center', w: 3.34, h: 4.8 },
  well:        { file: 'SM_Prop_Well_01.fbx',            pivot: 'center', w: 3.64, h: 1.16, d: 3.21 },
  barrel:      { file: 'SM_Prop_Barrel_01.fbx',          pivot: 'center', w: 0.73, h: 0.95 },
  crate:       { file: 'SM_Prop_Crate_01.fbx',           pivot: 'center', w: 1.11, h: 0.4, d: 0.68 },
  barricade:   { file: 'SM_Prop_Barricade_01.fbx',       pivot: 'center', w: 2.03, h: 2.5, d: 2.3 },
  skullPile:   { file: 'SM_Prop_Skull_Pile_01.fbx',      pivot: 'center', w: 0.84, h: 0.48 },
  bonePile:    { file: 'SM_Prop_Bone_Pile_01.fbx',       pivot: 'center', w: 1.02, h: 0.38 },
  bodySkel:    { file: 'SM_Prop_Body_Skeleton_01.fbx',   pivot: 'center', w: 0.97, h: 0.29, d: 1.87 },
  tomb:        { file: 'SM_Prop_Tomb_01.fbx',            pivot: 'center', w: 1.36, h: 1.77, d: 2.62 },
  tombStone:   { file: 'SM_Prop_Tomb_Stone_01.fbx',      pivot: 'center', w: 0.77, h: 1.26 },
  cage:        { file: 'SM_Prop_Cage_Large_01.fbx',      pivot: 'center', w: 1.53, h: 2.23, d: 3.19 },
  pew:         { file: 'SM_Prop_Pew_01.fbx',             pivot: 'x0',     len: 2.0, h: 1.03, t: 0.76 },
  rack:        { file: 'SM_Prop_Rack_Weapon_01.fbx',     pivot: 'center', w: 1.42, h: 0.94, t: 0.37 },
  table:       { file: 'SM_Prop_Table_01.fbx',           pivot: 'center', w: 2.64, h: 0.78, d: 1.36 },
  chair:       { file: 'SM_Prop_Chair_01.fbx',           pivot: 'center', w: 0.67, h: 1.23 },
  bookshelf:   { file: 'SM_Prop_Bookshelf_01.fbx',       pivot: 'x0',     len: 1.27, h: 2.9, t: 0.64 },
  flagDark:    { file: 'SM_Prop_Flag_Dark_01.fbx',       pivot: 'center', w: 1.45, h: 3.0 },
};

// ---- THE LABYRINTH (y = DUNGEON_Y) -----------------------------------------
// 15 cols (x=4..18) x 20 rows (z=-9..10). '#' solid, '.' corridor,
// G gate room, B boss arena, V vault, W/E stair runs, L/M stair landings,
// C dead-end loot nook, A ambush nook.
export const MAZE_COL0 = 4;   // first char = cell x=4
export const MAZE_ROW0 = -9;  // first row  = cell z=-9
export const MAZE = [
  'GGGG###########', // z=-9
  'GGGG###########', // z=-8
  'GGGG###########', // z=-7
  'GGGG.##########', // z=-6
  '##........C####', // z=-5
  '##.#.#..#######', // z=-4
  '##.BBBBB..#####', // z=-3
  '##.BBBBB..A####', // z=-2
  '##.BBBBB.######', // z=-1
  '##.BBBBB.######', // z=0
  '##.BBBBB.######', // z=1
  'WW.......######', // z=2
  'WW.#####.######', // z=3
  'WW.####.....###', // z=4
  'WW.#####.EE...#', // z=5
  'LL.#####.EEVVVV', // z=6
  '...#####.EEVVVV', // z=7
  '.#.......EEVVVV', // z=8
  'C#######.MMVVVV', // z=9
  '###############', // z=10
];
// rows are normalized to 15 chars ('#' padded) by parseMaze().

// door/arch boundaries inside the maze: [cellX, cellZ, dir] where dir is the
// NEIGHBOR direction ('E' = boundary toward cell x+1, 'N' = toward z-1).
// variant: 'door' (Wall_Door + stub colliders), 'arch' (open arch stubs).
export const MAZE_DOORS = [
  { x: 7, z: -6, dir: 'E', kind: 'door' },   // gate room -> corridor
  { x: 5, z: -9, dir: 'N', kind: 'gate' },   // THE extraction portcullis (north face of gate room)
  { x: 8, z: -3, dir: 'N', kind: 'arch' },   // arena north entrance... (arena cell)
  { x: 10, z: 1, dir: 'S', kind: 'arch' },   // arena south entrance
  { x: 14, z: 9, dir: 'E', kind: 'door' },   // east shaft landing -> vault
  { x: 17, z: 6, dir: 'N', kind: 'door' },   // vault north door (from corridor z=5)
];

// stair shafts between y=0 and DUNGEON_Y: straight 4-module runs (1.5 m each),
// 2 cells wide. dir: direction of DESCENT.
export const SHAFTS = [
  { id: 'west', cells: [{ x: 4, z: 2 }, { x: 5, z: 2 }, { x: 4, z: 3 }, { x: 5, z: 3 }, { x: 4, z: 4 }, { x: 5, z: 4 }, { x: 4, z: 5 }, { x: 5, z: 5 }], width: 2, dir: 'S', landing: { x: 4, z: 6 } },
  { id: 'east', cells: [{ x: 13, z: 5 }, { x: 14, z: 5 }, { x: 13, z: 6 }, { x: 14, z: 6 }, { x: 13, z: 7 }, { x: 14, z: 7 }, { x: 13, z: 8 }, { x: 14, z: 8 }], width: 2, dir: 'S', landing: { x: 13, z: 9 } },
];

// ---- GROUND LEVEL (y=0) ------------------------------------------------------
// Outdoor ground rectangles (visual dirt plane + floor defs, y=0).
// They must NEVER cover the keep interior or the stairwell holes.
export const GROUND_RECTS = [
  { x1: -30, z1: -15, x2: 10, z2: 17.5 },    // bailey (spawn)
  { x1: 10, z1: 15, x2: 17.5, z2: 17.5 },    // stair-tower south door approach
  { x1: -30, z1: -27.5, x2: 50, z2: -15 },   // north strip (visual, unreachable)
  { x1: -30, z1: 17.5, x2: 50, z2: 30 },     // south strip (visual)
];

// Invisible bounds of the playable outdoor area (fog walls).
export const BOUNDS = { x1: -29.5, z1: -14.5, x2: 9.5, z2: 17.0 };

// Bailey ruined perimeter: wall runs along grid lines.
// run: {x, z, dir:'X'|'Z', segs:[variant,...]} — one variant per 2.5 m segment
// starting at (x,z) extending along +dir. Variants: module keys + 'none'.
export const BAILEY_WALLS = [
  { x: -30, z: -15, dir: 'X', segs: ['ruin1', 'ruin2', 'ruin1', 'ruin3', 'none', 'none', 'ruin1', 'ruin2', 'ruin1', 'ruin3', 'ruin1', 'ruin2', 'ruin1', 'ruin1', 'ruin2', 'ruin1'] }, // north x -30..10
  { x: -30, z: 17.5, dir: 'X', segs: ['ruin2', 'ruin1', 'ruin1', 'none', 'ruin3', 'ruin1', 'ruin2', 'none', 'none', 'ruin1', 'ruin1', 'ruin3', 'ruin2', 'ruin1', 'ruin1', 'ruin2'] }, // south
  { x: -30, z: -15, dir: 'Z', segs: ['ruin1', 'ruin1', 'ruin2', 'ruin1', 'ruin1', 'ruin2', 'ruin3', 'ruin1', 'ruin1', 'ruin2', 'ruin1', 'ruin1', 'ruin1'] }, // west x=-30, z -15..17.5
  { x: 10, z: -15, dir: 'Z', segs: ['ruin2', 'ruin1', 'ruin3', 'ruin1'] }, // east connector z -15..-5
];

// Keep rooms. rect: cell ranges. stories: stacked wall tiers. ceiling: y of
// ceiling modules (null = open). Walls: per-face variant arrays (one per cell
// segment); 'none' = another room owns that line.
export const ROOMS = [
  {
    id: 'gatehouse', x: [4, 6], z: [-2, 1], stories: 2, ceiling: 6,
    walls: {
      W: ['wall', 'arch', 'wall', 'wall'],      // x=10, z cells -2..1 — main entrance
      E: ['wall', 'wall', 'arch', 'wall'],      // x=17.5 — into the great hall (dogleg)
      N: ['wall', 'window2', 'wall'],           // z=-5
      S: ['wall', 'wall', 'door'],              // z=5 — to the west stair tower
    },
    upper: { N: ['wall', 'wall', 'wall'], S: ['wall', 'window2', 'wall'], W: ['tallWindow', 'tallWindow', 'tallWindow', 'tallWindow'], E: ['wall', 'wall', 'wall', 'wall'] },
  },
  {
    id: 'stairtower', x: [4, 6], z: [2, 6], stories: 1, ceiling: 3,
    // west 2 columns are the open stairwell shaft (no floor); east column floored
    shaftCells: { x: [4, 5], z: [2, 6] },
    walls: {
      W: ['wall', 'wall', 'wall', 'wall', 'wall'],
      E: ['none', 'none', 'none', 'wall', 'wall'], // z2..4 owned by hall W face
      N: ['none', 'none', 'none'],               // owned by gatehouse S
      S: ['wall', 'wall', 'door'],               // z=17.5, door into bailey south
    },
  },
  {
    id: 'hall', x: [7, 18], z: [-4, 4], stories: 2, ceiling: 6,
    walls: {
      W: ['wall', 'wall', 'none', 'none', 'none', 'none', 'wall', 'wall', 'wall'], // z-4..4; z-2..1 owned by gatehouse E, z2..4 face the stair tower
      E: ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      N: ['wall', 'wall', 'wall', 'wall', 'wall', 'none', 'none', 'none', 'none', 'none', 'none', 'none'], // x7..18; x12..18 owned by chapel S
      S: ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'none', 'none', 'none', 'none', 'none', 'none'], // x7..18; x13..18 owned by armory N
    },
    upper: {
      E: ['tallWindow', 'wall', 'tallWindow', 'wall', 'tallWindow', 'wall', 'tallWindow', 'wall', 'tallWindow'],
      N: ['wall', 'tallWindow', 'wall', 'tallWindow', 'wall', 'none', 'none', 'none', 'none', 'none', 'none', 'none'],
      S: ['wall', 'tallWindow', 'wall', 'tallWindow', 'wall', 'wall', 'none', 'none', 'none', 'none', 'none', 'none'],
      W: ['wall', 'wall', 'none', 'none', 'none', 'none', 'none', 'none', 'none'],
    },
    floorHole: { x: 12, z: 2 },   // collapsed floor — vertical shortcut into the maze
  },
  {
    id: 'chapel', x: [12, 18], z: [-9, -5], stories: 2, ceiling: 6,
    walls: {
      N: ['wall', 'window2', 'wall', 'window2', 'wall', 'window2', 'wall'],
      S: ['wall', 'door', 'wall', 'wall', 'door', 'wall', 'wall'],
      W: ['wall', 'wall', 'wall', 'wall', 'wall'],
      E: ['wall', 'wall', 'wall', 'wall', 'wall'],
    },
    upper: {
      N: ['tallWindow', 'tallWindow', 'tallWindow', 'tallWindow', 'tallWindow', 'tallWindow', 'tallWindow'],
      S: ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      W: ['wall', 'wall', 'window2', 'wall', 'wall'],
      E: ['wall', 'wall', 'window2', 'wall', 'wall'],
    },
  },
  {
    id: 'armory', x: [13, 18], z: [5, 9], stories: 1, ceiling: 3,
    shaftCells: { x: [13, 14], z: [5, 9] },   // east stairwell (rows z5..8 stairs, z9 open pit)
    walls: {
      N: ['wall', 'wall', 'door', 'wall', 'door', 'wall'],
      S: ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      W: ['wall', 'wall', 'wall', 'wall', 'wall'],
      E: ['wall', 'wall', 'wall', 'wall', 'wall'],
    },
  },
];

// Great-hall balcony (y=3): U-shaped strips + railing runs + access stairs.
export const BALCONY = {
  strips: [
    { x: [7, 18], z: [-4, -3] },  // north
    { x: [7, 18], z: [3, 4] },    // south
    { x: [17, 18], z: [-2, 2] },  // east (over the dais)
  ],
  // railings along inner edges (half walls at y=3); gaps at stair tops + one
  // deliberate drop gap on the east strip (x17, z0) behind the dais.
  rails: [
    { x: 17.5, z: -7.5, dir: 'X', segs: ['wallHalf', 'wallHalf', 'wallHalf', 'wallHalf', 'wallHalf', 'wallHalf', 'wallHalf', 'wallHalf', 'wallHalf', 'none', 'wallHalf', 'wallHalf'] }, // north inner z=-7.5 (gap at stair top x16)
    { x: 17.5, z: 7.5, dir: 'X', segs: ['none', 'wallHalf', 'wallHalf', 'wallHalf', 'wallHalf', 'wallHalf', 'wallHalf', 'wallHalf', 'wallHalf', 'wallHalf', 'wallHalf', 'wallHalf'] }, // south inner (gap at stair top x7)
    { x: 42.5, z: -5, dir: 'Z', segs: ['wallHalf', 'wallHalf', 'none', 'wallHalf', 'wallHalf'] }, // east inner x=42.5 z-5..7.5 (drop gap z0)
  ],
  stairs: [
    { x: 7, z: 4, dir: 'N', modules: 2 },  // south-west: cells (7,4)+(7,3), top y=3
    { x: 16, z: -4, dir: 'S', modules: 2 }, // north-east: cells (16,-4)+(16,-3)
  ],
};

// Pillars in the great hall (stacked 2 stories): cell x/z of pillar centers.
export const HALL_PILLARS = [
  { x: 9, z: -2 }, { x: 11, z: -2 }, { x: 13, z: -2 }, { x: 15, z: -2 },
  { x: 9, z: 2 }, { x: 11, z: 2 }, { x: 13, z: 2 }, { x: 15, z: 2 },
];

// Dais at the east end of the hall (low platform, floor defs added).
export const DAIS = { x1: 42.5, z1: -2.5, x2: 47.5, z2: 2.5, y: 0.45 };

// ---- PROPS ------------------------------------------------------------------
// {mod, x, y, z, ry, s, collide} — y = base height, ry = yaw (rad), s = scale.
// collide: true -> AABB from module dims (approx). Positions are world meters.
const cc = (i) => i * CELL + CELL / 2; // cell center
export const PROPS = [
  // BAILEY
  { mod: 'gallows', x: -8, y: 0, z: -4, ry: 0.3, collide: true },
  { mod: 'well', x: -14, y: 0, z: 6, ry: 0, collide: true },
  { mod: 'firePit', x: -22, y: 0, z: 2, ry: 0.4, light: true },
  { mod: 'gibbet', x: -3, y: 0, z: 10, ry: -0.5, collide: true },
  { mod: 'statue1', x: 7, y: 0, z: -3.2, ry: Math.PI, collide: true },
  { mod: 'statue2', x: 7, y: 0, z: 3.2, ry: Math.PI, collide: true },
  { mod: 'treeDead1', x: -18, y: 0, z: -9, ry: 1.2 },
  { mod: 'treeDead2', x: -25, y: 0, z: 12, ry: 2.6 },
  { mod: 'treeDead1', x: 2, y: 0, z: 13, ry: 4.0 },
  { mod: 'rock1', x: -24, y: 0, z: -12, ry: 0.7, collide: true },
  { mod: 'rock2', x: -2, y: 0, z: -12.5, ry: 2.1 },
  { mod: 'rocksSmall', x: -10, y: 0, z: 3, ry: 1.9 },
  { mod: 'rocksSmall', x: 4, y: 0, z: -8, ry: 0.2 },
  { mod: 'barricade', x: -16, y: 0, z: 14.5, ry: 0.9, collide: true },
  { mod: 'barrel', x: 8.6, y: 0, z: 6.4, ry: 0, collide: true },
  { mod: 'crate', x: 8.2, y: 0, z: 7.6, ry: 0.5, collide: true },
  { mod: 'bodySkel', x: -6, y: 0, z: -8, ry: 1.1 },
  { mod: 'bodySkel', x: 3, y: 0, z: 8.5, ry: -2.0 },

  // GATEHOUSE (x 10..17.5, z -5..5)
  { mod: 'brazier', x: 11.4, y: 0, z: -3.6, ry: 0, collide: true, light: true },
  { mod: 'brazier', x: 16.1, y: 0, z: 3.6, ry: 0, collide: true, light: true },
  { mod: 'barrel', x: 16.5, y: 0, z: -4, ry: 0, collide: true },
  { mod: 'gargoyle', x: 10.6, y: 3.0, z: -4.6, ry: Math.PI * 0.5 }, // perched over the entrance
  { mod: 'flagDark', x: 13.75, y: 3.2, z: -4.8, ry: 0 },

  // GREAT HALL
  { mod: 'table', x: 25, y: 0, z: -6.5, ry: 0, collide: true },
  { mod: 'chair', x: 24, y: 0, z: -7.8, ry: 0.2, collide: true },
  { mod: 'chair', x: 26.2, y: 0, z: -7.7, ry: -0.3, collide: true },
  { mod: 'table', x: 32, y: 0, z: 6.8, ry: 0.9, collide: true },
  { mod: 'barrel', x: 19.5, y: 0, z: 8.5, ry: 0, collide: true },
  { mod: 'barrel', x: 20.6, y: 0, z: 9.1, ry: 0.8, collide: true },
  { mod: 'candelabra', x: 43.5, y: DAIS.y, z: -1.8, ry: 0, light: true },
  { mod: 'candelabra', x: 43.5, y: DAIS.y, z: 1.8, ry: 0, light: true },
  { mod: 'altar', x: 45.8, y: DAIS.y, z: 0, ry: Math.PI / 2, collide: true },
  { mod: 'tabernacle', x: 47.0, y: DAIS.y, z: 0, ry: -Math.PI / 2 },
  { mod: 'flagDark', x: 47.2, y: 3.2, z: -3.5, ry: -Math.PI / 2 },
  { mod: 'flagDark', x: 47.2, y: 3.2, z: 3.5, ry: -Math.PI / 2 },
  { mod: 'candleBlob', x: 24.9, y: 0.78, z: -6.4, ry: 0 },
  { mod: 'skullPile', x: 18.7, y: 0, z: -8.9, ry: 0.4 },
  { mod: 'rocksSmall', x: 29.4, y: 0, z: 3.8, ry: 0.6 },   // edge of the collapsed hall floor
  { mod: 'bonePile', x: 32.3, y: 0, z: 6.9, ry: 2.2 },

  // CHAPEL (x 30..47.5, z -22.5..-10)
  { mod: 'pew', x: 33, y: 0, z: -15, ry: 0, collide: true },
  { mod: 'pew', x: 33, y: 0, z: -17.5, ry: 0, collide: true },
  { mod: 'pew', x: 37.5, y: 0, z: -15, ry: 0, collide: true },
  { mod: 'pew', x: 37.5, y: 0, z: -17.5, ry: 0, collide: true },
  { mod: 'altar', x: 38.75, y: 0, z: -20.6, ry: 0, collide: true },
  { mod: 'ritual', x: 38.75, y: 0, z: -20.5, ry: 0, s: 0.55 },
  { mod: 'candelabra', x: 34, y: 0, z: -20.8, ry: 0, light: true },
  { mod: 'candelabra', x: 43.5, y: 0, z: -20.8, ry: 0, light: true },
  { mod: 'candle', x: 38.2, y: 0.86, z: -20.5, ry: 0 },
  { mod: 'candle', x: 39.4, y: 0.86, z: -20.7, ry: 0 },
  { mod: 'bookshelf', x: 31.2, y: 0, z: -21.5, ry: 0, collide: true },
  { mod: 'candleBlob', x: 36, y: 0, z: -19.5, ry: 0 },
  { mod: 'statue1', x: 46.3, y: 0, z: -12.2, ry: -Math.PI / 2, collide: true },

  // ARMORY (x 32.5..47.5, z 12.5..25)
  { mod: 'rack', x: 39, y: 0, z: 13.3, ry: 0, collide: true },
  { mod: 'rack', x: 42, y: 0, z: 13.3, ry: 0, collide: true },
  { mod: 'rack', x: 45, y: 0, z: 13.3, ry: 0, collide: true },
  { mod: 'table', x: 41, y: 0, z: 18, ry: 0.2, collide: true },
  { mod: 'barrel', x: 46.4, y: 0, z: 23.6, ry: 0, collide: true },
  { mod: 'barrel', x: 45.3, y: 0, z: 24, ry: 1.2, collide: true },
  { mod: 'crate', x: 34, y: 0, z: 24, ry: 0.4, collide: true },
  { mod: 'torch2', x: 41.1, y: 0.82, z: 18.1, ry: 0 }, // stuck on the table

  // STAIR TOWER guardroom dressing
  { mod: 'rack', x: 16.2, y: 0, z: 16.2, ry: Math.PI, collide: true },
  { mod: 'barrel', x: 16.6, y: 0, z: 6.2, ry: 0, collide: true },

  // LABYRINTH corridors / nooks (y=-6)
  { mod: 'skullPile', x: cc(6), y: DUNGEON_Y, z: cc(-5), ry: 0.7 },
  { mod: 'bonePile', x: cc(10), y: DUNGEON_Y, z: cc(-2), ry: 1.9 },
  { mod: 'bodySkel', x: cc(6), y: DUNGEON_Y, z: cc(-1), ry: 2.4 },
  { mod: 'cage', x: cc(14), y: DUNGEON_Y, z: cc(-5) + 0.4, ry: 0.5, collide: true }, // nook C
  { mod: 'tombStone', x: cc(6), y: DUNGEON_Y, z: cc(0) - 0.6, ry: -0.4, collide: true },
  { mod: 'skullPile', x: cc(6) + 0.5, y: DUNGEON_Y, z: cc(3), ry: 2.2 },
  { mod: 'bonePile', x: cc(12), y: DUNGEON_Y, z: cc(2), ry: 0.1 },   // under the hall hole
  { mod: 'bodySkel', x: cc(12) - 0.6, y: DUNGEON_Y, z: cc(2) + 0.5, ry: 1.3 },
  { mod: 'tomb', x: cc(4) - 0.3, y: DUNGEON_Y, z: cc(9), ry: Math.PI / 2, collide: true }, // nook C
  { mod: 'tombStone', x: cc(4), y: DUNGEON_Y, z: cc(8), ry: 0.8, collide: true },
  { mod: 'skullPile', x: cc(6), y: DUNGEON_Y, z: cc(8), ry: 1.5 },
  { mod: 'candleBlob', x: cc(8), y: DUNGEON_Y, z: cc(-5), ry: 0 },

  // VAULT (x15..18, z6..9 @ -6)
  { mod: 'chest', x: cc(16) - 0.6, y: DUNGEON_Y, z: cc(8), ry: -Math.PI / 2, collide: true },
  { mod: 'chest', x: cc(17) + 0.4, y: DUNGEON_Y, z: cc(8) + 0.4, ry: Math.PI, collide: true },
  { mod: 'chest', x: cc(16), y: DUNGEON_Y, z: cc(7) - 0.5, ry: Math.PI / 2, collide: true },
  { mod: 'altar', x: cc(16) + 0.6, y: DUNGEON_Y, z: cc(6) + 0.6, ry: 0, collide: true },
  { mod: 'candelabra', x: cc(15) + 0.3, y: DUNGEON_Y, z: cc(6) + 0.3, ry: 0, light: true },
  { mod: 'candelabra', x: cc(18) - 0.3, y: DUNGEON_Y, z: cc(9) - 0.3, ry: 0, light: true },
  { mod: 'skullPile', x: cc(15), y: DUNGEON_Y, z: cc(9), ry: 0.9 },

  // BOSS ARENA — collapsed chapel (x7..11, z-3..1 @ -6)
  { mod: 'pew', x: cc(8), y: DUNGEON_Y, z: cc(-2), ry: 0.15, collide: true },
  { mod: 'pew', x: cc(9), y: DUNGEON_Y, z: cc(-1), ry: -0.4, collide: true },
  { mod: 'pew', x: cc(8), y: DUNGEON_Y, z: cc(0), ry: 0.9, collide: true },
  { mod: 'tabernacle', x: cc(9), y: DUNGEON_Y, z: cc(-3) - 0.3, ry: 0 },
  { mod: 'brazier', x: cc(7) + 0.3, y: DUNGEON_Y, z: cc(-3) + 0.3, ry: 0, collide: true, light: true },
  { mod: 'brazier', x: cc(11) - 0.3, y: DUNGEON_Y, z: cc(-3) + 0.3, ry: 0, collide: true, light: true },
  { mod: 'gargoyle', x: cc(9), y: DUNGEON_Y + 3.0, z: cc(-3) - 0.5, ry: Math.PI },
  { mod: 'bonePile', x: cc(10), y: DUNGEON_Y, z: cc(0), ry: 2.7 },

  // GATE ROOM (x4..7, z-9..-6 @ -6)
  { mod: 'ritual', x: cc(5) + 1.25, y: DUNGEON_Y, z: cc(-8) + 1.25, ry: 0, s: 0.5 },
  { mod: 'candelabra', x: cc(4), y: DUNGEON_Y, z: cc(-9) + 0.4, ry: 0, light: true },
  { mod: 'candelabra', x: cc(7), y: DUNGEON_Y, z: cc(-9) + 0.4, ry: 0, light: true },
  { mod: 'tombStone', x: cc(4), y: DUNGEON_Y, z: cc(-6) - 0.3, ry: 1.9, collide: true },
].filter(Boolean);

// ---- TORCH POINTS -------------------------------------------------------------
// Wall torches: {x,y,z,ry,lit} — ry faces OUT of the wall (flame dir +Z rotated).
// `lit` entries are candidates for real PointLights (budgeted, in listed order);
// the rest are emissive-only. Training torches always lit (separate budget note).
export const TORCH_POINTS = [
  // gatehouse approach (bailey side)
  { x: 10.3, y: 1.6, z: -1.9, ry: -Math.PI / 2, lit: true },
  { x: 10.3, y: 1.6, z: 1.9, ry: -Math.PI / 2, lit: true },
  // gatehouse interior
  { x: 13.75, y: 1.6, z: -4.6, ry: 0, lit: true },
  { x: 13.75, y: 1.6, z: 4.6, ry: Math.PI, lit: true },
  // great hall (pillar-mounted)
  { x: cc(9), y: 1.8, z: cc(-2) + 0.45, ry: 0, lit: true },
  { x: cc(13), y: 1.8, z: cc(-2) + 0.45, ry: 0, lit: true },
  { x: cc(11), y: 1.8, z: cc(2) - 0.45, ry: Math.PI, lit: true },
  { x: cc(15), y: 1.8, z: cc(2) - 0.45, ry: Math.PI, lit: true },
  // chapel
  { x: 31.2, y: 1.6, z: -16.25, ry: Math.PI / 2, lit: true },
  { x: 46.3, y: 1.6, z: -16.25, ry: -Math.PI / 2, lit: true },
  // armory
  { x: 38.75, y: 1.6, z: 13.1, ry: 0, lit: true },
  { x: 46.3, y: 1.6, z: 18.75, ry: -Math.PI / 2, lit: true },
  // stair tower
  { x: 16.9, y: 1.6, z: cc(4), ry: -Math.PI / 2, lit: true },
  // labyrinth — deliberately sparse (dark maze; emissive-only beyond these)
  { x: cc(6) - 0.9, y: DUNGEON_Y + 1.6, z: cc(-5), ry: Math.PI / 2, lit: true },
  { x: cc(6) - 0.9, y: DUNGEON_Y + 1.6, z: cc(0), ry: Math.PI / 2, lit: true },
  { x: cc(8), y: DUNGEON_Y + 1.6, z: cc(2) + 0.9, ry: Math.PI, lit: true },
  { x: cc(12), y: DUNGEON_Y + 1.6, z: cc(9) + 0.9, ry: Math.PI, lit: true },
  // unlit (emissive-only) wall torches for depth
  { x: cc(8), y: DUNGEON_Y + 1.6, z: cc(-4) - 0.9, ry: 0, lit: false },
  { x: cc(13) + 0.9, y: DUNGEON_Y + 1.6, z: cc(-3), ry: -Math.PI / 2, lit: false },
  { x: cc(4) + 0.9, y: DUNGEON_Y + 1.6, z: cc(7), ry: -Math.PI / 2, lit: false },
  { x: cc(12), y: DUNGEON_Y + 1.6, z: cc(5) + 0.9, ry: Math.PI, lit: false },
  { x: 20, y: 1.6, z: -9.6, ry: 0, lit: false },
  { x: 30, y: 1.6, z: 12.1, ry: Math.PI, lit: false },
];

// TRAINING ROOM — same footprint as the old blockout (x 108..128, z -10..10),
// re-skinned with the kit. 4 dummies + spawn must stay compatible with main.js.
export const TRAINING = {
  rect: { x1: 108, z1: -10, x2: 128, z2: 10 },
  spawn: { x: 118, z: 6.5, yaw: 0 },
  dummySpawns: [
    { type: 'bandit', x: 114.5, z: -2.5 },
    { type: 'bandit', x: 114.5, z: 2.5 },
    { type: 'skeleton', x: 121.5, z: -2.5 },
    { type: 'knight', x: 121.5, z: 2.5 },
  ],
  torches: [
    { x: 110, y: 1.8, z: -8, ry: 0 }, { x: 126, y: 1.8, z: -8, ry: 0 },
    { x: 110, y: 1.8, z: 8, ry: Math.PI }, { x: 126, y: 1.8, z: 8, ry: Math.PI },
    { x: 118, y: 1.8, z: -9, ry: 0 }, { x: 118, y: 1.8, z: 9, ry: Math.PI },
  ],
  props: [
    { mod: 'rack', x: 109.5, y: 0, z: -3, ry: Math.PI / 2, collide: true },
    { mod: 'rack', x: 109.5, y: 0, z: 3, ry: Math.PI / 2, collide: true },
    { mod: 'barrel', x: 109.8, y: 0, z: 8.5, ry: 0, collide: true },
    { mod: 'candelabra', x: 118, y: 0, z: -8.5, ry: 0 },
    { mod: 'pew', x: 126.5, y: 0, z: 6.5, ry: Math.PI, collide: true },
  ],
};

// ---- SPAWNS / LOOT / AMBUSHES ------------------------------------------------
// Risk gradient: bailey scraps -> keep valuables -> labyrinth/vault relics.
export const LOOT_SPAWNS = [
  { x: -12, z: -6, table: 'gold' },                              // bailey
  { x: -2, z: 12, table: 'gold' },                               // bailey south
  { x: 13.75, z: 3.5, table: 'gold' },                           // gatehouse
  { x: 20, z: -8.5, table: 'gold' },                             // hall west
  { x: 33, z: 8.5, table: 'armor' },                             // hall south
  { x: 46, z: -1.6, y: 0.45, table: 'gold' },                    // hall dais
  { x: 36, z: -19.8, table: 'relic' },                           // chapel altar
  { x: 45.5, z: -21.3, table: 'cursed' },                        // chapel corner
  { x: 39.5, z: 14.5, table: 'weapon' },                         // armory racks
  { x: 44.5, z: 22.5, table: 'armor' },                          // armory back
  { x: 16.2, z: 15.5, table: 'gold' },                           // stair tower
  { x: cc(14), z: cc(-5), y: DUNGEON_Y, table: 'gold' },         // maze nook (cage)
  { x: cc(14), z: cc(-2), y: DUNGEON_Y, table: 'gold' },         // ambush nook bait
  { x: cc(4), z: cc(9), y: DUNGEON_Y, table: 'cursed' },         // maze tomb nook
  { x: cc(8), z: cc(8), y: DUNGEON_Y, table: 'gold' },           // maze south
  { x: cc(16), z: cc(8), y: DUNGEON_Y, table: 'relic' },         // VAULT chest
  { x: cc(17), z: cc(7), y: DUNGEON_Y, table: 'relic' },         // VAULT altar
  { x: cc(16), z: cc(9), y: DUNGEON_Y, table: 'gold' },          // vault floor
  { x: cc(9), z: cc(-2), y: DUNGEON_Y, table: 'weapon' },        // boss arena
];

export const ENEMY_SPAWNS = [
  { type: 'bandit', x: -10, z: -2 },                             // bailey
  { type: 'bandit', x: -4, z: 8 },                               // bailey south
  { type: 'knight', x: 13.75, z: 0 },                            // gatehouse choke
  { type: 'knight', x: 24, z: 0 },                               // hall
  { type: 'knight', x: 34, z: -4 },                              // hall east
  { type: 'bandit', x: 30, z: 9.5 },                             // hall south
  { type: 'bandit', x: 37.5, z: -6.5, y: 3 },                    // hall balcony flanker
  { type: 'skeleton', x: 34, z: -17 },                           // chapel
  { type: 'skeleton', x: 42, z: -15 },                           // chapel
  { type: 'knight', x: 40, z: 20 },                              // armory
  { type: 'skeleton', x: cc(8), z: cc(-5), y: DUNGEON_Y },       // maze north
  { type: 'skeleton', x: cc(6), z: cc(5), y: DUNGEON_Y },        // maze west
  { type: 'skeleton', x: cc(12), z: cc(9), y: DUNGEON_Y },       // maze south
  { type: 'knight', x: cc(16), z: cc(7), y: DUNGEON_Y },         // vault guard
  { type: 'knight', x: cc(17), z: cc(8), y: DUNGEON_Y },         // vault guard
  { type: 'knight', x: cc(9), z: cc(-1), y: DUNGEON_Y, boss: true }, // THE GATE WARDEN (arena)
];

export const AMBUSH_VOLUMES = [
  // bailey approach — skeletons claw up near the gallows
  { x1: -14, z1: -8, x2: -4, z2: 0, triggered: false,
    spawns: [{ type: 'skeleton', x: -9, z: -5, rise: true }, { type: 'skeleton', x: -6, z: -2, rise: true }] },
  // great hall center — bones rise between the pillars
  { x1: 26, z1: -3, x2: 32, z2: 3, triggered: false,
    spawns: [{ type: 'skeleton', x: 28, z: -1, rise: true }, { type: 'skeleton', x: 30, z: 1, rise: true }] },
  // labyrinth mid — the dark wakes up
  { x1: cc(6) - 1.25, z1: cc(2) - 1.25, x2: cc(8) + 1.25, z2: cc(3) + 1.25, triggered: false,
    spawns: [{ type: 'skeleton', x: cc(6), z: cc(3), y: DUNGEON_Y, rise: true }, { type: 'skeleton', x: cc(8), z: cc(2), y: DUNGEON_Y, rise: true }] },
  // vault approach corridor — last line of defense
  { x1: cc(12) - 1.25, z1: cc(8) - 1.25, x2: cc(12) + 1.25, z2: cc(9) + 1.25, triggered: false,
    spawns: [{ type: 'skeleton', x: cc(12), z: cc(8), y: DUNGEON_Y, rise: true }, { type: 'skeleton', x: cc(12), z: cc(9), y: DUNGEON_Y, rise: true }] },
];

// ---- run anchors --------------------------------------------------------------
export const SPAWN = { x: -24, z: 0, yaw: Math.PI / 2 };   // bailey west, facing the keep
export const GATE_ROOM = { cells: { x: [4, 7], z: [-9, -6] } };
export const EXTRACT = { x: cc(5) + 1.25, z: cc(-8) + 1.25 }; // on the ritual circle
export const VAULT_CELL = { x: 16, z: 7 };                  // wisp path origin
export const GATE_CELL = { x: 5, z: -7 };                   // wisp path destination

// ---- maze helpers ---------------------------------------------------------------
// Normalize rows to equal length, return {at(x,z), open(x,z)} accessors.
export function parseMaze() {
  const w = Math.max(...MAZE.map(r => r.length));
  const rows = MAZE.map(r => r.padEnd(w, '#'));
  const at = (x, z) => {
    const r = z - MAZE_ROW0, c = x - MAZE_COL0;
    if (r < 0 || r >= rows.length || c < 0 || c >= w) return '#';
    return rows[r][c];
  };
  // stair-run cells (W/E) are structurally solid at maze level — the shafts
  // are entered through their landings (L/M) only
  const open = (x, z) => { const c = at(x, z); return c !== '#' && c !== 'W' && c !== 'E'; };
  return { at, open, w, h: rows.length };
}

// BFS shortest path over open maze cells. Returns [{x,z}...] cell coords or null.
export function mazePath(from, to) {
  const { open } = parseMaze();
  const key = (x, z) => x + ',' + z;
  const prev = new Map([[key(from.x, from.z), null]]);
  const q = [[from.x, from.z]];
  while (q.length) {
    const [x, z] = q.shift();
    if (x === to.x && z === to.z) {
      const path = [];
      let k = key(x, z);
      while (k) { const [px, pz] = k.split(',').map(Number); path.unshift({ x: px, z: pz }); k = prev.get(k); }
      return path;
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, nk = key(nx, nz);
      if (!open(nx, nz) || prev.has(nk)) continue;
      prev.set(nk, key(x, z));
      q.push([nx, nz]);
    }
  }
  return null;
}
