// skinned.js — REAL Synty skinned characters + REAL Synty animation clips.
//
// THE TRICK v3 (do not regress): Synty ships two incompatible rig conventions.
// ModularCharacters.fbx (the meshes) has joints oriented along X with axis
// conversion baked into preRotations; the animation FBXs (Sword Combat /
// Locomotion) have joints along Y. Clip locals therefore do NOT fit the mesh
// rig (v1 laid bodies flat; v2 twisted every limb around its bone axis).
//
// Solution: keep characters on their OWN native rig (meshes bind perfectly
// with their own boneInverses) and RETARGET every clip onto that rig:
//   q_char(t) = K_parent^-1 * q_anim(t) * K_bone
//   p_char(t) = K_parent^-1 * p_anim(t)
// K_bone is the constant world-orientation delta between the two rigs at
// T-pose. The anim rig's T-pose is not shipped, so it is reconstructed:
// joint positions come from the character rig (same Synty proportions) and
// orientations are transported from the anim rig's rest pose by the shortest
// arc that aligns each bone direction with its T-pose direction.
// Verified by tools/retarget-v2.mjs: T-pose arms at shoulder height, idle
// arms hang, walk steps, death collapses.
//
// - Rig and clips are in centimeters: the wrapper group is scaled 0.01.
//   Anything parented to a bone (weapons, eyes) must counter-scale x100.
// - Attachment bones (capes, pauldrons) exist natively in this rig and simply
//   inherit their parent bone's motion (no cape physics).
// - Severing = hiding the meshes of a body region (arms/head/legs are
//   separate meshes in this pack). Combat logic stays on invisible hitboxes.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

export const SKINNED = { ready: false };

const BASE = '/assets';
const RIG_SCALE = 0.01; // cm -> m

const ANIM_FILES = {
  idle: 'A_Idle_Base_Sword.fbx',
  menacing: 'A_Idle_Menacing01_Sword.fbx',
  walk: 'A_Walk_F_Masc.fbx',
  run: 'A_Run_F_Masc.fbx',
  atkA: 'A_Attack_LightCombo01A_Sword.fbx',
  atkB: 'A_Attack_LightCombo01B_Sword.fbx',
  atkC: 'A_Attack_LightCombo01C_Sword.fbx',
  atkHeavy: 'A_Attack_HeavyCombo01A_Sword.fbx',
  atkStab: 'A_Attack_HeavyStab01_Sword.fbx',
  block: 'A_Block_Loop_Sword.fbx',
  parry: 'A_Parry_F_Sword.fbx',
  hitF: 'A_Hit_F_React_Sword.fbx',
  hitL: 'A_Hit_L_React_Sword.fbx',
  hitR: 'A_Hit_R_React_Sword.fbx',
  stagger: 'A_Hit_F_Stagger_Sword.fbx',
  deathF: 'A_Death_F_01_Sword.fbx',
  deathB: 'A_Death_B_01_Sword.fbx',
};

