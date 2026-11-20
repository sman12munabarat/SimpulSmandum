// ============================================================================
// FILE: config.js
// DESKRIPSI: Konfigurasi Utama Database Supabase & Penyimpanan Media Cloudinary
//            Aplikasi Portal Sekolah (SMAN 12 Muna Barat - Simpul Smandum)
//            Arsitektur Hemat Kuota Bandwidth Egress & Storage Supabase
// ============================================================================

(function () {
  'use strict';

  // 1. KREDENSIAL DEFAULT SUPABASE (Dapat diubah di sini atau melalui Menu Pengaturan Admin)
  const DEFAULT_SUPABASE_URL = 'https://jpaaidqdyarboowjusom.supabase.co';
  const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_GjKXAsbZi1HP2kkBGMvMzg_cmyIFcu6';

  // 2. KONFIGURASI DEFAULT CLOUDINARY CDN
  // Seluruh Foto, File Dokumen (PDF/PPT/Word/Excel), Audio/Voicenote, dan Video
  // disimpan di Cloudinary agar Database & Storage Supabase bebas beban Base64 / Egress.
  const DEFAULT_CLOUDINARY_CONFIG = {
    ENABLED: true,
    CLOUD_NAME: '',          // Isi dengan Cloud Name Cloudinary Anda (contoh: 'dxyz12345')
    UPLOAD_PRESET: '',       // Isi dengan Unsigned Upload Preset (contoh: 'portal_sekolah_preset')
    API_KEY: '',             // Opsional: API Key Cloudinary (untuk Signed Upload)
    API_SECRET: '',          // Opsional: API Secret Cloudinary (untuk Signed Upload)
    FOLDER: 'portal-sekolah-smandum',
    AUTO_OPTIMIZE: true      // Otomatis kompresi & format optimal (f_auto,q_auto)
  };

  // 3. DAFTAR TABEL DATABASE SUPABASE TERBARU (15 TABEL) & KLASIFIKASI PER-SEMESTER
  const DATABASE_TABLES = {
    // Tabel Master & Identitas
    Users:            { pk: 'ID',            category: 'master',        label: 'Data Guru & Administrator' },
    PendingUsers:     { pk: 'ID',            category: 'master',        label: 'Pendaftaran Guru Baru' },
    Classes:          { pk: 'ID Kelas',      category: 'master',        label: 'Data Kelas / Rombel' },
    Students:         { pk: 'ID Siswa',      category: 'master',        label: 'Data Siswa' },
    Subjects:         { pk: 'ID Mapel',      category: 'academic',      label: 'Mata Pelajaran & Jadwal' },
    Settings:         { pk: 'Key',           category: 'settings',      label: 'Pengaturan & Konfigurasi Portal' },
    Announcements:    { pk: 'ID',            category: 'academic',      label: 'Pengumuman Sekolah' },
    // Tabel Transaksi Akademik Per-Semester
    Attendance:       { pk: 'ID Absen',      category: 'transactional', label: 'Riwayat Absensi Siswa' },
    Exams:            { pk: 'ID Ujian',      category: 'transactional', label: 'Jadwal & Paket Ujian CBT' },
    Questions:        { pk: 'ID Soal',       category: 'transactional', label: 'Bank Soal Ujian CBT' },
    Grades:           { pk: 'ID Nilai',      category: 'transactional', label: 'Rekap Nilai Siswa' },
    Violations:       { pk: 'ID',            category: 'transactional', label: 'Catatan Pelanggaran Ujian' },
    ExamSessions:     { pk: 'ID Sesi',       category: 'transactional', label: 'Sesi & Lembar Jawaban Ujian' },
    Learnings:        { pk: 'ID',            category: 'transactional', label: 'Materi Ruang Pembelajaran' },
    LearningSessions: { pk: 'ID',            category: 'transactional', label: 'Kehadiran & Tugas Ruang Belajar' }
  };

  // Baca override runtime dari localStorage (jika Admin memperbarui lewat Panel Pengaturan)
  function _loadRuntimeJson(key) {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw);
      }
    } catch (e) { }
    return null;
  }

  const runtimeSb = _loadRuntimeJson('portal_runtime_supabase_config') || {};
  const runtimeCloud = _loadRuntimeJson('portal_cloudinary_config') || _loadRuntimeJson('portal_cloud_drive_config') || {};

  const activeSupabaseUrl = (runtimeSb.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const activeSupabaseKey = (runtimeSb.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY).trim();

  const activeCloudinary = {
    ENABLED: runtimeCloud.ENABLED !== undefined ? Boolean(runtimeCloud.ENABLED) : DEFAULT_CLOUDINARY_CONFIG.ENABLED,
    CLOUD_NAME: (runtimeCloud.cloudinaryCloudName || runtimeCloud.CLOUD_NAME || DEFAULT_CLOUDINARY_CONFIG.CLOUD_NAME || '').trim(),
    UPLOAD_PRESET: (runtimeCloud.cloudinaryUploadPreset || runtimeCloud.UPLOAD_PRESET || DEFAULT_CLOUDINARY_CONFIG.UPLOAD_PRESET || '').trim(),
    API_KEY: (runtimeCloud.cloudinaryApiKey || runtimeCloud.API_KEY || DEFAULT_CLOUDINARY_CONFIG.API_KEY || '').trim(),
    API_SECRET: (runtimeCloud.cloudinaryApiSecret || runtimeCloud.API_SECRET || DEFAULT_CLOUDINARY_CONFIG.API_SECRET || '').trim(),
    FOLDER: (runtimeCloud.cloudinaryFolder || runtimeCloud.FOLDER || DEFAULT_CLOUDINARY_CONFIG.FOLDER || 'portal-sekolah-smandum').trim(),
    AUTO_OPTIMIZE: runtimeCloud.AUTO_OPTIMIZE !== undefined ? Boolean(runtimeCloud.AUTO_OPTIMIZE) : DEFAULT_CLOUDINARY_CONFIG.AUTO_OPTIMIZE
  };

  window.PORTAL_CONFIG = {
    VERSION: '2.5.0-cloudinary-semester',
    SUPABASE_URL: activeSupabaseUrl,
    SUPABASE_ANON_KEY: activeSupabaseKey,
    CLOUDINARY: activeCloudinary,
    DATABASE_TABLES: DATABASE_TABLES,
    TABLE_NAMES: Object.keys(DATABASE_TABLES),
    TRANSACTIONAL_TABLES: Object.keys(DATABASE_TABLES).filter(t => DATABASE_TABLES[t].category === 'transactional'),
    MASTER_TABLES: Object.keys(DATABASE_TABLES).filter(t => DATABASE_TABLES[t].category !== 'transactional'),

    // Pengaturan Penghematan Bandwidth Egress & Storage Supabase
    EGRESS_OPTIMIZATION: {
      OFFLOAD_ALL_MEDIA_TO_CLOUDINARY: true,
      BLOCK_BASE64_IN_SUPABASE: true,
      MAX_INLINE_TEXT_BYTES: 500,
      BATCH_UPSERT_SIZE: 100,
      CACHE_TTL_MS: 5 * 60 * 1000
    },

    getSupabaseConfig() {
      const saved = _loadRuntimeJson('portal_runtime_supabase_config') || {};
      return {
        SUPABASE_URL: (saved.SUPABASE_URL || this.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim(),
        SUPABASE_ANON_KEY: (saved.SUPABASE_ANON_KEY || this.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY).trim()
      };
    },

    saveSupabaseConfig(newCfg = {}) {
      const url = String(newCfg.SUPABASE_URL || newCfg.url || this.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
      const key = String(newCfg.SUPABASE_ANON_KEY || newCfg.anonKey || this.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY).trim();
      this.SUPABASE_URL = url;
      this.SUPABASE_ANON_KEY = key;
      try {
        localStorage.setItem('portal_runtime_supabase_config', JSON.stringify({
          SUPABASE_URL: url,
          SUPABASE_ANON_KEY: key,
          updatedAt: new Date().toISOString()
        }));
      } catch (e) { }
      return { SUPABASE_URL: url, SUPABASE_ANON_KEY: key };
    },

    getCloudinaryConfig() {
      const saved = _loadRuntimeJson('portal_cloudinary_config') || _loadRuntimeJson('portal_cloud_drive_config') || {};
      return {
        ENABLED: saved.ENABLED !== undefined ? Boolean(saved.ENABLED) : this.CLOUDINARY.ENABLED,
        CLOUD_NAME: String(saved.cloudinaryCloudName || saved.CLOUD_NAME || this.CLOUDINARY.CLOUD_NAME || '').trim(),
        UPLOAD_PRESET: String(saved.cloudinaryUploadPreset || saved.UPLOAD_PRESET || this.CLOUDINARY.UPLOAD_PRESET || '').trim(),
        API_KEY: String(saved.cloudinaryApiKey || saved.API_KEY || this.CLOUDINARY.API_KEY || '').trim(),
        API_SECRET: String(saved.cloudinaryApiSecret || saved.API_SECRET || this.CLOUDINARY.API_SECRET || '').trim(),
        FOLDER: String(saved.cloudinaryFolder || saved.FOLDER || this.CLOUDINARY.FOLDER || 'portal-sekolah-smandum').trim(),
        AUTO_OPTIMIZE: saved.AUTO_OPTIMIZE !== undefined ? Boolean(saved.AUTO_OPTIMIZE) : true
      };
    },

    saveCloudinaryConfig(newCfg = {}) {
      const current = this.getCloudinaryConfig();
      const updated = {
        ENABLED: newCfg.ENABLED !== undefined ? Boolean(newCfg.ENABLED) : current.ENABLED,
        CLOUD_NAME: String(newCfg.CLOUD_NAME ?? newCfg.cloudinaryCloudName ?? current.CLOUD_NAME ?? '').trim(),
        UPLOAD_PRESET: String(newCfg.UPLOAD_PRESET ?? newCfg.cloudinaryUploadPreset ?? current.UPLOAD_PRESET ?? '').trim(),
        API_KEY: String(newCfg.API_KEY ?? newCfg.cloudinaryApiKey ?? current.API_KEY ?? '').trim(),
        API_SECRET: String(newCfg.API_SECRET ?? newCfg.cloudinaryApiSecret ?? current.API_SECRET ?? '').trim(),
        FOLDER: String(newCfg.FOLDER ?? newCfg.cloudinaryFolder ?? current.FOLDER ?? 'portal-sekolah-smandum').trim(),
        AUTO_OPTIMIZE: newCfg.AUTO_OPTIMIZE !== undefined ? Boolean(newCfg.AUTO_OPTIMIZE) : current.AUTO_OPTIMIZE
      };
      this.CLOUDINARY = updated;
      try {
        localStorage.setItem('portal_cloudinary_config', JSON.stringify(updated));
      } catch (e) { }
      return updated;
    },

    generateConfigJsCode() {
      const sb = this.getSupabaseConfig();
      const cl = this.getCloudinaryConfig();
      return `// ============================================================================
// FILE: config.js
// DESKRIPSI: Konfigurasi Database Supabase & Cloudinary CDN - Portal Sekolah
// Di-generate pada: ${new Date().toLocaleString('id-ID')}
// ============================================================================

window.PORTAL_CONFIG = window.PORTAL_CONFIG || {};
window.PORTAL_CONFIG.SUPABASE_URL = '${sb.SUPABASE_URL}';
window.PORTAL_CONFIG.SUPABASE_ANON_KEY = '${sb.SUPABASE_ANON_KEY}';
window.PORTAL_CONFIG.CLOUDINARY = {
  ENABLED: true,
  CLOUD_NAME: '${cl.CLOUD_NAME}',
  UPLOAD_PRESET: '${cl.UPLOAD_PRESET}',
  API_KEY: '${cl.API_KEY}',
  API_SECRET: '${cl.API_SECRET}',
  FOLDER: '${cl.FOLDER || 'portal-sekolah-smandum'}',
  AUTO_OPTIMIZE: true
};
`;
    }
  };
})();
