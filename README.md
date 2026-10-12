# 🐺 Werewolf Online

Game Werewolf **multiplayer online** — main bareng teman dari jarak jauh. Satu orang membuat room dan membagikan **kode 4 huruf**, semua pemain gabung dari HP/laptop masing-masing, dan server membagikan peran secara rahasia. Fase malam, diskusi, voting, sampai penentuan pemenang berjalan otomatis dan sinkron di semua perangkat.

Dilengkapi **narator suara Bahasa Indonesia** (dibacakan otomatis di tiap HP pemain, bisa dimatikan per pemain) dan tampilan interaktif bertema malam.

Bisa juga dimainkan **melawan bot AI**: sendiri untuk latihan, atau untuk mengisi kursi kosong di room multiplayer.

## Cara Menjalankan (Lokal)

Butuh Node.js 18+.

```bash
npm install
npm start
```

Buka `http://localhost:3000` di browser. Untuk dicoba dari HP di jaringan yang sama, buka `http://<IP-komputer>:3000`.

## Cara Main

1. Satu pemain menekan **Buat Room Baru** → dapat kode room (cth: `K7QX`).
2. Bagikan kode ke teman-teman (5–15 pemain). Mereka buka alamat yang sama, isi nama + kode, lalu **Gabung Room**.
3. Host mengatur opsi (Dokter, Pemburu, durasi diskusi) lalu menekan **Mulai Game**.
4. Setiap pemain melihat kartunya sendiri — ketuk untuk membalik dan membaca peran secara rahasia.
5. **Malam:** Werewolf memilih mangsa, Penerawang menerawang identitas, Dokter melindungi seseorang — semua dari HP masing-masing.
6. **Siang:** korban diumumkan, diskusi dengan timer, lalu voting. Suara terbanyak dieksekusi; seri = tidak ada eksekusi.
7. **Pemburu** (jika diaktifkan) yang gugur boleh menembak satu pemain terakhir (batas waktu 60 detik, biar game tidak menggantung).
8. Warga menang bila semua werewolf gugur; werewolf menang bila jumlahnya menyamai warga.

Aturan yang dijaga server: dokter tidak boleh melindungi orang yang sama dua malam berturut-turut; werewolf tidak bisa memangsa sesamanya; peran pemain lain tidak pernah dikirim ke HP yang tidak berhak (werewolf hanya melihat rekannya, penerawang hanya melihat hasil terawangannya sendiri). Pemain yang putus koneksi bisa masuk lagi ke room yang sama dan melanjutkan dengan peran yang sama.

## Main dengan Bot

- **Solo:** di halaman awal pilih **🤖 Main Sendiri vs Bot** — room otomatis terisi 6 bot dan permainan langsung dimulai.
- **Isi kursi kosong:** di lobby, host menekan **🤖 Tambah Bot** (bisa dihapus lagi dengan tombol ✕) sampai jumlah pemain cukup (total tetap 5–15 termasuk bot).
- Bot bermain penuh seperti pemain biasa: memangsa/menerawang/melindungi di malam hari (penerawang bot mengingat hasil terawangannya dan memakainya saat voting), ikut voting, dan bot Pemburu akan menembak saat gugur. Bot bertindak dengan jeda 1–4 detik agar permainan terasa alami.

## Deploy (Pilih Salah Satu)

Game ini butuh server Node.js yang selalu jalan (WebSocket). **Tidak bisa** dihosting sebagai situs statis saja.

### Opsi A — VPS kamu sendiri (disarankan)

```bash
# di VPS
git clone <repo-ini> werewolf-online   # atau upload & ekstrak ZIP-nya
cd werewolf-online
npm install
npm install -g pm2
PORT=3000 pm2 start server.js --name werewolf
pm2 save && pm2 startup   # agar otomatis jalan lagi setelah reboot
```

Lalu arahkan domain/subdomain ke VPS (DNS A record) dan, bila mau HTTPS, pasang reverse proxy (Nginx/Caddy) ke `localhost:3000`. Caddy paling gampang:

```
werewolf.domainkamu.com {
    reverse_proxy localhost:3000
}
```

### Opsi B — Docker

```bash
docker build -t werewolf-online .
docker run -d -p 3000:3000 --name werewolf werewolf-online
```

### Opsi C — Render / Railway / Fly.io

- **Render:** New Web Service → hubungkan repo → Build Command `npm install`, Start Command `npm start`. Render otomatis memberi `PORT`.
- **Railway:** New Project → Deploy from repo → otomatis jalan dengan `npm start`.
- **Fly.io:** `fly launch` lalu `fly deploy` (Dockerfile sudah disertakan).

Catatan: room tersimpan di memori server — kalau server restart, room yang sedang berjalan hilang (pemain tinggal buat room baru). Untuk main santai bareng teman ini tidak masalah.

## Pengembangan & Uji

```bash
PORT=3100 node server.js     # terminal 1
node test/simulate.js        # terminal 2 — 7 bot memainkan 1 game penuh
```

`test/simulate.js` memeriksa: pembuatan room, komposisi peran, privasi peran antar pemain, reconnect di tengah game, alur malam→siang→voting sampai ada pemenang, dan tombol Main Lagi kembali ke lobby.

```bash
node test/simulate-bots.js   # 1 klien manusia + 6 bot server main sampai selesai
```

`test/simulate-bots.js` memeriksa mode bot: tambah/hapus bot di lobby, bot bertindak di semua fase (termasuk tembakan Pemburu bot dan penyelamatan Dokter bot), sampai ada pemenang.

## Struktur

```
server.js          Logika game + server Socket.io (satu file)
public/
  index.html       Kerangka tampilan
  style.css        Tema malam interaktif (animasi bulan, bintang, kartu flip)
  app.js           Client: lobby, gameplay, narator suara id-ID
test/simulate.js   Bot penguji end-to-end (multiplayer)
test/simulate-bots.js  Bot penguji mode bot (1 manusia + bot server)
```
