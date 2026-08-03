// mp-test.mjs — headless smoke test for the GRIMHOLD LAN relay server.
// Starts server/server.mjs on a test port, connects two ws clients to the same
// room and asserts: id assignment, host flag, member list, state relay,
// toHost / fromHost routing, leave broadcast and host migration.
// Prints MP TEST OK / MP TEST FAIL and exits 0 / 1.
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 8791;
const URL = `ws://127.0.0.1:${PORT}`;

const fail = (msg) => {
  console.error('MP TEST FAIL:', msg);
  try { srv.kill(); } catch {}
  process.exit(1);
};

// --- start the server ---
const srv = spawn(process.execPath, ['server/server.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvOut = '';
srv.stdout.on('data', (d) => { srvOut += d; });
srv.stderr.on('data', (d) => { srvOut += d; });

await new Promise((res, rej) => {
  const t0 = Date.now();
  const poll = () => {
    if (srvOut.includes('listening')) return res();
    if (Date.now() - t0 > 8000) return rej(new Error('server did not start: ' + srvOut));
    setTimeout(poll, 100);
  };
  poll();
}).catch((e) => fail(e.message));

setTimeout(() => fail('timeout'), 15000).unref();

// --- tiny client helper ---
function client(name) {
  const ws = new WebSocket(URL);
  const c = {
    ws, name,
    inbox: [],
    waiters: [],
    send: (o) => ws.send(JSON.stringify(o)),
    // wait for a message matching pred, with timeout
    waitFor(pred, label, ms = 5000) {
      const hit = c.inbox.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('timeout waiting for ' + label)), ms);
        c.waiters.push({ pred, resolve, reject, to });
      });
    },
  };
  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    c.inbox.push(m);
    for (let i = c.waiters.length - 1; i >= 0; i--) {
      const w = c.waiters[i];
      if (w.pred(m)) {
        clearTimeout(w.to);
        c.waiters.splice(i, 1);
        w.resolve(m);
      }
    }
  });
  ws.on('error', (e) => fail('ws error (' + name + '): ' + e.message));
  return c;
}

const open = (ws) => new Promise((res) => ws.on('open', res));

try {
  // --- two clients join the same room ---
  const c1 = client('alice');
  await open(c1.ws);
  c1.send({ t: 'join', room: 'test', name: 'alice', meta: { champion: '33' } });
  const w1 = await c1.waitFor((m) => m.t === 'welcome', 'welcome #1');
  if (typeof w1.id !== 'number') fail('client 1 got no id');
  if (w1.host !== true) fail('first member should be host');
  if (w1.members.length !== 1) fail('welcome members should contain 1 entry');

  const c2 = client('bob');
  await open(c2.ws);
  const bobHero = { parts: ['Chr_Head_Male_07', 'Chr_Torso_Male_03', 'Chr_Hips_Male_08'], name: 'Bob the Red' };
  c2.send({ t: 'join', room: 'test', name: 'bob', meta: { champion: '12', hero: bobHero } });
  const w2 = await c2.waitFor((m) => m.t === 'welcome', 'welcome #2');
  if (w2.id === w1.id) fail('ids must be unique');
  if (w2.host !== false) fail('second member must not be host');
  if (w2.members.length !== 2) fail('welcome members should contain 2 entries');
  // the created-hero meta must round-trip through the room roster
  const bobInRoster = w2.members.find((m) => m.name === 'bob');
  if (!bobInRoster || !bobInRoster.meta.hero || bobInRoster.meta.hero.name !== 'Bob the Red') {
    fail('hero meta missing from welcome roster');
  }
  if (bobInRoster.meta.hero.parts[1] !== 'Chr_Torso_Male_03') fail('hero parts mangled in roster');

  const join1 = await c1.waitFor((m) => m.t === 'memberJoin', 'memberJoin');
  if (join1.member.name !== 'bob' || join1.member.meta.champion !== '12') {
    fail('memberJoin payload wrong');
  }
  if (!join1.member.meta.hero || join1.member.meta.hero.parts.length !== 3 ||
      join1.member.meta.hero.name !== 'Bob the Red') {
    fail('memberJoin lost the hero meta');
  }

  // --- state relay: bob -> alice, tagged with sender id ---
  c2.send({ t: 'state', d: { p: [1, 2, 3], anim: 'run' } });
  const st = await c1.waitFor((m) => m.t === 'state', 'state relay');
  if (st.id !== w2.id) fail('state not tagged with sender id');
  if (st.d.anim !== 'run') fail('state payload mangled');

  // --- toHost: bob -> host (alice) only ---
  c2.send({ t: 'toHost', d: { k: 'hit', id: 0 } });
  const th = await c1.waitFor((m) => m.t === 'toHost', 'toHost relay');
  if (th.from !== w2.id || th.d.k !== 'hit') fail('toHost payload wrong');
  if (c2.inbox.some((m) => m.t === 'toHost')) fail('toHost leaked to non-host');

  // --- fromHost: host (alice) -> all non-host members ---
  c1.send({ t: 'fromHost', d: { k: 'enemies', list: [] } });
  const fh = await c2.waitFor((m) => m.t === 'fromHost', 'fromHost relay');
  if (fh.from !== w1.id || fh.d.k !== 'enemies') fail('fromHost payload wrong');

  // --- fromHost from a non-host must be ignored ---
  c2.send({ t: 'fromHost', d: { k: 'hack' } });
  await new Promise((r) => setTimeout(r, 300));
  if (c1.inbox.some((m) => m.t === 'fromHost')) fail('non-host fromHost was relayed');

  // --- disconnect: leave broadcast + host migration ---
  c1.ws.close();
  const leave = await c2.waitFor((m) => m.t === 'memberLeave', 'memberLeave');
  if (leave.id !== w1.id) fail('memberLeave id wrong');
  const mig = await c2.waitFor((m) => m.t === 'host', 'host migration');
  if (mig.id !== w2.id) fail('host should migrate to the remaining member');

  c2.ws.close();
  srv.kill();
  console.log('MP TEST OK:',
    `ids=${w1.id},${w2.id}`,
    'hostFlag=ok',
    'heroMeta=ok',
    'stateRelay=ok',
    'toHost=ok',
    'fromHost=ok',
    'migration=ok');
  process.exit(0);
} catch (e) {
  fail(e.message);
}
