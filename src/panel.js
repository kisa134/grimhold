// panel.js — live in-game tuning panel ("the black ledger"). Toggle with
// ` (backquote) or F1. Every numeric/boolean leaf of CFG becomes a slider +
// number input (or checkbox), grouped in collapsible sections. Changes write
// through to CFG immediately (systems read it at use-time) and persist to
// localStorage. Opening releases pointer lock; closing re-locks.
import {
  CFG, DEFAULTS, setCfg, resetCfg, clearSavedCfg, importCfg, onCfgChange,
} from './config.js';

let game = null;
let canvas = null;
let root = null;
let open = false;
const rows = []; // {path, slider, num, check} for refresh after import/reset

export const isPanelOpen = () => open;

const SECTIONS = [
  ['combat', 'COMBAT'],
  ['duel', 'DUEL (FEINT/MORPH/CHAMBER/DRAG/CLASH)'],
  ['feel', 'CONTACT FEEL (HIT-STOP/CAMERA/WHOOSH)'],
  ['armor', 'ZONAL ARMOR'],
  ['sweep', 'SWEEP GEOMETRY'],
  ['weapons', 'WEAPONS'],
  ['player', 'MOVEMENT / PHYSICS'],
  ['ragdoll', 'RAGDOLL'],
  ['limbs', 'LIMB PROPS'],
  ['parts', 'BODY PART HP (SEVER THRESHOLDS)'],
  ['gore', 'GORE'],
  ['audio', 'AUDIO'],
  ['enemies', 'ENEMIES'],
  ['training', 'TRAINING'],
  ['debug', 'DEBUG'],
];

