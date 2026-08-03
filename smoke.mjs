// Headless smoke test: imports the pure-logic modules, builds the level,
// simulates combat hits on an enemy, and checks the extraction math.
import * as THREE from 'three';
import { WEAPONS, weaponStats, makeWeaponItem, buildViewmodel } from './src/weapons.js';
import { PRESETS, deriveStats, getMeta, addRunRewards } from './src/meta.js';
import { buildLevel } from './src/level.js';
import { Enemy, ENEMY_TYPES } from './src/enemy.js';
import { Gore } from './src/gore.js';
import { LootSystem } from './src/loot.js';
import {
  isParry, isPerfectParry, postureGain, flowMult, comboNextStage, isWounded, isExecutable, hitStopFor, pointInVolume,
  PARRY_WINDOW, RIPOSTE_WINDOW, COMBO_RESET, COMBO_MAX, EXECUTE_STAGGER_MIN,
  PARRY_STAGGER, WOUND_FRAC,
  isInterruptible, interruptChance, isGrazed, isDeflected, DEFLECT_MULT,
  BLEED_DPS, CRAWL_BLEED_DPS, fallDamage, landingLock,
  DOMINO_MIN_SPEED, DOMINO_STAGGER, blockStaminaCost, BLOCK_CHIP,
  pickDir, chargeDmgMult, chargeSeverBonus, sweepFamily, SWEEP_GEO,
  FLICK_MIN, CHARGE_HEAVY,
  resolveDefense, chamberMatch, canMorph,
  dragAxis, clampTimingOff, timingDmgMult, timingWindow,
  hitstopMs, hitstopTable,
} from './src/combat.js';
import { resolveChamber, resolveClash, ARMOR_DEFAULTS, ARMOR_ABSORB } from './src/enemy.js';
import { CFG, DEFAULTS, resetCfg } from './src/config.js';
import { AudioEngine, SWING_WHOOSH_DEFAULTS, MATERIAL_SFX_DEFAULTS } from './src/audio.js';
import { Player, CAMERA_FEEL_DEFAULTS, cameraFeel } from './src/player.js';
import {
  defaultHero, getHero, saveHero, clearHero, totalStats, spentPoints, pointsLeft,
  adjustStat, heroDerived, sanitizeParts, validateHero, slotOptions, currentOption,
  setSlotOption, flipGender, randomizeHero, ARCHETYPES, STAT_POOL, ALLOC_CAP,
} from './src/hero.js';
import { classifyPart, normalizePartName, SLOT_DEFS } from './src/partnames.js';
import { readFileSync, existsSync } from 'fs';

const stubScene = { add() {}, remove() {} };
const realScene = new THREE.Scene();

// --- combat rules (pure logic) ---
if (!isParry(0.05) || !isParry(PARRY_WINDOW)) throw new Error('parry window too tight');
if (isParry(PARRY_WINDOW + 0.01) || isParry(-0.01)) throw new Error('parry window too loose');
if (comboNextStage(0, 99) !== 1) throw new Error('combo should start at 1');
if (comboNextStage(1, 0.4) !== 2 || comboNextStage(2, 0.4) !== 3) throw new Error('combo chain broken');
if (comboNextStage(COMBO_MAX, 0.4) !== COMBO_MAX) throw new Error('combo should cap at max');
if (comboNextStage(2, COMBO_RESET + 0.01) !== 1) throw new Error('combo should reset after idle');
if (!(hitStopFor(50, true) > hitStopFor(10, false))) throw new Error('hit-stop should scale with damage');

// --- realism rules (pure logic) ---
if (!isInterruptible('windup') || isInterruptible('swing')) throw new Error('interrupt phase wrong');
if (interruptChance(10) !== 0.2 || interruptChance(26) !== 0.5) throw new Error('interrupt chance wrong');
if (!isGrazed(0.9, 0) || !isGrazed(0.5, 2.0) || isGrazed(0.5, 0)) throw new Error('graze rule wrong');
if (fallDamage(10) !== 0 || fallDamage(16) <= 0) throw new Error('fall damage wrong');
if (landingLock(8) !== 0 || landingLock(9) < 0.15 || landingLock(30) > 0.36) throw new Error('landing lock wrong');
if (BLOCK_CHIP >= 0.25) throw new Error('block chip should be ~15%');
if (blockStaminaCost(34) <= blockStaminaCost(12)) throw new Error('block cost should scale with hit weight');
if (!isDeflected({ armor: 0.35 }, 'torso', 'slash', false, false, false)) throw new Error('knight torso should deflect light slash');
if (isDeflected({ armor: 0.35 }, 'leftArm', 'slash', false, false, false)) throw new Error('limbs are unarmored');
if (isDeflected({ armor: 0.35 }, 'torso', 'blunt', false, false, false)) throw new Error('blunt ignores deflection');
if (isDeflected({ armor: 0.35 }, 'torso', 'slash', true, false, false)) throw new Error('heavy ignores deflection');

// --- directional charged attacks (pure logic) ---
if (pickDir(FLICK_MIN + 10, 0) !== 'slashR') throw new Error('flick right should be slashR');
if (pickDir(-(FLICK_MIN + 10), 0) !== 'slashL') throw new Error('flick left should be slashL');
if (pickDir(0, FLICK_MIN + 10) !== 'overhead') throw new Error('flick down should be overhead');
if (pickDir(0, -(FLICK_MIN + 10)) !== 'stab') throw new Error('flick up should be stab');
if (pickDir(FLICK_MIN - 2, FLICK_MIN - 2) !== null) throw new Error('weak flick should be neutral');
if (pickDir(FLICK_MIN + 5, FLICK_MIN + 5) !== null) throw new Error('ambiguous diagonal should be neutral');
if (chargeDmgMult(0) !== 1 || chargeDmgMult(1) <= 1.5) throw new Error('charge dmg scaling wrong');
if (chargeSeverBonus(0) !== 0 || chargeSeverBonus(1) <= 0.2) throw new Error('charge sever scaling wrong');
if (sweepFamily('slashR') !== 'horizontal' || sweepFamily('overhead') !== 'overhead' ||
    sweepFamily('stab') !== 'stab' || sweepFamily(null) !== 'horizontal') throw new Error('sweep family wrong');
if (!(SWEEP_GEO.stab.rangeBonus > 0 && SWEEP_GEO.horizontal.lat > SWEEP_GEO.stab.lat)) {
  throw new Error('sweep geometry tuning wrong');
}
if (CHARGE_HEAVY <= 0 || CHARGE_HEAVY >= 1) throw new Error('charge heavy threshold wrong');

