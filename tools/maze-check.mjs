// maze-check.mjs — validate the labyrinth grid + placements in leveldata.js:
// connectivity (every open cell reachable), landmark cells open, door
// boundaries connect two open cells, wisp path vault->gate exists, stats.
import {
  MAZE, MAZE_COL0, MAZE_ROW0, MAZE_DOORS, SHAFTS, parseMaze, mazePath,
  VAULT_CELL, GATE_CELL, ENEMY_SPAWNS, LOOT_SPAWNS, DUNGEON_Y, CELL,
} from '../src/leveldata.js';

const { at, open, w, h } = parseMaze();
let fail = 0;
const bad = (m) => { console.error('FAIL:', m); fail++; };

// row widths
console.log(`grid: ${w}x${h} cells (${w * CELL}m x ${h * CELL}m)`);

// print with column ruler
let ruler = '    ';
for (let i = 0; i < w; i++) ruler += ((MAZE_COL0 + i) % 10);
console.log(ruler);
MAZE.forEach((r, i) => console.log(String(MAZE_ROW0 + i).padStart(3) + ' ' + r.padEnd(w, '#')));

// flood fill from the west shaft landing
const start = { x: SHAFTS[0].landing.x, z: SHAFTS[0].landing.z };
if (!open(start.x, start.z)) bad(`west landing ${start.x},${start.z} not open`);
const seen = new Set([start.x + ',' + start.z]);
const q = [[start.x, start.z]];
while (q.length) {
  const [x, z] = q.shift();
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, nz = z + dz, k = nx + ',' + nz;
    if (!open(nx, nz) || seen.has(k)) continue;
    seen.add(k); q.push([nx, nz]);
  }
}
let openCount = 0, unreachable = [];
for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
  const x = MAZE_COL0 + c, z = MAZE_ROW0 + r;
  if (!open(x, z)) continue;
  openCount++;
  if (!seen.has(x + ',' + z)) unreachable.push(`${at(x, z)}@${x},${z}`);
}
if (unreachable.length) bad('unreachable open cells: ' + unreachable.join(' '));
console.log(`open cells: ${openCount}, reachable: ${seen.size}`);

// landmarks open
for (const [label, cell] of [['vault', VAULT_CELL], ['gate', GATE_CELL],
    ['east landing', SHAFTS[1].landing]]) {
  if (!open(cell.x, cell.z)) bad(`${label} cell ${cell.x},${cell.z} not open`);
}

// doors connect open cells (or gate connects to outside)
for (const d of MAZE_DOORS) {
  const dx = d.dir === 'E' ? 1 : d.dir === 'W' ? -1 : 0;
  const dz = d.dir === 'S' ? 1 : d.dir === 'N' ? -1 : 0;
  if (!open(d.x, d.z)) bad(`door origin ${d.x},${d.z} not open`);
  if (d.kind !== 'gate' && !open(d.x + dx, d.z + dz)) bad(`door target ${d.x + dx},${d.z + dz} not open`);
}

// wisp path
const path = mazePath(VAULT_CELL, GATE_CELL);
if (!path) bad('no maze path vault -> gate');
else console.log(`wisp path: ${path.length} cells (~${(path.length * CELL).toFixed(0)} m)`);

// enemy/loot in open cells when in the dungeon
for (const s of ENEMY_SPAWNS.filter(s => s.y === DUNGEON_Y)) {
  const cx = Math.floor(s.x / CELL), cz = Math.floor(s.z / CELL);
  if (!open(cx, cz)) bad(`enemy spawn in solid cell ${cx},${cz} (${s.type})`);
}
for (const s of LOOT_SPAWNS.filter(s => s.y === DUNGEON_Y)) {
  const cx = Math.floor(s.x / CELL), cz = Math.floor(s.z / CELL);
  if (!open(cx, cz)) bad(`loot spawn in solid cell ${cx},${cz} (${s.table})`);
}

// shaft cells are marked W/E and landings L/M
for (const sh of SHAFTS) {
  for (const c of sh.cells) {
    const ch = at(c.x, c.z);
    if (ch !== 'W' && ch !== 'E') bad(`shaft ${sh.id} cell ${c.x},${c.z} is '${ch}'`);
  }
}

console.log(fail ? `MAZE CHECK: ${fail} problem(s)` : 'MAZE CHECK OK');
process.exit(fail ? 1 : 0);