// Slider ranges per leaf key (fallback derived from the default value).
const R = {
  flickMin: [4, 120, 1], flickDom: [1, 3, 0.05],
  chargeTime: [0.2, 2.5, 0.05], chargeGrace: [0, 1.5, 0.05], quickRelease: [0.05, 0.6, 0.01],
  chargeHeavy: [0.1, 1, 0.01], chargedMin: [0, 1, 0.01], chargeDmg: [0, 2, 0.05],
  chargeSever: [0, 1, 0.01], chargeStamina: [0, 40, 1],
  comboReset: [0.2, 3, 0.05], combo3DmgMult: [1, 4, 0.05], combo3ArcBonus: [0, 1.5, 0.05],
  parryWindow: [0.05, 0.6, 0.01], parryStagger: [0.5, 5, 0.1], parrySlowmoT: [0, 1.5, 0.05],
  riposteWindow: [0.2, 4, 0.1], riposteCrit: [1, 5, 0.1], riposteSeverBonus: [0, 1.5, 0.05],
  executeStaggerMin: [0.2, 3, 0.05], executeDmgMult: [1, 8, 0.1],
  executeSlowmoScale: [0.05, 1, 0.01], executeSlowmoT: [0, 2, 0.05],
  decapSlowmoScale: [0.05, 1, 0.01], decapSlowmoT: [0, 2, 0.05],
  kickCost: [0, 50, 1], kickRange: [0.5, 4, 0.1], kickDmg: [0, 50, 1], kickStagger: [0.2, 3, 0.05],
  gibOverkillDmg: [10, 200, 5],
  grazeRangeFrac: [0.3, 1, 0.01], grazeTargetSpeed: [0.5, 6, 0.1], grazeDmgMult: [0.1, 1, 0.01],
  blockChip: [0, 0.8, 0.01], whiffHeavyCost: [0, 30, 1],
  bleedDps: [0, 20, 0.5], bleedT: [0, 20, 0.5], crawlBleedDps: [0, 20, 0.5], bleedDripT: [0.05, 2, 0.05],
  dominoMinSpeed: [0.5, 6, 0.1], dominoDist: [0.3, 3, 0.1], dominoStagger: [0.1, 2, 0.05],
  deflectMult: [0, 1, 0.01], woundFrac: [0.1, 0.9, 0.01],
  allyFlinchRadius: [0, 15, 0.5], allyFlinchT: [0, 3, 0.1],
  lat: [0.05, 1.2, 0.01], yMin: [-3, 0, 0.05], yMax: [0, 3, 0.05], rangeBonus: [0, 1.5, 0.05],
  aimHead: [0.5, 3, 0.05], aimTorso: [0.5, 3, 0.05],
  damage: [1, 120, 1], cooldown: [0.1, 4, 0.01], windup: [0.02, 2, 0.01], swing: [0.05, 1, 0.01],
  recover: [0.05, 1.5, 0.01], range: [1, 5, 0.05], stagger: [0, 3, 0.05], sever: [0, 1, 0.01],
  heavyMult: [1, 4, 0.05], heavyWindup: [0.05, 1.2, 0.01],
  walk: [1, 12, 0.1], sprint: [2, 18, 0.1], gravity: [2, 40, 0.5],
  accelWalk: [0.02, 1, 0.01], accelSprint: [0.02, 1, 0.01], accelStop: [0.02, 1, 0.01],
  mouseSens: [0.0005, 0.008, 0.0001],
  sprintStamina: [0, 40, 1], regenStamina: [0, 60, 1], swingStaminaRegen: [0, 30, 1],
  blockStaminaDrain: [0, 20, 0.5], blockSpeedMult: [0.1, 1, 0.01],
  landThudSpeed: [3, 20, 0.5], fallDmgSpeed: [5, 30, 0.5],
  maxRagdolls: [1, 20, 1],
  impulseBase: [0, 8, 0.1], impulseRand: [0, 5, 0.1], impulseCharge: [0, 5, 0.1],
  massSword: [0.2, 3, 0.05], massAxe: [0.2, 3, 0.05], massMace: [0.2, 3, 0.05],
  vyBase: [0, 6, 0.1], vyRand: [0, 5, 0.1],
  overheadSlam: [0, 2, 0.05], overheadFwd: [0, 2, 0.05], stabPin: [0.5, 4, 0.05], stabSpin: [0, 2, 0.05],
  executedBonus: [0, 4, 0.1], bossBonus: [0, 4, 0.1],
  bounce: [0, 0.9, 0.01], bounceDampen: [0.1, 1, 0.01], slideFriction: [0.5, 10, 0.1],
  angDampen: [0.5, 10, 0.1], settleSpeed: [0.05, 1, 0.01], smearT: [0.02, 0.5, 0.01],
  kickPower: [0, 8, 0.1], nudgeHeavy: [0, 8, 0.1], nudgeLight: [0, 8, 0.1],
  maxLimbs: [8, 200, 4], restitution: [0, 0.9, 0.01], groundFriction: [0.5, 10, 0.1],
  kickPush: [0, 6, 0.1], kickLift: [0, 5, 0.1], hitLaunch: [0, 10, 0.1],
  restPoolScale: [0, 1.5, 0.05], twitchMin: [0, 2, 0.05], twitchRand: [0, 2, 0.05],
  maxParticles: [200, 2000, 100], maxDecals: [20, 400, 10], maxPools: [5, 120, 5],
  particleGravity: [0, 30, 0.5], particleLifeBase: [0.1, 2, 0.05], particleLifeRand: [0, 2, 0.05],
  bloodBase: [0, 60, 1], bloodPerDmg: [0, 4, 0.05], bloodMax: [10, 200, 5],
  severBurst: [0, 200, 5], severBurstPower: [0, 8, 0.1], deathBurst: [0, 200, 5], gibBurst: [0, 200, 5],
  poolGrowTime: [1, 60, 1], poolMaxR: [0.5, 4, 0.1],
  fountainDecapDur: [0, 8, 0.1], fountainLimbDur: [0, 6, 0.1], fountainLimbScale: [0.1, 1.5, 0.05],
  pulseRate: [4, 30, 0.5], dripT: [0.05, 1, 0.01], sprayWallChance: [0, 1, 0.05],
  woundMax: [0, 8, 1], gibBase: [0, 10, 1], gibRand: [0, 8, 1], gutsBase: [0, 8, 1], gutsRand: [0, 6, 1],
  master: [0, 1, 0.01], goreVol: [0, 2, 0.05], clangVol: [0, 2, 0.05],
  cutoff: [5, 60, 1], refDist: [2, 20, 0.5], exponent: [0.5, 3, 0.05],
  speed: [0.2, 8, 0.1], armor: [0, 0.9, 0.01], staggerResist: [0, 0.9, 0.01],
  bossHpMult: [0.5, 8, 0.1], bossDamage: [5, 100, 1], bossSpeed: [0.5, 6, 0.1], bossWindup: [0.1, 2, 0.05],
  aggroRange: [3, 40, 1], staggerCap: [0.3, 4, 0.1], limpMult: [0.2, 1, 0.01], crawlSpeed: [0.1, 3, 0.05],
  hp: [5, 300, 5],
  respawnDelay: [0.5, 15, 0.5],
  // duel mechanics
  feintCost: [0, 40, 1], feintRecover: [0.05, 1, 0.01], feintReattack: [0.05, 2, 0.05],
  morphCost: [0, 40, 1], morphWindow: [0.1, 1, 0.05],
  chamberWindow: [0.03, 0.5, 0.01], chamberRecovery: [0.05, 2, 0.05],
  dragSens: [0, 0.02, 0.0005], dragMax: [0.05, 0.8, 0.05], accelMax: [0.05, 0.8, 0.05],
  dragDmgBonus: [0, 0.6, 0.01], accelDmgPenalty: [0, 0.6, 0.01],
  clashRecovery: [0.05, 2, 0.05], clashRange: [1, 6, 0.1],
  guardBreakStagger: [0.3, 4, 0.1], guardBreakSlow: [0.1, 1, 0.05], bossGuardBreakDmg: [0, 80, 1],
  parryStaminaDmg: [0, 60, 1], parryRecovery: [0, 1.5, 0.05],
  blockStaminaDmg: [0, 40, 1], blockStaminaCap: [5, 80, 1],
  enemyStamina: [10, 200, 5], enemyStaminaRegen: [0, 40, 1],
  parryChance: [0, 1, 0.05], feintChance: [0, 1, 0.05],
};

