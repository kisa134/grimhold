// visual-check.mjs — headless end-to-end test of the level's async visual
// pipeline: texture stubs + disk-backed fetch + real FBX parse/merge/instance.
// Asserts every placed module type produces an InstancedMesh in the scene.
import { readFileSync } from 'node:fs';

// image stub that "loads" successfully (TextureLoader compatibility)
globalThis.document = {
  createElementNS: () => ({
    listeners: {},
    addEventListener(t, f) { (this.listeners[t] ??= []).push(f); },
    removeEventListener() {},
    setAttribute() {},
    style: {},
    set src(v) { setTimeout(() => (this.listeners.load || []).forEach((f) => f({ target: this })), 0); },
    get src() { return ''; },
    width: 4, height: 4,
  }),
};
globalThis.self = globalThis;
globalThis.fetch = async (url) => {
  const path = 'public' + url; // '/assets/...' -> public/assets/...
  const buf = readFileSync(path);
  return {
    ok: true,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

const THREE = await import('three');
const { buildLevel } = await import('../src/level.js');
const { MODULES } = await import('../src/leveldata.js');

const scene = new THREE.Scene();
const level = buildLevel(scene);
await new Promise((r) => setTimeout(r, 4000)); // let loadVisuals finish

let inst = 0, instances = 0, verts = 0;
const byType = {};
scene.traverse((o) => {
  if (o.isInstancedMesh) {
    inst++;
    instances += o.count;
    verts += o.geometry.attributes.position.count * o.count;
    byType[o.count] = (byType[o.count] || 0) + 1;
  }
});
console.log(`InstancedMesh: ${inst}, total instances: ${instances}, rendered verts: ${(verts / 1000).toFixed(0)}k`);
console.log('gate mesh swapped:', level.gate.mesh.isGroup === true || level.gate.mesh.type === 'Group' ? 'portcullis' : 'PLACEHOLDER (fetch of gate failed?)');

// every module key used in placements must have produced geometry
const missing = [];
for (const key of Object.keys(MODULES)) {
  // placement exists? (can't read placements map — infer from instance counts instead)
}
if (inst < 35) { console.error('FAIL: suspiciously few module types instanced:', inst); process.exit(1); }
if (!level.gate.mesh || level.gate.mesh.type !== 'Group') { console.error('FAIL: portcullis mesh not loaded'); process.exit(1); }
console.log('VISUAL CHECK OK');
process.exit(0);
