'use strict';
/*
 * Werewolf Online — server game multiplayer (Node.js + Socket.io)
 * Satu file server: room berkode, peran dibagikan server secara rahasia,
 * fase malam/siang, voting, pemburu, reconnect, dan narator (teks pengumuman
 * dikirim ke client untuk dibacakan dengan speechSynthesis id-ID).
 */
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(mp3|ogg|wav)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

const PORT = process.env.PORT || 3000;

/* ---------------- util ---------------- */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const now = () => Date.now();

/* ---------------- state ---------------- */
const rooms = new Map(); // code -> room
const socketIndex = new Map(); // socketId -> { code, token }

const ROLE_INFO = {
  werewolf: { name: 'Werewolf', emoji: '🐺', team: 'werewolf' },
  seer: { name: 'Penerawang', emoji: '🔮', team: 'warga' },
  doctor: { name: 'Dokter', emoji: '💉', team: 'warga' },
  hunter: { name: 'Pemburu', emoji: '🏹', team: 'warga' },
  villager: { name: 'Warga Desa', emoji: '🧑‍🌾', team: 'warga' },
};

function wolfCount(n) {
  if (n <= 6) return 1;
  if (n <= 9) return 2;
  if (n <= 12) return 3;
  return 4;
}
function roleComposition(n, settings) {
  const wolves = wolfCount(n);
  const seer = 1;
  const doctor = settings.doctor ? 1 : 0;
  const hunter = settings.hunter ? 1 : 0;
  const villagers = n - wolves - seer - doctor - hunter;
  return { werewolf: wolves, seer, doctor, hunter, villager: villagers };
}

function newRoom(code, hostToken) {
  return {
    code,
    hostToken,
    phase: 'lobby', // lobby | night | hunter | day | voting | over
    players: new Map(), // token -> player (insertion order = join order)
    settings: { discussionSec: 120, doctor: true, hunter: false, nightSec: 90, voteSec: 150, hunterSec: 60 },
    nightNum: 0,
    dayNum: 0,
    night: null, // { wolfVotes: Map(token->targetToken), voteOrder: [], seer: {by,target,isWolf}|null, doctorTarget, submitted:Set }
    votes: new Map(), // voterToken -> targetToken|null
    voteResult: null, // { tally: [{token,count}], executed: token|null, tie: bool }
    hunterPending: null, // { hunterToken, returnTo: 'day'|'night' }
    lastDoctorTarget: null,
    winner: null, // 'warga' | 'werewolf'
    log: [],
    chatLog: [], // { name, text, isBot, ts } — obrolan fase diskusi & voting
    announcement: { seq: 0, title: '', body: '', speak: '' },
    discussionEndsAt: null,
    nightEndsAt: null,
    voteEndsAt: null,
    hunterEndsAt: null,
    timers: {},
    createdAt: now(),
  };
}

// clip: nama dasar klip audio narator rekaman (folder public/narasi) — dipilih varian acaknya di sini
// fx: efek animasi layar di client (overlay narator)
const CLIP_VARIANTS = { mulai: 2, malam: 3, 'pagi-korban': 2, 'pagi-selamat': 2, 'pagi-sepi': 1, voting: 2, eksekusi: 2, seri: 2, 'pemburu-gugur': 1, tembakan: 2, 'pemburu-lewat': 1, 'menang-warga': 2, 'menang-wolf': 2 };
function announce(room, title, body, speak, clip, fx) {
  let clipFile = null;
  if (clip && CLIP_VARIANTS[clip]) {
    clipFile = `${clip}-${1 + Math.floor(Math.random() * CLIP_VARIANTS[clip])}.mp3`;
  }
  room.announcement = { seq: room.announcement.seq + 1, title, body, speak: speak || body, clip: clipFile, fx: fx || null };
}
// pilih satu variasi kalimat secara acak — narator terasa seperti ngobrol, bukan robot
const vary = (arr) => arr[Math.floor(Math.random() * arr.length)];
function pushChat(room, name, text, isBot, token) {
  room.chatLog.push({ name, text, isBot: !!isBot, token: token || null, ts: now() });
  if (room.chatLog.length > 100) room.chatLog.shift();
}
function logLine(room, text) {
  room.log.push(text);
  if (room.log.length > 200) room.log.shift();
}
function clearTimer(room, key) {
  if (room.timers[key]) { clearTimeout(room.timers[key]); room.timers[key] = null; }
}
function clearAllTimers(room) {
  for (const k of Object.keys(room.timers)) clearTimer(room, k);
}

function alivePlayers(room) {
  return [...room.players.values()].filter(p => p.alive);
}
function aliveByRole(room, role) {
  return alivePlayers(room).filter(p => p.role === role);
}
function getPlayer(room, token) { return room.players.get(token); }

/* ---------------- personalized snapshot ---------------- */
function publicPlayer(room, p, viewer) {
  const revealRole =
    room.phase === 'over' ||
    !p.alive ||
    (viewer && viewer.token === p.token) ||
    (viewer && viewer.role === 'werewolf' && p.role === 'werewolf');
  return {
    token: p.token,
    name: p.name,
    alive: p.alive,
    connected: p.connected,
    isHost: room.hostToken === p.token,
    isBot: !!p.isBot,
    isYou: viewer ? viewer.token === p.token : false,
    role: revealRole ? p.role : null,
    roleName: revealRole && p.role ? ROLE_INFO[p.role].name : null,
    roleEmoji: revealRole && p.role ? ROLE_INFO[p.role].emoji : null,
  };
}