// Full-PATH ranges — checked before the leaf-keyed table above, so new groups
// can reuse leaf names (recover, max, yaw...) without inheriting stale ranges.
const RP = {
  // feel.hitstop (milliseconds of world freeze)
  'feel.hitstop.swordLight': [0, 300, 5], 'feel.hitstop.swordHeavy': [0, 300, 5],
  'feel.hitstop.axeLight': [0, 300, 5], 'feel.hitstop.axeHeavy': [0, 300, 5],
  'feel.hitstop.maceLight': [0, 300, 5], 'feel.hitstop.maceHeavy': [0, 300, 5],
  'feel.hitstop.severBonus': [0, 300, 5], 'feel.hitstop.execution': [0, 400, 5],
  'feel.hitstop.armorBreak': [0, 300, 5], 'feel.hitstop.grazeMult': [0, 1, 0.05],
  // feel.camKick (radians)
  'feel.camKick.yaw': [0, 0.1, 0.001], 'feel.camKick.pitch': [0, 0.1, 0.001],
  'feel.camKick.roll': [0, 0.1, 0.001], 'feel.camKick.max': [0, 0.2, 0.005],
  'feel.camKick.recover': [1, 30, 0.5],
  // feel.fovPunch (FOV degrees)
  'feel.fovPunch.heavyHit': [0, 20, 0.5], 'feel.fovPunch.guardBreak': [0, 20, 0.5],
  'feel.fovPunch.armorBreak': [0, 20, 0.5], 'feel.fovPunch.max': [0, 30, 0.5],
  'feel.fovPunch.decay': [1, 40, 0.5],
  // feel.whoosh (blade whoosh sweep)
  'feel.whoosh.freqBase': [100, 1000, 10], 'feel.whoosh.freqCharge': [0, 1200, 10],
  'feel.whoosh.gainBase': [0, 1, 0.01], 'feel.whoosh.gainCharge': [0, 1, 0.01],
  'feel.whoosh.dragPitchDrop': [0, 0.8, 0.01], 'feel.whoosh.whistleAt': [0, 1, 0.05],
  // armor (zonal plate pools + absorb fractions + knockback)
  'armor.knightHead': [0, 300, 5], 'armor.knightTorso': [0, 300, 5],
  'armor.bossHead': [0, 300, 5], 'armor.bossTorso': [0, 400, 5], 'armor.bossLimb': [0, 200, 5],
  'armor.absorbSlash': [0, 0.95, 0.01], 'armor.absorbPierce': [0, 0.95, 0.01],
  'armor.absorbChop': [0, 0.95, 0.01], 'armor.absorbBlunt': [0, 0.95, 0.01],
  'armor.bluntPoolMult': [1, 3, 0.05],
  'armor.knockbackMax': [0, 1.5, 0.05], 'armor.knockbackFriction': [1, 30, 0.5],
  'armor.dummyMult': [0, 1, 0.05],
};

function rangeFor(path, key, def) {
  if (RP[path]) return RP[path];
  if (R[key]) return R[key];
  if (def > 0) return [0, Math.ceil(def * 3 * 100) / 100, def >= 10 ? 1 : def >= 1 ? 0.1 : 0.01];
  return [0, 1, 0.01];
}

const decimals = (step) => {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
};

const labelize = (key) => key
  .replace(/([A-Z])/g, ' $1')
  .replace(/^./, (c) => c.toUpperCase());

