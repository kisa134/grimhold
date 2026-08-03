// mp.js — multiplayer glue: host-authoritative LAN co-op (MVP).
//
// Roles:
//  - HOST: simulates enemies exactly like single-player, broadcasts 10 Hz
//    enemy snapshots + loot events, applies remote players' hit/kick intents.
//    Enemies target the NEAREST living player (host or remote) — remote
//    players are represented host-side by lightweight shims.
//  - CLIENT: hides local enemy AI, renders proxies from snapshots, sends
//    hit/kick intents and loot pickups to the host.
//  - Everyone broadcasts their own champion state at 15 Hz (pos, yaw, anim
//    key, weapon) and renders the others as RemoteAvatars.
// Friendly fire: OFF. Extraction: individual.
import * as THREE from 'three';
import {
  Net, connect, on, onClose, send, toHost, fromHost, sendEvent,
} from './net.js';
import { RemoteAvatar, EnemyProxy } from './remotes.js';
import { weaponStats } from './weapons.js';
import { getChampionId } from './champion.js';
import { getHero } from './hero.js';
import { CFG } from './config.js';

let game = null;
const avatars = new Map();  // member id -> RemoteAvatar
const proxies = new Map();  // enemy id -> EnemyProxy
const shims = new Map();    // member id -> host-side target shim
let stateAcc = 0;
let snapAcc = 0;

const r2 = (v) => Math.round(v * 100) / 100;

export const isMp = () => Net.connected;
export const isMpHost = () => Net.connected && Net.isHost;
export const isMpClient = () => Net.connected && !Net.isHost;

// ---------------- lifecycle ----------------

