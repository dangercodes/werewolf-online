'use strict';
/* ===== Werewolf Online — client ===== */
const $ = (id) => document.getElementById(id);

const ROLE_DESC = {
  werewolf: 'Setiap malam kamu bangun dan memilih satu warga untuk dimangsa bersama kawananmu. Di siang hari, berpura-puralah jadi warga baik!',
  seer: 'Setiap malam kamu boleh menerawang satu pemain untuk mengetahui apakah dia werewolf atau bukan.',
  doctor: 'Setiap malam kamu melindungi satu pemain (boleh dirimu sendiri) dari serangan werewolf. Tidak boleh orang yang sama dua malam berturut-turut.',
  hunter: 'Kamu warga biasa di malam hari. Tapi kalau kamu gugur — kapan pun — kamu boleh menembak satu pemain sebagai aksi terakhir.',
  villager: 'Kamu warga desa biasa. Senjatamu hanya pengamatan, diskusi, dan voting di siang hari. Jangan sampai salah eksekusi!',
};

/* ---------- identitas & preferensi ---------- */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
let myToken = localStorage.getItem('ww_token');
if (!myToken) { myToken = uuid(); localStorage.setItem('ww_token', myToken); }
let narratorOn = localStorage.getItem('ww_narrator') !== 'off';
let storedRoom = localStorage.getItem('ww_room') || '';

/* ---------- narator suara (Bahasa Indonesia) ---------- */
let idVoice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  idVoice = voices.find(v => /^id([-_]|$)/i.test(v.lang)) ||
            voices.find(v => /indonesia/i.test(v.name)) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(text) {
  if (!narratorOn || !text || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'id-ID';
    if (idVoice) u.voice = idVoice;
    u.rate = 1.0;
    speechSynthesis.speak(u);
  } catch (e) { /* diam saja */ }
}
function updateNarratorBtn() {
  $('narratorBtn').textContent = narratorOn ? '🔊 Narator: ON' : '🔇 Narator: OFF';
}

/* ---------- koneksi ---------- */
const socket = io();
let state = null;
let lastAnnounceSeq = 0;
let soloPending = false;
let lastNightPick = null;
let lastNightNum = 0;
let lastVote = undefined;
let overCelebratedSeq = 0;

socket.on('connect', () => {
  if (storedRoom && !state) {
    socket.emit('rejoin', { code: storedRoom, token: myToken });
  }
});
socket.on('state', (s) => {
  const prevPhase = state?.phase;
  state = s;
  storedRoom = s.code;
  localStorage.setItem('ww_room', s.code);
  if (s.nightNum !== lastNightNum) { lastNightNum = s.nightNum; lastNightPick = null; lastVote = undefined; }
  if (s.announcement && s.announcement.seq > lastAnnounceSeq) {
    lastAnnounceSeq = s.announcement.seq;
    if (s.announcement.speak) speak(s.announcement.speak);
  }
  // mode solo: isi room dengan bot sampai 7 pemain, lalu mulai otomatis
  if (soloPending && s.phase === 'lobby' && s.you?.isHost) {
    if (s.players.length < 7) socket.emit('addBot');
    else { soloPending = false; socket.emit('startGame'); }
  }
  render(prevPhase);
});
socket.on('err', (msg) => {
  showToast(msg || 'Terjadi kesalahan.');
  if (!state) { storedRoom = ''; localStorage.removeItem('ww_room'); }
});
socket.on('disconnect', () => {
  if (state) showToast('Koneksi terputus — mencoba menyambung lagi…');
});