// --- duel mechanics (pure logic) ---
// defense resolution: parry / block / guard break / clean hit
if (resolveDefense({ blocking: false, blockElapsed: 0 }) !== 'hit') throw new Error('unguarded should be a hit');
if (resolveDefense({ blocking: true, blockElapsed: 0.05 }) !== 'perfect') throw new Error('fresh guard (<=perfectParryWindow) should perfect-parry');
if (resolveDefense({ blocking: true, blockElapsed: 0.15 }) !== 'parry') throw new Error('mid-window guard should parry');
if (resolveDefense({ blocking: true, blockElapsed: PARRY_WINDOW + 0.1 }) !== 'block') throw new Error('old guard should only block');
if (resolveDefense({ blocking: true, blockElapsed: 0.05 }, { unparryable: true }) !== 'guardbreak') {
  throw new Error('unparryable vs guard should guard-break');
}
if (resolveDefense({ blocking: false, blockElapsed: 0 }, { unparryable: true }) !== 'hit') {
  throw new Error('unparryable vs no guard should be a hit');
}
// block stamina: flat base from CFG.duel + scales with the blow, capped
if (blockStaminaCost(0) !== CFG.duel.blockStaminaDmg) throw new Error('block stamina base wrong');
if (blockStaminaCost(1000) !== CFG.duel.blockStaminaCap) throw new Error('block stamina cap wrong');
// chamber direction matching: same family, horizontals must be mirrored
if (!chamberMatch('slashR', 'slashL') || !chamberMatch('slashL', 'slashR')) throw new Error('mirrored slashes should chamber');
if (chamberMatch('slashR', 'slashR')) throw new Error('same-side slashes should not chamber');
if (!chamberMatch('overhead', 'overhead') || !chamberMatch('stab', 'stab')) throw new Error('overhead/stab should chamber themselves');
if (chamberMatch('stab', 'overhead') || chamberMatch('slashR', 'stab')) throw new Error('mixed families should not chamber');
// morph window: only early in the charge
if (!canMorph(0.1) || canMorph(CFG.combat.chargeTime)) throw new Error('morph window wrong');
// drags & accels: axis mapping, clamping, damage, contact window
if (dragAxis('slashR').axis !== 'x' || dragAxis('slashR').sign !== 1) throw new Error('slashR drag axis wrong');
if (dragAxis('slashL').sign !== -1 || dragAxis('overhead').axis !== 'y' || dragAxis('stab').sign !== -1) {
  throw new Error('drag axis signs wrong');
}
if (clampTimingOff(9) !== CFG.duel.dragMax || clampTimingOff(-9) !== -CFG.duel.accelMax) throw new Error('timing clamp wrong');
if (timingDmgMult(0) !== 1) throw new Error('neutral timing should be 1x dmg');
if (Math.abs(timingDmgMult(CFG.duel.dragMax) - (1 + CFG.duel.dragDmgBonus)) > 1e-9) throw new Error('drag dmg bonus wrong');
if (Math.abs(timingDmgMult(-CFG.duel.accelMax) - (1 - CFG.duel.accelDmgPenalty)) > 1e-9) throw new Error('accel dmg penalty wrong');
{
  const [s0, e0] = timingWindow(0);
  if (s0 !== 0 || e0 !== 1) throw new Error('neutral timing window wrong');
  const [sd, ed] = timingWindow(0.2);
  if (sd !== 0.2 || ed !== 1) throw new Error('drag shifts the contact window late');
  const [sa, ea] = timingWindow(-0.2);
  if (sa !== 0 || ea !== 0.8) throw new Error('accel compresses the contact window early');
}

// --- Batch 2 (duel depth) pure-logic gates ---
if (!isPerfectParry(0.05) || isPerfectParry(0.15) || isPerfectParry(0.20)) {
  throw new Error('perfect-parry sub-window (<=perfectParryWindow) wrong');
}
// perfect/parry/block ordering through resolveDefense
if (resolveDefense({ blocking: true, blockElapsed: 0.05 }) !== 'perfect') throw new Error('0.05 should perfect');
if (resolveDefense({ blocking: true, blockElapsed: 0.15 }) !== 'parry') throw new Error('0.15 should parry');
if (resolveDefense({ blocking: true, blockElapsed: PARRY_WINDOW + 0.1 }) !== 'block') throw new Error('late should block');
if (resolveDefense({ blocking: true, blockElapsed: 0.05 }, { unparryable: true }) !== 'guardbreak') {
  throw new Error('unparryable should guard-break even in perfect window');
}
// posture gain: heavier & blocked add more, unknown weapon defaults to mult 1
const pgLight = postureGain(22, 'sword', false, false);
if (!(pgLight > 0)) throw new Error('postureGain base wrong');
if (!(postureGain(22, 'sword', true, false) > pgLight)) throw new Error('heavy should add posture');
if (!(postureGain(22, 'sword', false, true) > pgLight)) throw new Error('blocked should add posture');
if (Math.abs(postureGain(22, 'bogus', false, false) - pgLight) > 1e-9) throw new Error('unknown weapon postureMult should be 1');
// flow multiplier: alternating directions reward, clamped at flowMax
if (Math.abs(flowMult(0) - 1) > 1e-9) throw new Error('flowMult(0) should be 1');
if (Math.abs(flowMult(CFG.combat.flowMax) - (1 + CFG.combat.flowStep * CFG.combat.flowMax)) > 1e-9) {
  throw new Error('flowMult(flowMax) wrong');
}
if (Math.abs(flowMult(CFG.combat.flowMax + 5) - (1 + CFG.combat.flowStep * CFG.combat.flowMax)) > 1e-9) {
  throw new Error('flowMult should clamp at flowMax');
}
// CFG keys present (panel will surface them)
for (const k of ['perfectParryWindow', 'postureGainBase', 'postureHeavyMult', 'postureBlockMult',
  'flowStep', 'flowMax', 'wallSplatDist', 'wallSplatStagger', 'dodgeCost', 'dodgeIframeT', 'dodgeCd']) {
  if (CFG.combat[k] === undefined) throw new Error('missing Batch 2 CFG.combat key: ' + k);
}
for (const t of ['knight', 'bandit', 'skeleton']) {
  if (CFG.enemies[t].postureMax === undefined) throw new Error('missing postureMax for ' + t);
}
if (CFG.enemies.bossPostureMax === undefined) throw new Error('missing bossPostureMax');

// --- weapons / meta ---
for (const k of Object.keys(WEAPONS)) {
  const s = weaponStats(makeWeaponItem(k, 'rare'));
  if (!s.damage || !s.sever) throw new Error('weapon stats broken: ' + k);
  buildViewmodel(k); // viewmodel builds without error
}
const stats = deriveStats(PRESETS.knight.stats, PRESETS.knight.armor);
if (stats.maxHp !== 165) throw new Error('deriveStats wrong: ' + stats.maxHp);

// --- level ---
const level = buildLevel(realScene);
if (level.colliders.length < 400) throw new Error('too few colliders: ' + level.colliders.length);
if (level.floors.length < 100) throw new Error('too few floors: ' + level.floors.length);
if (level.floorHeightAt(-24, 0, 1) !== 0) throw new Error('spawn floor wrong');
if (level.floorHeightAt(16.25, -11.25, -5) !== -6) throw new Error('labyrinth floor wrong');
if (level.floorHeightAt(20, -8.75, 3) !== 3) throw new Error('balcony floor wrong');
if (level.floorHeightAt(11.25, 5.25, 0) !== -0.3) throw new Error('stair step floor wrong');
if (level.torches.length < 20) throw new Error('too few torches: ' + level.torches.length);
if (!Array.isArray(level.wispPath) || level.wispPath.length < 10) throw new Error('wisp path missing');
if (level.enemySpawns.length < 15) throw new Error('too few enemy spawns: ' + level.enemySpawns.length);
if (level.lootSpawns.length < 18) throw new Error('too few loot spawns: ' + level.lootSpawns.length);
// gate collider active, extraction pos inside the gate room
if (!level.gate.collider.active) throw new Error('gate collider inactive');
if (level.floorHeightAt(level.extractPos.x, level.extractPos.z, -5) !== -6) throw new Error('extract floor wrong');

