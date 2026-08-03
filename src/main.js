// main.js — boot, renderer/scene, game state machine (loadout -> run -> result),
// melee hit sweep, interaction (loot / extraction), gate logic, juice (hit-stop,
// screen shake), and the frame loop.
import * as THREE from 'three';
import { buildLevel } from './level.js';
import { Player, cameraFeel } from './player.js';
import { Enemy } from './enemy.js';
import { Gore } from './gore.js';
import { Sparks } from './sparks.js';
import { LootSystem } from './loot.js';
import * as UI from './ui.js';
import * as Meta from './meta.js';
import { makeWeaponItem } from './weapons.js';
import { AudioEngine } from './audio.js';
import { initModels, MODELS } from './models.js';
import { initSkinned, SKINNED } from './skinned.js';
import { PlayerBody } from './playerbody.js';
import * as MP from './mp.js';
import {
  isExecutable, pointInVolume,
  isGrazed, sweepFamily, liveSweepGeo, chargeDmgMult,
  resolveDefense, blockStaminaCost, timingDmgMult, timingWindow,
  hitstopMs, hitstopTable,
  isPerfectParry, flowMult,
} from './combat.js';
import { resolveChamber, resolveClash } from './enemy.js';
import { CFG, onCfgChange } from './config.js';
import { initPanel, isPanelOpen } from './panel.js';
import { getHero, totalStats, ARCHETYPES } from './hero.js';

// ---- Batch 1 — contact quality: hit-stop & contact tuning defaults ----
// game.hitstop(ms) freezes the world briefly on CONTACT (never on whiff).
// Values are MILLISECONDS; the table is keyed by weapon, light vs heavy.
// Runtime behavior reads CFG.feel.hitstop LIVE via combat.js hitstopTable()/
// hitstopMs() (tuning panel); this exported const stays as the documented
// default/fallback for tests and browser-side consumers.
export const HITSTOP_TABLE = {
  sword: { light: 40, heavy: 80 },
  axe: { light: 90, heavy: 90 },
  mace: { light: 70, heavy: 70 },
  severBonus: 60,   // added when the blow severs/destroys the struck part
  execution: 150,   // executions override the per-weapon value
  armorBreak: 50,   // extra freeze when armor shatters (sells the crack)
};
// Glancing blows freeze at a fraction of the table value.
export const HITSTOP_GRAZE_MULT = 0.5;
// Relative weapon mass driving knockback power (applyKnockback) and camKick.
export const CONTACT_WEAPON_MASS = { sword: 1.0, axe: 1.6, mace: 1.4 };
// audio.materialHit severity: clamp01(dmg / dmgForMax), floored at min.
export const MATERIAL_HIT_SEVERITY = { min: 0.15, dmgForMax: 60 };

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CFG.world.fogColor);
scene.fog = new THREE.FogExp2(CFG.world.fogColor, CFG.world.fogDensity);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 120);
scene.add(camera);
const ambient = new THREE.AmbientLight(0x1e1e30, CFG.world.ambientIntensity);
scene.add(ambient);
// sickly moonlight: cold green rim over the ruins
const moon = new THREE.DirectionalLight(CFG.world.moonColor, CFG.world.moonIntensity);
moon.position.set(-30, 42, -18);
scene.add(moon);
const lantern = new THREE.PointLight(0xffc890, 13, 11, 2);
lantern.position.set(0.2, 0.1, 0.2);
camera.add(lantern);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- game object ----------
const level = buildLevel(scene);

// armor-break hook dedupe: enemy.damageArmor fires game.onArmorBreak on break,
// and the melee sweep fires it as a fallback — this guarantees exactly once
const _armorBreakFired = new WeakMap(); // enemy -> { part, t }
// partName arrives as either a contract short name ('armL') or an internal
// part key ('leftArm') depending on the caller — normalize for the dedupe
const _ARMOR_PART_NORM = {
  head: 'head', torso: 'torso',
  armL: 'armL', leftArm: 'armL', armR: 'armR', rightArm: 'armR',
  legL: 'legL', leftLeg: 'legL', legR: 'legR', rightLeg: 'legR',
};

// Kick off Synty asset loading in the background — enemies/viewmodels upgrade
// to real models once ready; boxes render until then (and on failure).
initModels().then((ok) => {
  if (ok) UI.notify('Synty assets loaded', '#7fc97f');
}).catch(() => {});
// Real skinned rigs + mocap clips (bigger download, loads in parallel).
initSkinned().then((ok) => {
  if (ok) UI.notify('Warriors of Grimhold awakened', '#7fc97f');
}).catch(() => {});

