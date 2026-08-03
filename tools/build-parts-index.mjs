// build-parts-index.mjs — scans the Synty modular character catalog and writes
// public/assets/parts-index.json for the character creator.
//
// Source of truth: the skinned meshes inside public/assets/ModularCharacters.fbx
// (the creator assembles SKINNED characters, so names must exist there — this
// covers both genders, unlike public/assets/parts/ which only holds the male
// static extractions). The static parts directory is cross-checked so the
// index also records which names have an on-disk static FBX.
//
// Run: node tools/build-parts-index.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { SLOT_DEFS, classifyPart, normalizePartName } from '../src/partnames.js';

global.document = {
  createElementNS: () => ({
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {},
  }),
};
global.self = global;

const FBX = 'public/assets/ModularCharacters.fbx';
const PARTS_DIR = 'public/assets/parts';
const OUT = 'public/assets/parts-index.json';

const buf = readFileSync(FBX);
const rig = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
const meshNames = new Set();
rig.traverse((m) => { if (m.isSkinnedMesh) meshNames.add(m.name); });

const onDisk = new Set(
  readdirSync(PARTS_DIR)
    .filter((f) => f.endsWith('_Static.fbx'))
    .map((f) => f.slice(0, -'_Static.fbx'.length)),
);

// ---- group names into slots -------------------------------------------------
const slots = {};
for (const def of SLOT_DEFS) {
  slots[def.key] = def.gendered
    ? { gendered: true, pair: def.pair, optional: def.optional,
        label: def.label,
        ...(def.pair ? { left: def.left, right: def.right } : {}),
        options: { Male: [], Female: [] } }
    : { gendered: false, pair: def.pair, optional: def.optional,
        label: def.label,
        ...(def.pair ? { left: def.left, right: def.right } : {}),
        options: [] };
}

const unclassified = [];
const pairedSeen = {}; // slotKey -> gender|'neutral' -> Map nn -> {left,right}
for (const name of meshNames) {
  const c = classifyPart(name);
  if (!c) { unclassified.push(name); continue; }
  const def = SLOT_DEFS.find((s) => s.key === c.slot);
  const slot = slots[c.slot];
  if (def.pair) {
    const bucket = def.gendered ? c.gender : 'neutral';
    const key = `${c.slot}|${bucket}`;
    const m = (pairedSeen[key] ||= new Map());
    const e = (m.get(c.nn) || { left: false, right: false });
    if (c.side === 'Left') e.left = true; else e.right = true;
    m.set(c.nn, e);
  } else if (def.gendered) {
    slot.options[c.gender].push(name);
  } else {
    slot.options.push(name);
  }
}

// paired options: only NNs present on BOTH sides (keeps left/right compatible)
for (const [key, m] of Object.entries(pairedSeen)) {
  const [slotKey, bucket] = key.split('|');
  const slot = slots[slotKey];
  const both = [...m.entries()].filter(([, e]) => e.left && e.right).map(([nn]) => nn);
  both.sort();
  if (slot.gendered) slot.options[bucket] = both;
  else slot.options = both;
}

const natSort = (a, b) => a.localeCompare(b, undefined, { numeric: true });
for (const slot of Object.values(slots)) {
  if (slot.gendered) { slot.options.Male.sort(natSort); slot.options.Female.sort(natSort); }
  else if (!slot.pair) slot.options.sort(natSort);
}

const all = [...meshNames].sort(natSort);
const index = {
  version: 1,
  generated: new Date().toISOString(),
  meshCount: all.length,
  staticCount: all.filter((n) => onDisk.has(n)).length,
  slots,
  all,
  static: all.filter((n) => onDisk.has(n)),
  unclassified,
};

writeFileSync(OUT, JSON.stringify(index));
const perSlot = Object.entries(slots).map(([k, s]) => {
  const n = s.gendered ? `M:${s.options.Male.length} F:${s.options.Female.length}` : `${s.options.length}`;
  return `${k}=${n}`;
}).join(' ');
console.log('PARTS INDEX OK:', `meshes=${all.length}`, `static=${index.staticCount}`,
  `unclassified=${unclassified.length}`, perSlot);
if (unclassified.length) console.log('  unclassified:', unclassified.slice(0, 10).join(', '));
console.log('  wrote', OUT);
