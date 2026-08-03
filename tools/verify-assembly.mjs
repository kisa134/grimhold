// verify-assembly.mjs — simulates buildBodyVisuals placement math in Node and
// prints where every part lands in body space. Anatomical check without a browser.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { readFileSync, existsSync } from 'fs';

global.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} }) };
global.self = global;

const loader = new FBXLoader();
const load = (path) => {
  const buf = readFileSync(path);
  return loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
};
const bboxOf = (o) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };

const ANCHOR = {
  head: [0, 1.62, 0], torso: [0, 1.12, 0],
  leftArm: [-0.42, 1.40, 0], rightArm: [0.42, 1.40, 0],
  leftLeg: [-0.17, 0.45, 0], rightLeg: [0.17, 0.45, 0],
};

const SET = {
  head: ['Chr_Head_No_Elements_Male_01_Static.fbx'],
  headGear: ['Chr_HeadCoverings_No_Hair_09_Static.fbx'],
  torso: ['Chr_Torso_Male_02_Static.fbx'],
  hips: ['Chr_Hips_Male_15_Static.fbx'],
  armUpperL: ['Chr_ArmUpperLeft_Male_04_Static.fbx'],
  armUpperR: ['Chr_ArmUpperRight_Male_04_Static.fbx'],
  armLowerL: ['Chr_ArmLowerLeft_Male_04_Static.fbx'],
  armLowerR: ['Chr_ArmLowerRight_Male_04_Static.fbx'],
  handL: ['Chr_HandLeft_Male_02_Static.fbx'],
  handR: ['Chr_HandRight_Male_02_Static.fbx'],
  legL: ['Chr_LegLeft_Male_05_Static.fbx'],
  legR: ['Chr_LegRight_Male_05_Static.fbx'],
  shoulderL: ['Chr_ShoulderAttachLeft_18_Static.fbx'],
  shoulderR: ['Chr_ShoulderAttachRight_18_Static.fbx'],
};

const SLOT_MAP = [
  ['head', 'head', 'centerAt'],
  ['headGear', 'head', 'centerAt', [0, 1.70, 0]],
  ['torso', 'torso', 'centerAt'],
  ['hips', 'torso', 'centerAt', [0, 0.72, 0]],
  ['armUpperL', 'leftArm', 'armJoint', [0.18, 0.05]],
  ['armUpperR', 'rightArm', 'armJoint', [-0.18, 0.05]],
  ['armLowerL', 'leftArm', 'armJoint', [0.17, -0.27]],
  ['armLowerR', 'rightArm', 'armJoint', [-0.17, -0.27]],
  ['handL', 'leftArm', 'armJoint', [0.16, -0.52]],
  ['handR', 'rightArm', 'armJoint', [-0.16, -0.52]],
  ['shoulderL', 'leftArm', 'armJoint', [0.18, 0.05]],
  ['shoulderR', 'rightArm', 'armJoint', [-0.18, 0.05]],
  ['legL', 'leftLeg', 'centerAt', [-0.17, 0.24, 0]],
  ['legR', 'rightLeg', 'centerAt', [0.17, 0.24, 0]],
];

const body = new THREE.Group();
for (const [slot, partKey, mode, extra] of SLOT_MAP) {
  const file = SET[slot]?.[0];
  const path = `public/assets/parts/${file}`;
  if (!file || !existsSync(path)) { console.log('MISSING', slot, file); continue; }
  const obj = load(path);
  const anchor = ANCHOR[partKey];
  const hitbox = new THREE.Group();
  hitbox.position.set(...anchor);
  body.add(hitbox);

  if (mode === 'centerAt') {
    const target = extra || anchor;
    const bb = bboxOf(obj);
    const c = bb.getCenter(new THREE.Vector3());
    obj.position.set(target[0] - c.x - anchor[0], target[1] - c.y - anchor[1], target[2] - c.z - anchor[2]);
    hitbox.add(obj);
  } else {
    const side = partKey === 'leftArm' ? 1 : -1;
    const bb = bboxOf(obj);
    const corner = new THREE.Vector3(side === 1 ? bb.max.x : bb.min.x, bb.max.y, (bb.min.z + bb.max.z) / 2);
    const inner = new THREE.Group();
    inner.add(obj);
    inner.position.copy(corner).negate();
    const wrap = new THREE.Group();
    wrap.add(inner);
    wrap.rotation.z = side * Math.PI / 2;
    wrap.position.set(extra[0], extra[1], 0);
    hitbox.add(wrap);
  }
}

body.updateMatrixWorld(true);
console.log('\n=== assembled part bounds (body space) ===');
for (const child of body.children) {
  const bb = new THREE.Box3().setFromObject(child);
  const s = bb.getSize(new THREE.Vector3());
  console.log(
    `hitbox@(${child.position.x.toFixed(2)},${child.position.y.toFixed(2)})  ` +
    `x[${bb.min.x.toFixed(2)}..${bb.max.x.toFixed(2)}] y[${bb.min.y.toFixed(2)}..${bb.max.y.toFixed(2)}] z[${bb.min.z.toFixed(2)}..${bb.max.z.toFixed(2)}] size(${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)})`);
}
const all = new THREE.Box3().setFromObject(body);
console.log('\nTOTAL height:', (all.max.y - all.min.y).toFixed(2), ' width:', (all.max.x - all.min.x).toFixed(2), ' yRange:', all.min.y.toFixed(2), '..', all.max.y.toFixed(2));
