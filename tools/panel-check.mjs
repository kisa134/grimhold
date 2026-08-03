// Headless panel render check: stubs just enough DOM to run initPanel()
// for real, then walks the built element tree to prove the CFG groups render
// as sections with rows, and that slider ranges come from the path-keyed RP
// table (not stale leaf-keyed collisions like weapons.recover).
import { initPanel } from '../src/panel.js';
import { CFG } from '../src/config.js';

class FakeEl {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this._qs = new Map();
  }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {}
  querySelector(sel) {
    if (!this._qs.has(sel)) this._qs.set(sel, new FakeEl('div'));
    return this._qs.get(sel);
  }
  click() {}
  setAttribute() {}
}

const head = new FakeEl('head');
const body = new FakeEl('body');
let created = 0;
globalThis.document = {
  createElement: (tag) => { created++; return new FakeEl(tag); },
  head, body,
  addEventListener() {},
  pointerLockElement: null,
};

const game = { state: 'run', player: null, showPauseHint() {} };
const canvas = new FakeEl('canvas');
initPanel(game, canvas);

const root = body.children[0];
if (!root) throw new Error('panel root was not attached');

// walk the whole tree: collect section summaries and range-slider rows
const summaries = [];
const sliders = []; // {path, min, max, step}
(function walk(el) {
  if (el.tagName === 'SUMMARY') summaries.push(el.textContent);
  if (el.type === 'range') {
    const row = el._parent;
    const label = row && row.children.find((c) => c.className === 'tp-label');
    sliders.push({ path: label ? label.title : '?', min: el.min, max: el.max, step: el.step });
  }
  for (const c of el.children || []) { c._parent = el; walk(c); }
})(root);

const need = (path, min, max) => {
  const s = sliders.find((r) => r.path === path);
  if (!s) throw new Error('panel row missing: ' + path);
  if (Number(s.min) !== min || Number(s.max) !== max) {
    throw new Error(`panel range wrong for ${path}: [${s.min}, ${s.max}] expected [${min}, ${max}]`);
  }
};

if (!summaries.some((s) => s.includes('CONTACT FEEL'))) throw new Error('feel section not rendered');
if (!summaries.some((s) => s.includes('ZONAL ARMOR'))) throw new Error('armor section not rendered');

// hitstop + graze
need('feel.hitstop.swordLight', 0, 300);
need('feel.hitstop.execution', 0, 400);
need('feel.hitstop.grazeMult', 0, 1);
// camKick — recover/max must come from the PATH table (RP), not leaf collisions
need('feel.camKick.yaw', 0, 0.1);
need('feel.camKick.recover', 1, 30);   // would be [0.05, 1.5] via weapons.recover leaf
need('feel.camKick.max', 0, 0.2);      // distinct from fovPunch.max below
// fovPunch
need('feel.fovPunch.heavyHit', 0, 20);
need('feel.fovPunch.max', 0, 30);
need('feel.fovPunch.decay', 1, 40);
// whoosh
need('feel.whoosh.freqBase', 100, 1000);
need('feel.whoosh.whistleAt', 0, 1);
// armor
need('armor.knightTorso', 0, 300);
need('armor.bossLimb', 0, 200);
need('armor.absorbSlash', 0, 0.95);
need('armor.bluntPoolMult', 1, 3);
need('armor.knockbackMax', 0, 1.5);
need('armor.dummyMult', 0, 1);

// every numeric/bool leaf of the two groups must have a row
let leaves = 0;
const countLeaves = (o) => {
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') countLeaves(v);
    else if (typeof v === 'number' || typeof v === 'boolean') leaves++;
  }
};
countLeaves(CFG.feel); countLeaves(CFG.armor);
const rendered = sliders.filter((r) => r.path.startsWith('feel.') || r.path.startsWith('armor.')).length;
if (rendered !== leaves) throw new Error(`panel rendered ${rendered} feel/armor rows, CFG has ${leaves}`);

console.log(`PANEL OK: sections=${summaries.length} sliders=${sliders.length} feel+armor rows=${rendered}/${leaves}`);
