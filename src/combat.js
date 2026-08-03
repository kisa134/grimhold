// combat.js — pure combat tuning constants & logic helpers (no THREE, no DOM).
// Kept dependency-light so smoke.mjs can unit-test the rules headlessly.
//
// TUNING 2.0: the named constant exports below are the DEFAULTS (kept for
// imports/tests); all rule FUNCTIONS read the live CFG store (src/config.js)
// at call-time, so the in-game tuning panel applies changes mid-swing.

import { CFG, DEFAULTS } from './config.js';

// ---- parry / riposte ----
export const PARRY_WINDOW = DEFAULTS.combat.parryWindow;
export const RIPOSTE_WINDOW = DEFAULTS.combat.riposteWindow;
export const RIPOSTE_CRIT = DEFAULTS.combat.riposteCrit;
export const RIPOSTE_SEVER_BONUS = DEFAULTS.combat.riposteSeverBonus;
export const PARRY_STAGGER = DEFAULTS.combat.parryStagger;

// A parry is a block that was raised at most parryWindow seconds before impact.
export function isParry(blockElapsed) {
  return blockElapsed >= 0 && blockElapsed <= CFG.combat.parryWindow;
}

// ---- directional charged attacks (Mordhau-lite) ----
export const CHARGE_TIME = DEFAULTS.combat.chargeTime;
export const CHARGE_GRACE = DEFAULTS.combat.chargeGrace;
export const QUICK_RELEASE = DEFAULTS.combat.quickRelease;
export const CHARGE_HEAVY = DEFAULTS.combat.chargeHeavy;
export const CHARGED_MIN = DEFAULTS.combat.chargedMin;
export const CHARGE_DMG = DEFAULTS.combat.chargeDmg;
export const CHARGE_SEVER = DEFAULTS.combat.chargeSever;
export const CHARGE_STAMINA = DEFAULTS.combat.chargeStamina;
export const FLICK_MIN = DEFAULTS.combat.flickMin;
export const FLICK_DOM = DEFAULTS.combat.flickDom;

// Dominant mouse flick -> attack type. movementY positive = pulled DOWN.
// dx > 0 (flick left-to-right) = slashR (arc from the player's right to left).
// Returns null when there is no clear flick (neutral = combo's current side).
export function pickDir(dx, dy) {
  const fmin = CFG.combat.flickMin, fdom = CFG.combat.flickDom;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax >= fmin && ax >= ay * fdom) return dx > 0 ? 'slashR' : 'slashL';
  if (ay >= fmin && ay >= ax * fdom) return dy > 0 ? 'overhead' : 'stab';
  return null;
}

export function chargeDmgMult(charge) { return 1 + CFG.combat.chargeDmg * charge; }
export function chargeSeverBonus(charge) { return CFG.combat.chargeSever * charge; }

// Sweep geometry per attack family (generous on purpose — easy to land):
//  lat: lateral (off-ray) tolerance added to the part radius
//  yMin/yMax: vertical window of the arc relative to the camera
//  rangeBonus: extra reach
//  aimBoost: aim-ray radius multiplier for the listed parts
// Static default export for tests; live reads use liveSweepGeo().
export const SWEEP_GEO = {
  horizontal: { lat: 0.42, yMin: -1.3, yMax: 1.3, rangeBonus: 0,    aimBoost: {} },
  overhead:   { lat: 0.30, yMin: -1.9, yMax: 0.9, rangeBonus: 0.1,  aimBoost: { head: 1.4 } },
  stab:       { lat: 0.22, yMin: -1.0, yMax: 1.0, rangeBonus: 0.45, aimBoost: { head: 1.3, torso: 1.3 } },
};
export function sweepFamily(dir) {
  return dir === 'overhead' ? 'overhead' : dir === 'stab' ? 'stab' : 'horizontal';
}

// Live sweep geometry from CFG (aimHead/aimTorso map onto the old aimBoost).
export function liveSweepGeo(fam) {
  const sg = CFG.sweep[fam] || CFG.sweep.horizontal;
  return {
    lat: sg.lat, yMin: sg.yMin, yMax: sg.yMax, rangeBonus: sg.rangeBonus,
    aimBoost: { head: sg.aimHead, torso: sg.aimTorso },
  };
}

