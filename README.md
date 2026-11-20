# 🏫 Portal Sekolah (Standalone Web App + Supabase + Cloudinary CDN)

Aplikasi Portal Akademik, Manajemen Pembelajaran, Absensi Siswa, SPMB, dan Ujian CBT Online dengan deteksi anti-curang.

Aplikasi ini menggunakan **Arsitektur Standalone Modern** berbasis **Supabase (PostgreSQL)** untuk data teks/relasional dan **Cloudinary CDN** untuk seluruh foto, dokumen (PDF/PPT/Word), audio voicenote, dan video pembelajaran — sehingga sangat hemat kuota *Bandwidth Egress* dan *Storage* Supabase.

---

## 🌟 Fitur Utama
1. **Multi-Role User**: Administrator, Guru, dan Ruang Siswa (Web & Mobile PWA).
2. **Backup, Restore & Ganti Data Per-Semester (Panel Admin ➔ Pengaturan)**:
   - **Download Backup Seluruh Data (`.backup`)**: Menyimpan seluruh 15 tabel database Supabase dalam format PostgreSQL Cluster Dump (`db_cluster-DD-MM-YYYY@HH-MM-SS.backup`) beserta Ruang Belajar, Tugas, Diskusi, Galeri, dan SPMB untuk arsip per-semester.
   - **Upload & Ganti Data Per-Semester**: Memulihkan atau mengganti seluruh data aplikasi dengan file `.backup` semester yang dipilih ke database Supabase terbaru.
   - **Arsipkan & Mulai Semester Baru**: Mengosongkan data transaksi semester lama (Absensi, Ujian, Nilai, Ruang Belajar) dengan tetap mempertahankan Data Master (Guru, Kelas, Siswa, Mapel, Identitas Sekolah).
3. **Penyimpanan Media Cloudinary CDN (Bebas Kuota Egress Supabase)**:
   - Seluruh foto profil, logo, background, galeri, file materi (PDF/PPT/Word), video pembelajaran, tugas siswa, voicenote ujian, dan berkas SPMB otomatis diunggah ke Cloudinary CDN.
4. **Manajemen Akademik & Ruang Pembelajaran**:
   - Data Kelas, Siswa, Jadwal & Mata Pelajaran
   - Absensi Siswa (Harian, Rekap, Cetak Laporan)
   - Ruang Pembelajaran Interaktif (Modul PDF/PPT/Video, Pembagian Kelompok & Ketua, Pengumpulan Tugas, Forum Diskusi)
5. **Ujian Online CBT & Anti-Curang**:
   - Bank Soal (Pilihan Ganda & Essay dengan Lampiran Foto / Voicenote)
   - Token Ujian Fleksibel & Deteksi Pindah Tab / Layar

---

## 📂 Struktur File Utama

| File | Keterangan |
| :--- | :--- |
| `index.html` | Aplikasi Web Utama Portal Sekolah (Admin, Guru, Siswa, SPMB) |
| `config.js` | Konfigurasi utama Database Supabase terbaru & Cloudinary CDN |
| `supabase-config.js` | File kompatibilitas konfigurasi Supabase |
| `supabase-bridge.js` | Jembatan penghubung UI ke Supabase, Backup/Restore Semester & Cloudinary CDN |
| `schema.sql` | Skrip SQL lengkap 15 tabel database Supabase |
| `portal-guru-siswa/` | Aplikasi Mobile PWA pendamping khusus Portal Guru & Ruang Siswa |

---

## 🚀 Cara Konfigurasi Cepat

1. **Database Supabase (`config.js`)**:
   - Jalankan `schema.sql` di **SQL Editor** Supabase Anda.
   - Masukkan `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di [`config.js`](config.js) atau langsung melalui **Panel Admin ➔ Pengaturan**.
2. **Penyimpanan Media Cloudinary (`config.js` / Menu Pengaturan)**:
   - Masuk ke **Panel Admin ➔ Pengaturan ➔ Penyimpanan Media Cloudinary CDN**.
   - Isi **Cloud Name** dan **Upload Preset (Unsigned)** (atau API Key & API Secret), lalu klik **Tes Koneksi** dan **Simpan Pengaturan**.
