// retarget-test.mjs — put character MESHES on the ANIMATION rig's bone
// hierarchy. Clips play on their native skeleton; meshes follow via their
// original boneInverses (same world T-pose). Measure real skinned vertices.
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

// 1) char meshes (knight preset)
const charRig = load('public/assets/ModularCharacters.fbx');
const placements = JSON.parse(readFileSync('public/assets/placements.json', 'utf8'));
const wanted = new Set(placements.sets.knight);
const meshes = [];
charRig.updateMatrixWorld(true);
charRig.traverse((o) => {
  if (o.isSkinnedMesh && wanted.has(o.name)) meshes.push(o);
});
console.log('knight meshes:', meshes.length);

// 2) anim rig hierarchy from the idle FBX
const animRig = load('public/assets/anims/A_Idle_Base_Sword.fbx');
const animBones = new Map();
animRig.traverse((o) => { if (o.isBone && !animBones.has(o.name)) animBones.set(o.name, o); });
console.log('anim rig bones:', animBones.size);
console.log('anim has _1 fingers:', [...animBones.keys()].filter(k => k.endsWith('_1')).length,
  '| Jaw:', animBones.has('Jaw'), '| Prop_L:', animBones.has('Prop_L'));

// clone the anim bone hierarchy (fresh THREE.Bone chain, same locals)
function cloneBoneTree(src, parent) {
  const b = new THREE.Bone();
  b.name = src.name;
  b.position.copy(src.position);
  b.quaternion.copy(src.quaternion);
  b.scale.copy(src.scale);
  if (parent) parent.add(b);
  for (const c of src.children) if (c.isBone) cloneBoneTree(c, b);
  return b;
}
let animRoot = null;
animRig.traverse((o) => {
  if (!animRoot && o.isBone && !(o.parent && o.parent.isBone)) animRoot = o;
});
const boneRoot = cloneBoneTree(animRoot, null);
const newBones = new Map();
boneRoot.traverse((b) => { if (!newBones.has(b.name)) newBones.set(b.name, b); });

// 3) rebind char meshes to the anim-hierarchy bones
const group = new THREE.Group();
group.add(boneRoot);
let unmapped = new Set();
for (const m of meshes) {
  const bones = m.skeleton.bones.map((b) => {
    const nb = newBones.get(b.name);
    if (!nb) unmapped.add(b.name);
    return nb || newBones.get('Hips');
  });
  const skel = new THREE.Skeleton(bones, m.skeleton.boneInverses);
  const clone = m.clone();
  clone.geometry = m.geometry;
  clone.bind(skel, m.bindMatrix.clone());
  group.add(clone);
}
console.log('unmapped bones (fallback to Hips):', [...unmapped].join(',') || 'none');

group.scale.setScalar(0.01);
group.updateMatrixWorld(true);

// 4) measure skinned world bbox
function measure(tag) {
  group.updateMatrixWorld(true);
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const v = new THREE.Vector3();
  group.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const pos = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 40));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i);
      m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      min.min(v); max.max(v);
    }
  });
  const s = max.clone().sub(min);
  console.log(`${tag}: size ${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)} m, minY=${min.y.toFixed(2)} maxY=${max.y.toFixed(2)}`);
}

measure('no anim');

// 5) play clips natively
const mixer = new THREE.AnimationMixer(group);
for (const f of ['A_Idle_Base_Sword', 'A_Walk_F_Masc', 'A_Attack_LightCombo01A_Sword', 'A_Death_B_01_Sword']) {
  const g = load(`public/assets/anims/${f}.fbx`);
  const clip = g.animations[0];
  mixer.stopAllAction();
  const a = mixer.clipAction(clip);
  a.play();
  mixer.update(clip.duration * 0.5);
  measure(`${f} t=50%`);
}
console.log('RETARGET TEST DONE');
