'use strict';
/*
 * Simulasi uji: 7 bot main 1 game Werewolf penuh lewat Socket.io.
 * Jalankan server dulu (PORT=3100 node server.js), lalu: node test/simulate.js
 * Keluar dengan kode 0 + "SIMULASI LULUS" bila game selesai dan kembali ke lobby.
 */
const { io } = require('socket.io-client');
const URL = process.env.WW_URL || 'http://localhost:3100';
const N = 7;
const NAMES = ['Andi', 'Bunga', 'Citra', 'Dedi', 'Eka', 'Fajar', 'Gita'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else { failures++; console.log('  ✗ GAGAL:', msg); }
}

class Bot {
  constructor(i) {
    this.name = NAMES[i];
    this.token = 'bot-token-' + i + '-' + Math.random().toString(36).slice(2, 8);
    this.state = null;
    this.lastKey = '';
    this.doctorLast = null;
    this.connect();
  }
  connect() {
    this.socket = io(URL, { transports: ['websocket'], reconnection: false });
    this.socket.on('state', (s) => {
      if (process.env.WW_DEBUG && s.phase !== this.state?.phase) {
        console.log(`   [${this.name}] fase -> ${s.phase} (malam ${s.nightNum}, siang ${s.dayNum})`);
      }
      this.state = s; this.act();
    });
    this.socket.on('err', (m) => { this.lastError = m; });
  }
  emit(ev, data) { this.socket.emit(ev, data); }
  get me() { return this.state?.players.find(p => p.token === this.token); }
  get role() { return this.state?.you?.role; }
  get alive() { return this.state?.you?.alive; }
  aliveOthers() { return this.state.players.filter(p => p.alive && p.token !== this.token); }

  act() {
    const s = this.state;
    if (!s) return;
    const key = [s.phase, s.nightNum, s.dayNum, s.you?.alive,
      s.night?.submitted, s.voting?.youVoted, s.hunter?.isYou].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    setTimeout(() => this.doAct(), 60 + Math.random() * 180);
  }
  doAct() {
    const s = this.state;
    if (!s || !s.you) return;
    const isHost = s.you.isHost;
    if (s.phase === 'reveal' && isHost && !this.holdHost) return this.emit('beginNight');
    if (s.phase === 'day' && isHost && !this.holdHost) return this.emit('startVoting');
    // Pemburu bertindak justru SETELAH gugur — cek sebelum gerbang pemain hidup
    if (s.phase === 'hunter' && s.hunter?.isYou) {
      const targets = this.aliveOthers();
      if (targets.length) return this.emit('hunterShot', { target: rnd(targets).token });
      return;
    }
    if (!this.alive) return;

    if (s.phase === 'night' && !s.night?.submitted) {
      if (this.role === 'werewolf') {
        const targets = this.aliveOthers().filter(p => p.role !== 'werewolf');
        if (targets.length) this.emit('nightAction', { target: rnd(targets).token });
      } else if (this.role === 'seer') {
        const targets = this.aliveOthers();
        if (targets.length) this.emit('nightAction', { target: rnd(targets).token });
      } else if (this.role === 'doctor') {
        const targets = s.players.filter(p => p.alive && p.token !== this.doctorLast);
        if (targets.length) {
          const t = rnd(targets).token;
          this.doctorLast = t;
          this.emit('nightAction', { target: t });
        }
      }
    }
    if (s.phase === 'voting' && !s.voting?.youVoted) {
      const targets = this.aliveOthers();
      // warga yang tahu hasil terawangan tidak dipakai di sini — voting acak cukup untuk uji alur
      if (targets.length && Math.random() < 0.9) this.emit('castVote', { target: rnd(targets).token });
      else this.emit('castVote', { target: null });
    }
  }
}

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true;
    await sleep(150);
  }
  throw new Error('Timeout menunggu: ' + label);
}

