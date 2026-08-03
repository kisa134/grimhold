// models.js — Synty asset layer (POLYGON Modular Fantasy Hero).
// FULLY data-driven from Synty's own rig: character sets are official presets
// from the pack (parse_presets.py), and every part's bind-pose position was
// extracted from the skinned ModularCharacters.fbx into placements.json
// (extract-placements.mjs). Zero hand-tuned anchors.
//
// Static part FBXs (origin-centered, meters) are placed at the exact anchors
// the skinned rig puts them. Arms rotate down around the measured joint
// (shoulder / elbow / wrist). All combat logic stays on the invisible box
// hitboxes; visuals are children of those hitboxes so swings/severs sync.
// Graceful fallback: if anything fails, MODELS.ready stays false → box-men.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

export const MODELS = { ready: false };

const BASE = import.meta.env.BASE_URL + 'assets';
const loader = new FBXLoader();
const texLoader = new THREE.TextureLoader();

let atlasMat = null;   // shared base material (cloned per enemy part)
let boneMat = null;    // untextured bone-pale material for skeletons
let bossMat = null;

let PLACEMENTS = null; // parsed placements.json
const partTemplates = {}; // partName -> Object3D template
const weaponTemplates = {}; // key -> normalized template

const WEAPON_FILES = {
  sword: 'SM_Wep_Sword_01.fbx',
  axe: 'SM_Wep_Axe_01.fbx',
  mace: 'SM_Wep_Mace_01.fbx',
  dagger: 'SM_Wep_Dagger_01.fbx',
  shield: 'SM_Wep_Shield_01.fbx',
};
// target lengths (longest axis, world units) — matched to old box viewmodels
const WEAPON_LEN = { sword: 0.95, axe: 0.85, mace: 0.75, dagger: 0.5, shield: 0.62 };

// hitbox anchors mirrored from enemy.js PART_DEFS (body space, origin at feet)
const ANCHOR = {
  head: [0, 1.62, 0], torso: [0, 1.12, 0],
  leftArm: [-0.42, 1.40, 0], rightArm: [0.42, 1.40, 0],
  leftLeg: [-0.17, 0.45, 0], rightLeg: [0.17, 0.45, 0],
};

function loadFbx(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function bboxOf(obj) {
  obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj);
}

function applyMaterial(root, mat) {
  root.traverse((o) => { if (o.isMesh) o.material = mat; });
}

// ---- init -----------------------------------------------------------------
export async function initModels() {
  try {
    const [tex, placementsResp] = await Promise.all([
      new Promise((res, rej) =>
        texLoader.load(`${BASE}/textures/PolygonFantasyHero_Texture_01_A.png`, res, undefined, rej)),
      fetch(`${BASE}/placements.json`),
    ]);
    if (!placementsResp.ok) throw new Error('placements.json missing');
    PLACEMENTS = await placementsResp.json();

    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false; // FBX UV convention
    atlasMat = new THREE.MeshLambertMaterial({ map: tex });
    boneMat = new THREE.MeshLambertMaterial({ color: 0xe8e4d0 });
    bossMat = new THREE.MeshLambertMaterial({ map: tex, color: 0xdd9a90 });

    // load every unique static part referenced by the sets
    const names = new Set();
    for (const list of Object.values(PLACEMENTS.sets)) {
      for (const n of list) if (PLACEMENTS.parts[n]) names.add(n);
    }
    await Promise.all([...names].map(async (name) => {
      try {
        const fbx = await loadFbx(`${BASE}/parts/${name}_Static.fbx`);
        partTemplates[name] = fbx;
      } catch { /* missing part is skipped at build time */ }
    }));

    for (const [key, file] of Object.entries(WEAPON_FILES)) {
      try {
        const fbx = await loadFbx(`${BASE}/models/${file}`);
        applyMaterial(fbx, atlasMat.clone());
        weaponTemplates[key] = normalizeWeapon(fbx, WEAPON_LEN[key]);
      } catch { /* weapon optional */ }
    }

    MODELS.ready = true;
    console.log('[models] Synty assets ready:', names.size, 'part templates');
    return true;
  } catch (e) {
    console.warn('[models] Synty assets unavailable, falling back to boxes:', e);
    MODELS.ready = false;
    return false;
  }
}

