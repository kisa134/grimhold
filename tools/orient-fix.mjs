// orient-fix.mjs — measure real SKINNED vertices under a clip, and test the
// "bind * clip" quaternion correction for the Synty axis mismatch.
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

// record bind pose (first occurrence of each bone name)
const bind = new Map();
rig.traverse((o) => {
  if (o.isBone && !bind.has(o.name)) {
    bind.set(o.name, { pos: o.position.clone(), quat: o.quaternion.clone() });
  }
});
const hipsB = bind.get('Hips');
console.log('Hips bind pos:', hipsB.pos.toArray().map(v => v.toFixed(1)).join(','),
  'quat:', hipsB.quat.toArray().map(v => v.toFixed(3)).join(','));

// measure skinned world bbox over all skinned meshes (sampling)
function measureSkinned(root) {
  root.updateMatrixWorld(true);
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const v = new THREE.Vector3();
  root.traverse((m) => {
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
  return { min, max };
}

function report(tag, root) {
  const { min, max } = measureSkinned(root);
  const s = max.clone().sub(min);
  console.log(`${tag}: size ${s.x.toFixed(0)} x ${s.y.toFixed(0)} x ${s.z.toFixed(0)}  minY=${min.y.toFixed(0)} maxY=${max.y.toFixed(0)}`);
}

report('BIND', rig);

const anim = load('public/assets/anims/A_Idle_Base_Sword.fbx');
const clip = anim.animations[0];

// --- original ---
{
  const mixer = new THREE.AnimationMixer(rig);
  mixer.clipAction(clip).play();
  mixer.update(0.5);
  report('CLIP original t=0.5', rig);
  mixer.stopAllAction();
  // restore bind
  rig.traverse((o) => {
    if (o.isBone && bind.has(o.name)) {
      const b = bind.get(o.name);
      o.position.copy(b.pos); o.quaternion.copy(b.quat);
    }
  });
}

// --- corrected: q' = q_bind * q_clip ; Hips pos rotated by q_bind_hips * p ---
{
  const fixed = clip.clone();
  const qBind = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  for (const t of fixed.tracks) {
    const [bone, prop] = t.name.split('.');
    const b = bind.get(bone);
    if (!b) continue;
    if (prop === 'quaternion') {
      for (let i = 0; i < t.values.length; i += 4) {
        q.fromArray(t.values, i);
        qBind.copy(b.quat).multiply(q);
        qBind.toArray(t.values, i);
      }
    } else if (prop === 'position') {
      for (let i = 0; i < t.values.length; i += 3) {
        p.fromArray(t.values, i);
        p.applyQuaternion(b.quat);
        p.toArray(t.values, i);
      }
    }
  }
  const mixer = new THREE.AnimationMixer(rig);
  mixer.clipAction(fixed).play();
  mixer.update(0.5);
  report('CLIP corrected t=0.5', rig);
  mixer.update(0.4);
  report('CLIP corrected t=0.9', rig);
}