(async () => {
  console.log('== Simulasi Werewolf Online: 7 bot ==');
  const bots = NAMES.map((_, i) => new Bot(i));
  await sleep(600);

  const host = bots[0];
  host.emit('createRoom', { name: host.name, token: host.token });
  await waitFor(() => host.state?.code, 5000, 'room dibuat');
  const code = host.state.code;
  console.log('Room:', code);

  for (let i = 1; i < N; i++) bots[i].emit('joinRoom', { code, name: bots[i].name, token: bots[i].token });
  await waitFor(() => host.state.players.length === N, 5000, 'semua bot gabung');
  check(host.state.players.length === N, `${N} pemain masuk lobby`);

  // host aktifkan pemburu untuk menguji jalur hunter juga
  host.emit('updateSettings', { hunter: true, discussionSec: 30 });
  await sleep(400);
  check(host.state.composition.hunter === 1, 'komposisi memuat 1 pemburu');
  check(host.state.composition.werewolf === 2, 'komposisi 2 werewolf untuk 7 pemain');

  host.holdHost = true; // tahan aksi host agar fase reveal sempat diperiksa
  host.emit('startGame');
  await waitFor(() => bots.every(b => b.state?.phase === 'reveal' && b.state.you.role), 5000, 'peran dibagikan');
  const roles = bots.map(b => b.role);
  console.log('Peran bot:', bots.map((b, i) => `${b.name}=${roles[i]}`).join(' '));
  check(roles.filter(r => r === 'werewolf').length === 2, 'ada tepat 2 werewolf');

  // uji privasi: warga tidak boleh melihat peran pemain lain di fase reveal
  const villager = bots[roles.indexOf('villager')];
  const leaked = villager.state.players.filter(p => p.token !== villager.token && p.role);
  check(leaked.length === 0, 'privasi peran terjaga (warga tidak melihat peran orang lain)');
  // werewolf harus melihat rekannya
  const wolf = bots[roles.indexOf('werewolf')];
  const seenWolves = wolf.state.players.filter(p => p.role === 'werewolf').length;
  check(seenWolves === 2, 'werewolf melihat rekannya sesama werewolf');

  // uji reconnect di tengah permainan
  const rc = bots[3];
  const roleBefore = rc.role;
  rc.socket.disconnect();
  await sleep(500);
  rc.connect();
  await sleep(300);
  rc.emit('rejoin', { code, token: rc.token });
  await waitFor(() => rc.state?.you?.role === roleBefore, 5000, 'reconnect memulihkan peran');
  check(true, 'reconnect di tengah game memulihkan state & peran');

  // mulai malam pertama, lalu bebaskan aksi otomatis host
  host.emit('beginNight');
  try {
    await waitFor(() => host.state.phase === 'night', 5000, 'malam pertama dimulai');
  } catch (e) {
    console.log('DUMP beginNight:', JSON.stringify({
      fase: host.state?.phase, isHost: host.state?.you?.isHost,
      pemain: host.state?.players?.length, err: host.lastError || null,
    }));
    throw e;
  }
  host.holdHost = false;
  host.lastKey = ''; // paksa evaluasi ulang state host

  // main sampai selesai
  try {
    await waitFor(() => bots[0].state?.phase === 'over', 150000, 'game selesai (fase over)');
  } catch (e) {
    const s = bots[0].state;
    console.log('DUMP saat macet:', JSON.stringify({
      faseHost: s?.phase, malam: s?.nightNum, siang: s?.dayNum,
      nightPending: s?.night?.pendingCount, voting: s?.voting, hunter: s?.hunter,
      bot: bots.map(b => ({ nama: b.name, peran: b.role, hidup: b.alive, fase: b.state?.phase, err: b.lastError || null })),
      logTerakhir: s?.log?.slice(-6),
    }, null, 1));
    throw e;
  }
  const winner = bots[0].state.winner;
  console.log('Pemenang:', winner, '| Ronde malam:', bots[0].state.nightNum);
  console.log('Log akhir:\n' + bots[0].state.log.map(l => '   ' + l).join('\n'));
  check(winner === 'warga' || winner === 'werewolf', 'ada pemenang yang sah');
  check(bots.every(b => b.state.phase === 'over'), 'semua bot menerima fase over');

  // main lagi -> kembali ke lobby
  host.emit('playAgain');
  await waitFor(() => host.state.phase === 'lobby', 5000, 'kembali ke lobby');
  check(host.state.phase === 'lobby' && host.state.players.length === N, 'playAgain mengembalikan semua ke lobby');

  bots.forEach(b => b.socket.disconnect());
  if (failures) { console.log(`\nSIMULASI GAGAL — ${failures} pemeriksaan gagal.`); process.exit(1); }
  console.log('\nSIMULASI LULUS ✅');
  process.exit(0);
})().catch((e) => { console.error('SIMULASI ERROR:', e.message); process.exit(1); });
