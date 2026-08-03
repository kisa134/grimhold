// server.mjs — GRIMHOLD LAN co-op relay server (MVP).
// Node + ws. Pure relay + room state; the game logic stays on the host client.
//
// Rooms keyed by room id. First client in a room is the HOST.
//   join      {t:'join', room, name, meta}  -> {t:'welcome', id, host, room, members}
//   state     {t:'state', d}     -> relayed to all others as {t:'state', id, d}
//   event     {t:'event', d}     -> relayed to all others as {t:'event', id, d}
//   toHost    {t:'toHost', d}    -> relayed to the host as {t:'toHost', from, d}
//   fromHost  {t:'fromHost', d}  -> (host only) relayed to all non-host members
//   disconnects broadcast {t:'memberLeave', id}; if the host leaves, the next
//   member is PROMOTED ({t:'host', id}) — note: enemy simulation state does
//   NOT migrate, so a host leaving mid-run degrades sync (restart advised).
//
// Run: npm run mp:server   (default port 8787, override with PORT env)
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8787);
const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });
const rooms = new Map(); // roomId -> {id, members: Map<id, member>, hostId, nextId}

function getRoom(id) {
  let r = rooms.get(id);
  if (!r) {
    r = { id, members: new Map(), hostId: null, nextId: 1 };
    rooms.set(id, r);
  }
  return r;
}

function sendTo(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(room, obj, exceptId) {
  for (const [id, m] of room.members) {
    if (id !== exceptId) sendTo(m.ws, obj);
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
      console.log(`[mp] #${cid} "${member.name}" joined room "${room.id}" (${room.members.size} members, host=#${room.hostId})`);
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
    if (room.members.size === 0) rooms.delete(room.id);
    room = null;
    cid = null;
  });
});

console.log(`[grimhold-mp] relay listening on 0.0.0.0:${PORT}`);