// --- fake game + enemy combat simulation ---
const audioStub = new Proxy({}, { get: () => () => {} });
const game = {
  scene: realScene, level,
  camera: new THREE.PerspectiveCamera(72, 1, 0.05, 100),
  enemies: [],
  state: 'run',
  time: 0,
  notify() {}, uiDamageFlash() {},
  debugLine(t) { (this._dbg ||= []).push(t); },
  sparks: {
    bursts: [],
    burst(pos, n, tint) { this.bursts.push(tint || 'white'); },
    update() {}, reset() {},
  },
  gore: new Gore(realScene, level),
  loot: null,
  audio: audioStub,
  player: {
    pos: new THREE.Vector3(0, 0, 0), dead: false, yaw: 0,
    blocking: false, guardBreakT: 0,
    attack: { phase: 'idle', heavy: false },
    stamina: 100, stats: { maxStamina: 100 },
    riposteUntil: -99,
  },
  damagePlayer() { this._dmg = (this._dmg || 0) + 1; },
  onEnemyKilled(e) { this._kills = (this._kills || 0) + 1; },
  onExecution() { this._execs = (this._execs || 0) + 1; },
  onDecapitation() { this._decapPops = (this._decapPops || 0) + 1; },
  onGib() { this._gibPops = (this._gibPops || 0) + 1; },
  decapSlowmo() { this._decapSlowmos = (this._decapSlowmos || 0) + 1; },
  // mirrors main.js: ms of freeze, max-wins, stored as seconds
  hitStop: 0,
  hitstop(ms) { if (ms > 0) this.hitStop = Math.max(this.hitStop, ms / 1000); },
  // mirrors main.js: armor-break hook (dedupe lives in main; tests count calls)
  onArmorBreak(e, part, pos) { (this._armorBreaks ||= []).push(part); },
  shake: 0,
};
game.loot = new LootSystem(realScene, game);

const bandit = new Enemy(game, { type: 'bandit', x: -2, z: -2 });
const knight = new Enemy(game, { type: 'knight', x: 2, z: -3, boss: true });
game.enemies.push(bandit, knight);

// simulate frames: enemy should aggro & chase
for (let i = 0; i < 120; i++) bandit.update(1 / 60);
if (!bandit.aggro) throw new Error('bandit never aggroed');

// hit the head with an axe until something happens
const srcPos = new THREE.Vector3(-1, 1, -1);
let result = null;
for (let i = 0; i < 30 && !bandit.dead; i++) {
  result = bandit.takeHit('head', 40, 'chop', weaponStats('axe'), true, srcPos);
}
if (!bandit.dead) throw new Error('bandit did not die from head hits');

// leg destruction -> crawl, both legs -> death
const legTest = new Enemy(game, { type: 'skeleton', x: 3, z: -2 });
legTest.takeHit('leftLeg', 500, 'blunt', weaponStats('mace'), false, srcPos);
if (!legTest.crawl) throw new Error('skeleton did not crawl after leg destroyed');
legTest.takeHit('rightLeg', 500, 'blunt', weaponStats('mace'), false, srcPos);
if (!legTest.dead) throw new Error('skeleton did not die after both legs destroyed');

// arm destruction reduces damage output
if (bandit.parts.head.state === 'intact') throw new Error('head should be gone');

// knight armor reduces slash but not blunt
const k1 = new Enemy(game, { type: 'knight', x: 4, z: 2 });
const hpBefore = k1.parts.torso.hp;
k1.takeHit('torso', 30, 'slash', weaponStats('sword'), false, srcPos);
const slashDmg = hpBefore - k1.parts.torso.hp;
const hpBefore2 = k1.parts.torso.hp;
k1.takeHit('torso', 30, 'blunt', weaponStats('mace'), false, srcPos);
const bluntDmg = hpBefore2 - k1.parts.torso.hp;
if (!(bluntDmg > slashDmg)) throw new Error(`armor logic wrong: slash=${slashDmg} blunt=${bluntDmg}`);

// gore sim + loot spawn
game.gore.update(1 / 60);
game.loot.spawnWorldLoot(level.lootSpawns);
if (game.loot.entries.length !== level.lootSpawns.length) throw new Error('loot spawn mismatch');
game.loot.update(1 / 60);

// --- wound states: part under 50% HP becomes wounded + tinted ---
const woundTest = new Enemy(game, { type: 'bandit', x: 2, z: 1 });
const arm = woundTest.parts.leftArm;
woundTest.takeHit('leftArm', Math.floor(arm.maxHp * 0.6), 'slash', weaponStats('sword'), false, srcPos);
if (!isWounded(arm)) throw new Error('arm should be wounded below 50% HP');
if (!arm.wounded || arm.mesh.material.color.getHex() === 0x5a6a34) throw new Error('wound tint not applied');

// --- parry: long stagger makes the enemy executable ---
const parryTest = new Enemy(game, { type: 'knight', x: 3, z: 1 });
parryTest.applyParry();
if (parryTest.staggerT < EXECUTE_STAGGER_MIN) throw new Error('parry stagger too short');
if (!isExecutable(parryTest)) throw new Error('parried enemy should be executable');
// parry drains the ATTACKER's stamina (the stamina war cuts both ways)
if (parryTest.stamina !== CFG.duel.enemyStamina - CFG.duel.parryStaminaDmg) {
  throw new Error('parry should drain attacker stamina: ' + parryTest.stamina);
}
const torsoBefore = parryTest.parts.torso.hp;
game.time = 10; game.player.riposteUntil = 10 + RIPOSTE_WINDOW; // active riposte window
const rres = parryTest.takeHit('torso', 20, 'slash', weaponStats('sword'), false, srcPos,
  { riposteMult: 2, severBonus: 0.6 });
if (game.player.riposteUntil > 0) throw new Error('riposte window should be consumed');
if (torsoBefore - parryTest.parts.torso.hp <= 20 * (1 - 0.35)) throw new Error('riposte crit not applied');

// --- kick: stagger + breaks block, costs nothing headless ---
const kickTest = new Enemy(game, { type: 'knight', x: 4, z: 0 });
kickTest.state = 'block'; kickTest.blockT = 1.1;
kickTest.applyKick(6, game.player.pos);
if (kickTest.staggerT < EXECUTE_STAGGER_MIN) throw new Error('kick stagger too short');
if (kickTest.blockT !== 0) throw new Error('kick should break block');

// --- armor zones: knight torso deflects light slash, limbs take full damage ---
const deflTest = new Enemy(game, { type: 'knight', x: 5, z: 2 });
const dt0 = deflTest.parts.torso.hp;
const dres = deflTest.takeHit('torso', 30, 'slash', weaponStats('sword'), false, srcPos);
if (!dres.deflected) throw new Error('light slash on knight torso should deflect');
if (dt0 - deflTest.parts.torso.hp !== Math.round(30 * DEFLECT_MULT)) throw new Error('deflect damage wrong');
const da0 = deflTest.parts.leftArm.hp;
deflTest.takeHit('leftArm', 30, 'slash', weaponStats('sword'), false, srcPos);
if (da0 - deflTest.parts.leftArm.hp !== 30) throw new Error('limb should take full damage');
// heavy slash vs intact plate: armor soaks CFG.armor.absorbSlash of the blow
// (0.6) and the pool wears 1:1 — fresh knight torso: 30 -> 12 flesh, 90 -> 60
const dh0 = deflTest.parts.torso.hp;
const hres = deflTest.takeHit('torso', 30, 'slash', weaponStats('sword'), true, srcPos);
if (hres.deflected) throw new Error('heavy should not deflect');
if (hres.absorbed !== Math.round(30 * CFG.armor.absorbSlash)) {
  throw new Error('heavy slash absorb wrong: ' + hres.absorbed);
}
if (dh0 - deflTest.parts.torso.hp !== Math.round(30 * (1 - CFG.armor.absorbSlash))) {
  throw new Error('heavy vs armor wrong');
}
if (deflTest.armorAt('torso') !== CFG.armor.knightTorso - 30) {
  throw new Error('armor pool should wear 1:1 vs slash: ' + deflTest.armorAt('torso'));
}

