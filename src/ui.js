// ui.js — HUD updates, notifications, hitmarkers, loadout & result screens (DOM)
import { PRESETS, getMeta, setEquip, deriveStats } from './meta.js';
import { weaponStats } from './weapons.js';
import {
  startChampionPreview, stopChampionPreview, cycleChampion, getChampionId,
} from './champion.js';
import * as MP from './mp.js';
import * as Creator from './creator.js';
import { on, onClose, lobbyList, Net, disconnect } from './net.js';
import { getHero, ARCHETYPES, totalStats } from './hero.js';
import { CFG } from './config.js';

let game = null;
let els = {};
let selectedPreset = 'knight';

const CONTROLS = 'WASD move &nbsp;|&nbsp; LMB tap = quick slash (chains 1-2-3) &nbsp;·&nbsp; <b>HOLD LMB to charge</b> — flick &larr;/&rarr;/&darr;/&uarr; for slash/overhead/stab, release to strike · flick AGAIN early to MORPH &nbsp;|&nbsp; <b>RMB tap = PARRY</b> · RMB hold = block (watch stamina — at 0 your guard BREAKS) · RMB mid-windup = FEINT &nbsp;|&nbsp; mirror an incoming strike with your own to CHAMBER · sway the mouse with/against the swing to ACCEL/DRAG &nbsp;|&nbsp; G kick &nbsp;|&nbsp; charged attack a staggered enemy to EXECUTE &nbsp;|&nbsp; Shift sprint &nbsp;|&nbsp; E interact &nbsp;|&nbsp; M mute &nbsp;|&nbsp; 1/2/3 weapons &nbsp;|&nbsp; ` (backtick) tuning panel';

export function initUI(g) {
  game = g;
  for (const id of ['hud', 'weapon-name', 'slots', 'hpbar', 'stbar', 'gate-status', 'gold',
    'hitmarker', 'prompt', 'notify', 'vignette', 'lowhp', 'pause-hint', 'boss-name', 'bloodscreen',
    'crosshair', 'weapon-icon', 'dmgnums', 'killfeed', 'kills', 'chargering', 'debugline',
    'screen-loadout', 'screen-result', 'screen-lobby', 'screen-main',
    'flow-meter']) {
    els[id] = document.getElementById(id);
  }
  els['impactflash'] = document.getElementById('impactflash');
  // crosshair image (Synty reticle)
  const ch = els['crosshair'];
  if (ch && !ch.firstChild) {
    const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
    const img = document.createElement('img');
    img.src = base + 'assets/hud/Reticles/SPR_HUD_DarkFantasy_Reticle_Arc_Medium_01_Variant_01.png';
    ch.appendChild(img);
  }
}

export function showHUD(on) {
  els['hud'].style.display = on ? 'block' : 'none';
}

export function showMain() {
  // hide all other screens, show main menu
  for (const s of ['screen-loadout', 'screen-result', 'screen-creator', 'screen-lobby']) {
    if (els[s]) els[s].classList.remove('active');
  }
  const m = els['screen-main'];
  m.classList.add('active');
  showHUD(false);
  // gold readout
  try { const g = (game && game.runGold) || 0; const el = document.getElementById('mm-gold'); if (el) el.textContent = g; } catch {}
  // wire buttons (once)
  if (!m.dataset.wired) {
    m.dataset.wired = '1';
    const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
    document.getElementById('btn-play').addEventListener('click', () => { m.classList.remove('active'); showLoadout(); });
    document.getElementById('btn-lobby').addEventListener('click', () => { m.classList.remove('active'); showLobby(); });
    document.getElementById('btn-training').addEventListener('click', () => {
      m.classList.remove('active');
      // training = start run in training mode (see main.js startRun)
      if (game && game.startTraining) game.startTraining();
      else { /* fallback: open creator then training */ showLoadout(); }
    });
    document.getElementById('btn-settings').addEventListener('click', () => {
      // settings screen (future); for now toggle tuning panel
      const tp = document.getElementById('tuning-panel');
      if (tp) tp.style.display = tp.style.display === 'block' ? 'none' : 'block';
    });
    // also show gold from vault gold in localStorage
    try { const vg = Number(localStorage.getItem('grimhold_vaultgold') || 0); const el = document.getElementById('mm-gold'); if (el && vg) el.textContent = vg; } catch {}
  }
}

