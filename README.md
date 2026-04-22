# Work Journal (Firebase Realtime)

Website jurnal kerja pribadi berbasis static files, siap deploy ke **GitHub Pages**, dengan sinkronisasi **realtime via Firebase Realtime Database**.

## Fitur Utama
- Dashboard fokus harian + quick note.
- Deep Work timer (start, pause, reset, tambah 5 menit).
- Task manager (today focus, upcoming, completed).
- Reflections editor (went well, challenges, notes, tags).
- Calendar / weekly log untuk lihat progres mingguan.
- Realtime sync lintas perangkat via Firebase.
- Backup dan restore manual lewat file JSON (`Export JSON` / `Import JSON`).

## Struktur File
- `index.html` -> struktur halaman.
- `styles.css` -> styling desktop + mobile.
- `app.js` -> logika aplikasi + realtime sync Firebase.
- `firebase-config.js` -> konfigurasi Firebase Anda.

## Setup Firebase (Wajib untuk Realtime)
1. Buat project di Firebase Console.
2. Aktifkan `Build > Realtime Database` (mode test dulu tidak apa-apa).
3. Aktifkan `Build > Authentication > Sign-in method > Anonymous`.
4. Ambil config web app Firebase (`apiKey`, `authDomain`, dst).
5. Edit `firebase-config.js`:
```js
window.WORK_JOURNAL_FIREBASE = {
  enabled: true,
  workspaceId: "isi-kode-random-unik",
  firebaseConfig: {
    apiKey: "...",
    authDomain: "...",
    databaseURL: "...",
    projectId: "...",
    storageBucket: "...",
    messagingSenderId: "...",
    appId: "...",
  },
};
```
6. Realtime Database Rules (minimum):
```json
{
  "rules": {
    "work-journal": {
      "$workspaceId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

## Deploy ke GitHub Pages
1. Push project ini ke repo GitHub (branch `main`).
2. Buka `Settings > Pages`.
3. Pilih `Deploy from a branch`.
4. Pilih `main` dan folder `/ (root)`.
5. Tunggu 1-3 menit sampai URL aktif.

## Jalankan Lokal
Langsung buka `index.html` atau pakai server lokal:
```bash
python -m http.server 8080
```
Lalu akses `http://localhost:8080`.

## Catatan
- Bila Firebase belum dikonfigurasi, app tetap jalan dengan data lokal browser.
- Untuk privasi lebih baik, pakai `workspaceId` yang panjang dan sulit ditebak.
