'use strict';
/*
 * Uji chat diskusi:
 *  A) 5 klien socket — chat siang diterima semua pemain; chat dari pemain gugur ditolak.
 *  B) 1 host + 4 bot server — bot ikut berkomentar di chat saat fase diskusi.
 * Server harus jalan di PORT 3100.
 */
const { io } = require('socket.io-client');
const URL = process.env.WW_URL || 'http://localhost:3100';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else { failures++; console.log('  ✗ GAGAL:', msg); }
}
async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (fn()) return true; await sleep(150); }
  throw new Error('Timeout: ' + label);
}

class Client {
  constructor(name) {
    this.name = name;
    this.token = 'chat-' + name + '-' + Math.random().toString(36).slice(2, 7);
    this.state = null;
    this.lastKey = '';
    this.socket = io(URL, { transports: ['websocket'], reconnection: false });
    this.socket.on('state', (s) => { this.state = s; this.act(); });
  }
  emit(ev, d) { this.socket.emit(ev, d); }
  act() {
    const s = this.state;
    if (!s?.you) return;
    const key = [s.phase, s.nightNum, s.you.alive, s.night?.submitted].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    setTimeout(() => {
      const st = this.state;
      if (!st?.you?.alive || st.phase !== 'night' || st.night?.submitted) return;
      const others = st.players.filter(p => p.alive && !p.isYou);
      if (st.you.role === 'werewolf') {
        const prey = others.filter(p => p.role !== 'werewolf');
        if (prey.length) this.emit('nightAction', { target: rnd(prey).token });
      } else if (st.you.role === 'seer') {
        if (others.length) this.emit('nightAction', { target: rnd(others).token });
      } else if (st.you.role === 'doctor') {
        const pool = st.players.filter(p => p.alive);
        if (pool.length) this.emit('nightAction', { target: rnd(pool).token });
      }
    }, 100 + Math.random() * 200);
  }
}

(async () => {
  console.log('== Uji Chat Diskusi ==');
  // ---------- Bagian A ----------
  const names = ['Ana', 'Bima', 'Cici', 'Dodi', 'Eni'];
  const clients = names.map(n => new Client(n));
  await sleep(500);
  const host = clients[0];
  host.emit('createRoom', { name: host.name, token: host.token });
  await waitFor(() => host.state?.code, 5000, 'room A dibuat');
  const code = host.state.code;
  for (let i = 1; i < 5; i++) clients[i].emit('joinRoom', { code, name: clients[i].name, token: clients[i].token });
  await waitFor(() => host.state.players.length === 5, 5000, '5 pemain masuk');
  host.emit('startGame');
  await waitFor(() => clients.every(c => c.state?.phase === 'reveal'), 5000, 'fase reveal');
  host.emit('beginNight');
  await waitFor(() => clients.every(c => c.state?.phase === 'day' || c.state?.phase === 'hunter'), 30000, 'masuk fase siang');
  if (host.state.phase === 'hunter') {
    // pemburu tidak aktif di setting default — seharusnya tidak terjadi; tapi amankan alur
    await waitFor(() => clients.every(c => c.state?.phase === 'day'), 70000, 'siang setelah fase pemburu');
  }
  const aliveClient = clients.find(c => c.state.you.alive);
  const MSG = 'Halo semua, aku curiga sama yang paling diem!';
  aliveClient.emit('chat', { text: MSG });
  await waitFor(() => clients.every(c => (c.state.chat || []).some(m => m.text === MSG)), 5000, 'chat tersebar');
  check(true, 'chat siang dari pemain hidup diterima & terlihat semua pemain');

  const deadClient = clients.find(c => !c.state.you.alive);
  if (deadClient) {
    deadClient.emit('chat', { text: 'Pesan dari arwah' });
    await sleep(1200);
    check(!(host.state.chat || []).some(m => m.text === 'Pesan dari arwah'), 'chat dari pemain gugur ditolak server');
  } else {
    console.log('  (tidak ada korban malam pertama — cek chat pemain gugur dilewati)');
  }
  clients.forEach(c => c.socket.disconnect());
  await sleep(300);

  // ---------- Bagian B ----------
  const host2 = new Client('Solo');
  await sleep(400);
  host2.emit('createRoom', { name: 'Solo', token: host2.token });
  await waitFor(() => host2.state?.code, 5000, 'room B dibuat');
  for (let i = 0; i < 4; i++) { host2.emit('addBot'); await sleep(120); }
  await waitFor(() => host2.state.players.length === 5, 5000, '4 bot bergabung');
  host2.emit('startGame');
  await waitFor(() => host2.state?.phase === 'reveal', 5000, 'reveal B');
  host2.emit('beginNight');
  await waitFor(() => host2.state?.phase === 'day' || host2.state?.phase === 'hunter', 60000, 'siang B');
  if (host2.state.phase === 'hunter') {
    await waitFor(() => host2.state?.phase === 'day', 70000, 'siang B setelah pemburu');
  }
  // jangan skip diskusi — tunggu bot berkomentar (jadwal 3,5–21 dtk)
  await waitFor(() => (host2.state.chat || []).some(m => m.isBot), 25000, 'bot berkomentar');
  const botMsg = (host2.state.chat || []).find(m => m.isBot);
  check(true, `bot ikut ngobrol di diskusi: "${botMsg.text}" — ${botMsg.name}`);
  host2.socket.disconnect();

  if (failures) { console.log(`\nUJI CHAT GAGAL — ${failures} pemeriksaan gagal.`); process.exit(1); }
  console.log('\nUJI CHAT LULUS ✅');
  process.exit(0);
})().catch((e) => { console.error('UJI CHAT ERROR:', e.message); process.exit(1); });