export function updateHUD() {
  const p = game.player;
  if (!p) return;
  const hpFill = els['hpbar'].querySelector('.fill');
  const stFill = els['stbar'].querySelector('.fill');
  hpFill.style.width = Math.max(0, (p.hp / p.stats.maxHp) * 100) + '%';
  stFill.style.width = Math.max(0, (p.stamina / p.stats.maxStamina) * 100) + '%';
  const ws = p.wstats;
  els['weapon-name'].textContent = ws.itemName + (p.blocking ? '  [BLOCKING]' : '');
  els['weapon-name'].style.color = ws.color;
  const ICON = { sword: 'ICON_SM_Wep_Sword_01_DarkFantasy.png', axe: 'ICON_SM_Wep_Axe_01_DarkFantasy.png', mace: 'ICON_SM_Wep_Mace_01_DarkFantasy.png' };
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
  const ic = els['weapon-icon'];
  if (ic && !ic.firstChild) {
    const img = document.createElement('img');
    img.src = base + 'assets/hud/Icons_Weapons/' + (ICON[ws.key] || ICON.sword);
    ic.appendChild(img);
  } else if (ic && ic.firstChild) {
    ic.firstChild.src = base + 'assets/hud/Icons_Weapons/' + (ICON[ws.key] || ICON.sword);
  }
  els['slots'].textContent = p.slots.map((s, i) =>
    `${i + 1}:${i === p.slot ? '[' + weaponStats(s).itemName + ']' : weaponStats(s).itemName}`).join('  ');
  els['gold'].textContent = game.training
    ? `DUMMY KILLS ${game.runKills}`
    : `GOLD ${game.runGold}   LOOT ${game.lootValue()}`;
  els['kills'].textContent = game.runKills > 0 && !game.training ? `KILLS ${game.runKills}` : '';
  const gs = els['gate-status'];
  if (game.training) {
    gs.textContent = 'TRAINING — ` tune · Esc leave';
    gs.style.color = '#6fb7ff';
  } else if (game.gateOpen) {
    gs.textContent = 'GATE OPEN — EXTRACT!';
    gs.style.color = '#6fe86f';
  } else {
    gs.textContent = `GATE SEALED — loot ${game.lootValue()}/${game.gateThreshold}`;
    gs.style.color = '#e86f6f';
  }
  els['lowhp'].style.opacity = p.hp < p.stats.maxHp * 0.3 ? String(0.7 + 0.3 * Math.sin(game.time * 6)) : '0';
  // boss nameplate
  els['boss-name'].style.opacity = game.bossName ? '1' : '0';
  // charge ring around the crosshair while holding LMB
  const a = p.attack;
  const charging = a.phase === 'windup';
  const cr = els['chargering'];
  if (cr) {
    cr.style.opacity = charging ? '0.95' : '0';
    if (charging) cr.style.setProperty('--chg', a.charge.toFixed(3));
  }
}

export function notify(text, color) {
  const d = document.createElement('div');
  d.className = 'note';
  d.textContent = text;
  d.style.color = color || '#d8cdb4';
  els['notify'].appendChild(d);
  setTimeout(() => d.remove(), 2600);
  while (els['notify'].children.length > 5) els['notify'].firstChild.remove();
}