// --- bleed DoT: a severed limb bleeds ~2 HP/s for 6s ---
const bleedTest = new Enemy(game, { type: 'bandit', x: -3, z: 1 });
game.enemies.push(bleedTest);
bleedTest._destroyPart(bleedTest.parts.leftArm, 'chop', weaponStats('axe'), true,
  new THREE.Vector3(1, 0, 0), 10);
if (bleedTest.bleeds.length !== 1) throw new Error('severed arm should bleed');
const bhp = bleedTest.parts.torso.hp;
for (let i = 0; i < 120 && !bleedTest.dead; i++) bleedTest.update(1 / 60); // 2s of bleeding
const bled = bhp - bleedTest.parts.torso.hp;
if (bled < BLEED_DPS * 2 - 1.5 || bled > BLEED_DPS * 2 + 1.5) throw new Error('bleed rate wrong: ' + bled);

// --- domino knockback: a flying body staggers the one it crashes into ---
const d1 = new Enemy(game, { type: 'bandit', x: 6, z: 4 });
const d2 = new Enemy(game, { type: 'bandit', x: 6.7, z: 4 });
game.enemies.push(d1, d2);
d1.knock.set(3, 0, 0);
d1.update(1 / 60);
if (d2.staggerT < DOMINO_STAGGER - 0.01) throw new Error('domino knockback failed');

// --- execution: heavy attack on a long-staggered enemy forces a sever ---
const execTest = new Enemy(game, { type: 'bandit', x: 3, z: 3 });
game.enemies.push(execTest);
execTest.applyParry();
const execRes = execTest.takeHit('leftArm', 10, 'chop', weaponStats('axe'), true, srcPos);
if (!execRes.executed || !game._execs) throw new Error('execution not triggered');
if (execTest.parts.leftArm.state !== 'severed') throw new Error('execution should force a sever');

// --- boss phase 2 at 50% torso HP ---
const bossTest = new Enemy(game, { type: 'knight', x: 2, z: -4, boss: true });
bossTest.parts.torso.hp = bossTest.parts.torso.maxHp * 0.4;
game.enemies.push(bossTest);
bossTest.update(1 / 60);
if (bossTest.bossPhase !== 2 || bossTest.type.canBlock) throw new Error('boss phase 2 not triggered');

// --- ambush trigger volumes exist and trigger on the player position ---
if (!Array.isArray(level.ambushVolumes) || level.ambushVolumes.length < 3) throw new Error('ambush volumes missing');
const v0 = level.ambushVolumes[0];
if (!pointInVolume(v0, (v0.x1 + v0.x2) / 2, (v0.z1 + v0.z2) / 2)) throw new Error('pointInVolume center false');
if (pointInVolume(v0, v0.x1 - 1, v0.z1 - 1)) throw new Error('pointInVolume outside true');

// --- decapitation spectacle: forced sever triggers slow-mo + ally flinch ---
const decapVictim = new Enemy(game, { type: 'bandit', x: 1, z: 2 });
const decapWitness = new Enemy(game, { type: 'bandit', x: 3, z: 2 });
game.enemies.push(decapVictim, decapWitness);
decapVictim._destroyPart(decapVictim.parts.head, 'chop', weaponStats('axe'), true,
  new THREE.Vector3(1, 0, 0), 10); // severBonus 10 = guaranteed sever
if (!game._decapSlowmos) throw new Error('no decapitation slow-mo triggered');
if (decapWitness.flinchT <= 0) throw new Error('nearby ally did not flinch at decapitation');
if (!decapVictim.dead) throw new Error('decapitated enemy should be dead');

// enemy AI runs a full strike cycle without errors near the player
const skel = new Enemy(game, { type: 'skeleton', x: 0.5, z: -2.5 });
game.enemies.push(skel);
for (let i = 0; i < 600; i++) { skel.update(1 / 60); knight.update(1 / 60); game.gore.update(1 / 60); }
if (game._dmg < 1) throw new Error('enemy never landed a hit on the player');

// --- training room: exists, and dummies take damage but never act ---
if (!level.training || !Array.isArray(level.training.dummySpawns) ||
    level.training.dummySpawns.length < 3) throw new Error('training room missing');
const tsp = level.training.dummySpawns[0];
const dummy = new Enemy(game, { ...tsp, dummy: true });
game.enemies.push(dummy);
const dmgBefore = game._dmg;
const dPos = dummy.pos.clone();
for (let i = 0; i < 300; i++) dummy.update(1 / 60); // 5 s of AI time
if (dummy.pos.distanceTo(dPos) > 0.01) throw new Error('training dummy moved');
if (dummy.state !== 'idle') throw new Error('training dummy left idle: ' + dummy.state);
if (game._dmg !== dmgBefore) throw new Error('training dummy attacked the player');
// dummies still take full combat/gore damage (sever, death, ragdoll launch)
const dummRes = dummy.takeHit('head', 500, 'chop', weaponStats('axe'), true, srcPos,
  { dir: 'overhead', charge: 1 });
if (!dummy.dead) throw new Error('training dummy did not die from a massive head hit');
if (!dummy.ragdoll) throw new Error('training dummy death produced no ragdoll');
for (let i = 0; i < 120; i++) { dummy.update(1 / 60); game.gore.update(1 / 60); }

// ================= duel mechanics: integration =================

// --- ENEMY PARRY: a knight whose guard was raised inside the parry window
// turns the blow aside entirely (no damage) and looks for a punish ---
{
  game.player.riposteUntil = -99;
  const kp = new Enemy(game, { type: 'knight', x: 4, z: -4 });
  game.enemies.push(kp);
  kp.state = 'block'; kp.blockT = 1; kp.parryUntil = game.time + 1;
  const hp0 = kp.parts.torso.hp;
  const pres = kp.takeHit('torso', 30, 'slash', weaponStats('sword'), false, srcPos);
  if (!pres.parried) throw new Error('knight active parry not detected');
  if (kp.parts.torso.hp !== hp0) throw new Error('parried blow should deal no damage');
  if (kp.cooldownT > 0.15) throw new Error('parrying knight should seek an immediate punish');
  if (!game.sparks.bursts.includes('white')) throw new Error('parry should burst white sparks');
}

// --- GUARD BREAK (enemy): blocked hits bleed stamina; at zero the guard
// breaks into a long stagger ---
{
  const gb = new Enemy(game, { type: 'knight', x: 6, z: -4 });
  game.enemies.push(gb);
  gb.state = 'block'; gb.blockT = 1; gb.parryUntil = -99; gb.stamina = 5;
  gb.takeHit('torso', 30, 'blunt', weaponStats('mace'), false, srcPos);
  if (!gb.guardBroken) throw new Error('guard break not flagged');
  if (gb.state !== 'stagger' || gb.blockT !== 0) throw new Error('guard break should drop the guard into a stagger');
  if (gb.staggerT < CFG.duel.guardBreakStagger - 0.01) throw new Error('guard break stagger too short');
}