function buildState(room, viewer) {
  const state = {
    code: room.code,
    phase: room.phase,
    nightNum: room.nightNum,
    dayNum: room.dayNum,
    settings: room.settings,
    composition: roleComposition(room.players.size, room.settings),
    players: [...room.players.values()].map(p => publicPlayer(room, p, viewer)),
    announcement: room.announcement,
    log: room.log,
    chat: room.chatLog,
    winner: room.winner,
    discussionEndsAt: room.discussionEndsAt,
    nightEndsAt: room.nightEndsAt,
    voteEndsAt: room.voteEndsAt,
    hunterEndsAt: room.hunterEndsAt,
    voteResult: null,
    you: null,
    night: null,
  };
  if (room.voteResult) {
    state.voteResult = {
      tie: room.voteResult.tie,
      executed: room.voteResult.executed
        ? { token: room.voteResult.executed, name: room.players.get(room.voteResult.executed)?.name }
        : null,
      tally: room.voteResult.tally.map(t => ({
        token: t.token,
        name: room.players.get(t.token)?.name,
        count: t.count,
      })),
    };
  }
  if (viewer) {
    state.you = {
      token: viewer.token,
      name: viewer.name,
      alive: viewer.alive,
      isHost: room.hostToken === viewer.token,
      role: viewer.role,
      roleName: viewer.role ? ROLE_INFO[viewer.role].name : null,
      roleEmoji: viewer.role ? ROLE_INFO[viewer.role].emoji : null,
    };
    // info khusus fase malam
    if (room.phase === 'night' && room.night) {
      const n = { submitted: room.night.submitted.has(viewer.token), pendingCount: nightPendingCount(room) };
      if (viewer.role === 'werewolf') {
        n.wolfPicks = [...room.night.wolfVotes.entries()].map(([by, target]) => ({
          byName: room.players.get(by)?.name,
          targetToken: target,
          targetName: room.players.get(target)?.name,
        }));
        n.fellowWolves = aliveByRole(room, 'werewolf')
          .filter(w => w.token !== viewer.token).map(w => w.name);
      }
      if (viewer.role === 'seer' && room.night.seer && room.night.seer.by === viewer.token) {
        const t = room.players.get(room.night.seer.target);
        n.seerResult = { targetName: t?.name, isWolf: room.night.seer.isWolf };
      }
      if (viewer.role === 'doctor') {
        n.lastDoctorTarget = room.lastDoctorTarget
          ? room.players.get(room.lastDoctorTarget)?.name : null;
        n.lastDoctorTargetToken = room.lastDoctorTarget;
      }
      state.night = n;
    }
    if (room.phase === 'voting') {
      state.voting = {
        youVoted: room.votes.has(viewer.token),
        castCount: room.votes.size,
        neededCount: alivePlayers(room).length,
      };
    }
    if (room.phase === 'hunter' && room.hunterPending) {
      state.hunter = { isYou: room.hunterPending.hunterToken === viewer.token };
    }
  }
  return state;
}

function sendState(room, player) {
  if (player.socketId) io.to(player.socketId).emit('state', buildState(room, player));
}
function broadcast(room) {
  for (const p of room.players.values()) sendState(room, p);
}

/* ---------------- game flow ---------------- */
function checkWin(room) {
  const wolves = aliveByRole(room, 'werewolf').length;
  const others = alivePlayers(room).length - wolves;
  if (wolves === 0) { endGame(room, 'warga'); return true; }
  if (wolves >= others) { endGame(room, 'werewolf'); return true; }
  return false;
}
function endGame(room, winner) {
  clearAllTimers(room);
  room.phase = 'over';
  room.winner = winner;
  const title = winner === 'warga' ? '🎉 Warga Desa Menang!' : '🐺 Werewolf Menang!';
  const body = winner === 'warga'
    ? vary([
      'Semua werewolf berhasil disingkirkan satu-satu. Desa akhirnya aman lagi — selamat, kalian hebat!',
      'Werewolf-nya habis! Warga desa menang. Malam ini semua bisa tidur nyenyak tanpa takut dimangsa.'])
    : vary([
      'Yahh, desa jatuh juga ke tangan werewolf. Jumlah mereka sekarang sama banyaknya dengan warga…',
      'Werewolf menang! Diam-diam mereka menguasai desa. Warga yang tersisa cuma bisa pasrah…']);
  announce(room, title, body, body,
    winner === 'warga' ? 'menang-warga' : 'menang-wolf',
    winner === 'warga' ? 'win-warga' : 'win-wolf');
  logLine(room, `🏁 Permainan selesai — ${winner === 'warga' ? 'Warga Desa' : 'Werewolf'} menang.`);
  broadcast(room);
}

function killPlayer(room, player, cause) {
  player.alive = false;
  const info = ROLE_INFO[player.role];
  logLine(room, `💀 ${player.name} (${info.emoji} ${info.name}) gugur — ${cause}.`);
  return player;
}