const loader = new FBXLoader();
function loadFbx(url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

const meshTemplates = new Map(); // meshName -> { geometry, bindMatrix, boneInverses, boneNames }
let charBoneTree = null;         // { name, children, pos, quat, scale } from char FBX (native rig)
let PLACEMENT_SETS = null;       // enemy part lists (placements.json sets)
let PRESETS = null;              // official Synty presets
export const CLIPS = {};         // anim key -> AnimationClip (RETARGETED to the char rig)

let _atlasMat = null;
let _boneMat = null;
let _bossMat = null;
export const MATS = {
  atlas: () => _atlasMat,
  bone: () => _boneMat,
  boss: () => _bossMat,
};

// ---- region classification (for severing + per-region materials) ------------
export function classifyRegion(name) {
  if (/ArmUpperLeft|ArmLowerLeft|HandLeft|ElbowAttachLeft|ShoulderAttachLeft/.test(name)) return 'leftArm';
  if (/ArmUpperRight|ArmLowerRight|HandRight|ElbowAttachRight|ShoulderAttachRight/.test(name)) return 'rightArm';
  if (/LegLeft|KneeAttachLeft/.test(name)) return 'leftLeg';
  if (/LegRight|KneeAttachRight/.test(name)) return 'rightLeg';
  if (/Head_|HeadCoverings|Eyebrow|FacialHair|Chr_Hair_|Chr_Ear_/.test(name)) return 'head';
  return 'torso'; // Torso, Hips, HipsAttachment, BackAttachment, ChestAttachment, Cape
}

// ---- clip retargeting ---------------------------------------------------------
// Everything below runs once at init; see header for the math.
const _wpos = (o) => o.getWorldPosition(new THREE.Vector3());
const _wquat = (o) => o.getWorldQuaternion(new THREE.Quaternion());

function primaryChild(bone) {
  let best = null; let bestLen = -1;
  for (const c of bone.children) {
    if (!c.isBone) continue;
    const len = c.position.length();
    if (len > bestLen) { bestLen = len; best = c; }
  }
  return best;
}

// Build retarget context from the char rig (T-pose) and one anim FBX (rest pose).
function buildRetargetContext(charRoot, charBones, animRoot, animBones) {
  // reconstruct anim T-pose world orientations (shortest-arc transport)
  const A_q = new Map();   // bone name -> Quaternion (anim T-pose world orientation)
  const alignOf = new Map(); // bone name -> transport quaternion used
  const solve = (bone) => {
    const restQ = _wquat(bone);
    const cb = charBones.get(bone.name);
    const child = primaryChild(bone);
    let q = null;
    if (cb && child && animBones.get(child.name) && charBones.get(child.name)) {
      const dRest = _wpos(animBones.get(child.name)).sub(_wpos(bone));
      const dT = _wpos(charBones.get(child.name)).sub(_wpos(cb));
      if (dRest.lengthSq() > 1e-6 && dT.lengthSq() > 1e-6) {
        const align = new THREE.Quaternion().setFromUnitVectors(dRest.normalize(), dT.normalize());
        alignOf.set(bone.name, align.clone());
        q = align.multiply(restQ);
      }
    }
    if (!q) {
      const p = bone.parent;
      const pa = p && p.isBone ? alignOf.get(p.name) : null;
      q = pa ? pa.clone().multiply(restQ) : restQ.clone();
      alignOf.set(bone.name, pa ? pa.clone() : new THREE.Quaternion());
    }
    A_q.set(bone.name, q);
    for (const c of bone.children) if (c.isBone) solve(c);
  };
  alignOf.set(animRoot.name, new THREE.Quaternion());
  solve(animRoot);

  // per-bone constant offsets
  const K = new Map();
  for (const [name, cb] of charBones) {
    const aq = A_q.get(name);
    if (!aq) continue;
    K.set(name, aq.clone().invert().multiply(_wquat(cb)));
  }
  const K_arm = _wquat(animRoot.parent).invert().multiply(_wquat(charRoot.parent));
  const charBoneNames = new Set(charBones.keys());
  const charParentName = new Map();
  for (const [name, cb] of charBones) {
    charParentName.set(name, cb.parent && cb.parent.isBone ? cb.parent.name : null);
  }
  return { K, K_arm, charBoneNames, charParentName };
}

function retargetClip(clip, ctx) {
  const tracks = [];
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.');
    const bone = t.name.slice(0, dot);
    const prop = t.name.slice(dot + 1);
    if (!ctx.charBoneNames.has(bone) || !ctx.K.has(bone)) continue; // unknown/duplicate names
    const parentName = ctx.charParentName.get(bone);
    const kp = (parentName ? ctx.K.get(parentName) : ctx.K_arm).clone().invert();
    const kb = ctx.K.get(bone);
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

// ---- init -------------------------------------------------------------------
export async function initSkinned() {
  try {
    const [tex, charRig, idleFbx, placementsResp, presetsResp] = await Promise.all([
      new Promise((res, rej) => new THREE.TextureLoader().load(
        `${BASE}/textures/PolygonFantasyHero_Texture_01_A.png`, res, undefined, rej)),
      loadFbx(`${BASE}/ModularCharacters.fbx`),
      loadFbx(`${BASE}/anims/${ANIM_FILES.idle}`),
      fetch(`${BASE}/placements.json`),
      fetch(`${BASE}/presets.json`),
    ]);
    const placements = await placementsResp.json();
    PLACEMENT_SETS = placements.sets;
    PRESETS = await presetsResp.json();

    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false; // FBX UV convention
    _atlasMat = new THREE.MeshLambertMaterial({ map: tex });
    _boneMat = new THREE.MeshLambertMaterial({ color: 0xe8e4d0 });
    _bossMat = new THREE.MeshLambertMaterial({ map: tex, color: 0xdd9a90 });

    charRig.updateMatrixWorld(true);
    idleFbx.updateMatrixWorld(true);

    // mesh templates: geometry + NATIVE bind data, keyed by Synty part name
    charRig.traverse((m) => {
      if (!m.isSkinnedMesh || meshTemplates.has(m.name)) return;
      meshTemplates.set(m.name, {
        geometry: m.geometry,
        bindMatrix: m.bindMatrix.clone(),
        boneInverses: m.skeleton.boneInverses.map((b) => b.clone()),
        boneNames: m.skeleton.bones.map((b) => b.name),
      });
    });

    // native char rig bone tree; root local := its world matrix (armature baked in)
    const charBones = new Map();
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

    const readTree = (o, isRoot) => {
      const node = { name: o.name, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: new THREE.Vector3() };
      if (isRoot) o.matrixWorld.decompose(node.pos, node.quat, node.scale);
      else {
        node.pos.copy(o.position); node.quat.copy(o.quaternion); node.scale.copy(o.scale);
      }
      node.children = o.children.filter((c) => c.isBone).map((c) => readTree(c, false));
      return node;
    };
    charBoneTree = readTree(charRoot, true);

    // retarget every clip onto the native rig
    const ctx = buildRetargetContext(charRoot, charBones, animRoot, animBones);
    if (idleFbx.animations && idleFbx.animations[0]) CLIPS.idle = retargetClip(idleFbx.animations[0], ctx);
    await Promise.all(Object.entries(ANIM_FILES).map(async ([key, file]) => {
      if (key === 'idle') return;
      try {
        const fbx = await loadFbx(`${BASE}/anims/${file}`);
        if (fbx.animations && fbx.animations[0]) CLIPS[key] = retargetClip(fbx.animations[0], ctx);
      } catch (e) {
        console.warn('[skinned] clip failed:', file, e);
      }
    }));

    SKINNED.ready = true;
    console.log(`[skinned] ready: ${Object.keys(CLIPS).length} retargeted clips, ` +
      `${meshTemplates.size} part templates, ${Object.keys(PRESETS).length} presets`);
    return true;
  } catch (e) {
    console.warn('[skinned] unavailable, static-part fallback:', e);
    SKINNED.ready = false;
    return false;
  }
}

// ---- character factory --------------------------------------------------------
function buildBones(node, parent) {
  const b = new THREE.Bone();
  b.name = node.name;
  b.position.copy(node.pos);
  b.quaternion.copy(node.quat);
  b.scale.copy(node.scale);
  if (parent) parent.add(b);
  for (const c of node.children) buildBones(c, b);
  return b;
}

// partNames: Synty mesh names (a preset). materialFor: (region, meshName) => Material.
export function buildSkinnedCharacter(partNames, materialFor) {
  if (!charBoneTree) return null;

  const boneRoot = buildBones(charBoneTree, null);
  const bones = new Map();
  boneRoot.traverse((b) => { if (!bones.has(b.name)) bones.set(b.name, b); });
  const mapBone = (name) => bones.get(name) || bones.get('Hips');

  const group = new THREE.Group();
  group.add(boneRoot);

  const regionMeshes = { head: [], torso: [], leftArm: [], rightArm: [], leftLeg: [], rightLeg: [] };
  for (const name of partNames) {
    const tpl = meshTemplates.get(name);
    if (!tpl) continue;
    const region = classifyRegion(name);
    const mesh = new THREE.SkinnedMesh(tpl.geometry, materialFor ? materialFor(region, name) : _atlasMat);
    mesh.name = name;
    mesh.frustumCulled = false; // skinned bounds do not follow animation
    const skelBones = tpl.boneNames.map(mapBone);
    const skel = new THREE.Skeleton(skelBones, tpl.boneInverses.map((b) => b.clone()));
    group.add(mesh);
    mesh.bind(skel, tpl.bindMatrix.clone());
    regionMeshes[region].push(mesh);
  }

  group.scale.setScalar(RIG_SCALE);
  return { group, root: group, bones, regionMeshes };
}

// Hide a body region (sever). Returns the hidden meshes.
export function severRegion(char, region) {
  const out = [];
  for (const m of char.regionMeshes[region] || []) {
    if (m.visible) { m.visible = false; out.push(m); }
  }
  return out;
}

// Enemy part lists (curated from Synty presets; see placements.json sets).
export function enemyParts(kind) {
  return PLACEMENT_SETS ? PLACEMENT_SETS[kind] : null;
}

// Official preset list for the champion constructor.
export function presetIds() {
  return PRESETS ? Object.keys(PRESETS) : [];
}
export function presetParts(id) {
  return PRESETS ? PRESETS[id] : null;
}

// ---- animator -------------------------------------------------------------------
export class Animator {
  constructor(root) {
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map();
    this.current = null;
    this.currentKey = null;
    this.mixer.addEventListener('finished', (e) => {
      const cb = e.action._onDone;
      if (cb) { e.action._onDone = null; cb(); }
    });
  }

  _action(key) {
    let a = this.actions.get(key);
    if (!a) {
      const clip = CLIPS[key];
      if (!clip) return null;
      a = this.mixer.clipAction(clip);
      this.actions.set(key, a);
    }
    return a;
  }

  clipDuration(key) {
    return CLIPS[key] ? CLIPS[key].duration : 1;
  }

  // Crossfade to a looping state (idempotent — safe to call every frame).
  play(key, { fade = 0.18, timeScale = 1 } = {}) {
    if (this.currentKey === key && this.current) {
      this.current.timeScale = timeScale;
      return this.current;
    }
    const a = this._action(key);
    if (!a) return null;
    a.reset();
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = false;
    a.timeScale = timeScale;
    a._onDone = null;
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, fade, false);
    a.play();
    this.current = a;
    this.currentKey = key;
    return a;
  }

  // Interrupt with a one-shot (hit react, attack, death). onDone fires once.
  playOnce(key, { fade = 0.08, timeScale = 1, clamp = false, onDone = null } = {}) {
    const a = this._action(key);
    if (!a) { if (onDone) onDone(); return null; }
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = clamp;
    a.timeScale = timeScale;
    a._onDone = onDone;
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, fade, false);
    a.play();
    this.current = a;
    this.currentKey = key;
    return a;
  }

  update(dt) {
    this.mixer.update(dt);
  }
}