// --- CHAMBER: a mirrored swing started just before the enemy's blow lands
// cancels it — no damage, gold sparks, quick recovery for both ---
{
  // ISOLATION (flake fix): resolveChamber scans game.enemies in order and the
  // accumulated cast — notably the Gate Warden boss, whose heavies are always
  // overheads and who stands inside chamber range of the stub player — could
  // steal the resolution whenever its windup RNG lands in the window. Clear
  // the roster so ONLY the intended enemy can chamber; every later block
  // spawns its own enemies, so nothing after this depends on the old cast.
  game.enemies.length = 0;
  const ce = new Enemy(game, { type: 'skeleton', x: 1, z: -2 });
  game.enemies.push(ce);
  ce.aggro = true;
  for (let i = 0; i < 200 && ce.state !== 'windup'; i++) ce.update(1 / 60);
  if (ce.state !== 'windup') throw new Error('chamber test: skeleton never wound up');
  ce.atkDir = 'overhead';
  ce.stateT = ce.type.windup - 0.05; // blow lands in 50ms — inside the window
  game.player.attack = { phase: 'swing', dir: 'overhead', heavy: false, swingStart: game.time, hitSet: new Set() };
  const dmg0 = game._dmg;
  const chambered = resolveChamber(game, game.player);
  if (chambered !== ce) throw new Error('chamber did not trigger on a mirrored overhead');
  if (!ce.strikeCanceled || ce.state === 'windup') throw new Error('chambered enemy should be knocked out of its attack');
  if (!game.sparks.bursts.includes('gold')) throw new Error('chamber should burst gold sparks');
  for (let i = 0; i < 30; i++) ce.update(1 / 60);
  if (game._dmg !== dmg0) throw new Error('chambered blow should deal no damage');
  // wrong direction = no chamber
  const ce2 = new Enemy(game, { type: 'skeleton', x: 1, z: -2 });
  game.enemies.push(ce2);
  ce2.state = 'windup'; ce2.stateT = ce2.type.windup - 0.05; ce2.atkDir = 'slashR';
  game.player.attack = { phase: 'swing', dir: 'overhead', heavy: false, swingStart: game.time, hitSet: new Set() };
  if (resolveChamber(game, game.player)) throw new Error('mismatched directions should not chamber');
  game.player.attack = { phase: 'idle', heavy: false };
}

// --- WEAPON CLASH mid-swing: both blades live, facing each other — both
// recover, the enemy's pending blow is canceled ---
{
  const cl = new Enemy(game, { type: 'bandit', x: 1, z: -2 });
  game.enemies.push(cl);
  cl.state = 'strike'; cl.stateT = 0.02; cl.contactDone = false;
  cl.strikeCanceled = false; cl.atkDir = 'slashL'; cl.yaw = -Math.PI / 2; // facing the player
  game.player.yaw = -Math.PI / 2; // player faces +X, toward the enemy
  game.player.attack = { phase: 'swing', dir: 'slashR', heavy: false, swingStart: game.time - 5, timingOff: 0, clashed: false, hitSet: new Set() };
  const dmg0 = game._dmg;
  const clashed = resolveClash(game, game.player);
  if (clashed !== cl) throw new Error('clash did not trigger');
  if (game.player.attack.phase !== 'recover' || !game.player.attack.clashed) throw new Error('clash should bounce the player into recovery');
  if (!cl.strikeCanceled) throw new Error('clash should cancel the enemy blow');
  if (!game.sparks.bursts.includes('orange')) throw new Error('clash should burst orange sparks');
  for (let i = 0; i < 30; i++) cl.update(1 / 60);
  if (game._dmg !== dmg0) throw new Error('clashed blow should deal no damage');
  // second call is a no-op (already clashed this swing)
  if (resolveClash(game, game.player)) throw new Error('clash should only resolve once per swing');
  game.player.attack = { phase: 'idle', heavy: false };
  game.player.yaw = 0;
}

// --- KNIGHT AI: parryChance scales with the player's charge — a fully
// charged held swing ALWAYS gets parried (CFG forced to 1) ---
{
  CFG.enemies.knight.parryChance = 1;
  const ka = new Enemy(game, { type: 'knight', x: 1, z: -2 });
  ka.aggro = true;
  game.enemies.push(ka);
  game.player.attack = { phase: 'swing', heavy: true, charge: 1 };
  ka.update(1 / 60);
  if (ka.state !== 'block' || ka.parryUntil <= game.time) throw new Error('knight failed to parry a held charge');
  game.player.attack = { phase: 'idle', heavy: false, charge: 0 };
}

// --- BANDIT AI: feints constantly (CFG forced to 1) — the windup chokes off
// before the blow and the bandit re-attacks ---
{
  CFG.enemies.bandit.feintChance = 1;
  const fb = new Enemy(game, { type: 'bandit', x: 1, z: -2 });
  fb.aggro = true;
  game.enemies.push(fb);
  for (let i = 0; i < 300 && fb.feints === 0; i++) fb.update(1 / 60);
  if (fb.feints === 0) throw new Error('bandit never feinted');
  if (fb.state === 'windup') throw new Error('feint should cancel the windup');
}

// --- BOSS: red-flash heavies are flagged unparryable at windup start ---
{
  const bb = new Enemy(game, { type: 'knight', x: 1.5, z: -2, boss: true });
  bb.aggro = true;
  game.enemies.push(bb);
  for (let i = 0; i < 300 && bb.state !== 'windup'; i++) bb.update(1 / 60);
  if (bb.state !== 'windup') throw new Error('boss never wound up');
  if (bb.atkUnparryable !== true) throw new Error('boss heavy should be unparryable');
  if (bb.atkDir !== 'overhead') throw new Error('boss heavy should be an overhead');
}

resetCfg(); // restore tuning defaults for anything that runs after

// ================= Batch 1 — contact quality =================

// --- CFG mirrors: the feel + armor groups exist and track the landed consts ---
if (CFG.armor.knightTorso !== ARMOR_DEFAULTS.knight.torso ||
    CFG.armor.knightHead !== ARMOR_DEFAULTS.knight.head ||
    CFG.armor.bossTorso !== ARMOR_DEFAULTS.boss.torso ||
    CFG.armor.bossLimb !== ARMOR_DEFAULTS.boss.armL) {
  throw new Error('CFG.armor pools do not mirror ARMOR_DEFAULTS');
}
if (CFG.armor.absorbSlash !== ARMOR_ABSORB.slash || CFG.armor.absorbPierce !== ARMOR_ABSORB.pierce ||
    CFG.armor.absorbChop !== ARMOR_ABSORB.chop || CFG.armor.absorbBlunt !== ARMOR_ABSORB.blunt) {
  throw new Error('CFG.armor absorb does not mirror ARMOR_ABSORB');
}
if (ARMOR_ABSORB.slash !== 0.6 || ARMOR_ABSORB.pierce !== 0.5 ||
    ARMOR_ABSORB.chop !== 0.4 || ARMOR_ABSORB.blunt !== 0.2) {
  throw new Error('armor absorb should be at DESIGN values (slash .6/pierce .5/chop .4/blunt .2)');
}
if (CFG.armor.bluntPoolMult !== 1.6) throw new Error('blunt pool mult should be 1.6');
if (CFG.feel.camKick.yaw !== CAMERA_FEEL_DEFAULTS.camKick.yaw ||
    CFG.feel.camKick.recover !== CAMERA_FEEL_DEFAULTS.camKick.recover ||
    CFG.feel.fovPunch.heavyHit !== CAMERA_FEEL_DEFAULTS.fovPunch.heavyHit ||
    CFG.feel.fovPunch.max !== CAMERA_FEEL_DEFAULTS.fovPunch.max) {
  throw new Error('CFG.feel does not mirror CAMERA_FEEL_DEFAULTS');
}
if (CFG.feel.whoosh.freqBase !== SWING_WHOOSH_DEFAULTS.freqBase ||
    CFG.feel.whoosh.freqCharge !== SWING_WHOOSH_DEFAULTS.freqCharge ||
    CFG.feel.whoosh.gainBase !== SWING_WHOOSH_DEFAULTS.gainBase ||
    CFG.feel.whoosh.gainCharge !== SWING_WHOOSH_DEFAULTS.gainCharge ||
    CFG.feel.whoosh.dragPitchDrop !== SWING_WHOOSH_DEFAULTS.dragPitchDrop ||
    CFG.feel.whoosh.whistleAt !== SWING_WHOOSH_DEFAULTS.whistleAt) {
  throw new Error('CFG.feel.whoosh does not mirror SWING_WHOOSH_DEFAULTS');
}
game.player.riposteUntil = -99; // armor math below assumes no riposte crits