// ---- weapon normalization --------------------------------------------------
// Orients the longest bbox axis to +Y, puts the grip end at the origin,
// scales to target length. Returns a template Group.
function normalizeWeapon(fbx, targetLen) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(fbx);
  g.add(inner);

  let bb = bboxOf(g);
  const size = bb.getSize(new THREE.Vector3());
  if (size.x >= size.y && size.x >= size.z) inner.rotation.z = Math.PI / 2;
  else if (size.z >= size.x && size.z >= size.y) inner.rotation.x = -Math.PI / 2;
  bb = bboxOf(g);
  const len = bb.getSize(new THREE.Vector3()).y;
  const s = targetLen / (len || 1);
  inner.scale.setScalar(s);
  bb = bboxOf(g);
  inner.position.y -= bb.min.y;                    // grip end at origin
  inner.position.x -= (bb.min.x + bb.max.x) / 2;   // centered
  inner.position.z -= (bb.min.z + bb.max.z) / 2;
  return g;
}

export function buildWeaponVisual(key) {
  const t = weaponTemplates[key];
  if (!t) return null;
  const c = t.clone(true);
  c.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
  return c;
}

// ---- character assembly ----------------------------------------------------
// Classify a rig part name to our hitbox part.
function classify(name, info) {
  if (/Torso|BackAttachment/.test(name)) return { partKey: 'torso', mode: 'center' };
  if (/Hips/.test(name)) return { partKey: 'torso', mode: 'center' };
  if (/Head|Eyebrow|FacialHair|Hair|Ear/.test(name)) return { partKey: 'head', mode: 'center' };
  if (/Leg|KneeAttach/.test(name)) {
    return { partKey: info.center[0] < 0 ? 'leftLeg' : 'rightLeg', mode: 'center' };
  }
  if (/Arm|Hand|ShoulderAttach|ElbowAttach/.test(name)) {
    return { partKey: info.joint[0] > 0 ? 'rightArm' : 'leftArm', mode: 'arm' };
  }
  return { partKey: 'torso', mode: 'center' };
}

// Returns { partKey: [Object3D...] } — visuals ready to parent to hitbox meshes.
export function buildBodyVisuals(kind, boss = false) {
  if (!PLACEMENTS) return null;
  const setKey = boss ? 'boss' : kind;
  const names = PLACEMENTS.sets[setKey];
  if (!names) return null;

  const mat = setKey === 'skeleton' ? boneMat : setKey === 'boss' ? bossMat : atlasMat;
  const out = {};
  const push = (partKey, obj) => { (out[partKey] ||= []).push(obj); };

  for (const name of names) {
    const tpl = partTemplates[name];
    const info = PLACEMENTS.parts[name];
    if (!tpl || !info) continue;
    const { partKey, mode } = classify(name, info);
    const anchor = ANCHOR[partKey];

    const obj = tpl.clone(true);
    obj.traverse((o) => { if (o.isMesh) o.material = mat.clone(); });

    if (mode === 'center') {
      // static part is origin-centered; put its center at the rig's bind spot
      obj.position.set(
        info.center[0] - anchor[0],
        info.center[1] - anchor[1],
        info.center[2] - anchor[2]);
      push(partKey, obj);
    } else {
      // arm piece: rotate the T-pose piece down around its measured joint,
      // pivot expressed in hitbox-local coords
      const rel = [info.joint[0] - info.center[0],
                   info.joint[1] - info.center[1],
                   info.joint[2] - info.center[2]];
      const inner = new THREE.Group();
      inner.add(obj);
      inner.position.set(-rel[0], -rel[1], -rel[2]); // joint at pivot origin
      const wrap = new THREE.Group();
      wrap.add(inner);
      wrap.rotation.z = info.center[0] > 0 ? -Math.PI / 2 : Math.PI / 2;
      wrap.position.set(
        info.joint[0] - anchor[0],
        info.joint[1] - anchor[1],
        info.joint[2] - anchor[2]);
      push(partKey, wrap);
    }
  }
  return out;
}
