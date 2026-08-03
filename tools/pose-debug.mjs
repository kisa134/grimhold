// pose-debug.mjs — diagnose WHY the current rebind twists body parts, and
// verify the fix: boneInverses taken from the ANIM rig's bind pose instead of
// the character rig's bind pose. Prints per-part centroids at idle t=50%.
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

const charRig = load('public/assets/ModularCharacters.fbx');
charRig.updateMatrixWorld(true);
const placements = JSON.parse(readFileSync('public/assets/placements.json', 'utf8'));
const wanted = new Set(placements.sets.knight);
const meshes = [];
charRig.traverse((o) => { if (o.isSkinnedMesh && wanted.has(o.name)) meshes.push(o); });

const idleFbx = load('public/assets/anims/A_Idle_Base_Sword.fbx');
idleFbx.updateMatrixWorld(true);

// does the anim FBX carry its own skinned mesh (=> true bind pose)?
let animSkinned = null;
idleFbx.traverse((o) => { if (!animSkinned && o.isSkinnedMesh) animSkinned = o; });
console.log('anim FBX skinned mesh:', animSkinned ? animSkinned.name : 'NONE');
if (animSkinned) {
  console.log('anim bind bones:', animSkinned.skeleton.bones.length);
}

let animRoot = null;
idleFbx.traverse((o) => { if (!animRoot && o.isBone && !(o.parent && o.parent.isBone)) animRoot = o; });

// compare rest world positions: char rig vs anim rig for key joints
const charBones = new Map();
charRig.traverse((o) => { if (o.isBone && !charBones.has(o.name)) charBones.set(o.name, o); });
const animBones = new Map();
idleFbx.traverse((o) => { if (o.isBone && !animBones.has(o.name)) animBones.set(o.name, o); });
const wp = new THREE.Vector3();
for (const n of ['Hips', 'Spine_03', 'Head', 'Hand_L', 'Hand_R', 'Foot_L', 'Foot_R']) {
  const c = charBones.get(n); const a = animBones.get(n);
  if (!c || !a) { console.log(n, 'missing', !!c, !!a); continue; }
  const cw = c.getWorldPosition(new THREE.Vector3());
  const aw = a.getWorldPosition(new THREE.Vector3());
  console.log(`${n}: char(${cw.x.toFixed(1)},${cw.y.toFixed(1)},${cw.z.toFixed(1)}) anim(${aw.x.toFixed(1)},${aw.y.toFixed(1)},${aw.z.toFixed(1)}) d=${cw.distanceTo(aw).toFixed(1)}cm`);
}

// build fresh bone hierarchy from anim rig
function cloneBoneTree(src, parent) {
  const b = new THREE.Bone();
  b.name = src.name;
  b.position.copy(src.position);
  b.quaternion.copy(src.quaternion);
  b.scale.copy(src.scale);
  if (parent) parent.add(b);
  for (const ch of src.children) if (ch.isBone) cloneBoneTree(ch, b);
  return b;
}

// bind pose inverses from anim FBX skinned mesh (if any), by bone name
const animBindInv = new Map();
if (animSkinned) {
  animSkinned.skeleton.bones.forEach((b, i) => {
    if (!animBindInv.has(b.name)) animBindInv.set(b.name, animSkinned.skeleton.boneInverses[i].clone());
  });
}

function build(variant) {
  const boneRoot = cloneBoneTree(animRoot, null);
  const newBones = new Map();
  boneRoot.traverse((b) => { if (!newBones.has(b.name)) newBones.set(b.name, b); });
  const group = new THREE.Group();
  group.add(boneRoot);
  group.updateMatrixWorld(true); // rest pose world matrices (cm frame)
  for (const m of meshes) {
    const bones = [];
    const invs = [];
    m.skeleton.bones.forEach((cb, i) => {
      const nb = newBones.get(cb.name) || newBones.get('Hips');
      bones.push(nb);
      if (variant === 'A') {
        invs.push(m.skeleton.boneInverses[i].clone());
      } else {
        // B: anim bind inverse by name; fallback: inverse of rest world matrix
        const bi = animBindInv.get(cb.name) || animBindInv.get('Hips')
          || nb.matrixWorld.clone().invert();
        invs.push(bi.clone());
      }
    });
    const skel = new THREE.Skeleton(bones, invs);
    const clone = m.clone();
    clone.geometry = m.geometry;
    clone.bind(skel, m.bindMatrix.clone());
    group.add(clone);
  }
  group.scale.setScalar(0.01);
  group.updateMatrixWorld(true);
  return group;
}

const REGION = [
  ['head', /Head_|Eyebrow|FacialHair/],
  ['torso', /Torso|Hips(?!Attach)|BackAttach|ChestAttach|Cape/],
  ['armL', /ArmUpperLeft|ArmLowerLeft|HandLeft|ElbowAttachLeft|ShoulderAttachLeft/],
  ['armR', /ArmUpperRight|ArmLowerRight|HandRight|ElbowAttachRight|ShoulderAttachRight/],
  ['legL', /LegLeft|KneeAttachLeft/],
  ['legR', /LegRight|KneeAttachRight/],
];

function measureParts(group, tag) {
  group.updateMatrixWorld(true);
  const acc = REGION.map(() => ({ n: 0, c: new THREE.Vector3(), minY: Infinity, maxY: -Infinity }));
  const v = new THREE.Vector3();
  group.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const ri = REGION.findIndex(([, re]) => re.test(m.name));
    if (ri < 0) return;
    const pos = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 60));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i);
      m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      acc[ri].n++; acc[ri].c.add(v);
      acc[ri].minY = Math.min(acc[ri].minY, v.y); acc[ri].maxY = Math.max(acc[ri].maxY, v.y);
    }
  });
  console.log(`-- ${tag}`);
  REGION.forEach(([name], i) => {
    const a = acc[i];
    if (!a.n) return;
    a.c.divideScalar(a.n);
    console.log(`  ${name}: c=(${a.c.x.toFixed(2)},${a.c.y.toFixed(2)},${a.c.z.toFixed(2)}) y[${a.minY.toFixed(2)}..${a.maxY.toFixed(2)}]`);
  });
}

const idleClip = idleFbx.animations[0];
for (const variant of ['A', 'B']) {
  const group = build(variant);
  const mixer = new THREE.AnimationMixer(group);
  const a = mixer.clipAction(idleClip);
  a.play();
  mixer.update(idleClip.duration * 0.5);
  measureParts(group, `variant ${variant} @ idle 50%`);
}
console.log('POSE DEBUG DONE');