// --- ARMOR BREAK FLOW: the torso plate depletes after N hits, onArmorBreak
// fires exactly once, then hits go to flesh at FULL damage and light slashes
// no longer deflect on the broken part ---
{
  const ab = new Enemy(game, { type: 'knight', x: 7, z: 6 });
  const breaks0 = (game._armorBreaks || []).length;
  const b1 = ab.takeHit('torso', 30, 'slash', weaponStats('sword'), true, srcPos); // pool 90 -> 60
  const b2 = ab.takeHit('torso', 30, 'slash', weaponStats('sword'), true, srcPos); // pool 60 -> 30
  if (b1.armorBroke || b2.armorBroke) throw new Error('torso plate should survive two heavy slashes');
  if (b1.dmg !== 12 || b2.dmg !== 12) throw new Error('armored heavy slash should deal 12 (30 x 0.4)');
  if (ab.armorAt('torso') !== 30) throw new Error('pool should be 30 after two heavy slashes');
  const b3 = ab.takeHit('torso', 30, 'slash', weaponStats('sword'), true, srcPos); // pool 30 -> 0: BREAK
  if (!b3.armorBroke) throw new Error('third heavy slash should break the torso plate');
  if (ab.armorAt('torso') !== 0) throw new Error('broken plate pool should be 0');
  if ((game._armorBreaks || []).length !== breaks0 + 1) throw new Error('onArmorBreak should fire exactly once');
  if (game._armorBreaks[game._armorBreaks.length - 1] !== 'torso') throw new Error('break hook should name the torso');
  // post-break: heavy slash = FULL flesh damage, no absorb, no second break
  const b4 = ab.takeHit('torso', 30, 'slash', weaponStats('sword'), true, srcPos);
  if (b4.dmg !== 30 || b4.absorbed !== 0) throw new Error('post-break hits should deal full flesh damage');
  if (b4.armorBroke || (game._armorBreaks || []).length !== breaks0 + 1) {
    throw new Error('armor break must fire once only');
  }
  // light slash no longer deflects on the broken part
  const b5 = ab.takeHit('torso', 30, 'slash', weaponStats('sword'), false, srcPos);
  if (b5.deflected) throw new Error('broken plate should no longer deflect light slashes');
  if (b5.dmg !== 30) throw new Error('broken plate should take full flesh damage');
  if (ab.dead) throw new Error('break-flow knight should survive the sequence (kills stay at 4)');
}

// --- BLUNT POOL WEAR: blunt wears the pool x1.6 vs slash 1:1 — the mace is
// the armor breaker (two blunt hits crack the 90 pool where the sword
// needed three; light hits so no execution window interferes) ---
{
  const wearB = new Enemy(game, { type: 'knight', x: 8, z: 6 });
  const wBlunt = wearB.damageArmor('torso', 20, 'blunt');
  if (wBlunt.absorbed !== 4) throw new Error('blunt absorb should be 20 x 0.2 = 4');
  if (wearB.armorAt('torso') !== 58) throw new Error('blunt should wear the pool x1.6 (90 - 32 = 58)');
  const wearS = new Enemy(game, { type: 'knight', x: 9, z: 6 });
  const wSlash = wearS.damageArmor('torso', 20, 'slash');
  if (wSlash.absorbed !== 12) throw new Error('slash absorb should be 20 x 0.6 = 12');
  if (wearS.armorAt('torso') !== 70) throw new Error('slash should wear the pool 1:1 (90 - 20 = 70)');
  const mc = new Enemy(game, { type: 'knight', x: 10, z: 6 });
  const breaks1 = (game._armorBreaks || []).length;
  const m1 = mc.takeHit('torso', 30, 'blunt', weaponStats('mace'), false, srcPos);
  if (m1.armorBroke) throw new Error('first mace hit should not yet break the plate');
  if (mc.armorAt('torso') !== 42) throw new Error('mace should wear 48 per hit (90 - 48 = 42)');
  const m2 = mc.takeHit('torso', 30, 'blunt', weaponStats('mace'), false, srcPos);
  if (!m2.armorBroke) throw new Error('second mace hit should crack the torso plate');
  if (m2.dmg !== 24) throw new Error('mace flesh damage through plate should be 24 (30 x 0.8)');
  if ((game._armorBreaks || []).length !== breaks1 + 1) throw new Error('mace break should fire the hook once');
  // limbs always flesh: knight arms/legs carry no plate at all
  for (const limb of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']) {
    if (mc.armorAt(limb) !== 0) throw new Error('knight limbs should be unarmored: ' + limb);
  }
}

// --- HITSTOP TABLE: combat.js hitstopMs reads CFG.feel.hitstop live;
// severBonus ADDS, execution OVERRIDES, grazes scale down, unknown weapons
// fall back to sword; game.hitstop(ms) keeps the longest freeze in seconds ---
{
  const H = hitstopTable();
  if (H.sword.light !== 40 || H.sword.heavy !== 80 || H.axe.light !== 90 ||
      H.axe.heavy !== 90 || H.mace.light !== 70 || H.mace.heavy !== 70) {
    throw new Error('hitstop per-weapon values wrong');
  }
  if (H.severBonus !== 60 || H.execution !== 150 || H.armorBreak !== 50 || H.grazeMult !== 0.5) {
    throw new Error('hitstop specials wrong');
  }
  if (hitstopMs('sword', false, {}) !== 40) throw new Error('sword light hitstop wrong');
  if (hitstopMs('sword', true, {}) !== 80) throw new Error('sword heavy hitstop wrong');
  if (hitstopMs('sword', true, { severed: true }) !== 140) throw new Error('severBonus should add to hitstop');
  if (hitstopMs('mace', true, { severed: true, executed: true }) !== 150) {
    throw new Error('execution should override per-weapon hitstop');
  }
  if (hitstopMs('sword', false, { executed: true }) !== 150) throw new Error('execution should override light hitstop');
  if (hitstopMs('axe', true, { grazed: true }) !== 45) throw new Error('graze should halve hitstop');
  if (hitstopMs('halberd', false, {}) !== 40) throw new Error('unknown weapon should fall back to sword');
  game.hitStop = 0;
  game.hitstop(80); game.hitstop(40);
  if (game.hitStop !== 0.08) throw new Error('hitstop should keep the longest freeze, in seconds');
  game.hitstop(-5); game.hitstop(0);
  if (game.hitStop !== 0.08) throw new Error('hitstop should ignore non-positive durations');
  game.hitStop = 0;
}

