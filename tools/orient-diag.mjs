// orient-diag.mjs — why do skinned characters lie flat when a clip plays?
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

const rig = load('public/assets/ModularCharacters.fbx');
rig.updateMatrixWorld(true);
let bb = new THREE.Box3().setFromObject(rig);
console.log('BIND bbox size:', bb.getSize(new THREE.Vector3()).toArray().map(v => v.toFixed(1)).join(' x '));

// find the top bone and the Root bone orientation
let rootBone = null;
rig.traverse((o) => { if (!rootBone && o.isBone && !(o.parent && o.parent.isBone)) rootBone = o; });
console.log('top bone:', rootBone.name, 'quat:', rootBone.quaternion.toArray().map(v => v.toFixed(3)).join(','));
console.log('top bone parent:', rootBone.parent.name || rootBone.parent.type,
  'parent quat:', rootBone.parent.quaternion.toArray().map(v => v.toFixed(3)).join(','));
console.log('rig root quat:', rig.quaternion.toArray().map(v => v.toFixed(3)).join(','));

// play idle, re-measure
const anim = load('public/assets/anims/A_Idle_Base_Sword.fbx');
const clip = anim.animations[0];
console.log('\nclip Root tracks:', clip.tracks.filter(t => t.name.startsWith('Root.')).map(t => t.name).join(', '));
const rootTrack = clip.tracks.find(t => t.name === 'Root.quaternion');
if (rootTrack) console.log('clip Root.quaternion first key:', [...rootTrack.values.slice(0, 4)].map(v => v.toFixed(3)).join(','));
const hipsTrack = clip.tracks.find(t => t.name === 'Hips.quaternion');
if (hipsTrack) console.log('clip Hips.quaternion first key:', [...hipsTrack.values.slice(0, 4)].map(v => v.toFixed(3)).join(','));
let hipsBone = null;
rig.traverse((o) => { if (!hipsBone && o.isBone && o.name === 'Hips') hipsBone = o; });
console.log('rig Hips bind quat:', hipsBone.quaternion.toArray().map(v => v.toFixed(3)).join(','));

const mixer = new THREE.AnimationMixer(rig);
mixer.clipAction(clip).play();
mixer.update(0.5);
rig.updateMatrixWorld(true);
bb = new THREE.Box3().setFromObject(rig);
console.log('\nANIM bbox size:', bb.getSize(new THREE.Vector3()).toArray().map(v => v.toFixed(1)).join(' x '));
console.log('ANIM bbox min/max y:', bb.min.y.toFixed(1), bb.max.y.toFixed(1));
console.log('top bone quat after anim:', rootBone.quaternion.toArray().map(v => v.toFixed(3)).join(','));