// ---- combo chains (light attacks only) ----
export const COMBO_RESET = DEFAULTS.combat.comboReset;
export const COMBO_MAX = 3;
export const COMBO3_DMG_MULT = DEFAULTS.combat.combo3DmgMult;
export const COMBO3_ARC_BONUS = DEFAULTS.combat.combo3ArcBonus;

// Next combo stage (1-based) given the stage of the previous swing (0 = none)
// and seconds since that swing ended.
export function comboNextStage(prevStage, idleT) {
  if (prevStage < 1 || idleT > CFG.combat.comboReset) return 1;
  return Math.min(COMBO_MAX, prevStage + 1);
}

// ---- execution ----
export const EXECUTE_STAGGER_MIN = DEFAULTS.combat.executeStaggerMin;
export const EXECUTE_DMG_MULT = DEFAULTS.combat.executeDmgMult;
export const EXECUTE_SLOWMO_SCALE = DEFAULTS.combat.executeSlowmoScale;
export const EXECUTE_SLOWMO_T = DEFAULTS.combat.executeSlowmoT;
export const DECAP_SLOWMO_SCALE = DEFAULTS.combat.decapSlowmoScale;
export const DECAP_SLOWMO_T = DEFAULTS.combat.decapSlowmoT;
export const PARRY_SLOWMO_T = DEFAULTS.combat.parrySlowmoT;

export function isExecutable(enemy) {
  return !enemy.dead && enemy.staggerT >= CFG.combat.executeStaggerMin;
}

// ---- kick ----
export const KICK_COST = DEFAULTS.combat.kickCost;
export const KICK_RANGE = DEFAULTS.combat.kickRange;
export const KICK_DMG = DEFAULTS.combat.kickDmg;
export const KICK_STAGGER = DEFAULTS.combat.kickStagger;

// ---- wounds ----
export const WOUND_FRAC = DEFAULTS.combat.woundFrac;

export function isWounded(part) {
  return part.state === 'intact' && part.hp < part.maxHp * CFG.combat.woundFrac;
}

// ---- gore / juice thresholds ----
export const GIB_OVERKILL_DMG = DEFAULTS.combat.gibOverkillDmg;
export const ALLY_FLINCH_RADIUS = DEFAULTS.combat.allyFlinchRadius;
export const ALLY_FLINCH_T = DEFAULTS.combat.allyFlinchT;

// ---- hit-stop scaling ----
export function hitStopFor(dmg, heavy) {
  return Math.min(0.16, 0.03 + dmg * 0.0012 + (heavy ? 0.04 : 0));
}

// ---- Batch 1 contact quality: hit-stop table ----
// ms of world freeze on CONTACT (never on whiff), keyed by weapon + light/
// heavy. Severs ADD severBonus; executions OVERRIDE the per-weapon value;
// grazes scale the result down. Reads CFG.feel.hitstop live (tuning panel);
// DEFAULTS.feel.hitstop is the fallback. main.js's exported HITSTOP_TABLE
// mirrors these defaults for browser-side consumers/tests.
export function hitstopTable() {
  const d = DEFAULTS.feel.hitstop;
  const h = (CFG.feel && CFG.feel.hitstop) || {};
  const r = (k) => h[k] ?? d[k];
  return {
    sword: { light: r('swordLight'), heavy: r('swordHeavy') },
    axe: { light: r('axeLight'), heavy: r('axeHeavy') },
    mace: { light: r('maceLight'), heavy: r('maceHeavy') },
    severBonus: r('severBonus'), execution: r('execution'),
    armorBreak: r('armorBreak'), grazeMult: r('grazeMult'),
  };
}

export function hitstopMs(weaponKey, heavy, { executed = false, severed = false, grazed = false } = {}) {
  const t = hitstopTable();
  if (executed) return t.execution;
  const w = t[weaponKey] || t.sword; // unknown weapons fall back to sword
  const ms = (heavy ? w.heavy : w.light) + (severed ? t.severBonus : 0);
  return grazed ? Math.round(ms * t.grazeMult) : ms;
}

// ---- ambush trigger volumes ----
export function pointInVolume(v, x, z) {
  return x >= v.x1 && x <= v.x2 && z >= v.z1 && z <= v.z2;
}

