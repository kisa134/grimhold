// hero.js — the player's CREATED CHARACTER: appearance (Synty part list),
// point-buy stats, starting weapon and name. Persisted to localStorage
// ('grimhold_hero_v1') and consumed LIVE everywhere:
//   - stats -> Player (via Meta.deriveStats in main.js)
//   - parts -> PlayerBody (first-person body), RemoteAvatar (MP), champion
//     preview (menu + death screen)
//   - name  -> MP join default + death screen
//
// The stat/pool/appearance logic below is PURE and Node-safe (localStorage is
// guarded) so smoke.mjs can test it headlessly.
import { PRESETS, deriveStats } from './meta.js';
import { SLOT_DEFS, classifyPart, normalizePartName, buildSlotNames } from './partnames.js';

export const HERO_KEY = 'grimhold_hero_v1';
export const STAT_POOL = 12;      // points on top of the archetype base
export const ALLOC_CAP = 8;       // max allocated points per stat
export const STAT_KEYS = ['vigor', 'strength', 'agility', 'resolve'];
export const STAT_LABELS = { vigor: 'VIGOR', strength: 'STRENGTH', agility: 'AGILITY', resolve: 'RESOLVE' };

// Archetypes: stat base + default weapon + appearance source.
// look:  {kind:'set', id} -> placements.json named set (via skinned.enemyParts)
//        {kind:'preset', id} -> presets.json full-body preset (skinned.presetParts)
export const ARCHETYPES = {
  knight:   { key: 'knight',   label: 'KNIGHT',   weapon: 'sword', look: { kind: 'set', id: 'knight' } },
  raider:   { key: 'raider',   label: 'RAIDER',   weapon: 'axe',   look: { kind: 'set', id: 'bandit' } },
  penitent: { key: 'penitent', label: 'PENITENT', weapon: 'mace',  look: { kind: 'set', id: 'boss' } },
  // full-body presets from presets.json as extra starting templates
  templar:  { key: 'templar',  label: 'TEMPLAR',  weapon: 'sword', look: { kind: 'preset', id: '33' } },
  huntress: { key: 'huntress', label: 'HUNTRESS', weapon: 'sword', look: { kind: 'preset', id: '1' } },
  outrider: { key: 'outrider', label: 'OUTRIDER', weapon: 'axe',   look: { kind: 'preset', id: '10' } },
};
// stat base comes from the three meta presets; the template archetypes borrow
const ARCHETYPE_BASE = { knight: 'knight', raider: 'raider', penitent: 'penitent', templar: 'knight', huntress: 'raider', outrider: 'raider' };

export const WEAPON_CHOICES = ['sword', 'axe', 'mace'];

export function defaultHero() {
  return {
    version: 1,
    name: 'Nameless',
    gender: 'Male',
    archetype: 'knight',
    parts: null,              // resolved by the creator from the archetype look
    alloc: { vigor: 0, strength: 0, agility: 0, resolve: 0 },
    weapon: 'sword',
  };
}

// ---- stats --------------------------------------------------------------------
export function baseStats(archetype) {
  const preset = PRESETS[ARCHETYPE_BASE[archetype] || 'knight'] || PRESETS.knight;
  return { ...preset.stats };
}

export function totalStats(hero) {
  const base = baseStats(hero ? hero.archetype : 'knight');
  const alloc = (hero && hero.alloc) || {};
  const out = {};
  for (const k of STAT_KEYS) out[k] = base[k] + Math.max(0, Math.min(ALLOC_CAP, alloc[k] | 0));
  return out;
}

export function spentPoints(hero) {
  const alloc = (hero && hero.alloc) || {};
  return STAT_KEYS.reduce((s, k) => s + Math.max(0, Math.min(ALLOC_CAP, alloc[k] | 0)), 0);
}

export function pointsLeft(hero) {
  return STAT_POOL - spentPoints(hero);
}

// Adjust one allocated stat by dir (+1/-1) respecting pool + cap. Returns hero.
export function adjustStat(hero, key, dir) {
  if (!STAT_KEYS.includes(key)) return hero;
  const cur = Math.max(0, Math.min(ALLOC_CAP, hero.alloc[key] | 0));
  if (dir > 0 && (cur >= ALLOC_CAP || pointsLeft(hero) <= 0)) return hero;
  if (dir < 0 && cur <= 0) return hero;
  hero.alloc[key] = cur + (dir > 0 ? 1 : -1);
  return hero;
}

// Derived live stats (identical formula to Meta.deriveStats — armor optional).
export function heroDerived(hero, armor = null) {
  return deriveStats(totalStats(hero), armor);
}

// ---- persistence ---------------------------------------------------------------
export function getHero() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(HERO_KEY);
    if (!raw) return null;
    const h = JSON.parse(raw);
    if (!h || typeof h !== 'object' || h.version !== 1) return null;
    if (!Array.isArray(h.parts) || !h.parts.length) return null;
    return { ...defaultHero(), ...h, alloc: { ...defaultHero().alloc, ...(h.alloc || {}) } };
  } catch (e) {
    return null;
  }
}

export function saveHero(hero) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(HERO_KEY, JSON.stringify(hero));
    return true;
  } catch (e) { return false; }
}

export function clearHero() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(HERO_KEY);
  } catch (e) { /* ignore */ }
}

// Convenience: the created hero's part list (null when no hero was created).
export function getHeroParts() {
  const h = getHero();
  return h && Array.isArray(h.parts) && h.parts.length ? h.parts : null;
}

