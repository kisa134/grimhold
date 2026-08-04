// creator.js — Elden Ring-style CHARACTER CREATION screen.
//
// Full-screen dark-gothic creator over the main menu: live rotating 3D preview
// (drag to orbit, wheel to zoom) of the assembled Synty character on the right,
// menu columns on the left:
//   1. PRESETS     — archetypes (Knight/Raider/Penitent) + full-body presets
//   2. APPEARANCE  — per-slot ◀ ▶ cycling (gender, head, hair, torso, arms...)
//   3. STATS       — point-buy Vigor/Strength/Agility/Resolve + derived stats
//   4. WEAPON      — starting sword/axe/mace
//   5. NAME        — used in MP + on the death screen
// Confirm saves to localStorage (grimhold_hero_v1); Esc/Back leaves unsaved.
import * as THREE from 'three';
import {
  SKINNED, MATS, buildSkinnedCharacter, Animator, enemyParts, presetParts,
} from './skinned.js';
import { buildWeaponVisual } from './models.js';
import { WEAPONS, weaponStats } from './weapons.js';
import { CFG } from './config.js';
import { SLOT_DEFS, classifyPart } from './partnames.js';
import * as Hero from './hero.js';

let isOpen = false;
let index = null;          // parts-index.json
let indexPromise = null;
let hero = null;           // working copy (saved only on Confirm)
let onDone = null;
let screenEl = null;

// preview state
let renderer = null;
let scene = null;
let camera = null;
let raf = 0;
let charHandle = null;
let anim = null;
let weaponVis = null;
let previewReady = false;
const orbit = { yaw: 0.5, pitch: 0.12, dist: 3.2, dragging: false, lastX: 0, lastY: 0 };

const STAT_DESC = {
  vigor: '+15 max HP per point',
  strength: '+8% melee damage per point',
  agility: '+12 stamina, +4% move speed per point',
  resolve: '+12% stagger resist, +10% stamina regen per point',
};

// ---- Dark Fantasy sprite wiring (visual only) ----
// Weapon slot icons: public/assets/hud/Icons_Weapons/ICON_SM_Wep_*_DarkFantasy.png
const WEAPON_ICONS = {
  sword: 'ICON_SM_Wep_Sword_01_DarkFantasy.png',
  axe: 'ICON_SM_Wep_Axe_01_DarkFantasy.png',
  mace: 'ICON_SM_Wep_Mace_01_DarkFantasy.png',
};
// Attribute icons: public/assets/hud/Icons_Stats/ICON_DarkFantasy_Stat_*_Stroke.png
const STAT_ICONS = {
  vigor: 'ICON_DarkFantasy_Stat_Health_01_Stroke.png',
  strength: 'ICON_DarkFantasy_Stat_Strength_01_Stroke.png',
  agility: 'ICON_DarkFantasy_Stat_Speed_01_Stroke.png',
  resolve: 'ICON_DarkFantasy_Stat_Mind_01_Stroke.png',
};
function assetUrl(rel) { return import.meta.env.BASE_URL + 'assets/hud/' + rel; }
function weaponIconUrl(key) {
  return assetUrl('Icons_Weapons/' + (WEAPON_ICONS[key] || WEAPON_ICONS.sword));
}
// Ornamental section panel with a gilded banner header.
function panel(titleText) {
  const sec = el('div', 'cr-section cr-panel');
  const banner = el('div', 'cr-banner');
  banner.appendChild(el('div', 'cr-title', titleText));
  sec.appendChild(banner);
  return sec;
}

function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(import.meta.env.BASE_URL + 'assets/parts-index.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { index = j; return j; })
      .catch(() => null);
  }
  return indexPromise;
}

// ---------------- appearance helpers ----------------

function knownSet() { return index && index.all ? new Set(index.all) : null; }

function detectGender(parts) {
  for (const n of parts || []) {
    const c = classifyPart(n);
    if (c && c.gender) return c.gender;
  }
  return 'Male';
}

function applyArchetype(key) {
  const a = Hero.ARCHETYPES[key];
  if (!a) return;
  hero.archetype = key;
  hero.weapon = a.weapon;
  hero.alloc = { vigor: 0, strength: 0, agility: 0, resolve: 0 };
  const raw = a.look.kind === 'set' ? enemyParts(a.look.id) : presetParts(a.look.id);
  hero.parts = Hero.sanitizeParts(raw || [], knownSet());
  hero.gender = detectGender(hero.parts);
}