/* ---------- util UI ---------- */
let toastTimer = null;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.classList.add('hidden'), 320);
  }, 3200);
}
function showScreen(id) {
  for (const s of ['screen-home', 'screen-lobby', 'screen-game', 'screen-over']) {
    $(s).classList.toggle('hidden', s !== id);
  }
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- render utama ---------- */
function render() {
  const inRoom = !!state;
  $('topbar').classList.toggle('hidden', !inRoom);
  $('leaveBtn').classList.toggle('hidden', !inRoom);
  if (!inRoom) {
    document.body.className = 'phase-home';
    showScreen('screen-home');
    return;
  }
  $('roomChip').textContent = 'Room: ' + state.code;
  $('roomChip').classList.remove('hidden');
  const phaseClass = {
    lobby: 'phase-lobby', reveal: '', night: '', hunter: '',
    day: 'phase-day', voting: 'phase-voting', over: 'phase-over',
  }[state.phase] ?? '';
  document.body.className = phaseClass;

  if (state.phase === 'lobby') { showScreen('screen-lobby'); renderLobby(); }
  else if (state.phase === 'over') { showScreen('screen-over'); renderOver(); }
  else { showScreen('screen-game'); renderGame(); }
}

/* ---------- lobby ---------- */
function renderLobby() {
  $('lobbyCode').textContent = state.code;
  const n = state.players.length;
  $('lobbyCount').textContent = `${n} / 15 pemain${n < 5 ? ` — butuh ${5 - n} lagi untuk mulai` : ' — siap mulai!'}`;
  $('lobbyPlayers').innerHTML = state.players.map(p => `
    <li>
      <span class="dot ${p.connected ? '' : 'off'}"></span>
      <span>${esc(p.name)}</span>
      ${p.isHost ? '<span class="badge">HOST</span>' : ''}
      ${p.isYou ? '<span class="badge" style="background:#2f9e63">KAMU</span>' : ''}
      ${p.isBot ? '<span class="badge" style="background:#8a6d1f">🤖 BOT</span>' : ''}
      ${p.connected ? '' : '<span class="muted small">(terputus)</span>'}
      ${p.isBot && state.you?.isHost ? `<button class="btn small danger" data-action="removeBot" data-target="${p.token}" style="margin-left:auto">✕</button>` : ''}
    </li>`).join('');

  const isHost = state.you?.isHost;
  const comp = state.composition;
  $('compositionInfo').textContent =
    `Komposisi untuk ${n} pemain: 🐺 ${comp.werewolf} Werewolf • 🔮 ${comp.seer} Penerawang • 💉 ${comp.doctor} Dokter • 🏹 ${comp.hunter} Pemburu • 🧑‍🌾 ${comp.villager} Warga`;
  const dc = $('setDoctor'), hu = $('setHunter'), di = $('setDiscussion');
  for (const el of [dc, hu, di]) el.disabled = !isHost;
  if (document.activeElement !== dc) dc.checked = state.settings.doctor;
  if (document.activeElement !== hu) hu.checked = state.settings.hunter;
  if (document.activeElement !== di) di.value = String(state.settings.discussionSec);
  $('startBtn').classList.toggle('hidden', !isHost);
  $('startBtn').disabled = n < 5;
  $('startBtn').textContent = n < 5 ? `🎮 Mulai Game (butuh ${5 - n} pemain lagi)` : '🎮 Mulai Game';
  $('addBotBtn').classList.toggle('hidden', !isHost);
  $('addBotBtn').disabled = n >= 15;
  $('addBotBtn').textContent = n >= 15 ? '🤖 Room Penuh (15)' : '🤖 Tambah Bot (isi kursi kosong)';
  $('lobbyWait').classList.toggle('hidden', isHost);
}

/* ---------- game ---------- */
function timerHTML(endsAt, totalSec) {
  if (!endsAt) return '';
  return `<div class="timerbar"><div class="cd-bar" data-end="${endsAt}" data-total="${totalSec}"></div></div>
          <div class="timer-text">⏳ Sisa waktu: <b class="cd-text" data-end="${endsAt}">–</b> detik</div>`;
}
function targetGrid(players, action, pickedToken, disabledTokens = []) {
  return `<div class="target-grid">${players.map(p => `
    <button class="target-btn ${pickedToken === p.token ? 'picked' : ''}"
      data-action="${action}" data-target="${p.token}"
      ${disabledTokens.includes(p.token) ? 'disabled' : ''}>${esc(p.name)}</button>`).join('')}</div>`;
}
function aliveOthers() { return state.players.filter(p => p.alive && !p.isYou); }
function aliveAll() { return state.players.filter(p => p.alive); }

function renderGame() {
  const s = state;
  const banners = {
    reveal: '🎴 Pembagian Peran',
    night: `🌙 Malam ke-${s.nightNum}`,
    hunter: '🏹 Tembakan Terakhir Pemburu',
    day: `☀️ Siang ke-${s.dayNum} — Diskusi`,
    voting: '🗳️ Waktunya Voting!',
  };
  $('phaseBanner').textContent = banners[s.phase] || s.phase;

  const ann = s.announcement;
  $('announceCard').classList.toggle('hidden', !ann.title);
  $('announceTitle').textContent = ann.title || '';
  $('announceBody').textContent = ann.body || '';

  const you = s.you;
  $('yourRole').classList.toggle('hidden', !you.role);
  if (you.role) {
    $('yourRole').innerHTML = `Peranmu: ${you.roleEmoji} <b>${esc(you.roleName)}</b>` +
      (you.alive ? '' : ' — kamu sudah gugur 💀 (tetap bisa menyaksikan)');
  }

  renderReveal(s);
  renderAction(s);
  renderVoteResult(s);

  $('playersGrid').innerHTML = s.players.map(p => `
    <div class="tile ${p.alive ? '' : 'dead'}">
      <span class="cdot ${p.connected ? '' : 'off'}"></span>
      <div class="avatar">${p.roleEmoji || '🧑'}</div>
      <div class="tname">${esc(p.name)}${p.isBot ? ' 🤖' : ''}${p.isYou ? ' (kamu)' : ''}</div>
      <div class="tstatus">${p.roleName ? esc(p.roleName) : (p.alive ? 'Masih hidup' : 'Gugur')}</div>
    </div>`).join('');

  $('gameLog').innerHTML = s.log.map(l => `<li>${esc(l)}</li>`).join('');
  const logEl = $('gameLog');
  logEl.scrollTop = logEl.scrollHeight;
}

function renderReveal(s) {
  const area = $('revealArea');
  if (s.phase !== 'reveal') { area.classList.add('hidden'); return; }
  area.classList.remove('hidden');
  const you = s.you;
  let extra = '';
  if (you.role === 'werewolf') {
    const fellows = s.players.filter(p => p.role === 'werewolf' && !p.isYou).map(p => p.name);
    extra = fellows.length
      ? `<div class="role-desc">Kawananmu: <b>${fellows.map(esc).join(', ')}</b> 🐺</div>`
      : '<div class="role-desc">Kamu werewolf satu-satunya. Bertahanlah!</div>';
  }
  $('roleBack').innerHTML = `
    <div class="role-big">${you.roleEmoji}</div>
    <div class="role-name">${esc(you.roleName)}</div>
    <div class="role-desc">${ROLE_DESC[you.role] || ''}</div>${extra}`;
  $('beginNightBtn').classList.toggle('hidden', !you.isHost);
  $('revealWait').classList.toggle('hidden', you.isHost);
}

function hostForceBtn() {
  return state.you?.isHost
    ? `<button class="btn small" data-action="force" style="margin-top:12px">⏩ Paksa Lanjut (Host)</button>` : '';
}

function renderAction(s) {
  const panel = $('actionPanel');
  const you = s.you;
  let html = '';

  if (s.phase === 'reveal') { panel.innerHTML = ''; return; }

  if (s.phase === 'night') {
    const n = s.night || { submitted: false, pendingCount: 0 };
    const timer = timerHTML(s.nightEndsAt, s.settings.nightSec);
    if (!you.alive) {
      html = `<div class="card waiting"><span class="pulse">👻</span><br>Kamu sudah gugur. Saksikan malam ini dari alam baka…</div>`;
    } else if (you.role === 'werewolf') {
      const picks = (n.wolfPicks || []).map(w =>
        `<div>🐺 ${esc(w.byName)} membidik <b>${esc(w.targetName)}</b></div>`).join('');
      html = `<div class="card action-card"><h3>🐺 Pilih Mangsa Malam Ini</h3>
        ${n.fellowWolves?.length ? `<div class="muted small">Kawananmu: ${n.fellowWolves.map(esc).join(', ')}</div>` : ''}
        ${picks ? `<div style="margin-top:8px">${picks}</div>` : ''}
        ${targetGrid(aliveOthers().filter(p => p.role !== 'werewolf'), 'night', lastNightPick)}
        ${n.submitted ? '<div class="muted center" style="margin-top:8px">✅ Pilihanmu terkunci — menunggu peran lain…</div>' : ''}
        ${timer}</div>`;
    } else if (you.role === 'seer') {
      if (n.seerResult) {
        const wolf = n.seerResult.isWolf;
        html = `<div class="card waiting"><h3>🔮 Hasil Terawangan</h3>
          <div class="result-box ${wolf ? 'result-wolf' : 'result-safe'}">
            ${esc(n.seerResult.targetName)} ${wolf ? 'adalah 🐺 WEREWOLF!' : 'BUKAN werewolf ✅'}</div>
          <div class="muted" style="margin-top:8px">Ingat baik-baik untuk diskusi besok. Menunggu peran lain…</div>${timer}</div>`;
      } else {
        html = `<div class="card action-card"><h3>🔮 Terawang Satu Pemain</h3>
          <div class="muted small">Hasilnya hanya kamu yang tahu.</div>
          ${targetGrid(aliveOthers(), 'night', null)}${timer}</div>`;
      }
    } else if (you.role === 'doctor') {
      if (n.submitted) {
        html = `<div class="card waiting"><span class="pulse">💉</span><br>Lindunganmu siap. Menunggu peran lain…${timer}</div>`;
      } else {
        const disabled = n.lastDoctorTargetToken ? [n.lastDoctorTargetToken] : [];
        html = `<div class="card action-card"><h3>💉 Lindungi Satu Pemain</h3>
          <div class="muted small">Boleh melindungi dirimu sendiri.${n.lastDoctorTarget ? ` Kemarin kamu melindungi <b>${esc(n.lastDoctorTarget)}</b> — malam ini tidak boleh orang yang sama.` : ''}</div>
          ${targetGrid(aliveAll(), 'night', null, disabled)}${timer}</div>`;
      }
    } else {
      html = `<div class="card waiting"><span class="pulse">😴</span><br>Kamu tertidur pulas…<br>
        <span class="muted small">Menunggu ${n.pendingCount} pemain menyelesaikan aksi malamnya.</span>${timer}</div>`;
    }
    if (you.isHost) html += hostForceBtn();
    panel.innerHTML = html;
    return;
  }

  if (s.phase === 'hunter') {
    const timer = timerHTML(s.hunterEndsAt, s.settings.hunterSec || 60);
    if (s.hunter?.isYou) {
      html = `<div class="card action-card"><h3>🏹 Tembakan Terakhirmu!</h3>
        <div class="muted small">Kamu gugur sebagai Pemburu. Pilih satu pemain untuk ikut tumbang bersamamu — cepat, waktunya terbatas:</div>
        ${targetGrid(aliveOthers(), 'shoot', null)}${timer}</div>`;
    } else {
      html = `<div class="card waiting"><span class="pulse">🏹</span><br>Pemburu yang gugur sedang membidik target terakhirnya…${timer}</div>`;
    }
    if (you.isHost) html += hostForceBtn();
    panel.innerHTML = html;
    return;
  }

  if (s.phase === 'day') {
    html = `<div class="card waiting"><h3>🗣️ Sesi Diskusi</h3>
      <div class="muted">Bahas bareng temanmu (tatap muka / voice call): siapa yang gerak-geriknya mencurigakan semalam?</div>
      ${timerHTML(s.discussionEndsAt, s.settings.discussionSec)}
      ${you.isHost ? '<button class="btn primary" data-action="startVoting" style="margin-top:10px">🗳️ Mulai Voting Sekarang</button>' : ''}
    </div>`;
    panel.innerHTML = html;
    return;
  }

  if (s.phase === 'voting') {
    const v = s.voting || { castCount: 0, neededCount: 0, youVoted: false };
    const timer = timerHTML(s.voteEndsAt, s.settings.voteSec);
    if (!you.alive) {
      html = `<div class="card waiting"><span class="pulse">👻</span><br>Kamu sudah gugur — voting berjalan tanpa suaramu.<br>
        <span class="muted small">Suara masuk: ${v.castCount}/${v.neededCount}</span>${timer}</div>`;
    } else {
      html = `<div class="card action-card"><h3>🗳️ Siapa yang Dieksekusi?</h3>
        <div class="muted small">Suara masuk: <b>${v.castCount}/${v.neededCount}</b>${v.youVoted ? ' — ✅ suaramu sudah masuk (ketuk nama lain untuk mengganti)' : ''}</div>
        ${targetGrid(aliveOthers(), 'vote', lastVote === undefined ? null : lastVote)}
        <button class="btn ${lastVote === null ? 'primary' : ''}" data-action="abstain" style="width:100%;margin-top:9px">🤐 Golput / Abstain</button>
        ${timer}</div>`;
    }
    if (you.isHost) html += hostForceBtn();
    panel.innerHTML = html;
    return;
  }

  panel.innerHTML = '';
}

function renderVoteResult(s) {
  const card = $('voteResultCard');
  if (!s.voteResult || (s.phase !== 'night' && s.phase !== 'hunter')) {
    card.classList.add('hidden');
    return;
  }
  const vr = s.voteResult;
  const max = Math.max(1, ...vr.tally.map(t => t.count));
  const rows = vr.tally.map(t => `
    <div class="tally-row">
      <span class="tally-name">${esc(t.name)}</span>
      <span class="tally-bar"><div style="width:${(t.count / max) * 100}%"></div></span>
      <span class="tally-count">${t.count}</span>
    </div>`).join('');
  card.innerHTML = `<h3>🗳️ Hasil Voting Terakhir</h3>${rows || '<div class="muted">Tidak ada suara yang masuk.</div>'}
    <div style="margin-top:8px;font-weight:700">${vr.executed
      ? `⚖️ ${esc(vr.executed.name)} dieksekusi.`
      : '🤝 Tidak ada yang dieksekusi.'}</div>`;
  card.classList.remove('hidden');
}

/* ---------- game over ---------- */
function renderOver() {
  const s = state;
  const wargaWin = s.winner === 'warga';
  $('overEmoji').textContent = wargaWin ? '🎉' : '🐺';
  $('overTitle').textContent = wargaWin ? 'Warga Desa Menang!' : 'Werewolf Menang!';
  $('overBody').textContent = s.announcement.body || '';
  $('overPlayers').innerHTML = s.players.map(p => `
    <li>
      <span>${p.roleEmoji || '🧑'}</span>
      <span>${esc(p.name)}${p.isYou ? ' (kamu)' : ''}</span>
      ${p.alive ? '' : '<span class="badge dead">GUGUR</span>'}
      <span class="role">${esc(p.roleName || '')}</span>
    </li>`).join('');
  $('playAgainBtn').classList.toggle('hidden', !s.you?.isHost);
  $('overWait').classList.toggle('hidden', !!s.you?.isHost);
  if (s.announcement.seq !== overCelebratedSeq) {
    overCelebratedSeq = s.announcement.seq;
    confetti(wargaWin);
  }
}

function confetti(wargaWin) {
  const box = $('confetti');
  const pieces = wargaWin ? ['🎉', '⭐', '🎊', '💛', '✨'] : ['🐺', '🌕', '🦇', '🌑'];
  for (let i = 0; i < 36; i++) {
    const el = document.createElement('span');
    el.className = 'confetti-piece';
    el.textContent = pieces[i % pieces.length];
    el.style.left = Math.random() * 100 + 'vw';
    el.style.fontSize = 16 + Math.random() * 22 + 'px';
    el.style.animationDuration = 2.4 + Math.random() * 2.4 + 's';
    el.style.animationDelay = Math.random() * 0.7 + 's';
    box.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }
}

/* ---------- timer loop ---------- */
setInterval(() => {
  const t = Date.now();
  document.querySelectorAll('.cd-text').forEach(el => {
    const left = Math.max(0, Math.round((+el.dataset.end - t) / 1000));
    el.textContent = left;
  });
  document.querySelectorAll('.cd-bar').forEach(el => {
    const total = (+el.dataset.total || 1) * 1000;
    const left = Math.max(0, +el.dataset.end - t);
    el.style.width = Math.min(100, (left / total) * 100) + '%';
  });
}, 400);

/* ---------- aksi (event delegation) ---------- */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  const action = btn.dataset.action;
  const target = btn.dataset.target;
  if (action === 'night') { lastNightPick = target; socket.emit('nightAction', { target }); render(); }
  if (action === 'shoot') socket.emit('hunterShot', { target });
  if (action === 'vote') { lastVote = target; socket.emit('castVote', { target }); render(); }
  if (action === 'abstain') { lastVote = null; socket.emit('castVote', { target: null }); render(); }
  if (action === 'force') socket.emit('forceAdvance');
  if (action === 'startVoting') socket.emit('startVoting');
  if (action === 'removeBot') socket.emit('removeBot', { token: target });
});