// --- CAMERA FEEL: camKick / fovPunch / parryJolt exist, mutate player state,
// and decay over idle frames without throwing (player.js is Node-importable;
// a minimal document stub satisfies the constructor's listener wiring) ---
{
  globalThis.document = { addEventListener() {}, removeEventListener() {}, pointerLockElement: null };
  try {
    const pgame = {
      level, camera: new THREE.PerspectiveCamera(72, 1, 0.05, 100),
      time: 0, shake: 0, training: false,
      audio: audioStub, notify() {}, uiDamageFlash() {}, debugLine() {}, onPlayerDeath() {},
    };
    const pl = new Player(pgame, {
      stats: { maxHp: 100, maxStamina: 100, speedMult: 1, regenMult: 1, dmgMult: 1 },
      weapon: 'sword',
    });
    if (typeof pl.camKick !== 'function' || typeof pl.fovPunch !== 'function' ||
        typeof pl.parryJolt !== 'function') throw new Error('camera feel API missing');
    // camKick: directional offsets land, each channel clamped at max
    pl.camKick(new THREE.Vector3(1, -0.4, 0).normalize(), 1.4);
    const magK = Math.abs(pl._kickYaw) + Math.abs(pl._kickPitch) + Math.abs(pl._kickRoll);
    if (magK === 0) throw new Error('camKick should move the camera offsets');
    const kmax = cameraFeel().camKick.max;
    for (const v of [pl._kickYaw, pl._kickPitch, pl._kickRoll]) {
      if (Math.abs(v) > kmax + 1e-9) throw new Error('camKick channels should clamp at max');
    }
    // fovPunch: widens, clamps at max
    pl.fovPunch(cameraFeel().fovPunch.heavyHit);
    if (pl._fovPunch !== CAMERA_FEEL_DEFAULTS.fovPunch.heavyHit) throw new Error('fovPunch should widen the FOV');
    pl.fovPunch(999);
    if (pl._fovPunch !== cameraFeel().fovPunch.max) throw new Error('fovPunch should clamp at max');
    // parryJolt: viewmodel recoil + arms shiver + rebound camera nudge
    pl.attack.dir = 'slashL';
    const kyBefore = pl._kickYaw;
    pl.parryJolt();
    if (pl.vmRecoil < CAMERA_FEEL_DEFAULTS.parryJolt.recoil - 1e-9) {
      throw new Error('parryJolt should kick the viewmodel');
    }
    if (pl._joltT !== CAMERA_FEEL_DEFAULTS.parryJolt.t) throw new Error('parryJolt should start the arms shiver');
    if (pl._kickYaw <= kyBefore) throw new Error('parryJolt should rebound the camera (slashL kicks right)');
    // decay: idle frames shrink kicks + fov punch + shiver without throwing
    const mag0 = Math.abs(pl._kickYaw) + Math.abs(pl._kickPitch) + Math.abs(pl._kickRoll);
    const fp0 = pl._fovPunch;
    for (let i = 0; i < 30; i++) pl.update(1 / 60);
    const mag1 = Math.abs(pl._kickYaw) + Math.abs(pl._kickPitch) + Math.abs(pl._kickRoll);
    if (!(mag1 < mag0)) throw new Error('camKick offsets should decay in update');
    if (!(pl._fovPunch < fp0)) throw new Error('fovPunch should decay in update');
    if (pl._joltT > 0) throw new Error('parry shiver should have run down after 0.5s');
  } finally {
    delete globalThis.document;
  }
}

// --- KNOCKBACK: shove velocity clamps at maxSpeed, dummies take half, and
// friction + spring-back return the offset to rest (cosmetic, MP-safe) ---
{
  const kb = new Enemy(game, { type: 'knight', x: 5, z: 8 });
  kb.applyKnockback(new THREE.Vector3(1, 0, 0), 100);
  if (Math.abs(kb.kbVel.length() - 4) > 1e-9) throw new Error('knockback velocity should clamp at maxSpeed');
  const kdum = new Enemy(game, { ...level.training.dummySpawns[0], dummy: true });
  kdum.applyKnockback(new THREE.Vector3(1, 0, 0), 2);
  if (Math.abs(kdum.kbVel.length() - CFG.armor.dummyMult * 2) > 1e-9) {
    throw new Error('dummies should take half the shove');
  }
  for (let i = 0; i < 90; i++) kb.update(1 / 60);
  if (kb.kbVel.lengthSq() !== 0) throw new Error('knockback friction should stop the shove');
  if (kb.bodyG.position.length() > 0.05) throw new Error('knockback offset should spring back');
}

// --- AUDIO: Batch 1 contact API exists and is import-safe headless (no
// AudioContext — every call must no-op), material + severity tables sane ---
{
  for (const fn of ['materialHit', 'swingWhoosh', 'armorBreak']) {
    if (typeof AudioEngine.prototype[fn] !== 'function') throw new Error('audio missing Batch 1 API: ' + fn);
  }
  for (const m of ['flesh', 'bone', 'armor', 'shield', 'break']) {
    if (!MATERIAL_SFX_DEFAULTS[m]) throw new Error('material sfx table missing: ' + m);
  }
  const sev = MATERIAL_SFX_DEFAULTS.severity;
  if (!(sev.minGain > 0 && sev.minGain < 1 && sev.pitchDrop > 0 && sev.pitchDrop < 1 &&
      sev.minDur > 0 && sev.minDur <= 1)) throw new Error('severity convention broken');
  const eng = new AudioEngine();
  eng.materialHit(null, 'flesh', 0.5);
  eng.materialHit({ x: 0, y: 1, z: 0 }, 'armor', 1);
  eng.materialHit({ x: 0, y: 1, z: 0 }, 'bone', 0);
  eng.materialHit({ x: 0, y: 1, z: 0 }, 'shield', 0.25);
  eng.swingWhoosh(0.7, 0.1);
  eng.swingWhoosh(0, -0.2);
  eng.armorBreak({ x: 1, y: 1, z: 1 });
}

// ================= character creator (hero) =================

// --- part-name grammar ---
if (normalizePartName('Chr_Female_Eyebrow_02') !== 'Chr_Eyebrow_Female_02') throw new Error('eyebrow alias not normalized');
{
  const c = classifyPart('Chr_ArmUpperLeft_Male_06');
  if (!c || c.slot !== 'armUpper' || c.side !== 'Left' || c.gender !== 'Male' || c.nn !== '06') {
    throw new Error('arm part classification wrong');
  }
  const h = classifyPart('Chr_Head_No_Elements_Female_03');
  if (!h || h.slot !== 'head' || h.gender !== 'Female') throw new Error('no-elements head classification wrong');
  if (classifyPart('Chr_FantasyHero_Preset_33') !== null) throw new Error('preset marker should be unclassifiable');
  if (classifyPart('garbage') !== null) throw new Error('garbage part should be unclassifiable');
}

