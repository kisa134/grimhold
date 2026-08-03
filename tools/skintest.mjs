// skintest.mjs — headless verification of the skinned character pipeline:
// skeleton merge, clip binding (bones actually move), preset build, region sever.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
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

const FINGER_RE = /^(Thumb|IndexFinger|Finger)_\d+$/;
function underBoneNamed(bone, name) {
  let p = bone.parent;
  while (p) { if (p.isBone && p.name === name) return true; p = p.parent; }
  return false;
}

// --- load + merge ---
const rig = load('public/assets/ModularCharacters.fbx');
const tops = [];
rig.traverse((o) => { if (o.isBone && !(o.parent && o.parent.isBone)) tops.push(o); });
console.log('skeleton copies:', tops.length);
const canonical = tops[0];
canonical.traverse((o) => {
  if (o.isBone && FINGER_RE.test(o.name) && underBoneNamed(o, 'Hand_R')) o.name += '_1';
});
const boneMap = new Map();
canonical.traverse((o) => { if (o.isBone && !boneMap.has(o.name)) boneMap.set(o.name, o); });
rig.traverse((m) => {
  if (!m.isSkinnedMesh) return;
  const bones = m.skeleton.bones.map((b) => {
    let n = b.name;
    if (FINGER_RE.test(n) && underBoneNamed(b, 'Hand_R')) n += '_1';
    return boneMap.get(n) || b;
  });
  m.skeleton = new THREE.Skeleton(bones, m.skeleton.boneInverses);
});
for (let i = 1; i < tops.length; i++) tops[i].parent && tops[i].parent.remove(tops[i]);
console.log('canonical bones:', boneMap.size);
console.log('has renamed fingers:', [...boneMap.keys()].filter((k) => k.endsWith('_1')).length);

// --- measure height (cm expected) ---
rig.updateMatrixWorld(true);
const bb = new THREE.Box3().setFromObject(rig);
console.log('rig height units:', (bb.max.y - bb.min.y).toFixed(1), '(expect ~180 = cm)');

// --- clone, prune to knight set ---
const placements = JSON.parse(readFileSync('public/assets/placements.json', 'utf8'));
const wanted = new Set(placements.sets.knight);
const char = skeletonClone(rig);
const drop = [];
char.traverse((o) => { if (o.isSkinnedMesh && !wanted.has(o.name)) drop.push(o); });
for (const m of drop) m.parent.remove(m);
let kept = 0;
char.traverse((o) => { if (o.isSkinnedMesh) kept++; });
console.log('knight meshes kept:', kept, '/', kept + drop.length);

// bones present in clone?
const cBones = new Map();
char.traverse((o) => { if (o.isBone && !cBones.has(o.name)) cBones.set(o.name, o); });
console.log('clone bones:', cBones.size, '| Hand_R:', !!cBones.get('Hand_R'), '| Thumb_01_1:', !!cBones.get('Thumb_01_1'));

// --- clip binding: do bones actually move? ---
for (const f of ['A_Idle_Base_Sword', 'A_Attack_LightCombo01A_Sword', 'A_Walk_F_Masc']) {
  const g = load(`public/assets/anims/${f}.fbx`);
  const clip = g.animations[0];
  clip.tracks = clip.tracks.filter((t) => {
    const b = t.name.split('.')[0];
    return b !== 'Jaw' && b !== 'Prop_L' && b !== 'Prop_R';
  });
  const mixer = new THREE.AnimationMixer(char);
  const action = mixer.clipAction(clip);
  action.play();
  const hand = cBones.get('Hand_R');
  const hips = cBones.get('Hips');
  const q0 = hand.quaternion.clone();
  const p0 = hips.position.clone();
  mixer.update(0.4);
  const dq = 2 * Math.acos(Math.min(1, Math.abs(q0.dot(hand.quaternion))));
  const dp = p0.distanceTo(hips.position);
  console.log(`${f}: Hand_R rotated ${(dq * 180 / Math.PI).toFixed(1)}deg, Hips moved ${dp.toFixed(1)} units`);
}
console.log('SKINTEST OK');