function cycleSlot(slotKey, dir) {
  const def = SLOT_DEFS.find((d) => d.key === slotKey);
  const opts = Hero.slotOptions(index, slotKey, hero.gender);
  if (!def || !opts || !opts.list.length) return;
  const cur = Hero.currentOption(hero.parts, slotKey);
  const n = opts.list.length;
  // optional slots: index -1 = NONE
  let i = cur == null ? -1 : opts.list.indexOf(cur);
  if (i < -1) i = -1;
  let next = i + dir;
  const lo = opts.optional ? -1 : 0;
  if (next > n - 1) next = lo;
  if (next < lo) next = n - 1;
  const option = next === -1 ? null : opts.list[next];
  hero.parts = Hero.setSlotOption(hero.parts, slotKey, option, hero.gender);
  updateAppearance();
  rebuildCharacter();
}

function cycleGender() {
  hero.gender = hero.gender === 'Male' ? 'Female' : 'Male';
  hero.parts = Hero.flipGender(hero.parts, hero.gender, index);
  updateAppearance();
  rebuildCharacter();
}

// ---------------- DOM ----------------

function slotDisplayName(slotKey) {
  const cur = Hero.currentOption(hero.parts, slotKey);
  if (cur == null) return 'NONE';
  const def = SLOT_DEFS.find((d) => d.key === slotKey);
  if (def.pair) return '#' + cur;
  // strip Chr_ / gender / underscores for readability
  return cur.replace(/^Chr_/, '').replace(/_/g, ' ')
    .replace(/ (Male|Female) /, ' ');
}

function el(tag, cls, text) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
}