function getDefault(path) {
  let o = DEFAULTS;
  for (const k of path.split('.')) o = o[k];
  return o;
}

function getLive(path) {
  let o = CFG;
  for (const k of path.split('.')) o = o[k];
  return o;
}

function buildRow(path, key, value) {
  const row = document.createElement('div');
  row.className = 'tp-row';
  const lab = document.createElement('span');
  lab.className = 'tp-label';
  lab.textContent = labelize(key);
  lab.title = path;
  row.appendChild(lab);

  if (typeof value === 'boolean') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = value;
    cb.addEventListener('change', () => setCfg(path, cb.checked));
    row.appendChild(cb);
    rows.push({ path, check: cb });
    return row;
  }

  const def = getDefault(path);
  const [min, max, step] = rangeFor(path, key, typeof def === 'number' ? def : 1);
  const dec = decimals(step);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = min; slider.max = max; slider.step = step;
  slider.value = value;

  const num = document.createElement('input');
  num.type = 'number';
  num.min = min; num.max = max; num.step = step;
  num.value = Number(value).toFixed(dec);

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    num.value = v.toFixed(dec);
    setCfg(path, v);
  });
  num.addEventListener('change', () => {
    let v = parseFloat(num.value);
    if (!Number.isFinite(v)) v = def;
    v = Math.max(min, Math.min(max, v));
    num.value = v.toFixed(dec);
    slider.value = v;
    setCfg(path, v);
  });

  row.appendChild(slider);
  row.appendChild(num);
  rows.push({ path, slider, num, dec });
  return row;
}

function buildSection(parent, key, title) {
  const det = document.createElement('details');
  det.className = 'tp-section';
  if (key === 'combat' || key === 'training' || key === 'debug') det.open = true;
  const sum = document.createElement('summary');
  sum.textContent = title;
  det.appendChild(sum);

  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') {
        const sub = document.createElement('div');
        sub.className = 'tp-subhead';
        sub.textContent = labelize(k);
        det.appendChild(sub);
        walk(v, path);
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        det.appendChild(buildRow(path, k, v));
      }
    }
  };
  walk(CFG[key], key);
  parent.appendChild(det);
}

function refreshRows() {
  for (const r of rows) {
    const v = getLive(r.path);
    if (r.check) r.check.checked = !!v;
    else {
      r.slider.value = v;
      r.num.value = Number(v).toFixed(r.dec);
    }
  }
}

function note(text) {
  const el = root.querySelector('.tp-status');
  if (!el) return;
  el.textContent = text;
  clearTimeout(note._t);
  note._t = setTimeout(() => { el.textContent = ''; }, 2200);
}

export function togglePanel(force) {
  open = force !== undefined ? force : !open;
  root.style.display = open ? 'block' : 'none';
  if (open) {
    refreshRows();
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (game && game.state === 'run' && game.player && !game.player.dead) {
    // re-lock (user-gesture context); if the browser refuses, surface the
    // pause hint so the player can click to resume
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { if (game.showPauseHint) game.showPauseHint(); });
    } catch (e) {
      if (game.showPauseHint) game.showPauseHint();
    }
    setTimeout(() => {
      if (!document.pointerLockElement && game.state === 'run' && game.showPauseHint) {
        game.showPauseHint();
      }
    }, 400);
  }
  return open;
}

