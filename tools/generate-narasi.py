#!/usr/bin/env python3
"""Generate ulang semua klip narator (public/narasi/*.mp3) dengan TTS.
Suara aktif: Suara B — 'Musing Mirror' (Indonesia, rendah, kalem) — pilihan user 2026-10-12.
Jalankan: python3 tools/generate-narasi.py
"""
import subprocess, os, json, sys

VOICE = 'avocado_v2:vd2_r8_rep1k_0363_v068_28k_g5k'  # Suara B — Musing Mirror
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'narasi')

LINES = {
 'mulai-1': 'Oke guys, permainan dimulai! Peran sudah dibagikan diam-diam. Cek HP kalian masing-masing ya, jangan sampai ada yang ngintip.',
 'mulai-2': 'Nah, permainan dimulai! Setiap orang sudah dapat perannya. Simpan baik-baik, jangan kasih tahu siapa-siapa ya.',
 'malam-1': 'Nah, malam pun tiba. Desa mulai terlelap... Werewolf, penerawang, dan dokter, giliran kalian beraksi. Sstt, pelan-pelan ya.',
 'malam-2': 'Oke, matahari sudah tenggelam. Desa mulai sepi... yang punya tugas malam, silakan beraksi dari HP-nya masing-masing.',
 'malam-3': 'Malam lagi nih. Semua tidur ya... kecuali yang lagi dapat giliran jaga malam.',
 'pagi-korban-1': 'Pagi semuanya! Tapi... ada kabar buruk. Semalam ada yang jadi korban. Cek pengumumannya di layar ya.',
 'pagi-korban-2': 'Pagi! Hmm, semalam ada kejadian... ada warga yang nggak selamat. Lihat pengumumannya, terus kita diskusi.',
 'pagi-selamat-1': 'Pagi! Kabar baik nih, semalam nggak ada korban. Dokternya berhasil nyelametin mangsa werewolf. Keren banget!',
 'pagi-selamat-2': 'Pagi semuanya! Tenang, semalam aman. Nggak ada yang jadi korban. Dokternya jago banget sih.',
 'pagi-sepi-1': 'Pagi! Semalam sepi-sepi aja, nggak ada korban. Heran, werewolf-nya lagi pada diet kali ya.',
 'voting-1': 'Oke oke, diskusinya cukup. Waktunya voting! Pilih satu orang yang paling kalian curigai.',
 'voting-2': 'Nah, sekarang bagian paling deg-degan: voting. Tunjuk siapa yang menurut kalian werewolf-nya.',
 'eksekusi-1': 'Voting selesai... dan ada yang dieksekusi! Lihat di layar, ternyata dia siapa.',
 'eksekusi-2': 'Keputusan sudah bulat. Ada satu orang yang dieksekusi hari ini. Cek hasilnya di layar ya.',
 'seri-1': 'Waduh, suaranya seri! Nggak ada yang dieksekusi hari ini. Werewolf-nya masih berkeliaran tuh.',
 'seri-2': 'Seri nih! Nggak ada eksekusi hari ini. Yaudah, kita lanjut ke malam berikutnya.',
 'pemburu-gugur-1': 'Eh, tunggu dulu! Yang gugur itu ternyata Pemburu. Dia masih sempat nembak satu orang terakhir. Deg-degan nih...',
 'tembakan-1': 'Dor! Tembakannya kena satu orang! Cek di layar siapa korbannya.',
 'tembakan-2': 'Di detik terakhir, Pemburu nembak satu orang! Lihat siapa yang kena di layar ya.',
 'pemburu-lewat-1': 'Yah, kelamaan. Pemburunya nggak sempat nembak. Yaudah, kita lanjut aja.',
 'menang-warga-1': 'Selesai! Warga desa menang! Semua werewolf berhasil disingkirkan. Desa akhirnya aman lagi. Selamat ya semuanya!',
 'menang-warga-2': 'Hore, warga menang! Werewolf-nya sudah habis. Malam ini semua bisa tidur nyenyak.',
 'menang-wolf-1': 'Yahh, gamenya selesai... werewolf yang menang. Desa resmi dikuasai werewolf. Coba lagi ya!',
 'menang-wolf-2': 'Game over! Werewolf menang. Diam-diam mereka menguasai desa. Yang tersisa cuma bisa pasrah.',
 'tes-1': 'Halo! Aku narator kalian malam ini. Siap-siap ya... desa ini lagi nggak aman.',
}

def main():
    os.makedirs(OUT, exist_ok=True)
    ok, fail = [], []
    for key, text in LINES.items():
        path = os.path.join(OUT, key + '.mp3')
        r = subprocess.run(['/opt/hatch/bin/tts', 'speak', '--voice', VOICE, '--language', 'id',
                            '--output', path, '--text-stdin'],
                           input=text, capture_output=True, text=True, timeout=180)
        try:
            res = json.loads(r.stdout)
            if res.get('ok'): ok.append(key)
            else: fail.append((key, r.stdout[:120]))
        except Exception:
            fail.append((key, (r.stdout + r.stderr)[:120]))
    print(f'OK: {len(ok)}/{len(LINES)} klip')
    if fail:
        print('GAGAL:', fail)
        sys.exit(1)

if __name__ == '__main__':
    main()