/* ---------- binding UI ---------- */
function myName() {
  const name = $('nameInput').value.trim();
  if (!name) { showToast('Isi dulu nama kamu ya.'); return null; }
  localStorage.setItem('ww_name', name);
  return name;
}
$('nameInput').value = localStorage.getItem('ww_name') || '';
updateNarratorBtn();

$('createBtn').addEventListener('click', () => {
  const name = myName(); if (!name) return;
  socket.emit('createRoom', { name, token: myToken });
});
$('soloBtn').addEventListener('click', () => {
  const name = myName(); if (!name) return;
  soloPending = true;
  socket.emit('createRoom', { name, token: myToken });
});
$('addBotBtn').addEventListener('click', () => socket.emit('addBot'));
$('joinBtn').addEventListener('click', () => {
  const name = myName(); if (!name) return;
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length !== 4) { showToast('Kode room itu 4 huruf.'); return; }
  socket.emit('joinRoom', { code, name, token: myToken });
});
$('codeInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });

$('narratorBtn').addEventListener('click', () => {
  narratorOn = !narratorOn;
  localStorage.setItem('ww_narrator', narratorOn ? 'on' : 'off');
  updateNarratorBtn();
  if (narratorOn) speak('Narator aktif.');
  else if ('speechSynthesis' in window) speechSynthesis.cancel();
});
$('leaveBtn').addEventListener('click', () => {
  socket.emit('leaveRoom');
  state = null;
  soloPending = false;
  storedRoom = '';
  localStorage.removeItem('ww_room');
  render();
});
$('copyCodeBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.code); showToast('Kode tersalin: ' + state.code); }
  catch { showToast('Kode room: ' + state.code); }
});
for (const [id, key] of [['setDoctor', 'doctor'], ['setHunter', 'hunter']]) {
  $(id).addEventListener('change', (e) => socket.emit('updateSettings', { [key]: e.target.checked }));
}
$('setDiscussion').addEventListener('change', (e) =>
  socket.emit('updateSettings', { discussionSec: +e.target.value }));
$('startBtn').addEventListener('click', () => socket.emit('startGame'));
$('beginNightBtn').addEventListener('click', () => socket.emit('beginNight'));
$('playAgainBtn').addEventListener('click', () => socket.emit('playAgain'));
$('flipCard').addEventListener('click', () => $('flipCard').classList.toggle('flipped'));

render();
