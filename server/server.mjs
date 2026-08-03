// server.mjs — GRIMHOLD online co-op relay server (lobby build).
// Node + ws. Pure relay + room/lobby state; the game logic stays on the host client.
//
// Rooms keyed by room id. First client in a room is the HOST.
//   lobbyCreate {t:'lobbyCreate', name, hostName, meta}
//        -> {t:'welcome', id, host, room, members}  (room = generated lobby id)
//        -> broadcast {t:'lobbyAdd', lobby}
//   lobbyList   {t:'lobbyList'}  -> {t:'lobbyList', lobbies:[{id,name,host,players,max}]}
//   lobbyJoin   {t:'lobbyJoin', id, name, meta}  -> {t:'welcome', ...}
//        -> broadcast {t:'lobbyUpdate', lobby}
//   join        {t:'join', room, name, meta}  -> {t:'welcome', id, host, room, members}
//        (legacy: no lobby listing; room keyed by provided id, default 'keep')
//   state/event/toHost/fromHost: relay as before.
//   disconnects broadcast {t:'memberLeave', id}; if the host leaves, the next
//   member is PROMOTED ({t:'host', id}). Empty rooms/lobbies are removed and
//   broadcast as {t:'lobbyRemove', id}.
//
// Run: npm run mp:server   (default port 8787, override with PORT env)
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

const PORT = Number(process.env.PORT || 8787);
const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });
const rooms = new Map(); // roomId -> {id, name, members: Map<id, member>, hostId, nextId}

function getRoom(id, name) {
  let r = rooms.get(id);
  if (!r) {
    r = { id, name: name || null, members: new Map(), hostId: null, nextId: 1 };
    rooms.set(id, r);
  }
  return r;
}

// Lobby public view (for the browser LOBBY screen).
function lobbyView(r) {
  const host = r.members.get(r.hostId);
  return {
    id: r.id,
    name: r.name || (host ? host.name + "'s raid" : 'Raid'),
    host: host ? host.name : '—',
    players: r.members.size,
    max: 8,
  };
}

function sendTo(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(room, obj, exceptId) {
  for (const [id, m] of room.members) {
    if (id !== exceptId) sendTo(m.ws, obj);
  }
}

// Lobby events go to EVERY connection (so the lobby list screen stays live for
// everyone browsing, even before they join a room).
function broadcastLobbies(obj) {
  for (const c of wss.clients) {
    if (c.readyState === 1) c.send(JSON.stringify(obj));
  }
}

const pub = (room, m) => ({ id: m.id, name: m.name, meta: m.meta, host: m.id === room.hostId });

wss.on('connection', (ws) => {
  let room = null;
  let cid = null;

  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }

    if (m.t === 'join') {
      if (room) return; // already joined
      room = getRoom(String(m.room || 'keep').slice(0, 32));
      cid = room.nextId++;
      const member = {
        id: cid,
        name: String(m.name || 'raider').slice(0, 24),
        meta: (m.meta && typeof m.meta === 'object') ? m.meta : {},
        ws,
      };
      room.members.set(cid, member);
      if (room.hostId == null) room.hostId = cid;
      sendTo(ws, {
        t: 'welcome', id: cid, host: room.hostId === cid, room: room.id,
        members: [...room.members.values()].map((x) => pub(room, x)),
      });
      broadcast(room, { t: 'memberJoin', member: pub(room, member) }, cid);
      if (room.name) broadcastLobbies({ t: 'lobbyUpdate', lobby: lobbyView(room) });
      console.log(`[mp] #${cid} "${member.name}" joined room "${room.id}" (${room.members.size} members, host=#${room.hostId})`);
      return;
    }

    // ---- Lobby API ----
    if (m.t === 'lobbyCreate') {
      if (room) return; // already in a room
      const id = randomUUID().slice(0, 8);
      const name = String(m.name || 'Raid').slice(0, 32) || 'Raid';
      room = getRoom(id, name);
      cid = room.nextId++;
      const member = {
        id: cid,
        name: String(m.hostName || m.name || 'host').slice(0, 24),
        meta: (m.meta && typeof m.meta === 'object') ? m.meta : {},
        ws,
      };
      room.members.set(cid, member);
      room.hostId = cid;
      sendTo(ws, {
        t: 'welcome', id: cid, host: true, room: room.id,
        members: [...room.members.values()].map((x) => pub(room, x)),
      });
      broadcastLobbies({ t: 'lobbyAdd', lobby: lobbyView(room) });
      console.log(`[mp] lobby "${name}" (${id}) created by #${cid} "${member.name}"`);
      return;
    }

    if (m.t === 'lobbyList') {
      const list = [...rooms.values()].filter(r => r.name).map(lobbyView);
      sendTo(ws, { t: 'lobbyList', lobbies: list });
      return;
    }

    if (m.t === 'lobbyJoin') {
      if (room) return; // already in a room
      room = rooms.get(String(m.id || '').slice(0, 32));
      if (!room || !room.name) { sendTo(ws, { t: 'lobbyErr', msg: 'Lobby not found' }); return; }
      cid = room.nextId++;
      const member = {
        id: cid,
        name: String(m.name || 'raider').slice(0, 24),
        meta: (m.meta && typeof m.meta === 'object') ? m.meta : {},
        ws,
      };
      room.members.set(cid, member);
      if (room.hostId == null) room.hostId = cid;
      sendTo(ws, {
        t: 'welcome', id: cid, host: room.hostId === cid, room: room.id,
        members: [...room.members.values()].map((x) => pub(room, x)),
      });
      broadcast(room, { t: 'memberJoin', member: pub(room, member) }, cid);
      broadcastLobbies({ t: 'lobbyUpdate', lobby: lobbyView(room) });
      console.log(`[mp] #${cid} "${member.name}" joined lobby "${room.id}" (${room.members.size} players)`);
      return;
    }

    if (!room || cid == null || !m || typeof m.t !== 'string') return;

    if (m.t === 'state') broadcast(room, { t: 'state', id: cid, d: m.d }, cid);
    else if (m.t === 'event') broadcast(room, { t: 'event', id: cid, d: m.d }, cid);
    else if (m.t === 'toHost') {
      const h = room.members.get(room.hostId);
      if (h && room.hostId !== cid) sendTo(h.ws, { t: 'toHost', from: cid, d: m.d });
    } else if (m.t === 'fromHost') {
      if (cid === room.hostId) broadcast(room, { t: 'fromHost', from: cid, d: m.d }, cid);
    }
  });

  ws.on('close', () => {
    if (!room || cid == null) return;
    room.members.delete(cid);
    console.log(`[mp] #${cid} left room "${room.id}" (${room.members.size} members)`);
    broadcast(room, { t: 'memberLeave', id: cid });
    if (room.hostId === cid) {
      const next = room.members.keys().next().value;
      room.hostId = next ?? null;
      if (next != null) {
        console.log(`[mp] room "${room.id}": host migrated to #${next}`);
        broadcast(room, { t: 'host', id: next });
      }
    }
    if (room.members.size === 0) {
      if (room.name) broadcastLobbies({ t: 'lobbyRemove', id: room.id });
      rooms.delete(room.id);
    } else if (room.name) {
      broadcastLobbies({ t: 'lobbyUpdate', lobby: lobbyView(room) });
    }
    room = null;
    cid = null;
  });
});

console.log(`[grimhold-mp] relay listening on 0.0.0.0:${PORT}`);
