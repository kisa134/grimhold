// config.js — single reactive tuning store. Every gameplay knob lives here in
// one nested object (CFG). Systems read CFG.* at USE-TIME so the tuning panel
// (src/panel.js) applies changes live. Current values persist to localStorage;
// import/export is plain JSON of the same shape.
//
// Node-safe (smoke.mjs imports modules that read CFG): localStorage access is
// guarded, and CFG falls back to DEFAULTS headlessly.

export const DEFAULTS = {
  combat: {
    flickMin: 26, flickDom: 1.2,
    chargeTime: 0.9, chargeGrace: 0.35, quickRelease: 0.18, chargeHeavy: 0.6, chargedMin: 0.2,
    chargeDmg: 0.6, chargeSever: 0.3, chargeStamina: 10,
    comboReset: 1.0, combo3DmgMult: 1.6, combo3ArcBonus: 0.35,
    parryWindow: 0.18, parryStagger: 2.2, parrySlowmoT: 0.25,
    riposteWindow: 1.5, riposteCrit: 2.0, riposteSeverBonus: 0.6,
    executeStaggerMin: 0.9, executeDmgMult: 3.0, executeSlowmoScale: 0.3, executeSlowmoT: 0.6,
    decapSlowmoScale: 0.35, decapSlowmoT: 0.5,
    kickCost: 15, kickRange: 1.8, kickDmg: 6, kickStagger: 1.1,
    gibOverkillDmg: 60,
    grazeRangeFrac: 0.85, grazeTargetSpeed: 1.5, grazeDmgMult: 0.5,
    blockChip: 0.15, whiffHeavyCost: 8,
    bleedDps: 2, bleedT: 6, crawlBleedDps: 3, bleedDripT: 0.35,
    dominoMinSpeed: 1.5, dominoDist: 0.9, dominoStagger: 0.5,
    deflectMult: 0.25, woundFrac: 0.5,
    allyFlinchRadius: 6, allyFlinchT: 0.6,
    perfectParryWindow: 0.10,
    postureGainBase: 8, postureHeavyMult: 1.4, postureBlockMult: 1.5,
    postureBreakSlowmoScale: 0.45, postureBreakSlowmoT: 0.2,
    flowStep: 0.12, flowMax: 4, flowDecay: 1.0,
    wallSplatDist: 1.1, wallSplatStagger: 2.2, wallSplatDmg: 14, wallSplatShake: 0.6,
    dodgeCost: 12, dodgeIframeT: 0.20, dodgeCd: 0.5, dodgeDist: 3.2, dodgeT: 0.28,
  },
  // duel — Chivalry-grade melee mind-games (feints, morphs, chambers, drags,
  // clashes, guard breaks, stamina warfare). All read live by combat systems.
  duel: {
    // feint: RMB during your own windup cancels the attack into recovery
    feintCost: 10, feintRecover: 0.28, feintReattack: 0.35,
    // morph: a NEW flick inside the first morphWindow fraction of the charge
    // changes the attack direction for a stamina cost
    morphCost: 8, morphWindow: 0.5,
    // chamber: start a swing that mirrors an incoming attack's direction just
    // before it lands -> both clash, no damage, both act again quickly
    chamberWindow: 0.15, chamberRecovery: 0.4,
    // drags & accels: mouse motion along the swing axis shifts contact timing
    // (fraction of swing duration). accel = earlier/weaker, drag = later/harder
    dragSens: 0.0035, dragMax: 0.35, accelMax: 0.25,
    dragDmgBonus: 0.15, accelDmgPenalty: 0.10,
    // weapon clash mid-swing (both blades meet in the air)
    clashEnabled: true, clashRecovery: 0.45, clashRange: 2.9,
    // guard break: blocking with no stamina (or vs an unparryable blow)
    guardBreakStagger: 1.6, guardBreakSlow: 0.45, bossGuardBreakDmg: 30,
    // stamina war: parries wound the ATTACKER, blocks bleed the defender
    parryStaminaDmg: 15, parryRecovery: 0.35,
    blockStaminaDmg: 8, blockStaminaCap: 30,
    enemyStamina: 50, enemyStaminaRegen: 9,
  },
  // sweep geometry per attack family (aimHead/aimTorso = crosshair radius boosts)
  sweep: {
    horizontal: { lat: 0.42, yMin: -1.3, yMax: 1.3, rangeBonus: 0,    aimHead: 1.0, aimTorso: 1.0 },
    overhead:   { lat: 0.30, yMin: -1.9, yMax: 0.9, rangeBonus: 0.1,  aimHead: 1.4, aimTorso: 1.0 },
    stab:       { lat: 0.22, yMin: -1.0, yMax: 1.0, rangeBonus: 0.45, aimHead: 1.3, aimTorso: 1.3 },
  },
  weapons: {
    sword: { damage: 22, cooldown: 0.50, windup: 0.10, swing: 0.22, recover: 0.20, range: 2.5, stagger: 0.35, sever: 0.35, heavyMult: 2.0, heavyWindup: 0.28, postureMult: 1.0 },
    axe:   { damage: 34, cooldown: 0.77, windup: 0.16, swing: 0.26, recover: 0.30, range: 2.4, stagger: 0.55, sever: 0.55, heavyMult: 2.2, heavyWindup: 0.38, postureMult: 1.2 },
    mace:  { damage: 26, cooldown: 0.63, windup: 0.14, swing: 0.24, recover: 0.26, range: 2.3, stagger: 1.5, sever: 0.08, heavyMult: 1.9, heavyWindup: 0.32, postureMult: 1.1 },
  },
  player: {
    walk: 4.9, sprint: 8.2, gravity: 20,
    jumpSpeed: 7.5, stepHeight: 0.6,
    accelWalk: 0.25, accelSprint: 0.32, accelStop: 0.18,
    mouseSens: 0.0022,
    sprintStamina: 12, regenStamina: 16, swingStaminaRegen: 6, blockStaminaDrain: 2,
    blockSpeedMult: 0.45,
    landThudSpeed: 9, fallDmgSpeed: 15,
  },
  ragdoll: {
    maxRagdolls: 6, gravity: 14,
    impulseBase: 2.5, impulseRand: 1.2, impulseCharge: 1.6,
    massSword: 1.0, massAxe: 1.3, massMace: 1.15,
    vyBase: 1.5, vyRand: 1.5,
    overheadSlam: 0.65,  // vy multiplier on overhead kills (slammed down)
    overheadFwd: 0.7,    // horizontal multiplier on overhead kills
    stabPin: 1.5,        // horizontal multiplier on stab kills (pinned back)
    stabSpin: 0.35,      // tumble multiplier on stab kills
    executedBonus: 1.0, bossBonus: 0.8,
    bounce: 0.4, bounceDampen: 0.6, slideFriction: 3.5, angDampen: 4, settleSpeed: 0.2,
    smearT: 0.09,        // s between blood smears while a corpse slides
    kickPower: 3.0, nudgeHeavy: 2.6, nudgeLight: 1.6,
  },
  limbs: { // severed props & gibs
    maxLimbs: 56, gravity: 12, restitution: 0.3, bounceDampen: 0.55, groundFriction: 4,
    kickPush: 2.2, kickLift: 1.4, hitLaunch: 4.0,
    restPoolScale: 0.55, twitchMin: 0.5, twitchRand: 0.4,
  },
  gore: {
    maxParticles: 2000, maxDecals: 140, maxPools: 40,
    particleGravity: 14, particleLifeBase: 0.5, particleLifeRand: 0.7,
    bloodBase: 10, bloodPerDmg: 1.4, bloodMax: 45,
    severBurst: 70, severBurstPower: 3.8, deathBurst: 80, gibBurst: 90,
    poolGrowTime: 10, poolMaxR: 1.6,
    fountainDecapDur: 2.0, fountainLimbDur: 1.2, fountainLimbScale: 0.55,
    pulseRate: 14, dripT: 0.22, sprayWallChance: 0.3,
    woundMax: 3,
    gibBase: 3, gibRand: 3, gutsBase: 2, gutsRand: 3,
  },
  audio: {
    master: 0.7, goreVol: 1.0, clangVol: 1.0,
    cutoff: 19, refDist: 7, exponent: 1.6,
  },
  // feel — Batch 1 contact quality: hit-stop (ms of world freeze on CONTACT),
  // camera director (camKick / fovPunch), swing whoosh. main.js/player.js/
  // audio.js read these at use-time; the exported *_DEFAULTS consts in those
  // modules stay as fallbacks for tests.
  feel: {
    hitstop: {
      swordLight: 40, swordHeavy: 80,
      axeLight: 90, axeHeavy: 90,
      maceLight: 70, maceHeavy: 70,
      severBonus: 60,   // added when the blow severs/destroys the struck part
      execution: 150,   // executions override the per-weapon value
      armorBreak: 50,   // extra freeze when armor shatters
      grazeMult: 0.5,   // glancing blows freeze at this fraction
    },
    camKick: {
      yaw: 0.022, pitch: 0.018, roll: 0.012, // rad per unit of push × power
      max: 0.07,      // clamp on any single kick channel (rad)
      recover: 9,     // exponential decay rate (1/s); hit-stop slows it naturally
    },
    fovPunch: {
      heavyHit: 6, guardBreak: 9, armorBreak: 5,
      max: 12, decay: 14, // clamp on total FOV widen / units per second
    },
    // live-tunable leaves of audio SWING_WHOOSH_DEFAULTS (internals stay there)
    whoosh: {
      freqBase: 380, freqCharge: 620,   // sweep start (Hz) floor + charge add
      gainBase: 0.20, gainCharge: 0.22, // volume floor + charge add
      dragPitchDrop: 0.22,              // pitch fall at full drag
      whistleAt: 0.45,                  // charge where the blade whistle fades in
    },
  },
  // armor — Batch 1 zonal plate: per-archetype pools (knight limbs stay 0 =
  // always flesh), per-damage-type absorb while the plate holds, blunt pool
  // wear (mace = armor breaker), cosmetic knockback. enemy.js reads at
  // use-time; ARMOR_DEFAULTS / ARMOR_ABSORB / KNOCKBACK_DEFAULTS are fallbacks.
  armor: {
    knightHead: 50, knightTorso: 90,
    bossHead: 80, bossTorso: 140, bossLimb: 40,
    absorbSlash: 0.6, absorbPierce: 0.5, absorbChop: 0.4, absorbBlunt: 0.2,
    bluntPoolMult: 1.6,
    knockbackMax: 0.5,    // clamp on the visual shove offset (meters)
    knockbackFriction: 10,// shove velocity decay (1/s)
    dummyMult: 0.5,       // training dummies take half the shove
  },
  enemies: {
    knight:   { speed: 1.7, damage: 26, range: 2.2, cooldown: 1.8, windup: 0.6, armor: 0.35, staggerResist: 0.5, parryChance: 0.5, feintChance: 0.15, postureMax: 100, postureRegen: 14, postureBreakStagger: 2.2 },
    bandit:   { speed: 3.4, damage: 12, range: 1.9, cooldown: 1.0, windup: 0.35, armor: 0, staggerResist: 0, parryChance: 0, feintChance: 0.35, postureMax: 60, postureRegen: 18, postureBreakStagger: 1.6 },
    skeleton: { speed: 2.3, damage: 16, range: 2.0, cooldown: 1.4, windup: 0.5, armor: 0.1, staggerResist: 0.2, parryChance: 0, feintChance: 0.05, postureMax: 80, postureRegen: 12, postureBreakStagger: 1.8 },
    bossHpMult: 3.0, bossDamage: 34, bossSpeed: 1.9, bossWindup: 0.7,
    bossUnparryable: true, // boss heavies smash through parries -> guard break
    bossPostureMax: 250, bossPostureRegen: 8, bossPostureBreakStagger: 2.0,
    aggroRange: 16, staggerCap: 1.4, limpMult: 0.72, crawlSpeed: 0.7,
  },
  // body part HP = the effective sever/destroy threshold per part
  parts: {
    head: { hp: 30 }, torso: { hp: 80 },
    leftArm: { hp: 35 }, rightArm: { hp: 35 },
    leftLeg: { hp: 40 }, rightLeg: { hp: 40 },
  },
  training: {
    respawnDelay: 4, dmgNumbers: true, infiniteStamina: true,
  },
  // world — labyrinth-castle atmosphere + map knobs (panel auto-generates UI)
  world: {
    fogDensity: 0.016, fogColor: 0x14141e,
    moonColor: 0xbfe8d8, moonIntensity: 0.62, ambientIntensity: 1.05,
    emissive: 1.1,            // flame/window emissive strength on the kit atlas
    lightBudget: 27,          // real PointLights (rest of the flames are emissive-only)
    wisps: true,              // glowing trail to the extraction gate once open
    wispSpacing: 2,           // maze cells between wisps
    wispColor: 0x66ffcc, wispSize: 0.5,
  },
  debug: {
    showReadout: true,
  },
  // creator — character-creation screen knobs (preview only, no gameplay)
  creator: {
    rotateSpeed: 0.45,    // preview auto-rotation (rad/s) when not dragging
    zoom: 3.2,            // default camera distance of the preview
  },
};

