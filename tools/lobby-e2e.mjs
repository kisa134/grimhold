// End-to-end lobby test THROUGH the cloudflare tunnel (wss://...trycloudflare).
// Host creates a lobby and stays connected; a "friend" joins it; we assert the
// friend got welcome with 2 members in the same room as the host.
import { WebSocket } from 'ws';
const URL = 'wss://architectural-applicants-musicians-particles.trycloudflare.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mk(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, id: null, host: false, room: null, members: 0, lobbyId: null };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'welcome') { c.id = m.id; c.host = m.host; c.room = m.room; c.members = m.members.length; }
    else if (m.t === 'lobbyList') { c.list = m.lobbies; }
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.open = () => new Promise((r) => ws.on('open', r));
  return c;
}

(async () => {
  const A = mk('Host');
  await A.open();
  A.send({ t: 'lobbyCreate', name: 'E2E Raid', hostName: 'Host' });
  // wait for host welcome (tunnel can be slow)
  await new Promise((res) => {
    const iv = setInterval(() => { if (A.room) { clearInterval(iv); res(); } }, 100);
    setTimeout(() => { clearInterval(iv); res(); }, 9000);
  });
  if (!A.room) { console.log('FAIL: host not in room'); process.exit(1); }
  console.log(`Host: room=${A.room} host=${A.host}`);

  const B = mk('Friend');
  await B.open();
  B.send({ t: 'lobbyList' });
  await new Promise((res) => {
    const iv = setInterval(() => { if (B.list) { clearInterval(iv); res(); } }, 100);
    setTimeout(() => { clearInterval(iv); res(); }, 9000);
  });
  const seen = (B.list || []).find((l) => l.name === 'E2E Raid');
  if (!seen) { console.log('FAIL: friend cannot see lobby. list=' + JSON.stringify(B.list)); process.exit(1); }
  console.log(`Friend sees: ${seen.name}:${seen.players}`);

  B.send({ t: 'lobbyJoin', id: seen.id, name: 'Friend' });
  await new Promise((res) => {
    const iv = setInterval(() => { if (B.room) { clearInterval(iv); res(); } }, 100);
    setTimeout(() => { clearInterval(iv); res(); }, 9000);
  });
  console.log(`Friend: room=${B.room} host=${B.host} members=${B.members}`);

  const pass = A.host && !B.host && B.room === A.room && B.members === 2;
  console.log(pass ? 'E2E LOBBY TEST: PASS ✅' : 'E2E LOBBY TEST: FAIL ❌');
  process.exit(pass ? 0 : 1);
})();

