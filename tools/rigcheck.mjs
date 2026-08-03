// rigcheck.mjs — verify animation clip bone names match ModularCharacters.fbx rig.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { readFileSync } from 'fs';

global.document = {
  createElementNS: () => ({
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {},
  }),
};
global.self = global;

const loader = new FBXLoader();
const load = (p) => {
  const buf = readFileSync(p);
  return loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
};

// 1) Rig bones
const rig = load('.asset-tmp/mfh_tree2/Assets/Synty/PolygonFantasyHeroCharacters/Models/FixedScale/ModularCharacters.fbx');
const bones = new Set();
let skinnedCount = 0;
const skinnedNames = [];
rig.traverse((o) => {
  if (o.isBone) bones.add(o.name);
  if (o.isSkinnedMesh) { skinnedCount++; if (skinnedNames.length < 8) skinnedNames.push(o.name); }
});
console.log('RIG bones:', bones.size, '| skinned meshes:', skinnedCount);
console.log('sample skinned meshes:', skinnedNames.join(', '));
console.log('sample bones:', [...bones].slice(0, 25).join(', '));

// 2) Clip track targets
const clipFiles = [
  'public/assets/anims/A_Idle_Base_Sword.fbx',
  'public/assets/anims/A_Attack_LightCombo01A_Sword.fbx',
  'public/assets/anims/A_Walk_F_Masc.fbx',
];
for (const f of clipFiles) {
  const g = load(f);
  const targets = new Set();
  let clips = g.animations || [];
  for (const c of clips) for (const t of c.tracks) targets.add(t.name.split('.')[0]);
  const missing = [...targets].filter((n) => !bones.has(n));
  const dur = clips[0] ? clips[0].duration.toFixed(2) : '?';
  console.log(`\nCLIP ${f.split('/').pop()}: tracks=${targets.size} dur=${dur}s missing_in_rig=${missing.length}`);
  if (missing.length) console.log('  missing:', missing.slice(0, 12).join(', '));
}
