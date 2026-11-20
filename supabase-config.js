// ============================================================================
// FILE: supabase-config.js
// DESKRIPSI: Konfigurasi Database Supabase Terbaru & Cloudinary (Sinkron Aktif dengan config.js)
// ============================================================================
(function () {
  var NEW_SUPABASE_URL = 'https://mqvvaszlutjokflihcpm.supabase.co';
  var NEW_SUPABASE_KEY = 'sb_secret_MOQDr1aIcF26IHU4mKmOZA_2Aaos7_z';
  var NEW_SUPABASE_SECRET_KEY = 'sb_secret_MOQDr1aIcF26IHU4mKmOZA_2Aaos7_z';

  window.PORTAL_CONFIG = window.PORTAL_CONFIG || {};

  // Pastikan selalu menggunakan database Supabase baru (bukan database lama jpaaidqdyarboowjusom yang sudah ter-pause)
  if (!window.PORTAL_CONFIG.SUPABASE_URL || window.PORTAL_CONFIG.SUPABASE_URL.indexOf('jpaaidqdyarboowjusom') !== -1) {
    window.PORTAL_CONFIG.SUPABASE_URL = NEW_SUPABASE_URL;
  } else {
    window.PORTAL_CONFIG.SUPABASE_URL = NEW_SUPABASE_URL;
  }

  if (!window.PORTAL_CONFIG.SUPABASE_ANON_KEY || window.PORTAL_CONFIG.SUPABASE_ANON_KEY.indexOf('GjKXAsbZi1HP2kkBGMvMzg') !== -1) {
    window.PORTAL_CONFIG.SUPABASE_ANON_KEY = NEW_SUPABASE_KEY;
  } else {
    window.PORTAL_CONFIG.SUPABASE_ANON_KEY = NEW_SUPABASE_KEY;
  }

  window.PORTAL_CONFIG.SUPABASE_SECRET_KEY = NEW_SUPABASE_SECRET_KEY;

  if (!window.PORTAL_CONFIG.CLOUDINARY) {
    window.PORTAL_CONFIG.CLOUDINARY = {
      ENABLED: true,
      CLOUD_NAME: '',
      UPLOAD_PRESET: '',
      API_KEY: '',
      API_SECRET: '',
      FOLDER: 'portal-sekolah-smandum',
      AUTO_OPTIMIZE: true
    };
  }
})();