export function hitmarker(killed, gold) {
  els['hitmarker'].style.opacity = '1';
  els['hitmarker'].style.color = killed ? '#ff3030' : '#ffe1e1';
  els['hitmarker'].style.transform = killed ? 'scale(1.5)' : 'scale(1)';
  clearTimeout(hitmarker._t);
  hitmarker._t = setTimeout(() => { els['hitmarker'].style.opacity = '0'; }, 120);
  // crosshair pulses too — gold on headshot/execute, red on kills/hits
  const ch = els['crosshair'];
  ch.style.background = gold ? '#ffd24d' : (killed ? '#ff3030' : '#d83838');
  ch.style.transform = gold ? 'scale(2.6)' : 'scale(1.9)';
  clearTimeout(hitmarker._ct);
  hitmarker._ct = setTimeout(() => {
    ch.style.background = 'rgba(216,205,180,.65)';
    ch.style.transform = 'scale(1)';
  }, 130);
}

// Floating damage number at a screen-space position (percent coords).
// Optional zone label ("42 HEAD") used by the training room.
export function damageNumber(x, y, dmg, cls, zone) {
  const d = document.createElement('div');
  d.className = 'dmgnum ' + cls;
  d.textContent = zone ? `${dmg} ${zone}` : dmg;
  d.style.left = x + '%';
  d.style.top = y + '%';
  els['dmgnums'].appendChild(d);
  setTimeout(() => d.remove(), 900);
  while (els['dmgnums'].children.length > 14) els['dmgnums'].firstChild.remove();
}

// Live debug readout line (last swing direction / charge / hit zone / damage).
export function debugLine(text) {
  const el = els['debugline'];
  if (!el) return;
  el.textContent = text;
}

// Big center-screen arcade popup for notable events.
export function killPopup(text, color) {
  const d = document.createElement('div');
  d.className = 'killpop';
  d.textContent = text;
  d.style.color = color || '#ff2030';
  els['killfeed'].appendChild(d);
  setTimeout(() => d.remove(), 1400);
  while (els['killfeed'].children.length > 3) els['killfeed'].firstChild.remove();
}

export function damageFlash() {
  els['vignette'].style.boxShadow = 'inset 0 0 180px 80px rgba(160,10,10,0.55)';
  clearTimeout(damageFlash._t);
  damageFlash._t = setTimeout(() => {
    els['vignette'].style.boxShadow = 'inset 0 0 180px 60px rgba(120,0,0,0)';
  }, 140);
}

// Bright white-gold flash on a successful parry.
export function parryFlash() {
  els['vignette'].style.boxShadow = 'inset 0 0 190px 90px rgba(255,230,150,0.6)';
  clearTimeout(parryFlash._t);
  parryFlash._t = setTimeout(() => {
    els['vignette'].style.boxShadow = 'inset 0 0 180px 60px rgba(120,0,0,0)';
  }, 200);
}

