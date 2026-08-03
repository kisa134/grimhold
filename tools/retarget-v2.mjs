// retarget-v2.mjs — VARIANT C: bake anim-rig clips onto the CHARACTER rig.
// The char rig binds its own meshes perfectly; we convert every clip track
// from anim-rig local space to char-rig local space via constant per-bone
// offsets K_b. K_b comes from reconstructing the anim rig's T-pose: joint
// positions taken from the char rig (same Synty proportions), orientations
// transported from the anim rig's rest pose by the shortest arc that brings
// each bone's direction onto its T-pose direction.
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
const idleFbx = load('public/assets/anims/A_Idle_Base_Sword.fbx');
idleFbx.updateMatrixWorld(true);

// ---- collect rigs -------------------------------------------------------------
const charBones = new Map();   // name -> bone (char rig, T-pose)
let charRoot = null;
charRig.traverse((o) => {
  if (!o.isBone) return;
  if (!charBones.has(o.name)) charBones.set(o.name, o);
  if (!charRoot && !(o.parent && o.parent.isBone)) charRoot = o;
});
const animBones = new Map();
let animRoot = null;
idleFbx.traverse((o) => {
  if (!o.isBone) return;
  if (!animBones.has(o.name)) animBones.set(o.name, o);
  if (!animRoot && !(o.parent && o.parent.isBone)) animRoot = o;
});

const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
const wquat = (o) => o.getWorldQuaternion(new THREE.Quaternion());

// bone direction = toward the child that itself has bone children OR longest offset
function primaryChild(bone) {
  let best = null; let bestLen = -1;
  for (const c of bone.children) {
    if (!c.isBone) continue;
    const len = c.position.length();
    if (len > bestLen) { bestLen = len; best = c; }
  }
  return best;
}

// ---- reconstruct anim T-pose worlds -------------------------------------------
// A_q[b] = quaternion of anim bone b in T-pose (world)
const A_q = new Map();
function solveAnimTPose(bone) {
  const name = bone.name;
  const rest_q = wquat(bone);
  const cb = charBones.get(name);
  const child = primaryChild(bone);
  let q;
  if (cb && child && animBones.get(child.name) && charBones.get(child.name)) {
    const dRest = wpos(animBones.get(child.name)).sub(wpos(bone));
    const dT = wpos(charBones.get(child.name)).sub(wpos(cb));
    if (dRest.lengthSq() > 1e-6 && dT.lengthSq() > 1e-6) {
      const align = new THREE.Quaternion().setFromUnitVectors(dRest.normalize(), dT.normalize());
      q = align.multiply(rest_q);
    }
  }
  if (!q) {
    // leaf or unmapped: inherit parent's transport (or rest as last resort)
    const p = bone.parent;
    if (p && p.isBone && A_q.has('__align__' + p.name)) {
      q = A_q.get('__align__' + p.name).clone().multiply(rest_q);
    } else {
      q = rest_q.clone();
    }
    A_q.set(name, q);
    A_q.set('__align__' + name, new THREE.Quaternion()); // no transport info
  } else {
    A_q.set(name, q);
    const dRest = wpos(animBones.get(child.name)).sub(wpos(bone)).normalize();
    const dT = wpos(charBones.get(child.name)).sub(wpos(cb)).normalize();
    A_q.set('__align__' + name, new THREE.Quaternion().setFromUnitVectors(dRest, dT));
  }
  for (const c of bone.children) if (c.isBone) solveAnimTPose(c);
}
A_q.set('__align__' + animRoot.name, new THREE.Quaternion());
solveAnimTPose(animRoot);

// ---- per-bone offsets K_b = quat(A_b)^-1 * quat(Bc_b) --------------------------
const K = new Map(); // name -> Quaternion
for (const [name, cb] of charBones) {
  const aq = A_q.get(name);
  if (!aq) continue;
  K.set(name, aq.clone().invert().multiply(wquat(cb)));
}
// frame offset for the root's parent (armature): absorbs file-level conversions
const K_arm = wquat(animRoot.parent).invert().multiply(wquat(charRoot.parent));
console.log('K computed for bones:', K.size, '| K_arm angle(deg):',
  (2 * Math.acos(Math.min(1, Math.abs(K_arm.w))) * 180 / Math.PI).toFixed(1));