function buildDOM() {
  screenEl.innerHTML = '';

  const wrap = el('div', 'creator-wrap');
  const left = el('div', 'creator-left');
  const right = el('div', 'creator-right');
  wrap.appendChild(left);
  wrap.appendChild(right);
  screenEl.appendChild(wrap);

  const canvas = el('canvas');
  canvas.id = 'creator-canvas';
  right.appendChild(canvas);
  const hint = el('div', 'creator-hint', 'DRAG to orbit · WHEEL to zoom');
  right.appendChild(hint);

  left.appendChild(el('div', 'cr-h1', 'CREATE CHARACTER'));
  left.appendChild(el('div', 'cr-h2', 'Forge the one who descends'));
  left.appendChild(el('div', 'cr-divider'));

  // ---- 1. presets ----
  const s1 = panel('ORIGIN');
  s1.appendChild(el('div', 'cr-hint-line', 'sets look, stats & weapon — all editable after'));
  const presetRow = el('div', 'row');
  presetRow.style.justifyContent = 'flex-start';
  for (const a of Object.values(Hero.ARCHETYPES)) {
    const b = el('button', 'cr-preset', a.label);
    b.dataset.arch = a.key;
    b.addEventListener('click', () => {
      applyArchetype(a.key);
      refreshAll();
    });
    presetRow.appendChild(b);
  }
  s1.appendChild(presetRow);
  left.appendChild(s1);

  // ---- 2. appearance ----
  const s2 = panel('APPEARANCE');
  const genderRow = el('div', 'cr-row');
  genderRow.appendChild(el('div', 'cr-label', 'BODY'));
  const gval = el('div', 'cr-val');
  gval.id = 'cr-gender-val';
  const gbtn = el('button', 'cr-arrow', '◀ ▶');
  gbtn.title = 'Swap body base (male/female part families stay compatible)';
  gbtn.addEventListener('click', cycleGender);
  genderRow.appendChild(gval);
  genderRow.appendChild(gbtn);
  s2.appendChild(genderRow);
  const appBox = el('div');
  appBox.id = 'cr-appearance';
  s2.appendChild(appBox);
  left.appendChild(s2);

  // ---- 3. stats ----
  const s3 = panel('ATTRIBUTES');
  const poolLine = el('div', 'cr-pool');
  poolLine.id = 'cr-pool';
  s3.appendChild(poolLine);
  const statBox = el('div');
  statBox.id = 'cr-stats';
  s3.appendChild(statBox);
  const derived = el('div', 'cr-derived');
  derived.id = 'cr-derived';
  s3.appendChild(derived);
  left.appendChild(s3);

  // ---- 4. weapon ----
  const s4 = panel('STARTING WEAPON');
  const wrow = el('div', 'row');
  wrow.style.justifyContent = 'flex-start';
  wrow.id = 'cr-weapons';
  for (const k of Hero.WEAPON_CHOICES) {
    const w = WEAPONS[k];
    const s = weaponStats(k);                       // live CFG-tuned numbers
    const b = el('button', 'cr-weapon');
    b.dataset.weapon = k;
    b.title = `${s.type} · ${s.damage} dmg · ${s.range.toFixed(1)}m reach`;
    const slot = el('div', 'cr-slot');              // Frame_Box_Small_01 border (CSS)
    const img = el('img');
    img.src = weaponIconUrl(k);
    img.alt = w.name;
    slot.appendChild(img);
    b.appendChild(slot);
    b.appendChild(el('div', 'cr-wname', w.name.toUpperCase()));
    b.appendChild(el('div', 'cr-wstat', `${s.damage} DMG`));
    b.addEventListener('click', () => {
      hero.weapon = k;
      updateWeaponButtons();
      rebuildCharacter();
    });
    wrow.appendChild(b);
  }
  s4.appendChild(wrow);
  left.appendChild(s4);

  // ---- 5. name ----
  const s5 = panel('NAME');
  const nameInput = el('input', 'cr-name');
  nameInput.id = 'cr-name';
  nameInput.maxLength = 24;
  nameInput.value = hero.name || 'Nameless';
  nameInput.placeholder = 'Name your champion';
  nameInput.addEventListener('input', () => {
    hero.name = nameInput.value.slice(0, 24) || 'Nameless';
  });
  s5.appendChild(nameInput);
  left.appendChild(s5);

  // ---- buttons ----
  const brow = el('div', 'cr-buttons');
  const confirm = el('button', 'big', 'CONFIRM');
  confirm.id = 'cr-confirm';
  confirm.addEventListener('click', doConfirm);
  const rand = el('button', '', 'RANDOMIZE');
  rand.addEventListener('click', () => {
    Hero.randomizeHero(hero, index);
    refreshAll();
  });
  const reset = el('button', '', 'RESET');
  reset.title = 'Back to the chosen origin';
  reset.addEventListener('click', () => {
    applyArchetype(hero.archetype);
    refreshAll();
  });
  const back = el('button', '', 'BACK (Esc)');
  back.addEventListener('click', () => close(false));
  brow.appendChild(confirm);
  brow.appendChild(rand);
  brow.appendChild(reset);
  brow.appendChild(back);
  left.appendChild(brow);
  const err = el('div', 'cr-error');
  err.id = 'cr-error';
  left.appendChild(err);

  // orbit controls on the preview canvas
  canvas.addEventListener('pointerdown', (e) => {
    orbit.dragging = true;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!orbit.dragging) return;
    orbit.yaw += (e.clientX - orbit.lastX) * 0.008;
    orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + (e.clientY - orbit.lastY) * 0.005, -0.25, 0.7);
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
  });
  const stop = () => { orbit.dragging = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.dist = THREE.MathUtils.clamp(orbit.dist + e.deltaY * 0.002, 1.7, 5.2);
  }, { passive: false });

  return canvas;
}

function updateAppearance() {
  document.getElementById('cr-gender-val').textContent = hero.gender.toUpperCase();
  const box = document.getElementById('cr-appearance');
  if (!box) return;
  box.innerHTML = '';
  for (const def of SLOT_DEFS) {
    if (def.key === 'facialHair' && hero.gender === 'Female') continue;
    const row = el('div', 'cr-row');
    row.appendChild(el('div', 'cr-label', def.label));
    const val = el('div', 'cr-val', slotDisplayName(def.key));
    row.appendChild(val);
    const mk = (dir, txt) => {
      const b = el('button', 'cr-arrow', txt);
      b.addEventListener('click', () => cycleSlot(def.key, dir));
      return b;
    };
    row.appendChild(mk(-1, '◀'));
    row.appendChild(mk(1, '▶'));
    box.appendChild(row);
  }
}