// ---- appearance -----------------------------------------------------------------
// Sanitize a raw part list: normalize legacy aliases, drop unknown/garbage.
// known: optional Set of valid names (the parts index 'all' list).
export function sanitizeParts(list, known = null) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const name = normalizePartName(raw);
    if (!classifyPart(name)) continue;          // drops Chr_FantasyHero_Preset_N etc.
    if (known && !known.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

// Validate a hero against a parts index ({all:[...]}). Returns a list of
// problems ([] = valid).
export function validateHero(hero, index) {
  const problems = [];
  if (!hero || typeof hero !== 'object') return ['not an object'];
  if (!hero.name || typeof hero.name !== 'string') problems.push('name missing');
  if (hero.gender !== 'Male' && hero.gender !== 'Female') problems.push('gender invalid');
  if (!ARCHETYPES[hero.archetype]) problems.push('archetype unknown');
  if (!WEAPON_CHOICES.includes(hero.weapon)) problems.push('weapon unknown');
  if (!Array.isArray(hero.parts) || !hero.parts.length) {
    problems.push('no parts');
    return problems;
  }
  const known = index && Array.isArray(index.all) ? new Set(index.all) : null;
  const covered = new Set();
  for (const raw of hero.parts) {
    const c = classifyPart(raw);
    if (!c) { problems.push(`unclassifiable part: ${raw}`); continue; }
    if (known && !known.has(c.name)) problems.push(`part not in catalog: ${c.name}`);
    if (c.gender && c.gender !== hero.gender) problems.push(`gender mismatch: ${c.name}`);
    covered.add(c.slot);
  }
  for (const def of SLOT_DEFS) {
    if (!def.optional && !covered.has(def.key)) problems.push(`required slot empty: ${def.key}`);
  }
  if (spentPoints(hero) > STAT_POOL) problems.push('stat pool overspent');
  return problems;
}

// The parts a slot currently owns inside a part list.
export function slotParts(parts, slotKey) {
  return (parts || []).filter((n) => {
    const c = classifyPart(n);
    return c && c.slot === slotKey;
  });
}

// Options for a slot in a gender from a parts index. Returns {optional, list}
// where list entries are option tokens (full names for single slots, nn for
// paired slots). NONE is represented by index -1 (not an entry).
export function slotOptions(index, slotKey, gender) {
  const s = index && index.slots && index.slots[slotKey];
  if (!s) return null;
  const list = s.gendered ? (s.options[gender] || []) : s.options;
  return { optional: !!s.optional, pair: !!s.pair, list };
}

// Current option token for a slot inside a part list (null = NONE/empty).
export function currentOption(parts, slotKey) {
  const owned = slotParts(parts, slotKey);
  if (!owned.length) return null;
  const c = classifyPart(owned[0]);
  const def = SLOT_DEFS.find((d) => d.key === slotKey);
  return def && def.pair ? c.nn : c.name;
}

// Set a slot to a new option token (null = NONE for optional slots).
// Returns a NEW parts array.
export function setSlotOption(parts, slotKey, option, gender) {
  const def = SLOT_DEFS.find((d) => d.key === slotKey);
  if (!def) return parts;
  const kept = (parts || []).filter((n) => {
    const c = classifyPart(n);
    return !c || c.slot !== slotKey;
  });
  if (option == null) return kept;
  return kept.concat(buildSlotNames(def, option, gender));
}

// Flip every gendered part to the other gender, keeping the same variant nn
// where it exists (else nearest option). Female loses facial hair.
export function flipGender(parts, newGender, index) {
  let out = [...(parts || [])];
  for (const def of SLOT_DEFS) {
    if (!def.gendered) continue;
    const owned = slotParts(out, def.key);
    if (!owned.length) continue;
    const cur = currentOption(out, def.key);
    const opts = slotOptions(index, def.key, newGender);
    if (!opts || !opts.list.length) {
      // no options for the new gender (facial hair on Female): drop the slot
      if (def.optional) out = setSlotOption(out, def.key, null, newGender);
      continue;
    }
    let next;
    if (def.pair) {
      next = opts.list.includes(cur) ? cur : nearestToken(opts.list, cur);
    } else if (!opts.list.includes(cur)) {
      // same nn in the new gender's list, else the option at the same
      // (clamped) ordinal position — every gendered slot MUST translate
      const c = classifyPart(owned[0]);
      const sameNn = opts.list.find((n) => classifyPart(n).nn === c.nn);
      const oldOpts = slotOptions(index, def.key, c.gender || 'Male');
      const ord = oldOpts ? Math.max(0, oldOpts.list.indexOf(cur)) : 0;
      next = sameNn || opts.list[Math.min(ord, opts.list.length - 1)];
    }
    if (next == null) continue;
    out = setSlotOption(out, def.key, next, newGender);
  }
  return out;
}

function nearestToken(list, nn) {
  if (!list.length) return null;
  const target = parseInt(nn, 10);
  let best = list[0], bestD = Infinity;
  for (const t of list) {
    const d = Math.abs(parseInt(t, 10) - target);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

// Randomize appearance + allocation (fun button). Keeps name/gender/archetype.
export function randomizeHero(hero, index, rng = Math.random) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  let parts = [];
  for (const def of SLOT_DEFS) {
    const opts = slotOptions(index, def.key, hero.gender);
    if (!opts || !opts.list.length) continue;
    if (opts.optional && rng() < 0.45) continue; // many optional slots stay empty
    parts = parts.concat(buildSlotNames(def, pick(opts.list), hero.gender));
  }
  hero.parts = parts;
  // spread the whole pool randomly under the cap
  hero.alloc = { vigor: 0, strength: 0, agility: 0, resolve: 0 };
  let left = STAT_POOL;
  while (left > 0) {
    const k = pick(STAT_KEYS);
    if (hero.alloc[k] >= ALLOC_CAP) continue;
    hero.alloc[k]++;
    left--;
  }
  hero.weapon = pick(WEAPON_CHOICES);
  return hero;
}
