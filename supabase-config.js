// ============================================================================
// FILE: supabase-config.js
// DESKRIPSI: Kompatibilitas Konfigurasi Supabase & Cloudinary (Sinkron dengan config.js)
// ============================================================================
if (!window.PORTAL_CONFIG) {
  window.PORTAL_CONFIG = {
    SUPABASE_URL: 'https://mqvvaszlutjokflihcpm.supabase.co',
    SUPABASE_ANON_KEY: 'sb_secret_MOQDr1aIcF26IHU4mKmOZA_2Aaos7_z',
    CLOUDINARY: {
      ENABLED: true,
      CLOUD_NAME: '',
      UPLOAD_PRESET: '',
      API_KEY: '',
      API_SECRET: '',
      FOLDER: 'portal-sekolah-smandum',
      AUTO_OPTIMIZE: true
    }
  };
}