const game = {
  state: 'loadout',
  scene, camera, level,
  player: null,
  enemies: [],
  runGold: 0,
  runItems: [],
  gateOpen: false,
  gateThreshold: 100,   // extraction condition: loot value (gold + item values) >= 100
  runKills: 0,
  hitStop: 0,
  shake: 0,
  slowmoT: 0,
  slowmoScale: 1,
  bossName: false,
  time: 0,
  paused: false,
  training: false,       // training-room mode (dummies, no meta progression)
  trainingSlots: [],     // {spawn, enemy, respawnT}
  notify: (t, c) => UI.notify(t, c),
  uiDamageFlash: () => UI.damageFlash(),
  debugLine: (t) => { if (CFG.debug.showReadout) UI.debugLine(t); },
  showPauseHint: () => UI.showPause(true),
  audio: new AudioEngine(),
  lootValue() {
    return this.runGold + this.runItems.reduce((s, i) => s + (i.value || 0), 0);
  },
  // brief slow-mo (real-time duration, world dt scaled)
  slowmo(scale, t) {
    this.slowmoScale = scale;
    this.slowmoT = Math.max(this.slowmoT, t);
  },
  // brief global freeze on CONTACT (hit-stop). durationMs is in MILLISECONDS
  // and converts into the existing hitStop field (seconds, world-dt scaled in
  // the frame loop). Local feel only — never networked, MP-safe.
  hitstop(durationMs) {
    if (!(durationMs > 0)) return;
    this.hitStop = Math.max(this.hitStop, durationMs / 1000);
  },
  // armor gives way (fired by enemy.damageArmor, or the sweep's fallback).
  // Deduped per enemy+part so the break beat lands exactly once.
  onArmorBreak(enemy, partName, pos) {
    const norm = _ARMOR_PART_NORM[partName] || partName;
    const last = _armorBreakFired.get(enemy);
    if (last && last.part === norm && this.time - last.t < 0.5) return;
    _armorBreakFired.set(enemy, { part: norm, t: this.time });
    if (this.audio && typeof this.audio.armorBreak === 'function') this.audio.armorBreak(pos);
    // 'armor' tint lands with Batch 1; sparks falls back to white until then
    if (this.sparks && pos) this.sparks.burst(pos, 30, 'armor');
    this.hitstop(hitstopTable().armorBreak);
    this.shake = Math.max(this.shake, 0.35);
    if (this.player && typeof this.player.fovPunch === 'function') {
      this.player.fovPunch(cameraFeel().fovPunch.armorBreak);
    }
    // no UI.notify here — enemy._onArmorBreak already pops the break message
    this.debugLine(`ARMOR BREAK · ${partName}`);
  },
  decapSlowmo() {
    this.slowmo(CFG.combat.decapSlowmoScale, CFG.combat.decapSlowmoT);
  },
  onExecution(enemy, part) {
    this.slowmo(CFG.combat.executeSlowmoScale, CFG.combat.executeSlowmoT);
    this.hitstop(hitstopTable().execution);
    this.shake = Math.max(this.shake, 0.7);
    UI.killPopup('EXECUTED!', '#ffcc33');
  },
  onDecapitation() {
    UI.killPopup('DECAPITATED!', '#ff2030');
  },
  onGib() {
    UI.killPopup('BRUTAL!', '#ff5020');
  },
  // kick (G): tiny damage, big stagger, breaks block
  onPlayerKick() {
    const p = this.player;
    if (!p) return;
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_camDir);
    let best = null, bestD = CFG.combat.kickRange;
    for (const e of this.enemies) {
      if (e.dead || e.state === 'rise') continue;
      const d = e.pos.distanceTo(p.pos);
      if (d > bestD + 0.4) continue;
      const to = _partPos.copy(e.pos).setY(e.pos.y + 1).sub(_camPos).normalize();
      if (to.dot(_camDir) > 0.5 && d < bestD + 0.4) { best = e; bestD = d; }
    }
    if (best) {
      // route through player.kick() so the Batch 2 wall-splat fires when the
      // enemy is pinned against stone (player.kick applies the kick + splat).
      p.kick(best);
      this.hitstop(60);
      this.shake = Math.max(this.shake, 0.25);
      UI.hitmarker(false);
    } else {
      // boot the dead: kicking a corpse slides it + squeezes out more blood
      let corpse = null, cd = CFG.combat.kickRange + 0.5;
      for (const e of this.enemies) {
        if (!e.dead) continue;
        const d = e.pos.distanceTo(p.pos);
        if (d >= cd) continue;
        const to = _partPos.copy(e.pos).setY(e.pos.y + 0.7).sub(_camPos).normalize();
        if (to.dot(_camDir) > 0.35) { corpse = e; cd = d; }
      }
      if (corpse) {
        corpse.nudgeCorpse(p.pos, CFG.ragdoll.kickPower);
        this.hitstop(50);
        this.shake = Math.max(this.shake, 0.2);
        UI.hitmarker(false);
      }
    }
    this.audio.kickThud();
  },
};

// resume / start the AudioContext on the first real user gesture
const _audioGesture = () => game.audio.init();
document.addEventListener('mousedown', _audioGesture);
document.addEventListener('keydown', _audioGesture);

// M = mute toggle (works in every game state)
document.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM') return;
  const muted = game.audio.toggleMute();
  UI.notify(muted ? 'AUDIO MUTED' : 'AUDIO ON', '#9a8f78');
});

const gore = new Gore(scene, level);
gore.audio = game.audio; // organ landings squelch through positional audio
const sparks = new Sparks(scene);
const loot = new LootSystem(scene, game);
game.gore = gore;
game.sparks = sparks;
game.loot = loot;

// ---------- combat: melee sweep during active swing frames ----------
const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _partPos = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _hitPos = new THREE.Vector3();    // true contact point of the landed blow
const _bladeDir = new THREE.Vector3();  // world-space blade travel (camKick)