function updateStats() {
  const pool = document.getElementById('cr-pool');
  const box = document.getElementById('cr-stats');
  const derived = document.getElementById('cr-derived');
  if (!pool || !box || !derived) return;
  const left = Hero.pointsLeft(hero);
  pool.textContent = `ATTRIBUTE POINTS LEFT: ${left}`;
  pool.style.color = left > 0 ? '#e8c85a' : '#9a8f78';
  box.innerHTML = '';
  const base = Hero.baseStats(hero.archetype);
  const tot = Hero.totalStats(hero);
  for (const k of Hero.STAT_KEYS) {
    const row = el('div', 'cr-row');
    const icon = el('div', 'cr-stat-icon');         // Icons_Stats sprite
    if (STAT_ICONS[k]) icon.style.backgroundImage = `url('${assetUrl('Icons_Stats/' + STAT_ICONS[k])}')`;
    row.appendChild(icon);
    row.appendChild(el('div', 'cr-label', Hero.STAT_LABELS[k]));
    const minus = el('button', 'cr-arrow', '−');
    minus.disabled = hero.alloc[k] <= 0;
    minus.addEventListener('click', () => { Hero.adjustStat(hero, k, -1); updateStats(); });
    const val = el('div', 'cr-val',
      `${tot[k]}${base[k] ? ` (${base[k]}+${hero.alloc[k]})` : ''}`);
    val.title = STAT_DESC[k];
    const plus = el('button', 'cr-arrow', '+');
    plus.disabled = left <= 0 || hero.alloc[k] >= Hero.ALLOC_CAP;
    plus.addEventListener('click', () => { Hero.adjustStat(hero, k, 1); updateStats(); });
    row.appendChild(minus);
    row.appendChild(val);
    row.appendChild(plus);
    box.appendChild(row);
  }
  const d = Hero.heroDerived(hero);
  derived.innerHTML =
    `HP <b style="color:#e8c85a">${d.maxHp}</b> &nbsp;·&nbsp; STAMINA <b style="color:#e8c85a">${d.maxStamina}</b> &nbsp;·&nbsp; ` +
    `DAMAGE <b style="color:#e8c85a">×${d.dmgMult.toFixed(2)}</b><br/>` +
    `SPEED <b style="color:#e8c85a">×${d.speedMult.toFixed(2)}</b> &nbsp;·&nbsp; ` +
    `STAGGER RESIST <b style="color:#e8c85a">${Math.round(d.staggerRes * 100)}%</b> &nbsp;·&nbsp; ` +
    `STAMINA REGEN <b style="color:#e8c85a">×${d.regenMult.toFixed(2)}</b>`;
}

function updateWeaponButtons() {
  const row = document.getElementById('cr-weapons');
  if (!row) return;
  for (const b of row.querySelectorAll('button')) {
    b.classList.toggle('selected', b.dataset.weapon === hero.weapon);
  }
}

function updatePresetButtons() {
  for (const b of screenEl.querySelectorAll('.cr-preset')) {
    b.classList.toggle('selected', b.dataset.arch === hero.archetype);
  }
}

function refreshAll() {
  updatePresetButtons();
  updateAppearance();
  updateStats();
  updateWeaponButtons();
  const nameInput = document.getElementById('cr-name');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = hero.name;
  rebuildCharacter();
}

function doConfirm() {
  const err = document.getElementById('cr-error');
  const problems = Hero.validateHero(hero, index);
  if (problems.length) {
    err.textContent = 'Cannot confirm: ' + problems.slice(0, 3).join('; ');
    return;
  }
  Hero.saveHero(hero);
  close(true);
}

// ---------------- 3D preview ----------------

function rebuildCharacter() {
  if (!scene || !previewReady) return;
  if (charHandle) {
    scene.remove(charHandle.group);
    charHandle = null;
    anim = null;
    weaponVis = null;
  }
  const c = buildSkinnedCharacter(hero.parts, () => MATS.atlas());
  if (!c) return;
  charHandle = c;
  const handR = c.bones.get('Hand_R');
  const wv = buildWeaponVisual(hero.weapon) || buildWeaponVisual('sword');
  if (handR && wv) {
    wv.scale.setScalar(100); // bone space is centimeters — verified transform
    wv.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    handR.add(wv);
    weaponVis = wv;
  }
  scene.add(c.group);
  anim = new Animator(c.root);
  anim.play('idle');
}