// --- parts index: exists, sane, and honest about what is on disk ---
const partsIndex = JSON.parse(readFileSync('public/assets/parts-index.json', 'utf8'));
if (partsIndex.version !== 1 || partsIndex.meshCount < 700) throw new Error('parts index mesh count wrong: ' + partsIndex.meshCount);
if (partsIndex.slots.head.options.Male.length < 20 || partsIndex.slots.head.options.Female.length < 20) {
  throw new Error('parts index head options missing a gender');
}
for (const def of SLOT_DEFS) {
  const s = partsIndex.slots[def.key];
  if (!s) throw new Error('parts index missing slot: ' + def.key);
  // every single-slot option must classify back to its own slot
  if (!def.pair) {
    const lists = def.gendered ? [s.options.Male, s.options.Female] : [s.options];
    for (const list of lists) {
      for (const name of list) {
        const c = classifyPart(name);
        if (!c || c.slot !== def.key) throw new Error(`index option ${name} does not classify as ${def.key}`);
      }
    }
  }
}
// every name the index flags as having a static FBX must exist on disk
for (const name of partsIndex.static) {
  if (!existsSync(`public/assets/parts/${name}_Static.fbx`)) {
    throw new Error('static part missing on disk: ' + name);
  }
}
// every archetype look (placements.json sets) must be fully covered by the catalog
const placementsJson = JSON.parse(readFileSync('public/assets/placements.json', 'utf8'));
const catalogSet = new Set(partsIndex.all);
for (const a of Object.values(ARCHETYPES)) {
  const raw = a.look.kind === 'set'
    ? placementsJson.sets[a.look.id]
    : JSON.parse(readFileSync('public/assets/presets.json', 'utf8'))[a.look.id];
  if (!raw) throw new Error('archetype look missing: ' + a.key);
  const clean = sanitizeParts(raw, catalogSet);
  if (clean.length < 15) throw new Error(`archetype ${a.key} look too sparse after sanitize: ${clean.length}`);
  for (const n of clean) if (!catalogSet.has(n)) throw new Error(`archetype ${a.key} part not in catalog: ${n}`);
}

// --- hero stat pool math (point-buy) ---
{
  const h = defaultHero();
  if (pointsLeft(h) !== STAT_POOL) throw new Error('fresh hero should have the full pool');
  if (spentPoints(h) !== 0) throw new Error('fresh hero should have nothing spent');
  const base = totalStats(h);
  if (base.vigor !== PRESETS.knight.stats.vigor) throw new Error('default archetype base wrong');
  for (let i = 0; i < 30; i++) adjustStat(h, 'vigor', 1);
  if (h.alloc.vigor !== ALLOC_CAP) throw new Error('alloc cap not enforced: ' + h.alloc.vigor);
  if (pointsLeft(h) !== STAT_POOL - ALLOC_CAP) throw new Error('pool accounting wrong after cap');
  adjustStat(h, 'vigor', -1);
  if (pointsLeft(h) !== STAT_POOL - ALLOC_CAP + 1) throw new Error('pool refund wrong');
}

// --- hero stat effects (wired through Meta.deriveStats, same as gameplay) ---
{
  const h = defaultHero();
  h.alloc.vigor = 5; // +5 Vigor
  const d = heroDerived(h);
  const d0 = heroDerived(defaultHero());
  if (d.maxHp - d0.maxHp !== 75) throw new Error('Vigor should add +15 max HP per point');
  h.alloc.strength = 4;
  const d2 = heroDerived(h);
  if (Math.abs(d2.dmgMult - d.dmgMult - 0.32) > 1e-9) throw new Error('Strength should add +8% dmg per point');
  h.alloc.agility = 3;
  const d3 = heroDerived(h);
  if (d3.maxStamina - d2.maxStamina !== 36) throw new Error('Agility should add +12 stamina per point');
  h.alloc.resolve = 2;
  const d4 = heroDerived(h);
  if (Math.abs(d4.regenMult - d3.regenMult - 0.20) > 1e-9) throw new Error('Resolve should add +10% regen per point');
  if (!(d4.staggerRes > d3.staggerRes)) throw new Error('Resolve should add stagger resist');
}

// --- hero persistence round-trip (Node-safe localStorage shim) ---
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  if (getHero() !== null) throw new Error('no hero should exist before saving');
  const h = defaultHero();
  h.name = 'Testric the Bold';
  h.parts = sanitizeParts(placementsJson.sets.knight, catalogSet);
  h.alloc = { vigor: 3, strength: 3, agility: 3, resolve: 3 };
  h.weapon = 'mace';
  if (!saveHero(h)) throw new Error('saveHero failed');
  const back = getHero();
  if (!back || back.name !== 'Testric the Bold' || back.weapon !== 'mace') throw new Error('hero round-trip broken');
  if (back.parts.length !== h.parts.length || back.alloc.vigor !== 3) throw new Error('hero round-trip lost fields');
  if (validateHero(back, partsIndex).length !== 0) throw new Error('saved hero should validate');
  // corrupted storage must not crash and must not yield a phantom hero
  store.set('grimhold_hero_v1', '{not json');
  if (getHero() !== null) throw new Error('corrupt hero save should load as null');
  store.set('grimhold_hero_v1', JSON.stringify({ version: 1, parts: [] }));
  if (getHero() !== null) throw new Error('hero without parts should load as null');
  clearHero();
  delete globalThis.localStorage;
}

// --- appearance surgery: slot cycling + gender flip keep the hero valid ---
{
  const h = defaultHero();
  h.parts = sanitizeParts(placementsJson.sets.knight, catalogSet);
  if (validateHero(h, partsIndex).length !== 0) throw new Error('knight hero should validate');
  // swap the torso for another male variant
  const torsoOpts = slotOptions(partsIndex, 'torso', 'Male');
  const cur = currentOption(h.parts, 'torso');
  if (!cur || !torsoOpts.list.includes(cur)) throw new Error('current torso not found in options');
  const nextTorso = torsoOpts.list[(torsoOpts.list.indexOf(cur) + 1) % torsoOpts.list.length];
  h.parts = setSlotOption(h.parts, 'torso', nextTorso, 'Male');
  if (currentOption(h.parts, 'torso') !== nextTorso) throw new Error('torso swap failed');
  if (validateHero(h, partsIndex).length !== 0) throw new Error('hero invalid after torso swap');
  // optional slot NONE -> option -> NONE
  h.parts = setSlotOption(h.parts, 'back', null, 'Male');
  if (currentOption(h.parts, 'back') !== null) throw new Error('back slot should be NONE');
  const backOpts = slotOptions(partsIndex, 'back', 'Male');
  h.parts = setSlotOption(h.parts, 'back', backOpts.list[0], 'Male');
  if (validateHero(h, partsIndex).length !== 0) throw new Error('hero invalid after back swap');
  // gender flip: every gendered part must follow, hero stays valid
  h.gender = 'Female';
  h.parts = flipGender(h.parts, 'Female', partsIndex);
  const problems = validateHero(h, partsIndex);
  if (problems.length !== 0) throw new Error('hero invalid after gender flip: ' + problems.join('; '));
  for (const n of h.parts) {
    const c = classifyPart(n);
    if (c && c.gender === 'Male') throw new Error('male part survived the gender flip: ' + n);
  }
  // randomize always produces a valid hero
  const r = randomizeHero(defaultHero(), partsIndex);
  const rp = validateHero(r, partsIndex);
  if (rp.length !== 0) throw new Error('randomized hero invalid: ' + rp.join('; '));
  if (spentPoints(r) !== STAT_POOL) throw new Error('randomize should spend the whole pool');
}

console.log('SMOKE OK:',
  `colliders=${level.colliders.length}`,
  `floors=${level.floors.length}`,
  `torches=${level.torches.length}`,
  `loot=${game.loot.entries.length}`,
  `kills=${game._kills}`,
  `executions=${game._execs || 0}`,
  `decapSlowmos=${game._decapSlowmos || 0}`,
  `ambushVolumes=${level.ambushVolumes.length}`,
  `trainingDummies=${level.training.dummySpawns.length}`,
  `playerHitsTaken=${game._dmg}`);