function meleeSweep() {
  const p = game.player;
  if (!p || p.attack.phase !== 'swing') return;
  const w = p.wstats;
  const a = p.attack;

  // WEAPON CLASH: your live blade meets an enemy's live blade mid-swing
  if (resolveClash(game, p)) return;

  // DRAG / ACCEL timing gate: the contact window inside the swing shifts with
  // the accumulated mouse offset (drag = late, accel = early & compressed)
  const off = a.timingOff || 0;
  const tw = timingWindow(off);
  const tN = a.t / w.swing;
  if (tN < tw[0] || tN > tw[1]) return;

  camera.getWorldPosition(_camPos);
  camera.getWorldDirection(_camDir);

  // sweep geometry follows the attack TYPE (horizontal / overhead / stab)
  const geo = liveSweepGeo(sweepFamily(a.dir));
  const arcBonus = (!a.heavy && a.stage === 3) ? CFG.combat.combo3ArcBonus : 0;
  const range = w.range + geo.rangeBonus;

  // gore 2.0: once per swing, re-launch any severed chunk caught in the arc
  if (!a.limbLaunched) {
    a.limbLaunched = true;
    gore.launchNearRay(_camPos, _camDir, range,
      CFG.limbs.hitLaunch * (a.heavy ? 1.5 : 1));
  }

  // Gather sweep candidates AND the crosshair-aimed part. The aimed part wins
  // whenever it lands anywhere near the active sweep — hit where you look.
  let bestEnemy = null, bestPart = null, bestT = Infinity;
  let aimEnemy = null, aimPart = null, aimT = Infinity;
  for (const e of game.enemies) {
    if (e.dead || e.state === 'rise' || a.hitSet.has(e)) continue;
    for (const part of Object.values(e.parts)) {
      if (part.state !== 'intact') continue;
      part.mesh.getWorldPosition(_partPos);
      _rel.copy(_partPos).sub(_camPos);
      const dist = _rel.length();
      if (dist < 0.01) continue;
      const t = _rel.dot(_camDir);
      if (t < 0.15 || t > range) continue;
      const dy = _partPos.y - _camPos.y;
      if (dy < geo.yMin || dy > geo.yMax) continue;
      const lat = Math.sqrt(Math.max(0, dist * dist - t * t)); // off-ray distance
      if (lat < part.radius + geo.lat + arcBonus && t < bestT) {
        bestT = t; bestEnemy = e; bestPart = part;
      }
      // crosshair ray vs part hitbox (type-boosted radius), generous sweep slack
      const boost = geo.aimBoost[part.key] || 1;
      if (lat < part.radius * boost + 0.06 &&
          lat < part.radius + geo.lat + arcBonus + 0.35 && t < aimT) {
        aimT = t; aimEnemy = e; aimPart = part;
      }
    }
  }
  if (aimEnemy) { bestEnemy = aimEnemy; bestPart = aimPart; bestT = aimT; }
  if (!bestEnemy) {
    // whack the dead: hitting a corpse nudges it + squeezes out blood
    let corpse = null, cT = Infinity;
    for (const e of game.enemies) {
      if (!e.dead || p.attack.hitSet.has(e)) continue;
      for (const key of ['torso', 'head']) {
        const part = e.parts[key];
        if (!part) continue;
        part.mesh.getWorldPosition(_partPos);
        const t = _partPos.clone().sub(_camPos).dot(_camDir);
        if (t < 0.2 || t > w.range) continue;
        _closest.copy(_camPos).addScaledVector(_camDir, t);
        if (_closest.distanceTo(_partPos) < part.radius + 0.35 && t < cT) { cT = t; corpse = e; }
      }
    }
    if (corpse) {
      p.attack.hitSet.add(corpse);
      corpse.nudgeCorpse(_camPos, p.attack.heavy ? CFG.ragdoll.nudgeHeavy : CFG.ragdoll.nudgeLight);
      game.audio.impactFlesh(p.attack.heavy, _partPos);
      game.shake = Math.max(game.shake, 0.15);
      p.vmRecoil = -0.4;
      return;
    }
    // blade meets stone: one spark burst per swing at the wall contact point
    if (!p.attack.wallSparked) {
      const hit = level.raycastWall(_camPos, _camDir, Math.min(range, 3.0));
      if (hit) {
        p.attack.wallSparked = true;
        sparks.burst(hit.point, 18);
        game.audio.clangLight(hit.point);
        p.vmRecoil = Math.max(p.vmRecoil, 0.7);
        game.shake = Math.max(game.shake, 0.12);
      }
    }
    return;
  }

  p.attack.hitSet.add(bestEnemy);
  // true contact point, captured BEFORE takeHit — a severed part's mesh may
  // leave the body during resolution
  bestPart.mesh.getWorldPosition(_hitPos);
  // charge multiplies the strike's damage (sever rides into takeHit via opts);
  // drags bite a little harder, accels land a little softer
  let mult = (p.attack.heavy ? w.heavyMult : 1) * p.stats.dmgMult * chargeDmgMult(p.attack.charge)
    * timingDmgMult(off);
  if (!p.attack.heavy && p.attack.stage === 3) mult *= CFG.combat.combo3DmgMult;
  // Batch 2 — flow combo: alternating light-attack directions reward a damage
  // multiplier (resets on repeat / heavy). Read live from player.combo.flow.
  if (!p.attack.heavy) mult *= flowMult(p.combo.flow);
  const dmg = Math.round(w.damage * mult);
  // armor contact? (read-only probe — takeHit routes the damage THROUGH
  // enemy.damageArmor internally and returns { absorbed, armorBroke })
  const armored = typeof bestEnemy.armorAt === 'function' && bestEnemy.armorAt(bestPart.key) > 0;
  // glancing blow: connected at max reach or against a fast-sliding target
  const targetSpeed = bestEnemy.knock.length() + (bestEnemy.sidestepT > 0 ? 4.5 : 0);
  const grazed = isGrazed(bestT / range, targetSpeed);
  const res = bestEnemy.takeHit(bestPart.key, dmg, w.type, w, p.attack.heavy, _camPos,
    { riposteMult: CFG.combat.riposteCrit, severBonus: CFG.combat.riposteSeverBonus, grazed,
      charge: p.attack.charge, dir: p.attack.dir });
  if (res) {
    // ENEMY PARRY: a knight turned the blow aside — you lose wind and your
    // swing bounces into recovery while they look for the punish
    if (res.parried) {
      p.stamina = Math.max(0, p.stamina - CFG.duel.parryStaminaDmg);
      a.phase = 'recover';
      a.t = w.recover * 0.25;
      p.parryJolt(); // visible arms/view-model jolt: your blade is batted aside
      game.shake = Math.max(game.shake, 0.25);
      UI.notify('PARRIED!', '#8db4e8');
      game.debugLine(`PARRIED by ${bestEnemy.name} · -${CFG.duel.parryStaminaDmg} st`);
      return;
    }
    // live debug readout: what the swing actually did
    game.debugLine(`${p.attack.dir || 'slashR'} · chg ${Math.round((p.attack.charge || 0) * 100)}% · ${bestPart.key.toUpperCase()} · ${res.dmg} dmg${res.absorbed ? ` · armor -${res.absorbed}` : ''}${res.armorBroke ? ' · BREAK' : ''}${res.killed ? ' · KILL' : ''}${off > 0.02 ? ' · DRAG' : off < -0.02 ? ' · ACCEL' : ''}`);
    // what the blow CONNECTED with (Batch 1): their guard when blocked, armor
    // while the part's armor pool holds, bone for skeletons, flesh otherwise
    const material = res.blocked ? 'shield'
      : armored ? 'armor'
      : bestEnemy.kind === 'skeleton' ? 'bone' : 'flesh';
    const severity = Math.max(MATERIAL_HIT_SEVERITY.min,
      Math.min(1, dmg / MATERIAL_HIT_SEVERITY.dmgForMax));
    // floating damage number at the contact point (training adds the zone name)
    const zone = game.training ? bestPart.key.toUpperCase() : null;
    if (res.dmg > 0 && (!game.training || CFG.training.dmgNumbers)) {
      const ndc = _hitPos.clone().project(camera);
      if (ndc.z < 1) {
        const cls = res.executed ? 'gold' : res.deflected ? 'spark' : res.grazed ? 'graze'
          : res.crit ? 'yellow' : (p.attack.heavy || res.dmg >= 40) ? 'red' : 'white';
        UI.damageNumber((ndc.x * 0.5 + 0.5) * 100 + (Math.random() - 0.5) * 4,
          (-ndc.y * 0.5 + 0.5) * 100 - 3, res.dmg, cls, zone);
      }
    }
    // hit-stop: per-weapon freeze on CONTACT only, never on whiff — severs and
    // executions hit harder, glancing blows barely tug the frame. The table is
    // resolved LIVE from CFG.feel.hitstop (combat.js hitstopMs).
    const severed = bestPart.state !== 'intact';
    const stopMs = hitstopMs(w.key, p.attack.heavy,
      { executed: res.executed, severed, grazed: res.grazed });
    game.hitstop(stopMs);
    game.shake = Math.max(game.shake, res.killed ? 0.55 : (p.attack.heavy ? 0.4 : 0.22));
    if (p.attack.heavy && !res.deflected) p.fovPunch(cameraFeel().fovPunch.heavyHit); // FOV punch on heavy connect
    UI.hitmarker(res.killed, res.crit || res.executed);
    // weapon collision feel: armor kicks the weapon back, flesh bites in
    p.vmRecoil = res.deflected ? 1.0 : (w.key === 'mace' ? -0.9 : -0.5);
    // camera director: the blade's travel drags the camera a touch on connect,
    // scaled by weapon mass (heavy swings pull harder, grazes glance off)
    const wMass = CONTACT_WEAPON_MASS[w.key] || 1;
    {
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw); // camera forward (horizontal)
      const rX = -fz, rZ = fx;                            // camera right
      if (a.dir === 'slashR') _bladeDir.set(-rX, -0.2, -rZ);            // right-to-left arc
      else if (a.dir === 'slashL') _bladeDir.set(rX, -0.2, rZ);         // left-to-right arc
      else if (a.dir === 'overhead') _bladeDir.set(fx * 0.25, -1, fz * 0.25); // slammed down
      else _bladeDir.set(fx, 0, fz);                                    // stab punches forward
      _bladeDir.normalize();
      p.camKick(_bladeDir, wMass * (p.attack.heavy ? 1.4 : 1) * (res.grazed ? 0.5 : 1));
    }
    // knockback & armor dents are applied inside enemy.takeHit (Batch 1) —
    // calling them here too would double every shove/dent
    // armor break hook fallback: enemy.damageArmor fires it on the breaking
    // blow; game.onArmorBreak dedupes, so this only covers paths that don't
    if (armored && res.armorBroke) game.onArmorBreak(bestEnemy, bestPart.key, _hitPos);
    // screen blood when the splatter is close & heavy (not on deflects/armor)
    if (!res.deflected && material !== 'armor' && bestT < 2.2 && (p.attack.heavy || res.dmg > 30)) {
      UI.bloodSplatter(p.attack.heavy ? 1.5 : 0.8);
    }
    // impact audio by hit material (Batch 1) — legacy per-outcome chain as
    // fallback until audio.materialHit lands; spark VFX at the contact point
    // ('armor'/'bone' tints land with Batch 1, white fallback until then)
    if (typeof game.audio.materialHit === 'function') {
      game.audio.materialHit(_hitPos, material, severity);
    } else if (res.deflected) {
      game.audio.armorClang(_hitPos);
      game.audio.clangLight(_hitPos);
    } else if (res.blocked) {
      // enemy caught the blow on their guard
      game.audio.clangLight(_hitPos);
      game.audio.impactFlesh(false, _hitPos);
    } else if (res.grazed) game.audio.graze(_hitPos);
    else game.audio.impactFlesh(p.attack.heavy || res.killed, _hitPos);
    if (res.deflected) sparks.burst(_hitPos, 30, 'armor');
    else if (res.blocked) sparks.burst(_hitPos, 18);
    else if (material === 'armor') sparks.burst(_hitPos, 22, 'armor');
    else if (material === 'bone') sparks.burst(_hitPos, 12, 'bone');
    // anime impact flash on heavy connects (subtle, not blinding)
    if (p.attack.heavy && !res.deflected && !res.blocked) UI.impactFlash(0.32, 70);
  }
}

