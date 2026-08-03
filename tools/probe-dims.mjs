// probe-dims.mjs — headless measurement of every extracted Dark Fantasy FBX:
// bounding box (size + min/max pivot offset), mesh count, vertex count.
// Output: tools/darkfantasy-dims.json  (consumed while authoring leveldata)
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as THREE from 'three';

// FBXLoader's texture path touches DOM image APIs — stub them (geometry only).
globalThis.document = {
  createElementNS: () => ({
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {},
  }),
};
globalThis.self = globalThis;
const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');

const { MODULES, DEST_DIR } = await import('./darkfantasy-manifest.mjs');

const loader = new FBXLoader();
const out = {};
for (const m of MODULES) {
  const name = basename(m);
  try {
    const buf = readFileSync(join(DEST_DIR, name));
    const obj = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);
    let meshes = 0, verts = 0;
    obj.traverse((o) => {
      if (o.isMesh) { meshes++; verts += o.geometry.attributes.position?.count || 0; }
    });
    const size = bb.getSize(new THREE.Vector3());
    out[name.replace(/\.fbx$/i, '')] = {
      size: [+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)],
      min: [+bb.min.x.toFixed(3), +bb.min.y.toFixed(3), +bb.min.z.toFixed(3)],
      max: [+bb.max.x.toFixed(3), +bb.max.y.toFixed(3), +bb.max.z.toFixed(3)],
      meshes, verts,
    };
  } catch (e) {
    out[name.replace(/\.fbx$/i, '')] = { error: String(e.message || e).slice(0, 120) };
  }
}
writeFileSync('tools/darkfantasy-dims.json', JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(out)) {
  if (v.error) console.log(k.padEnd(38), 'ERROR', v.error);
  else console.log(k.padEnd(38),
    `size=[${v.size.join(', ')}]  min=[${v.min.join(', ')}]  max=[${v.max.join(', ')}]  meshes=${v.meshes} verts=${v.verts}`);
}
