// net.js — tiny WebSocket client layer for GRIMHOLD LAN co-op (MVP).
// Pure browser module: WebSocket is only touched inside connect(), so importing
// this file is safe everywhere.
//
// Envelope protocol (all JSON):
//   client -> server : {t:'join', room, name, meta}
//                      {t:'state', d}      relayed to others as {t:'state', id, d}
//                      {t:'event', d}      relayed to others as {t:'event', id, d}
//                      {t:'toHost', d}     relayed to the host as {t:'toHost', from, d}
//                      {t:'fromHost', d}   (host only) relayed to all non-host
//                                          members as {t:'fromHost', from, d}
//   server -> client : {t:'welcome', id, host, room, members:[{id,name,meta,host}]}
//                      {t:'memberJoin', member} / {t:'memberLeave', id}
//                      {t:'host', id}  (host migration: next member promoted)
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
// convenience wrappers around the relay channels
export function toHost(d) { send({ t: 'toHost', d }); }
export function fromHost(d) { send({ t: 'fromHost', d }); }
export function sendEvent(d) { send({ t: 'event', d }); }

export function connect(url, room, name, meta) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) { reject(e); return; }
    Net.ws = ws;
    Net.room = room;
    Net.name = name;

    const fail = (e) => { if (!settled) { settled = true; reject(e); } };

    ws.onopen = () => send({ t: 'join', room, name, meta });
    ws.onerror = () => fail(new Error('ws error'));
    ws.onclose = () => {
      const was = Net.connected;
      Net.connected = false;
      Net.isHost = false;
      Net.ws = null;
      Net.members.clear();
      fail(new Error('closed before welcome'));
      if (was) for (const fn of closeHandlers) fn();
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') {
        Net.connected = true;
        Net.id = m.id;
        Net.isHost = !!m.host;
        Net.members.clear();
        for (const mem of m.members) Net.members.set(mem.id, mem);
        if (!settled) { settled = true; resolve(m); }
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

// Lobby-aware connect: like connect(), but the first packet is chosen by mode.
//   mode 'join'  -> {t:'join', room, ...}              (legacy / direct room)
//   mode 'create'-> {t:'lobbyCreate', name:lobbyName, hostName:name, ...}
//   mode 'joinLobby' -> {t:'lobbyJoin', id:room, name, ...}
// The welcome envelope is identical, so mp.js works unchanged afterwards.
export function connectLobby(url, opts) {
  const { mode = 'join', room = 'keep', name = 'raider', lobbyName = 'Raid', meta = {} } = opts || {};
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws;
    try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
    Net.ws = ws;
    Net.room = room;
    Net.name = name;

    const fail = (e) => { if (!settled) { settled = true; reject(e); } };

    ws.onopen = () => {
      if (mode === 'create') send({ t: 'lobbyCreate', name: lobbyName, hostName: name, meta });
      else if (mode === 'joinLobby') send({ t: 'lobbyJoin', id: room, name, meta });
      else send({ t: 'join', room, name, meta });
    };
    ws.onerror = () => fail(new Error('ws error'));
    ws.onclose = () => {
      const was = Net.connected;
      Net.connected = false;
      Net.isHost = false;
      Net.ws = null;
      Net.members.clear();
      fail(new Error('closed before welcome'));
      if (was) for (const fn of closeHandlers) fn();
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') {
        Net.connected = true;
        Net.id = m.id;
        Net.isHost = !!m.host;
        Net.members.clear();
        for (const mem of m.members) Net.members.set(mem.id, mem);
        if (!settled) { settled = true; resolve(m); }
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

// Lightweight lobby browser: open a socket, pull the live lobby list, call
// onList(lobbies[]) on every change, resolve once on first snapshot. Returns a
// close() to stop listening. Does NOT join a room.
export function browseLobbies(url, onList) {
  let ws;
  try { ws = new WebSocket(url); } catch { onList([]); return { close() {} }; }
  let first = true;
  const close = () => { try { ws.close(); } catch {} };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'lobbyList' }));
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'lobbyList') { onList(m.lobbies || []); if (first) { first = false; } }
    else if (m.t === 'lobbyAdd' || m.t === 'lobbyUpdate') {
      // server pushes updates but not full list; request a fresh list
      try { ws.send(JSON.stringify({ t: 'lobbyList' })); } catch {}
    } else if (m.t === 'lobbyRemove') {
      try { ws.send(JSON.stringify({ t: 'lobbyList' })); } catch {}
    }
  };
  ws.onerror = () => { if (first) onList([]); };
  return { close };
}

export function disconnect() {
  if (Net.ws) Net.ws.close();
}