// ---------- enemy -> player damage ----------
game.damagePlayer = (dmg, srcPos, enemy, opts = {}) => {
  const p = game.player;
  if (!p || p.dead) return;

  // Batch 2 — sidestep i-frames: a dodge burst makes the player untargetable
  // for a brief window (honest answer to unparryable red-flash heavy attacks).
  if (p.invuln) {
    game.debugLine(`DODGE i-frame — ${dmg} dmg negated`);
    return;
  }

  // guard only works facing the attacker, and never while reeling from a break
  const toSrc = _partPos.copy(srcPos).sub(p.pos).setY(0).normalize();
  const facing = _closest.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  const canGuard = p.blocking && p.guardBreakT <= 0 && facing.dot(toSrc) > 0.2;
  const unpar = !!(opts.unparryable ||
    (enemy && enemy.atkUnparryable && CFG.enemies.bossUnparryable));
  const outcome = resolveDefense(
    { blocking: canGuard, blockElapsed: game.time - p.blockStart },
    { unparryable: unpar });

  // PERFECT PARRY (Batch 2): guard raised in the narrow sub-window — a free
  // doubled riposte window + sever bonus + brighter reward sting + brief slow.
  if (outcome === 'perfect') {
    p.riposteUntil = game.time + CFG.combat.riposteWindow * 2;
    p.parryCdUntil = game.time + CFG.duel.parryRecovery;
    p.blocking = false;
    if (enemy) enemy.applyParry();
    game.audio.blockPing(true);
    game.audio.clangHeavy();
    _partPos.copy(srcPos); _partPos.y += 1.3;
    sparks.burst(_partPos, 60, 'white');
    if (game.audio.rewardSting) game.audio.rewardSting(_partPos);
    UI.parryFlash();
    UI.impactFlash(0.5, 110);
    UI.killPopup('PERFECT PARRY!', '#fff2a8');
    game.debugLine(`PERFECT PARRY · riposte x2 · attacker -${CFG.duel.parryStaminaDmg} st`);
    game.slowmo(CFG.combat.postureBreakSlowmoScale, CFG.combat.parrySlowmoT);
    game.hitstop(140);
    return;
  }

  // PARRY: guard raised inside the window before the hit lands
  if (outcome === 'parry') {
    p.riposteUntil = game.time + CFG.combat.riposteWindow;
    p.parryCdUntil = game.time + CFG.duel.parryRecovery;
    p.blocking = false; // the parry is spent — recovery before the next guard
    if (enemy) {
      enemy.applyParry(); // staggers + drains the ATTACKER's stamina
    }
    game.audio.blockPing(true);
    game.audio.clangHeavy();
    _partPos.copy(srcPos); _partPos.y += 1.3;
    sparks.burst(_partPos, 34, 'white');
    UI.parryFlash();
    UI.impactFlash(0.38, 80);
    UI.killPopup('PARRY!', '#ffe08a');
    game.debugLine(`PARRY · riposte open · attacker -${CFG.duel.parryStaminaDmg} st`);
    game.slowmo(0.35, CFG.combat.parrySlowmoT);
    game.hitstop(120);
    return;
  }

  // GUARD BREAK vs an unparryable heavy: the guard is smashed aside. No HP
  // damage — but you're reeling, slow and wide open (dodge or kick instead).
  if (outcome === 'guardbreak') {
    p.stamina = Math.max(0, p.stamina - CFG.duel.bossGuardBreakDmg);
    p.guardBreak();
    _partPos.copy(srcPos); _partPos.y += 1.3;
    sparks.burst(_partPos, 24, 'orange');
    return;
  }

  // BLOCK: heavy chip reduction, but the blow bleeds your stamina — and at
  // zero stamina the guard BREAKS
  if (outcome === 'block') {
    p.stamina = Math.max(0, p.stamina - blockStaminaCost(dmg));
    game.audio.blockPing(false);
    game.audio.clangLight();
    _partPos.copy(srcPos); _partPos.y += 1.2;
    sparks.burst(_partPos, 16);
    if (p.stamina <= 0) { p.guardBreak(); return; }
    game.shake = Math.max(game.shake, 0.15);
    game.notify('BLOCKED', '#8db4e8');
    p.vmRecoil = Math.max(p.vmRecoil, 0.8); // shield-arm jolt
    p.takeDamage(dmg * CFG.combat.blockChip, srcPos);
    return;
  }

  game.audio.playerHurt();
  p.takeDamage(dmg, srcPos);
};