function startNight(room) {
  room.phase = 'night';
  room.nightNum += 1;
  room.voteResult = null;
  room.votes = new Map();
  room.night = {
    wolfVotes: new Map(),
    voteOrder: [],
    seer: null,
    doctorTarget: null,
    submitted: new Set(),
  };
  room.discussionEndsAt = null;
  room.voteEndsAt = null;
  room.nightEndsAt = now() + room.settings.nightSec * 1000;
  announce(room,
    `🌙 Malam ke-${room.nightNum}`,
    vary([
      'Desa pelan-pelan terlelap. Yang punya tugas malam, silakan beraksi dari HP masing-masing — pelan-pelan aja, jangan sampai ketahuan.',
      'Matahari sudah tenggelam, desa mulai sepi. Werewolf, penerawang, dokter — giliran kalian beraksi malam ini.',
      'Semua pejamkan mata ya… kecuali yang lagi dapat giliran jaga malam. Silakan beraksi, jangan berisik.']),
    vary([
      `Nah, malam ke ${room.nightNum} pun tiba. Desa mulai terlelap. Werewolf, penerawang, sama dokter, giliran kalian beraksi. Sstt, pelan-pelan ya.`,
      `Oke, malam ke ${room.nightNum} dimulai. Yang punya tugas malam, silakan beraksi dari HP-nya masing-masing.`,
      `Malam lagi nih, malam ke ${room.nightNum}. Semua tidur ya, kecuali yang lagi jaga malam.`]),
    'malam', 'nightfall');
  logLine(room, `🌙 Malam ke-${room.nightNum} dimulai.`);
  clearTimer(room, 'night');
  room.timers.night = setTimeout(() => resolveNight(room), room.settings.nightSec * 1000);
  broadcast(room);
  scheduleBots(room);
}

function nightPendingCount(room) {
  let pending = 0;
  for (const w of aliveByRole(room, 'werewolf')) if (!room.night.submitted.has(w.token)) pending++;
  const seer = aliveByRole(room, 'seer')[0];
  if (seer && !room.night.submitted.has(seer.token)) pending++;
  const doc = aliveByRole(room, 'doctor')[0];
  if (doc && !room.night.submitted.has(doc.token)) pending++;
  return pending;
}

function maybeFinishNight(room) {
  if (room.phase !== 'night') return;
  if (nightPendingCount(room) === 0) resolveNight(room);
}