// Floating posture bar over an enemy's head. Called every frame for each
// living enemy. Reuses the same world->screen projection as main.js
// (enemy.pos is a THREE.Vector3; project through game.camera). One DOM element
// is created per enemy and reused across frames.
export function postureBar(enemy) {
  if (!enemy || enemy.dead || enemy.dummy) {
    // cleanup any leftover bar element when the enemy goes down
    if (enemy && enemy._postureEl) {
      try { enemy._postureEl.remove(); } catch (e) {}
      enemy._postureEl = null;
      return;
    }
    return;
  }
  const cam = game && game.camera;
  if (!cam) return;
  // create the bar element once, reuse it
  let el = enemy._postureEl;
  if (!el) {
    el = document.createElement('div');
    el.style.cssText = 'position:absolute;width:70px;height:5px;border:1px solid rgba(0,0,0,.6);'
      + 'background:rgba(0,0,0,.45);transform:translate(-50%,-50%);pointer-events:none;'
      + 'box-shadow:0 0 4px #000;';
    const fill = document.createElement('div');
    fill.style.cssText = 'height:100%;width:100%;transition:width .08s linear;';
    el.appendChild(fill);
    el._fill = fill;
    const hud = (els && els['hud']) || document.getElementById('hud') || document.body;
    hud.appendChild(el);
    enemy._postureEl = el;
  }
  const max = enemy.postureMax || 1;
  const cur = Math.max(0, Math.min(max, enemy.posture || 0));
  const frac = cur / max;
  // project head position to screen
  const ndc = enemy.pos.clone().setY(enemy.pos.y + 2.0).project(cam);
  if (ndc.z > 1) {            // behind the camera — hide
    el.style.display = 'none';
    return;
  }
  const x = (ndc.x * 0.5 + 0.5) * 100;
  const y = (-ndc.y * 0.5 + 0.5) * 100;
  el.style.display = 'block';
  el.style.left = x + '%';
  el.style.top = y + '%';
  // color: yellow under 0.7, red at/above; postureDown => red + blink
  let color, opacity = 1;
  if (enemy.postureDown) {
    color = '#ff4030';
    opacity = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin((game ? game.time : performance.now() / 1000) * 14));
  } else {
    color = frac >= 0.7 ? '#ff4030' : '#ffd24a';
  }
  el._fill.style.width = (frac * 100) + '%';
  el._fill.style.background = color;
  el.style.opacity = String(opacity);
}

// Flow meter (combo flow) along the bottom-left of the HUD. flow is the number
// of filled segments out of CFG.combat.flowMax. Hidden when flow<=0. Reuses the
// #flow-meter / #flow-segs DOM added to index.html.
export function flowMeter(flow) {
  const meter = els && els['flow-meter'];
  if (!meter) return;
  const segs = meter.querySelector('#flow-segs') || document.getElementById('flow-segs');
  if (!segs) return;
  const f = Math.max(0, Math.floor(flow || 0));
  if (f <= 0) { meter.style.display = 'none'; return; }
  const max = (CFG.combat && CFG.combat.flowMax) || 4;
  const filled = '█'.repeat(Math.min(f, max));
  const empty = '░'.repeat(Math.max(0, max - Math.min(f, max)));
  segs.textContent = filled + empty;
  segs.style.color = '#66ffcc';
  meter.style.display = 'block';
}

// Fading blood droplets spattered across the "camera lens" (heavier = more).
export function bloodSplatter(strength = 1) {
  const n = Math.min(8, 2 + Math.round(strength * 2));
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'blood-drop';
    const s = 6 + Math.random() * 26 * strength;
    d.style.width = d.style.height = s + 'px';
    d.style.left = (15 + Math.random() * 70) + '%';
    d.style.top = (10 + Math.random() * 75) + '%';
    els['bloodscreen'].appendChild(d);
    setTimeout(() => d.remove(), 900 + Math.random() * 600);
  }
}

// Brief fullscreen white impact flash (anime hit feel — heavy connects,
// parries). Subtle: capped opacity, ~60-90ms.
export function impactFlash(strength = 0.35, ms = 80) {
  const el = els['impactflash'];
  if (!el) return;
  el.style.opacity = String(Math.min(0.5, strength));
  clearTimeout(impactFlash._t);
  impactFlash._t = setTimeout(() => { el.style.opacity = '0'; }, ms);
}

export function setPrompt(t) {
  els['prompt'].textContent = t || '';
}

export function showPause(on) {
  els['pause-hint'].style.display = on ? 'flex' : 'none';
}

// ---------------- screens ----------------

function hideAllScreens() {
  els['screen-loadout'].classList.remove('active');
  els['screen-result'].classList.remove('active');
  els['screen-lobby'].classList.remove('active');
  Creator.hide();
}

