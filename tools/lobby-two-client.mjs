// Two-client lobby test against the running relay (localhost:8787).
import { WebSocket } from 'ws';
const URL = 'ws://localhost:8787';

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, id: null, host: false, room: null, lobbies: [], members: 0, left: false };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'welcome') { c.id = m.id; c.host = m.host; c.room = m.room; c.members = m.members.length; }
    else if (m.t === 'lobbyList') c.lobbies = m.lobbies;
    else if (m.t === 'memberJoin') c.members++;
    else if (m.t === 'memberLeave') c.members = Math.max(0, c.members - 1);
  });
  ws.on('close', () => { c.left = true; });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.open = () => new Promise((r) => ws.on('open', r));
  c.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return c;
}

(async () => {
  const A = client('Alice');
  await A.open();
  A.send({ t: 'lobbyCreate', name: 'Test Raid', hostName: 'Alice' });
  await A.wait(300);
  console.log(`A: welcome host=${A.host} room=${A.room} (should be host=true, room set)`);

  const B = client('Bob');
  await B.open();
  B.send({ t: 'lobbyList' });
  await B.wait(300);
  const seen = B.lobbies.find((l) => l.name === 'Test Raid');
  console.log(`B: sees lobbies=${JSON.stringify(B.lobbies.map((l) => l.name + ':' + l.players))} (should include Test Raid)`);

  if (!seen) { console.log('FAIL: B cannot see A\'s lobby'); process.exit(1); }

  B.send({ t: 'lobbyJoin', id: seen.id, name: 'Bob' });
  await B.wait(400);
  console.log(`B: welcome host=${B.host} room=${B.room} (should be host=false, same room as A)`);
  console.log(`A: members after B joined=${A.members} (should be 2)`);
  console.log(`A left? ${A.left} (should be false — host stays connected!)`);

  // A still connected AND sees 2 members -> lobby works end-to-end
  const pass = A.host && !A.left && A.members === 2 && B.room === A.room && !B.host;
  console.log(pass ? 'LOBBY TWO-CLIENT TEST: PASS' : 'LOBBY TWO-CLIENT TEST: FAIL');
  process.exit(pass ? 0 : 1);
})();