// chambers resolve the instant the player's blade starts moving
game.onPlayerSwingStart = () => resolveChamber(game, game.player);

game.onEnemyKilled = (e) => {
  game.runKills++;
  if (game.training) {
    UI.notify(`${e.name} destroyed`, '#e8c85a');
    return; // training: no loot, no gold, no meta progression
  }
  UI.notify(`${e.name} slain`, '#e8c85a');
  const beforeLoot = loot.entries.length;
  loot.rollDrop(e.pos.x, e.pos.y, e.pos.z, e.boss);
  MP.hostLootDropped(beforeLoot); // mp host: sync the fresh drops to clients
  if (e.boss) UI.killPopup('THE GATE WARDEN HAS FALLEN', '#b04dff');
};

game.onPlayerDeath = () => {
  if (game.state !== 'run') return;
  if (game.training) {
    // the wardens patch you up — training never ends a run
    const p = game.player;
    p.dead = false;
    p.hp = p.stats.maxHp;
    p.pos.set(level.training.spawn.x, 0, level.training.spawn.z);
    p.pos.y = level.floorHeightAt(p.pos.x, p.pos.z, 2);
    p.vy = 0;
    p.vel.set(0, 0, 0);
    UI.notify('The wardens stitch you back together.', '#9a8f78');
    return;
  }
  game.state = 'result';
  MP.sendLifeEvent('died');
  document.exitPointerLock();
  const lost = game.lootValue();
  const hero = getHero();
  UI.showResult(false, [
    hero ? `<b>${hero.name}</b> died in the dark. Everything they carried is lost.`
      : 'You died in the dark. Everything you carried is lost.',
    `Lost: ${game.runGold} gold + ${game.runItems.length} item(s) — total value ${lost}`,
  ]);
};