export function showLoadout() {
  hideAllScreens();
  showHUD(false);
  const meta = getMeta();
  const hero = getHero();
  const s = els['screen-loadout'];

  const presetCards = Object.values(PRESETS).map(p => {
    const st = p.stats;
    return `<button class="lo-class ${p.key === selectedPreset ? 'selected' : ''}" data-preset="${p.key}">
      <h3>${p.name}</h3>
      <div class="desc">${p.desc}</div>
      <div class="stats">VIG ${st.vigor} · STR ${st.strength} · AGI ${st.agility} · RES ${st.resolve}</div>
      <div class="wpn">⚔ ${weaponStats(p.weapon).name}${p.armor ? ' · ' + p.armor.name + ' +' + p.armor.hp + 'HP' : ''}</div>
    </button>`;
  }).join('');

  const championInner = hero ? (() => {
    const hst = totalStats(hero);
    return `<div class="lo-champ-name" id="champ-name">${hero.name}</div>
      <div class="lo-champ-nav"><span class="small">${ARCHETYPES[hero.archetype].label} · ${weaponStats(hero.weapon).name}</span></div>
      <div class="lo-champ-nav"><button class="lo-eq-btn" id="btn-create" style="border-color:#a8843f">EDIT HERO</button></div>`;
  })() : `
      <div class="lo-champ-nav"><button id="champ-prev" class="lo-eq-btn">◀ PREV</button>
      <span class="lo-champ-name" id="champ-name" style="font-size:13px">PRESET #${getChampionId()}</span>
      <button id="champ-next" class="lo-eq-btn">NEXT ▶</button></div>
      <div class="lo-champ-nav"><button class="lo-eq-btn" id="btn-create" style="border-color:#a8843f">CREATE CHARACTER</button></div>`;

  const weapons = meta.stash.filter(i => i.kind === 'weapon');
  const armors = meta.stash.filter(i => i.kind === 'armor');
  const relics = meta.stash.filter(i => i.kind === 'relic');
  const stashHtml = meta.stash.length === 0
    ? '<div class="small">Stash empty. Extract to keep loot.</div>'
    : `${weapons.map(w => `<button class="lo-eq-btn ${meta.equipWeaponId === w.id ? 'selected' : ''}" data-eqw="${w.id}">⚔ ${w.name} (${w.value}g)</button>`).join('')}
       ${armors.map(a => `<button class="lo-eq-btn ${meta.equipArmorId === a.id ? 'selected' : ''}" data-eqa="${a.id}">🛡 ${a.name} +${a.hp}HP (${a.value}g)</button>`).join('')}
       ${relics.map(r => `<button class="lo-eq-btn" disabled>${r.name} (${r.value}g) — sell at extract</button>`).join('')}`;

  s.innerHTML = `
    <div class="lo-top">
      <h1>GRIMHOLD</h1>
      <h2>A MEDIEVAL LOOT-EXTRACTION SLASHER</h2>
    </div>
    <div class="lo-grid">
      <div class="lo-col">
        <div class="lo-col-title">CHOOSE YOUR CLASS</div>
        <div class="lo-classes">${presetCards}</div>
      </div>
      <div class="lo-col lo-center">
        <div class="lo-col-title">YOUR CHAMPION</div>
        <canvas id="champion-view" class="lo-champ-canvas"></canvas>
        ${championInner}
      </div>
      <div class="lo-col">
        <div class="lo-col-title">VAULT &amp; STASH</div>
        <div class="lo-gold">VAULT GOLD: ${meta.gold}</div>
        <div class="lo-stash">${stashHtml}</div>
      </div>
    </div>
    <div class="lo-bottom">
      <button class="big" id="btn-start">ENTER GRIMHOLD ▸</button>
      <button class="big" id="btn-training">TRAINING</button>
      <button class="big" id="btn-lobby">ONLINE LOBBY</button>
    </div>
    <div class="lo-controls">${CONTROLS}</div>
  `;
  s.classList.add('active');
  s.classList.add('menu-df');

  const champCanvas = document.getElementById('champion-view');
  const champName = document.getElementById('champ-name');
  const tryPreview = () => {
    if (!document.body.contains(champCanvas)) return;
    if (!startChampionPreview(champCanvas)) setTimeout(tryPreview, 800);
  };
  tryPreview();
  const champPrev = document.getElementById('champ-prev');
  if (champPrev) {
    champPrev.addEventListener('click', () => { champName.textContent = `PRESET #${cycleChampion(-1) || getChampionId()}`; });
    document.getElementById('champ-next').addEventListener('click', () => { champName.textContent = `PRESET #${cycleChampion(1) || getChampionId()}`; });
  }
  document.getElementById('btn-create').addEventListener('click', () => { stopChampionPreview(); Creator.open(() => showLoadout()); });

  s.querySelectorAll('[data-preset]').forEach(b =>
    b.addEventListener('click', () => { selectedPreset = b.dataset.preset; try { localStorage.setItem('grimhold_preset', selectedPreset); } catch {} showLoadout(); }));
  s.querySelectorAll('[data-eqw]').forEach(b =>
    b.addEventListener('click', () => { const m = getMeta(); setEquip(m.equipWeaponId === b.dataset.eqw ? null : b.dataset.eqw, m.equipArmorId); showLoadout(); }));
  s.querySelectorAll('[data-eqa]').forEach(b =>
    b.addEventListener('click', () => { const m = getMeta(); setEquip(m.equipWeaponId, m.equipArmorId === b.dataset.eqa ? null : b.dataset.eqa); showLoadout(); }));
  document.getElementById('btn-start').addEventListener('click', () => { try { document.querySelector('canvas')?.requestPointerLock?.(); } catch {} game.startRun(selectedPreset); });
  document.getElementById('btn-training').addEventListener('click', () => game.startTraining(selectedPreset));
  document.getElementById('btn-lobby').addEventListener('click', () => showLobby());
}

