'use strict';
/*
 * Simulasi uji mode bot: 1 klien manusia (host) + 6 bot server.
 * Server harus jalan (PORT=3100 node server.js), lalu: node test/simulate-bots.js
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
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true;
    await sleep(150);
  }
  throw new Error('Timeout menunggu: ' + label);
}

const token = 'host-solo-' + Math.random().toString(36).slice(2, 8);
let state = null;
let lastKey = '';
let doctorLast = null;
const socket = io(URL, { transports: ['websocket'], reconnection: false });
socket.on('state', (s) => { state = s; act(); });
socket.on('err', (m) => console.log('  [err]', m));

function act() {
  const s = state;
  if (!s?.you) return;
  const key = [s.phase, s.nightNum, s.dayNum, s.you.alive, s.night?.submitted, s.voting?.youVoted, s.hunter?.isYou].join('|');
  if (key === lastKey) return;
  lastKey = key;
  setTimeout(() => {
    const st = state;
    if (!st?.you) return;
    if (st.phase === 'reveal' && st.you.isHost) return socket.emit('beginNight');
    if (st.phase === 'day' && st.you.isHost) return socket.emit('startVoting');
    if (st.phase === 'hunter' && st.hunter?.isYou) {
      const t = st.players.filter(p => p.alive && !p.isYou);
      if (t.length) return socket.emit('hunterShot', { target: rnd(t).token });
      return;
    }
    if (!st.you.alive) return;
    const others = st.players.filter(p => p.alive && !p.isYou);
    if (st.phase === 'night' && !st.night?.submitted) {
      const role = st.you.role;
      if (role === 'werewolf') {
        const prey = others.filter(p => p.role !== 'werewolf');
        if (prey.length) socket.emit('nightAction', { target: rnd(prey).token });
      } else if (role === 'seer') {
        if (others.length) socket.emit('nightAction', { target: rnd(others).token });
      } else if (role === 'doctor') {
        const pool = st.players.filter(p => p.alive && p.token !== doctorLast);
        if (pool.length) { const t = rnd(pool).token; doctorLast = t; socket.emit('nightAction', { target: t }); }
      }
    }
    if (st.phase === 'voting' && !st.voting?.youVoted) {
      if (others.length) socket.emit('castVote', { target: rnd(others).token });
    }
  }, 150 + Math.random() * 250);
}

(async () => {
  console.log('== Simulasi Mode Bot: 1 manusia + 6 bot server ==');
  await sleep(500);
  socket.emit('createRoom', { name: 'HostSolo', token });
  await waitFor(() => state?.code, 5000, 'room dibuat');
  console.log('Room:', state.code);

  for (let i = 0; i < 6; i++) { socket.emit('addBot'); await sleep(120); }
  await waitFor(() => state.players.length === 7, 5000, '6 bot bergabung');
  const bots = state.players.filter(p => p.isBot);
  check(bots.length === 6, '6 pemain isBot=true di lobby');
  check(new Set(state.players.map(p => p.name)).size === 7, 'semua nama pemain unik');

  // uji hapus bot
  socket.emit('addBot');
  await waitFor(() => state.players.length === 8, 5000, 'bot ke-7 ditambahkan');
  const extra = state.players.find(p => p.isBot && !bots.some(b => b.token === p.token));
  socket.emit('removeBot', { token: extra.token });
  await waitFor(() => state.players.length === 7, 5000, 'bot dihapus');
  check(state.players.length === 7, 'removeBot bekerja — kembali ke 7 pemain');

  socket.emit('updateSettings', { hunter: true, discussionSec: 30 });
  await sleep(300);
  socket.emit('startGame');
  await waitFor(() => state.phase === 'over', 240000, 'game solo vs bot selesai');
  console.log('Pemenang:', state.winner, '| Malam ke-', state.nightNum, '| Peran host:', state.you.role);
  console.log('Log akhir:\n' + state.log.map(l => '   ' + l).join('\n'));
  check(state.winner === 'warga' || state.winner === 'werewolf', 'ada pemenang yang sah');
  const deadBots = state.players.filter(p => p.isBot && !p.alive).length;
  check(state.log.length >= 5, `log permainan terisi (${state.log.length} baris, bot gugur: ${deadBots})`);

  socket.emit('playAgain');
  await waitFor(() => state.phase === 'lobby', 5000, 'kembali ke lobby');
  check(state.players.length === 7, 'bot tetap di room setelah Main Lagi');

  socket.disconnect();
  if (failures) { console.log(`\nSIMULASI BOT GAGAL — ${failures} pemeriksaan gagal.`); process.exit(1); }
  console.log('\nSIMULASI BOT LULUS ✅');
  process.exit(0);
})().catch((e) => { console.error('SIMULASI BOT ERROR:', e.message); process.exit(1); });
