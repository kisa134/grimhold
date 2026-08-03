// champion.js — character constructor: browse Synty's official presets on the
// loadout screen with a live 3D preview. The chosen champion is persisted and
// also appears on the death screen (fallen, with a mocap death clip).
import * as THREE from 'three';
import {
  SKINNED, MATS, buildSkinnedCharacter, presetIds, presetParts, Animator,
} from './skinned.js';
import { buildWeaponVisual } from './models.js';
import { getHero } from './hero.js';

const LS_KEY = 'grimhold_champion';
let championId = localStorage.getItem(LS_KEY) || '33';

let renderer = null;
let scene = null;
let camera = null;
let raf = 0;
let charHandle = null;
let anim = null;
let deathMode = false;

export function getChampionId() { return championId; }

export function setChampionId(id) {
  championId = id;
  localStorage.setItem(LS_KEY, id);
  rebuildChampion();
}

export function cycleChampion(dir) {
  const ids = presetIds();
  if (!ids.length) return;
  const i = Math.max(0, ids.indexOf(String(championId)));
  const next = ids[(i + dir + ids.length) % ids.length];
  setChampionId(next);
  return next;
}

function rebuildChampion() {
  if (!scene) return;
  if (charHandle) {
    scene.remove(charHandle.group);
    charHandle = null;
    anim = null;
  }
  // the created hero (when one exists) is the menu/death-screen champion
  const hero = getHero();
  const parts = (hero && hero.parts) || presetParts(String(championId));
  if (!parts) return;
  charHandle = buildSkinnedCharacter(parts, () => MATS.atlas());
  if (!charHandle) return;
  // the champion carries their starting weapon, like the enemies do
  const handR = charHandle.bones.get('Hand_R');
  const wv = buildWeaponVisual((hero && hero.weapon) || 'sword');
  if (handR && wv) {
    wv.scale.setScalar(100);
    wv.rotation.set(Math.PI / 2, 0, Math.PI / 2); // verified via grip.html test
    handR.add(wv);
  }
  scene.add(charHandle.group);
  anim = new Animator(charHandle.root);
  if (deathMode) {
    anim.playOnce(Math.random() < 0.5 ? 'deathF' : 'deathB', { clamp: true });
  } else {
    anim.play('idle');
  }
}

// Attach a live preview to a canvas element. Returns false if assets not ready.
export function startChampionPreview(canvasEl, { death = false } = {}) {
  stopChampionPreview();
  if (!SKINNED.ready || !canvasEl) return false;
  deathMode = death;

  const w = canvasEl.clientWidth || 280;
  const h = canvasEl.clientHeight || 340;
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0x9a8a6a, 0x16110c, 1.15));
  const key = new THREE.DirectionalLight(0xffd9a0, 1.7);
  key.position.set(2, 3, 2.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x5a6aff, 0.9);
  rim.position.set(-2.5, 2, -2);
  scene.add(rim);

  camera = new THREE.PerspectiveCamera(36, w / h, 0.1, 20);
  camera.position.set(0, 1.3, 3.0);
  camera.lookAt(0, 0.95, 0);

  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.95, 0.08, 28),
    new THREE.MeshLambertMaterial({ color: 0x2a241c }));
  disc.position.y = -0.04;
  scene.add(disc);

  rebuildChampion();

  let last = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (anim) anim.update(dt);
    if (charHandle && !deathMode) charHandle.group.rotation.y += dt * 0.45;
    if (renderer) renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);
  return true;
}

export function stopChampionPreview() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  scene = null;
  charHandle = null;
  anim = null;
}