// ---------- run lifecycle ----------
function cleanupRun() {
  if (game.player) { game.player.dispose(); game.player = null; }
  if (game.playerBody) { game.playerBody.dispose(); game.playerBody = null; }
  for (const e of game.enemies) e.dispose();
  game.enemies = [];
  game.trainingSlots = [];
  clearWisps();
  loot.reset();
  gore.reset();
  sparks.reset();
}

game.startRun = (presetKey) => {
  // clean previous run
  cleanupRun();
  game.training = false;

  const meta = Meta.getMeta();
  const hero = getHero();
  // a created hero overrides the chosen preset's archetype, stats and weapon
  const preset = Meta.PRESETS[hero ? hero.archetype : presetKey] || Meta.PRESETS.knight;
  let weaponItem = meta.equipWeaponId ? meta.stash.find(i => i.id === meta.equipWeaponId) : null;
  if (!weaponItem) weaponItem = makeWeaponItem(hero ? hero.weapon : preset.weapon, 'common');
  let armor = meta.equipArmorId ? meta.stash.find(i => i.id === meta.equipArmorId) : preset.armor;
  const stats = Meta.deriveStats(hero ? totalStats(hero) : preset.stats, armor);

  game.runGold = 0;
  game.runItems = [];
  game.runKills = 0;
  game.gateOpen = false;
  game.bossName = false;
  game.slowmoT = 0;
  game.slowmoScale = 1;
  for (const v of level.ambushVolumes) v.triggered = false;
  level.gate.open = false;
  level.gate.collider.active = true;
  level.gate.mesh.position.y = 1.7;
  level.rune.material.color.setHex(0x882222);

  game.player = new Player(game, { weapon: weaponItem, stats });
  game.playerBody = new PlayerBody(game); // visible first-person body
  // mp: clients hide local enemy AI and wait for host snapshots + loot list
  const mpClient = MP.isMpClient();
  game.enemies = mpClient ? [] : level.enemySpawns.map(s => new Enemy(game, s));
  if (!mpClient) loot.spawnWorldLoot(level.lootSpawns);
  MP.onRunStart();
  if (MP.isMpHost()) MP.hostRunStart(); // tell clients to descend together

  game.state = 'run';
  game.paused = false;
  UI.hideScreens();
  UI.showHUD(true);
  UI.notify(hero
    ? `${hero.name} descends — ${ARCHETYPES[hero.archetype].label} of Grimhold. Find ${game.gateThreshold} loot value and get out.`
    : `You descend as the ${preset.name}. Find ${game.gateThreshold} loot value and get out.`, '#c9b577');
  if (weaponItem.rarity === 'cursed') UI.notify('The cursed blade drinks your blood...', '#b04dff');
};

// ---------- training room ----------
// A detached torch-lit hall (level.training) with 4 AI-disabled practice
// dummies that take FULL combat/gore damage and respawn after a delay.
// Writes nothing to meta progression — no gold, no loot, no stash.
game.startTraining = (presetKey) => {
  cleanupRun();
  game.training = true;

  const meta = Meta.getMeta();
  const hero = getHero();
  const preset = Meta.PRESETS[hero ? hero.archetype : presetKey] || Meta.PRESETS.knight;
  let weaponItem = meta.equipWeaponId ? meta.stash.find(i => i.id === meta.equipWeaponId) : null;
  if (!weaponItem) weaponItem = makeWeaponItem(hero ? hero.weapon : preset.weapon, 'common');
  const armor = meta.equipArmorId ? meta.stash.find(i => i.id === meta.equipArmorId) : preset.armor;
  const stats = Meta.deriveStats(hero ? totalStats(hero) : preset.stats, armor);

  game.runGold = 0;
  game.runItems = [];
  game.runKills = 0;
  game.gateOpen = false;
  game.bossName = false;
  game.slowmoT = 0;
  game.slowmoScale = 1;

  game.player = new Player(game, { weapon: weaponItem, stats });
  const ts = level.training.spawn;
  game.player.pos.set(ts.x, 0, ts.z);
  game.player.pos.y = level.floorHeightAt(ts.x, ts.z, 2);
  game.player.yaw = ts.yaw || 0;
  game.playerBody = new PlayerBody(game);

  game.trainingSlots = level.training.dummySpawns.map((sp) => {
    const e = new Enemy(game, { ...sp, dummy: true });
    game.enemies.push(e);
    return { spawn: sp, enemy: e, respawnT: null };
  });

  game.state = 'run';
  game.paused = false;
  UI.hideScreens();
  UI.showHUD(true);
  UI.notify('TRAINING ROOM — the dummies feel everything.', '#6fb7ff');
  UI.notify('` (backtick) opens the tuning ledger · Esc leaves', '#9a8f78');
  renderer.domElement.requestPointerLock();
};