const KEY = 'grimhold_tuning_v1';

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(dst, src) {
  for (const k of Object.keys(src || {})) {
    if (isObj(src[k]) && isObj(dst[k])) deepMerge(dst[k], src[k]);
    else if (src[k] !== undefined) dst[k] = src[k];
  }
  return dst;
}

function loadSaved() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

// The live store. Mutated by the panel; read by every system at use-time.
export const CFG = deepMerge(clone(DEFAULTS), loadSaved() || {});

const subs = [];
export function onCfgChange(fn) { subs.push(fn); }
function notify(path) { for (const f of subs) { try { f(path); } catch (e) {} } }

export function getCfg(path) {
  let o = CFG;
  for (const k of path.split('.')) o = o[k];
  return o;
}

export function setCfg(path, value) {
  const keys = path.split('.');
  let o = CFG;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
  saveCfg();
  notify(path);
}

export function saveCfg() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(CFG));
  } catch (e) { /* private mode etc. */ }
}

// Restore every value to DEFAULTS (does not clear the saved copy by itself).
export function resetCfg() {
  for (const k of Object.keys(CFG)) delete CFG[k];
  deepMerge(CFG, clone(DEFAULTS));
  notify('');
}

export function clearSavedCfg() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch (e) {}
  resetCfg();
}

// Import a (possibly partial) JSON object, merged onto defaults.
export function importCfg(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  for (const k of Object.keys(CFG)) delete CFG[k];
  deepMerge(CFG, deepMerge(clone(DEFAULTS), parsed));
  saveCfg();
  notify('');
  return CFG;
}
