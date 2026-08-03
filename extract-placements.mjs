// extract-placements.mjs — reads Synty's own skinned rig (FixedScale
// ModularCharacters.fbx) and extracts bind-pose body-space placements for the
// part sets we use. Output: public/assets/placements.json consumed by models.js.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { readFileSync, writeFileSync } from 'fs';

global.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} }) };
global.self = global;

const FBX = '.asset-tmp/mfh_tree2/Assets/Synty/PolygonFantasyHeroCharacters/Models/FixedScale/ModularCharacters.fbx';

// official Synty preset combos (from parse_presets.py) + custom bare skeleton
const SETS = {
  knight: [
    'Chr_Head_Male_19', 'Chr_HeadCoverings_No_Hair_10', 'Chr_Eyebrow_Male_10',
    'Chr_Torso_Male_20', 'Chr_Hips_Male_20', 'Chr_HipsAttachment_05',
    'Chr_ArmUpperLeft_Male_06', 'Chr_ArmUpperRight_Male_06',
    'Chr_ArmLowerLeft_Male_03', 'Chr_ArmLowerRight_Male_03',
    'Chr_HandLeft_Male_03', 'Chr_HandRight_Male_03',
    'Chr_LegLeft_Male_01', 'Chr_LegRight_Male_01',
    'Chr_ShoulderAttachLeft_16', 'Chr_ShoulderAttachRight_16',
    'Chr_BackAttachment_13', 'Chr_ElbowAttachLeft_02', 'Chr_ElbowAttachRight_02',
  ],
  boss: [
    'Chr_Head_Male_07', 'Chr_HeadCoverings_No_Hair_07', 'Chr_Eyebrow_Male_08',
    'Chr_FacialHair_Male_13',
    'Chr_Torso_Male_03', 'Chr_Hips_Male_08', 'Chr_HipsAttachment_08',
    'Chr_ArmUpperLeft_Male_06', 'Chr_ArmUpperRight_Male_09',
    'Chr_ArmLowerLeft_Male_17', 'Chr_ArmLowerRight_Male_17',
    'Chr_HandLeft_Male_17', 'Chr_HandRight_Male_11',
    'Chr_LegLeft_Male_16', 'Chr_LegRight_Male_16',
    'Chr_ShoulderAttachLeft_14', 'Chr_ShoulderAttachRight_14',
    'Chr_BackAttachment_04', 'Chr_ElbowAttachRight_03', 'Chr_KneeAttachLeft_08',
  ],
  bandit: [
    'Chr_Head_Male_18', 'Chr_Hair_31', 'Chr_Eyebrow_Male_03', 'Chr_Ear_Ear_02',
    'Chr_Torso_Male_07', 'Chr_Hips_Male_20', 'Chr_HipsAttachment_06',
    'Chr_ArmUpperLeft_Male_13', 'Chr_ArmUpperRight_Male_13',
    'Chr_ArmLowerLeft_Male_09', 'Chr_ArmLowerRight_Male_09',
    'Chr_HandLeft_Male_07', 'Chr_HandRight_Male_07',
    'Chr_LegLeft_Male_04', 'Chr_LegRight_Male_04',
    'Chr_ShoulderAttachLeft_04', 'Chr_ShoulderAttachRight_19',
    'Chr_ElbowAttachLeft_06', 'Chr_ElbowAttachRight_06',
    'Chr_KneeAttachLeft_04', 'Chr_KneeAttachRight_09',
  ],
  skeleton: [
    'Chr_Head_Male_00', 'Chr_Torso_Male_00', 'Chr_Hips_Male_00',
    'Chr_ArmUpperLeft_Male_00', 'Chr_ArmUpperRight_Male_00',
    'Chr_ArmLowerLeft_Male_00', 'Chr_ArmLowerRight_Male_00',
    'Chr_HandLeft_Male_00', 'Chr_HandRight_Male_00',
    'Chr_LegLeft_Male_00', 'Chr_LegRight_Male_00',
  ],
};

const loader = new FBXLoader();
const buf = readFileSync(FBX);
const root = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
root.updateMatrixWorld(true);

const meshes = {};
root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) meshes[o.name] = o; });
console.log('total meshes in rig:', Object.keys(meshes).length);

// which body part does this part belong to (for arm corner extraction)
function partKeyOf(name) {
  if (/ArmUpper|ArmLower|Hand|ShoulderAttach|ElbowAttach/.test(name)) {
    return /Left/.test(name) ? 'leftArm' : 'rightArm';
  }
  return null;
}

const placements = { sets: SETS, parts: {} };
const missing = [];
const CM = 0.01; // rig is authored in centimeters; static part FBXs are in meters
for (const names of Object.values(SETS)) {
  for (const name of names) {
    if (placements.parts[name]) continue;
    const m = meshes[name];
    if (!m) { missing.push(name); continue; }
    m.geometry.computeBoundingBox();
    const gbb = m.geometry.boundingBox.clone();
    // to body/world space: skinned geometry is in bind pose; apply node world matrix
    gbb.applyMatrix4(m.matrixWorld);
    const c = gbb.getCenter(new THREE.Vector3());
    const entry = { center: [c.x * CM, c.y * CM, c.z * CM] };
    const pk = partKeyOf(name);
    if (pk) {
      // the joint is the piece end NEAREST the body center (shoulder for the
      // upper arm, elbow for the lower arm / hand) — the rig puts "Left" on +X
      entry.joint = [
        (Math.abs(gbb.min.x) < Math.abs(gbb.max.x) ? gbb.min.x : gbb.max.x) * CM,
        gbb.max.y * CM,
        ((gbb.min.z + gbb.max.z) / 2) * CM,
      ];
    }
    placements.parts[name] = entry;
  }
}
if (missing.length) console.log('MISSING:', missing);

// rig height sanity
const all = new THREE.Box3();
root.traverse((o) => {
  if ((o.isMesh || o.isSkinnedMesh) && /Torso_Male_00|Head_Male_00|LegLeft_Male_00|LegRight_Male_00|Hips_Male_00/.test(o.name)) {
    o.geometry.computeBoundingBox();
    all.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  }
});
console.log('bare male body yRange:', all.min.y.toFixed(3), '..', all.max.y.toFixed(3));

writeFileSync('public/assets/placements.json', JSON.stringify(placements));
console.log('wrote public/assets/placements.json with', Object.keys(placements.parts).length, 'parts');