game.endTraining = () => {
  if (!game.training) return;
  game.training = false;
  cleanupRun();
  game.state = 'loadout';
  if (document.pointerLockElement) document.exitPointerLock();
  UI.showLoadout();
};

// Esc leaves the training room (the browser also drops pointer lock)
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game.training && game.state === 'run') game.endTraining();
});

// training dummy respawns: a few seconds after destruction the wardens winch
// a fresh body down (it claws up out of the floor — same rise as ambushes)
function updateTraining(dt) {
  for (const s of game.trainingSlots) {
    if (!s.enemy) continue;
    if (s.enemy.dead) {
      if (s.respawnT === null) s.respawnT = CFG.training.respawnDelay;
      s.respawnT -= dt;
      if (s.respawnT <= 0) {
        const idx = game.enemies.indexOf(s.enemy);
        if (idx >= 0) game.enemies.splice(idx, 1);
        s.enemy.dispose();
        s.enemy = new Enemy(game, { ...s.spawn, dummy: true, rise: true });
        game.enemies.push(s.enemy);
        s.respawnT = null;
      }
    } else {
      s.respawnT = null;
    }
  }
}

function tryExtract() {
  game.state = 'result';
  MP.sendLifeEvent('extracted');
  document.exitPointerLock();
  const itemNames = game.runItems.map(i => i.name);
  Meta.addRunRewards(game.runItems, game.runGold);
  UI.showResult(true, [
    `You escaped Grimhold with <b>${game.runGold}</b> gold and <b>${game.runItems.length}</b> item(s).`,
    itemNames.length ? itemNames.join(', ') : 'No items carried out.',
    'Your spoils are safe in the vault.',
  ]);
}

// ---------- interaction (E) ----------
document.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyE' || game.state !== 'run' || game.paused || !game.player || game.player.dead) return;
  const p = game.player;

  // priority: loot pickup
  const near = loot.nearest(p.pos, 2.3);
  if (near) {
    loot.take(near);
    MP.notifyLootTaken(near); // mp: remove this entry for the whole room
    const it = near.item;
    if (it.kind === 'gold') {
      game.runGold += it.amount;
      game.audio.pickup('gold');
      UI.notify(`+${it.amount} gold`, '#e8c85a');
    } else if (it.kind === 'weapon') {
      game.runItems.push(it);
      game.audio.pickup(it.rarity);
      const slotNum = p.addWeapon(it);
      UI.notify(slotNum ? `${it.name} — press ${slotNum} to wield` : `${it.name} (carried)`, '#c9b577');
    } else {
      game.runItems.push(it);
      game.audio.pickup(it.kind === 'relic' ? 'rare' : 'common');
      UI.notify(`${it.name} (+${it.value} value)`, it.kind === 'relic' ? '#b04dff' : '#c9b577');
    }
    checkGate();
    return;
  }

  // extraction
  const ex = level.extractPos;
  if (game.gateOpen && Math.hypot(p.pos.x - ex.x, p.pos.z - ex.z) < 2.3) {
    tryExtract();
  }
});

function checkGate() {
  if (!game.gateOpen && game.lootValue() >= game.gateThreshold) {
    game.gateOpen = true;
    level.gate.open = true;
    level.gate.collider.active = false;
    level.rune.material.color.setHex(0x33cc55);
    UI.notify('THE EXTRACTION GATE GRINDS OPEN', '#6fe86f');
    game.shake = Math.max(game.shake, 0.3);
    game.audio.gateRumble(level.gate.mesh.position);
    spawnWisps(); // the labyrinth is confusing by design — light the way out
  }
}

// ---------- extraction wisp trail ----------
// Once the gate opens, glowing wisps mark the BFS route vault -> gate through
// the maze. Style/toggle lives in CFG.world (tuning panel).
function spawnWisps() {
  clearWisps();
  if (!CFG.world.wisps || !level.wispPath || !level.wispPath.length) return;
  game.wisps = [];
  const step = Math.max(1, Math.round(CFG.world.wispSpacing));
  for (let i = 0; i < level.wispPath.length; i += step) {
    const p = level.wispPath[i];
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      color: CFG.world.wispColor, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    s.position.set(p.x, p.y, p.z);
    s.scale.setScalar(CFG.world.wispSize);
    s.userData.phase = i * 0.7;
    scene.add(s);
    game.wisps.push(s);
  }
}
function clearWisps() {
  if (!game.wisps) return;
  for (const s of game.wisps) { scene.remove(s); s.material.dispose(); }
  game.wisps = null;
}