function startPreview(canvas) {
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 600;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0x8a7a5a, 0x0c0a10, 0.9));
  const key = new THREE.DirectionalLight(0xffd9a0, 1.6);
  key.position.set(2, 3, 2.5);
  scene.add(key);
  // cold gothic rim from behind
  const rim = new THREE.DirectionalLight(0x5a6aff, 1.5);
  rim.position.set(-2.5, 2.4, -2.4);
  scene.add(rim);

  camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 30);
  orbit.dist = CFG.creator.zoom;

  // stone disc the hero stands on
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 1.0, 0.09, 30),
    new THREE.MeshLambertMaterial({ color: 0x241f18 }));
  disc.position.y = -0.05;
  scene.add(disc);

  const onResize = () => {
    if (!renderer) return;
    const cw = canvas.clientWidth || 600;
    const ch = canvas.clientHeight || 600;
    renderer.setSize(cw, ch, false);
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);
  startPreview._onResize = onResize;

  previewReady = true;
  rebuildCharacter();

  let last = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!orbit.dragging) orbit.yaw += dt * CFG.creator.rotateSpeed;
    if (anim) anim.update(dt);
    if (camera) {
      const cy = 0.95 + Math.sin(orbit.pitch) * orbit.dist;
      const ch = Math.cos(orbit.pitch) * orbit.dist;
      camera.position.set(Math.sin(orbit.yaw) * ch, cy, Math.cos(orbit.yaw) * ch);
      camera.lookAt(0, 0.9, 0);
    }
    if (renderer) renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);
}

function stopPreview() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (startPreview._onResize) {
    window.removeEventListener('resize', startPreview._onResize);
    startPreview._onResize = null;
  }
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  scene = null;
  camera = null;
  charHandle = null;
  anim = null;
  weaponVis = null;
  previewReady = false;
}

// ---------------- open / close ----------------

export function open(done) {
  if (isOpen) return;
  isOpen = true;
  onDone = done || null;
  screenEl = document.getElementById('screen-creator');
  screenEl.classList.add('active');
  screenEl.innerHTML = '<div class="cr-h1" style="margin:auto">FORGING THE CHAMPION…</div>';

  document.addEventListener('keydown', onKey);

  Promise.all([loadIndex(), (async () => {
    while (!SKINNED.ready && isOpen) await new Promise((r) => setTimeout(r, 400));
  })()]).then(([idx]) => {
    if (!isOpen) return;
    if (!idx || !SKINNED.ready) {
      screenEl.innerHTML = '<div class="cr-h1" style="margin:auto">THE FORGE IS COLD — Synty assets unavailable</div>';
      setTimeout(() => { if (isOpen) close(false); }, 1600);
      return;
    }
    hero = Hero.getHero() || Hero.defaultHero();
    if (!Array.isArray(hero.parts) || !hero.parts.length) applyArchetype(hero.archetype);
    else hero.parts = Hero.sanitizeParts(hero.parts, knownSet());
    hero.gender = detectGender(hero.parts) || hero.gender;
    const canvas = buildDOM();
    refreshAll();
    startPreview(canvas);
  });
}

function onKey(e) {
  if (e.code === 'Escape') {
    e.preventDefault();
    close(false);
  }
}

export function close(confirmed) {
  if (!isOpen) return;
  isOpen = false;
  document.removeEventListener('keydown', onKey);
  stopPreview();
  if (screenEl) {
    screenEl.classList.remove('active');
    screenEl.innerHTML = '';
  }
  const cb = onDone;
  onDone = null;
  if (cb) cb(!!confirmed);
}

// External hide (e.g. the run is starting) — no callback, no save.
export function hide() {
  if (!isOpen) return;
  isOpen = false;
  document.removeEventListener('keydown', onKey);
  stopPreview();
  if (screenEl) {
    screenEl.classList.remove('active');
    screenEl.innerHTML = '';
  }
  onDone = null;
}

export function creatorOpen() { return isOpen; }