// ---- retarget a clip -----------------------------------------------------------
function retargetClip(clip) {
  const tracks = [];
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.');
    const bone = t.name.slice(0, dot);
    const prop = t.name.slice(dot + 1);
    if (!charBones.has(bone) || !K.has(bone)) continue; // skip unknown/duplicate
    const cb = charBones.get(bone);
    const kp = (cb.parent && cb.parent.isBone)
      ? (K.get(cb.parent.name) || new THREE.Quaternion()).clone().invert()
      : K_arm.clone().invert();
    const kb = K.get(bone);
    if (prop === 'quaternion') {
      const vals = new Float32Array(t.values.length);
      for (let i = 0; i < t.values.length; i += 4) {
        q.fromArray(t.values, i);
        q.premultiply(kp).multiply(kb);
        q.toArray(vals, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(t.name, Array.from(t.times), Array.from(vals)));
    } else if (prop === 'position') {
      const vals = new Float32Array(t.values.length);
      for (let i = 0; i < t.values.length; i += 3) {
        v.fromArray(t.values, i).applyQuaternion(kp);
        v.toArray(vals, i);
      }
      tracks.push(new THREE.VectorKeyframeTrack(t.name, Array.from(t.times), Array.from(vals)));
    }
    // scale tracks dropped on purpose
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// ---- build character on its OWN rig --------------------------------------------
const placements = JSON.parse(readFileSync('public/assets/placements.json', 'utf8'));
const wanted = new Set(placements.sets.knight);

// clone char bone hierarchy; root local := its original WORLD (armature baked in)
function cloneCharBone(src, parent, isRoot) {
  const b = new THREE.Bone();
  b.name = src.name;
  if (isRoot) {
    src.matrixWorld.decompose(b.position, b.quaternion, b.scale);
  } else {
    b.position.copy(src.position);
    b.quaternion.copy(src.quaternion);
    b.scale.copy(src.scale);
  }
  if (parent) parent.add(b);
  for (const c of src.children) if (c.isBone) b.add(cloneCharBone(c, b, false));
  return b;
}
const boneRoot = cloneCharBone(charRoot, null, true);
const newBones = new Map();
boneRoot.traverse((b) => { if (!newBones.has(b.name)) newBones.set(b.name, b); });

const group = new THREE.Group();
group.add(boneRoot);
charRig.traverse((o) => {
  if (!o.isSkinnedMesh || !wanted.has(o.name)) return;
  const bones = o.skeleton.bones.map((b) => newBones.get(b.name) || newBones.get('Hips'));
  const skel = new THREE.Skeleton(bones, o.skeleton.boneInverses.map((m) => m.clone()));
  const mesh = new THREE.SkinnedMesh(o.geometry, new THREE.MeshBasicMaterial());
  mesh.name = o.name;
  group.add(mesh);
  mesh.bind(skel, o.bindMatrix.clone());
});
group.scale.setScalar(0.01);
group.updateMatrixWorld(true);

// ---- measure --------------------------------------------------------------------
const REGION = [
  ['head', /Head_|Eyebrow|FacialHair/],
  ['torso', /Torso|Hips(?!Attach)|BackAttach|ChestAttach|Cape/],
  ['armL', /ArmUpperLeft|ArmLowerLeft|HandLeft|ElbowAttachLeft|ShoulderAttachLeft/],
  ['armR', /ArmUpperRight|ArmLowerRight|HandRight|ElbowAttachRight|ShoulderAttachRight/],
  ['legL', /LegLeft|KneeAttachLeft/],
  ['legR', /LegRight|KneeAttachRight/],
];
function measureParts(tag) {
  group.updateMatrixWorld(true);
  const acc = REGION.map(() => ({ n: 0, c: new THREE.Vector3(), minY: Infinity, maxY: -Infinity }));
  const vv = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity;
  group.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const ri = REGION.findIndex(([, re]) => re.test(m.name));
    const pos = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 60));
    for (let i = 0; i < pos.count; i += step) {
      vv.fromBufferAttribute(pos, i);
      m.applyBoneTransform(i, vv);
      vv.applyMatrix4(m.matrixWorld);
      minY = Math.min(minY, vv.y); maxY = Math.max(maxY, vv.y);
      if (ri < 0) continue;
      acc[ri].n++; acc[ri].c.add(vv);
      acc[ri].minY = Math.min(acc[ri].minY, vv.y); acc[ri].maxY = Math.max(acc[ri].maxY, vv.y);
    }
  });
  console.log(`-- ${tag} (height ${(maxY - minY).toFixed(2)}m)`);
  REGION.forEach(([name], i) => {
    const a = acc[i];
    if (!a.n) return;
    a.c.divideScalar(a.n);
    console.log(`  ${name}: c=(${a.c.x.toFixed(2)},${a.c.y.toFixed(2)},${a.c.z.toFixed(2)}) y[${a.minY.toFixed(2)}..${a.maxY.toFixed(2)}]`);
  });
}

measureParts('bind pose (no anim)');
const mixer = new THREE.AnimationMixer(group);
for (const f of ['A_Idle_Base_Sword', 'A_Walk_F_Masc', 'A_Attack_LightCombo01A_Sword', 'A_Death_B_01_Sword']) {
  const g = load(`public/assets/anims/${f}.fbx`);
  const clip = retargetClip(g.animations[0]);
  mixer.stopAllAction();
  mixer.clipAction(clip).play();
  mixer.update(clip.duration * 0.5);
  measureParts(`${f} t=50%`);
}
console.log('RETARGET V2 DONE');