export function initPanel(g, canvasEl) {
  game = g;
  canvas = canvasEl;

  const style = document.createElement('style');
  style.textContent = `
    #tuning-panel { position:fixed; top:24px; right:24px; width:360px; max-height:88vh;
      overflow-y:auto; z-index:40; display:none; background:rgba(10,8,13,.96);
      border:1px solid #6a5230; box-shadow:0 0 30px rgba(0,0,0,.8);
      font-family:Georgia,'Times New Roman',serif; color:#d8cdb4; font-size:12px; }
    #tuning-panel .tp-head { position:sticky; top:0; background:#1a1410; padding:8px 10px;
      border-bottom:1px solid #6a5230; cursor:move; letter-spacing:2px; color:#e8c85a;
      display:flex; justify-content:space-between; align-items:center; z-index:2; }
    #tuning-panel .tp-head button { margin:0; padding:2px 8px; font-size:11px; }
    #tuning-panel details.tp-section { border-bottom:1px solid #33291c; }
    #tuning-panel summary { cursor:pointer; padding:7px 10px; color:#c9b577; letter-spacing:2px;
      font-size:12px; user-select:none; }
    #tuning-panel summary:hover { color:#e8c85a; }
    #tuning-panel .tp-subhead { padding:4px 10px 2px; color:#8d8266; font-size:11px;
      letter-spacing:1px; text-transform:uppercase; }
    #tuning-panel .tp-row { display:flex; align-items:center; gap:6px; padding:2px 10px; }
    #tuning-panel .tp-label { flex:0 0 118px; color:#b3a88d; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; }
    #tuning-panel input[type=range] { flex:1; min-width:0; accent-color:#a8843f; height:14px;
      background:transparent; border:none; padding:0; margin:0; }
    #tuning-panel input[type=number] { width:58px; padding:1px 3px; font-size:11px; margin:0;
      background:#14100c; color:#d8cdb4; border:1px solid #4a3a28; }
    #tuning-panel input[type=checkbox] { accent-color:#a8843f; }
    #tuning-panel .tp-foot { padding:8px 10px; display:flex; flex-wrap:wrap; gap:2px; }
    #tuning-panel .tp-foot button { font-size:11px; padding:4px 8px; margin:2px; }
    #tuning-panel .tp-import { width:100%; box-sizing:border-box; height:54px; margin:4px 0;
      background:#14100c; color:#d8cdb4; border:1px solid #4a3a28; font-size:11px;
      font-family:monospace; resize:vertical; }
    #tuning-panel .tp-status { width:100%; color:#7fc97f; font-size:11px; min-height:14px;
      padding:2px 0; }
    #tuning-panel ::-webkit-scrollbar { width:8px; }
    #tuning-panel ::-webkit-scrollbar-thumb { background:#4a3a28; }
  `;
  document.head.appendChild(style);

  root = document.createElement('div');
  root.id = 'tuning-panel';

  const head = document.createElement('div');
  head.className = 'tp-head';
  head.innerHTML = '<span>⚙ GRIMHOLD TUNING</span>';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'CLOSE (`)';
  closeBtn.addEventListener('click', () => togglePanel(false));
  head.appendChild(closeBtn);
  root.appendChild(head);

  const body = document.createElement('div');
  for (const [key, title] of SECTIONS) {
    if (CFG[key] && typeof CFG[key] === 'object') buildSection(body, key, title);
  }
  root.appendChild(body);

  const foot = document.createElement('div');
  foot.className = 'tp-foot';
  foot.innerHTML = `
    <button data-a="reset">RESET ALL TO DEFAULTS</button>
    <button data-a="export">EXPORT JSON</button>
    <button data-a="clear">CLEAR SAVED</button>
    <textarea class="tp-import" placeholder="Paste tuning JSON here, then APPLY IMPORT"></textarea>
    <button data-a="import">APPLY IMPORT</button>
    <div class="tp-status"></div>`;
  root.appendChild(foot);
  document.body.appendChild(root);

  foot.querySelector('[data-a=reset]').addEventListener('click', () => {
    resetCfg();
    refreshRows();
    note('All values back to defaults.');
  });
  foot.querySelector('[data-a=clear]').addEventListener('click', () => {
    clearSavedCfg();
    refreshRows();
    note('Saved tweaks cleared; defaults restored.');
  });
  foot.querySelector('[data-a=export]').addEventListener('click', () => {
    const json = JSON.stringify(CFG, null, 2);
    let msg = '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(() => note('Copied to clipboard + downloaded.'))
        .catch(() => note('Downloaded (clipboard blocked).'));
      msg = 'exporting';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'grimhold-tuning.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    if (!msg) note('Downloaded grimhold-tuning.json');
  });
  foot.querySelector('[data-a=import]').addEventListener('click', () => {
    const ta = foot.querySelector('.tp-import');
    try {
      importCfg(ta.value);
      refreshRows();
      ta.value = '';
      note('Import applied.');
    } catch (e) {
      note('IMPORT FAILED: ' + e.message);
    }
  });

  // draggable by the header
  let drag = null;
  head.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    drag = { x: e.clientX, y: e.clientY, left: root.offsetLeft, top: root.offsetTop };
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    root.style.right = 'auto';
    root.style.left = Math.max(0, drag.left + e.clientX - drag.x) + 'px';
    root.style.top = Math.max(0, drag.top + e.clientY - drag.y) + 'px';
  });
  document.addEventListener('mouseup', () => { drag = null; });

  // keep panel inputs in sync when something else rewrites CFG
  onCfgChange((path) => { if (open && path === '') refreshRows(); });

  // toggle keys: ` (backquote) or F1 — but not while typing in an input
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Backquote' && e.code !== 'F1') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    togglePanel();
  });
}
