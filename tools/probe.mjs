// probe.mjs — ground-truth probe of Synty static part FBXs via FBXLoader in Node.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { readFileSync } from 'fs';

// minimal DOM stub so FBXLoader's texture loading doesn't crash in Node
global.document = {
  createElementNS: () => ({
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {},
  }),
};
global.self = global;

const loader = new FBXLoader();
const files = [
  'public/assets/parts/Chr_LegLeft_Male_05_Static.fbx',
  'public/assets/parts/Chr_Torso_Male_02_Static.fbx',
  'public/assets/parts/Chr_Head_Male_00_Static.fbx',
  'public/assets/parts/Chr_ArmUpperLeft_Male_04_Static.fbx',
  'public/assets/models/SM_Wep_Sword_01.fbx',
];

for (const f of files) {
  const buf = readFileSync(f);
  const root = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root);
  const size = bb.getSize(new THREE.Vector3());
  const center = bb.getCenter(new THREE.Vector3());
  console.log('\n==', f.split('/').pop());
  console.log('root children:', root.children.map(c => `${c.name}[${c.type}] rot=${c.rotation.x.toFixed(2)},${c.rotation.y.toFixed(2)},${c.rotation.z.toFixed(2)} scale=${c.scale.x.toFixed(3)}`).join(' | '));
  console.log('size:', size.x.toFixed(3), size.y.toFixed(3), size.z.toFixed(3),
              ' center:', center.x.toFixed(3), center.y.toFixed(3), center.z.toFixed(3),
              ' yRange:', bb.min.y.toFixed(2), '..', bb.max.y.toFixed(2),
              ' zRange:', bb.min.z.toFixed(2), '..', bb.max.z.toFixed(2));
}