// ---- attack commitment / interrupts ----
// A swing can only be interrupted during its windup; heavier incoming hits
// are more likely to break it.
export function isInterruptible(phase) { return phase === 'windup'; }
export function interruptChance(incomingDmg) { return incomingDmg >= 20 ? 0.5 : 0.2; }

// ---- glancing blows ----
export const GRAZE_RANGE_FRAC = DEFAULTS.combat.grazeRangeFrac;
export const GRAZE_TARGET_SPEED = DEFAULTS.combat.grazeTargetSpeed;
export const GRAZE_DMG_MULT = DEFAULTS.combat.grazeDmgMult;
export function isGrazed(rangeFrac, targetSpeed) {
  return rangeFrac > CFG.combat.grazeRangeFrac || targetSpeed > CFG.combat.grazeTargetSpeed;
}

// ---- armor zones (knights): torso/helmet deflect light slash & chop ----
export const ARMOR_ZONE_MIN = 0.3; // enemy armor value at which zone rules apply
export const DEFLECT_MULT = DEFAULTS.combat.deflectMult;
export function isArmoredZone(type, partKey) {
  return type.armor >= ARMOR_ZONE_MIN && (partKey === 'torso' || partKey === 'head');
}
export function isDeflected(type, partKey, dtype, heavy, executing, riposte) {
  return isArmoredZone(type, partKey) && dtype !== 'blunt' && !heavy && !executing && !riposte;
}

// ---- bleeding ----
export const BLEED_DPS = DEFAULTS.combat.bleedDps;
export const BLEED_T = DEFAULTS.combat.bleedT;
export const CRAWL_BLEED_DPS = DEFAULTS.combat.crawlBleedDps;
export const BLEED_DRIP_T = DEFAULTS.combat.bleedDripT;

// ---- stamina / block ----
export const BLOCK_CHIP = DEFAULTS.combat.blockChip;
// Stamina bled from the defender per blocked hit (flat + weight of the blow).
export function blockStaminaCost(dmg) {
  return Math.min(CFG.duel.blockStaminaCap, CFG.duel.blockStaminaDmg + dmg * 0.5);
}
export const WHIFF_HEAVY_COST = DEFAULTS.combat.whiffHeavyCost;

// ---- active defense resolution (parry / block / guard break) ----
// Decide what an incoming attack does to a guarding defender. Pure so both
// the player's intake path and headless tests share it.
//   def: { blocking, blockElapsed }  (blockElapsed = s since guard raised)
//   atk: { unparryable }             (boss red-flash heavies)
export function resolveDefense(def, atk = {}) {
  if (!def.blocking) return 'hit';
  if (atk.unparryable) return 'guardbreak'; // no parry, no block — guard smashed
  if (isParry(def.blockElapsed)) return isPerfectParry(def.blockElapsed) ? 'perfect' : 'parry';
  return 'block';
}

// Perfect parry: guard raised within perfectParryWindow of impact
// (narrower sub-window inside the existing parryWindow 0.18s)
export function isPerfectParry(blockElapsed) {
  return blockElapsed >= 0 && blockElapsed <= CFG.combat.perfectParryWindow;
}

// Posture gained by the DEFENDER from a hit. Heavier and blocked/parried
// hits add more. Pure (no THREE) so headless tests share it.
export function postureGain(dmg, weaponKey, heavy, blocked) {
  const base = CFG.combat.postureGainBase * (1 + dmg / 100);
  let g = base * (CFG.weapons[weaponKey]?.postureMult ?? 1);
  if (heavy) g *= CFG.combat.postureHeavyMult;
  if (blocked) g *= CFG.combat.postureBlockMult;
  return g;
}

// Flow multiplier for light-attack direction alternation (combo flow).
export function flowMult(flow) {
  return 1 + CFG.combat.flowStep * Math.min(flow, CFG.combat.flowMax);
}

// ---- morphs ----
// A morph (new flick changing the attack direction) is only allowed during
// the first morphWindow fraction of the charge.
export function canMorph(windupT) {
  return windupT <= CFG.duel.morphWindow * CFG.combat.chargeTime;
}

// ---- chambers ----
// Direction categories must match; horizontal slashes must be MIRRORED
// (slashR vs slashL), overhead meets overhead, stab meets stab.
export function chamberMatch(playerDir, enemyDir) {
  const pf = sweepFamily(playerDir), ef = sweepFamily(enemyDir);
  if (pf !== ef) return false;
  if (pf === 'horizontal') return playerDir !== enemyDir;
  return true;
}