// ---------- pointer lock / pause ----------
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement != null;
  if (game.state === 'run') {
    game.paused = !locked;
    // while the tuning panel is open it owns the screen — no pause overlay
    UI.showPause(!locked && !isPanelOpen());
  }
});
document.getElementById('pause-hint').addEventListener('click', () => {
  renderer.domElement.requestPointerLock();
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- frame loop ----------
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  let dt = Math.min(clock.getDelta(), 0.05);
  game.time += dt;

  // hit-stop: freeze the world briefly on impact
  if (game.hitStop > 0) {
    game.hitStop -= dt;
    dt *= 0.08;
  }
  // slow-mo: parries, decapitations, executions
  if (game.slowmoT > 0) {
    game.slowmoT -= dt;
    dt *= game.slowmoScale;
    if (game.slowmoT <= 0) game.slowmoScale = 1;
  }
  game.shake = Math.max(0, game.shake - dt * 2.2);

  if (game.state === 'run' && !game.paused) {
    game.player.update(dt);
    // positional audio listener follows the camera
    game.audio.setListener(
      game.player.pos.x, game.player.pos.y + 1.62, game.player.pos.z, game.player.yaw);
    // body follows AFTER the camera was positioned — no jitter
    if (game.playerBody) game.playerBody.update(dt);
    meleeSweep();
    game.bossName = false; // boss re-asserts while engaged
    const p = game.player; // defined up-front: used by the loop below AND later
    for (const e of game.enemies) e.update(dt);
    // Batch 2 — posture bars over living foes + player flow-combo meter.
    for (const e of game.enemies) UI.postureBar(e);
    UI.flowMeter(p.combo.flow);
    gore.update(dt, game.player); // player kicks loose severed chunks along
    sparks.update(dt);
    loot.update(dt);
    if (game.training) updateTraining(dt);

    // ambush trigger volumes (host-only in mp — clients get them via snapshots)
    for (const v of (MP.isMpClient() || game.training) ? [] : level.ambushVolumes) {
      if (v.triggered || !pointInVolume(v, p.pos.x, p.pos.z)) continue;
      v.triggered = true;
      for (const s of v.spawns) {
        const e = new Enemy(game, s);
        e.aggro = true;
        game.enemies.push(e);
      }
      UI.notify('AMBUSH — they rise from the dark!', '#ff8040');
      game.audio.enemyDeath(); // low gurgle as a stinger
      game.shake = Math.max(game.shake, 0.2);
    }

    // heartbeat when near death
    game.audio.update(dt, p.hp / p.stats.maxHp);

    // torch flicker
    for (const t of level.torches) {
      t.light.intensity = t.base * (0.82 + 0.22 * Math.abs(Math.sin(game.time * 7 + t.phase)) + Math.random() * 0.06);
    }
    // wisp pulse (extraction trail)
    if (game.wisps) {
      for (const s of game.wisps) {
        const u = game.time * 2.4 + s.userData.phase;
        s.material.opacity = 0.55 + 0.35 * Math.sin(u);
        s.position.y += Math.sin(u) * 0.003;
      }
    }

    // gate slide-open animation
    if (level.gate.open && level.gate.mesh.position.y > -1.8) {
      level.gate.mesh.position.y -= 1.6 * dt;
    }

    // interaction prompt (EXECUTE takes priority — aimed part or nearest executable)
    let prompt = '';
    if (!p.dead) {
      const execTarget = game.enemies.find(e => isExecutable(e) && e.pos.distanceTo(p.pos) < 3.2);
      if (execTarget && p.attack.phase === 'idle') prompt = 'CHARGED ATTACK — EXECUTE';
      else {
        const near = loot.nearest(p.pos, 2.3);
        if (near) prompt = `E — Take ${near.item.name}`;
        else if (game.gateOpen) {
          const ex = level.extractPos;
          if (Math.hypot(p.pos.x - ex.x, p.pos.z - ex.z) < 2.3) prompt = 'E — EXTRACT';
        }
      }
    }
    UI.setPrompt(prompt);
    UI.updateHUD();
  } else if (game.state === 'result' && game.playerBody) {
    // let the death clip finish playing behind the result screen
    game.playerBody.update(dt);
  }

  renderer.render(scene, camera);
}

// ---------- boot ----------
MP.initMp(game);
UI.initUI(game);
// Batch 2 — front-2 modules (enemy/posture, player/wall-splat) call
// `this.game.ui.notify(...)`; UI is a namespace import, so alias it onto game.
game.ui = UI;
initPanel(game, renderer.domElement);

// live tuning hooks: edits in the panel apply to already-spawned enemies and
// the running audio engine (everything else reads CFG at use-time)
onCfgChange((path) => {
  if (path === '' || path.startsWith('enemies')) {
    for (const e of game.enemies) if (e.refreshType) e.refreshType();
  }
  if (path === '' || path.startsWith('audio')) game.audio.applyCfg();
  if (path === '' || path.startsWith('debug')) {
    if (!CFG.debug.showReadout) UI.debugLine('');
  }
  if (path === '' || path.startsWith('world')) {
    scene.fog.density = CFG.world.fogDensity;
    scene.fog.color.setHex(CFG.world.fogColor);
    scene.background.setHex(CFG.world.fogColor);
    ambient.intensity = CFG.world.ambientIntensity;
    moon.color.setHex(CFG.world.moonColor);
    moon.intensity = CFG.world.moonIntensity;
    // live-respawn the wisp trail if the style is tweaked while the gate is open
    if (game.gateOpen) spawnWisps();
  }
});

UI.showLoadout();

// URL-param raid join: ?mp=1&addr=ws://host:8787&room=keep&name=alice
const mpQs = new URLSearchParams(location.search);
if (mpQs.get('mp') === '1') {
  MP.join(
    mpQs.get('addr') || `wss://architectural-applicants-musicians-particles.trycloudflare.com`,
    mpQs.get('room') || 'keep',
    mpQs.get('name') || ('raider' + Math.floor(Math.random() * 100)),
  ).catch(() => UI.notify('RAID SERVER UNREACHABLE', '#ff6040'));
}

tick();