export function initMp(g) {
  game = g;

  // enemy targeting: nearest living player (host + remote shims).
  // Returning null keeps single-player behavior via the `|| g.player` fallback.
  g.pickTarget = (enemy) => {
    if (!isMpHost()) return null;
    let best = null, bd = Infinity;
    if (g.player && !g.player.dead) {
      best = g.player;
      bd = enemy.pos.distanceTo(g.player.pos);
    }
    for (const t of shims.values()) {
      if (t.dead) continue;
      const d = enemy.pos.distanceTo(t.pos);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  };

  // enemy strike lands on whichever player it was targeting
  g.hurtTarget = (target, dmg, srcPos, enemy) => {
    if (target && target.isRemote) {
      // unp: boss unparryable heavy — the client resolves guard break itself
      fromHost({ k: 'dmg', to: target.id, dmg: Math.round(dmg), x: srcPos.x, z: srcPos.z,
        unp: enemy && enemy.atkUnparryable ? 1 : 0 });
    } else {
      g.damagePlayer(dmg, srcPos, enemy);
    }
  };

  on('state', (m) => {
    const av = avatarFor(m.id);
    if (av) av.setState(m.d || {});
    const sh = shims.get(m.id);
    if (sh && m.d) {
      if (m.d.p) sh.pos.set(m.d.p[0], m.d.p[1], m.d.p[2]);
      sh.dead = !!m.d.dead;
      sh.attack.phase = m.d.ap || 'idle';
      sh.attack.heavy = !!m.d.ah;
      sh.stamina = m.d.st ?? 50;
    }
  });

  on('memberJoin', (m) => {
    game.notify(`${m.member.name} rides into the raid`, '#6fb7ff');
    if (isMpHost() && game.state === 'run') {
      sendLootInit();
      sendEnemySnapshot();
    }
  });

  on('memberLeave', (m) => {
    const av = avatars.get(m.id);
    if (av) { av.dispose(); avatars.delete(m.id); }
    shims.delete(m.id);
    game.notify('A raider left the party', '#9a8f78');
  });

  on('host', (m) => {
    if (m.id === Net.id) {
      game.notify('HOST LEFT — you are the host now, but enemy sync is degraded (restart advised)', '#ffb060');
    }
  });

  on('toHost', (m) => {
    const d = m.d || {};
    if (d.k === 'hit') hostApplyHit(d);
    else if (d.k === 'kick') hostApplyKick(d);
    else if (d.k === 'lootTake') hostLootTake(d);
  });

  on('fromHost', (m) => {
    const d = m.d || {};
    if (d.k === 'enemies') applyEnemySnapshot(d.list);
    else if (d.k === 'lootInit' || d.k === 'lootAdd') addLootEntries(d.list);
    else if (d.k === 'lootGone') removeLootEntry(d.id);
    else if (d.k === 'dmg' && d.to === Net.id) {
      if (game.state === 'run' && game.player && !game.player.dead) {
        game.damagePlayer(d.dmg, new THREE.Vector3(d.x, 0, d.z), null,
          { unparryable: !!d.unp });
      }
    }
  });

  on('event', (m) => {
    const d = m.d || {};
    if (d.k === 'life') {
      const mem = Net.members.get(m.id);
      const nm = (mem && mem.name) || 'A raider';
      if (d.what === 'extracted') game.notify(`${nm} EXTRACTED with the spoils`, '#6fe86f');
      else if (d.what === 'died') game.notify(`${nm} DIED in the dark`, '#ff6040');
    }
  });

  onClose(() => {
    game.notify('RAID CONNECTION LOST', '#ff6040');
    for (const [, av] of avatars) av.dispose();
    avatars.clear();
    shims.clear();
  });
}

// Connect once (idempotent) — if a lobby socket is already open we reuse it so
// the host never drops when entering a room.
function ensureConnected(addr) {
  if (Net.ws && Net.ws.readyState === 1) return Promise.resolve();
  return connect(addr);
}

// UI entry: make sure the lobby socket is open (idempotent) then return.
export function openLobby(addr) {
  return ensureConnected(addr);
}

function joinMeta() {
  const hero = getHero();
  const meta = { champion: String(getChampionId()) };
  if (hero) meta.hero = { parts: hero.parts, name: hero.name };
  return meta;
}

export function join(addr, room, name) {
  return ensureConnected(addr).then(() => Net.join(room, name, joinMeta())).then((w) => {
    for (const mem of w.members) {
      if (mem.id === w.id) continue;
      if (!shims.has(mem.id)) shims.set(mem.id, mkShim(mem.id));
    }
    game.notify(w.host
      ? 'ONLINE RAID — you are the HOST'
      : 'ONLINE RAID — joined the host', '#6fb7ff');
    return w;
  });
}

// Create a named lobby (you become host). Lobby id is generated server-side.
export function createLobby(addr, lobbyName, name) {
  return ensureConnected(addr).then(() => Net.createLobby(lobbyName, name, joinMeta())).then((w) => {
    game.notify(`LOBBY "${lobbyName}" created — you are the HOST`, '#6fb7ff');
    return w;
  });
}

// Join an existing lobby by id.
export function joinLobby(addr, lobbyId, name) {
  return ensureConnected(addr).then(() => Net.joinLobby(lobbyId, name, joinMeta())).then((w) => {
    game.notify(w.host ? 'ONLINE RAID — you are the HOST' : 'ONLINE RAID — joined the host', '#6fb7ff');
    return w;
  });
}

// ---------------- avatars / shims ----------------

function mkShim(id) {
  return {
    id, isRemote: true,
    pos: new THREE.Vector3(0, -999, 0),
    dead: false,
    attack: { phase: 'idle', heavy: false },
    stamina: 50,
    stats: { maxStamina: 100 },
  };
}

function avatarFor(id) {
  let av = avatars.get(id);
  if (!av) {
    const mem = Net.members.get(id);
    av = new RemoteAvatar(game.scene, {
      id,
      name: (mem && mem.name) || `raider ${id}`,
      meta: (mem && mem.meta) || {},
    });
    avatars.set(id, av);
    if (!shims.has(id)) shims.set(id, mkShim(id));
  }
  return av;
}

// ---------------- run lifecycle ----------------

export function onRunStart() {
  proxies.clear(); // proxy groups were already disposed by startRun
  stateAcc = 0;
  snapAcc = 0;
  if (isMpHost()) sendLootInit();
}

export function sendLifeEvent(what) {
  if (Net.connected) sendEvent({ k: 'life', what });
}

// ---------------- loot sync ----------------

function lootList(entries) {
  return entries.map((e) => ({
    id: e.id, item: e.item,
    x: e.mesh.position.x, y: e.baseY, z: e.mesh.position.z,
  }));
}

function sendLootInit() {
  fromHost({ k: 'lootInit', list: lootList(game.loot.entries) });
}

// host: an enemy died and dropped entries — broadcast the ones added after
// index `before`
export function hostLootDropped(before) {
  if (!isMpHost()) return;
  const fresh = game.loot.entries.slice(before);
  if (fresh.length) fromHost({ k: 'lootAdd', list: lootList(fresh) });
}

// local player picked an entry up (E) — tell the room so it disappears for all
export function notifyLootTaken(entry) {
  if (!Net.connected) return;
  if (Net.isHost) fromHost({ k: 'lootGone', id: entry.id });
  else toHost({ k: 'lootTake', id: entry.id });
}

function hostLootTake(d) {
  const e = game.loot.entries.find((x) => x.id === d.id);
  if (e) {
    game.loot.take(e);
    fromHost({ k: 'lootGone', id: d.id });
  }
}

function addLootEntries(list) {
  if (!game.loot || !Array.isArray(list)) return;
  for (const it of list) {
    if (game.loot.entries.some((e) => e.id === it.id)) continue;
    game.loot.add(it.item, it.x, it.y, it.z, it.id);
  }
}

function removeLootEntry(id) {
  if (!game.loot) return;
  const e = game.loot.entries.find((x) => x.id === id);
  if (e) game.loot.take(e);
}

// ---------------- host: remote hit/kick intents ----------------

function hostApplyHit(d) {
  const e = game.enemies[d.id];
  if (!e || e.dead || e.isProxy) return;
  const w = weaponStats(d.w || { key: 'sword', rarity: 'common' });
  const srcPos = new THREE.Vector3(
    d.p ? d.p[0] : 0, d.p ? d.p[1] : 0, d.p ? d.p[2] : 0);
  e.takeHit(d.part, d.dmg, w.type, w, !!d.heavy, srcPos,
    { riposteMult: CFG.combat.riposteCrit, severBonus: CFG.combat.riposteSeverBonus,
      grazed: !!d.grazed, charge: d.chg || 0, dir: d.dir || null });
}

function hostApplyKick(d) {
  const e = game.enemies[d.id];
  if (!e || e.dead || e.isProxy) return;
  e.applyKick(d.dmg, new THREE.Vector3(d.x, 0, d.z));
}

// ---------------- host -> clients: enemy snapshots (10 Hz) ----------------

function enemyAnimKey(e) {
  if (e.anim && e.anim.currentKey) return e.anim.currentKey;
  if (e.dead) return 'deathF';
  switch (e.state) {
    case 'windup': case 'strike': return 'atkA';
    case 'chase': return 'run';
    case 'block': return 'block';
    case 'stagger': return 'stagger';
    case 'patrol': return 'walk';
    default: return 'idle';
  }
}

function sendEnemySnapshot() {
  const list = game.enemies.map((e, i) => [
    i,
    e.boss ? 'boss' : (e.kind || 'bandit'),
    r2(e.pos.x), r2(e.pos.z), r2(e.yaw),
    enemyAnimKey(e),
    r2(e.parts.torso.hp / e.parts.torso.maxHp),
    e.dead ? 1 : 0,
  ]);
  fromHost({ k: 'enemies', list });
}

function applyEnemySnapshot(list) {
  if (!isMpClient() || game.state !== 'run' || !Array.isArray(list)) return;
  for (const [id, type, x, z, yaw, anim, hp, dead] of list) {
    let px = proxies.get(id);
    if (!px) {
      px = new EnemyProxy(game, id, type);
      proxies.set(id, px);
      game.enemies.push(px);
    }
    px.applySnap({ x, z, yaw, anim, hp, dead: !!dead });
  }
}

// ---------------- per-frame ----------------

export function update(dt) {
  if (!Net.connected) return;
  const inRun = game.state === 'run';
  for (const [, av] of avatars) av.update(dt, inRun);
  if (!inRun || !game.player) return;

  // own champion state @ 15 Hz
  stateAcc += dt;
  if (stateAcc >= 1 / 15) {
    stateAcc = 0;
    const p = game.player;
    send({
      t: 'state',
      d: {
        p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)],
        yaw: r2(p.yaw),
        anim: game.playerBody ? game.playerBody.animKey : 'idle',
        w: p.wstats.key,
        dead: p.dead ? 1 : 0,
        ap: p.attack.phase,
        ah: p.attack.heavy ? 1 : 0,
        st: Math.round(p.stamina),
      },
    });
  }

  // host: enemy snapshots @ 10 Hz
  if (isMpHost()) {
    snapAcc += dt;
    if (snapAcc >= 1 / 10) {
      snapAcc = 0;
      sendEnemySnapshot();
    }
  }
}