export function showLobby() {
  hideAllScreens();
  showHUD(false);
  const s = els['screen-lobby'];
  const hero = getHero();
  const defName = (hero && hero.name) || ('raider' + Math.floor(Math.random() * 100));
  const relayAddr = `wss://architectural-applicants-musicians-particles.trycloudflare.com`;

  // Persistent listeners (registered once for the whole session).
  if (!showLobby._wired) {
    showLobby._wired = true;
    on('lobbyList', (m) => { if (showLobby._mode === 'browse' && showLobby._render) showLobby._render(m.lobbies || []); });
    on('lobbyAdd', () => { if (showLobby._mode === 'browse') lobbyList(); });
    on('lobbyUpdate', () => { if (showLobby._mode === 'browse') lobbyList(); });
    on('lobbyRemove', () => { if (showLobby._mode === 'browse') lobbyList(); });
    on('memberJoin', () => { if (showLobby._mode === 'room') renderRoom(); });
    on('memberLeave', () => { if (showLobby._mode === 'room') renderRoom(); });
    on('host', () => { if (showLobby._mode === 'room') renderRoom(); });
    // cosmetic: reflect socket loss on the status strip
    onClose(() => { if (showLobby._setConn) showLobby._setConn('off', 'DISCONNECTED'); });
  }

  // If already in a room, show the "in lobby" screen instead of the browser.
  if (MP.isMp()) {
    showLobby._mode = 'room';
    renderRoom();
    return;
  }
  showLobby._mode = 'browse';

  // ---- connection status strip (connected / host / error) ----
  // Purely cosmetic: reads Net.* + MP.* state, never mutates it.
  const setConn = (state, text) => {
    const el = document.getElementById('lobby-conn');
    if (!el) return;
    el.className = 'lobby-conn is-' + state;
    el.innerHTML = `<span class="dot"></span><span>${text}</span>`;
  };
  showLobby._setConn = setConn;
  const refreshConn = () => {
    if (!Net.connected) { setConn('off', 'DISCONNECTED'); return; }
    if (MP.isMpHost()) setConn('host', `CONNECTED · HOST${Net.room ? ' · ' + Net.room : ''}`);
    else if (MP.isMp()) setConn('on', `CONNECTED · GUEST${Net.room ? ' · ' + Net.room : ''}`);
    else setConn('on', 'CONNECTED TO RAID SERVER');
  };
  showLobby._refreshConn = refreshConn;

  const renderList = (lobbies) => {
    const box = document.getElementById('lobby-list');
    if (!box) return;
    showLobby._render = renderList;
    refreshConn();
    if (!lobbies.length) {
      box.innerHTML = '<div class="lobby-empty">NO OPEN LOBBIES &mdash; FORGE YOUR OWN BELOW</div>';
      return;
    }
    box.innerHTML = lobbies.map(l => `
      <div class="lobby-row">
        <span class="lobby-gem"></span>
        <div class="lobby-meta">
          <div class="lobby-name">${l.name}</div>
          <div class="lobby-sub">host <b>${l.host}</b> &middot; ${l.players}/${l.max} raiders</div>
        </div>
        <button class="lobby-join" data-id="${l.id}">JOIN</button>
      </div>`).join('');
    box.querySelectorAll('.lobby-join').forEach(b => {
      b.addEventListener('click', () => {
        const name = (document.getElementById('lobby-name').value.trim()) || defName;
        MP.joinLobby(relayAddr, b.dataset.id, name).then(() => {
          showLobby._mode = 'room';
          renderRoom();
        }).catch(() => {
          setConn('err', 'COULD NOT JOIN');
          const st = document.getElementById('lobby-status');
          if (st) { st.textContent = 'Could not join — lobby may have closed.'; st.style.color = '#ff6040'; }
        });
      });
    });
  };
  showLobby._render = renderList;

  s.innerHTML = `
    <div class="df-title">
      <div class="arch"></div>
      <div class="plaque"></div>
      <h1>ONLINE LOBBIES</h1>
      <h2>PICK A RAID, OR OPEN YOUR OWN</h2>
    </div>
    <div class="df-rule"></div>
    <div class="lobby-conn is-wait" id="lobby-conn"><span class="dot"></span><span>REACHING THE RAID SERVER…</span></div>
    <div class="lobby-listbox"><div class="lobby-listbox-inner" id="lobby-list"></div></div>
    <div class="lobby-create">
      <div class="lobby-heading">CREATE A LOBBY</div>
      <div class="row" style="justify-content:center;align-items:center;margin-top:10px">
        <input id="lobby-name" style="width:190px" placeholder="your name" value="${defName}"/>
        <input id="lobby-title" style="width:210px" placeholder="lobby name (e.g. Night Raid)"/>
      </div>
      <div style="margin-top:10px"><button id="btn-create-lobby">CREATE LOBBY</button></div>
      <div class="small" id="lobby-status"></div>
    </div>
    <button class="big" id="btn-lobby-back" style="margin-top:10px">BACK</button>
  `;
  s.classList.add('active');
  s.classList.add('menu-df');

  MP.openLobby(relayAddr).then(() => { refreshConn(); lobbyList(); }).catch(() => {
    setConn('err', 'RAID SERVER UNREACHABLE');
    const st = document.getElementById('lobby-status');
    if (st) { st.textContent = 'Could not reach the raid server. Is it running?'; st.style.color = '#ff6040'; }
  });

  document.getElementById('btn-create-lobby').addEventListener('click', () => {
    const name = (document.getElementById('lobby-name').value.trim()) || defName;
    const title = (document.getElementById('lobby-title').value.trim()) || (name + "'s raid");
    const st = document.getElementById('lobby-status');
    st.textContent = 'Creating lobby...';
    st.style.color = '#9a8f78';
    setConn('wait', 'FORGING LOBBY…');
    MP.createLobby(relayAddr, title, name).then(() => {
      showLobby._mode = 'room';
      renderRoom();
    }).catch(() => {
      setConn('err', 'RAID SERVER UNREACHABLE');
      st.textContent = 'Could not reach the raid server. Is it running?';
      st.style.color = '#ff6040';
    });
  });

  document.getElementById('btn-lobby-back').addEventListener('click', () => showLoadout());

  // ---- "in a room" view ----
  function renderRoom() {
    showLobby._mode = 'room';
    showLobby._renderRoom = renderRoom;
    const members = [...Net.members.values()];
    s.innerHTML = `
      <div class="df-title">
        <div class="arch"></div>
        <div class="plaque"></div>
        <h1>IN LOBBY</h1>
        <h2>${MP.isMpHost() ? 'YOU ARE THE HOST' : 'JOINED THE HOST'}</h2>
      </div>
      <div class="df-rule"></div>
      <div class="lobby-conn ${MP.isMpHost() ? 'is-host' : 'is-on'}" id="lobby-conn">
        <span class="dot"></span>
        <span>${MP.isMpHost() ? 'CONNECTED · HOST' : 'CONNECTED · GUEST'}${Net.room ? ' · ROOM ' + Net.room : ''}</span>
      </div>
      <div class="lobby-listbox">
        <div class="lobby-heading" style="color:#c9b577;letter-spacing:5px;font-size:14px;text-align:center">RAIDERS (${members.length})</div>
        <div class="lobby-listbox-inner" style="margin-top:10px">
          ${members.map(m => `
            <div class="lobby-row member">
              <span class="lobby-gem"></span>
              <div class="lobby-meta">
                <div class="lobby-name">${m.name}</div>
                <div class="lobby-sub">${m.host ? '<span class="tag-host">&#9733; HOST</span>' : '<span class="tag-you">RAIDER</span>'}${m.id === Net.id ? ' &middot; you' : ''}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>
      <button class="big" id="btn-lobby-enter">ENTER GRIMHOLD</button>
      <button class="big" id="btn-lobby-leave" style="border-color:#a55">LEAVE LOBBY</button>
    `;
    s.classList.add('active');
    s.classList.add('menu-df');
    const enter = document.getElementById('btn-lobby-enter');
    if (enter) enter.addEventListener('click', () => {
      try { document.querySelector('canvas')?.requestPointerLock?.(); } catch {}
      try { game.startRun(selectedPreset); }
      catch (e) { console.log('ENTER ERR: ' + (e && e.stack || e)); }
    });
    const leave = document.getElementById('btn-lobby-leave');
    if (leave) leave.addEventListener('click', () => { disconnect(); showLoadout(); });
  }
}

export function showResult(extracted, lines) {
  hideAllScreens();
  showHUD(false);
  const meta = getMeta();
  const s = els['screen-result'];
  s.innerHTML = `
    <h1 style="color:${extracted ? '#4da84d' : '#b8122a'}">${extracted ? 'EXTRACTED' : 'SLAIN'}</h1>
    ${extracted ? '' : '<canvas id="champion-dead" style="width:280px;height:300px"></canvas>'}
    <div class="panel" style="text-align:center;min-width:420px">
      ${lines.map(l => `<div style="margin:4px 0">${l}</div>`).join('')}
      <div style="margin-top:10px;color:#e8c85a">VAULT GOLD: ${meta.gold}</div>
    </div>
    <button class="big" id="btn-return">RETURN TO THE VAULT</button>
  `;
  s.classList.add('active');
  if (!extracted) {
    // your fallen champion, in the armor you chose
    const dc = document.getElementById('champion-dead');
    const tryDead = () => {
      if (!document.body.contains(dc)) return;
      if (!startChampionPreview(dc, { death: true })) setTimeout(tryDead, 800);
    };
    tryDead();
  }
  document.getElementById('btn-return').addEventListener('click', () => showLoadout());
}

export function hideScreens() {
  stopChampionPreview();
  hideAllScreens();
}
