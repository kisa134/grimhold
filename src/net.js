// net.js — tiny WebSocket client layer for GRIMHOLD online co-op (lobby build).
// Pure browser module: WebSocket is only touched inside connect(), so importing
// this file is safe everywhere.
//
// ONE socket serves the whole lobby + room lifecycle (no second browse socket,
// which previously caused the host to disconnect the moment a lobby was made).
//
// Envelope protocol (all JSON):
//   client -> server (lobby):
//       {t:'lobbyList'}                       -> {t:'lobbyList', lobbies:[...]}
//       {t:'lobbyCreate', name, hostName, meta} -> {t:'welcome', ...} + {t:'lobbyAdd'}
//       {t:'lobbyJoin', id, name, meta}        -> {t:'welcome', ...} + {t:'lobbyUpdate'}
//       {t:'join', room, name, meta}           (legacy direct room, ?mp=1)
//   client -> server (in room):
//       {t:'state', d} relayed to others        {t:'event', d}
//       {t:'toHost', d} / {t:'fromHost', d}
//   server -> client: {t:'welcome', id, host, room, members}
//                     {t:'lobbyList'|'lobbyAdd'|'lobbyUpdate'|'lobbyRemove'}
//                     {t:'memberJoin'|'memberLeave'|'host'}
export const Net = {
  ws: null,
  connected: false,
  id: null,
  isHost: false,
  room: null,
  name: null,
  members: new Map(), // id -> {id, name, meta, host}
};

const handlers = new Map();   // t -> [fn]
const closeHandlers = [];
let welcomeResolvers = [];     // pending promises awaiting a 'welcome'

export function on(t, fn) {
  if (!handlers.has(t)) handlers.set(t, []);
  handlers.get(t).push(fn);
}
export function onClose(fn) { closeHandlers.push(fn); }

function dispatch(m) {
  const list = handlers.get(m.t);
  if (list) for (const fn of list) fn(m);
}

export function send(obj) {
  if (Net.ws && Net.ws.readyState === 1) Net.ws.send(JSON.stringify(obj));
}
export function toHost(d) { send({ t: 'toHost', d }); }
export function fromHost(d) { send({ t: 'fromHost', d }); }
export function sendEvent(d) { send({ t: 'event', d }); }

// Open a single socket to the relay. Does NOT auto-send anything — callers
// drive it with lobbyList()/createLobby()/joinLobby()/join(). The socket stays
// open for the whole session (browsing -> joined room) so the host never drops.
export function connect(url) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(url); }
    catch (e) { reject(e); return; }
    Net.ws = ws;
    Net.connected = false;

    ws.onopen = () => { Net.connected = true; resolve(); };
    ws.onerror = () => { if (!Net.connected) reject(new Error('ws error')); };
    ws.onclose = (e) => {
      const was = Net.connected;
      Net.connected = false;
      Net.isHost = false;
      Net.ws = null;
      Net.members.clear();
      for (const r of welcomeResolvers) r.reject(new Error('closed'));
      welcomeResolvers = [];
      if (was) for (const fn of closeHandlers) fn();
      if (typeof window !== 'undefined') console.log('[net] ws onclose code=' + (e && e.code) + ' was=' + was);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') {
        Net.id = m.id;
        Net.isHost = !!m.host;
        Net.members.clear();
        for (const mem of m.members) Net.members.set(mem.id, mem);
        for (const r of welcomeResolvers) r.resolve(m);
        welcomeResolvers = [];
        return;
      }
      if (m.t === 'memberJoin') Net.members.set(m.member.id, m.member);
      else if (m.t === 'memberLeave') Net.members.delete(m.id);
      else if (m.t === 'host') {
        Net.isHost = m.id === Net.id;
        const me = Net.members.get(m.id);
        if (me) me.host = true;
      }
      dispatch(m);
    };
  });
}

// ---- lobby + room actions (all on the same open socket) ----

export function lobbyList() { send({ t: 'lobbyList' }); }

export function createLobby(name, hostName, meta = {}) {
  return new Promise((resolve, reject) => {
    welcomeResolvers.push({ resolve, reject });
    send({ t: 'lobbyCreate', name, hostName, meta });
  });
}

export function joinLobby(id, name, meta = {}) {
  return new Promise((resolve, reject) => {
    welcomeResolvers.push({ resolve, reject });
    send({ t: 'lobbyJoin', id, name, meta });
  });
}

export function join(room, name, meta = {}) {
  return new Promise((resolve, reject) => {
    welcomeResolvers.push({ resolve, reject });
    send({ t: 'join', room, name, meta });
  });
}

export function disconnect() {
  if (Net.ws) Net.ws.close();
}