// ---- drags & accels ----
// Which mouse axis drives the timing offset for a given attack direction,
// and which sign means "moving WITH the swing" (= accel, contact sooner).
export function dragAxis(dir) {
  switch (dir) {
    case 'slashR':   return { axis: 'x', sign: 1 };
    case 'slashL':   return { axis: 'x', sign: -1 };
    case 'overhead': return { axis: 'y', sign: 1 };
    case 'stab':     return { axis: 'y', sign: -1 };
    default:         return { axis: 'x', sign: 1 };
  }
}
// Accumulated timing offset, clamped: + = drag (later), - = accel (sooner),
// as a fraction of the swing duration.
export function clampTimingOff(v) {
  return Math.max(-CFG.duel.accelMax, Math.min(CFG.duel.dragMax, v));
}
// Damage multiplier for a swung hit with the given timing offset.
export function timingDmgMult(off) {
  if (off > 0) return 1 + CFG.duel.dragDmgBonus * (off / CFG.duel.dragMax);
  if (off < 0) return 1 - CFG.duel.accelDmgPenalty * (-off / CFG.duel.accelMax);
  return 1;
}
// Active contact window within the swing [startFrac, endFrac]: drags shift it
// late, accels compress it early.
export function timingWindow(off) {
  return [Math.max(0, off), 1 + Math.min(0, off)];
}

// ---- landing ----
export const LAND_LOCK_MIN = 0.15, LAND_LOCK_MAX = 0.35;
export const LAND_THUD_SPEED = DEFAULTS.player.landThudSpeed;
export const FALL_DMG_SPEED = DEFAULTS.player.fallDmgSpeed;
export function landingLock(fallSpeed) {
  if (fallSpeed < CFG.player.landThudSpeed) return 0;
  const k = Math.min(1, (fallSpeed - CFG.player.landThudSpeed) / 8);
  return LAND_LOCK_MIN + (LAND_LOCK_MAX - LAND_LOCK_MIN) * k;
}
export function fallDamage(fallSpeed) {
  return fallSpeed <= CFG.player.fallDmgSpeed ? 0 : Math.round((fallSpeed - CFG.player.fallDmgSpeed) * 3);
}

// ---- domino knockback ----
export const DOMINO_MIN_SPEED = DEFAULTS.combat.dominoMinSpeed;
export const DOMINO_DIST = DEFAULTS.combat.dominoDist;
export const DOMINO_STAGGER = DEFAULTS.combat.dominoStagger;

// ---- ragdoll 2.0: killing-blow-driven corpse launch ----
// Direction & magnitude come from the killing blow: overhead slams down,
// horizontal slashes throw the body, stabs pin it straight back with little
// tumble. Scaled by weapon mass and the swing's charge. Pure (no THREE) so
// both host enemies and client corpse proxies share it — cosmetic only.
export function deathImpulse({
  dirX = 1, dirZ = 0, attackDir = null, weaponKey = 'sword',
  charge = 0, boss = false, executed = false,
} = {}) {
  const r = CFG.ragdoll;
  const mass = weaponKey === 'axe' ? r.massAxe : weaponKey === 'mace' ? r.massMace : r.massSword;
  let horiz = (r.impulseBase + Math.random() * r.impulseRand) * mass * (1 + r.impulseCharge * charge);
  let vy = r.vyBase + Math.random() * r.vyRand;
  let spin = 1;
  if (attackDir === 'overhead') {
    vy *= r.overheadSlam;        // slammed into the ground, barely leaves it
    horiz *= r.overheadFwd;
    spin = 0.6;
  } else if (attackDir === 'stab') {
    horiz *= r.stabPin;          // punched straight back
    vy *= 0.7;
    spin = r.stabSpin;           // pinned bodies skid, they don't cartwheel
  }
  if (boss) horiz += r.bossBonus;
  if (executed) horiz += r.executedBonus;
  return {
    vx: dirX * horiz, vy, vz: dirZ * horiz,
    ax: (Math.random() - 0.5) * 8 * spin,
    ay: (Math.random() - 0.5) * 3 * spin,
    az: (Math.random() - 0.5) * 8 * spin,
  };
}