function pickVictim(room) {
  const counts = new Map();
  for (const target of room.night.wolfVotes.values()) {
    counts.set(target, (counts.get(target) || 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = null, bestCount = -1, bestOrder = Infinity;
  for (const [target, count] of counts.entries()) {
    const order = room.night.voteOrder.indexOf(target);
    if (count > bestCount || (count === bestCount && order < bestOrder)) {
      best = target; bestCount = count; bestOrder = order;
    }
  }
  return best;
}

function resolveNight(room) {
  if (room.phase !== 'night') return;
  clearTimer(room, 'night');
  room.nightEndsAt = null;
  const night = room.night;

  if (night.doctorTarget) room.lastDoctorTarget = night.doctorTarget;

  const victimToken = pickVictim(room);
  const deaths = [];
  let saved = false;
  if (victimToken) {
    if (night.doctorTarget && night.doctorTarget === victimToken) {
      saved = true;
    } else {
      deaths.push(killPlayer(room, room.players.get(victimToken), 'dimangsa werewolf'));
    }
  }

  // simpan ringkasan untuk pengumuman pagi
  room.morningReport = { deaths: deaths.map(d => d.token), saved, hadVictim: !!victimToken };

  const hunter = deaths.find(d => d.role === 'hunter');
  if (hunter) {
    enterHunterPhase(room, hunter.token, 'day', ['🏹 Pemburu Gugur!',
      `Eh tunggu dulu — ${hunter.name} itu Pemburu! Dia masih sempat narik pelatuk sekali lagi sebelum beneran tumbang. Menunggu bidikan ${hunter.name}…`,
      `Eh, tunggu dulu! ${hunter.name} itu ternyata Pemburu. Dia masih sempat nembak satu orang terakhir. Deg-degan nih...`,
      'pemburu-gugur', 'hunter']);
    return;
  }
  if (checkWin(room)) return;
  startDay(room);
}

function startDay(room) {
  room.phase = 'day';
  room.dayNum = room.nightNum;
  const report = room.morningReport || { deaths: [], saved: false, hadVictim: false };
  let body, speak;
  if (report.deaths.length === 0) {
    if (report.hadVictim && report.saved) {
      body = vary([
        'Eh, kabar baik — semalam nggak ada korban sama sekali! Dokter kita kayaknya begadang dan berhasil nyelametin mangsa werewolf. Keren! 🎉',
        'Pagi yang tenang! Werewolf semalam gagal total, mangsanya diselamatkan dokter. Nggak ada yang gugur! 🎉']);
      speak = vary([
        'Pagi semuanya! Eh, kabar baik nih, semalam nggak ada korban. Dokter kita berhasil nyelametin mangsanya werewolf. Keren banget!',
        'Pagi! Semalam nggak ada yang gugur. Kayaknya dokter kita jago banget nih.']);
    } else {
      body = 'Sepi-sepi aja semalam, nggak ada korban. Heran, werewolf-nya lagi pada diet kali ya. 🎉';
      speak = 'Pagi semuanya! Semalam sepi-sepi aja, nggak ada korban. Werewolf-nya lagi pada diet kali ya.';
    }
  } else {
    const names = report.deaths.map(t => {
      const p = room.players.get(t);
      return `${p.name} (${ROLE_INFO[p.role].emoji} ${ROLE_INFO[p.role].name})`;
    });
    const plainNames = report.deaths.map(t => room.players.get(t).name).join(' dan ');
    body = vary([
      `Waduh… pagi ini ada kabar buruk. ${names.join(' dan ')} ditemukan nggak bernyawa. Serem juga ya desa ini…`,
      `Pagi yang kelam. Semalam ${names.join(' dan ')} jadi korban. Desa makin sepi aja nih…`]);
    speak = vary([
      `Pagi semuanya. Tapi ada kabar buruk nih... semalam ${plainNames} ditemukan nggak bernyawa. Waduh, serem juga ya.`,
      `Pagi. Hmm, semalam ada kejadian. ${plainNames} jadi korban. Kasian banget.`]);
  }
  const pagiClip = report.deaths.length ? 'pagi-korban' : (report.hadVictim && report.saved ? 'pagi-selamat' : 'pagi-sepi');
  const pagiFx = report.deaths.length ? 'daybreak-death' : 'daybreak-calm';
  announce(room, `☀️ Pagi Hari ke-${room.dayNum}`,
    `${body} ${vary(['Nah, sekarang waktunya diskusi — menurut kalian siapa werewolf-nya?', 'Yuk diskusi dulu, siapa nih yang paling mencurigakan?', 'Oke, silakan diskusi. Tunjuk siapa yang gerak-geriknya paling aneh.'])}`,
    `${speak} Nah, sekarang waktunya diskusi. Siapa menurut kalian werewolf-nya?`,
    pagiClip, pagiFx);
  logLine(room, `☀️ Pagi ke-${room.dayNum}: ${report.deaths.length ? report.deaths.map(t => room.players.get(t).name).join(', ') + ' gugur.' : 'tidak ada yang gugur.'}`);
  room.discussionEndsAt = now() + room.settings.discussionSec * 1000;
  clearTimer(room, 'discussion');
  room.timers.discussion = setTimeout(() => startVoting(room), room.settings.discussionSec * 1000);
  broadcast(room);
  scheduleBots(room);
}

function startVoting(room) {
  if (room.phase !== 'day') return;
  clearTimer(room, 'discussion');
  room.discussionEndsAt = null;
  room.phase = 'voting';
  room.votes = new Map();
  room.voteEndsAt = now() + room.settings.voteSec * 1000;
  announce(room, '🗳️ Waktunya Voting!',
    vary([
      'Oke, diskusinya cukup! Sekarang pilih satu orang yang paling mencurigakan lewat HP-mu. Suara terbanyak bakal dieksekusi.',
      'Nah, sekarang bagian paling deg-degan: voting. Tunjuk siapa yang menurutmu werewolf-nya!']),
    vary([
      'Oke oke, diskusinya cukup. Waktunya voting! Pilih satu orang yang paling kalian curigai.',
      'Nah, sekarang waktunya voting. Siapa nih yang paling mencurigakan menurut kalian?']),
    'voting', 'vote');
  logLine(room, '🗳️ Voting dimulai.');
  clearTimer(room, 'vote');
  room.timers.vote = setTimeout(() => resolveVoting(room), room.settings.voteSec * 1000);
  broadcast(room);
  scheduleBots(room);
}

function resolveVoting(room) {
  if (room.phase !== 'voting') return;
  clearTimer(room, 'vote');
  room.voteEndsAt = null;
  const counts = new Map();
  for (const target of room.votes.values()) {
    if (target) counts.set(target, (counts.get(target) || 0) + 1);
  }
  const tally = [...counts.entries()]
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count);
  let executed = null, tie = false;
  if (tally.length > 0) {
    if (tally.length > 1 && tally[1].count === tally[0].count) tie = true;
    else executed = tally[0].token;
  }
  room.voteResult = { tally, executed, tie };

  if (!executed) {
    announce(room, '🤝 Tidak Ada Eksekusi',
      tie
        ? vary(['Waduh, suaranya seri! Nggak ada yang dieksekusi hari ini. Werewolf-nya masih bebas berkeliaran tuh…',
                'Seri! Voting-nya imbang, jadi hari ini nggak ada eksekusi. Hmm, makin lama makin bahaya nih.'])
        : 'Nggak ada suara yang masuk sama sekali… yaudah, hari ini nggak ada eksekusi.',
      tie
        ? vary(['Waduh, suaranya seri! Nggak ada yang dieksekusi hari ini.', 'Seri nih! Nggak ada yang dieksekusi hari ini.'])
        : 'Nggak ada suara yang masuk. Nggak ada eksekusi hari ini.',
      tie ? 'seri' : null, 'tie');
    logLine(room, '🗳️ Voting selesai — tidak ada eksekusi.');
    if (checkWin(room)) return;
    startNight(room);
    return;
  }

  const victim = killPlayer(room, room.players.get(executed), 'dieksekusi hasil voting');
  announce(room, '⚖️ Eksekusi!',
    vary([
      `Keputusan sudah bulat: ${victim.name} dieksekusi. Dan ternyata… dia itu ${ROLE_INFO[victim.role].emoji} ${ROLE_INFO[victim.role].name}!`,
      `${victim.name} dapat suara terbanyak dan dieksekusi. Ternyata selama ini dia ${ROLE_INFO[victim.role].emoji} ${ROLE_INFO[victim.role].name}.`]),
    vary([
      `${victim.name} dieksekusi. Dan ternyata... dia itu ${ROLE_INFO[victim.role].name}!`,
      `Voting selesai. ${victim.name} yang dieksekusi. Ternyata dia ${ROLE_INFO[victim.role].name}.`]),
    'eksekusi', 'execution');
  if (victim.role === 'hunter') {
    enterHunterPhase(room, victim.token, 'night', null);
    return;
  }
  if (checkWin(room)) return;
  startNight(room);
}

function enterHunterPhase(room, hunterToken, returnTo, ann) {
  room.phase = 'hunter';
  room.hunterPending = { hunterToken, returnTo };
  room.hunterEndsAt = now() + room.settings.hunterSec * 1000;
  if (ann) announce(room, ann[0], ann[1], ann[2], ann[3], ann[4]);
  clearTimer(room, 'hunter');
  room.timers.hunter = setTimeout(() => expireHunter(room), room.settings.hunterSec * 1000);
  broadcast(room);
  scheduleBots(room);
}

function proceedAfterHunter(room, returnTo) {
  room.hunterPending = null;
  room.hunterEndsAt = null;
  clearTimer(room, 'hunter');
  if (checkWin(room)) return;
  if (returnTo === 'day') startDay(room);
  else startNight(room);
}

function expireHunter(room) {
  if (room.phase !== 'hunter' || !room.hunterPending) return;
  const hunter = room.players.get(room.hunterPending.hunterToken);
  const returnTo = room.hunterPending.returnTo;
  logLine(room, `🏹 ${hunter?.name} tidak sempat menembak (waktu habis).`);
  announce(room, '🏹 Kesempatan Berlalu',
    `Yah, kelamaan — ${hunter?.name} nggak sempat nembak. Yaudah, kita lanjut aja ya.`,
    `Yah, kelamaan. ${hunter?.name} nggak sempat nembak. Yaudah, lanjut aja.`,
    'pemburu-lewat', 'hunter-expire');
  proceedAfterHunter(room, returnTo);
}

function hunterShoot(room, hunterPlayer, targetToken) {
  const target = room.players.get(targetToken);
  if (!target || !target.alive) return;
  const pending = room.hunterPending;
  killPlayer(room, target, `ditembak Pemburu ${hunterPlayer.name}`);
  announce(room, '🏹 Tembakan Terakhir!',
    vary([
      `DOR! ${hunterPlayer.name} nembak ${target.name} sebelum gugur! Dan ${target.name} ternyata ${ROLE_INFO[target.role].emoji} ${ROLE_INFO[target.role].name}!`,
      `Di detik terakhir, ${hunterPlayer.name} nembak ${target.name}! ${target.name} tumbang, dan ternyata dia ${ROLE_INFO[target.role].emoji} ${ROLE_INFO[target.role].name}.`]),
    vary([
      `Dor! ${hunterPlayer.name} nembak ${target.name}! Dan ${target.name} ternyata... ${ROLE_INFO[target.role].name}!`,
      `${hunterPlayer.name} nembak ${target.name} di detik terakhir. ${target.name} ternyata ${ROLE_INFO[target.role].name}.`]),
    'tembakan', 'shot');
  proceedAfterHunter(room, pending.returnTo);
}

function startGame(room) {
  const players = [...room.players.values()];
  const roles = [];
  const comp = roleComposition(players.length, room.settings);
  for (const [role, count] of Object.entries(comp)) {
    for (let i = 0; i < count; i++) roles.push(role);
  }
  const shuffledRoles = shuffle(roles);
  players.forEach((p, i) => {
    p.role = shuffledRoles[i];
    p.alive = true;
    if (p.isBot) p.botMemory = { checked: new Map() };
  });
  room.nightNum = 0;
  room.dayNum = 0;
  room.winner = null;
  room.lastDoctorTarget = null;
  room.log = [];
  room.chatLog = [];
  room.voteResult = null;
  logLine(room, `🎮 Permainan dimulai dengan ${players.length} pemain: ${comp.werewolf} werewolf, ${comp.seer} penerawang, ${comp.doctor} dokter, ${comp.hunter} pemburu, ${comp.villager} warga.`);
  announce(room, '🎮 Permainan Dimulai!',
    'Peran udah dibagikan diam-diam. Cek peranmu di HP masing-masing ya — jangan sampai ada yang ngintip! Malam pertama bakal segera tiba.',
    'Oke guys, permainan dimulai! Peran udah dibagikan diam-diam. Cek HP kalian masing-masing ya.',
    'mulai', 'start');
  room.phase = 'reveal'; // fase singkat: semua orang membaca perannya, host menekan mulai malam
  broadcast(room);
}

function beginFirstNight(room) {
  if (room.phase !== 'reveal') return;
  room.nightNum = 0;
  startNight(room);
}

/* ---------------- aksi bersama (manusia & bot) ---------------- */
function applyNightAction(room, player, target) {
  if (room.phase !== 'night' || !player.alive || !room.night) return null;
  const targetPlayer = room.players.get(target);
  if (!targetPlayer || !targetPlayer.alive) return null;

  if (player.role === 'werewolf') {
    if (targetPlayer.role === 'werewolf') return null; // tidak memangsa sesama werewolf
    if (!room.night.wolfVotes.has(player.token)) room.night.voteOrder.push(target);
    room.night.wolfVotes.set(player.token, target);
    room.night.submitted.add(player.token);
  } else if (player.role === 'seer') {
    if (target === player.token) return null;
    room.night.seer = { by: player.token, target, isWolf: targetPlayer.role === 'werewolf' };
    room.night.submitted.add(player.token);
    if (player.isBot && player.botMemory) player.botMemory.checked.set(target, targetPlayer.role === 'werewolf');
  } else if (player.role === 'doctor') {
    if (room.lastDoctorTarget && room.lastDoctorTarget === target) {
      return 'Tidak boleh melindungi orang yang sama dua malam berturut-turut.';
    }
    room.night.doctorTarget = target;
    room.night.submitted.add(player.token);
  } else {
    return null; // warga & pemburu tidak punya aksi malam
  }
  broadcast(room);
  maybeFinishNight(room);
  return null;
}

function applyVote(room, player, target) {
  if (room.phase !== 'voting' || !player.alive) return;
  if (target !== null) {
    const tp = room.players.get(target);
    if (!tp || !tp.alive || target === player.token) return;
  }
  room.votes.set(player.token, target);
  broadcast(room);
  if (room.votes.size >= alivePlayers(room).length) resolveVoting(room);
}

/* ---------------- bot AI ---------------- */
const BOT_NAMES = ['Sari', 'Joko', 'Rina', 'Bambang', 'Sinta', 'Agus', 'Dewi', 'Rudi',
  'Fitri', 'Eko', 'Maya', 'Hendra', 'Lilis', 'Bima', 'Tari', 'Yoga', 'Wati', 'Dedi'];
let botSeq = 0;

function addBotToRoom(room) {
  const used = new Set([...room.players.values()].map(p => p.name));
  let name = BOT_NAMES.find(n => !used.has(n));
  if (!name) name = 'Bot ' + (++botSeq);
  const token = 'bot-' + (++botSeq) + '-' + Math.random().toString(36).slice(2, 7);
  room.players.set(token, {
    token, socketId: null, name, role: null, alive: true,
    connected: true, isBot: true, joinedAt: now(),
    botMemory: { checked: new Map() },
  });
  return room.players.get(token);
}

const botPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const botDelay = () => 1200 + Math.random() * 2600;

const BOT_CHAT_LINES = [
  'Hmm… semalam siapa aja ya yang gerak-geriknya aneh?',
  'Aku kok curiga sama yang pendiem dari tadi 😅',
  'Jangan asal tuduh dong, mikir dulu baik-baik',
  'Semalam aku tidur nyenyak banget, nggak denger apa-apa',
  'Yang jelas bukan aku ya guys, sumpah',
  'Coba inget-inget, kemarin siapa yang paling ngegas pas voting?',
  'Duh, makin dikit aja kita… serem',
  'Dokter masih hidup kan? Please bilang masih 🙏',
  'Ini sih feeling aku aja ya…',
  'Aku warga biasa beneran, percaya deh',
  'Werewolf-nya pinter banget aktingnya sih ini',
  'Siapa yang semalam nggak tidur? Ngaku!',
];

function botNightTarget(room, bot) {
  const others = alivePlayers(room).filter(p => p.token !== bot.token);
  if (bot.role === 'werewolf') {
    const prey = others.filter(p => p.role !== 'werewolf');
    return prey.length ? botPick(prey).token : null;
  }
  if (bot.role === 'seer') {
    const unchecked = others.filter(p => !bot.botMemory.checked.has(p.token));
    const pool = unchecked.length ? unchecked : others;
    return pool.length ? botPick(pool).token : null;
  }
  if (bot.role === 'doctor') {
    const pool = alivePlayers(room).filter(p => p.token !== room.lastDoctorTarget);
    return pool.length ? botPick(pool).token : null;
  }
  return null;
}

function botVoteTarget(room, bot) {
  const others = alivePlayers(room).filter(p => p.token !== bot.token);
  if (!others.length) return null;
  if (Math.random() < 0.08) return null; // sesekali golput
  if (bot.role === 'werewolf') {
    const prey = others.filter(p => p.role !== 'werewolf');
    return prey.length ? botPick(prey).token : null;
  }
  if (bot.role === 'seer') {
    const knownWolf = others.find(p => bot.botMemory.checked.get(p.token) === true);
    if (knownWolf) return knownWolf.token;
    const notCleared = others.filter(p => bot.botMemory.checked.get(p.token) !== false);
    return botPick(notCleared.length ? notCleared : others).token;
  }
  return botPick(others).token;
}

// Jadwalkan aksi semua bot yang berkepentingan pada fase saat ini.
// Setiap callback memvalidasi ulang fase & nomor malam agar aman dari timer basi.
function scheduleBots(room) {
  const phase = room.phase;
  const nightNum = room.nightNum;
  for (const bot of room.players.values()) {
    if (!bot.isBot) continue;
    if (phase === 'night') {
      if (!bot.alive || !['werewolf', 'seer', 'doctor'].includes(bot.role)) continue;
      if (room.night?.submitted.has(bot.token)) continue;
      setTimeout(() => {
        if (!rooms.has(room.code) || room.phase !== 'night' || room.nightNum !== nightNum) return;
        if (!bot.alive || room.night?.submitted.has(bot.token)) return;
        const target = botNightTarget(room, bot);
        if (target) applyNightAction(room, bot, target);
      }, botDelay());
    } else if (phase === 'voting') {
      if (!bot.alive) continue;
      setTimeout(() => {
        if (!rooms.has(room.code) || room.phase !== 'voting' || room.nightNum !== nightNum) return;
        if (!bot.alive || room.votes.has(bot.token)) return;
        applyVote(room, bot, botVoteTarget(room, bot));
      }, botDelay());
    } else if (phase === 'hunter') {
      if (!room.hunterPending || room.hunterPending.hunterToken !== bot.token) continue;
      setTimeout(() => {
        if (!rooms.has(room.code) || room.phase !== 'hunter') return;
        if (!room.hunterPending || room.hunterPending.hunterToken !== bot.token) return;
        const others = alivePlayers(room).filter(p => p.token !== bot.token);
        if (others.length) hunterShoot(room, bot, botPick(others).token);
      }, botDelay());
    }
  }
  // Obrolan diskusi: maks 2 bot per hari sesekali berkomentar biar terasa hidup
  if (phase === 'day') {
    const dayNum = room.dayNum;
    const chatters = shuffle(alivePlayers(room).filter(p => p.isBot)).slice(0, 2);
    chatters.forEach((bot, i) => {
      setTimeout(() => {
        if (!rooms.has(room.code) || room.phase !== 'day' || room.dayNum !== dayNum) return;
        if (!bot.alive) return;
        pushChat(room, bot.name, botPick(BOT_CHAT_LINES), true, bot.token);
        broadcast(room);
      }, 3500 + i * 6000 + Math.random() * 6000);
    });
  }
}

/* ---------------- socket handlers ---------------- */
function findPlayerBySocket(socketId) {
  const ref = socketIndex.get(socketId);
  if (!ref) return null;
  const room = rooms.get(ref.code);
  if (!room) return null;
  const player = room.players.get(ref.token);
  if (!player) return null;
  return { room, player };
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, token }) => {
    const cleanName = String(name || '').trim().slice(0, 20);
    if (!cleanName || !token) return socket.emit('err', 'Nama dan token wajib ada.');
    const code = makeCode();
    const room = newRoom(code, token);
    room.players.set(token, {
      token, socketId: socket.id, name: cleanName,
      role: null, alive: true, connected: true, joinedAt: now(),
    });
    rooms.set(code, room);
    socketIndex.set(socket.id, { code, token });
    socket.join(code);
    sendState(room, room.players.get(token));
  });

  socket.on('joinRoom', ({ code, name, token }) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return socket.emit('err', 'Room tidak ditemukan. Cek lagi kodenya.');
    if (!token) return socket.emit('err', 'Token tidak valid.');
    const existing = room.players.get(token);
    if (existing) { // reconnect / rejoin
      existing.socketId = socket.id;
      existing.connected = true;
      socketIndex.set(socket.id, { code: room.code, token });
      socket.join(room.code);
      return sendState(room, existing);
    }
    if (room.phase !== 'lobby') return socket.emit('err', 'Permainan sudah berjalan — tidak bisa gabung di tengah.');
    if (room.players.size >= 15) return socket.emit('err', 'Room penuh (maks 15 pemain).');
    const cleanName = String(name || '').trim().slice(0, 20);
    if (!cleanName) return socket.emit('err', 'Nama wajib diisi.');
    room.players.set(token, {
      token, socketId: socket.id, name: cleanName,
      role: null, alive: true, connected: true, joinedAt: now(),
    });
    socketIndex.set(socket.id, { code: room.code, token });
    socket.join(room.code);
    broadcast(room);
  });

  socket.on('rejoin', ({ code, token }) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return socket.emit('err', 'Room sudah tidak ada.');
    const player = room.players.get(token);
    if (!player) return socket.emit('err', 'Kamu tidak terdaftar di room ini.');
    player.socketId = socket.id;
    player.connected = true;
    socketIndex.set(socket.id, { code: room.code, token });
    socket.join(room.code);
    sendState(room, player);
    broadcast(room);
  });

  socket.on('leaveRoom', () => {
    const ref = findPlayerBySocket(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    socketIndex.delete(socket.id);
    socket.leave(room.code);
    if (room.phase === 'lobby') {
      room.players.delete(player.token);
      const humans = [...room.players.values()].filter(p => !p.isBot);
      if (humans.length === 0) { rooms.delete(room.code); return; }
      if (room.hostToken === player.token) {
        room.hostToken = humans[0].token;
      }
      broadcast(room);
    } else {
      player.connected = false;
      broadcast(room);
    }
  });

  socket.on('updateSettings', (settings) => {
    const ref = findPlayerBySocket(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    if (room.hostToken !== player.token || room.phase !== 'lobby') return;
    if (typeof settings.doctor === 'boolean') room.settings.doctor = settings.doctor;
    if (typeof settings.hunter === 'boolean') room.settings.hunter = settings.hunter;
    if (settings.discussionSec) room.settings.discussionSec = Math.min(600, Math.max(30, +settings.discussionSec || 120));
    if (roleComposition(room.players.size, room.settings).villager < 1 && room.players.size >= 5) {
      // jaga-jaga: minimal 1 warga
      room.settings.hunter = false;
      if (roleComposition(room.players.size, room.settings).villager < 1) room.settings.doctor = true;
    }
    broadcast(room);
  });

  socket.on('addBot', () => {
    const ref = findPlayerBySocket(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    if (room.hostToken !== player.token || room.phase !== 'lobby') return;
    if (room.players.size >= 15) return socket.emit('err', 'Room sudah penuh (maks 15 pemain).');
    addBotToRoom(room);
    broadcast(room);
  });

  socket.on('removeBot', ({ token }) => {
    const ref = findPlayerBySocket(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    if (room.hostToken !== player.token || room.phase !== 'lobby') return;
    const bot = room.players.get(token);
    if (bot?.isBot) {
      room.players.delete(token);
      broadcast(room);
    }
  });

  socket.on('startGame', () => {
    const ref = findPlayerBySocket(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    if (room.hostToken !== player.token || room.phase !== 'lobby') return;
    if (room.players.size < 5) return socket.emit('err', 'Minimal 5 pemain untuk mulai.');
    if (roleComposition(room.players.size, room.settings).villager < 1) {
      return socket.emit('err', 'Komposisi peran tidak valid — kurangi peran khusus.');
    }
    startGame(room);
  });

  socket.on('beginNight', () => {
    const ref = findPlayerBySocket(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    if (room.hostToken !== player.token) return;
    beginFirstNight(room);
  });

  socket.on('nightAction', ({ target }) => {
    const ref = findPlayerBySocket(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    const err = applyNightAction(room, player, target);
    if (err) socket.emit('err', err);
  });

  socket.on('hunterShot', ({ target }) => {
    const ref = findPlayerBySocket(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    if (room.phase !== 'hunter' || !room.hunterPending) return;
    if (room.hunterPending.hunterToken !== player.token) return;
    hunterShoot(room, player, target);
  });

  socket.on('startVoting', () => {
    const ref = findPlayerBySocket(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    if (room.hostToken !== player.token) return;
    startVoting(room);
  });

  socket.on('forceAdvance', () => {
    const ref = findPlayerBySocket(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    if (room.hostToken !== player.token) return;
    if (room.phase === 'night') resolveNight(room);
    else if (room.phase === 'voting') resolveVoting(room);
    else if (room.phase === 'hunter') expireHunter(room);
  });

  socket.on('castVote', ({ target }) => {
    const ref = findPlayerBySocket(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    applyVote(room, player, target);
  });

  socket.on('chat', ({ text }) => {
    const ref = findPlayerBySocket(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    if (room.phase !== 'day' && room.phase !== 'voting') return;
    if (!player.alive) return socket.emit('err', 'Kamu sudah gugur — cuma bisa menyimak obrolan.');
    const clean = String(text || '').trim().slice(0, 300);
    if (!clean) return;
    const t = now();
    if (player.lastChatAt && t - player.lastChatAt < 600) return;
    player.lastChatAt = t;
    pushChat(room, player.name, clean, false, player.token);
    broadcast(room);
  });

  socket.on('playAgain', () => {
    const ref = findPlayerBySocket(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    if (room.hostToken !== player.token || room.phase !== 'over') return;
    clearAllTimers(room);
    room.phase = 'lobby';
    room.winner = null;
    room.voteResult = null;
    room.night = null;
    for (const p of room.players.values()) { p.role = null; p.alive = true; }
    announce(room, '🏠 Kembali ke Lobby', 'Permainan selesai. Host bisa mengatur ulang dan mulai lagi.', '');
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const ref = findPlayerBySocket(socket.id);
    socketIndex.delete(socket.id);
    if (!ref) return;
    const { room, player } = ref;
    if (player.socketId !== socket.id) return; // sudah reconnect dengan socket baru
    player.connected = false;
    if (room.phase === 'lobby') {
      room.players.delete(player.token);
      const humans = [...room.players.values()].filter(p => !p.isBot);
      if (humans.length === 0) { rooms.delete(room.code); return; }
      if (room.hostToken === player.token) {
        room.hostToken = humans[0].token;
      }
    }
    broadcast(room);
  });
});

server.listen(PORT, () => {
  console.log(`🐺 Werewolf Online jalan di http://localhost:${PORT}`);
});
