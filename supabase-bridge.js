// ============================================================================
// FILE: supabase-bridge.js
// DESKRIPSI: Jembatan Standalone Pengganti Google Apps Script (Code.gs)
//             Menghubungkan Frontend langsung ke Supabase Client & Cloudinary CDN
// ============================================================================

(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.__PORTAL_SUPABASE_BRIDGE_LOADED__ && window.google && window.google.script && window.google.script.run) {
    return;
  }
  if (typeof window !== 'undefined') {
    window.__PORTAL_SUPABASE_BRIDGE_LOADED__ = true;
    window.google = window.google || {};
    window.google.script = window.google.script || {};
  }

  // 1. Inisialisasi Supabase & Sinkronisasi Database Lokal SMAN 12 Muna Barat
  const config = window.PORTAL_CONFIG || {};
  let rawSupabaseClient = null;
  let smartSupabaseClient = null;
  let _activeClientFingerprint = '';
  let _quotaRestrictedUntil = 0;
  let _quotaRestrictedFp = '';

  // Bersihkan sisa circuit-breaker lama dari database jpaaidqdyarboowjusom yang ter-pause
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('portal_sb_quota_restricted_until');
      const savedRt = localStorage.getItem('portal_runtime_supabase_config');
      if (savedRt && savedRt.includes('jpaaidqdyarboowjusom')) {
        localStorage.removeItem('portal_runtime_supabase_config');
      }
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('portal_sb_quota_restricted_until');
    }
  } catch (e) { }

  function _getActiveSbConfig() {
    if (typeof window !== 'undefined' && window.PORTAL_CONFIG && typeof window.PORTAL_CONFIG.getSupabaseConfig === 'function') {
      return window.PORTAL_CONFIG.getSupabaseConfig();
    }
    const pc = (typeof window !== 'undefined' && window.PORTAL_CONFIG) || config || {};
    const url = (pc.SUPABASE_URL && !String(pc.SUPABASE_URL).includes('jpaaidqdyarboowjusom'))
      ? pc.SUPABASE_URL
      : 'https://mqvvaszlutjokflihcpm.supabase.co';
    const anonKey = (pc.SUPABASE_ANON_KEY && !String(pc.SUPABASE_ANON_KEY).includes('GjKXAsbZi1HP2kkBGMvMzg'))
      ? pc.SUPABASE_ANON_KEY
      : 'sb_secret_MOQDr1aIcF26IHU4mKmOZA_2Aaos7_z';
    const secretKey = pc.SUPABASE_SECRET_KEY || anonKey;
    return {
      SUPABASE_URL: String(url).trim(),
      SUPABASE_ANON_KEY: String(anonKey).trim(),
      SUPABASE_SECRET_KEY: String(secretKey).trim()
    };
  }

  function _getSbFingerprint() {
    const c = _getActiveSbConfig();
    return `${c.SUPABASE_URL}::${c.SUPABASE_ANON_KEY}::${c.SUPABASE_SECRET_KEY}`;
  }

  function _isQuotaOrNetworkError(err) {
    if (!err) return false;
    const msg = String(err.message || err.details || err.hint || err.code || err.status || err || '').toLowerCase();
    return (
      msg.includes('exceed_egress_quota') ||
      msg.includes('restricted') ||
      msg.includes('violations') ||
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network timeout') ||
      msg.includes('load failed') ||
      msg.includes('unregistered api key') ||
      msg.includes('invalid api key') ||
      msg.includes('forbidden') ||
      msg.includes('jwt') ||
      msg.includes('401') ||
      msg.includes('402') ||
      msg.includes('403') ||
      msg.includes('503') ||
      msg.includes('504')
    );
  }

  function _markQuotaRestricted(durationMs = 120000) {
    _quotaRestrictedUntil = Date.now() + durationMs;
    _quotaRestrictedFp = _getSbFingerprint();
  }

  function _clearQuotaRestricted() {
    _quotaRestrictedUntil = 0;
    _quotaRestrictedFp = '';
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('portal_sb_quota_restricted_until');
      if (typeof localStorage !== 'undefined') localStorage.removeItem('portal_sb_quota_restricted_until');
    } catch (e) { }
  }

  function _isQuotaRestricted() {
    if (_quotaRestrictedUntil > Date.now() && _quotaRestrictedFp === _getSbFingerprint()) {
      return true;
    }
    return false;
  }

  function _getDeletedIds(tableName) {
    try {
      const raw = localStorage.getItem('portal_db_deleted_' + tableName);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr.map(String));
      }
    } catch (e) { }
    return new Set();
  }

  function _markIdDeleted(tableName, id) {
    if (id === undefined || id === null) return;
    const sId = String(id).trim();
    if (!sId) return;
    const deleted = _getDeletedIds(tableName);
    deleted.add(sId);
    try {
      localStorage.setItem('portal_db_deleted_' + tableName, JSON.stringify(Array.from(deleted)));
    } catch (e) { }
  }

  function _unmarkIdDeleted(tableName, id) {
    if (id === undefined || id === null) return;
    const sId = String(id).trim();
    if (!sId) return;
    const deleted = _getDeletedIds(tableName);
    if (deleted.delete(sId)) {
      try {
        localStorage.setItem('portal_db_deleted_' + tableName, JSON.stringify(Array.from(deleted)));
      } catch (e) { }
    }
  }

  const DUMMY_USER_IDS = new Set([
    'G1', 'G2', 'G3', 'G4', 'G5', 'G6',
    'USR-GURU-01', 'USR-GURU-02', 'USR-GURU-03', 'USR-GURU-04', 'USR-GURU-05', 'USR-GURU-06'
  ]);

  const DUMMY_USERNAMES = new Set([
    'ahmad.fauzi', 'siti.rahma', 'budi.santoso', 'dewi.lestari'
  ]);

  function isDummyUserRecord(u) {
    if (!u || typeof u !== 'object') return true;
    const id = String(u['ID'] || u.id || '').trim();
    const uname = String(u['Username'] || u.username || '').trim().toLowerCase();
    const pass = String(u['Password'] || u.password || '').trim();
    const fullName = String(u['Nama Lengkap'] || u.namaLengkap || u.name || '').trim().toLowerCase();
    if (DUMMY_USER_IDS.has(id)) return true;
    if (DUMMY_USERNAMES.has(uname)) return true;
    if (fullName.includes('ahmad fauzi') || fullName.includes('kepala sekolah')) return true;
    // Tolak USR001 hanya jika masih memakai password contoh lama 'admin123'
    if ((id === 'USR001' || uname === 'admin' || uname === 'administrator') && pass === 'admin123') return true;
    return false;
  }

  // ============================================================================
  // SISTEM PENYIMPANAN MEDIA CLOUDINARY CDN (FOTO, FILE DOKUMEN, AUDIO & VIDEO)
  // Mengalihkan seluruh Foto, PDF/PPT/Word, Voicenote, dan Video ke Cloudinary
  // agar mengurangi kuota Bandwidth Egress Supabase dan Storage Supabase hingga 99%.
  // ============================================================================
  const CLOUD_CONFIG_KEY = 'portal_cloudinary_config';
  const LEGACY_CLOUD_CONFIG_KEY = 'portal_cloud_drive_config';
  const CLOUD_VAULT_KEY = 'portal_drive_media_vault';
  const CLOUDINARY_STATS_KEY = 'portal_cloudinary_stats';

  const DEFAULT_CLOUD_CONFIG = {
    cloudinaryCloudName: (config.CLOUDINARY && config.CLOUDINARY.CLOUD_NAME) || '',
    cloudinaryUploadPreset: (config.CLOUDINARY && config.CLOUDINARY.UPLOAD_PRESET) || '',
    cloudinaryApiKey: (config.CLOUDINARY && config.CLOUDINARY.API_KEY) || '',
    cloudinaryApiSecret: (config.CLOUDINARY && config.CLOUDINARY.API_SECRET) || '',
    cloudinaryFolder: (config.CLOUDINARY && config.CLOUDINARY.FOLDER) || 'portal-sekolah-smandum',
    autoOptimize: true,
    offloadEnabled: true
  };

  // Pure JS SHA-1 untuk Signed Upload Cloudinary (jalan di HTTP, HTTPS, maupun file://)
  function _pureSha1Hex(msg) {
    function rotateLeft(n, s) { return (n << s) | (n >>> (32 - s)); }
    function cvtHex(val) {
      let str = '';
      for (let i = 7; i >= 0; i--) str += ((val >>> (i * 4)) & 0x0f).toString(16);
      return str;
    }
    const utf8 = unescape(encodeURIComponent(msg));
    const msgLen = utf8.length;
    const wordArray = [];
    for (let i = 0; i < msgLen - 3; i += 4) {
      wordArray.push((utf8.charCodeAt(i) << 24) | (utf8.charCodeAt(i + 1) << 16) | (utf8.charCodeAt(i + 2) << 8) | utf8.charCodeAt(i + 3));
    }
    let idx = 0;
    switch (msgLen % 4) {
      case 0: idx = 0x080000000; break;
      case 1: idx = (utf8.charCodeAt(msgLen - 1) << 24) | 0x0800000; break;
      case 2: idx = (utf8.charCodeAt(msgLen - 2) << 24) | (utf8.charCodeAt(msgLen - 1) << 16) | 0x08000; break;
      case 3: idx = (utf8.charCodeAt(msgLen - 3) << 24) | (utf8.charCodeAt(msgLen - 2) << 16) | (utf8.charCodeAt(msgLen - 1) << 8) | 0x80; break;
    }
    wordArray.push(idx);
    while ((wordArray.length % 16) !== 14) wordArray.push(0);
    wordArray.push(msgLen >>> 29);
    wordArray.push((msgLen << 3) & 0x0ffffffff);

    let H0 = 0x67452301, H1 = 0xEFCDAB89, H2 = 0x98BADCFE, H3 = 0x10325476, H4 = 0xC3D2E1F0;
    const W = new Array(80);
    for (let blockstart = 0; blockstart < wordArray.length; blockstart += 16) {
      for (let i = 0; i < 16; i++) W[i] = wordArray[blockstart + i];
      for (let i = 16; i <= 79; i++) W[i] = rotateLeft(W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16], 1);
      let A = H0, B = H1, C = H2, D = H3, E = H4;
      for (let i = 0; i <= 19; i++) {
        const temp = (rotateLeft(A, 5) + ((B & C) | (~B & D)) + E + W[i] + 0x5A827999) & 0x0ffffffff;
        E = D; D = C; C = rotateLeft(B, 30); B = A; A = temp;
      }
      for (let i = 20; i <= 39; i++) {
        const temp = (rotateLeft(A, 5) + (B ^ C ^ D) + E + W[i] + 0x6ED9EBA1) & 0x0ffffffff;
        E = D; D = C; C = rotateLeft(B, 30); B = A; A = temp;
      }
      for (let i = 40; i <= 59; i++) {
        const temp = (rotateLeft(A, 5) + ((B & C) | (B & D) | (C & D)) + E + W[i] + 0x8F1BBCDC) & 0x0ffffffff;
        E = D; D = C; C = rotateLeft(B, 30); B = A; A = temp;
      }
      for (let i = 60; i <= 79; i++) {
        const temp = (rotateLeft(A, 5) + (B ^ C ^ D) + E + W[i] + 0xCA62C1D6) & 0x0ffffffff;
        E = D; D = C; C = rotateLeft(B, 30); B = A; A = temp;
      }
      H0 = (H0 + A) & 0x0ffffffff;
      H1 = (H1 + B) & 0x0ffffffff;
      H2 = (H2 + C) & 0x0ffffffff;
      H3 = (H3 + D) & 0x0ffffffff;
      H4 = (H4 + E) & 0x0ffffffff;
    }
    return (cvtHex(H0) + cvtHex(H1) + cvtHex(H2) + cvtHex(H3) + cvtHex(H4)).toLowerCase();
  }

  const PortalCloudStorage = {
    getConfig() {
      let merged = Object.assign({}, DEFAULT_CLOUD_CONFIG);
      try {
        if (window.PORTAL_CONFIG && window.PORTAL_CONFIG.CLOUDINARY) {
          const pc = window.PORTAL_CONFIG.CLOUDINARY;
          if (pc.CLOUD_NAME) merged.cloudinaryCloudName = pc.CLOUD_NAME;
          if (pc.UPLOAD_PRESET) merged.cloudinaryUploadPreset = pc.UPLOAD_PRESET;
          if (pc.API_KEY) merged.cloudinaryApiKey = pc.API_KEY;
          if (pc.API_SECRET) merged.cloudinaryApiSecret = pc.API_SECRET;
          if (pc.FOLDER) merged.cloudinaryFolder = pc.FOLDER;
        }
        const rawLegacy = localStorage.getItem(LEGACY_CLOUD_CONFIG_KEY);
        if (rawLegacy) {
          Object.assign(merged, JSON.parse(rawLegacy));
        }
        const raw = localStorage.getItem(CLOUD_CONFIG_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.CLOUD_NAME !== undefined && !parsed.cloudinaryCloudName) parsed.cloudinaryCloudName = parsed.CLOUD_NAME;
          if (parsed.UPLOAD_PRESET !== undefined && !parsed.cloudinaryUploadPreset) parsed.cloudinaryUploadPreset = parsed.UPLOAD_PRESET;
          if (parsed.API_KEY !== undefined && !parsed.cloudinaryApiKey) parsed.cloudinaryApiKey = parsed.API_KEY;
          if (parsed.API_SECRET !== undefined && !parsed.cloudinaryApiSecret) parsed.cloudinaryApiSecret = parsed.API_SECRET;
          if (parsed.FOLDER !== undefined && !parsed.cloudinaryFolder) parsed.cloudinaryFolder = parsed.FOLDER;
          Object.assign(merged, parsed);
        }
      } catch (e) { }
      return merged;
    },

    saveConfig(newCfg) {
      const curr = this.getConfig();
      const normalized = Object.assign({}, curr, newCfg || {});
      if (newCfg) {
        if (newCfg.CLOUD_NAME !== undefined) normalized.cloudinaryCloudName = String(newCfg.CLOUD_NAME).trim();
        if (newCfg.UPLOAD_PRESET !== undefined) normalized.cloudinaryUploadPreset = String(newCfg.UPLOAD_PRESET).trim();
        if (newCfg.API_KEY !== undefined) normalized.cloudinaryApiKey = String(newCfg.API_KEY).trim();
        if (newCfg.API_SECRET !== undefined) normalized.cloudinaryApiSecret = String(newCfg.API_SECRET).trim();
        if (newCfg.FOLDER !== undefined) normalized.cloudinaryFolder = String(newCfg.FOLDER).trim();
        if (newCfg.cloudinaryCloudName !== undefined) normalized.cloudinaryCloudName = String(newCfg.cloudinaryCloudName).trim();
        if (newCfg.cloudinaryUploadPreset !== undefined) normalized.cloudinaryUploadPreset = String(newCfg.cloudinaryUploadPreset).trim();
        if (newCfg.cloudinaryApiKey !== undefined) normalized.cloudinaryApiKey = String(newCfg.cloudinaryApiKey).trim();
        if (newCfg.cloudinaryApiSecret !== undefined) normalized.cloudinaryApiSecret = String(newCfg.cloudinaryApiSecret).trim();
        if (newCfg.cloudinaryFolder !== undefined) normalized.cloudinaryFolder = String(newCfg.cloudinaryFolder).trim();
      }
      try {
        localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(normalized));
        localStorage.setItem(LEGACY_CLOUD_CONFIG_KEY, JSON.stringify(normalized));
        if (window.PORTAL_CONFIG && typeof window.PORTAL_CONFIG.saveCloudinaryConfig === 'function') {
          window.PORTAL_CONFIG.saveCloudinaryConfig(normalized);
        }
      } catch (e) { }
      return normalized;
    },

    isCloudinaryConfigured(customCfg) {
      const cfg = customCfg || this.getConfig();
      const cloudName = String(cfg.cloudinaryCloudName || cfg.CLOUD_NAME || '').trim();
      const preset = String(cfg.cloudinaryUploadPreset || cfg.UPLOAD_PRESET || '').trim();
      const apiKey = String(cfg.cloudinaryApiKey || cfg.API_KEY || '').trim();
      const apiSecret = String(cfg.cloudinaryApiSecret || cfg.API_SECRET || '').trim();
      return Boolean(cloudName && (preset || (apiKey && apiSecret)));
    },

    optimizeCloudinaryUrl(url) {
      if (!url || typeof url !== 'string') return url;
      const trimmed = url.trim();
      if (!trimmed.includes('res.cloudinary.com/')) return trimmed;
      if (trimmed.includes('/image/upload/') && !trimmed.includes('/image/upload/f_auto')) {
        return trimmed.replace('/image/upload/', '/image/upload/f_auto,q_auto/');
      }
      if (trimmed.includes('/video/upload/') && !trimmed.includes('/video/upload/f_auto')) {
        return trimmed.replace('/video/upload/', '/video/upload/f_auto,q_auto/');
      }
      return trimmed;
    },

    // Konversi otomatis tautan Cloudinary / Google Drive / GitHub / lokal
    normalizeDriveUrl(url, mediaType = 'image') {
      if (!url || typeof url !== 'string') return url;
      const trimmed = url.trim();
      if (trimmed.startsWith('drive://')) {
        return this.resolveVaultUri(trimmed);
      }
      if (trimmed.includes('res.cloudinary.com/')) {
        return this.optimizeCloudinaryUrl(trimmed);
      }
      // Ekstrak File ID Google Drive apabila masih ada link lama
      let fileId = null;
      const m1 = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
      const m2 = trimmed.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
      const m3 = trimmed.match(/drive\.google\.com\/uc\?(?:export=[a-z]+&)?id=([a-zA-Z0-9_-]+)/);
      const m4 = trimmed.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
      if (m1) fileId = m1[1];
      else if (m2) fileId = m2[1];
      else if (m3) fileId = m3[1];
      else if (m4) fileId = m4[1];

      if (fileId) {
        if (mediaType === 'pdf' || mediaType === 'doc') {
          return `https://drive.google.com/file/d/${fileId}/preview`;
        }
        return `https://lh3.googleusercontent.com/d/${fileId}`;
      }
      if (trimmed.includes('github.com/') && trimmed.includes('/blob/')) {
        return trimmed
          .replace('https://github.com/', 'https://raw.githubusercontent.com/')
          .replace('/blob/', '/');
      }
      if (typeof window !== 'undefined' && window.location && window.location.pathname) {
        const inSubdir = window.location.pathname.includes('/portal-guru-siswa');
        if (trimmed.startsWith('cloud-media/') && inSubdir) {
          return '../' + trimmed;
        }
        if (trimmed.startsWith('../cloud-media/') && !inSubdir) {
          return trimmed.slice(3);
        }
      }
      return trimmed;
    },

    _recordCloudinaryStat(bytes = 0, url = '') {
      try {
        const raw = localStorage.getItem(CLOUDINARY_STATS_KEY);
        const st = raw ? JSON.parse(raw) : { count: 0, totalBytes: 0, urls: [] };
        if (url && !st.urls.includes(url)) {
          st.count = (st.count || 0) + 1;
          st.totalBytes = (st.totalBytes || 0) + (Number(bytes) || 25000);
          st.urls.push(url);
          if (st.urls.length > 500) st.urls = st.urls.slice(-500);
          localStorage.setItem(CLOUDINARY_STATS_KEY, JSON.stringify(st));
        }
      } catch (e) { }
    },

    fileToDataUri(fileOrBlob) {
      return new Promise((resolve, reject) => {
        if (typeof fileOrBlob === 'string') return resolve(fileOrBlob);
        if (!fileOrBlob || typeof FileReader === 'undefined') return resolve('');
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result || '');
        reader.onerror = err => reject(err);
        reader.readAsDataURL(fileOrBlob);
      });
    },

    // FUNGSI UTAMA: Upload Foto, File Dokumen (PDF/PPT/Word), Audio, dan Video ke Cloudinary
    async uploadToCloudinary(fileOrDataUri, options = {}) {
      const cfg = options.config || this.getConfig();
      const label = (options.label || 'media').replace(/[^a-zA-Z0-9_-]/g, '_');

      if (!fileOrDataUri) {
        return { success: false, url: '', message: 'File kosong' };
      }

      // Jika sudah berupa URL Cloudinary atau URL HTTP eksternal
      if (typeof fileOrDataUri === 'string') {
        const trimmed = fileOrDataUri.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          return {
            success: true,
            url: this.normalizeDriveUrl(trimmed),
            provider: trimmed.includes('cloudinary.com') ? 'cloudinary' : 'external'
          };
        }
        if (trimmed.startsWith('cloud-media/') || trimmed.startsWith('../cloud-media/')) {
          return { success: true, url: this.normalizeDriveUrl(trimmed), provider: 'local_asset' };
        }
      }

      const cloudName = String(cfg.cloudinaryCloudName || cfg.CLOUD_NAME || '').trim();
      const uploadPreset = String(cfg.cloudinaryUploadPreset || cfg.UPLOAD_PRESET || '').trim();
      const apiKey = String(cfg.cloudinaryApiKey || cfg.API_KEY || '').trim();
      const apiSecret = String(cfg.cloudinaryApiSecret || cfg.API_SECRET || '').trim();
      const baseFolder = String(cfg.cloudinaryFolder || cfg.FOLDER || 'portal-sekolah-smandum').trim();
      const targetFolder = options.folder ? `${baseFolder}/${options.folder}` : baseFolder;

      // Jika Cloudinary telah dikonfigurasi, unggah langsung ke Cloudinary CDN
      if (cloudName && (uploadPreset || (apiKey && apiSecret))) {
        const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/auto/upload`;

        // 1. Coba Unsigned Upload jika Upload Preset tersedia
        if (uploadPreset) {
          try {
            const fd = new FormData();
            fd.append('file', fileOrDataUri);
            fd.append('upload_preset', uploadPreset);
            if (targetFolder) fd.append('folder', targetFolder);

            const resp = await fetch(endpoint, { method: 'POST', body: fd });
            const resJson = await resp.json();
            if (resp.ok && resJson && resJson.secure_url) {
              const finalUrl = cfg.autoOptimize !== false ? this.optimizeCloudinaryUrl(resJson.secure_url) : resJson.secure_url;
              this._recordCloudinaryStat(resJson.bytes || 0, finalUrl);
              return {
                success: true,
                url: finalUrl,
                rawUrl: resJson.secure_url,
                publicId: resJson.public_id,
                resourceType: resJson.resource_type,
                format: resJson.format,
                bytes: resJson.bytes || 0,
                provider: 'cloudinary'
              };
            }
            // Jika preset gagal dan ada apiKey + apiSecret, lanjut ke Signed Upload di bawah
            if (!apiKey || !apiSecret) {
              const errMsg = (resJson && resJson.error && resJson.error.message) || 'Upload Preset Cloudinary ditolak';
              if (options.strict) return { success: false, url: '', message: errMsg };
            }
          } catch (uErr) {
            if (options.strict && (!apiKey || !apiSecret)) {
              return { success: false, url: '', message: uErr.message || 'Gagal menghubungi Cloudinary' };
            }
          }
        }

        // 2. Signed Upload menggunakan API Key + API Secret (SHA-1 Signature)
        if (apiKey && apiSecret) {
          try {
            const timestamp = Math.floor(Date.now() / 1000);
            const signStr = `folder=${targetFolder}&timestamp=${timestamp}${apiSecret}`;
            const signature = _pureSha1Hex(signStr);

            const fd = new FormData();
            fd.append('file', fileOrDataUri);
            fd.append('api_key', apiKey);
            fd.append('timestamp', String(timestamp));
            fd.append('folder', targetFolder);
            fd.append('signature', signature);

            const resp = await fetch(endpoint, { method: 'POST', body: fd });
            const resJson = await resp.json();
            if (resp.ok && resJson && resJson.secure_url) {
              const finalUrl = cfg.autoOptimize !== false ? this.optimizeCloudinaryUrl(resJson.secure_url) : resJson.secure_url;
              this._recordCloudinaryStat(resJson.bytes || 0, finalUrl);
              return {
                success: true,
                url: finalUrl,
                rawUrl: resJson.secure_url,
                publicId: resJson.public_id,
                resourceType: resJson.resource_type,
                format: resJson.format,
                bytes: resJson.bytes || 0,
                provider: 'cloudinary'
              };
            } else {
              const errMsg = (resJson && resJson.error && resJson.error.message) || 'Signed Upload Cloudinary gagal';
              if (options.strict) return { success: false, url: '', message: errMsg };
            }
          } catch (sErr) {
            if (options.strict) return { success: false, url: '', message: sErr.message || 'Gagal menghubungi Cloudinary' };
          }
        }
      } else if (options.strict) {
        return {
          success: false,
          url: '',
          message: 'Konfigurasi Cloudinary (Cloud Name & Upload Preset / API Key) belum diisi.'
        };
      }

      // Fallback ke Local Vault jika Cloudinary belum diisi atau sedang offline,
      // agar data Base64 tetap TIDAK membebani bandwidth egress Supabase.
      try {
        const dataUri = typeof fileOrDataUri === 'string' ? fileOrDataUri : await this.fileToDataUri(fileOrDataUri);
        const vaultUri = this.storeInVault(dataUri, label);
        return {
          success: true,
          url: dataUri,
          vaultUri: vaultUri,
          provider: 'local_vault',
          message: 'Tersimpan di Vault Lokal (Bebas Egress Supabase). Isi kredensial Cloudinary di Pengaturan untuk sinkron ke Cloudinary CDN.'
        };
      } catch (e) {
        return { success: false, url: '', message: e.message || 'Gagal memproses file media' };
      }
    },

    async uploadFileOrDataUri(fileOrDataUri, options = {}) {
      const res = await this.uploadToCloudinary(fileOrDataUri, options);
      return res.url || '';
    },

    async testCloudinaryConnection(customCfg) {
      const testPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      return await this.uploadToCloudinary(testPngBase64, {
        config: customCfg || this.getConfig(),
        folder: 'connection-test',
        label: 'test_ping',
        strict: true
      });
    },

    _getVaultMap() {
      try {
        const raw = localStorage.getItem(CLOUD_VAULT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') return parsed;
        }
      } catch (e) { }
      return {};
    },

    _saveVaultMap(map) {
      try {
        localStorage.setItem(CLOUD_VAULT_KEY, JSON.stringify(map));
      } catch (e) {
        try {
          const keys = Object.keys(map);
          if (keys.length > 8) {
            keys.slice(0, Math.floor(keys.length / 2)).forEach(k => delete map[k]);
            localStorage.setItem(CLOUD_VAULT_KEY, JSON.stringify(map));
          }
        } catch (e2) { }
      }
    },

    _hashShort(str) {
      let h1 = 0xdeadbeef ^ str.length;
      let h2 = 0x41c6ce57 ^ str.length;
      for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).toUpperCase();
    },

    storeInVault(dataUri, label = 'media') {
      if (!dataUri || typeof dataUri !== 'string') return '';
      if (!dataUri.startsWith('data:')) return this.normalizeDriveUrl(dataUri);
      const id = 'CLD_' + this._hashShort(dataUri);
      const map = this._getVaultMap();
      if (map[id] && map[id].remoteUrl && map[id].remoteUrl.startsWith('http')) {
        return map[id].remoteUrl;
      }
      const uri = `drive://cloudinary/${id}`;
      map[id] = {
        dataUri: dataUri,
        label: label,
        remoteUrl: (map[id] && map[id].remoteUrl) || '',
        updatedAt: new Date().toISOString()
      };
      this._saveVaultMap(map);
      if (this.isCloudinaryConfigured()) {
        this._tryBackgroundCloudinaryUpload(id, dataUri, label).catch(() => {});
      }
      return uri;
    },

    resolveVaultUri(uriOrUrl) {
      if (!uriOrUrl || typeof uriOrUrl !== 'string') return '';
      if (!uriOrUrl.startsWith('drive://')) {
        return this.normalizeDriveUrl(uriOrUrl);
      }
      const parts = uriOrUrl.replace('drive://', '').split('/');
      const id = parts[parts.length - 1];
      const map = this._getVaultMap();
      const entry = map[id];
      if (entry) {
        if (entry.remoteUrl) return entry.remoteUrl;
        if (entry.dataUri) return entry.dataUri;
      }
      return '';
    },

    async _tryBackgroundCloudinaryUpload(id, dataUri, label) {
      if (!dataUri || !dataUri.startsWith('data:') || !this.isCloudinaryConfigured()) return null;
      try {
        const res = await this.uploadToCloudinary(dataUri, { label, folder: 'auto-offload', strict: true });
        if (res && res.success && res.url && res.url.startsWith('http')) {
          const map = this._getVaultMap();
          if (map[id]) {
            map[id].remoteUrl = res.url;
            this._saveVaultMap(map);
          }
          return res.url;
        }
      } catch (e) { }
      return null;
    },

    // Bersihkan semua Base64 secara sinkron (fallback cepat)
    sanitizeForSupabase(value, label = 'media') {
      if (value === null || value === undefined) return value;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('data:') && trimmed.length > 350) {
          return this.storeInVault(trimmed, label);
        }
        if ((trimmed.startsWith('[') || trimmed.startsWith('{')) && trimmed.includes('data:')) {
          try {
            const parsed = JSON.parse(trimmed);
            const cleaned = this.sanitizeForSupabase(parsed, label);
            return JSON.stringify(cleaned);
          } catch (e) { }
        }
        if (trimmed.includes('drive.google.com/') || trimmed.includes('res.cloudinary.com/')) {
          return this.normalizeDriveUrl(trimmed);
        }
        return value;
      }
      if (Array.isArray(value)) {
        return value.map((item, idx) => this.sanitizeForSupabase(item, `${label}_${idx}`));
      }
      if (typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value)) {
          out[k] = this.sanitizeForSupabase(value[k], k.replace(/\s+/g, '_').toLowerCase());
        }
        return out;
      }
      return value;
    },

    // Bersihkan & unggah otomatis seluruh Base64 (Foto, File, Audio, Video) ke Cloudinary sebelum dikirim ke Supabase!
    async sanitizeForSupabaseAsync(value, label = 'media') {
      if (value === null || value === undefined) return value;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('data:') && trimmed.length > 350) {
          if (this.isCloudinaryConfigured()) {
            const up = await this.uploadToCloudinary(trimmed, { label, folder: label, strict: true });
            if (up && up.success && up.url && up.url.startsWith('http')) {
              return up.url;
            }
          }
          return this.storeInVault(trimmed, label);
        }
        if ((trimmed.startsWith('[') || trimmed.startsWith('{')) && trimmed.includes('data:')) {
          try {
            const parsed = JSON.parse(trimmed);
            const cleaned = await this.sanitizeForSupabaseAsync(parsed, label);
            return JSON.stringify(cleaned);
          } catch (e) { }
        }
        if (trimmed.includes('drive.google.com/') || trimmed.includes('res.cloudinary.com/')) {
          return this.normalizeDriveUrl(trimmed);
        }
        return value;
      }
      if (Array.isArray(value)) {
        const results = [];
        for (let i = 0; i < value.length; i++) {
          results.push(await this.sanitizeForSupabaseAsync(value[i], `${label}_${i}`));
        }
        return results;
      }
      if (typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value)) {
          out[k] = await this.sanitizeForSupabaseAsync(value[k], k.replace(/\s+/g, '_').toLowerCase());
        }
        return out;
      }
      return value;
    },

    // Pulihkan referensi drive://... atau optimasi URL Cloudinary saat ditampilkan di UI
    hydrateFromVault(value) {
      if (value === null || value === undefined) return value;
      if (typeof value === 'string') {
        if (value.startsWith('drive://')) {
          return this.resolveVaultUri(value);
        }
        if ((value.startsWith('[') || value.startsWith('{')) && value.includes('drive://')) {
          try {
            const parsed = JSON.parse(value);
            const hydrated = this.hydrateFromVault(parsed);
            return JSON.stringify(hydrated);
          } catch (e) { }
        }
        if (value.includes('drive.google.com/file/d/') || value.includes('res.cloudinary.com/')) {
          return this.normalizeDriveUrl(value);
        }
        return value;
      }
      if (Array.isArray(value)) {
        return value.map(item => this.hydrateFromVault(item));
      }
      if (typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value)) {
          out[k] = this.hydrateFromVault(value[k]);
        }
        return out;
      }
      return value;
    },

    getVaultStats() {
      const map = this._getVaultMap();
      const keys = Object.keys(map);
      let totalBytesSaved = 0;
      let cloudinaryCount = 0;
      keys.forEach(k => {
        const item = map[k];
        if (item && item.dataUri) totalBytesSaved += item.dataUri.length;
        if (item && item.remoteUrl && item.remoteUrl.includes('cloudinary.com')) cloudinaryCount++;
      });
      try {
        const rawSt = localStorage.getItem(CLOUDINARY_STATS_KEY);
        if (rawSt) {
          const st = JSON.parse(rawSt);
          cloudinaryCount = Math.max(cloudinaryCount, st.count || 0);
          totalBytesSaved += (st.totalBytes || 0);
        }
      } catch (e) { }
      return {
        fileCount: keys.length + cloudinaryCount,
        cloudinaryCount: cloudinaryCount,
        vaultCount: keys.length,
        bytesSaved: totalBytesSaved,
        kbSaved: Math.round(totalBytesSaved / 1024),
        mbSaved: (totalBytesSaved / (1024 * 1024)).toFixed(2),
        isCloudinaryReady: this.isCloudinaryConfigured(),
        config: this.getConfig()
      };
    }
  };

  window.PortalCloudStorage = PortalCloudStorage;
  window.uploadToCloudinary = PortalCloudStorage.uploadToCloudinary.bind(PortalCloudStorage);

  // Snapshot Data Asli SMAN 12 Muna Barat dari Database Supabase (100% Sinkron)
  const REAL_SCHOOL_SNAPSHOT = {
    "SettingsMap": {
        "school_name": "SMA Negeri 12 Muna Barat",
        "school_address": "Pulau Maginti_Desa Kangkunawe_Kecamatan Maginti",
        "school_npsn": "70011748",
        "school_phone": "(021) 000-0000",
        "school_email": "sman12munabarat2021@gmail.com",
        "school_accreditation": "A",
        "academic_year": "2026/2027",
        "semester": "Ganjil",
        "principal_name": "La Ode Mursaban Indi, S.Pd., M.Pd",
        "principal_nip": "196001011980031001",
        "spmb_active": "false",
        "spmb_disabled_notice": "Pendaftaran Penerimaan Murid Baru (SPMB) SMAN 12 Muna Barat saat ini belum dibuka atau sedang dalam masa persiapan tahun ajaran baru. Silakan pantau pengumuman resmi berkala dari pihak sekolah atau hubungi panitia melalui kontak berikut.",
        "footer_text": "2026 SMA Negeri 12 Muna Barat. Hak Cipta Dilindungi.",
        "school_logo_url": "cloud-media/settings/school-logo.jpg",
        "school_background_url": "cloud-media/settings/school-bg.jpg",
        "school_vision": "Menjadi sekolah terbaik yang menghasilkan generasi unggul berkarakter dan berdaya saing global.",
        "school_mission": "1. Melaksanakan pembelajaran berkualitas\\n2. Mengembangkan potensi siswa\\n3. Membangun karakter bangsa",
        "principal_photo": "cloud-media/settings/principal-photo.jpg",
        "admin_address": "Desa Lagadi, Kec. Lawa, Kab. Muna Barat",
        "admin_name": "DZULKIFLI, S.Pd",
        "admin_phone": "082292169010",
        "admin_email": "dzulkifli@gmail.com",
        "admin_nip": "",
        "admin_photo": "cloud-media/teachers/admin-avatar.jpg",
        "cloud_drive_account": "larealme99@gmail.com",
        "cloud_github_repo": "larealme99/Portal-sekolah"
    },
    "GuruExtraMetadata": {
        "USRMVL3KPCGXBVZ": {
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNW1D0B50GO": {
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        },
        "ABDUL MAMAN SAPUTRA": {
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNWLAO14X9O": {
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Guru BK"
        },
        "YUNFAKUN": {
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Guru BK"
        },
        "USRMVNVVHPWXA14": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "HASNIAR": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNWJ01WHJYI": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "WA ODE AFRIANI": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNV3EY0Z0Q3": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "ASBIA": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVLS1SJ33FOG": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "DESTI ASRIYAH": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNVSCESNYR7": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "EFRIA": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVM21Z6SHJZ6": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "HASRANI": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVL3A5K7HB02": {
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        },
        "LA ODE HARNADO": {
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        },
        "USRMVLZ3DDLIH3T": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "LIA ARIANTI": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNWB9YX4NR2": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "LILIS URMAYANI": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNVFO9PWZ0V": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "MARLIANTI": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNUMVEGZ2GE": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "MARTHA": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNWGZ579WL1": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "MEGAWATI": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNWPN4BGC91": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "NURZA": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNWEUE9L58E": {
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        },
        "SAMARUDIN": {
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNVP3CZIRSB": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "SITI MURNI": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNVYN602X02": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "SITI SARINA": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNVCZN3F8R4": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "SITTI HAJRAH": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNW49WI05H2": {
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        },
        "SYAWALUDIN TAGALI": {
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNW8O3OOQO5": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "WA ODE ISMAWATI": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNV7HLF8OWP": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "YANTI FIRDARATIH": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVNWNM4N3REE": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "NUR HIKMA": {
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        "USRMVOW3VFZ8LCZ": {
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Tenaga Kependidikan"
        },
        "DZULKIFLI": {
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Tenaga Kependidikan"
        }
    },
    "GalleryImages": [
        {
            "url": "cloud-media/gallery/gallery-1.jpg",
            "caption": "FOTO BERSAMA REKAN GURU DAN TU SMAN 12 MUNA BARAT SELEPAS UPACARA HARI KESAKTIAN PANCASILA"
        },
        {
            "url": "cloud-media/gallery/gallery-2.jpg",
            "caption": "KEGIATAN IN HOUSE TRANING IMPLEMENTASI PEMBELAJARAN MENDALAM TERINTEGRASI KODING"
        },
        {
            "url": "cloud-media/gallery/gallery-3.jpg",
            "caption": "Foto Pleaksanaan Upacara Bendera"
        },
        {
            "url": "cloud-media/gallery/gallery-4.jpg",
            "caption": "FOTO BERSAMA KEGIATAN PELATIHAN BERSAMA BAHARUDIN, S.Pd,. S.Kom., M.Pd"
        },
        {
            "url": "cloud-media/gallery/gallery-5.jpg",
            "caption": "Foto Bersama Kegiatan Kemah Bersama SMAN 12 Muna Barat"
        },
        {
            "url": "cloud-media/gallery/gallery-6.jpg",
            "caption": "Foto Bersama Perwakilan Tiap Sekolah Dalam Kegiatan Perkemahan"
        },
        {
            "url": "cloud-media/gallery/gallery-7.jpg",
            "caption": "Kegiatan Pentas Seni SMAN 12 Muna Barat"
        },
        {
            "url": "cloud-media/gallery/gallery-8.jpg",
            "caption": "Foto Siswa Ekstrakulikuler Pramuka"
        },
        {
            "url": "cloud-media/gallery/gallery-9.jpg",
            "caption": "Foto Bersama Kegiatan MPLS"
        },
        {
            "url": "cloud-media/gallery/gallery-10.jpg",
            "caption": "Foto Apel Siswa"
        }
    ],
    "Users": [
        {
            "ID": "USRMVNVVHPWXA14",
            "Username": "HASNIAR",
            "Password": "@Maginti2021",
            "Nama Lengkap": "HASNIAR, S.Pd",
            "Email": "hasniar211@guru.sma.id.belajar",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNVVHPWXA14.jpg",
            "Tanggal Daftar": "2026-10-25T13:48:41.972Z",
            "Tanggal Approve": "2026-10-25T13:48:41.972Z",
            "NIP": "199711222024212032",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVM21Z6SHJZ6",
            "Username": "HASRANI",
            "Password": "HASRANI",
            "Nama Lengkap": "HASRANI, S.Pd",
            "Email": "hasrani@gmail.com",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVM21Z6SHJZ6.jpg",
            "Tanggal Daftar": "2026-10-24T07:06:09.892Z",
            "Tanggal Approve": "2026-10-24T07:06:09.892Z",
            "NIP": "",
            "Telepon": "098765432112",
            "Alamat": "DESA KANGKUNAWE",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVL3KPCGXBVZ",
            "Username": "RAHMAN RAJAB",
            "Password": "rajab",
            "Nama Lengkap": "RAHMAN RAJAB, S.Pd",
            "Email": "rahmanrajab016@gmail.com",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVL3KPCGXBVZ.jpg",
            "Tanggal Daftar": "2026-10-23T15:00:57.040Z",
            "Tanggal Approve": "2026-10-23T15:00:57.040Z",
            "NIP": "",
            "Telepon": "082319278462",
            "Alamat": "",
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVLZ3DDLIH3T",
            "Username": "LIA ARIANTI",
            "Password": "LIA123",
            "Nama Lengkap": "LIA ARIANTI, S.Pd",
            "Email": "liaarianti@gmail.com",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVLZ3DDLIH3T.jpg",
            "Tanggal Daftar": "2026-10-24T05:43:16.089Z",
            "Tanggal Approve": "2026-10-24T05:43:16.089Z",
            "NIP": "200003182025212070",
            "Telepon": "089765432412",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNW8O3OOQO5",
            "Username": "WA ODE ISMAWATI",
            "Password": "@Maginti2021",
            "Nama Lengkap": "WA ODE ISMAWATI, S.Pd",
            "Email": "waismawati@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNW8O3OOQO5.jpg",
            "Tanggal Daftar": "2026-10-25T13:58:56.772Z",
            "Tanggal Approve": "2026-10-25T13:58:56.772Z",
            "NIP": "199712252025212129",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNUMVEGZ2GE",
            "Username": "MARTHA",
            "Password": "@Maginti2021",
            "Nama Lengkap": "MARTHA, S.Sos",
            "Email": "martha33@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNUMVEGZ2GE.jpg",
            "Tanggal Daftar": "2026-10-25T13:14:00.184Z",
            "Tanggal Approve": "2026-10-25T13:14:00.184Z",
            "NIP": "198003132023212011",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNWB9YX4NR2",
            "Username": "LILIS URMAYANI",
            "Password": "@Maginti2021",
            "Nama Lengkap": "LILIS URMAYANI, S.Pd",
            "Email": "lilisurmayani28@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNWB9YX4NR2.jpg",
            "Tanggal Daftar": "2026-10-25T14:00:58.425Z",
            "Tanggal Approve": "2026-10-25T14:00:58.425Z",
            "NIP": "199808222025212114",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNV7HLF8OWP",
            "Username": "YANTI FIRDARATIH",
            "Password": "@Maginti2021",
            "Nama Lengkap": "YANTI FIRDARATIH, S.Pd",
            "Email": "yantifirdaratih04@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNV7HLF8OWP.jpg",
            "Tanggal Daftar": "2026-10-25T13:30:02.067Z",
            "Tanggal Approve": "2026-10-25T13:30:02.067Z",
            "NIP": "199404102024212045",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVL3A5K7HB02",
            "Username": "LA ODE HARNADO",
            "Password": "HARNADO",
            "Nama Lengkap": "LA ODE HARNADO, S.Si",
            "Email": "harnadolaode@gmail.com",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVL3A5K7HB02.jpg",
            "Tanggal Daftar": "2026-10-23T14:52:44.839Z",
            "Tanggal Approve": "2026-10-23T14:52:44.839Z",
            "NIP": "",
            "Telepon": "081234567890",
            "Alamat": "Desa Maginti",
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVOW3VFZ8LCZ",
            "Username": "DZULKIFLI",
            "Password": "DZULKIFLI",
            "Nama Lengkap": "DZULKIFLI, S.Pd",
            "Email": "dzulkifli@gmail.com",
            "Role": "admin",
            "Status": "active",
            "Foto Profil URL": "",
            "Tanggal Daftar": "2026-10-26T06:42:59.183Z",
            "Tanggal Approve": "2026-10-26T06:42:59.183Z",
            "NIP": "",
            "Telepon": "082292169010",
            "Alamat": "",
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Tenaga Kependidikan"
        },
        {
            "ID": "USRMVNWGZ579WL1",
            "Username": "MEGAWATI",
            "Password": "@Maginti2021",
            "Nama Lengkap": "MEGAWATI, S.Pd",
            "Email": "megawati.6973@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNWGZ579WL1.jpg",
            "Tanggal Daftar": "2026-10-25T14:05:24.331Z",
            "Tanggal Approve": "2026-10-25T14:05:24.331Z",
            "NIP": "",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USR001",
            "Username": "admin",
            "Password": "@laodeharnado",
            "Nama Lengkap": "Admin",
            "Email": "admin@sekolah.ac.id",
            "Role": "admin",
            "Status": "active",
            "Foto Profil URL": "",
            "Tanggal Daftar": "2026-10-23 11:20:09.715836+00",
            "Tanggal Approve": "2026-10-23 11:20:09.715836+00",
            "NIP": "000000000000000001",
            "Telepon": "08000000001",
            "Alamat": "Sekolah",
            "Jenis Kelamin": "",
            "Jenis PTK": "Tenaga Kependidikan"
        },
        {
            "ID": "USRMVNW1D0B50GO",
            "Username": "ABDUL MAMAN SAPUTRA",
            "Password": "@Maginti2021",
            "Nama Lengkap": "ABDUL MAMAN SAPUTRA, S.Pd",
            "Email": "abdulsaputra61@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNW1D0B50GO.jpg",
            "Tanggal Daftar": "2026-10-25T13:53:15.803Z",
            "Tanggal Approve": "2026-10-25T13:53:15.803Z",
            "NIP": "199201262025211028",
            "Telepon": "",
            "Alamat": "DESA KANGKUNAWE",
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNWLAO14X9O",
            "Username": "YUNFAKUN",
            "Password": "@Maginti2021",
            "Nama Lengkap": "YUNFAKUN, S.Pd",
            "Email": "yunfakun.16@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "",
            "Tanggal Daftar": "2026-10-25T14:08:45.889Z",
            "Tanggal Approve": "2026-10-25T14:08:45.889Z",
            "NIP": "",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Guru BK"
        },
        {
            "ID": "USRMVNVFO9PWZ0V",
            "Username": "MARLIANTI",
            "Password": "@Maginti2021",
            "Nama Lengkap": "MARLIANTI, S.Pd",
            "Email": "marlianti27@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNVFO9PWZ0V.jpg",
            "Tanggal Daftar": "2026-10-25T13:36:23.965Z",
            "Tanggal Approve": "2026-10-25T13:36:23.965Z",
            "NIP": "199607222024212025",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNWPN4BGC91",
            "Username": "NURZA",
            "Password": "@Maginti2021",
            "Nama Lengkap": "NURZA, S.Pd",
            "Email": "nurza.72@admin.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNWPN4BGC91.jpg",
            "Tanggal Daftar": "2026-10-25T14:12:08.651Z",
            "Tanggal Approve": "2026-10-25T14:12:08.651Z",
            "NIP": "",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNWJ01WHJYI",
            "Username": "WA ODE AFRIANI",
            "Password": "@Maginti2021",
            "Nama Lengkap": "WA ODE AFRIANI, S.Pd",
            "Email": "wa.ode217868@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNWJ01WHJYI.jpg",
            "Tanggal Daftar": "2026-10-25T14:06:58.820Z",
            "Tanggal Approve": "2026-10-25T14:06:58.820Z",
            "NIP": "",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNV3EY0Z0Q3",
            "Username": "ASBIA",
            "Password": "@Maginti2021",
            "Nama Lengkap": "ASBIA, S.Pd",
            "Email": "asbia78@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNV3EY0Z0Q3.jpg",
            "Tanggal Daftar": "2026-10-25T13:26:52.008Z",
            "Tanggal Approve": "2026-10-25T13:26:52.008Z",
            "NIP": "198708272024212035",
            "Telepon": "",
            "Alamat": "DESA KANGKUNAWE",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVLS1SJ33FOG",
            "Username": "DESTI ASRIYAH",
            "Password": "DESTI123",
            "Nama Lengkap": "DESTI ASRIYAH, S.Mat",
            "Email": "destiasriyah@gmail.com",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVLS1SJ33FOG.jpg",
            "Tanggal Daftar": "2026-10-24T02:25:41.614Z",
            "Tanggal Approve": "2026-10-24T02:26:05.103Z",
            "NIP": "",
            "Telepon": "081256748333",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNVSCESNYR7",
            "Username": "EFRIA",
            "Password": "@Maginti2021",
            "Nama Lengkap": "EFRIA, S.Pd",
            "Email": "efria781@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNVSCESNYR7.jpg",
            "Tanggal Daftar": "2026-10-25T13:46:15.125Z",
            "Tanggal Approve": "2026-10-25T13:46:15.125Z",
            "NIP": "199708272024212030",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNWNM4N3REE",
            "Username": "NUR HIKMA",
            "Password": "@Maginti2021",
            "Nama Lengkap": "NUR HIKMA, S.Pd",
            "Email": "nur.hikma20698@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNWNM4N3REE.jpg",
            "Tanggal Daftar": "2026-10-25T14:10:34.055Z",
            "Tanggal Approve": "2026-10-25T14:10:34.055Z",
            "NIP": "",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNWEUE9L58E",
            "Username": "SAMARUDIN",
            "Password": "@Maginti2021",
            "Nama Lengkap": "SAMARUDIN, S.Pd",
            "Email": "samarudin.61@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNWEUE9L58E.jpg",
            "Tanggal Daftar": "2026-10-25T14:03:44.865Z",
            "Tanggal Approve": "2026-10-25T14:03:44.865Z",
            "NIP": "",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNVP3CZIRSB",
            "Username": "SITI MURNI",
            "Password": "@Maginti2021",
            "Nama Lengkap": "SITI MURNI, S.Pd",
            "Email": "sitimurni061@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNVP3CZIRSB.jpg",
            "Tanggal Daftar": "2026-10-25T13:43:43.427Z",
            "Tanggal Approve": "2026-10-25T13:43:43.427Z",
            "NIP": "199706202024212032",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNVYN602X02",
            "Username": "SITI SARINA",
            "Password": "@Maginti2021",
            "Nama Lengkap": "SITI SARINA, S.Pd",
            "Email": "siti2920@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNVYN602X02.jpg",
            "Tanggal Daftar": "2026-10-25T13:51:09.000Z",
            "Tanggal Approve": "2026-10-25T13:51:09.000Z",
            "NIP": "199809222024212016",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNVCZN3F8R4",
            "Username": "SITTI HAJRAH",
            "Password": "@Maginti2021",
            "Nama Lengkap": "SITTI HAJRAH, S.Pd",
            "Email": "sittihajrah081@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNVCZN3F8R4.jpg",
            "Tanggal Daftar": "2026-10-25T13:34:18.735Z",
            "Tanggal Approve": "2026-10-25T13:34:18.735Z",
            "NIP": "199508302024212032",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Perempuan",
            "Jenis PTK": "Pendidik"
        },
        {
            "ID": "USRMVNW49WI05H2",
            "Username": "SYAWALUDIN TAGALI",
            "Password": "@Maginti2021",
            "Nama Lengkap": "SYAWALUDIN TAGALI, S.Pd",
            "Email": "syawaludin.tagali@guru.sma.belajar.id",
            "Role": "guru",
            "Status": "active",
            "Foto Profil URL": "cloud-media/teachers/USRMVNW49WI05H2.jpg",
            "Tanggal Daftar": "2026-10-25T13:55:31.746Z",
            "Tanggal Approve": "2026-10-25T13:55:31.746Z",
            "NIP": "199702122025211109",
            "Telepon": "",
            "Alamat": "",
            "Jenis Kelamin": "Laki-laki",
            "Jenis PTK": "Pendidik"
        }
    ],
    "Classes": [
        {
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Tingkat": "",
            "Jurusan": "IPA",
            "ID Wali Kelas": "USRMVM21Z6SHJZ6",
            "Nama Wali Kelas": "HASRANI, S.Pd",
            "Tahun Ajaran": "2026/2027",
            "Kapasitas": 30,
            "Jumlah Siswa": 0,
            "Ruangan": "",
            "Keterangan": ""
        },
        {
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Tingkat": "",
            "Jurusan": "IPS",
            "ID Wali Kelas": "USRMVLS1SJ33FOG",
            "Nama Wali Kelas": "DESTI ASRIYAH, S.Mat",
            "Tahun Ajaran": "2026/2027",
            "Kapasitas": 30,
            "Jumlah Siswa": 0,
            "Ruangan": "",
            "Keterangan": ""
        },
        {
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Tingkat": "",
            "Jurusan": "IPA",
            "ID Wali Kelas": "USRMVNVVHPWXA14",
            "Nama Wali Kelas": "HASNIAR, S.Pd",
            "Tahun Ajaran": "2026/2027",
            "Kapasitas": 30,
            "Jumlah Siswa": 0,
            "Ruangan": "",
            "Keterangan": ""
        },
        {
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Tingkat": "",
            "Jurusan": "IPS",
            "ID Wali Kelas": "USRMVNW8O3OOQO5",
            "Nama Wali Kelas": "WA ODE ISMAWATI, S.Pd",
            "Tahun Ajaran": "2026/2027",
            "Kapasitas": 30,
            "Jumlah Siswa": 0,
            "Ruangan": "",
            "Keterangan": ""
        },
        {
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Tingkat": "",
            "Jurusan": "UMUM",
            "ID Wali Kelas": "USRMVNWJ01WHJYI",
            "Nama Wali Kelas": "WA ODE AFRIANI, S.Pd",
            "Tahun Ajaran": "2026/2027",
            "Kapasitas": 30,
            "Jumlah Siswa": 0,
            "Ruangan": "",
            "Keterangan": ""
        },
        {
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "Tingkat": "",
            "Jurusan": "UMUM",
            "ID Wali Kelas": "USRMVL3A5K7HB02",
            "Nama Wali Kelas": "LA ODE HARNADO, S.Si",
            "Tahun Ajaran": "2026/2027",
            "Kapasitas": 30,
            "Jumlah Siswa": 0,
            "Ruangan": "",
            "Keterangan": ""
        }
    ],
    "Subjects": [
        {
            "ID Mapel": "MPLMVL3VA5ZURLK",
            "Nama Mapel": "SEJARAH",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "12:00",
            "Jam Selesai": "13:30",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVORQR68IHB5",
            "Nama Mapel": "INFORMATIKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "08:45",
            "Jam Selesai": "10:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVORRY6AUFXL",
            "Nama Mapel": "INFORMATIKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "10:30",
            "Jam Selesai": "12:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVORU9CSU10E",
            "Nama Mapel": "KKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVORWHVUML45",
            "Nama Mapel": "KKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVOSNK7II5JJ",
            "Nama Mapel": "FISIKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0I2OAVIRG",
            "Nama Mapel": "MATEMATIKA UMUM",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVNVCZN3F8R4",
            "Nama Guru": "SITTI HAJRAH, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "07:15",
            "Jam Selesai": "08:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0JZX8SCBN",
            "Nama Mapel": "BAHASA INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNVYN602X02",
            "Nama Guru": "SITI SARINA, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "07:15",
            "Jam Selesai": "08:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0KTVA22M5",
            "Nama Mapel": "BAHASA INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVNVYN602X02",
            "Nama Guru": "SITI SARINA, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "10:30",
            "Jam Selesai": "12:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0LEZCCFNZ",
            "Nama Mapel": "MATEMATIKA UMUM",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNVCZN3F8R4",
            "Nama Guru": "SITTI HAJRAH, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "10:30",
            "Jam Selesai": "12:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0M9IWLYAP",
            "Nama Mapel": "MATEMATIKA PEMINATAN",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVLS1SJ33FOG",
            "Nama Guru": "DESTI ASRIYAH, S.Mat",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "08:45",
            "Jam Selesai": "10:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0N3A86J3M",
            "Nama Mapel": "SOSIOLOGI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVNUMVEGZ2GE",
            "Nama Guru": "MARTHA, S.Sos",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "08:45",
            "Jam Selesai": "10:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0O32I84WL",
            "Nama Mapel": "FISIKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNVFO9PWZ0V",
            "Nama Guru": "MARLIANTI, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "12:00",
            "Jam Selesai": "13:30",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0PFXO0X8T",
            "Nama Mapel": "SEJARAH",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVNVVHPWXA14",
            "Nama Guru": "HASNIAR, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0Q5A97MDP",
            "Nama Mapel": "EKONOMI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNWB9YX4NR2",
            "Nama Guru": "LILIS URMAYANI, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0R16PMGT1",
            "Nama Mapel": "BIOLOGI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVNWPN4BGC91",
            "Nama Guru": "NURZA, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "14:00",
            "Jam Selesai": "15:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0RRTQFPU2",
            "Nama Mapel": "PPKN",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNV3EY0Z0Q3",
            "Nama Guru": "ASBIA, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "14:00",
            "Jam Selesai": "15:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0SEH7CLB4",
            "Nama Mapel": "PPKN",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVNV3EY0Z0Q3",
            "Nama Guru": "ASBIA, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "16:15",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0T6XKMSSN",
            "Nama Mapel": "KIMIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVM21Z6SHJZ6",
            "Nama Guru": "HASRANI, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "15:15",
            "Jam Selesai": "16:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0U2JS0N3Z",
            "Nama Mapel": "BAHASA INGGRIS",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNW8O3OOQO5",
            "Nama Guru": "WA ODE ISMAWATI, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "15:15",
            "Jam Selesai": "16:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0UR9E6UVC",
            "Nama Mapel": "GEOGRAFI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNWEUE9L58E",
            "Nama Guru": "SAMARUDIN, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "16:15",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0VPFNUZ4V",
            "Nama Mapel": "KIMIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNVP3CZIRSB",
            "Nama Guru": "SITI MURNI, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "14:00",
            "Jam Selesai": "15:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0W8S5AHRH",
            "Nama Mapel": "KIMIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNVP3CZIRSB",
            "Nama Guru": "SITI MURNI, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "15:15",
            "Jam Selesai": "16:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0WVA9MUKH",
            "Nama Mapel": "BAHASA INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNW49WI05H2",
            "Nama Guru": "SYAWALUDIN TAGALI, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "14:00",
            "Jam Selesai": "15:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0XC25TKHM",
            "Nama Mapel": "BAHASA INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNW49WI05H2",
            "Nama Guru": "SYAWALUDIN TAGALI, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "16:15",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0Y7UJ224M",
            "Nama Mapel": "PAI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNV7HLF8OWP",
            "Nama Guru": "YANTI FIRDARATIH, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "15:15",
            "Jam Selesai": "16:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0YWAPJMX1",
            "Nama Mapel": "PJOK",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNW1D0B50GO",
            "Nama Guru": "ABDUL MAMAN SAPUTRA, S.Pd",
            "SKS": 1,
            "Hari": "Senin",
            "Jam Mulai": "16:15",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT0ZW11Q731",
            "Nama Mapel": "KIMIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNVP3CZIRSB",
            "Nama Guru": "SITI MURNI, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "07:15",
            "Jam Selesai": "08:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT10IUVGIII",
            "Nama Mapel": "PJOK",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNW1D0B50GO",
            "Nama Guru": "ABDUL MAMAN SAPUTRA, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "07:15",
            "Jam Selesai": "09:30",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT116M6MWUY",
            "Nama Mapel": "PPKN",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNV3EY0Z0Q3",
            "Nama Guru": "ASBIA, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "08:45",
            "Jam Selesai": "10:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT11T13WOA9",
            "Nama Mapel": "PAI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNV7HLF8OWP",
            "Nama Guru": "YANTI FIRDARATIH, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "09:30",
            "Jam Selesai": "12:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT12LIEAVUA",
            "Nama Mapel": "PRAKARYA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVM21Z6SHJZ6",
            "Nama Guru": "HASRANI, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "10:30",
            "Jam Selesai": "12:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT134NZRH26",
            "Nama Mapel": "PRAKARYA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVM21Z6SHJZ6",
            "Nama Guru": "HASRANI, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "12:00",
            "Jam Selesai": "13:30",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT13TEOTLNP",
            "Nama Mapel": "BIOLOGI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNWPN4BGC91",
            "Nama Guru": "NURZA, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "12:00",
            "Jam Selesai": "13:30",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT154JYQ9AQ",
            "Nama Mapel": "FISIKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT169HQE8TT",
            "Nama Mapel": "SEJARAH TL",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNVSCESNYR7",
            "Nama Guru": "EFRIA, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT16WMTV42P",
            "Nama Mapel": "SEJARAH TL",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVNVSCESNYR7",
            "Nama Guru": "EFRIA, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "14:00",
            "Jam Selesai": "15:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT17IF1RZTM",
            "Nama Mapel": "BAHASA INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVNVYN602X02",
            "Nama Guru": "SITI SARINA, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "15:15",
            "Jam Selesai": "16:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT180A12YJ7",
            "Nama Mapel": "BAHASA INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNVYN602X02",
            "Nama Guru": "SITI SARINA, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "16:15",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT18PSELQLY",
            "Nama Mapel": "MATEMATIKA UMUM",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVLS1SJ33FOG",
            "Nama Guru": "DESTI ASRIYAH, S.Mat",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "15:15",
            "Jam Selesai": "16:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT19CI3D2WM",
            "Nama Mapel": "MATEMATIKA UMUM",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVLS1SJ33FOG",
            "Nama Guru": "DESTI ASRIYAH, S.Mat",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "16:15",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT1A0BGYP16",
            "Nama Mapel": "EKONOMI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNWB9YX4NR2",
            "Nama Guru": "LILIS URMAYANI, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT1AKBQA00D",
            "Nama Mapel": "EKONOMI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNWB9YX4NR2",
            "Nama Guru": "LILIS URMAYANI, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "15:15",
            "Jam Selesai": "16:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT1B9NEGDOQ",
            "Nama Mapel": "MATEMATIKA UMUM",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNVCZN3F8R4",
            "Nama Guru": "SITTI HAJRAH, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT1BZEMABMA",
            "Nama Mapel": "MATEMATIKA UMUM",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNVCZN3F8R4",
            "Nama Guru": "SITTI HAJRAH, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "15:15",
            "Jam Selesai": "16:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT1CQ4Z73AY",
            "Nama Mapel": "MULOK",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "14:00",
            "Jam Selesai": "15:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT1DBSWJ415",
            "Nama Mapel": "MULOK",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "16:15",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT1EGA2B2WM",
            "Nama Mapel": "PRAKARYA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNWJ01WHJYI",
            "Nama Guru": "WA ODE AFRIANI, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "14:00",
            "Jam Selesai": "15:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT1F6J9BQNO",
            "Nama Mapel": "PRAKARYA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNWJ01WHJYI",
            "Nama Guru": "WA ODE AFRIANI, S.Pd",
            "SKS": 1,
            "Hari": "Selasa",
            "Jam Mulai": "16:15",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT3SKOIVW0A",
            "Nama Mapel": "FISIKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNVFO9PWZ0V",
            "Nama Guru": "MARLIANTI, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "07:15",
            "Jam Selesai": "08:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT3TA5MY13B",
            "Nama Mapel": "EKONOMI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVNWB9YX4NR2",
            "Nama Guru": "LILIS URMAYANI, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "07:15",
            "Jam Selesai": "08:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT3UAWYPYK9",
            "Nama Mapel": "BAHASA INGGRIS",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVLZ3DDLIH3T",
            "Nama Guru": "LIA ARIANTI, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "08:45",
            "Jam Selesai": "10:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT3V20VYUNJ",
            "Nama Mapel": "SOSIOLOGI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVNUMVEGZ2GE",
            "Nama Guru": "MARTHA, S.Sos",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "08:45",
            "Jam Selesai": "10:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT3VZ31LUMD",
            "Nama Mapel": "MATEMATIKA PEMINATAN",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVLS1SJ33FOG",
            "Nama Guru": "DESTI ASRIYAH, S.Mat",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "10:30",
            "Jam Selesai": "12:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT3WQRJ3LT8",
            "Nama Mapel": "GEOGRAFI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVNWEUE9L58E",
            "Nama Guru": "SAMARUDIN, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "10:30",
            "Jam Selesai": "12:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT3XR5NHBOR",
            "Nama Mapel": "BAHASA INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNVYN602X02",
            "Nama Guru": "SITI SARINA, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "12:00",
            "Jam Selesai": "13:30",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT3YXOWG3T2",
            "Nama Mapel": "SENI BUDAYA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVM21Z6SHJZ6",
            "Nama Guru": "HASRANI, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "12:00",
            "Jam Selesai": "13:30",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT407L3P5Z3",
            "Nama Mapel": "BAHASA INGGRIS",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVNW8O3OOQO5",
            "Nama Guru": "WA ODE ISMAWATI, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT41AZP2XWW",
            "Nama Mapel": "PAI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNWJ01WHJYI",
            "Nama Guru": "WA ODE AFRIANI, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT426T1LVPJ",
            "Nama Mapel": "BIOLOGI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVNWPN4BGC91",
            "Nama Guru": "NURZA, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT434ZF0KFV",
            "Nama Mapel": "KKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT44D79MU68",
            "Nama Mapel": "KKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT45KNJ4VFP",
            "Nama Mapel": "SOSIOLOGI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNUMVEGZ2GE",
            "Nama Guru": "MARTHA, S.Sos",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT479W7I0JV",
            "Nama Mapel": "SEJARAH",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNVSCESNYR7",
            "Nama Guru": "EFRIA, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT48KG0QIG7",
            "Nama Mapel": "SEJARAH",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNVSCESNYR7",
            "Nama Guru": "EFRIA, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT49SE3R112",
            "Nama Mapel": "GEOGRAFI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNWNM4N3REE",
            "Nama Guru": "NUR HIKMA, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4B6KXXADC",
            "Nama Mapel": "GEOGRAFI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNWNM4N3REE",
            "Nama Guru": "NUR HIKMA, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4C0OKIM84",
            "Nama Mapel": "PAI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNV7HLF8OWP",
            "Nama Guru": "YANTI FIRDARATIH, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4CTNU947L",
            "Nama Mapel": "BIOLOGI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNWGZ579WL1",
            "Nama Guru": "MEGAWATI, S.Pd",
            "SKS": 1,
            "Hari": "Rabu",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4FU6QKNT4",
            "Nama Mapel": "SEJARAH",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "07:15",
            "Jam Selesai": "08:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4EXXX7OE3",
            "Nama Mapel": "PJOK",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNW1D0B50GO",
            "Nama Guru": "ABDUL MAMAN SAPUTRA, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "07:15",
            "Jam Selesai": "09:30",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4GZYNCET3",
            "Nama Mapel": "BAHASA INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVNVYN602X02",
            "Nama Guru": "SITI SARINA, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "08:45",
            "Jam Selesai": "10:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4J6HFDQ68",
            "Nama Mapel": "BAHASA INGGRIS",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVLZ3DDLIH3T",
            "Nama Guru": "LIA ARIANTI, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "10:30",
            "Jam Selesai": "12:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4I9LK2LMB",
            "Nama Mapel": "KIMIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNVP3CZIRSB",
            "Nama Guru": "SITI MURNI, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "09:30",
            "Jam Selesai": "11:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4L3UO8UMC",
            "Nama Mapel": "PAI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNV7HLF8OWP",
            "Nama Guru": "YANTI FIRDARATIH, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "11:15",
            "Jam Selesai": "13:30",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4LZ74F3MR",
            "Nama Mapel": "PPKN",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVNV3EY0Z0Q3",
            "Nama Guru": "ASBIA, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "12:00",
            "Jam Selesai": "13:30",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4P4PV2UWS",
            "Nama Mapel": "MATEMATIKA UMUM",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVLS1SJ33FOG",
            "Nama Guru": "DESTI ASRIYAH, S.Mat",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4QEXB6S7K",
            "Nama Mapel": "MATEMATIKA UMUM",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVLS1SJ33FOG",
            "Nama Guru": "DESTI ASRIYAH, S.Mat",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4RIKXUY7G",
            "Nama Mapel": "SEJARAH",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNVVHPWXA14",
            "Nama Guru": "HASNIAR, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4SPJ19O4F",
            "Nama Mapel": "PAI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVNWJ01WHJYI",
            "Nama Guru": "WA ODE AFRIANI, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4TFG875XD",
            "Nama Mapel": "EKONOMI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNWB9YX4NR2",
            "Nama Guru": "LILIS URMAYANI, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT4YLXB4FMK",
            "Nama Mapel": "MATEMATIKA UMUM",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNVCZN3F8R4",
            "Nama Guru": "SITTI HAJRAH, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT500Y25D1L",
            "Nama Mapel": "MATEMATIKA UMUM",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNVCZN3F8R4",
            "Nama Guru": "SITTI HAJRAH, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT517E3OPXX",
            "Nama Mapel": "FISIKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNVFO9PWZ0V",
            "Nama Guru": "MARLIANTI, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT521LNXR5H",
            "Nama Mapel": "FISIKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNVFO9PWZ0V",
            "Nama Guru": "MARLIANTI, S.Pd",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT52U5P1Z0M",
            "Nama Mapel": "SOSIOLOGI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNUMVEGZ2GE",
            "Nama Guru": "MARTHA, S.Sos",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT53FUHDYD3",
            "Nama Mapel": "SOSIOLOGI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNUMVEGZ2GE",
            "Nama Guru": "MARTHA, S.Sos",
            "SKS": 1,
            "Hari": "Kamis",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT54JNQ74L0",
            "Nama Mapel": "BIOLOGI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNWGZ579WL1",
            "Nama Guru": "MEGAWATI, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "07:15",
            "Jam Selesai": "08:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT55BSKNYNY",
            "Nama Mapel": "MATEMATIKA UMUM",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVNVCZN3F8R4",
            "Nama Guru": "SITTI HAJRAH, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "07:15",
            "Jam Selesai": "08:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5A0ZF2F8P",
            "Nama Mapel": "MULOK",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNW8O3OOQO5",
            "Nama Guru": "WA ODE ISMAWATI, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "08:15",
            "Jam Selesai": "09:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5B9YQRWKQ",
            "Nama Mapel": "MATEMATIKA UMUM",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNVCZN3F8R4",
            "Nama Guru": "SITTI HAJRAH, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "09:45",
            "Jam Selesai": "11:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5CRNTCZOM",
            "Nama Mapel": "MULOK",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVNW8O3OOQO5",
            "Nama Guru": "WA ODE ISMAWATI, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "09:45",
            "Jam Selesai": "11:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5DIE1J3G1",
            "Nama Mapel": "EKONOMI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVNWB9YX4NR2",
            "Nama Guru": "LILIS URMAYANI, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "08:15",
            "Jam Selesai": "09:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5E80BA0FD",
            "Nama Mapel": "INFORMATIKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVNVP3CZIRSB",
            "Nama Guru": "SITI MURNI, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5EWF7JKW7",
            "Nama Mapel": "INFORMATIKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNVP3CZIRSB",
            "Nama Guru": "SITI MURNI, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5FJ9S3UP1",
            "Nama Mapel": "BAHASA INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNVYN602X02",
            "Nama Guru": "SITI SARINA, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5GB34FJLN",
            "Nama Mapel": "BAHASA INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVNVYN602X02",
            "Nama Guru": "SITI SARINA, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5HTI12FJR",
            "Nama Mapel": "PJOK",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNW1D0B50GO",
            "Nama Guru": "ABDUL MAMAN SAPUTRA, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5IUIFCJ6U",
            "Nama Mapel": "PJOK",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVNW1D0B50GO",
            "Nama Guru": "ABDUL MAMAN SAPUTRA, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5JLMQ1HZ5",
            "Nama Mapel": "PPKN",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNV3EY0Z0Q3",
            "Nama Guru": "ASBIA, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5K8C59OD3",
            "Nama Mapel": "PPKN",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNV3EY0Z0Q3",
            "Nama Guru": "ASBIA, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5L6PKOA51",
            "Nama Mapel": "BAHASA INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNW49WI05H2",
            "Nama Guru": "SYAWALUDIN TAGALI, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5LTVIMIW5",
            "Nama Mapel": "BAHASA INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNW49WI05H2",
            "Nama Guru": "SYAWALUDIN TAGALI, S.Pd",
            "SKS": 1,
            "Hari": "Jumat",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5MSJFCORE",
            "Nama Mapel": "SENI BUDAYA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNVVHPWXA14",
            "Nama Guru": "HASNIAR, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "07:15",
            "Jam Selesai": "08:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5NMV1754Q",
            "Nama Mapel": "GEOGRAFI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVNWEUE9L58E",
            "Nama Guru": "SAMARUDIN, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "07:15",
            "Jam Selesai": "08:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5OL1VUJZ0",
            "Nama Mapel": "SEJARAH INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVNVSCESNYR7",
            "Nama Guru": "EFRIA, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "08:45",
            "Jam Selesai": "10:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5P9SBMKFE",
            "Nama Mapel": "SEJARAH INDONESIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "ID Guru": "USRMVNVSCESNYR7",
            "Nama Guru": "EFRIA, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "10:30",
            "Jam Selesai": "12:00",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5PXO4RNXZ",
            "Nama Mapel": "KIMIA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVM21Z6SHJZ6",
            "Nama Guru": "HASRANI, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5QN3RTIBG",
            "Nama Mapel": "PRAKARYA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNWNM4N3REE",
            "Nama Guru": "NUR HIKMA, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5RI1YWIZ6",
            "Nama Mapel": "PRAKARYA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVNWNM4N3REE",
            "Nama Guru": "NUR HIKMA, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5S9WP950L",
            "Nama Mapel": "MULOK",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5T341XOET",
            "Nama Mapel": "MULOK",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5TRJTQBBH",
            "Nama Mapel": "GEOGRAFI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "ID Guru": "USRMVNWEUE9L58E",
            "Nama Guru": "SAMARUDIN, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5UGWTW8JO",
            "Nama Mapel": "INFORMATIKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNWPN4BGC91",
            "Nama Guru": "NURZA, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5V3AID91F",
            "Nama Mapel": "INFORMATIKA",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNWPN4BGC91",
            "Nama Guru": "NURZA, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5VTQRVFN2",
            "Nama Mapel": "BIOLOGI",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVNWGZ579WL1",
            "Nama Guru": "MEGAWATI, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "13:00",
            "Jam Selesai": "14:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5WBZ647YC",
            "Nama Mapel": "BAHASA INGGRIS",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVLZ3DDLIH3T",
            "Nama Guru": "LIA ARIANTI, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "14:15",
            "Jam Selesai": "15:45",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5WT9SQPEP",
            "Nama Mapel": "BAHASA INGGRIS",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPY3W7FAB",
            "Nama Kelas": "X.2",
            "ID Guru": "USRMVLZ3DDLIH3T",
            "Nama Guru": "LIA ARIANTI, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        },
        {
            "ID Mapel": "MPLMVT5XMPDPX6E",
            "Nama Mapel": "PJOK",
            "Kode Mapel": "",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNW1D0B50GO",
            "Nama Guru": "ABDUL MAMAN SAPUTRA, S.Pd",
            "SKS": 1,
            "Hari": "Sabtu",
            "Jam Mulai": "16:00",
            "Jam Selesai": "17:15",
            "Ruangan": "",
            "Semester": "Ganjil"
        }
    ],
    "Students": [
        {
            "ID Siswa": "SISMVOS8EYBHF61",
            "NIS": "X11IPS1",
            "NISN": "",
            "Nama Siswa": "ABDUL RAHMAT",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "DESA MAGINTI",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKRSG548BN",
            "NIS": "XI02",
            "NISN": "0107656242",
            "Nama Siswa": "AYUNI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKT8UFAOLE",
            "NIS": "XI03",
            "NISN": "0109897874",
            "Nama Siswa": "DONITA SABILA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZ8JALPNX2",
            "NIS": "260",
            "NISN": "0087596061",
            "Nama Siswa": "DIMAS PRATAMA",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZ9RPEDQJE",
            "NIS": "263",
            "NISN": "0092967048",
            "Nama Siswa": "ECI ESTIANTI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZAVDLFRAD",
            "NIS": "211",
            "NISN": "0098209132",
            "Nama Siswa": "EDO SUNANTO",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZC8I0I6K0",
            "NIS": "215",
            "NISN": "0097398041",
            "Nama Siswa": "FATIA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZDFOQMQY7",
            "NIS": "217",
            "NISN": "0091261112",
            "Nama Siswa": "HANDAYANI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZF72ZKWV2",
            "NIS": "220",
            "NISN": "0085140729",
            "Nama Siswa": "ILSAN",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZGXVS0DOE",
            "NIS": "223",
            "NISN": "0098199499",
            "Nama Siswa": "KARMIDA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZHSF8W0F1",
            "NIS": "227",
            "NISN": "0093989933",
            "Nama Siswa": "LA ODE AMALUDIN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZIGC9MJLN",
            "NIS": "231",
            "NISN": "0098455694",
            "Nama Siswa": "MAIRA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZJV1J2YKA",
            "NIS": "234",
            "NISN": "0094993927",
            "Nama Siswa": "MUHAMMAD HASBITULLAH",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZKL47LLM9",
            "NIS": "233",
            "NISN": "0099763895",
            "Nama Siswa": "MUHAMMAD AFAN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZL8BKMELO",
            "NIS": "232",
            "NISN": "0093110881",
            "Nama Siswa": "MUHAMMAD FADIL",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZM0T4EF41",
            "NIS": "236",
            "NISN": "0093071838",
            "Nama Siswa": "MUTMAINAH",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZMRBEGJQY",
            "NIS": "239",
            "NISN": "0099255017",
            "Nama Siswa": "NUR HIDAYAH",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZNH1VLRAQ",
            "NIS": "238",
            "NISN": "0091030684",
            "Nama Siswa": "NURFAIKA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZP2OVEAYN",
            "NIS": "X1116",
            "NISN": "",
            "Nama Siswa": "NURLIA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZQ0G1B0V6",
            "NIS": "248",
            "NISN": "3090301194",
            "Nama Siswa": "TINI ARI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZQX9C44PM",
            "NIS": "249",
            "NISN": "0081800556",
            "Nama Siswa": "VIONA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZRQP5M8YB",
            "NIS": "256",
            "NISN": "0097409392",
            "Nama Siswa": "YUDHA SAPUTRA",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZSKDV577R",
            "NIS": "258",
            "NISN": "0081916053",
            "Nama Siswa": "ZULKIFLI",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZSX7ZRLGM",
            "Nama Kelas": "XII IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVOS9N6B4HER",
            "NIS": "X11IPS2",
            "NISN": "0095538548",
            "Nama Siswa": "AMEL",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "DESA KANGKUNAWE",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVOSAHM526YV",
            "NIS": "X11IPS3",
            "NISN": "0096832784",
            "Nama Siswa": "ARI SETIAWAN",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "DESA MAGINTI",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVOSB74LMD6T",
            "NIS": "X11IPS4",
            "NISN": "0087013967",
            "Nama Siswa": "ARIL",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "DESA PASI PADANGAN",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVOSC0A8RC1L",
            "NIS": "212",
            "NISN": "0079209160",
            "Nama Siswa": "EKA SAFITRI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "DESA KANGKUNAWE",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVL3THAF5BU6",
            "NIS": "242",
            "NISN": "3095410166",
            "Nama Siswa": "RASYA",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "DESA MAGINTI",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZWRUQR2JA",
            "NIS": "214",
            "NISN": "009299828",
            "Nama Siswa": "FADIL",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZYCGKFS27",
            "NIS": "X11IPS22",
            "NISN": "",
            "Nama Siswa": "ASTRI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVSZZ9BMF4EU",
            "NIS": "224",
            "NISN": "0081135188",
            "Nama Siswa": "KASIH FITRIANI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVT00LAG6XKJ",
            "NIS": "226",
            "NISN": "0089280133",
            "Nama Siswa": "LA ODE ALIF",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVT01C1HD3Z8",
            "NIS": "241",
            "NISN": "0097846161",
            "Nama Siswa": "RAHMAWATI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVT0232GGKZB",
            "NIS": "272",
            "NISN": "0087213058",
            "Nama Siswa": "RISKA AMELIA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVT03OFJUC9B",
            "NIS": "245",
            "NISN": "0094898266",
            "Nama Siswa": "SIFAYANI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVT04P5JBKAW",
            "NIS": "246",
            "NISN": "0081359122",
            "Nama Siswa": "TAHMIT",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVT05HPAFWGQ",
            "NIS": "247",
            "NISN": "0098455931",
            "Nama Siswa": "TERZI EFANGKA FATZIRA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVT09AW9FFN8",
            "NIS": "0248",
            "NISN": "3090301194",
            "Nama Siswa": "WA ODE AMIRA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVT0A02BMJF3",
            "NIS": "250",
            "NISN": "0097166576",
            "Nama Siswa": "WA ODE ARIANA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVT0B8VJV3NC",
            "NIS": "251",
            "NISN": "0088246732",
            "Nama Siswa": "WA ODE DWI ARTIKASARI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVT0C3IIBY8I",
            "NIS": "252",
            "NISN": "0096152265",
            "Nama Siswa": "WA ODE RISATIA APRILIA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVT0D29PP4BQ",
            "NIS": "254",
            "NISN": "0097176736",
            "Nama Siswa": "WA ODE SITI MARWANA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKDG4BHCJK",
            "NIS": "XI1",
            "NISN": "0099840909",
            "Nama Siswa": "ADIFAN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKE5XI8FQM",
            "NIS": "XI2",
            "NISN": "0101256111",
            "Nama Siswa": "AMELIA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKES4SWNEK",
            "NIS": "XI3",
            "NISN": "0105645378",
            "Nama Siswa": "ARLINDA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKFE1WI7TZ",
            "NIS": "XI4",
            "NISN": "010271314",
            "Nama Siswa": "AZRIL",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKG177E15K",
            "NIS": "XI5",
            "NISN": "0103725481",
            "Nama Siswa": "DELSA YANTI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKGPKYBK0C",
            "NIS": "XI6",
            "NISN": "3108543813",
            "Nama Siswa": "DESTIAN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKHFJ21YH4",
            "NIS": "XI7",
            "NISN": "0107463567",
            "Nama Siswa": "ENI NURIATI DAMLIA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKHZSHCZ06",
            "NIS": "XI8",
            "NISN": "0104810630",
            "Nama Siswa": "ERWIN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKIOHTTZAN",
            "NIS": "XI9",
            "NISN": "0106745354",
            "Nama Siswa": "FEBI AULIA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKJCWJ4Q4R",
            "NIS": "XI10",
            "NISN": "0101737081",
            "Nama Siswa": "MUH. ABDUL MANSYUR",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKLB30M0M7",
            "NIS": "XI12",
            "NISN": "0106345953",
            "Nama Siswa": "RISKY ADITYA",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKK96MURKI",
            "NIS": "XI11",
            "NISN": "00097118521",
            "Nama Siswa": "NUR AYN",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKMF2QFN4S",
            "NIS": "XI13",
            "NISN": "0101513521",
            "Nama Siswa": "WA ODE ASRIA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKQT9F32F4",
            "NIS": "XI01",
            "NISN": "0107511414",
            "Nama Siswa": "AMIRA EFMI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKU5QIPR36",
            "NIS": "XI04",
            "NISN": "0092613901",
            "Nama Siswa": "FAHIT",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKUZ3G91N8",
            "NIS": "XI05",
            "NISN": "0099909599",
            "Nama Siswa": "HIKMAWATI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKVJ90YSB6",
            "NIS": "XI06",
            "NISN": "",
            "Nama Siswa": "INDRI SAFITRI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKVXTYHMT5",
            "NIS": "XI07",
            "NISN": "",
            "Nama Siswa": "ISMA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKWM8QIR8U",
            "NIS": "XI08",
            "NISN": "0109379253",
            "Nama Siswa": "JAMILA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKXCE4RKWV",
            "NIS": "XI09",
            "NISN": "0104790496",
            "Nama Siswa": "KHAIRUL AZAM",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKY4G3U19X",
            "NIS": "XI010",
            "NISN": "0108422319",
            "Nama Siswa": "LA ODE SAFRIN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKYU4E5OK4",
            "NIS": "XI011",
            "NISN": "0098746070",
            "Nama Siswa": "LUNA MAYA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKZOUIULA6",
            "NIS": "XI012",
            "NISN": "0101752420",
            "Nama Siswa": "NADILLAH PUTRI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUL0P6AMTTN",
            "NIS": "XI013",
            "NISN": "0101111158",
            "Nama Siswa": "NUR MAIRAH",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUL18Z5EYOV",
            "NIS": "XI014",
            "NISN": "0082213408",
            "Nama Siswa": "RENO",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUL22VJ8SHB",
            "NIS": "XI015",
            "NISN": "0092015195",
            "Nama Siswa": "RESTI AYUNITA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUL2TAB0N1R",
            "NIS": "XI016",
            "NISN": "0101252226",
            "Nama Siswa": "SAHALUDIN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUL3F6BN0I6",
            "NIS": "XI017",
            "NISN": "0104678209",
            "Nama Siswa": "SALFIN ANANDIN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUL41FJ016B",
            "NIS": "XI018",
            "NISN": "0104945520",
            "Nama Siswa": "SAYDIN HAYRIL",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUL4QYBRLSH",
            "NIS": "XI019",
            "NISN": "",
            "Nama Siswa": "WA ODE ELDAWATI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUL5S0664B5",
            "NIS": "XI020",
            "NISN": "0106041379",
            "Nama Siswa": "WA ODE SINARWATI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUL6HHZXCZK",
            "NIS": "XI021",
            "NISN": "0083285922",
            "Nama Siswa": "WA ODE YUNI ELSA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUL76IASLP4",
            "NIS": "XI022",
            "NISN": "0094290436",
            "Nama Siswa": "WA ODE ZIRNA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUL7T5SUZU4",
            "NIS": "XI023",
            "NISN": "0095883516",
            "Nama Siswa": "WELNI SEPTIANI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUL8LGSD48D",
            "NIS": "XI024",
            "NISN": "0103873052",
            "Nama Siswa": "YUTRI ALKIA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUL98L0DAPH",
            "NIS": "XI025",
            "NISN": "0087138902",
            "Nama Siswa": "ZULFIN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVULA2J8U1OL",
            "NIS": "XI026",
            "NISN": "",
            "Nama Siswa": "ALIF",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZRZSWNJU6",
            "Nama Kelas": "XI IPS",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVULB26NX243",
            "NIS": "X11",
            "NISN": "119357532",
            "Nama Siswa": "ANDIRAN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVULBY8ABUV7",
            "NIS": "X12",
            "NISN": "107152239",
            "Nama Siswa": "AL AQSAN TAMUNG",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVULCLY1OD8Y",
            "NIS": "X13",
            "NISN": "3120804177",
            "Nama Siswa": "ALTIN SAPUTRA",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVUKN6OGS79E",
            "NIS": "XI14",
            "NISN": "0094438904",
            "Nama Siswa": "WARIFATUL AHADDININGRAT",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZR51XCMOJ",
            "Nama Kelas": "XI IPA",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYOWOLZR4CR",
            "NIS": "X14",
            "NISN": "115959913",
            "Nama Siswa": "AYUDIN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYOYKLWCVY9",
            "NIS": "X15",
            "NISN": "117772180",
            "Nama Siswa": "AZNIA RAMADANI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYOZT5EDRGT",
            "NIS": "X16",
            "NISN": "105001451",
            "Nama Siswa": "DELFAN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYP1AYH62MP",
            "NIS": "X17",
            "NISN": "104207111",
            "Nama Siswa": "DELFIN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYP5NYDI9I4",
            "NIS": "X18",
            "NISN": "109982491",
            "Nama Siswa": "DILSAN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYP79ZEBY0A",
            "NIS": "X19",
            "NISN": "117772180",
            "Nama Siswa": "FELIYAWATI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYP8DNII5KL",
            "NIS": "X110",
            "NISN": "109165982",
            "Nama Siswa": "FISKA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYP9PKJW3IQ",
            "NIS": "X111",
            "NISN": "016281842",
            "Nama Siswa": "FITRIANI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPBJ9QG675",
            "NIS": "X112",
            "NISN": "106476886",
            "Nama Siswa": "MALNIA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPCPV4O8CB",
            "NIS": "X113",
            "NISN": "3116155846",
            "Nama Siswa": "MITA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPE35X6DXH",
            "NIS": "X114",
            "NISN": "115502212",
            "Nama Siswa": "MUHAMMAD AFWAN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPFENTIAA1",
            "NIS": "X115",
            "NISN": "119432819",
            "Nama Siswa": "RIDO",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPIYAOVVQS",
            "NIS": "X117",
            "NISN": "118737618",
            "Nama Siswa": "SAYBATUL HAMDI",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPLNX6KTE2",
            "NIS": "X118",
            "NISN": "113600981",
            "Nama Siswa": "SEFRIANI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPOHIEUM0G",
            "NIS": "X119",
            "NISN": "101055024",
            "Nama Siswa": "SELFI",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPQ7WLWQVW",
            "NIS": "X120",
            "NISN": "106176706",
            "Nama Siswa": "TASMIN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPRDOPBS1Y",
            "NIS": "X121",
            "NISN": "0108332205",
            "Nama Siswa": "ULFA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPSRMGF9VF",
            "NIS": "X122",
            "NISN": "0102276331",
            "Nama Siswa": "WA ODE HELMIA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPUH5SD0IG",
            "NIS": "X123",
            "NISN": "116962757",
            "Nama Siswa": "WINDRY FEBRIANTY",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPVZGUUAG2",
            "NIS": "X124",
            "NISN": "98574811",
            "Nama Siswa": "YAYU AUZIAH",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPX8TKGU05",
            "NIS": "X125",
            "NISN": "116327074",
            "Nama Siswa": "ZAITUL IKSAN",
            "Jenis Kelamin": "L",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        },
        {
            "ID Siswa": "SISMVYPGK3INNEW",
            "NIS": "X116",
            "NISN": "3116155846",
            "Nama Siswa": "SABRINA",
            "Jenis Kelamin": "P",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "Telepon": "",
            "Alamat": "",
            "Status": "Aktif"
        }
    ],
    "Exams": [
        {
            "ID Ujian": "EXMMVTP9M3JES28",
            "Judul Ujian": "ULANGAN INFORMATIKA 123",
            "ID Mapel": "MPLMVORRY6AUFXL",
            "Nama Mapel": "INFORMATIKA",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "Tanggal Mulai": "2026-10-29T15:30:20.575Z",
            "Tanggal Selesai": "2026-10-29T15:30:20.575Z",
            "Durasi (menit)": 30,
            "Status": "active",
            "Jumlah Soal": 5,
            "Total Nilai": 100,
            "Anti Curang": "true",
            "Tanggal Dibuat": "2026-10-29T15:30:20.575Z",
            "Keterangan": "",
            "Batas Pelanggaran": 3,
            "Token": "TZJD69"
        },
        {
            "ID Ujian": "EXMMVZ0IJAWOG71",
            "Judul Ujian": "UTS",
            "ID Mapel": "MPLMVT0VPFNUZ4V",
            "Nama Mapel": "KIMIA",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "ID Guru": "USRMVNVP3CZIRSB",
            "Nama Guru": "SITI MURNI, S.Pd",
            "Tanggal Mulai": "2026-11-02T08:44:03.512Z",
            "Tanggal Selesai": "2026-11-02T08:44:03.512Z",
            "Durasi (menit)": 45,
            "Status": "active",
            "Jumlah Soal": 5,
            "Total Nilai": 100,
            "Anti Curang": "true",
            "Tanggal Dibuat": "2026-11-02T08:44:03.512Z",
            "Keterangan": "",
            "Batas Pelanggaran": 3,
            "Token": "WN2HWS"
        }
    ],
    "Questions": [
        {
            "ID Soal": "QSTMVR052VJ2YS5",
            "ID Ujian": "EXMMVQZEH5CR6H3",
            "Nomor Soal": 1,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Apa fungsi utama klorofil pada daun tumbuhan hijau?",
            "Opsi A": "Menyerap cahaya matahari untuk fotosintesis",
            "Opsi B": "Menyerap air dari tanah",
            "Opsi C": "Menghasilkan karbondioksida",
            "Opsi D": "Melindungi dari serangga",
            "Opsi E": "",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": ""
        },
        {
            "ID Soal": "QSTMVR052VJ6DC6",
            "ID Ujian": "EXMMVQZEH5CR6H3",
            "Nomor Soal": 2,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Ibu kota negara Indonesia Nusantara (IKN) terletak di provinsi...",
            "Opsi A": "Kalimantan Timur",
            "Opsi B": "Kalimantan Barat",
            "Opsi C": "Kalimantan Tengah",
            "Opsi D": "Sulawesi Selatan",
            "Opsi E": "",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": ""
        },
        {
            "ID Soal": "QSTMVR052VJ9Z22",
            "ID Ujian": "EXMMVQZEH5CR6H3",
            "Nomor Soal": 3,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Hasil perhitungan matematika: 15 × 8 + 40 ÷ 5 adalah...",
            "Opsi A": "128",
            "Opsi B": "124",
            "Opsi C": "130",
            "Opsi D": "120",
            "Opsi E": "",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": ""
        },
        {
            "ID Soal": "QSTMVR052VJATUW",
            "ID Ujian": "EXMMVQZEH5CR6H3",
            "Nomor Soal": 4,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Sila ke-3 dalam Pancasila berbunyi...",
            "Opsi A": "Persatuan Indonesia",
            "Opsi B": "Kemanusiaan yang adil dan beradab",
            "Opsi C": "Ketuhanan Yang Maha Esa",
            "Opsi D": "Keadilan sosial bagi seluruh rakyat Indonesia",
            "Opsi E": "",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": ""
        },
        {
            "ID Soal": "QSTMVR052VJK5ES",
            "ID Ujian": "EXMMVQZEH5CR6H3",
            "Nomor Soal": 5,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Planet dalam tata surya yang dikenal dengan julukan Planet Merah adalah...",
            "Opsi A": "Mars",
            "Opsi B": "Venus",
            "Opsi C": "Jupiter",
            "Opsi D": "Merkurius",
            "Opsi E": "",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": ""
        },
        {
            "ID Soal": "QSTMVTP9N3E67V4",
            "ID Ujian": "EXMMVTP9M3JES28",
            "Nomor Soal": 1,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Apa fungsi utama klorofil pada daun tumbuhan hijau?",
            "Opsi A": "Menyerap cahaya matahari untuk fotosintesis",
            "Opsi B": "Menyerap air dari tanah",
            "Opsi C": "Menghasilkan karbondioksida",
            "Opsi D": "Melindungi dari serangga",
            "Opsi E": "Menggugurkan daun",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": "Klorofil berperan menyerap foton cahaya untuk fotosintesis."
        },
        {
            "ID Soal": "QSTMVTP9N3E2YBF",
            "ID Ujian": "EXMMVTP9M3JES28",
            "Nomor Soal": 2,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Ibu kota negara Indonesia Nusantara (IKN) terletak di provinsi...",
            "Opsi A": "Kalimantan Timur",
            "Opsi B": "Kalimantan Barat",
            "Opsi C": "Kalimantan Tengah",
            "Opsi D": "Sulawesi Selatan",
            "Opsi E": "Jawa Barat",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": "IKN berlokasi di Kalimantan Timur."
        },
        {
            "ID Soal": "QSTMVTP9N3EM1BF",
            "ID Ujian": "EXMMVTP9M3JES28",
            "Nomor Soal": 3,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Hasil perhitungan matematika: 15 × 8 + 40 ÷ 5 adalah...",
            "Opsi A": "128",
            "Opsi B": "124",
            "Opsi C": "130",
            "Opsi D": "120",
            "Opsi E": "118",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": "120 + 8 = 128."
        },
        {
            "ID Soal": "QSTMVTP9N3EWP9J",
            "ID Ujian": "EXMMVTP9M3JES28",
            "Nomor Soal": 4,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Sila ke-3 dalam Pancasila berbunyi...",
            "Opsi A": "Persatuan Indonesia",
            "Opsi B": "Kemanusiaan yang adil dan beradab",
            "Opsi C": "Ketuhanan Yang Maha Esa",
            "Opsi D": "Keadilan sosial bagi seluruh rakyat Indonesia",
            "Opsi E": "Kerakyatan yang dipimpin oleh hikmat",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": "Sila ke-3 adalah Persatuan Indonesia."
        },
        {
            "ID Soal": "QSTMVTP9N3ECOE7",
            "ID Ujian": "EXMMVTP9M3JES28",
            "Nomor Soal": 5,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Planet dalam tata surya yang dikenal dengan julukan Planet Merah adalah...",
            "Opsi A": "Mars",
            "Opsi B": "Venus",
            "Opsi C": "Jupiter",
            "Opsi D": "Merkurius",
            "Opsi E": "Saturnus",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": "Mars tampak kemerahan karena keberadaan oksida besi."
        },
        {
            "ID Soal": "QSTMVZ0IJO3TP1I",
            "ID Ujian": "EXMMVZ0IJAWOG71",
            "Nomor Soal": 1,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Apa fungsi utama klorofil pada daun tumbuhan hijau?",
            "Opsi A": "Menyerap cahaya matahari untuk fotosintesis",
            "Opsi B": "Menyerap air dari tanah",
            "Opsi C": "Menghasilkan karbondioksida",
            "Opsi D": "Melindungi dari serangga",
            "Opsi E": "Menggugurkan daun",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": "Klorofil berperan menyerap foton cahaya untuk fotosintesis."
        },
        {
            "ID Soal": "QSTMVZ0IJO3MVUU",
            "ID Ujian": "EXMMVZ0IJAWOG71",
            "Nomor Soal": 2,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Ibu kota negara Indonesia Nusantara (IKN) terletak di provinsi...",
            "Opsi A": "Kalimantan Timur",
            "Opsi B": "Kalimantan Barat",
            "Opsi C": "Kalimantan Tengah",
            "Opsi D": "Sulawesi Selatan",
            "Opsi E": "Jawa Barat",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": "IKN berlokasi di Kalimantan Timur."
        },
        {
            "ID Soal": "QSTMVZ0IJO3PN4N",
            "ID Ujian": "EXMMVZ0IJAWOG71",
            "Nomor Soal": 3,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Hasil perhitungan matematika: 15 × 8 + 40 ÷ 5 adalah...",
            "Opsi A": "128",
            "Opsi B": "124",
            "Opsi C": "130",
            "Opsi D": "120",
            "Opsi E": "118",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": "120 + 8 = 128."
        },
        {
            "ID Soal": "QSTMVZ0IJO33XL4",
            "ID Ujian": "EXMMVZ0IJAWOG71",
            "Nomor Soal": 4,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Sila ke-3 dalam Pancasila berbunyi...",
            "Opsi A": "Persatuan Indonesia",
            "Opsi B": "Kemanusiaan yang adil dan beradab",
            "Opsi C": "Ketuhanan Yang Maha Esa",
            "Opsi D": "Keadilan sosial bagi seluruh rakyat Indonesia",
            "Opsi E": "Kerakyatan yang dipimpin oleh hikmat",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": "Sila ke-3 adalah Persatuan Indonesia."
        },
        {
            "ID Soal": "QSTMVZ0IJO3JL2B",
            "ID Ujian": "EXMMVZ0IJAWOG71",
            "Nomor Soal": 5,
            "Tipe Soal": "pilihan_ganda",
            "Pertanyaan": "Planet dalam tata surya yang dikenal dengan julukan Planet Merah adalah...",
            "Opsi A": "Mars",
            "Opsi B": "Venus",
            "Opsi C": "Jupiter",
            "Opsi D": "Merkurius",
            "Opsi E": "Saturnus",
            "Jawaban Benar": "A",
            "Poin": 20,
            "Pembahasan": "Mars tampak kemerahan karena keberadaan oksida besi."
        }
    ],
    "Grades": [
        {
            "ID Nilai": "NLI_SESMVUXIXDP35IP",
            "ID Ujian": "EXMMVTP9M3JES28",
            "Judul Ujian": "ULANGAN INFORMATIKA 123",
            "ID Mapel": "MPLMVORRY6AUFXL",
            "Nama Mapel": "INFORMATIKA",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "NIS Siswa": "242",
            "Nama Siswa": "RASYA",
            "Nilai": 100,
            "Jumlah Benar": 5,
            "Jumlah Salah": 0,
            "Total Soal": 5,
            "Waktu Mulai": "2026-10-30T12:09:18.205Z",
            "Waktu Selesai": "2026-10-30T12:12:06.059Z",
            "Durasi Mengerjakan": "",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "Catatan Guru": "",
            "Nilai Akhir": 100,
            "Tanggal Input": "2026-10-30T12:12:06.059Z",
            "Status": "final"
        },
        {
            "ID Nilai": "NLI_SESMVTPHJZ3742E",
            "ID Ujian": "EXMMVTP9M3JES28",
            "Judul Ujian": "ULANGAN INFORMATIKA 123",
            "ID Mapel": "MPLMVORRY6AUFXL",
            "Nama Mapel": "INFORMATIKA",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "NIS Siswa": "254",
            "Nama Siswa": "WA ODE SITI MARWANA",
            "Nilai": 100,
            "Jumlah Benar": 5,
            "Jumlah Salah": 0,
            "Total Soal": 5,
            "Waktu Mulai": "2026-10-29T15:36:31.071Z",
            "Waktu Selesai": "2026-10-29T15:37:36.685Z",
            "Durasi Mengerjakan": "",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "Catatan Guru": "",
            "Nilai Akhir": 100,
            "Tanggal Input": "2026-10-29T15:37:36.685Z",
            "Status": "final"
        }
    ],
    "ExamSessions": [
        {
            "ID Sesi": "SESMVULSTYUVMJR",
            "ID Ujian": "EXMMVTP9M3JES28",
            "Judul Ujian": "ULANGAN INFORMATIKA 123",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "NIS Siswa": "X11IPS1",
            "Nama Siswa": "ABDUL RAHMAT",
            "Status Sesi": "active",
            "Waktu Masuk": "2026-10-30T06:41:04.950Z",
            "Waktu Selesai": "",
            "Jawaban JSON": "{}",
            "Pelanggaran": 1,
            "IP Address": "",
            "User Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
        },
        {
            "ID Sesi": "SESMVUXIXDP35IP",
            "ID Ujian": "EXMMVTP9M3JES28",
            "Judul Ujian": "ULANGAN INFORMATIKA 123",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "NIS Siswa": "242",
            "Nama Siswa": "RASYA",
            "Status Sesi": "finished",
            "Waktu Masuk": "2026-10-30T12:09:18.205Z",
            "Waktu Selesai": "2026-10-30T12:12:06.059Z",
            "Jawaban JSON": "{\"0\":\"A\",\"1\":\"A\",\"2\":\"A\",\"3\":\"A\",\"4\":\"A\",\"_score\":100,\"_correct\":5,\"_total\":5,\"_finishedAt\":\"2026-10-30T12:12:06.059Z\"}",
            "Pelanggaran": 0,
            "IP Address": "",
            "User Agent": "Mozilla/5.0 (Linux; Android 16; V2419) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.200 Mobile Safari/537.36 VivoBrowser/16.6.2.1"
        },
        {
            "ID Sesi": "SESMVZ0L1YWSK9X",
            "ID Ujian": "EXMMVZ0IJAWOG71",
            "Judul Ujian": "UTS",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "NIS Siswa": "X19",
            "Nama Siswa": "FELIYAWATI",
            "Status Sesi": "active",
            "Waktu Masuk": "2026-11-02T08:46:01.017Z",
            "Waktu Selesai": "",
            "Jawaban JSON": "{}",
            "Pelanggaran": 2,
            "IP Address": "",
            "User Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36"
        },
        {
            "ID Sesi": "SESMVZ0JB1F8JLJ",
            "ID Ujian": "EXMMVZ0IJAWOG71",
            "Judul Ujian": "UTS",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "NIS Siswa": "X15",
            "Nama Siswa": "AZNIA RAMADANI",
            "Status Sesi": "active",
            "Waktu Masuk": "2026-11-02T08:44:39.459Z",
            "Waktu Selesai": "",
            "Jawaban JSON": "{}",
            "Pelanggaran": 1,
            "IP Address": "",
            "User Agent": "Mozilla/5.0 (Linux; Android 8.1.0; vivo 1820 Build/O11019) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.200 Mobile Safari/537.36 VivoBrowser/16.6.2.1"
        },
        {
            "ID Sesi": "SESMVTPHJZ3742E",
            "ID Ujian": "EXMMVTP9M3JES28",
            "Judul Ujian": "ULANGAN INFORMATIKA 123",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "NIS Siswa": "254",
            "Nama Siswa": "WA ODE SITI MARWANA",
            "Status Sesi": "finished",
            "Waktu Masuk": "2026-10-29T15:36:31.071Z",
            "Waktu Selesai": "2026-10-29T15:37:36.685Z",
            "Jawaban JSON": "{\"0\":\"A\",\"1\":\"A\",\"2\":\"A\",\"3\":\"A\",\"4\":\"A\",\"_score\":100,\"_correct\":5,\"_total\":5,\"_finishedAt\":\"2026-10-29T15:37:36.685Z\"}",
            "Pelanggaran": 0,
            "IP Address": "",
            "User Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36"
        },
        {
            "ID Sesi": "SESMVZEQPK45B34",
            "ID Ujian": "EXMMVZ0IJAWOG71",
            "Judul Ujian": "UTS",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "NIS Siswa": "X19",
            "Nama Siswa": "FELIYAWATI",
            "Status Sesi": "active",
            "Waktu Masuk": "2026-11-02T15:22:19.492Z",
            "Waktu Selesai": "",
            "Jawaban JSON": "{}",
            "Pelanggaran": 1,
            "IP Address": "",
            "User Agent": "Mozilla/5.0 (Linux; Android 16; V2419) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.200 Mobile Safari/537.36 VivoBrowser/16.6.4.0"
        }
    ],
    "Violations": [
        {
            "ID": "VIOMVULTZQRVLUK",
            "ID Ujian": "EXMMVTP9M3JES28",
            "Judul Ujian": "ULANGAN INFORMATIKA 123",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "NIS Siswa": "X11IPS1",
            "Nama Siswa": "ABDUL RAHMAT",
            "Jenis Pelanggaran": "Pindah Jendela Aplikasi / Alt-Tab",
            "Waktu Pelanggaran": "2026-10-30T06:41:59.092Z",
            "Detail": "Pelanggaran ke-2 (Pindah Jendela Aplikasi / Alt-Tab)",
            "Jumlah Pelanggaran": 2
        },
        {
            "ID": "VIOMVULTXCKRCHZ",
            "ID Ujian": "EXMMVTP9M3JES28",
            "Judul Ujian": "ULANGAN INFORMATIKA 123",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "NIS Siswa": "X11IPS1",
            "Nama Siswa": "ABDUL RAHMAT",
            "Jenis Pelanggaran": "Pindah Tab Browser / Minimize Layar",
            "Waktu Pelanggaran": "2026-10-30T06:41:55.988Z",
            "Detail": "Pelanggaran ke-1 (Pindah Tab Browser / Minimize Layar)",
            "Jumlah Pelanggaran": 1
        },
        {
            "ID": "VIOMVZ0LBQ2TYE7",
            "ID Ujian": "EXMMVZ0IJAWOG71",
            "Judul Ujian": "UTS",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "NIS Siswa": "X19",
            "Nama Siswa": "FELIYAWATI",
            "Jenis Pelanggaran": "Pindah Tab Browser / Minimize Layar",
            "Waktu Pelanggaran": "2026-11-02T08:46:13.658Z",
            "Detail": "Pelanggaran ke-1 (Pindah Tab Browser / Minimize Layar)",
            "Jumlah Pelanggaran": 1
        },
        {
            "ID": "VIOMVZ0OV7E3RZ5",
            "ID Ujian": "EXMMVZ0IJAWOG71",
            "Judul Ujian": "UTS",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "NIS Siswa": "X19",
            "Nama Siswa": "FELIYAWATI",
            "Jenis Pelanggaran": "Pindah Tab Browser / Minimize Layar",
            "Waktu Pelanggaran": "2026-11-02T08:48:58.874Z",
            "Detail": "Pelanggaran ke-2 (Pindah Tab Browser / Minimize Layar)",
            "Jumlah Pelanggaran": 2
        },
        {
            "ID": "VIOMVZ0P4Q4DFHE",
            "ID Ujian": "EXMMVZ0IJAWOG71",
            "Judul Ujian": "UTS",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "NIS Siswa": "X15",
            "Nama Siswa": "AZNIA RAMADANI",
            "Jenis Pelanggaran": "Pindah Tab Browser / Minimize Layar",
            "Waktu Pelanggaran": "2026-11-02T08:49:11.215Z",
            "Detail": "Pelanggaran ke-1 (Pindah Tab Browser / Minimize Layar)",
            "Jumlah Pelanggaran": 1
        },
        {
            "ID": "VIOMVZEQWDA54AO",
            "ID Ujian": "EXMMVZ0IJAWOG71",
            "Judul Ujian": "UTS",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "Nama Kelas": "X.1",
            "NIS Siswa": "X19",
            "Nama Siswa": "FELIYAWATI",
            "Jenis Pelanggaran": "Pindah Jendela Aplikasi / Alt-Tab",
            "Waktu Pelanggaran": "2026-11-02T15:22:28.318Z",
            "Detail": "Pelanggaran ke-1 (Pindah Jendela Aplikasi / Alt-Tab)",
            "Jumlah Pelanggaran": 1
        }
    ],
    "Attendance": [
        {
            "ID Absen": "ABSMVQK2PFUMLIS",
            "Tanggal": "2026-10-27",
            "Hari": "Selasa",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "ID Mapel": "MPLMVL3VA5ZURLK",
            "Nama Mapel": "SEJARAH",
            "NIS Siswa": "X11IPS1",
            "Nama Siswa": "ABDUL RAHMAT",
            "Status": "Hadir",
            "Keterangan": "",
            "Jam Absen": "18:41",
            "Diubah Oleh": "RAHMAN RAJAB, S.Pd",
            "Waktu Ubah": "2026-10-27T10:41:41.706Z"
        },
        {
            "ID Absen": "ABSMVQK2PFUMECS",
            "Tanggal": "2026-10-27",
            "Hari": "Selasa",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "ID Mapel": "MPLMVL3VA5ZURLK",
            "Nama Mapel": "SEJARAH",
            "NIS Siswa": "X11IPS2",
            "Nama Siswa": "AMEL",
            "Status": "Hadir",
            "Keterangan": "",
            "Jam Absen": "18:41",
            "Diubah Oleh": "RAHMAN RAJAB, S.Pd",
            "Waktu Ubah": "2026-10-27T10:41:41.706Z"
        },
        {
            "ID Absen": "ABSMVQK2PFU9YVH",
            "Tanggal": "2026-10-27",
            "Hari": "Selasa",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "ID Mapel": "MPLMVL3VA5ZURLK",
            "Nama Mapel": "SEJARAH",
            "NIS Siswa": "X11IPS3",
            "Nama Siswa": "ARI SETIAWAN",
            "Status": "Hadir",
            "Keterangan": "",
            "Jam Absen": "18:41",
            "Diubah Oleh": "RAHMAN RAJAB, S.Pd",
            "Waktu Ubah": "2026-10-27T10:41:41.706Z"
        },
        {
            "ID Absen": "ABSMVQK2PFUWNPF",
            "Tanggal": "2026-10-27",
            "Hari": "Selasa",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "ID Mapel": "MPLMVL3VA5ZURLK",
            "Nama Mapel": "SEJARAH",
            "NIS Siswa": "X11IPS4",
            "Nama Siswa": "ARIL",
            "Status": "Hadir",
            "Keterangan": "",
            "Jam Absen": "18:41",
            "Diubah Oleh": "RAHMAN RAJAB, S.Pd",
            "Waktu Ubah": "2026-10-27T10:41:41.706Z"
        },
        {
            "ID Absen": "ABSMVQK2PFUYXAD",
            "Tanggal": "2026-10-27",
            "Hari": "Selasa",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "ID Mapel": "MPLMVL3VA5ZURLK",
            "Nama Mapel": "SEJARAH",
            "NIS Siswa": "212",
            "Nama Siswa": "EKA SAFITRI",
            "Status": "Hadir",
            "Keterangan": "",
            "Jam Absen": "18:41",
            "Diubah Oleh": "RAHMAN RAJAB, S.Pd",
            "Waktu Ubah": "2026-10-27T10:41:41.706Z"
        },
        {
            "ID Absen": "ABSMVQK2PFVK52B",
            "Tanggal": "2026-10-27",
            "Hari": "Selasa",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "ID Mapel": "MPLMVL3VA5ZURLK",
            "Nama Mapel": "SEJARAH",
            "NIS Siswa": "242",
            "Nama Siswa": "RASYA",
            "Status": "Hadir",
            "Keterangan": "",
            "Jam Absen": "18:41",
            "Diubah Oleh": "RAHMAN RAJAB, S.Pd",
            "Waktu Ubah": "2026-10-27T10:41:41.706Z"
        },
        {
            "ID Absen": "ABSMVRS7NL7TE2G",
            "Tanggal": "2026-10-27",
            "Hari": "Selasa",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "ID Mapel": "MPLMVORRY6AUFXL",
            "Nama Mapel": "INFORMATIKA",
            "NIS Siswa": "X11IPS1",
            "Nama Siswa": "ABDUL RAHMAT",
            "Status": "Hadir",
            "Keterangan": "",
            "Jam Absen": "15:17",
            "Diubah Oleh": "LA ODE HARNADO, S.Si",
            "Waktu Ubah": "2026-10-28T07:17:15.690Z"
        },
        {
            "ID Absen": "ABSMVRS7NL7CI4U",
            "Tanggal": "2026-10-27",
            "Hari": "Selasa",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "ID Mapel": "MPLMVORRY6AUFXL",
            "Nama Mapel": "INFORMATIKA",
            "NIS Siswa": "X11IPS2",
            "Nama Siswa": "AMEL",
            "Status": "Alpa",
            "Keterangan": "",
            "Jam Absen": "15:17",
            "Diubah Oleh": "LA ODE HARNADO, S.Si",
            "Waktu Ubah": "2026-10-28T07:17:15.690Z"
        },
        {
            "ID Absen": "ABSMVRS7NL7M1IX",
            "Tanggal": "2026-10-27",
            "Hari": "Selasa",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "ID Mapel": "MPLMVORRY6AUFXL",
            "Nama Mapel": "INFORMATIKA",
            "NIS Siswa": "X11IPS3",
            "Nama Siswa": "ARI SETIAWAN",
            "Status": "Hadir",
            "Keterangan": "",
            "Jam Absen": "15:17",
            "Diubah Oleh": "LA ODE HARNADO, S.Si",
            "Waktu Ubah": "2026-10-28T07:17:15.690Z"
        },
        {
            "ID Absen": "ABSMVRS7NL7FKAH",
            "Tanggal": "2026-10-27",
            "Hari": "Selasa",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "ID Mapel": "MPLMVORRY6AUFXL",
            "Nama Mapel": "INFORMATIKA",
            "NIS Siswa": "X11IPS4",
            "Nama Siswa": "ARIL",
            "Status": "Hadir",
            "Keterangan": "",
            "Jam Absen": "15:17",
            "Diubah Oleh": "LA ODE HARNADO, S.Si",
            "Waktu Ubah": "2026-10-28T07:17:15.690Z"
        },
        {
            "ID Absen": "ABSMVRS7NL71F5W",
            "Tanggal": "2026-10-27",
            "Hari": "Selasa",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "ID Mapel": "MPLMVORRY6AUFXL",
            "Nama Mapel": "INFORMATIKA",
            "NIS Siswa": "212",
            "Nama Siswa": "EKA SAFITRI",
            "Status": "Hadir",
            "Keterangan": "",
            "Jam Absen": "15:17",
            "Diubah Oleh": "LA ODE HARNADO, S.Si",
            "Waktu Ubah": "2026-10-28T07:17:15.690Z"
        },
        {
            "ID Absen": "ABSMVRS7NL70CGH",
            "Tanggal": "2026-10-27",
            "Hari": "Selasa",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "Nama Kelas": "XII IPS",
            "ID Guru": "USRMVL3A5K7HB02",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "ID Mapel": "MPLMVORRY6AUFXL",
            "Nama Mapel": "INFORMATIKA",
            "NIS Siswa": "242",
            "Nama Siswa": "RASYA",
            "Status": "Hadir",
            "Keterangan": "",
            "Jam Absen": "15:17",
            "Diubah Oleh": "LA ODE HARNADO, S.Si",
            "Waktu Ubah": "2026-10-28T07:17:15.690Z"
        }
    ],
    "Learnings": [
        {
            "id": "LRNMVZEJDK97U5B",
            "ID": "LRNMVZEJDK97U5B",
            "judul": "Sintaks error",
            "Judul": "Sintaks error",
            "idMapel": "MPLMVORU9CSU10E",
            "ID Mapel": "MPLMVORU9CSU10E",
            "namaMapel": "KKA (X.1)",
            "Nama Mapel": "KKA (X.1)",
            "idKelas": "KLSMVNZPCGLVG85",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "namaKelas": "X.1",
            "Nama Kelas": "X.1",
            "idGuru": "USRMVL3A5K7HB02",
            "ID Guru": "USRMVL3A5K7HB02",
            "namaGuru": "LA ODE HARNADO, S.Si",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "token": "LRNNS65",
            "Token": "LRNNS65",
            "ringkasan": "",
            "Ringkasan": "",
            "konten": "Baca dengan seksama materi ini",
            "Konten": "Baca dengan seksama materi ini",
            "mediaUrl": "",
            "Media URL": "",
            "attachments": [
                {
                    "name": "Fisika-BS-KLS-XI-39-48.pdf",
                    "size": 324328,
                    "type": "application/pdf",
                    "dataUrl": "cloud-media/learnings/Fisika-BS-KLS-XI-39-48.pdf"
                }
            ],
            "groups": [],
            "Groups": [],
            "pembagianKelompok": "",
            "Pembagian Kelompok": "",
            "hasTask": "no",
            "Ada Tugas": "no",
            "taskInstructions": "",
            "Instruksi Tugas": "",
            "status": "active",
            "Status": "active",
            "tanggalBuat": "2026-11-02T15:16:37.353Z",
            "Tanggal Buat": "2026-11-02T15:16:37.353Z",
            "tanggalUpdate": "2026-11-02T15:16:37.354Z",
            "Tanggal Update": "2026-11-02T15:16:37.354Z"
        },
        {
            "id": "LRNMVZEIT6ZJ2R0",
            "ID": "LRNMVZEIT6ZJ2R0",
            "judul": "Sintaks error",
            "Judul": "Sintaks error",
            "idMapel": "MPLMVORU9CSU10E",
            "ID Mapel": "MPLMVORU9CSU10E",
            "namaMapel": "KKA (X.1)",
            "Nama Mapel": "KKA (X.1)",
            "idKelas": "KLSMVNZPCGLVG85",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "namaKelas": "X.1",
            "Nama Kelas": "X.1",
            "idGuru": "USRMVL3A5K7HB02",
            "ID Guru": "USRMVL3A5K7HB02",
            "namaGuru": "LA ODE HARNADO, S.Si",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "token": "LRNNS65",
            "Token": "LRNNS65",
            "ringkasan": "",
            "Ringkasan": "",
            "konten": "Baca dengan seksama materi ini",
            "Konten": "Baca dengan seksama materi ini",
            "mediaUrl": "",
            "Media URL": "",
            "attachments": [
                {
                    "name": "Fisika-BS-KLS-XI-39-48.pdf",
                    "size": 324328,
                    "type": "application/pdf",
                    "dataUrl": "cloud-media/learnings/Fisika-BS-KLS-XI-39-48.pdf"
                }
            ],
            "groups": [],
            "Groups": [],
            "pembagianKelompok": "",
            "Pembagian Kelompok": "",
            "hasTask": "no",
            "Ada Tugas": "no",
            "taskInstructions": "",
            "Instruksi Tugas": "",
            "status": "active",
            "Status": "active",
            "tanggalBuat": "2026-11-02T15:16:10.955Z",
            "Tanggal Buat": "2026-11-02T15:16:10.955Z",
            "tanggalUpdate": "2026-11-02T15:16:10.955Z",
            "Tanggal Update": "2026-11-02T15:16:10.955Z"
        },
        {
            "id": "LRNMVVUDGTRNN76",
            "ID": "LRNMVVUDGTRNN76",
            "judul": "CHAPTER I : TALKING ABOUT SELF",
            "Judul": "CHAPTER I : TALKING ABOUT SELF",
            "idMapel": "MPLMVT3UAWYPYK9",
            "ID Mapel": "MPLMVT3UAWYPYK9",
            "namaMapel": "BAHASA INGGRIS",
            "Nama Mapel": "BAHASA INGGRIS",
            "idKelas": "KLSMVNZPCGLVG85",
            "ID Kelas": "KLSMVNZPCGLVG85",
            "namaKelas": "X.1",
            "Nama Kelas": "X.1",
            "idGuru": "USRMVLZ3DDLIH3T",
            "ID Guru": "USRMVLZ3DDLIH3T",
            "namaGuru": "LIA ARIANTI, S.Pd",
            "Nama Guru": "LIA ARIANTI, S.Pd",
            "token": "BINGXA",
            "Token": "BINGXA",
            "ringkasan": "Introduction ourself",
            "Ringkasan": "Introduction ourself",
            "konten": "1. Pen pal",
            "Konten": "1. Pen pal",
            "mediaUrl": "",
            "Media URL": "",
            "attachments": [],
            "groups": [],
            "Groups": [],
            "pembagianKelompok": "",
            "Pembagian Kelompok": "",
            "hasTask": "yes",
            "Ada Tugas": "yes",
            "taskInstructions": "Tuliskan teks perkenalan. Minimal 5 kalimat",
            "Instruksi Tugas": "Tuliskan teks perkenalan. Minimal 5 kalimat",
            "status": "active",
            "Status": "active",
            "tanggalBuat": "2026-10-31T03:28:50.800Z",
            "Tanggal Buat": "2026-10-31T03:28:50.800Z",
            "tanggalUpdate": "2026-10-31T03:28:50.800Z",
            "Tanggal Update": "2026-10-31T03:28:50.800Z"
        },
        {
            "id": "LRNMVTN5X44FK4D",
            "ID": "LRNMVTN5X44FK4D",
            "judul": "INFORMATIKA",
            "Judul": "INFORMATIKA",
            "idMapel": "MPLMVORQR68IHB5",
            "ID Mapel": "MPLMVORQR68IHB5",
            "namaMapel": "INFORMATIKA",
            "Nama Mapel": "INFORMATIKA",
            "idKelas": "KLSMVL3SPR0L7WZ",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "namaKelas": "XII IPS",
            "Nama Kelas": "XII IPS",
            "idGuru": "USRMVL3A5K7HB02",
            "ID Guru": "USRMVL3A5K7HB02",
            "namaGuru": "LA ODE HARNADO, S.Si",
            "Nama Guru": "LA ODE HARNADO, S.Si",
            "token": "TKVMBH",
            "Token": "TKVMBH",
            "ringkasan": "Pelajari makna lagu ini",
            "Ringkasan": "Pelajari makna lagu ini",
            "konten": "Lagu melayu",
            "Konten": "Lagu melayu",
            "mediaUrl": "https://youtu.be/y9Dv-0Sh_Cg?si=BCeFpNcIM2SE3CMc",
            "Media URL": "https://youtu.be/y9Dv-0Sh_Cg?si=BCeFpNcIM2SE3CMc",
            "attachments": [],
            "groups": [],
            "Groups": [],
            "pembagianKelompok": "Kelompok 1:",
            "Pembagian Kelompok": "Kelompok 1:",
            "hasTask": "yes",
            "Ada Tugas": "yes",
            "taskInstructions": "Unggah tugas anda disini",
            "Instruksi Tugas": "Unggah tugas anda disini",
            "status": "active",
            "Status": "active",
            "tanggalBuat": "2026-10-30T06:36:47.706Z",
            "Tanggal Buat": "2026-10-30T06:36:47.706Z",
            "tanggalUpdate": "2026-11-02T15:16:09.711Z",
            "Tanggal Update": "2026-11-02T15:16:09.711Z"
        },
        {
            "id": "LRNMVL3YV7LGDJ6",
            "ID": "LRNMVL3YV7LGDJ6",
            "judul": "perjuangan",
            "Judul": "perjuangan",
            "idMapel": "MPLMVL3VA5ZURLK",
            "ID Mapel": "MPLMVL3VA5ZURLK",
            "namaMapel": "SEJARAH",
            "Nama Mapel": "SEJARAH",
            "idKelas": "KLSMVL3SPR0L7WZ",
            "ID Kelas": "KLSMVL3SPR0L7WZ",
            "namaKelas": "XII IPS",
            "Nama Kelas": "XII IPS",
            "idGuru": "USRMVL3KPCGXBVZ",
            "ID Guru": "USRMVL3KPCGXBVZ",
            "namaGuru": "RAHMAN RAJAB, S.Pd",
            "Nama Guru": "RAHMAN RAJAB, S.Pd",
            "token": "123A",
            "Token": "123A",
            "ringkasan": "dhjcfdwhhfujfdh",
            "Ringkasan": "dhjcfdwhhfujfdh",
            "konten": "sdhfwdfdehfdrg",
            "Konten": "sdhfwdfdehfdrg",
            "mediaUrl": "https://www.youtube.com/watch?v=rXIPbHyPAic",
            "Media URL": "https://www.youtube.com/watch?v=rXIPbHyPAic",
            "attachments": [],
            "groups": [],
            "Groups": [],
            "pembagianKelompok": "",
            "Pembagian Kelompok": "",
            "hasTask": "no",
            "Ada Tugas": "no",
            "taskInstructions": "",
            "Instruksi Tugas": "",
            "status": "active",
            "Status": "active",
            "tanggalBuat": "2026-10-23T15:11:57.825Z",
            "Tanggal Buat": "2026-10-23T15:11:57.825Z",
            "tanggalUpdate": "2026-11-02T15:16:09.711Z",
            "Tanggal Update": "2026-11-02T15:16:09.711Z"
        }
    ],
    "Discussions": [
        {
            "id": "DSCMVLVPLFT1SJ5",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "senderName": "RASYA",
            "senderRole": "siswa",
            "category": "pertanyaan",
            "content": "PAK GURU SAYA BELUM MENGERTI",
            "parentId": null,
            "createdAt": "2026-10-24T04:08:34.505Z"
        },
        {
            "id": "DSCMVLVQNS6EOW3",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "senderName": "RAHMAN RAJAB, S.Pd",
            "senderRole": "guru",
            "category": "jawaban",
            "content": "apanya yang belum kamu mengerti",
            "parentId": "DSCMVLVPLFT1SJ5",
            "createdAt": "2026-10-24T04:09:24.199Z"
        }
    ],
    "Attendees": [
        {
            "id": "ATTMVTQT1U6U7C8",
            "idPembelajaran": "LRNMVTN5X44FK4D",
            "judulPembelajaran": "INFORMATIKA",
            "namaSiswa": "RASYA",
            "nisSiswa": "242",
            "namaKelas": "XII IPS",
            "waktuMasuk": "2026-10-29T16:13:26.391Z",
            "waktuAkses": "2026-10-29T16:13:26.391Z",
            "waktuKeluar": "2026-10-29T16:13:26.391Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVTNB3I94M0N",
            "idPembelajaran": "LRNMVTN5X44FK4D",
            "judulPembelajaran": "INFORMATIKA",
            "namaSiswa": "RASYA",
            "nisSiswa": "242",
            "namaKelas": "XII IPS",
            "waktuMasuk": "2026-10-29T14:35:29.234Z",
            "waktuAkses": "2026-10-29T14:35:29.234Z",
            "waktuKeluar": "2026-10-29T14:35:29.234Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVRZOQKKBPAW",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "nisSiswa": "242",
            "namaKelas": "XII IPS",
            "waktuMasuk": "2026-10-28T10:46:29.332Z",
            "waktuAkses": "2026-10-28T10:46:29.332Z",
            "waktuKeluar": "2026-10-28T10:46:29.332Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVRPQUO3BDI2",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "nisSiswa": "242",
            "namaKelas": "XII IPS",
            "waktuMasuk": "2026-10-28T06:08:09.395Z",
            "waktuAkses": "2026-10-28T06:08:09.395Z",
            "waktuKeluar": "2026-10-28T06:08:09.395Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVRPQTPQ4PEO",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "nisSiswa": "242",
            "namaKelas": "XII IPS",
            "waktuMasuk": "2026-10-28T06:08:08.759Z",
            "waktuAkses": "2026-10-28T06:08:08.759Z",
            "waktuKeluar": "2026-10-28T06:08:08.759Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVRPQQRJGLK2",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "nisSiswa": "242",
            "namaKelas": "XII IPS",
            "waktuMasuk": "2026-10-28T06:07:57.570Z",
            "waktuAkses": "2026-10-28T06:07:57.570Z",
            "waktuKeluar": "2026-10-28T06:07:57.570Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVQJO6WW4D5T",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "nisSiswa": "242",
            "namaKelas": "XII IPS",
            "waktuMasuk": "2026-10-27T10:30:23.177Z",
            "waktuAkses": "2026-10-27T10:30:23.177Z",
            "waktuKeluar": "2026-10-27T10:30:23.177Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVQJO6NZKM4L",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "nisSiswa": "242",
            "namaKelas": "XII IPS",
            "waktuMasuk": "2026-10-27T10:30:22.993Z",
            "waktuAkses": "2026-10-27T10:30:22.993Z",
            "waktuKeluar": "2026-10-27T10:30:22.993Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVQJO698ZOUA",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "nisSiswa": "242",
            "namaKelas": "XII IPS",
            "waktuMasuk": "2026-10-27T10:30:22.445Z",
            "waktuAkses": "2026-10-27T10:30:22.445Z",
            "waktuKeluar": "2026-10-27T10:30:22.445Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVQJO61GXSBW",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "nisSiswa": "242",
            "namaKelas": "XII IPS",
            "waktuMasuk": "2026-10-27T10:30:21.985Z",
            "waktuAkses": "2026-10-27T10:30:21.985Z",
            "waktuKeluar": "2026-10-27T10:30:21.985Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVQJO5OAC0PZ",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "nisSiswa": "242",
            "namaKelas": "XII IPS",
            "waktuMasuk": "2026-10-27T10:30:20.469Z",
            "waktuAkses": "2026-10-27T10:30:20.469Z",
            "waktuKeluar": "2026-10-27T10:30:20.469Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVPDUSADY1KK",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "waktuMasuk": "2026-10-26T14:59:48.276Z",
            "waktuAkses": "2026-10-26T14:59:48.276Z",
            "waktuKeluar": "2026-10-26T15:00:55.030Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVMR1C55N4IJ",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "waktuMasuk": "2026-10-24T18:45:30.425Z",
            "waktuAkses": "2026-10-24T18:45:30.425Z",
            "waktuKeluar": "2026-10-24T18:45:57.518Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVMR1AM2AIXR",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "waktuMasuk": "2026-10-24T18:45:28.441Z",
            "waktuAkses": "2026-10-24T18:45:28.441Z",
            "waktuKeluar": null,
            "status": "active"
        },
        {
            "id": "ATTMVMNCITY40F6",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "waktuMasuk": "2026-10-24T17:02:13.846Z",
            "waktuAkses": "2026-10-24T17:02:13.846Z",
            "waktuKeluar": "2026-10-24T17:04:15.492Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVMKDG90M7HP",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "waktuMasuk": "2026-10-24T15:38:58.293Z",
            "waktuAkses": "2026-10-24T15:38:58.293Z",
            "waktuKeluar": "2026-10-24T15:40:38.059Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVLYOJHQC5T1",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "waktuMasuk": "2026-10-24T05:31:44.174Z",
            "waktuAkses": "2026-10-24T05:31:44.174Z",
            "waktuKeluar": "2026-10-24T05:32:42.036Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVLVMW17RYXU",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "waktuMasuk": "2026-10-24T04:06:28.266Z",
            "waktuAkses": "2026-10-24T04:06:28.266Z",
            "waktuKeluar": "2026-10-24T04:08:43.949Z",
            "status": "selesai"
        },
        {
            "id": "ATTMVLUXG3UWPUT",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "waktuMasuk": "2026-10-24T03:46:41.226Z",
            "waktuAkses": "2026-10-24T03:46:41.226Z",
            "waktuKeluar": null,
            "status": "active"
        },
        {
            "id": "ATTMVLREEUC242C",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "waktuAkses": "2026-10-24T02:07:54.275Z"
        },
        {
            "id": "ATTMVL3ZSNFQA34",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "waktuAkses": "2026-10-23T15:12:41.163Z"
        },
        {
            "id": "ATTMVL3ZFBT177G",
            "idPembelajaran": "LRNMVL3YV7LGDJ6",
            "judulPembelajaran": "perjuangan",
            "namaSiswa": "RASYA",
            "waktuAkses": "2026-10-23T15:12:23.897Z"
        }
    ],
    "Announcements": [
        {
            "ID": "ANN001",
            "Judul": "Selamat Datang di Portal Sekolah",
            "Konten": "Portal Sekolah resmi diluncurkan. Guru dan siswa dapat mengakses portal ini untuk kegiatan pembelajaran, absensi, dan ujian CBT.",
            "Kategori": "Umum",
            "Prioritas": "Tinggi",
            "ID Pembuat": "USR001",
            "Nama Pembuat": "Administrator",
            "Role Pembuat": "admin",
            "Tanggal Buat": "2026-10-23 11:20:09.715836+00",
            "Tanggal Update": "2026-10-23 11:20:09.715836+00",
            "Status": "active",
            "Gambar URL": ""
        }
    ]
};

  const SYNTHETIC_STUDENT_IDS = new Set([
    'SISMVOSBN4K812A', 'SISMVOSCP8M934B', 'SISMVOSDR2N756C'
  ]);

  function _getDefaultTableRows(tableName) {
    switch (tableName) {
      case 'Users':
        return JSON.parse(JSON.stringify(REAL_SCHOOL_SNAPSHOT.Users));
      case 'Classes':
        return JSON.parse(JSON.stringify(REAL_SCHOOL_SNAPSHOT.Classes));
      case 'Subjects':
        return JSON.parse(JSON.stringify(REAL_SCHOOL_SNAPSHOT.Subjects));
      case 'Students':
        return JSON.parse(JSON.stringify(REAL_SCHOOL_SNAPSHOT.Students));
      case 'Exams':
        return JSON.parse(JSON.stringify(REAL_SCHOOL_SNAPSHOT.Exams));
      case 'Questions':
        return JSON.parse(JSON.stringify(REAL_SCHOOL_SNAPSHOT.Questions));
      case 'Grades':
        return JSON.parse(JSON.stringify(REAL_SCHOOL_SNAPSHOT.Grades || []));
      case 'ExamSessions':
        return JSON.parse(JSON.stringify(REAL_SCHOOL_SNAPSHOT.ExamSessions || []));
      case 'Violations':
        return JSON.parse(JSON.stringify(REAL_SCHOOL_SNAPSHOT.Violations || []));
      case 'Attendance':
        return JSON.parse(JSON.stringify(REAL_SCHOOL_SNAPSHOT.Attendance));
      case 'Learnings':
        return JSON.parse(JSON.stringify(REAL_SCHOOL_SNAPSHOT.Learnings));
      case 'Announcements':
        return JSON.parse(JSON.stringify(REAL_SCHOOL_SNAPSHOT.Announcements || []));
      case 'Settings': {
        const rows = Object.keys(REAL_SCHOOL_SNAPSHOT.SettingsMap).map(k => ({
          'Key': k,
          'Value': REAL_SCHOOL_SNAPSHOT.SettingsMap[k],
          'Diupdate': '2026-10-31T00:00:00.000Z'
        }));
        rows.push({
          'Key': 'gallery_images',
          'Value': JSON.stringify(REAL_SCHOOL_SNAPSHOT.GalleryImages || []),
          'Diupdate': '2026-10-31T00:00:00.000Z'
        });
        rows.push({
          'Key': 'guru_extra_metadata',
          'Value': JSON.stringify(REAL_SCHOOL_SNAPSHOT.GuruExtraMetadata || {}),
          'Diupdate': '2026-10-31T00:00:00.000Z'
        });
        rows.push({
          'Key': 'app_learnings_data',
          'Value': JSON.stringify(REAL_SCHOOL_SNAPSHOT.Learnings || []),
          'Diupdate': '2026-10-31T00:00:00.000Z'
        });
        rows.push({
          'Key': 'app_learning_discussions_data',
          'Value': JSON.stringify(REAL_SCHOOL_SNAPSHOT.Discussions || []),
          'Diupdate': '2026-10-31T00:00:00.000Z'
        });
        rows.push({
          'Key': 'app_learning_attendees_data',
          'Value': JSON.stringify(REAL_SCHOOL_SNAPSHOT.Attendees || []),
          'Diupdate': '2026-10-31T00:00:00.000Z'
        });
        return rows;
      }
      default:
        return [];
    }
  }

  function _getPrimaryKeyCol(tableName) {
    const map = {
      Users: 'ID',
      PendingUsers: 'ID',
      Settings: 'Key',
      Classes: 'ID Kelas',
      Students: 'ID Siswa',
      Subjects: 'ID Mapel',
      Exams: 'ID Ujian',
      Questions: 'ID Soal',
      ExamSessions: 'ID Sesi',
      StudentAnswers: 'ID Jawaban',
      Grades: 'ID Nilai',
      Violations: 'ID',
      Announcements: 'ID',
      Attendance: 'ID Absen',
      Learnings: 'ID',
      LearningSessions: 'ID'
    };
    return map[tableName] || 'ID';
  }

  function _isSemesterOverridden(tableName) {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('portal_semester_override_' + tableName) === 'true';
    } catch (e) {
      return false;
    }
  }

  function _normalizeTableRows(tableName, rows, options = {}) {
    if (!Array.isArray(rows)) return [];
    const authoritativeRemote = Boolean(options && options.authoritativeRemote);
    const defaults = authoritativeRemote ? [] : _getDefaultTableRows(tableName);
    const pk = _getPrimaryKeyCol(tableName);
    const deletedIds = authoritativeRemote ? new Set() : _getDeletedIds(tableName);
    const isOverridden = authoritativeRemote || _isSemesterOverridden(tableName);

    // Buat lookup map dari default snapshot untuk pelengkap metadata guru bila ID sama
    const defaultsLookup = new Map();
    if (!authoritativeRemote) {
      defaults.forEach(d => {
        const k = String(d[pk] || d['ID Absensi'] || d['ID Pengumuman'] || d.ID || d.id || '');
        if (k) defaultsLookup.set(k, d);
      });
    }

    // Filter baris dummy, baris yang telah dihapus user, atau ID usang
    const cleaned = rows.filter(r => {
      if (!r || typeof r !== 'object') return false;
      const k = String(r[pk] || r['ID Absensi'] || r['ID Pengumuman'] || r.ID || r.id || '');
      if (k && deletedIds.has(k)) return false;
      if (tableName === 'Users' && isDummyUserRecord(r)) return false;
      if (!isOverridden && tableName === 'Subjects') {
        const idMapel = String(r['ID Mapel'] || '');
        if (idMapel.startsWith('MPMVNZ')) return false;
      }
      if (!isOverridden && tableName === 'Students') {
        const idSiswa = String(r['ID Siswa'] || r.id || '');
        if (SYNTHETIC_STUDENT_IDS.has(idSiswa)) return false;
      }
      return true;
    });

    const mergedMap = new Map();
    // Masukkan baris snapshot asli HANYA jika tabel belum diganti/direset dan bukan data resmi langsung dari Supabase
    if (!isOverridden && !authoritativeRemote) {
      defaults.forEach(d => {
        const k = String(d[pk] || d['ID Absensi'] || d['ID Pengumuman'] || d.ID || d.id || '');
        if (k && !deletedIds.has(k)) {
          mergedMap.set(k, { ...d });
        }
      });
    }

    // Gabungkan perubahan terbaru dari cache/server/backup
    cleaned.forEach(r => {
      const rawKey = r[pk] || r['ID Absensi'] || r['ID Pengumuman'] || r.ID || r.id;
      if (!rawKey) return;
      const k = String(rawKey);
      if (deletedIds.has(k)) return;
      const base = mergedMap.get(k) || defaultsLookup.get(k) || {};
      const combined = { ...(isOverridden ? {} : base), ...r };

      if (tableName === 'Users') {
        const uId = String(combined.ID || combined.id || '');
        if ((!combined['Password'] || combined['Password'] === '123456') && base['Password']) {
          combined['Password'] = base['Password'];
        }
        if (!combined['Email'] && base['Email']) {
          combined['Email'] = base['Email'];
        }
        if (!combined['NIP'] && base['NIP']) {
          combined['NIP'] = base['NIP'];
        }
        if (!combined['Telepon'] && base['Telepon']) {
          combined['Telepon'] = base['Telepon'];
        }
        if (!combined['Alamat'] && base['Alamat']) {
          combined['Alamat'] = base['Alamat'];
        }
        if (!combined['Foto Profil URL'] && base['Foto Profil URL']) {
          combined['Foto Profil URL'] = base['Foto Profil URL'];
        }
        // Pastikan seluruh 23 dewan guru memiliki path foto resmi lokal yang valid
        const KNOWN_TEACHER_PHOTO_MAP = {
          'USRMVL3A5K7HB02': 'cloud-media/teachers/USRMVL3A5K7HB02.jpg',
          'USRMVL3KPCGXBVZ': 'cloud-media/teachers/USRMVL3KPCGXBVZ.jpg',
          'USRMVLS1SJ33FOG': 'cloud-media/teachers/USRMVLS1SJ33FOG.jpg',
          'USRMVLZ3DDLIH3T': 'cloud-media/teachers/USRMVLZ3DDLIH3T.jpg',
          'USRMVM21Z6SHJZ6': 'cloud-media/teachers/USRMVM21Z6SHJZ6.jpg',
          'USRMVNUMVEGZ2GE': 'cloud-media/teachers/USRMVNUMVEGZ2GE.jpg',
          'USRMVNV3EY0Z0Q3': 'cloud-media/teachers/USRMVNV3EY0Z0Q3.jpg',
          'USRMVNV7HLF8OWP': 'cloud-media/teachers/USRMVNV7HLF8OWP.jpg',
          'USRMVNVCZN3F8R4': 'cloud-media/teachers/USRMVNVCZN3F8R4.jpg',
          'USRMVNVFO9PWZ0V': 'cloud-media/teachers/USRMVNVFO9PWZ0V.jpg',
          'USRMVNVP3CZIRSB': 'cloud-media/teachers/USRMVNVP3CZIRSB.jpg',
          'USRMVNVSCESNYR7': 'cloud-media/teachers/USRMVNVSCESNYR7.jpg',
          'USRMVNVVHPWXA14': 'cloud-media/teachers/USRMVNVVHPWXA14.jpg',
          'USRMVNVYN602X02': 'cloud-media/teachers/USRMVNVYN602X02.jpg',
          'USRMVNW1D0B50GO': 'cloud-media/teachers/USRMVNW1D0B50GO.jpg',
          'USRMVNW49WI05H2': 'cloud-media/teachers/USRMVNW49WI05H2.jpg',
          'USRMVNW8O3OOQO5': 'cloud-media/teachers/USRMVNW8O3OOQO5.jpg',
          'USRMVNWB9YX4NR2': 'cloud-media/teachers/USRMVNWB9YX4NR2.jpg',
          'USRMVNWEUE9L58E': 'cloud-media/teachers/USRMVNWEUE9L58E.jpg',
          'USRMVNWGZ579WL1': 'cloud-media/teachers/USRMVNWGZ579WL1.jpg',
          'USRMVNWJ01WHJYI': 'cloud-media/teachers/USRMVNWJ01WHJYI.jpg',
          'USRMVNWNM4N3REE': 'cloud-media/teachers/USRMVNWNM4N3REE.jpg',
          'USRMVNWPN4BGC91': 'cloud-media/teachers/USRMVNWPN4BGC91.jpg'
        };
        if ((!combined['Foto Profil URL'] || !combined['Foto Profil URL'].trim()) && KNOWN_TEACHER_PHOTO_MAP[uId]) {
          combined['Foto Profil URL'] = KNOWN_TEACHER_PHOTO_MAP[uId];
        }
        if (combined.Username === 'DZULKIFLI' || combined.ID === 'USRMVOW3VFZ8LCZ' || (combined.Role || '').toLowerCase() === 'admin') {
          const savedAdminAlamat = (typeof localStorage !== 'undefined' && localStorage.getItem('portal_admin_address')) || (base && base['Alamat']) || 'Desa Lagadi, Kec. Lawa, Kab. Muna Barat';
          if (!combined['Alamat'] || !String(combined['Alamat']).trim()) {
            combined['Alamat'] = savedAdminAlamat;
          }
          const savedAdminPhoto = (typeof localStorage !== 'undefined' && localStorage.getItem('portal_admin_photo')) || (base && base['Foto Profil URL']) || 'cloud-media/teachers/admin-avatar.jpg';
          if (!combined['Foto Profil URL'] || !String(combined['Foto Profil URL']).trim()) {
            combined['Foto Profil URL'] = savedAdminPhoto;
          }
        }
        if (!combined['Jenis Kelamin'] && base['Jenis Kelamin']) {
          combined['Jenis Kelamin'] = base['Jenis Kelamin'];
        }
        if (!combined['Jenis PTK'] && base['Jenis PTK']) {
          combined['Jenis PTK'] = base['Jenis PTK'];
        }
        if (combined['Foto Profil URL']) {
          combined['Foto Profil URL'] = PortalCloudStorage.hydrateFromVault(combined['Foto Profil URL']);
        }
        combined['Foto'] = combined['Foto Profil URL'] || '';
        combined['fotoProfil'] = combined['Foto Profil URL'] || '';
        combined['foto'] = combined['Foto Profil URL'] || '';
      } else if (tableName === 'Classes') {
        const wali = combined['Nama Wali Kelas'] || combined['Wali Kelas'] || base['Nama Wali Kelas'] || '';
        combined['Nama Wali Kelas'] = wali;
        combined['Wali Kelas'] = wali;
        if (!combined['Jumlah Siswa'] && base['Jumlah Siswa']) {
          combined['Jumlah Siswa'] = base['Jumlah Siswa'];
        }
      } else if (tableName === 'Students') {
        const st = String(combined['Status'] || 'Aktif').toLowerCase();
        combined['Status'] = (st === 'aktif' || st === 'active') ? 'Aktif' : combined['Status'];
        if (!combined['NISN'] && base['NISN']) combined['NISN'] = base['NISN'];
      } else if (tableName === 'Attendance') {
        const absId = combined['ID Absen'] || combined['ID Absensi'] || k;
        combined['ID Absen'] = absId;
        combined['ID Absensi'] = absId;
        combined['ID Guru'] = combined['ID Guru'] || combined['Dicatat Oleh'] || base['ID Guru'] || '';
        combined['NIS Siswa'] = combined['NIS Siswa'] || combined['NIS'] || base['NIS Siswa'] || '';
        combined['NIS'] = combined['NIS'] || combined['NIS Siswa'] || '';
        combined['Jam Absen'] = combined['Jam Absen'] || base['Jam Absen'] || '08:00';
        combined['Diubah Oleh'] = combined['Diubah Oleh'] || combined['Nama Guru'] || '';
      } else if (tableName === 'Subjects') {
        if (!combined['SKS']) combined['SKS'] = base['SKS'] || 2;
      } else if (tableName === 'Announcements') {
        const annId = combined['ID'] || combined['ID Pengumuman'] || k;
        combined['ID'] = annId;
        combined['ID Pengumuman'] = annId;
      } else if (tableName === 'Learnings') {
        if (!combined['PDF URL'] && base['PDF URL']) {
          combined['PDF URL'] = base['PDF URL'];
          combined.pdfUrl = base['PDF URL'];
        }
        if (combined['PDF URL']) {
          combined['PDF URL'] = PortalCloudStorage.hydrateFromVault(combined['PDF URL']);
          combined.pdfUrl = combined['PDF URL'];
        }
      }
      mergedMap.set(k, combined);
    });

    return Array.from(mergedMap.values());
  }

  function _getTableCache(tableName) {
    const storageKey = 'portal_db_table_' + tableName;
    const isOverridden = _isSemesterOverridden(tableName);
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          if (isOverridden) {
            return _normalizeTableRows(tableName, parsed);
          }
          if (parsed.length > 0) {
            const normalized = _normalizeTableRows(tableName, parsed);
            if (normalized.length > 0) return normalized;
          }
        }
      }
    } catch (e) { }
    if (isOverridden) return [];
    const seeded = _normalizeTableRows(tableName, _getDefaultTableRows(tableName));
    if (seeded.length > 0) {
      _setTableCache(tableName, seeded);
    }
    return seeded;
  }

  function _setTableCache(tableName, rows, options = {}) {
    const safeRows = _normalizeTableRows(tableName, Array.isArray(rows) ? rows : [], options);
    try {
      if (options && options.authoritativeRemote) {
        localStorage.setItem('portal_semester_override_' + tableName, 'true');
        localStorage.removeItem('portal_db_deleted_' + tableName);
      }
      localStorage.setItem('portal_db_table_' + tableName, JSON.stringify(safeRows));
      if (tableName === 'Users') {
        localStorage.setItem('portal_users_db_cache', JSON.stringify(safeRows));
        localStorage.setItem('portal_teachers_data', JSON.stringify(safeRows));
      } else if (tableName === 'Classes') {
        localStorage.setItem('portal_classes_data', JSON.stringify(safeRows));
      } else if (tableName === 'Subjects') {
        localStorage.setItem('portal_subjects_data', JSON.stringify(safeRows));
      } else if (tableName === 'Students') {
        localStorage.setItem('portal_students_data', JSON.stringify(safeRows));
      } else if (tableName === 'Exams') {
        localStorage.setItem('portal_exams_data', JSON.stringify(safeRows));
      } else if (tableName === 'Questions') {
        localStorage.setItem('portal_questions_data', JSON.stringify(safeRows));
      } else if (tableName === 'Grades') {
        localStorage.setItem('portal_grades_data', JSON.stringify(safeRows));
      } else if (tableName === 'ExamSessions') {
        localStorage.setItem('portal_exam_sessions_data', JSON.stringify(safeRows));
      } else if (tableName === 'Learnings') {
        localStorage.setItem('portal_learnings_data', JSON.stringify(safeRows));
      } else if (tableName === 'Announcements') {
        localStorage.setItem('portal_announcements_data', JSON.stringify(safeRows));
        localStorage.setItem('portal_announcements', JSON.stringify(safeRows));
      }
    } catch (e) { }
  }

  function _createLocalQueryBuilder(rawClient, tableName) {
    const state = {
      op: 'select',
      selectCols: '*',
      payload: null,
      upsertOpts: null,
      filters: [],
      orders: [],
      limitCount: null,
      wantSingle: false,
      wantMaybeSingle: false
    };

    const applyFilters = (rows) => {
      return rows.filter(row => {
        for (const f of state.filters) {
          if (f.type === 'eq') {
            if (String(row[f.col] ?? '') !== String(f.val ?? '')) return false;
          } else if (f.type === 'neq') {
            if (String(row[f.col] ?? '') === String(f.val ?? '')) return false;
          } else if (f.type === 'ilike') {
            const pattern = String(f.val ?? '').replace(/%/g, '').trim().toLowerCase();
            const cell = String(row[f.col] ?? '').trim().toLowerCase();
            if (String(f.val ?? '').includes('%')) {
              if (!cell.includes(pattern)) return false;
            } else {
              if (cell !== pattern) return false;
            }
          } else if (f.type === 'in') {
            const list = Array.isArray(f.val) ? f.val.map(String) : [];
            if (!list.includes(String(row[f.col] ?? ''))) return false;
          } else if (f.type === 'not') {
            if (f.op === 'in') {
              const rawList = String(f.val ?? '').replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^["']|["']$/g, '').trim());
              if (rawList.includes(String(row[f.col] ?? ''))) return false;
            } else if (f.op === 'eq') {
              if (String(row[f.col] ?? '') === String(f.val ?? '')) return false;
            }
          } else if (f.type === 'or') {
            const clauses = String(f.expr || '').split(',').map(s => s.trim()).filter(Boolean);
            let anyMatch = false;
            for (const c of clauses) {
              const parts = c.split('.');
              if (parts.length >= 3) {
                const col = parts[0];
                const op = parts[1];
                const val = parts.slice(2).join('.').replace(/%/g, '').trim().toLowerCase();
                const cell = String(row[col] ?? '').trim().toLowerCase();
                if (op === 'ilike' && cell === val) { anyMatch = true; break; }
                if (op === 'eq' && cell === val) { anyMatch = true; break; }
              }
            }
            if (!anyMatch) return false;
          }
        }
        return true;
      });
    };

    const executeLocal = () => {
      let rows = _getTableCache(tableName);
      const pk = _getPrimaryKeyCol(tableName);

      if (state.op === 'insert') {
        const toInsert = Array.isArray(state.payload) ? state.payload : [state.payload];
        toInsert.forEach(item => {
          if (!item) return;
          const copy = { ...item };
          const idVal = copy[pk] || copy.ID || copy.id;
          if (idVal !== undefined) {
            _unmarkIdDeleted(tableName, idVal);
            const idx = rows.findIndex(r => String(r[pk] || r.ID || r.id) === String(idVal));
            if (idx !== -1) rows[idx] = { ...rows[idx], ...copy };
            else rows.push(copy);
          } else {
            rows.push(copy);
          }
        });
        _setTableCache(tableName, rows);
        const resData = state.wantSingle || state.wantMaybeSingle ? (toInsert[0] || null) : toInsert;
        return { data: resData, error: null };
      }

      if (state.op === 'upsert') {
        const toUpsert = Array.isArray(state.payload) ? state.payload : [state.payload];
        const conflictCol = (state.upsertOpts && state.upsertOpts.onConflict) || pk;
        toUpsert.forEach(item => {
          if (!item) return;
          const copy = { ...item };
          const keyVal = copy[conflictCol] || copy[pk];
          if (keyVal !== undefined) {
            _unmarkIdDeleted(tableName, keyVal);
            const idx = rows.findIndex(r => String(r[conflictCol] || r[pk]) === String(keyVal));
            if (idx !== -1) {
              rows[idx] = { ...rows[idx], ...copy };
            } else {
              rows.push(copy);
            }
          } else {
            rows.push(copy);
          }
        });
        _setTableCache(tableName, rows);
        const resData = state.wantSingle || state.wantMaybeSingle ? (toUpsert[0] || null) : toUpsert;
        return { data: resData, error: null };
      }

      if (state.op === 'update') {
        const matched = applyFilters(rows);
        const matchedSet = new Set(matched);
        const updatedRows = [];
        rows = rows.map(r => {
          if (matchedSet.has(r)) {
            const merged = { ...r, ...(state.payload || {}) };
            updatedRows.push(merged);
            return merged;
          }
          return r;
        });
        _setTableCache(tableName, rows);
        const resData = state.wantSingle || state.wantMaybeSingle ? (updatedRows[0] || null) : updatedRows;
        return { data: resData, error: null };
      }

      if (state.op === 'delete') {
        const matched = applyFilters(rows);
        const matchedSet = new Set(matched);
        matched.forEach(m => {
          const mId = m[pk] || m['ID Absensi'] || m.ID || m.id;
          if (mId) _markIdDeleted(tableName, mId);
        });
        rows = rows.filter(r => !matchedSet.has(r));
        _setTableCache(tableName, rows);
        return { data: matched, error: null };
      }

      // SELECT
      let result = applyFilters(rows).map(r => PortalCloudStorage.hydrateFromVault({ ...r }));
      if (state.orders.length > 0) {
        result.sort((a, b) => {
          for (const ord of state.orders) {
            const va = a[ord.col] ?? '';
            const vb = b[ord.col] ?? '';
            if (va < vb) return ord.asc ? -1 : 1;
            if (va > vb) return ord.asc ? 1 : -1;
          }
          return 0;
        });
      }
      if (typeof state.limitCount === 'number' && state.limitCount >= 0) {
        result = result.slice(0, state.limitCount);
      }
      if (state.wantSingle) {
        if (result.length === 0) {
          return { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
        }
        return { data: result[0], error: null };
      }
      if (state.wantMaybeSingle) {
        return { data: result[0] || null, error: null };
      }
      return { data: result, error: null };
    };

    const runQuery = async () => {
      // Pastikan seluruh Base64 (Foto, File, Audio, Video) di-offload ke Cloudinary terlebih dahulu
      if (state.op !== 'select' && state.payload) {
        state.payload = await PortalCloudStorage.sanitizeForSupabaseAsync(state.payload, tableName.toLowerCase());
      }

      if (!rawClient || typeof rawClient.from !== 'function' || _isQuotaRestricted()) {
        return executeLocal();
      }
      try {
        let q = rawClient.from(tableName);
        const remotePayload = state.payload;

        if (state.op === 'select') {
          q = q.select(state.selectCols || '*');
        } else if (state.op === 'insert') {
          q = q.insert(remotePayload);
        } else if (state.op === 'update') {
          q = q.update(remotePayload);
        } else if (state.op === 'upsert') {
          q = state.upsertOpts ? q.upsert(remotePayload, state.upsertOpts) : q.upsert(remotePayload);
        } else if (state.op === 'delete') {
          q = q.delete();
        }

        for (const f of state.filters) {
          if (f.type === 'eq') q = q.eq(f.col, f.val);
          else if (f.type === 'neq') q = q.neq(f.col, f.val);
          else if (f.type === 'ilike') q = q.ilike(f.col, f.val);
          else if (f.type === 'in') q = q.in(f.col, f.val);
          else if (f.type === 'not') q = q.not(f.col, f.op, f.val);
          else if (f.type === 'or') q = q.or(f.expr);
        }
        for (const ord of state.orders) {
          q = q.order(ord.col, { ascending: ord.asc });
        }
        if (typeof state.limitCount === 'number') {
          q = q.limit(state.limitCount);
        }
        if (state.wantSingle && typeof q.single === 'function') {
          q = q.single();
        } else if (state.wantMaybeSingle && typeof q.maybeSingle === 'function') {
          q = q.maybeSingle();
        }

        let qTimer = null;
        const queryTimeoutMs = state.op === 'select' ? 1800 : 6000;
        const queryPromise = Promise.resolve(q);
        const timeoutPromise = new Promise((_, reject) => {
          qTimer = setTimeout(() => reject(new Error('Network timeout - fallback to local vault')), queryTimeoutMs);
        });
        let res;
        try {
          res = await Promise.race([queryPromise, timeoutPromise]);
        } finally {
          if (qTimer) clearTimeout(qTimer);
        }
        if (res && res.error) {
          if (_isQuotaOrNetworkError(res.error)) {
            _markQuotaRestricted();
          }
          if (state.op === 'select') {
            return executeLocal();
          }
          return res;
        }

        let isRemoteEmptyAuthoritative = (typeof localStorage !== 'undefined' && localStorage.getItem('portal_semester_cleared_' + tableName) === 'true');
        if (!isRemoteEmptyAuthoritative && typeof localStorage !== 'undefined') {
          try {
            const rawEmpty = localStorage.getItem('portal_db_remote_empty_tables');
            if (rawEmpty) {
              const emptyList = JSON.parse(rawEmpty);
              if (Array.isArray(emptyList) && emptyList.includes(tableName)) {
                isRemoteEmptyAuthoritative = true;
              }
            }
          } catch (e) { }
        }
        const isLocalBackupOnly = (typeof localStorage !== 'undefined' && localStorage.getItem('portal_backup_local_only_' + tableName) === 'true');

        if (state.op === 'select' && isLocalBackupOnly) {
          return executeLocal();
        }

        if (state.op === 'select' && state.filters.length === 0 && (!state.selectCols || state.selectCols === '*') && Array.isArray(res.data)) {
          if (res.data.length > 0 || isRemoteEmptyAuthoritative) {
            _setTableCache(tableName, res.data, { authoritativeRemote: true });
            res.data = _getTableCache(tableName).map(r => PortalCloudStorage.hydrateFromVault({ ...r }));
          } else {
            return executeLocal();
          }
        } else if (state.op === 'select' && Array.isArray(res.data)) {
          if (res.data.length === 0 && !isRemoteEmptyAuthoritative) {
            const localFallback = executeLocal();
            if (localFallback && Array.isArray(localFallback.data) && localFallback.data.length > 0) {
              return localFallback;
            }
          }
          res.data = PortalCloudStorage.hydrateFromVault(res.data);
        } else if (state.op !== 'select') {
          executeLocal();
        } else if (res && res.data) {
          res.data = PortalCloudStorage.hydrateFromVault(res.data);
        }
        return res;
      } catch (err) {
        if (_isQuotaOrNetworkError(err)) {
          _markQuotaRestricted();
          return executeLocal();
        }
        return executeLocal();
      }
    };

    const builder = {
      select(cols = '*') {
        if (state.op === ' select' || state.op === 'select') {
          state.op = 'select';
          state.selectCols = cols;
        }
        return builder;
      },
      insert(payload) {
        state.op = 'insert';
        state.payload = payload;
        return builder;
      },
      update(payload) {
        state.op = 'update';
        state.payload = payload;
        return builder;
      },
      upsert(payload, opts) {
        state.op = 'upsert';
        state.payload = payload;
        state.upsertOpts = opts;
        return builder;
      },
      delete() {
        state.op = 'delete';
        return builder;
      },
      eq(col, val) {
        state.filters.push({ type: 'eq', col, val });
        return builder;
      },
      neq(col, val) {
        state.filters.push({ type: 'neq', col, val });
        return builder;
      },
      ilike(col, val) {
        state.filters.push({ type: 'ilike', col, val });
        return builder;
      },
      in(col, val) {
        state.filters.push({ type: 'in', col, val });
        return builder;
      },
      not(col, op, val) {
        state.filters.push({ type: 'not', col, op, val });
        return builder;
      },
      or(expr) {
        state.filters.push({ type: 'or', expr });
        return builder;
      },
      order(col, opts = {}) {
        state.orders.push({ col, asc: opts.ascending !== false });
        return builder;
      },
      limit(n) {
        state.limitCount = n;
        return builder;
      },
      single() {
        state.wantSingle = true;
        return builder;
      },
      maybeSingle() {
        state.wantMaybeSingle = true;
        return builder;
      },
      then(onFulfilled, onRejected) {
        return runQuery().then(onFulfilled, onRejected);
      },
      catch(onRejected) {
        return runQuery().catch(onRejected);
      }
    };

    return builder;
  }

  function _wrapSupabaseClient(rawClient) {
    if (!rawClient || rawClient.__isPortalSmartClient) return rawClient;
    return new Proxy(rawClient, {
      get(target, prop) {
        if (prop === '__isPortalSmartClient') return true;
        if (prop === '__rawClient') return target;
        if (prop === 'from') {
          return function (tableName) {
            return _createLocalQueryBuilder(target, tableName);
          };
        }
        const val = target[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      }
    });
  }

  let _origCreateClientFn = null;
  try {
    if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function' && !window.supabase.__portalWrapped) {
      const origSbObj = window.supabase;
      _origCreateClientFn = origSbObj.createClient.bind(origSbObj);
      const wrappedCreateClient = function (...args) {
        const client = _origCreateClientFn(...args);
        return _wrapSupabaseClient(client);
      };
      window.supabase = new Proxy(origSbObj, {
        get(target, prop) {
          if (prop === '__portalWrapped') return true;
          if (prop === 'createClient') return wrappedCreateClient;
          const val = target[prop];
          return typeof val === 'function' ? val.bind(target) : val;
        }
      });
    }
  } catch (eWrap) {
    console.warn('[Supabase Bridge] Note wrapping window.supabase:', eWrap);
  }

  function _createRawClientWithKey(url, key) {
    if (!url || !key) return null;
    try {
      if (_origCreateClientFn) {
        return _origCreateClientFn(url, key);
      } else if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
        const created = window.supabase.createClient(url, key);
        return created.__rawClient || created;
      }
    } catch (e) { }
    return null;
  }

  function getClient() {
    const sbCfg = _getActiveSbConfig();
    const fp = `${sbCfg.SUPABASE_URL}::${sbCfg.SUPABASE_ANON_KEY || sbCfg.SUPABASE_SECRET_KEY}`;
    if (!smartSupabaseClient || _activeClientFingerprint !== fp) {
      _activeClientFingerprint = fp;
      const effectiveKey = sbCfg.SUPABASE_ANON_KEY || sbCfg.SUPABASE_SECRET_KEY;
      rawSupabaseClient = _createRawClientWithKey(sbCfg.SUPABASE_URL, effectiveKey);
      if (rawSupabaseClient) {
        smartSupabaseClient = _wrapSupabaseClient(rawSupabaseClient);
      } else {
        smartSupabaseClient = _wrapSupabaseClient({});
      }
    }
    return smartSupabaseClient;
  }

  window.resetPortalSupabaseClient = function (newUrl, newKey, newSecretKey) {
    const cleanUrl = String(newUrl || '').trim();
    const cleanKey = String(newKey || newSecretKey || '').trim();
    const cleanSecret = String(newSecretKey || newKey || '').trim();
    if (window.PORTAL_CONFIG && typeof window.PORTAL_CONFIG.saveSupabaseConfig === 'function') {
      window.PORTAL_CONFIG.saveSupabaseConfig({
        SUPABASE_URL: cleanUrl,
        SUPABASE_ANON_KEY: cleanKey,
        SUPABASE_SECRET_KEY: cleanSecret
      });
    } else if (window.PORTAL_CONFIG) {
      if (cleanUrl) window.PORTAL_CONFIG.SUPABASE_URL = cleanUrl;
      if (cleanKey) window.PORTAL_CONFIG.SUPABASE_ANON_KEY = cleanKey;
      if (cleanSecret) window.PORTAL_CONFIG.SUPABASE_SECRET_KEY = cleanSecret;
    }
    rawSupabaseClient = null;
    smartSupabaseClient = null;
    _activeClientFingerprint = '';
    _clearQuotaRestricted();
    return getClient();
  };

  // Fallback otomatis path cloud-media/ pada elemen <img> apabila dibuka dari subdirektori /portal-guru-siswa/
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('error', function (e) {
      const t = e && e.target;
      if (t && t.tagName === 'IMG') {
        const rawSrc = t.getAttribute('src') || '';
        if (rawSrc.startsWith('cloud-media/') && window.location.pathname.includes('/portal-guru-siswa')) {
          t.src = '../' + rawSrc;
        } else if (rawSrc.startsWith('../cloud-media/') && !window.location.pathname.includes('/portal-guru-siswa')) {
          t.src = rawSrc.slice(3);
        }
      }
    }, true);
  }

  // Helper Hashing & ID Generator
  async function hashPassword(str) {
    const salted = (str || '') + 'SALT_PORTAL_SEKOLAH_2024';
    const msgBuffer = new TextEncoder().encode(salted);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function generateId(prefix) {
    return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();
  }

  function getDayName(dateStr) {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const d = new Date(dateStr);
    return isNaN(d.getDay()) ? '' : days[d.getDay()];
  }

  // Bersihkan seluruh sisa akun & data dummy di localStorage serta sinkronkan 100% data asli Supabase SMAN 12 Muna Barat
  (function purgeLegacyDummyData() {
    try {
      if (typeof localStorage === 'undefined') return;

      const SNAPSHOT_VERSION = '2026-11-20-v10';
      const currentVer = localStorage.getItem('portal_snapshot_version');

      // 1. Hapus sesi login apabila yang tersimpan adalah akun dummy
      ['portal_current_user', 'smandum_active_user'].forEach(sessionKey => {
        const rawUser = localStorage.getItem(sessionKey);
        if (rawUser) {
          try {
            const parsedU = JSON.parse(rawUser);
            if (isDummyUserRecord(parsedU)) {
              localStorage.removeItem(sessionKey);
            }
          } catch (e) { }
        }
      });

      const allTables = ['Users', 'Classes', 'Subjects', 'Students', 'Exams', 'Questions', 'Grades', 'ExamSessions', 'Violations', 'Attendance', 'Learnings', 'Announcements', 'Settings'];

      // 2. Jika versi snapshot belum v10, segarkan seluruh cache tabel lokal dari snapshot Supabase penuh (db_cluster-11-11-2026@04-11-42.backup)
      if (currentVer !== SNAPSHOT_VERSION) {
        allTables.forEach(tbl => {
          localStorage.removeItem('portal_db_table_' + tbl);
          localStorage.removeItem('portal_semester_override_' + tbl);
          localStorage.removeItem('portal_semester_cleared_' + tbl);
          localStorage.removeItem('portal_backup_local_only_' + tbl);
          localStorage.removeItem('portal_db_deleted_' + tbl);
          const defaults = _getDefaultTableRows(tbl);
          _setTableCache(tbl, defaults);
        });

        localStorage.setItem('portal_guru_extra_metadata', JSON.stringify(REAL_SCHOOL_SNAPSHOT.GuruExtraMetadata || {}));
        localStorage.setItem('portal_gallery_images', JSON.stringify(REAL_SCHOOL_SNAPSHOT.GalleryImages || []));
        localStorage.setItem('portal_learnings_data', JSON.stringify(REAL_SCHOOL_SNAPSHOT.Learnings || []));
        localStorage.setItem('portal_learning_discussions_data', JSON.stringify(REAL_SCHOOL_SNAPSHOT.Discussions || []));
        localStorage.setItem('portal_learning_attendees_data', JSON.stringify(REAL_SCHOOL_SNAPSHOT.Attendees || []));

        const fullSettings = {
          ...REAL_SCHOOL_SNAPSHOT.SettingsMap,
          gallery_images: JSON.stringify(REAL_SCHOOL_SNAPSHOT.GalleryImages || [])
        };
        localStorage.setItem('portal_settings_cache', JSON.stringify(fullSettings));
        localStorage.setItem('portal_app_settings', JSON.stringify(fullSettings));
        localStorage.setItem('portal_school_background_url', REAL_SCHOOL_SNAPSHOT.SettingsMap.school_background_url || '');
        localStorage.setItem('portal_principal_photo', REAL_SCHOOL_SNAPSHOT.SettingsMap.principal_photo || '');
        localStorage.removeItem('portal_landing_teachers_cache');
        localStorage.setItem('portal_snapshot_version', SNAPSHOT_VERSION);
      } else {
        // Pastikan seluruh tabel inti SMAN 12 Muna Barat tetap ter-seed dan ternormalisasi
        allTables.forEach(tbl => {
          const rows = _getTableCache(tbl);
          _setTableCache(tbl, rows);
        });
        if (!localStorage.getItem('portal_guru_extra_metadata')) {
          localStorage.setItem('portal_guru_extra_metadata', JSON.stringify(REAL_SCHOOL_SNAPSHOT.GuruExtraMetadata || {}));
        }
        if (!localStorage.getItem('portal_gallery_images')) {
          localStorage.setItem('portal_gallery_images', JSON.stringify(REAL_SCHOOL_SNAPSHOT.GalleryImages || []));
        }
        if (!localStorage.getItem('portal_learnings_data')) {
          localStorage.setItem('portal_learnings_data', JSON.stringify(REAL_SCHOOL_SNAPSHOT.Learnings || []));
        }
        if (!localStorage.getItem('portal_learning_discussions_data')) {
          localStorage.setItem('portal_learning_discussions_data', JSON.stringify(REAL_SCHOOL_SNAPSHOT.Discussions || []));
        }
        if (!localStorage.getItem('portal_learning_attendees_data')) {
          localStorage.setItem('portal_learning_attendees_data', JSON.stringify(REAL_SCHOOL_SNAPSHOT.Attendees || []));
        }
      }

      // 3. Bersihkan pendaftar SPMB dummy
      const isDummySpmb = (s) => {
        if (!s) return true;
        const nisn = String(s.nisn || '').trim();
        const nama = String(s.namaLengkap || '').trim().toUpperCase();
        const sekolah = String(s.asalSekolah || '').trim().toUpperCase();
        return (
          nisn === '0089123456' ||
          nisn === '9080706050' ||
          nama === 'BUDI SANTOSOS' ||
          sekolah.includes('CONTOH')
        );
      };
      const spmbCache = localStorage.getItem('portal_spmb_registrations');
      if (spmbCache) {
        try {
          const parsedS = JSON.parse(spmbCache);
          if (Array.isArray(parsedS)) {
            const cleanedS = parsedS.filter(s => !isDummySpmb(s));
            if (cleanedS.length > 0) {
              localStorage.setItem('portal_spmb_registrations', JSON.stringify(cleanedS));
            } else {
              localStorage.removeItem('portal_spmb_registrations');
            }
          }
        } catch (e) { }
      }
    } catch (e) { }
  })();

  // 2. Kumpulan Seluruh Handler Backend (Pengganti Code.gs)
  const Handlers = {
    // --- GENERIC GET ALL DATA ---
    async getAllData(tableName) {
      const sb = getClient();
      if (!sb) return _getTableCache(tableName);
      const { data, error } = await sb.from(tableName).select('*');
      if (error) {
        console.warn(`[getAllData] Menggunakan data lokal untuk ${tableName}:`, error.message || error);
        return _getTableCache(tableName);
      }
      return data || [];
    },

    // --- AUTHENTICATION & USERS ---
    async login(username, password) {
      return this.loginUser(username, password);
    },

    async loginUser(username, password) {
      const cleanUser = String(username || '').trim();
      const cleanPass = String(password || '');
      if (!cleanUser || !cleanPass) {
        return { success: false, message: 'Username dan password wajib diisi.' };
      }

      // Tolak akun dummy yang sudah dihapus
      if (DUMMY_USERNAMES.has(cleanUser.toLowerCase())) {
        return {
          success: false,
          message: 'Akun dummy telah dihapus. Silakan login menggunakan akun resmi SMAN 12 Muna Barat (misalnya: DZULKIFLI).'
        };
      }

      const hashed = await hashPassword(cleanPass);

      const normalizeUserRecord = (u) => {
        const rawRole = String(u['Role'] || u.role || '').trim().toLowerCase();
        const uname = String(u['Username'] || u.username || '').trim();
        const isAdminRole = rawRole === 'admin' || rawRole === 'administrator' || uname.toUpperCase() === 'DZULKIFLI';
        return {
          id: u['ID'] || u.id || '',
          username: uname,
          namaLengkap: u['Nama Lengkap'] || u.namaLengkap || uname,
          email: u['Email'] || u.email || '',
          role: isAdminRole ? 'admin' : (rawRole || 'guru'),
          fotoProfil: u['Foto Profil URL'] || u.fotoProfil || (isAdminRole ? ((typeof localStorage !== 'undefined' && localStorage.getItem('portal_admin_photo')) || REAL_SCHOOL_SNAPSHOT.SettingsMap.admin_photo || 'cloud-media/teachers/admin-avatar.jpg') : ''),
          nip: u['NIP'] || u.nip || '',
          telepon: u['Telepon'] || u.telepon || '',
          alamat: u['Alamat'] || u.alamat || (isAdminRole ? ((typeof localStorage !== 'undefined' && localStorage.getItem('portal_admin_address')) || REAL_SCHOOL_SNAPSHOT.SettingsMap.admin_address || 'Desa Lagadi, Kec. Lawa, Kab. Muna Barat') : '')
        };
      };

      const isUserActive = (u) => {
        if (isDummyUserRecord(u)) return false;
        const st = String(u['Status'] ?? u.status ?? 'active').trim().toLowerCase();
        return !['inactive', 'nonaktif', 'disabled', 'blocked', 'rejected', 'pending'].includes(st);
      };

      const isPasswordMatch = async (u) => {
        const storedPass = String(u['Password'] ?? u.password ?? '');
        if (storedPass && (storedPass === cleanPass || storedPass.trim() === cleanPass.trim() || storedPass === hashed)) {
          return true;
        }
        // Jika akun asli dari snapshot SMAN 12 Muna Barat masih menggunakan password default ('123456' atau kosong) dan belum disetel khusus,
        // terima password pengguna dan simpan ke tabel lokal agar muncul sesuai di kolom Password Daftar Guru
        if ((!storedPass || storedPass === '123456') && !u._passwordCustomSet) {
          u['Password'] = cleanPass;
          u._passwordCustomSet = true;
          try {
            const allCached = _getTableCache('Users');
            const idx = allCached.findIndex(item => (item.ID || item.id) === (u.ID || u.id));
            if (idx !== -1) {
              allCached[idx]['Password'] = cleanPass;
              allCached[idx]._passwordCustomSet = true;
              _setTableCache('Users', allCached);
            }
          } catch (e) { }
          return true;
        }
        try {
          const rawBuf = new TextEncoder().encode(cleanPass);
          const rawHashBuf = await crypto.subtle.digest('SHA-256', rawBuf);
          const rawHex = Array.from(new Uint8Array(rawHashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
          if (storedPass.toLowerCase() === rawHex.toLowerCase()) return true;
        } catch (e) { }
        return false;
      };

      const matchUserInList = (list) => {
        if (!Array.isArray(list)) return [];
        const qLower = cleanUser.toLowerCase();
        return list.filter(u => {
          if (!u || isDummyUserRecord(u)) return false;
          const uname = String(u['Username'] || u.username || '').trim().toLowerCase();
          const fullName = String(u['Nama Lengkap'] || u.namaLengkap || '').trim().toLowerCase();
          const nip = String(u['NIP'] || u.nip || '').trim().toLowerCase();
          return uname === qLower || fullName === qLower || (nip && nip === qLower);
        });
      };

      try {
        const sb = getClient();
        let matchedUsers = [];

        if (sb) {
          const { data: allUsers, error: allErr } = await sb.from('Users').select('*');
          if (!allErr && Array.isArray(allUsers) && allUsers.length > 0) {
            const cleanAll = allUsers.filter(u => !isDummyUserRecord(u));
            _setTableCache('Users', cleanAll);
            matchedUsers = matchUserInList(cleanAll);
          }
        }

        if (!matchedUsers || matchedUsers.length === 0) {
          const cachedUsers = _getTableCache('Users');
          matchedUsers = matchUserInList(cachedUsers);
        }

        if (!matchedUsers || matchedUsers.length === 0) {
          return { success: false, message: 'Username atau NIP tidak ditemukan di database SMAN 12 Muna Barat.' };
        }

        const activeUsers = matchedUsers.filter(isUserActive);
        if (activeUsers.length === 0) {
          return { success: false, message: 'Akun ditemukan tetapi statusnya belum aktif.' };
        }

        for (const u of activeUsers) {
          if (await isPasswordMatch(u)) {
            return {
              success: true,
              user: normalizeUserRecord(u)
            };
          }
        }

        return { success: false, message: 'Password yang Anda masukkan salah!' };
      } catch (e) {
        console.warn('[loginUser] Beralih ke sinkronisasi database lokal:', e);
        const cachedUsers = _getTableCache('Users');
        const matchedCached = matchUserInList(cachedUsers).filter(isUserActive);
        for (const u of matchedCached) {
          if (await isPasswordMatch(u)) {
            return {
              success: true,
              user: normalizeUserRecord(u)
            };
          }
        }
        if (matchedCached.length > 0) {
          return { success: false, message: 'Password yang Anda masukkan salah!' };
        }
        return { success: false, message: 'Username atau NIP tidak ditemukan di database SMAN 12 Muna Barat.' };
      }
    },

    async verifyAdminPassword(password, preferredAdminId) {
      const cleanPass = String(password || '');
      if (!cleanPass) {
        return { success: false, message: 'Password Admin wajib diisi!' };
      }
      try {
        const hashed = await hashPassword(cleanPass);
        let rawHex = '';
        try {
          const rawBuf = new TextEncoder().encode(cleanPass);
          const rawHashBuf = await crypto.subtle.digest('SHA-256', rawBuf);
          rawHex = Array.from(new Uint8Array(rawHashBuf)).map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase();
        } catch (e) { }

        const checkMatch = (u) => {
          if (!u || typeof u !== 'object') return false;
          const storedPass = String(u['Password'] ?? u.password ?? '');
          if (!storedPass) return false;
          return (
            storedPass === cleanPass ||
            storedPass.trim() === cleanPass.trim() ||
            storedPass === hashed ||
            (rawHex && storedPass.toLowerCase() === rawHex)
          );
        };

        let users = _getTableCache('Users');
        const sb = getClient();
        if (sb && !_isQuotaRestricted()) {
          try {
            const { data, error } = await sb.from('Users').select('*');
            if (!error && Array.isArray(data) && data.length > 0) {
              users = data;
            }
          } catch (e) { }
        }

        const adminUsers = (users || []).filter(u => {
          const r = String(u['Role'] || u.role || '').trim().toLowerCase();
          const uname = String(u['Username'] || u.username || '').trim().toUpperCase();
          return r === 'admin' || r === 'administrator' || uname === 'DZULKIFLI' || uname === 'ADMIN';
        });

        if (preferredAdminId) {
          const target = adminUsers.find(u => String(u['ID'] || u.id || '') === String(preferredAdminId));
          if (target && checkMatch(target)) {
            return { success: true, verifiedBy: target['Nama Lengkap'] || target['Username'] || 'Admin' };
          }
        }

        for (const adm of adminUsers) {
          if (checkMatch(adm)) {
            return { success: true, verifiedBy: adm['Nama Lengkap'] || adm['Username'] || 'Admin' };
          }
        }

        return { success: false, message: 'Password Admin tidak sesuai! Tindakan ganti data dibatalkan.' };
      } catch (e) {
        return { success: false, message: e.message || 'Gagal memverifikasi password Admin.' };
      }
    },

    async registerGuru(userData) {
      try {
        const sb = getClient();
        const checkU = await sb.from('Users').select('ID').eq('Username', userData.username);
        if (checkU.data && checkU.data.length > 0) return { success: false, message: 'Username sudah digunakan.' };

        const checkP = await sb.from('PendingUsers').select('ID').eq('Username', userData.username);
        if (checkP.data && checkP.data.length > 0) return { success: false, message: 'Username sudah terdaftar, menunggu persetujuan.' };

        const newId = generateId('PND');
        const now = new Date().toISOString();
        const { error } = await sb.from('PendingUsers').insert([{
          'ID': newId,
          'Username': userData.username,
          'Password': userData.password,
          'Nama Lengkap': userData.namaLengkap,
          'Email': userData.email,
          'NIP': userData.nip || '',
          'Telepon': userData.telepon || '',
          'Alamat': userData.alamat || '',
          'Status': 'pending',
          'Tanggal Daftar': now,
          'Catatan': ''
        }]);
        if (error) throw error;
        return { success: true, message: 'Pendaftaran berhasil! Menunggu persetujuan admin.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async getPendingUsers() {
      try {
        const sb = getClient();
        if (!sb) return { success: false, message: 'Supabase client belum siap.', data: [] };
        const { data, error } = await sb.from('PendingUsers').select('*').order('Tanggal Daftar', { ascending: false });
        if (error) throw error;
        return { success: true, data: data || [] };
      } catch (e) {
        console.error('[getPendingUsers error]:', e);
        return { success: false, message: e.message || 'Gagal memuat data pendaftaran.', data: [] };
      }
    },

    async approveUser(pendingId) {
      try {
        const sb = getClient();
        if (!sb) return { success: false, message: 'Supabase client belum siap.' };
        const { data: pList, error: pErr } = await sb.from('PendingUsers').select('*').eq('ID', pendingId);
        if (pErr) throw pErr;
        if (!pList || pList.length === 0) return { success: false, message: 'Data pendaftaran tidak ditemukan.' };
        const p = pList[0];

        const newUserId = generateId('USR');
        const now = new Date().toISOString();

        const { error: insErr } = await sb.from('Users').insert([{
          'ID': newUserId,
          'Username': p['Username'],
          'Password': p['Password'],
          'Nama Lengkap': p['Nama Lengkap'],
          'Email': p['Email'],
          'Role': 'guru',
          'Status': 'active',
          'Foto Profil URL': '',
          'Tanggal Daftar': p['Tanggal Daftar'] || now,
          'Tanggal Approve': now,
          'NIP': p['NIP'] || '',
          'Telepon': p['Telepon'] || '',
          'Alamat': p['Alamat'] || ''
        }]);
        if (insErr) throw insErr;

        await sb.from('PendingUsers').delete().eq('ID', pendingId);
        return { success: true, message: 'Guru berhasil disetujui.' };
      } catch (e) {
        console.error('[approveUser error]:', e);
        return { success: false, message: e.message };
      }
    },

    async rejectUser(pendingId) {
      try {
        const sb = getClient();
        if (!sb) return { success: false, message: 'Supabase client belum siap.' };
        const { error } = await sb.from('PendingUsers').delete().eq('ID', pendingId);
        if (error) throw error;
        return { success: true, message: 'Pendaftaran ditolak.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async deletePendingUser(id) {
      return await this.rejectUser(id);
    },

    async _loadGuruMeta() {
      let metaMap = {};
      try {
        if (typeof localStorage !== 'undefined') {
          const local = localStorage.getItem('portal_guru_extra_metadata');
          if (local) metaMap = JSON.parse(local) || {};
        }
      } catch (e) { }

      const sb = getClient();
      if (sb) {
        try {
          const { data, error } = await sb.from('Settings').select('Value').eq('Key', 'guru_extra_metadata').maybeSingle();
          if (!error && data && data.Value) {
            const parsed = JSON.parse(data.Value);
            if (parsed && typeof parsed === 'object') {
              metaMap = Object.assign({}, metaMap, parsed);
              try {
                if (typeof localStorage !== 'undefined') {
                  localStorage.setItem('portal_guru_extra_metadata', JSON.stringify(metaMap));
                }
              } catch (e) { }
            }
          }
        } catch (e) { }
      }
      return metaMap;
    },

    async _saveGuruMeta(userId, newMeta) {
      if (!userId) return;
      try {
        const metaMap = await this._loadGuruMeta();
        metaMap[userId] = Object.assign({}, metaMap[userId] || {}, newMeta);
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('portal_guru_extra_metadata', JSON.stringify(metaMap));
          }
        } catch (e) { }
        const sb = getClient();
        if (sb) {
          await sb.from('Settings').upsert([{
            'Key': 'guru_extra_metadata',
            'Value': JSON.stringify(metaMap),
            'Label': 'Metadata Guru',
            'Keterangan': 'Jenis Kelamin & Jenis PTK Guru',
            'Diupdate': new Date().toISOString()
          }], { onConflict: 'Key' });
        }
      } catch (e) {
        console.warn('Gagal sinkron guru_extra_metadata:', e);
      }
    },

    async getUsers() {
      try {
        const sb = getClient();
        let data = [];
        if (sb) {
          const res = await sb.from('Users').select('*').order('Nama Lengkap', { ascending: true });
          if (!res.error && Array.isArray(res.data) && res.data.length > 0) {
            data = res.data;
          }
        }
        if (!data || data.length === 0) {
          data = _getTableCache('Users');
        }
        const cleanData = (data || []).filter(u => !isDummyUserRecord(u));
        _setTableCache('Users', cleanData);
        const metaMap = await this._loadGuruMeta();
        const filtered = cleanData.filter(u => (u.Role || '').toLowerCase() !== 'admin').map(u => {
          const meta = metaMap[u.ID] || metaMap[u.Username] || {};
          const fotoUrl = u['Foto Profil URL'] || u.fotoProfil || u.Foto || u.foto || '';
          const fullObj = Object.assign({}, u, {
            id: u.ID,
            ID: u.ID,
            username: u.Username,
            Username: u.Username,
            namaLengkap: u['Nama Lengkap'] || u.Username,
            'Nama Lengkap': u['Nama Lengkap'] || u.Username,
            role: (u.Role || 'guru').toLowerCase(),
            Role: u.Role || 'guru',
            nip: u.NIP || '',
            NIP: u.NIP || '',
            telepon: u.Telepon || '',
            Telepon: u.Telepon || '',
            email: u.Email || '',
            Email: u.Email || '',
            alamat: u.Alamat || '',
            Alamat: u.Alamat || '',
            fotoProfil: fotoUrl,
            foto: fotoUrl,
            'Foto Profil URL': fotoUrl,
            'Foto': fotoUrl,
            'Jenis Kelamin': u['Jenis Kelamin'] || meta['Jenis Kelamin'] || '',
            'Jenis PTK': u['Jenis PTK'] || meta['Jenis PTK'] || 'Pendidik'
          });
          return fullObj;
        });
        return { success: true, data: filtered };
      } catch (e) {
        console.warn('[getUsers fallback]:', e);
        const fallback = _getTableCache('Users').filter(u => !isDummyUserRecord(u) && (u.Role || '').toLowerCase() !== 'admin');
        return { success: true, data: fallback };
      }
    },

    async getAllUsers() {
      try {
        const sb = getClient();
        let data = [];
        if (sb) {
          const res = await sb.from('Users').select('*');
          if (!res.error && Array.isArray(res.data) && res.data.length > 0) {
            data = res.data;
          }
        }
        if (!data || data.length === 0) {
          data = _getTableCache('Users');
        }
        const cleanData = (data || []).filter(u => !isDummyUserRecord(u));
        _setTableCache('Users', cleanData);
        const metaMap = await this._loadGuruMeta();
        const merged = cleanData.map(u => {
          const meta = metaMap[u.ID] || metaMap[u.Username] || {};
          const fotoUrl = u['Foto Profil URL'] || u.fotoProfil || u.Foto || u.foto || '';
          return Object.assign({}, u, {
            id: u.ID,
            ID: u.ID,
            username: u.Username,
            Username: u.Username,
            namaLengkap: u['Nama Lengkap'] || u.Username,
            'Nama Lengkap': u['Nama Lengkap'] || u.Username,
            role: (u.Role || 'guru').toLowerCase(),
            Role: u.Role || 'guru',
            nip: u.NIP || '',
            NIP: u.NIP || '',
            telepon: u.Telepon || '',
            Telepon: u.Telepon || '',
            email: u.Email || '',
            Email: u.Email || '',
            alamat: u.Alamat || '',
            Alamat: u.Alamat || '',
            fotoProfil: fotoUrl,
            foto: fotoUrl,
            'Foto Profil URL': fotoUrl,
            'Foto': fotoUrl,
            'Jenis Kelamin': u['Jenis Kelamin'] || meta['Jenis Kelamin'] || '',
            'Jenis PTK': u['Jenis PTK'] || meta['Jenis PTK'] || 'Pendidik'
          });
        });
        return { success: true, data: merged };
      } catch (e) {
        console.warn('[getAllUsers fallback]:', e);
        const fallback = _getTableCache('Users').filter(u => !isDummyUserRecord(u));
        return { success: true, data: fallback };
      }
    },

    async getUserById(userId) {
      try {
        const sb = getClient();
        if (!sb) return { success: false, message: 'Supabase client belum siap.' };
        const { data, error } = await sb.from('Users').select('*').eq('ID', userId);
        if (error) throw error;
        if (data && data.length > 0) {
          const u = data[0];
          const metaMap = await this._loadGuruMeta();
          const meta = metaMap[u.ID] || metaMap[u.Username] || {};
          const result = Object.assign({}, u, {
            'Jenis Kelamin': u['Jenis Kelamin'] || meta['Jenis Kelamin'] || '',
            'Jenis PTK': u['Jenis PTK'] || meta['Jenis PTK'] || 'Pendidik'
          });
          return { success: true, data: result, user: result };
        }
        return { success: false, message: 'User tidak ditemukan.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async adminCreateUser(data) {
      try {
        const sb = getClient();
        if (!sb) return { success: false, message: 'Supabase client belum siap.' };

        const { data: existing } = await sb.from('Users').select('ID').eq('Username', data.username);
        if (existing && existing.length > 0) {
          return { success: false, message: 'Username sudah digunakan oleh akun lain.' };
        }

        const newId = generateId('USR');
        const now = new Date().toISOString();
        const jk = data.jenisKelamin || data['Jenis Kelamin'] || '';
        const ptk = data.jenisPtk || data['Jenis PTK'] || 'Pendidik';

        const row = {
          'ID': newId,
          'Username': data.username,
          'Password': data.password,
          'Nama Lengkap': data.namaLengkap,
          'Email': data.email || '',
          'Role': data.role || 'guru',
          'Status': data.status || 'active',
          'Foto Profil URL': data.fotoProfilUrl || data.fotoProfil || data.foto || '',
          'Tanggal Daftar': now,
          'Tanggal Approve': now,
          'NIP': data.nip || '',
          'Telepon': data.telepon || '',
          'Alamat': data.alamat || ''
        };

        const fullRow = Object.assign({}, row, {
          'Jenis Kelamin': jk,
          'Jenis PTK': ptk
        });

        let insertError = null;
        try {
          const { error } = await sb.from('Users').insert([fullRow]);
          if (error) insertError = error;
        } catch (e) {
          insertError = e;
        }

        if (insertError) {
          const errMsg = String(insertError.message || insertError.details || '');
          if (errMsg.includes('Jenis Kelamin') || errMsg.includes('Jenis PTK') || errMsg.includes('schema cache') || errMsg.includes('PGRST204') || insertError.code === 'PGRST204') {
            const { error: retryError } = await sb.from('Users').insert([row]);
            if (retryError) throw retryError;
          } else {
            throw insertError;
          }
        }

        if (jk || ptk) {
          await this._saveGuruMeta(newId, {
            'Jenis Kelamin': jk,
            'Jenis PTK': ptk
          });
          if (data.username) {
            await this._saveGuruMeta(data.username, {
              'Jenis Kelamin': jk,
              'Jenis PTK': ptk
            });
          }
        }

        return { success: true, message: 'Guru berhasil ditambahkan.' };
      } catch (e) {
        console.error('[adminCreateUser error]:', e);
        return { success: false, message: e.message || 'Gagal menambahkan guru.' };
      }
    },

    async adminUpdateUser(userId, updateData) {
      try {
        const sb = getClient();
        if (!sb) return { success: false, message: 'Supabase client belum siap.' };

        const updateFields = {};
        if (updateData.namaLengkap !== undefined) updateFields['Nama Lengkap'] = updateData.namaLengkap;
        if (updateData.username !== undefined) updateFields['Username'] = updateData.username;
        if (updateData.email !== undefined) updateFields['Email'] = updateData.email;
        if (updateData.role !== undefined) updateFields['Role'] = updateData.role;
        if (updateData.status !== undefined) updateFields['Status'] = updateData.status;
        if (updateData.nip !== undefined) updateFields['NIP'] = updateData.nip;
        if (updateData.telepon !== undefined) updateFields['Telepon'] = updateData.telepon;
        if (updateData.alamat !== undefined) updateFields['Alamat'] = updateData.alamat;
        if (updateData.fotoProfilUrl !== undefined) updateFields['Foto Profil URL'] = updateData.fotoProfilUrl;
        else if (updateData.fotoProfil !== undefined) updateFields['Foto Profil URL'] = updateData.fotoProfil;
        else if (updateData.foto !== undefined) updateFields['Foto Profil URL'] = updateData.foto;
        else if (updateData['Foto Profil URL'] !== undefined) updateFields['Foto Profil URL'] = updateData['Foto Profil URL'];
        if (updateData.password) updateFields['Password'] = updateData.password;
        if (updateData.newPassword) updateFields['Password'] = updateData.newPassword;

        if (updateData.alamat && (userId === 'USRMVOW3VFZ8LCZ' || updateData.username === 'DZULKIFLI' || updateData.role === 'admin')) {
          try {
            localStorage.setItem('portal_admin_address', updateData.alamat);
            REAL_SCHOOL_SNAPSHOT.SettingsMap.admin_address = updateData.alamat;
          } catch (e) { }
        }
        if ((updateData.fotoProfilUrl || updateData.fotoProfil) && (userId === 'USRMVOW3VFZ8LCZ' || updateData.username === 'DZULKIFLI' || updateData.role === 'admin')) {
          try {
            const photoVal = updateData.fotoProfilUrl || updateData.fotoProfil;
            localStorage.setItem('portal_admin_photo', photoVal);
            REAL_SCHOOL_SNAPSHOT.SettingsMap.admin_photo = photoVal;
          } catch (e) { }
        }

        // Extra metadata (Jenis Kelamin & Jenis PTK)
        const extraMeta = {};
        const jk = updateData.jenisKelamin !== undefined ? updateData.jenisKelamin : updateData['Jenis Kelamin'];
        if (jk !== undefined) extraMeta['Jenis Kelamin'] = jk;
        const ptk = updateData.jenisPtk !== undefined ? updateData.jenisPtk : updateData['Jenis PTK'];
        if (ptk !== undefined) extraMeta['Jenis PTK'] = ptk;

        // Coba simpan langsung ke tabel Users dengan extra fields (jika kolom sudah ada di Supabase)
        const fullFields = Object.assign({}, updateFields);
        if (jk !== undefined) fullFields['Jenis Kelamin'] = jk;
        if (ptk !== undefined) fullFields['Jenis PTK'] = ptk;

        let updateError = null;
        try {
          const { error } = await sb.from('Users').update(fullFields).eq('ID', userId);
          if (error) updateError = error;
        } catch (e) {
          updateError = e;
        }

        // Jika gagal karena kolom belum ada di schema Users (PGRST204 / schema cache error),
        // update kolom standar dan simpan extraMeta ke Settings
        if (updateError) {
          const errMsg = String(updateError.message || updateError.details || '');
          if (errMsg.includes('Jenis Kelamin') || errMsg.includes('Jenis PTK') || errMsg.includes('schema cache') || errMsg.includes('PGRST204') || updateError.code === 'PGRST204') {
            const { error: retryError } = await sb.from('Users').update(updateFields).eq('ID', userId);
            if (retryError) throw retryError;
          } else {
            throw updateError;
          }
        }

        // Selalu simpan metadata extra ke Settings agar sinkron dan persisten
        if (Object.keys(extraMeta).length > 0) {
          await this._saveGuruMeta(userId, extraMeta);
          if (updateData.username) {
            await this._saveGuruMeta(updateData.username, extraMeta);
          }
        }

        return { success: true, message: 'Data profil berhasil diperbarui.' };
      } catch (e) {
        console.error('[adminUpdateUser error]:', e);
        return { success: false, message: e.message || 'Gagal memperbarui data profil.' };
      }
    },

    async deleteUser(userId) {
      try {
        _markIdDeleted('Users', userId);
        const sb = getClient();
        await sb.from('Users').delete().eq('ID', userId);
        return { success: true, message: 'User berhasil dihapus.' };
      } catch (e) {
        return { success: true, message: 'User berhasil dihapus.' };
      }
    },

    async updateUserProfile(userId, updateData) {
      return await this.adminUpdateUser(userId, updateData);
    },

    async updateUserPassword(userId, oldPassword, newPassword) {
      try {
        const sb = getClient();
        const { data: users } = await sb.from('Users').select('*').eq('ID', userId);
        if (!users || users.length === 0) return { success: false, message: 'User tidak ditemukan.' };
        const u = users[0];
        const oldHashed = await hashPassword(oldPassword);
        if (u.Password !== oldPassword && u.Password !== oldHashed) {
          return { success: false, message: 'Password lama tidak sesuai.' };
        }
        const newHashed = await hashPassword(newPassword);
        await sb.from('Users').update({ 'Password': newHashed }).eq('ID', userId);
        return { success: true, message: 'Password berhasil diubah.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async updateUsername(userId, newUsername, password) {
      try {
        const sb = getClient();
        const { data: users } = await sb.from('Users').select('*').eq('ID', userId);
        if (!users || users.length === 0) return { success: false, message: 'User tidak ditemukan.' };
        const u = users[0];
        const pwHashed = await hashPassword(password);
        if (u.Password !== password && u.Password !== pwHashed) {
          return { success: false, message: 'Password verifikasi salah.' };
        }
        await sb.from('Users').update({ 'Username': newUsername }).eq('ID', userId);
        return { success: true, message: 'Username berhasil diperbarui.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    // --- SETTINGS (PENGATURAN SEKOLAH) ---
    getDefaultSettings() {
      let localSaved = {};
      try {
        localSaved = JSON.parse(localStorage.getItem('portal_settings_cache') || localStorage.getItem('portal_app_settings') || '{}');
      } catch (e) { }
      const res = {
        ...REAL_SCHOOL_SNAPSHOT.SettingsMap,
        ...localSaved,
        gallery_images: JSON.stringify(REAL_SCHOOL_SNAPSHOT.GalleryImages || [])
      };
      if (!res.school_address || res.school_address.includes('Lagadi') || res.school_address.includes('_')) {
        res.school_address = 'Pulau Maginti, Desa Kangkunawe, Kecamatan Maginti';
      }
      if (!res.school_npsn || res.school_npsn === '69989028') {
        res.school_npsn = '70011748';
      }
      return res;
    },

    async getSettings() {
      try {
        const sb = getClient();
        if (!sb) {
          return { success: true, data: this.getDefaultSettings() };
        }
        // Optimasi: Jangan download blob data SPMB (7MB) atau materi (500KB) di startup!
        const { data, error } = await sb.from('Settings')
          .select('Key, Value')
          .not('Key', 'in', '("app_spmb_registrations","app_learnings_data","app_learning_discussions_data","app_learning_attendees_data")');
        
        if (error) throw error;
        const settings = this.getDefaultSettings();
        (data || []).forEach(row => {
          if (row && row.Key) {
            if (row.Key === 'principal_name' && row.Value === 'Drs. H. Kepala Sekolah, M.Pd') return;
            settings[row.Key] = row.Value;
          }
        });
        if (!settings.school_address || settings.school_address.includes('Lagadi') || settings.school_address.includes('_')) {
          settings.school_address = 'Pulau Maginti, Desa Kangkunawe, Kecamatan Maginti';
        }
        if (!settings.school_npsn || settings.school_npsn === '69989028') {
          settings.school_npsn = '70011748';
        }
        // Sinkronkan penanda epoch & tabel kosong antar perangkat agar seluruh perangkat menampilkan data Supabase yang sama persis
        try {
          if (settings.portal_db_empty_tables !== undefined) {
            localStorage.setItem('portal_db_remote_empty_tables', String(settings.portal_db_empty_tables));
          }
          if (settings.portal_db_sync_epoch) {
            const prevEpoch = localStorage.getItem('portal_db_sync_epoch') || '';
            if (prevEpoch !== String(settings.portal_db_sync_epoch)) {
              localStorage.setItem('portal_db_sync_epoch', String(settings.portal_db_sync_epoch));
              localStorage.removeItem('portal_landing_teachers_cache');
              [
                'Users', 'PendingUsers', 'Classes', 'Students', 'Subjects',
                'Attendance', 'Exams', 'Questions', 'Grades', 'Violations',
                'ExamSessions', 'Announcements', 'Learnings', 'LearningSessions'
              ].forEach(tbl => {
                localStorage.removeItem('portal_db_table_' + tbl);
                localStorage.removeItem('portal_db_deleted_' + tbl);
                localStorage.removeItem('portal_backup_local_only_' + tbl);
                localStorage.setItem('portal_semester_override_' + tbl, 'true');
              });
            }
          }
        } catch (eSync) { }
        // Sinkronkan konfigurasi Cloudinary dari Settings Supabase agar seluruh perangkat Guru & Siswa otomatis terhubung ke Cloudinary
        if (settings.cloudinary_cloud_name || settings.cloudinary_upload_preset || settings.cloudinary_api_key) {
          PortalCloudStorage.saveConfig({
            cloudinaryCloudName: settings.cloudinary_cloud_name || '',
            cloudinaryUploadPreset: settings.cloudinary_upload_preset || '',
            cloudinaryApiKey: settings.cloudinary_api_key || '',
            cloudinaryApiSecret: settings.cloudinary_api_secret || '',
            cloudinaryFolder: settings.cloudinary_folder || 'portal-sekolah-smandum'
          });
        }
        try {
          localStorage.setItem('portal_settings_cache', JSON.stringify(settings));
          localStorage.setItem('portal_app_settings', JSON.stringify(settings));
        } catch (e) { }
        return { success: true, data: settings };
      } catch (e) {
        console.warn('[getSettings] Error, using local defaults:', e);
        return { success: true, data: this.getDefaultSettings() };
      }
    },

    async updateSettings(settingsObj) {
      try {
        const sb = getClient();
        const now = new Date().toISOString();
        const upsertRows = [];
        for (const key in settingsObj) {
          upsertRows.push({
            'Key': key,
            'Value': String(settingsObj[key] ?? ''),
            'Diupdate': now
          });
        }
        try {
          const cached = JSON.parse(localStorage.getItem('portal_settings_cache') || '{}');
          const merged = { ...cached, ...settingsObj };
          localStorage.setItem('portal_settings_cache', JSON.stringify(merged));
          localStorage.setItem('portal_app_settings', JSON.stringify(merged));
          
          if (settingsObj.school_address) {
            REAL_SCHOOL_SNAPSHOT.SettingsMap.school_address = settingsObj.school_address;
          }
          if (settingsObj.school_npsn) {
            REAL_SCHOOL_SNAPSHOT.SettingsMap.school_npsn = settingsObj.school_npsn;
          }
          if (settingsObj.school_name) {
            REAL_SCHOOL_SNAPSHOT.SettingsMap.school_name = settingsObj.school_name;
          }
          if (settingsObj.school_background_url) {
            localStorage.setItem('portal_school_background_url', settingsObj.school_background_url);
            REAL_SCHOOL_SNAPSHOT.SettingsMap.school_background_url = settingsObj.school_background_url;
          }
          if (settingsObj.principal_photo) {
            localStorage.setItem('portal_principal_photo', settingsObj.principal_photo);
            REAL_SCHOOL_SNAPSHOT.SettingsMap.principal_photo = settingsObj.principal_photo;
          }
          if (settingsObj.admin_address) {
            localStorage.setItem('portal_admin_address', settingsObj.admin_address);
            REAL_SCHOOL_SNAPSHOT.SettingsMap.admin_address = settingsObj.admin_address;
            try {
              const allCached = _getTableCache('Users');
              const adm = allCached.find(x => (x.ID || x.id) === 'USRMVOW3VFZ8LCZ' || (x.Username || '').toUpperCase() === 'DZULKIFLI');
              if (adm) {
                adm['Alamat'] = settingsObj.admin_address;
                adm.alamat = settingsObj.admin_address;
                _setTableCache('Users', allCached);
              }
            } catch (e) { }
          }
          if (settingsObj.admin_photo) {
            localStorage.setItem('portal_admin_photo', settingsObj.admin_photo);
            REAL_SCHOOL_SNAPSHOT.SettingsMap.admin_photo = settingsObj.admin_photo;
          }
        } catch (e) { }

        if (sb) {
          try {
            await sb.from('Settings').upsert(upsertRows, { onConflict: 'Key' });
          } catch (sbErr) {
            console.warn('[updateSettings] Supabase network/quota warning, persisted locally:', sbErr);
          }
        }
        return { success: true, message: 'Pengaturan sekolah berhasil disimpan.' };
      } catch (e) {
        return { success: true, message: 'Pengaturan sekolah berhasil disimpan ke database lokal.' };
      }
    },

    // --- CLASSES (KELAS) ---
    async getClasses() {
      const data = await this.getAllData('Classes');
      return { success: true, data: data };
    },

    async createClass(data) {
      try {
        const sb = getClient();
        const newId = generateId('KLS');
        const { error } = await sb.from('Classes').insert([{
          'ID Kelas': newId,
          'Nama Kelas': data.namaKelas,
          'Tingkat': data.tingkat || '',
          'Jurusan': data.jurusan || '',
          'ID Wali Kelas': data.idWaliKelas || '',
          'Nama Wali Kelas': data.namaWaliKelas || '',
          'Tahun Ajaran': data.tahunAjaran || '2024/2025',
          'Kapasitas': Number(data.kapasitas || 30),
          'Jumlah Siswa': 0,
          'Ruangan': data.ruangan || '',
          'Keterangan': data.keterangan || ''
        }]);
        if (error) throw error;
        return { success: true, message: 'Kelas berhasil ditambahkan.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async updateClass(id, data) {
      try {
        const sb = getClient();
        const { error } = await sb.from('Classes').update({
          'Nama Kelas': data.namaKelas,
          'Tingkat': data.tingkat,
          'Jurusan': data.jurusan,
          'ID Wali Kelas': data.idWaliKelas,
          'Nama Wali Kelas': data.namaWaliKelas,
          'Tahun Ajaran': data.tahunAjaran,
          'Kapasitas': Number(data.kapasitas || 30),
          'Ruangan': data.ruangan,
          'Keterangan': data.keterangan
        }).eq('ID Kelas', id);
        if (error) throw error;
        return { success: true, message: 'Kelas berhasil diperbarui.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async deleteClass(id) {
      try {
        _markIdDeleted('Classes', id);
        const sb = getClient();
        await sb.from('Classes').delete().eq('ID Kelas', id);
        return { success: true, message: 'Kelas berhasil dihapus.' };
      } catch (e) {
        return { success: true, message: 'Kelas berhasil dihapus.' };
      }
    },

    // --- STUDENTS (SISWA) ---
    async getStudents(classId) {
      const sb = getClient();
      let query = sb.from('Students').select('*');
      if (classId) query = query.eq('ID Kelas', classId);
      const { data, error } = await query;
      return { success: !error, data: data || [] };
    },

    async createStudent(data) {
      try {
        const sb = getClient();
        const newId = generateId('SIS');
        const { error } = await sb.from('Students').insert([{
          'ID Siswa': newId,
          'NIS': String(data.nis),
          'NISN': String(data.nisn || ''),
          'Nama Siswa': data.namaSiswa,
          'Jenis Kelamin': data.jenisKelamin || 'L',
          'ID Kelas': data.idKelas,
          'Nama Kelas': data.namaKelas,
          'Telepon': data.telepon || '',
          'Alamat': data.alamat || '',
          'Status': data.status || 'active'
        }]);
        if (error) throw error;
        return { success: true, message: 'Data siswa berhasil disimpan.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async updateStudent(id, data) {
      try {
        const sb = getClient();
        const { error } = await sb.from('Students').update({
          'NIS': String(data.nis),
          'NISN': String(data.nisn || ''),
          'Nama Siswa': data.namaSiswa,
          'Jenis Kelamin': data.jenisKelamin,
          'ID Kelas': data.idKelas,
          'Nama Kelas': data.namaKelas,
          'Telepon': data.telepon,
          'Alamat': data.alamat,
          'Status': data.status
        }).eq('ID Siswa', id);
        if (error) throw error;
        return { success: true, message: 'Data siswa berhasil diperbarui.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async deleteStudent(id) {
      try {
        _markIdDeleted('Students', id);
        const sb = getClient();
        await sb.from('Students').delete().eq('ID Siswa', id);
        return { success: true, message: 'Data siswa berhasil dihapus.' };
      } catch (e) {
        return { success: true, message: 'Data siswa berhasil dihapus.' };
      }
    },

    // --- SUBJECTS (MATA PELAJARAN) ---
    async getSubjects(classId) {
      const sb = getClient();
      let query = sb.from('Subjects').select('*');
      if (classId) query = query.eq('ID Kelas', classId);
      const { data, error } = await query;
      return { success: !error, data: data || [] };
    },

    async getSubjectsByGuru(guruId, guruNama) {
      const sb = getClient();
      let query = sb.from('Subjects').select('*');
      const { data, error } = await query;
      if (error) return { success: false, data: [] };
      let list = data || [];
      if (guruId || guruNama) {
        const gId = String(guruId || '').trim().toLowerCase();
        const gName = String(guruNama || '').trim().toLowerCase();
        list = list.filter(s => {
          const sId = String(s['ID Guru'] || '').trim().toLowerCase();
          const sName = String(s['Nama Guru'] || '').trim().toLowerCase();
          return (gId && sId === gId) || (gName && (sName === gName || sName.includes(gName) || gName.includes(sName)));
        });
      }
      return { success: true, data: list };
    },

    async createSubject(data) {
      try {
        const sb = getClient();
        const newId = generateId('MPL');
        const { error } = await sb.from('Subjects').insert([{
          'ID Mapel': newId,
          'Nama Mapel': data.namaMapel,
          'Kode Mapel': data.kodeMapel || '',
          'ID Kelas': data.idKelas,
          'Nama Kelas': data.namaKelas,
          'ID Guru': data.idGuru || '',
          'Nama Guru': data.namaGuru || '',
          'SKS': Number(data.sks || 1),
          'Hari': data.hari || '',
          'Jam Mulai': data.jamMulai || '',
          'Jam Selesai': data.jamSelesai || '',
          'Ruangan': data.ruangan || '',
          'Semester': data.semester || 'Ganjil'
        }]);
        if (error) throw error;
        return { success: true, message: 'Mata pelajaran berhasil ditambahkan.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async updateSubject(id, data) {
      try {
        const sb = getClient();
        const { error } = await sb.from('Subjects').update({
          'Nama Mapel': data.namaMapel,
          'Kode Mapel': data.kodeMapel,
          'ID Kelas': data.idKelas,
          'Nama Kelas': data.namaKelas,
          'ID Guru': data.idGuru,
          'Nama Guru': data.namaGuru,
          'SKS': Number(data.sks || 1),
          'Hari': data.hari,
          'Jam Mulai': data.jamMulai,
          'Jam Selesai': data.jamSelesai,
          'Ruangan': data.ruangan,
          'Semester': data.semester
        }).eq('ID Mapel', id);
        if (error) throw error;
        return { success: true, message: 'Mata pelajaran berhasil diperbarui.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async deleteSubject(id) {
      try {
        _markIdDeleted('Subjects', id);
        const sb = getClient();
        await sb.from('Subjects').delete().eq('ID Mapel', id);
        return { success: true, message: 'Mata pelajaran berhasil dihapus.' };
      } catch (e) {
        return { success: true, message: 'Mata pelajaran berhasil dihapus.' };
      }
    },

    // --- EXAMS (UJIAN ONLINE / CBT) ---
    async getExams(guruId) {
      const sb = getClient();
      let query = sb.from('Exams').select('*');
      if (guruId) query = query.eq('ID Guru', guruId);
      const { data, error } = await query;
      return { success: !error, data: data || [] };
    },

    async createExam(data) {
      try {
        const sb = getClient();
        const newId = generateId('EXM');
        const now = new Date().toISOString();
        const token = (data.tokenUjian || data.token || newId).trim().toUpperCase();

        const { error } = await sb.from('Exams').insert([{
          'ID Ujian': newId,
          'Judul Ujian': data.judulUjian,
          'ID Mapel': data.idMapel || '',
          'Nama Mapel': data.namaMapel || '',
          'ID Kelas': data.idKelas || '',
          'Nama Kelas': data.namaKelas || '',
          'ID Guru': data.idGuru || '',
          'Nama Guru': data.namaGuru || '',
          'Tanggal Mulai': data.tanggalMulai || now,
          'Tanggal Selesai': data.tanggalSelesai || now,
          'Durasi (menit)': Number(data.durasi || 60),
          'Status': data.status || 'draft',
          'Jumlah Soal': Number(data.jumlahSoal || 0),
          'Total Nilai': Number(data.totalNilai || 100),
          'Anti Curang': String(data.antiCurang ?? 'true'),
          'Tanggal Dibuat': now,
          'Keterangan': data.keterangan || '',
          'Batas Pelanggaran': Number(data.batasPelanggaran || 3),
          'Token': token
        }]);
        if (error) throw error;

        return { success: true, message: 'Ujian berhasil dibuat.', id: newId };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async updateExam(id, data) {
      try {
        const sb = getClient();
        const updateFields = {};
        if (data.judulUjian !== undefined) updateFields['Judul Ujian'] = data.judulUjian;
        if (data.idMapel !== undefined) updateFields['ID Mapel'] = data.idMapel;
        if (data.namaMapel !== undefined) updateFields['Nama Mapel'] = data.namaMapel;
        if (data.idKelas !== undefined) updateFields['ID Kelas'] = data.idKelas;
        if (data.namaKelas !== undefined) updateFields['Nama Kelas'] = data.namaKelas;
        if (data.durasi !== undefined) updateFields['Durasi (menit)'] = Number(data.durasi);
        if (data.status !== undefined) updateFields['Status'] = data.status;
        if (data.antiCurang !== undefined) updateFields['Anti Curang'] = String(data.antiCurang);
        if (data.keterangan !== undefined) updateFields['Keterangan'] = data.keterangan;
        if (data.batasPelanggaran !== undefined) updateFields['Batas Pelanggaran'] = Number(data.batasPelanggaran);
        if (data.tokenUjian !== undefined || data.token !== undefined) updateFields['Token'] = (data.tokenUjian || data.token).trim().toUpperCase();

        const { error } = await sb.from('Exams').update(updateFields).eq('ID Ujian', id);
        if (error) throw error;
        return { success: true, message: 'Ujian berhasil diperbarui.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async deleteExam(id) {
      try {
        _markIdDeleted('Exams', id);
        const sb = getClient();
        await sb.from('Questions').delete().eq('ID Ujian', id);
        await sb.from('Grades').delete().eq('ID Ujian', id);
        await sb.from('Violations').delete().eq('ID Ujian', id);
        await sb.from('ExamSessions').delete().eq('ID Ujian', id);
        await sb.from('Exams').delete().eq('ID Ujian', id);
        return { success: true, message: 'Ujian dan semua soal terkait berhasil dihapus.' };
      } catch (e) {
        return { success: true, message: 'Ujian dan semua soal terkait berhasil dihapus.' };
      }
    },

    async copyExamToClass(examId, targetClassId, targetClassName, newToken) {
      try {
        const sb = getClient();
        const { data: exams } = await sb.from('Exams').select('*').eq('ID Ujian', examId);
        if (!exams || exams.length === 0) return { success: false, message: 'Ujian asal tidak ditemukan.' };
        const src = exams[0];

        const newExamId = generateId('EXM');
        const now = new Date().toISOString();
        const token = (newToken || newExamId).trim().toUpperCase();

        await sb.from('Exams').insert([{
          'ID Ujian': newExamId,
          'Judul Ujian': src['Judul Ujian'] + ' (' + targetClassName + ')',
          'ID Mapel': src['ID Mapel'],
          'Nama Mapel': src['Nama Mapel'],
          'ID Kelas': targetClassId,
          'Nama Kelas': targetClassName,
          'ID Guru': src['ID Guru'],
          'Nama Guru': src['Nama Guru'],
          'Tanggal Mulai': src['Tanggal Mulai'] || now,
          'Tanggal Selesai': src['Tanggal Selesai'] || now,
          'Durasi (menit)': src['Durasi (menit)'],
          'Status': 'draft',
          'Jumlah Soal': src['Jumlah Soal'],
          'Total Nilai': src['Total Nilai'],
          'Anti Curang': src['Anti Curang'],
          'Tanggal Dibuat': now,
          'Keterangan': src['Keterangan'],
          'Batas Pelanggaran': src['Batas Pelanggaran'],
          'Token': token
        }]);

        // Salin seluruh soal
        const { data: questions } = await sb.from('Questions').select('*').eq('ID Ujian', examId);
        if (questions && questions.length > 0) {
          const newQuestions = questions.map(q => ({
            ...q,
            'ID Soal': generateId('QST'),
            'ID Ujian': newExamId
          }));
          await sb.from('Questions').insert(newQuestions);
        }

        return { success: true, message: 'Ujian berhasil disalin ke kelas ' + targetClassName };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    // --- QUESTIONS (SOAL UJIAN) ---
    async getQuestions(examId) {
      const sb = getClient();
      const { data, error } = await sb.from('Questions')
        .select('*')
        .eq('ID Ujian', examId)
        .order('Nomor Soal', { ascending: true });
      return { success: !error, data: data || [] };
    },

    async createQuestion(data) {
      try {
        const sb = getClient();
        const newId = generateId('QST');
        const { error } = await sb.from('Questions').insert([{
          'ID Soal': newId,
          'ID Ujian': data.idUjian,
          'Nomor Soal': Number(data.nomorSoal || 1),
          'Tipe Soal': data.tipeSoal || 'pilihan_ganda',
          'Pertanyaan': data.pertanyaan,
          'Opsi A': data.opsiA || '',
          'Opsi B': data.opsiB || '',
          'Opsi C': data.opsiC || '',
          'Opsi D': data.opsiD || '',
          'Opsi E': data.opsiE || '',
          'Jawaban Benar': (data.jawabanBenar || '').trim().toUpperCase(),
          'Poin': Number(data.poin || 10),
          'Pembahasan': data.pembahasan || ''
        }]);
        if (error) throw error;

        // Update jumlah soal di tabel Exams
        const countRes = await sb.from('Questions').select('ID Soal', { count: 'exact' }).eq('ID Ujian', data.idUjian);
        await sb.from('Exams').update({ 'Jumlah Soal': countRes.count || 0 }).eq('ID Ujian', data.idUjian);

        return { success: true, message: 'Soal berhasil disimpan.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async updateQuestion(id, data) {
      try {
        const sb = getClient();
        const { error } = await sb.from('Questions').update({
          'Nomor Soal': Number(data.nomorSoal),
          'Tipe Soal': data.tipeSoal,
          'Pertanyaan': data.pertanyaan,
          'Opsi A': data.opsiA,
          'Opsi B': data.opsiB,
          'Opsi C': data.opsiC,
          'Opsi D': data.opsiD,
          'Opsi E': data.opsiE,
          'Jawaban Benar': (data.jawabanBenar || '').trim().toUpperCase(),
          'Poin': Number(data.poin),
          'Pembahasan': data.pembahasan
        }).eq('ID Soal', id);
        if (error) throw error;
        return { success: true, message: 'Soal berhasil diperbarui.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async deleteQuestion(id) {
      try {
        const sb = getClient();
        const { data: q } = await sb.from('Questions').select('ID Ujian').eq('ID Soal', id);
        const examId = q && q.length > 0 ? q[0]['ID Ujian'] : null;

        await sb.from('Questions').delete().eq('ID Soal', id);

        if (examId) {
          const countRes = await sb.from('Questions').select('ID Soal', { count: 'exact' }).eq('ID Ujian', examId);
          await sb.from('Exams').update({ 'Jumlah Soal': countRes.count || 0 }).eq('ID Ujian', examId);
        }
        return { success: true, message: 'Soal berhasil dihapus.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async seedSampleQuestions(examId) {
      return { success: false, message: 'Fitur soal contoh otomatis telah dinonaktifkan. Silakan input soal melalui bank soal database.' };
    },

    // --- ALUR CBT SISWA (VALIDASI, PENGERJAAN, SUBMISI) ---
    async validateAndStartExam(namaSiswa, token) {
      try {
        const sb = getClient();
        const tokenClean = (token || '').toString().trim().toUpperCase();
        const tokenNorm = tokenClean.replace(/[\s\-_]/g, '');

        let { data: exams } = await sb.from('Exams').select('*');
        exams = exams || [];

        let exam = exams.find(e => {
          const id = (e['ID Ujian'] || '').toString().trim().toUpperCase();
          const idNorm = id.replace(/[\s\-_]/g, '');
          const tok = (e['Token'] || e.token || '').toString().trim().toUpperCase();
          const tokNorm = tok.replace(/[\s\-_]/g, '');
          const jud = (e['Judul Ujian'] || '').toString().trim().toUpperCase();
          return id === tokenClean || idNorm === tokenNorm || (tok && (tok === tokenClean || tokNorm === tokenNorm)) || (jud && jud === tokenClean);
        });

        if (!exam) {
          return { success: false, message: 'Token atau ID Ujian tidak valid. Pastikan token ujian sudah terdaftar di database.' };
        }

        // Ambil daftar soal ujian dari tabel Questions
        const { data: qData } = await sb.from('Questions')
          .select('*')
          .eq('ID Ujian', exam['ID Ujian'])
          .order('Nomor Soal', { ascending: true });
        const questions = Array.isArray(qData) ? qData : [];

        // Catat sesi pengerjaan ujian
        const newSessId = generateId('SES');
        const now = new Date().toISOString();
        await sb.from('ExamSessions').insert([{
          'ID Sesi': newSessId,
          'ID Ujian': exam['ID Ujian'],
          'Judul Ujian': exam['Judul Ujian'],
          'ID Kelas': exam['ID Kelas'] || '',
          'Nama Kelas': exam['Nama Kelas'] || '',
          'NIS Siswa': namaSiswa,
          'Nama Siswa': namaSiswa,
          'Status Sesi': 'in_progress',
          'Waktu Masuk': now,
          'Waktu Selesai': '',
          'Jawaban JSON': '{}',
          'Pelanggaran': 0,
          'IP Address': '',
          'User Agent': navigator.userAgent || ''
        }]);

        return {
          success: true,
          exam: exam,
          questions: questions,
          namaSiswa: namaSiswa,
          nisSiswa: namaSiswa,
          idSesi: newSessId
        };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async submitExamAnswers(examId, namaSiswa, nisSiswa, answersMap, statusOverride) {
      try {
        const sb = getClient();
        const { data: questions } = await sb.from('Questions').select('*').eq('ID Ujian', examId).order('Nomor Soal', { ascending: true });
        const { data: exams } = await sb.from('Exams').select('*').eq('ID Ujian', examId);
        const exam = exams && exams[0] ? exams[0] : {};

        let totalPG = 0;
        let benarPG = 0;
        let totalSoal = (questions || []).length;

        (questions || []).forEach((q, idx) => {
          const sIdx = String(idx);
          const studentAns = (answersMap && (answersMap[idx] !== undefined ? answersMap[idx] : answersMap[sIdx])) || '';
          let textAns = typeof studentAns === 'object' && studentAns ? (studentAns.text || '') : String(studentAns || '');

          if (q['Tipe Soal'] !== 'essay') {
            totalPG++;
            const correctAns = (q['Jawaban Benar'] || '').trim().toUpperCase();
            if (textAns.trim().toUpperCase() === correctAns) {
              benarPG++;
            }
          }
        });

        const nilai = totalPG > 0 ? Math.round((benarPG / totalPG) * 100) : 100;
        const now = new Date().toISOString();
        const effectiveNis = (nisSiswa || namaSiswa || 'SISWA').trim();
        const effectiveNama = (namaSiswa || nisSiswa || 'Siswa').trim();

        // 1. Simpan atau perbarui nilai ke tabel Grades
        const { data: existingGrades } = await sb.from('Grades').select('ID Nilai').eq('ID Ujian', examId);
        const matchGrade = (existingGrades || []).find(g => {
          const gNis = (g['NIS Siswa'] || '').trim().toLowerCase();
          const gNama = (g['Nama Siswa'] || '').trim().toLowerCase();
          return (effectiveNis && gNis === effectiveNis.toLowerCase()) || (effectiveNama && gNama === effectiveNama.toLowerCase());
        });

        const gradePayload = {
          'ID Ujian': examId,
          'Judul Ujian': exam['Judul Ujian'] || '',
          'ID Mapel': exam['ID Mapel'] || '',
          'Nama Mapel': exam['Nama Mapel'] || '',
          'ID Kelas': exam['ID Kelas'] || '',
          'Nama Kelas': exam['Nama Kelas'] || '',
          'NIS Siswa': effectiveNis,
          'Nama Siswa': effectiveNama,
          'Nilai': nilai,
          'Jumlah Benar': benarPG,
          'Jumlah Salah': totalPG - benarPG,
          'Total Soal': totalSoal,
          'Waktu Selesai': now,
          'ID Guru': exam['ID Guru'] || '',
          'Nama Guru': exam['Nama Guru'] || '',
          'Nilai Akhir': nilai,
          'Status': statusOverride || 'selesai'
        };

        if (matchGrade) {
          await sb.from('Grades').update(gradePayload).eq('ID Nilai', matchGrade['ID Nilai']);
        } else {
          gradePayload['ID Nilai'] = generateId('NLI');
          gradePayload['Waktu Mulai'] = now;
          gradePayload['Tanggal Input'] = now;
          await sb.from('Grades').insert([gradePayload]);
        }

        // 2. Simpan atau perbarui sesi ujian & lembar jawaban (Jawaban JSON) di ExamSessions
        const { data: existingSessions } = await sb.from('ExamSessions').select('ID Sesi, NIS Siswa, Nama Siswa').eq('ID Ujian', examId);
        const matchSess = (existingSessions || []).find(s => {
          const sNis = (s['NIS Siswa'] || '').trim().toLowerCase();
          const sNama = (s['Nama Siswa'] || '').trim().toLowerCase();
          return (effectiveNis && sNis === effectiveNis.toLowerCase()) || (effectiveNama && sNama === effectiveNama.toLowerCase());
        });

        const jsonAnswers = JSON.stringify(answersMap || {});
        if (matchSess) {
          await sb.from('ExamSessions').update({
            'Status Sesi': statusOverride || 'finished',
            'Waktu Selesai': now,
            'Jawaban JSON': jsonAnswers
          }).eq('ID Sesi', matchSess['ID Sesi']);
        } else {
          const newSessId = generateId('SES');
          await sb.from('ExamSessions').insert([{
            'ID Sesi': newSessId,
            'ID Ujian': examId,
            'Judul Ujian': exam['Judul Ujian'] || '',
            'ID Kelas': exam['ID Kelas'] || '',
            'Nama Kelas': exam['Nama Kelas'] || '',
            'NIS Siswa': effectiveNis,
            'Nama Siswa': effectiveNama,
            'Status Sesi': statusOverride || 'finished',
            'Waktu Mulai': now,
            'Waktu Selesai': now,
            'Jawaban JSON': jsonAnswers
          }]);
        }

        return {
          success: true,
          message: 'Jawaban ujian berhasil dikumpulkan dan tersimpan rapi!',
          nilai: nilai,
          benar: benarPG,
          total: totalSoal
        };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async logViolation(payload) {
      try {
        const sb = getClient();
        const newId = generateId('VLT');
        const now = new Date().toISOString();
        await sb.from('Violations').insert([{
          'ID': newId,
          'ID Ujian': payload.idUjian || '',
          'Judul Ujian': payload.judulUjian || '',
          'ID Kelas': payload.idKelas || '',
          'Nama Kelas': payload.namaKelas || '',
          'NIS Siswa': payload.nisSiswa || '',
          'Nama Siswa': payload.namaSiswa || '',
          'Jenis Pelanggaran': payload.jenisViolation || payload.jenisPelanggaran || 'Pindah Layar',
          'Waktu Pelanggaran': now,
          'Detail': payload.detail || '',
          'Jumlah Pelanggaran': 1
        }]);
        return { success: true };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async disqualifyExamSession(idSesi, reason) {
      try {
        const sb = getClient();
        await sb.from('ExamSessions').update({
          'Status Sesi': 'disqualified'
        }).eq('ID Sesi', idSesi);
        return { success: true, message: 'Sesi ujian telah didiskualifikasi.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async getExamSessions(examId) {
      try {
        const sb = getClient();
        let query = sb.from('ExamSessions').select('*');
        if (examId) query = query.eq('ID Ujian', examId);
        const { data, error } = await query;
        const list = (!error && data) ? data : [];
        return { success: !error, data: list };
      } catch (e) {
        return { success: false, data: [], message: e.message };
      }
    },

    async getExamSubmissionsForTeacher(examId) {
      try {
        const sb = getClient();
        const [sessRes, gradeRes] = await Promise.all([
          sb.from('ExamSessions').select('*').eq('ID Ujian', examId),
          sb.from('Grades').select('*').eq('ID Ujian', examId)
        ]);

        const sessions = sessRes.data || [];
        const grades = gradeRes.data || [];
        const results = [];
        const processedKeys = new Set();

        // 1. Gabungkan dari ExamSessions
        sessions.forEach(s => {
          const sNis = (s['NIS Siswa'] || '').trim();
          const sNama = (s['Nama Siswa'] || '').trim();
          const key = (sNis || sNama).toLowerCase();
          processedKeys.add(key);

          const g = grades.find(item => {
            const gNis = (item['NIS Siswa'] || '').trim().toLowerCase();
            const gNama = (item['Nama Siswa'] || '').trim().toLowerCase();
            return (sNis && gNis === sNis.toLowerCase()) || (sNama && gNama === sNama.toLowerCase());
          });

          let parsedSessAns = null;
          if (!g && s && s['Jawaban JSON']) {
            try {
              parsedSessAns = typeof s['Jawaban JSON'] === 'string' ? JSON.parse(s['Jawaban JSON']) : s['Jawaban JSON'];
            } catch (e) { }
          }
          const sessScore = (parsedSessAns && parsedSessAns._score !== undefined) ? Number(parsedSessAns._score) : '-';

          const nilaiVal = g ? (g['Nilai'] !== undefined ? g['Nilai'] : sessScore) : sessScore;
          const nilaiAkhirVal = g ? (g['Nilai Akhir'] !== undefined && g['Nilai Akhir'] !== '' ? g['Nilai Akhir'] : nilaiVal) : nilaiVal;
          const statusNilaiVal = g ? ((g['Status'] === 'final' || g['Status'] === 'selesai') ? 'final' : 'draft') : (sessScore !== '-' ? 'final' : 'draft');
          const catatanVal = g ? (g['Catatan Guru'] || '') : '';

          results.push({
            idSesi: s['ID Sesi'] || '',
            nisSiswa: sNis,
            namaSiswa: sNama,
            nilai: nilaiVal,
            nilaiAkhir: nilaiAkhirVal,
            statusSesi: s['Status Sesi'] || 'finished',
            statusNilai: statusNilaiVal,
            catatanGuru: catatanVal,
            'ID Sesi': s['ID Sesi'] || '',
            'NIS Siswa': sNis,
            'Nama Siswa': sNama,
            'Status Sesi': s['Status Sesi'] || 'finished',
            gradeData: g || null,
            ...s
          });
        });

        // 2. Tambahkan siswa yang ada di Grades tapi belum ada di ExamSessions
        grades.forEach(g => {
          const gNis = (g['NIS Siswa'] || '').trim();
          const gNama = (g['Nama Siswa'] || '').trim();
          const key = (gNis || gNama).toLowerCase();
          if (!processedKeys.has(key)) {
            processedKeys.add(key);
            const nilaiVal = g['Nilai'] !== undefined ? g['Nilai'] : '-';
            const nilaiAkhirVal = g['Nilai Akhir'] !== undefined && g['Nilai Akhir'] !== '' ? g['Nilai Akhir'] : nilaiVal;
            const statusNilaiVal = (g['Status'] === 'final' || g['Status'] === 'selesai') ? 'final' : 'draft';

            results.push({
              idSesi: '',
              nisSiswa: gNis,
              namaSiswa: gNama,
              nilai: nilaiVal,
              nilaiAkhir: nilaiAkhirVal,
              statusSesi: 'finished',
              statusNilai: statusNilaiVal,
              catatanGuru: g['Catatan Guru'] || '',
              'ID Sesi': '',
              'NIS Siswa': gNis,
              'Nama Siswa': gNama,
              'Status Sesi': 'finished',
              gradeData: g
            });
          }
        });

        // Urutkan berdasarkan nama siswa
        results.sort((a, b) => (a.namaSiswa || '').localeCompare(b.namaSiswa || ''));

        return { success: true, data: results };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async getStudentAnswerSheet(examId, nisSiswa, namaSiswa, idSesi) {
      try {
        const sb = getClient();
        const { data: allSessions } = await sb.from('ExamSessions').select('*').eq('ID Ujian', examId);
        const sessions = allSessions || [];

        let session = null;
        if (idSesi) {
          session = sessions.find(s => s['ID Sesi'] === idSesi);
        }
        if (!session && nisSiswa) {
          const targetNis = String(nisSiswa).trim().toLowerCase();
          session = sessions.find(s => (s['NIS Siswa'] || '').trim().toLowerCase() === targetNis);
        }
        if (!session && namaSiswa) {
          const targetNama = String(namaSiswa).trim().toLowerCase();
          session = sessions.find(s => (s['Nama Siswa'] || '').trim().toLowerCase() === targetNama);
        }
        if (!session && sessions.length > 0) {
          session = sessions[0];
        }

        let answersMap = {};
        if (session && session['Jawaban JSON']) {
          try {
            answersMap = typeof session['Jawaban JSON'] === 'string' ? JSON.parse(session['Jawaban JSON']) : session['Jawaban JSON'];
          } catch (e) { answersMap = {}; }
        }

        const { data: questions } = await sb.from('Questions').select('*').eq('ID Ujian', examId).order('Nomor Soal', { ascending: true });
        return {
          success: true,
          session: session,
          questions: questions || [],
          answers: answersMap || {}
        };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async deleteStudentExamSubmission(idSesi, examId, nisSiswa) {
      try {
        const sb = getClient();
        if (idSesi) await sb.from('ExamSessions').delete().eq('ID Sesi', idSesi);
        if (examId && nisSiswa) {
          await sb.from('Grades').delete().eq('ID Ujian', examId).eq('NIS Siswa', nisSiswa);
          await sb.from('ExamSessions').delete().eq('ID Ujian', examId).eq('NIS Siswa', nisSiswa);
        }
        return { success: true, message: 'Submisi siswa berhasil direset dan dihapus.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    // --- GRADES (REKAP NILAI) ---
    async getGrades(examId) {
      const sb = getClient();
      let query = sb.from('Grades').select('*');
      if (examId) query = query.eq('ID Ujian', examId);
      const { data, error } = await query;
      return { success: !error, data: data || [] };
    },

    async saveGrade(data) {
      try {
        const sb = getClient();
        const newId = generateId('NLI');
        const now = new Date().toISOString();
        const { error } = await sb.from('Grades').insert([{
          'ID Nilai': newId,
          'ID Ujian': data.idUjian,
          'Judul Ujian': data.judulUjian,
          'ID Mapel': data.idMapel || '',
          'Nama Mapel': data.namaMapel || '',
          'ID Kelas': data.idKelas || '',
          'Nama Kelas': data.namaKelas || '',
          'NIS Siswa': data.nisSiswa,
          'Nama Siswa': data.namaSiswa,
          'Nilai': Number(data.nilai || 0),
          'Jumlah Benar': Number(data.jumlahBenar || 0),
          'Jumlah Salah': Number(data.jumlahSalah || 0),
          'Total Soal': Number(data.totalSoal || 0),
          'Waktu Mulai': now,
          'Waktu Selesai': now,
          'Durasi Mengerjakan': data.durasi || '',
          'ID Guru': data.idGuru || '',
          'Nama Guru': data.namaGuru || '',
          'Catatan Guru': data.catatanGuru || '',
          'Nilai Akhir': Number(data.nilaiAkhir ?? data.nilai ?? 0),
          'Tanggal Input': now,
          'Status': data.status || 'selesai'
        }]);
        if (error) throw error;
        return { success: true, message: 'Nilai berhasil disimpan.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async updateGrade(id, data) {
      try {
        const sb = getClient();
        const { error } = await sb.from('Grades').update({
          'Nilai': Number(data.nilai),
          'Nilai Akhir': Number(data.nilaiAkhir ?? data.nilai),
          'Catatan Guru': data.catatanGuru,
          'Status': data.status
        }).eq('ID Nilai', id);
        if (error) throw error;
        return { success: true, message: 'Nilai berhasil diperbarui.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async deleteGrade(id) {
      try {
        const sb = getClient();
        const { error } = await sb.from('Grades').delete().eq('ID Nilai', id);
        if (error) throw error;
        return { success: true, message: 'Nilai berhasil dihapus.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async setGradeStatusFinish(examIdOrGradeId, nisSiswa, valNilaiAkhir, valCatatan, namaSiswa) {
      try {
        const sb = getClient();
        if (nisSiswa !== undefined && nisSiswa !== null) {
          const examId = examIdOrGradeId;
          const { data: grades } = await sb.from('Grades').select('*').eq('ID Ujian', examId);
          const targetNis = String(nisSiswa || '').trim().toLowerCase();
          const targetNama = String(namaSiswa || '').trim().toLowerCase();

          const match = (grades || []).find(g => {
            const gNis = (g['NIS Siswa'] || '').trim().toLowerCase();
            const gNama = (g['Nama Siswa'] || '').trim().toLowerCase();
            return (targetNis && gNis === targetNis) || (targetNama && gNama === targetNama);
          });

          const updateData = {
            'Status': 'final',
            'Catatan Guru': valCatatan || ''
          };
          if (valNilaiAkhir !== '' && valNilaiAkhir !== undefined && valNilaiAkhir !== '-') {
            updateData['Nilai Akhir'] = Number(valNilaiAkhir);
          }

          if (match) {
            await sb.from('Grades').update(updateData).eq('ID Nilai', match['ID Nilai']);
          } else {
            await sb.from('Grades').insert([{
              'ID Nilai': generateId('NLI'),
              'ID Ujian': examId,
              'NIS Siswa': nisSiswa,
              'Nama Siswa': namaSiswa || '',
              'Nilai': valNilaiAkhir || 0,
              'Nilai Akhir': valNilaiAkhir || 0,
              'Catatan Guru': valCatatan || '',
              'Status': 'final',
              'Tanggal Input': new Date().toISOString()
            }]);
          }

          // Update ExamSessions status to finished
          const { data: sessions } = await sb.from('ExamSessions').select('ID Sesi, NIS Siswa, Nama Siswa').eq('ID Ujian', examId);
          const matchSess = (sessions || []).find(s => {
            const sNis = (s['NIS Siswa'] || '').trim().toLowerCase();
            const sNama = (s['Nama Siswa'] || '').trim().toLowerCase();
            return (targetNis && sNis === targetNis) || (targetNama && sNama === targetNama);
          });
          if (matchSess) {
            await sb.from('ExamSessions').update({ 'Status Sesi': 'finished' }).eq('ID Sesi', matchSess['ID Sesi']);
          }

          return { success: true, message: 'Status nilai berhasil diubah menjadi FINISH & disimpan rapi!' };
        } else {
          await sb.from('Grades').update({ 'Status': 'final' }).eq('ID Nilai', examIdOrGradeId);
          return { success: true, message: 'Status nilai berhasil diubah menjadi FINISH.' };
        }
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    // --- ANNOUNCEMENTS (PENGUMUMAN) ---
    async getAnnouncements() {
      const sb = getClient();
      const { data, error } = await sb.from('Announcements').select('*').eq('Status', 'active');
      return { success: !error, data: data || [] };
    },

    async getAllAnnouncements() {
      const sb = getClient();
      const { data, error } = await sb.from('Announcements').select('*');
      return { success: !error, data: data || [] };
    },

    async createAnnouncement(data) {
      try {
        const sb = getClient();
        const newId = generateId('ANN');
        const now = new Date().toISOString();
        const { error } = await sb.from('Announcements').insert([{
          'ID': newId,
          'Judul': data.judul,
          'Konten': data.konten,
          'Kategori': data.kategori || 'Umum',
          'Prioritas': data.prioritas || 'Normal',
          'ID Pembuat': data.idPembuat || '',
          'Nama Pembuat': data.namaPembuat || 'Admin',
          'Role Pembuat': data.rolePembuat || 'admin',
          'Tanggal Buat': now,
          'Tanggal Update': now,
          'Status': data.status || 'active',
          'Gambar URL': data.gambarUrl || ''
        }]);
        if (error) throw error;
        return { success: true, message: 'Pengumuman berhasil dipublikasikan.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async updateAnnouncement(id, data) {
      try {
        const sb = getClient();
        const now = new Date().toISOString();
        const { error } = await sb.from('Announcements').update({
          'Judul': data.judul,
          'Konten': data.konten,
          'Kategori': data.kategori,
          'Prioritas': data.prioritas,
          'Status': data.status,
          'Gambar URL': data.gambarUrl,
          'Tanggal Update': now
        }).eq('ID', id);
        if (error) throw error;
        return { success: true, message: 'Pengumuman berhasil diperbarui.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async deleteAnnouncement(id) {
      try {
        _markIdDeleted('Announcements', id);
        const sb = getClient();
        await sb.from('Announcements').delete().or('ID.eq.' + id + ',"ID Pengumuman".eq.' + id);
        return { success: true, message: 'Pengumuman berhasil dihapus.' };
      } catch (e) {
        return { success: true, message: 'Pengumuman berhasil dihapus.' };
      }
    },

    // --- ATTENDANCE (ABSENSI) ---
    // --- ATTENDANCE (ABSENSI) ---
    async saveAttendance(attendanceList) {
      try {
        const sb = getClient();
        const now = new Date();
        const jamAbsen = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        if (!attendanceList || !attendanceList.length) return { success: false, message: 'Daftar absensi kosong.' };

        function normStatus(s) {
          const l = String(s || '').trim().toLowerCase();
          if (l === 'sakit') return 'Sakit';
          if (l === 'izin') return 'Izin';
          if (l === 'alpha' || l === 'alpa') return 'Alpa';
          return 'Hadir';
        }

        const first = attendanceList[0];
        const saveDate = first.tanggal;
        const targetClass = first.idKelas;
        const targetSubj = first.idMapel;

        // Hapus presensi lama jika menginput ulang tanggal, kelas, dan mapel yang sama agar tidak duplikat
        if (sb && saveDate && targetClass) {
          try {
            let delQuery = sb.from('Attendance').delete().eq('Tanggal', saveDate).eq('ID Kelas', targetClass);
            if (targetSubj) delQuery = delQuery.eq('ID Mapel', targetSubj);
            await delQuery;
          } catch (delErr) {
            console.warn('[saveAttendance] Note on clearing old rows:', delErr);
          }
        }

        const rows = (attendanceList || []).map(item => ({
          'ID Absen': generateId('ABS'),
          'Tanggal': item.tanggal,
          'Hari': getDayName(item.tanggal),
          'ID Kelas': item.idKelas,
          'Nama Kelas': item.namaKelas,
          'ID Guru': item.idGuru || '',
          'Nama Guru': item.namaGuru || '',
          'ID Mapel': item.idMapel || '',
          'Nama Mapel': item.namaMapel || '',
          'NIS Siswa': item.nisSiswa,
          'Nama Siswa': item.namaSiswa,
          'Status': normStatus(item.status),
          'Keterangan': item.keterangan || '',
          'Jam Absen': jamAbsen,
          'Diubah Oleh': item.namaGuru || item.idGuru || 'Guru',
          'Waktu Ubah': now.toISOString()
        }));

        if (sb) {
          const { error } = await sb.from('Attendance').insert(rows);
          if (error) throw error;
        }
        return { success: true, message: 'Absensi berhasil disimpan ke database.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async getAttendanceHistory(filter, maybeGuruId, maybeGuruNama) {
      try {
        const sb = getClient();
        if (!sb) return { success: false, message: 'Supabase client belum siap.', data: [] };

        let classId = '';
        let guruId = '';
        let guruNama = '';
        let tanggal = '';
        if (typeof filter === 'object' && filter !== null) {
          classId = filter.idKelas || filter.classId || '';
          guruId = filter.idGuru || filter.guruId || '';
          guruNama = filter.namaGuru || filter.guruNama || '';
          tanggal = filter.tanggal || '';
        } else {
          classId = filter || '';
          guruId = maybeGuruId || '';
          guruNama = maybeGuruNama || '';
        }

        let query = sb.from('Attendance').select('*');
        if (tanggal) query = query.eq('Tanggal', tanggal);
        query = query.order('Tanggal', { ascending: false });

        const { data, error } = await query;
        if (error) throw error;
        let rows = data || [];

        if (classId) {
          const cTarget = String(classId).trim().toLowerCase();
          rows = rows.filter(r => {
            const rId = String(r['ID Kelas'] || '').trim().toLowerCase();
            const rName = String(r['Nama Kelas'] || '').trim().toLowerCase();
            return rId === cTarget || rName === cTarget;
          });
        }

        if (guruId || guruNama) {
          const gIdTarget = String(guruId || '').trim().toLowerCase();
          const gNameTarget = String(guruNama || '').trim().toLowerCase();
          rows = rows.filter(r => {
            const rId = String(r['ID Guru'] || '').trim().toLowerCase();
            const rName = String(r['Nama Guru'] || '').trim().toLowerCase();
            const rBy = String(r['Diubah Oleh'] || '').trim().toLowerCase();
            const matchId = gIdTarget && (rId === gIdTarget || rBy === gIdTarget);
            const matchName = gNameTarget && (rName === gNameTarget || rName.includes(gNameTarget) || gNameTarget.includes(rName) || rBy.includes(gNameTarget));
            const matchCross = (gIdTarget && rName.includes(gIdTarget)) || (gNameTarget && rId === gNameTarget);
            return matchId || matchName || matchCross;
          });
        }

        // Kelompokkan baris berdasarkan sesi presensi (dengan array .siswa)
        const groupMap = {};
        rows.forEach(r => {
          const key = `${r['Tanggal'] || ''}__${r['ID Kelas'] || ''}__${r['ID Mapel'] || ''}__${r['ID Guru'] || ''}`;
          if (!groupMap[key]) {
            groupMap[key] = {
              tanggal: r['Tanggal'],
              hari: r['Hari'] || getDayName(r['Tanggal']),
              idKelas: r['ID Kelas'],
              namaKelas: r['Nama Kelas'],
              idGuru: r['ID Guru'],
              namaGuru: r['Nama Guru'],
              idMapel: r['ID Mapel'],
              namaMapel: r['Nama Mapel'],
              siswa: []
            };
          }
          groupMap[key].siswa.push(r);
        });

        const grouped = Object.values(groupMap);
        return { success: true, data: grouped };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async getAllAttendanceForPrint(classId, maybeGuruId, maybeGuruNama, startDate, endDate) {
      try {
        const sb = getClient();
        if (!sb) return { success: false, message: 'Supabase client belum siap.', data: [] };

        let query = sb.from('Attendance').select('*').order('Tanggal', { ascending: false });
        const { data, error } = await query;
        if (error) throw error;
        let rows = data || [];

        if (classId) {
          const cTarget = String(classId).trim().toLowerCase();
          rows = rows.filter(r => {
            const rId = String(r['ID Kelas'] || '').trim().toLowerCase();
            const rName = String(r['Nama Kelas'] || '').trim().toLowerCase();
            return rId === cTarget || rName === cTarget;
          });
        }

        let guruFilter = maybeGuruId || '';
        let guruNameFilter = maybeGuruNama || '';
        if (typeof maybeGuruId === 'string' && maybeGuruId.includes('-') && !maybeGuruId.startsWith('USR') && !maybeGuruId.includes(' ')) {
          startDate = maybeGuruId;
          guruFilter = '';
        }

        if (guruFilter || guruNameFilter) {
          const gIdTarget = String(guruFilter || '').trim().toLowerCase();
          const gNameTarget = String(guruNameFilter || '').trim().toLowerCase();
          rows = rows.filter(r => {
            const rId = String(r['ID Guru'] || '').trim().toLowerCase();
            const rName = String(r['Nama Guru'] || '').trim().toLowerCase();
            const rBy = String(r['Diubah Oleh'] || '').trim().toLowerCase();
            const matchId = gIdTarget && (rId === gIdTarget || rBy === gIdTarget);
            const matchName = gNameTarget && (rName === gNameTarget || rName.includes(gNameTarget) || gNameTarget.includes(rName) || rBy.includes(gNameTarget));
            const matchCross = (gIdTarget && rName.includes(gIdTarget)) || (gNameTarget && rId === gNameTarget);
            return matchId || matchName || matchCross;
          });
        }

        if (startDate && startDate.includes('-')) {
          rows = rows.filter(r => (r['Tanggal'] || '') >= startDate);
        }
        if (endDate && endDate.includes('-')) {
          rows = rows.filter(r => (r['Tanggal'] || '') <= endDate);
        }

        return { success: true, data: rows };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async updateAttendanceRecord(id, updateData) {
      try {
        const sb = getClient();
        const now = new Date().toISOString();
        let formattedStatus = updateData.status;
        if (formattedStatus) {
          const l = formattedStatus.trim().toLowerCase();
          formattedStatus = l === 'sakit' ? 'Sakit' : (l === 'izin' ? 'Izin' : (l === 'alpha' || l === 'alpa' ? 'Alpa' : 'Hadir'));
        }
        const { error } = await sb.from('Attendance').update({
          'Status': formattedStatus,
          'Keterangan': updateData.keterangan || '',
          'Waktu Ubah': now
        }).eq('ID Absen', id);
        if (error) throw error;
        return { success: true, message: 'Absensi berhasil diperbarui.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async deleteAttendanceRecord(id) {
      try {
        _markIdDeleted('Attendance', id);
        const sb = getClient();
        await sb.from('Attendance').delete().eq('ID Absen', id);
        return { success: true, message: 'Data presensi berhasil dihapus.' };
      } catch (e) {
        return { success: true, message: 'Data presensi berhasil dihapus.' };
      }
    },

    async deleteAttendanceSession(tanggal, idKelas, idGuru, idMapel) {
      try {
        const sb = getClient();
        let query = sb.from('Attendance').delete().eq('Tanggal', tanggal);
        if (idKelas) query = query.eq('ID Kelas', idKelas);
        if (idGuru) query = query.eq('ID Guru', idGuru);
        if (idMapel) query = query.eq('ID Mapel', idMapel);
        const { error } = await query;
        if (error) throw error;
        return { success: true, message: 'Sesi riwayat absensi berhasil dihapus.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    // --- VIOLATIONS (PELANGGARAN UJIAN) ---
    async getViolations(examId) {
      const sb = getClient();
      let query = sb.from('Violations').select('*');
      if (examId) query = query.eq('ID Ujian', examId);
      const { data, error } = await query;
      return { success: !error, data: data || [] };
    },

    // --- RUANG PEMBELAJARAN (LEARNING ROOM) ---
    _normalizeLearning(item) {
      if (!item || typeof item !== 'object') return item;
      let atts = item.attachments || item['Attachments'] || [];
      if (typeof atts === 'string') {
        try { atts = JSON.parse(atts); } catch (e) { atts = []; }
      }
      if (!Array.isArray(atts)) atts = [];

      let groups = item.groups || item['Groups'] || [];
      if (typeof groups === 'string') {
        try { groups = JSON.parse(groups); } catch (e) { groups = []; }
      }
      if (!Array.isArray(groups)) groups = [];

      let rawKelompok = item.pembagianKelompok || item['Pembagian Kelompok'] || item.kelompok || '';
      if (!rawKelompok && groups.length > 0) {
        rawKelompok = groups.map(g => `${g.groupName || 'Kelompok'}${g.ketua ? ' (Ketua: ' + g.ketua + ')' : ''}: ${(g.anggota || []).join(', ')}`).join('\n');
      }

      const hasTask = (item.hasTask === 'yes' || item['Ada Tugas'] === 'yes' || item.adaTugas === 'yes' || !!(item.taskInstructions || item['Instruksi Tugas'] || item.tugas)) ? 'yes' : 'no';
      const taskInstructions = item.taskInstructions || item['Instruksi Tugas'] || item.tugas || item.instruksiTugas || '';

      const finalId = item.id || item['ID'] || '';
      const finalJudul = item.judul || item['Judul'] || 'Materi Pembelajaran';
      const finalIdMapel = item.idMapel || item['ID Mapel'] || '';
      const finalNamaMapel = item.namaMapel || item['Nama Mapel'] || 'Umum';
      const finalIdKelas = item.idKelas || item['ID Kelas'] || '';
      const finalNamaKelas = item.namaKelas || item['Nama Kelas'] || 'Semua Kelas';
      const finalIdGuru = item.idGuru || item['ID Guru'] || '';
      const finalNamaGuru = item.namaGuru || item['Nama Guru'] || 'Guru Pengampu';
      const finalToken = (item.token || item['Token'] || '').trim().toUpperCase();
      const finalRingkasan = item.ringkasan || item['Ringkasan'] || '';
      const finalKonten = item.konten || item['Konten'] || '';
      const finalMediaUrl = item.mediaUrl || item['Media URL'] || item.media_url || '';
      const finalStatus = (item.status || item['Status'] || 'active').toLowerCase();
      const finalTanggalBuat = item.tanggalBuat || item['Tanggal Buat'] || item.created_at || new Date().toISOString();
      const finalTanggalUpdate = item.tanggalUpdate || item['Tanggal Update'] || new Date().toISOString();

      return {
        id: finalId,
        'ID': finalId,
        judul: finalJudul,
        'Judul': finalJudul,
        idMapel: finalIdMapel,
        'ID Mapel': finalIdMapel,
        namaMapel: finalNamaMapel,
        'Nama Mapel': finalNamaMapel,
        idKelas: finalIdKelas,
        'ID Kelas': finalIdKelas,
        namaKelas: finalNamaKelas,
        'Nama Kelas': finalNamaKelas,
        idGuru: finalIdGuru,
        'ID Guru': finalIdGuru,
        namaGuru: finalNamaGuru,
        'Nama Guru': finalNamaGuru,
        token: finalToken,
        'Token': finalToken,
        ringkasan: finalRingkasan,
        'Ringkasan': finalRingkasan,
        konten: finalKonten,
        'Konten': finalKonten,
        mediaUrl: finalMediaUrl,
        'Media URL': finalMediaUrl,
        attachments: atts,
        groups: groups,
        'Groups': groups,
        pembagianKelompok: rawKelompok,
        'Pembagian Kelompok': rawKelompok,
        hasTask: hasTask,
        'Ada Tugas': hasTask,
        taskInstructions: taskInstructions,
        'Instruksi Tugas': taskInstructions,
        tugas: taskInstructions,
        pdfUrl: PortalCloudStorage.hydrateFromVault(item.pdfUrl || item['PDF URL'] || ''),
        'PDF URL': PortalCloudStorage.hydrateFromVault(item['PDF URL'] || item.pdfUrl || ''),
        pdfName: item.pdfName || item['PDF Name'] || '',
        'PDF Name': item['PDF Name'] || item.pdfName || '',
        allowDownloadPdf: item.allowDownloadPdf || item['Izinkan Download PDF'] || 'yes',
        'Izinkan Download PDF': item['Izinkan Download PDF'] || item.allowDownloadPdf || 'yes',
        hasPdf: !!(item.hasPdf || item['Has PDF'] || item.pdfUrl || item['PDF URL'] || item.pdfName || item['PDF Name']),
        'Has PDF': !!(item['Has PDF'] || item.hasPdf || item['PDF URL'] || item.pdfUrl || item['PDF Name'] || item.pdfName),
        status: finalStatus,
        'Status': finalStatus,
        tanggalBuat: finalTanggalBuat,
        'Tanggal Buat': finalTanggalBuat,
        tanggalUpdate: finalTanggalUpdate,
        'Tanggal Update': finalTanggalUpdate
      };
    },

    async _loadLearningsStore() {
      const sb = getClient();
      let merged = [];
      const seenIds = new Set();

      if (sb) {
        try {
          const { data, error } = await sb.from('Settings').select('Value').eq('Key', 'app_learnings_data').maybeSingle();
          if (!error && data && data.Value) {
            const parsed = typeof data.Value === 'string' ? JSON.parse(data.Value) : data.Value;
            if (Array.isArray(parsed) && parsed.length > 0) {
              parsed.forEach(it => {
                const norm = this._normalizeLearning(it);
                const id = norm.id || norm.ID;
                if (id && !seenIds.has(id)) {
                  seenIds.add(id);
                  merged.push(norm);
                }
              });
            }
          }
        } catch (e) { }

        try {
          const { data, error } = await sb.from('Learnings').select('*').order('Tanggal Buat', { ascending: false });
          if (!error && Array.isArray(data) && data.length > 0) {
            data.forEach(it => {
              const norm = this._normalizeLearning(it);
              const id = norm.id || norm.ID;
              if (id && !seenIds.has(id)) {
                seenIds.add(id);
                merged.push(norm);
              }
            });
          }
        } catch (e) { }
      }

      if (merged.length === 0) {
        try {
          const local = localStorage.getItem('portal_learnings_data');
          if (local) {
            const parsed = JSON.parse(local);
            if (Array.isArray(parsed) && parsed.length > 0) {
              parsed.forEach(it => {
                const norm = this._normalizeLearning(it);
                const id = norm.id || norm.ID;
                if (id && !seenIds.has(id)) {
                  seenIds.add(id);
                  merged.push(norm);
                }
              });
            }
          }
        } catch (e) { }
      }

      return merged;
    },

    async _saveLearningsStore(list) {
      const normalized = (list || []).map(it => this._normalizeLearning(it));
      const sb = getClient();
      if (sb) {
        try {
          const safeNormalized = normalized.map(item => {
            const copy = { ...item };
            if (copy.pdfUrl && copy.pdfUrl.length > 100000) copy.pdfUrl = '';
            if (copy['PDF URL'] && copy['PDF URL'].length > 100000) copy['PDF URL'] = '';
            return copy;
          });
          await sb.from('Settings').upsert([{
            'Key': 'app_learnings_data',
            'Value': JSON.stringify(safeNormalized),
            'Label': 'Data Ruang Pembelajaran',
            'Keterangan': 'Sync modul ruang pembelajaran mandiri',
            'Diupdate': new Date().toISOString()
          }]);
        } catch (e) { }
      }
      try {
        localStorage.setItem('portal_learnings_data', JSON.stringify(normalized));
      } catch (e) { }
    },

    async getLearnings(filterGuruId) {
      try {
        const list = await this._loadLearningsStore();
        let result = list;
        if (filterGuruId && typeof filterGuruId === 'string' && filterGuruId.trim()) {
          const fStr = String(filterGuruId).trim().toLowerCase();
          result = list.filter(item => {
            const matchId = item.idGuru && String(item.idGuru).trim().toLowerCase() === fStr;
            const matchName = item.namaGuru && String(item.namaGuru).trim().toLowerCase().includes(fStr);
            return matchId || matchName;
          });
        }
        return { success: true, data: result };
      } catch (e) {
        return { success: false, message: e.message, data: [] };
      }
    },

    async getAllLearningMaterials(filterGuruId) {
      return this.getLearnings(filterGuruId);
    },

    async createLearning(data) {
      try {
        const list = await this._loadLearningsStore();
        const newId = generateId('LRN');
        const token = (data.token || ('LRN' + Math.random().toString(36).substr(2, 4)).toUpperCase()).trim().toUpperCase();

        let groups = data.groups || [];
        if (typeof groups === 'string') {
          try { groups = JSON.parse(groups); } catch (e) { groups = []; }
        }
        let rawKelompok = data.pembagianKelompok || data['Pembagian Kelompok'] || data.kelompok || '';
        if (!rawKelompok && groups.length > 0) {
          rawKelompok = groups.map(g => `${g.groupName || 'Kelompok'}${g.ketua ? ' (Ketua: ' + g.ketua + ')' : ''}: ${(g.anggota || []).join(', ')}`).join('\n');
        }

        const hasTask = (data.hasTask === 'yes' || data['Ada Tugas'] === 'yes' || !!data.taskInstructions) ? 'yes' : 'no';
        const taskInst = data.taskInstructions || data['Instruksi Tugas'] || data.tugas || '';

        const newItem = this._normalizeLearning({
          id: newId,
          judul: data.judul || 'Materi Pembelajaran Baru',
          idMapel: data.idMapel || '',
          namaMapel: data.namaMapel || '',
          idKelas: data.idKelas || '',
          namaKelas: data.namaKelas || 'Semua Kelas',
          idGuru: data.idGuru || '',
          namaGuru: data.namaGuru || 'Guru Pengampu',
          token: token,
          ringkasan: data.ringkasan || '',
          konten: data.konten || '',
          mediaUrl: data.mediaUrl || '',
          attachments: Array.isArray(data.attachments) ? data.attachments : [],
          groups: groups,
          pembagianKelompok: rawKelompok,
          hasTask: hasTask,
          taskInstructions: taskInst,
          status: data.status || 'active',
          tanggalBuat: new Date().toISOString()
        });

        list.unshift(newItem);
        await this._saveLearningsStore(list);

        const sb = getClient();
        if (sb) {
          try {
            await sb.from('Learnings').insert([{
              'ID': newItem['ID'] || newItem.id,
              'Judul': newItem['Judul'] || newItem.judul,
              'ID Mapel': newItem['ID Mapel'] || newItem.idMapel || '',
              'Nama Mapel': newItem['Nama Mapel'] || newItem.namaMapel || '',
              'ID Kelas': newItem['ID Kelas'] || newItem.idKelas || '',
              'Nama Kelas': newItem['Nama Kelas'] || newItem.namaKelas || '',
              'ID Guru': newItem['ID Guru'] || newItem.idGuru || '',
              'Nama Guru': newItem['Nama Guru'] || newItem.namaGuru || '',
              'Token': newItem['Token'] || newItem.token || '',
              'Ringkasan': newItem['Ringkasan'] || newItem.ringkasan || '',
              'Konten': newItem['Konten'] || newItem.konten || '',
              'Media URL': newItem['Media URL'] || newItem.mediaUrl || '',
              'Status': newItem['Status'] || newItem.status || 'active',
              'Tanggal Buat': newItem['Tanggal Buat'] || newItem.tanggalBuat || new Date().toISOString()
            }]);
          } catch (eTbl) { }
        }

        return { success: true, message: 'Pembelajaran berhasil dipublikasikan!', data: newItem };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async updateLearning(id, data) {
      try {
        const list = await this._loadLearningsStore();
        const idx = list.findIndex(item => item.id === id || item.ID === id);
        if (idx === -1) return { success: false, message: 'Data pembelajaran tidak ditemukan.' };

        let groups = data.groups !== undefined ? data.groups : list[idx].groups;
        if (typeof groups === 'string') {
          try { groups = JSON.parse(groups); } catch (e) { groups = []; }
        }
        let rawKelompok = data.pembagianKelompok !== undefined ? data.pembagianKelompok : list[idx].pembagianKelompok;
        if (!rawKelompok && groups && groups.length > 0) {
          rawKelompok = groups.map(g => `${g.groupName || 'Kelompok'}${g.ketua ? ' (Ketua: ' + g.ketua + ')' : ''}: ${(g.anggota || []).join(', ')}`).join('\n');
        }

        const hasTask = data.hasTask !== undefined ? data.hasTask : list[idx].hasTask;
        const taskInst = data.taskInstructions !== undefined ? data.taskInstructions : list[idx].taskInstructions;

        list[idx] = this._normalizeLearning({
          ...list[idx],
          judul: data.judul !== undefined ? data.judul : list[idx].judul,
          idMapel: data.idMapel !== undefined ? data.idMapel : list[idx].idMapel,
          namaMapel: data.namaMapel !== undefined ? data.namaMapel : list[idx].namaMapel,
          idKelas: data.idKelas !== undefined ? data.idKelas : list[idx].idKelas,
          namaKelas: data.namaKelas !== undefined ? data.namaKelas : list[idx].namaKelas,
          idGuru: data.idGuru !== undefined ? data.idGuru : list[idx].idGuru,
          namaGuru: data.namaGuru !== undefined ? data.namaGuru : list[idx].namaGuru,
          token: data.token ? data.token.trim().toUpperCase() : list[idx].token,
          ringkasan: data.ringkasan !== undefined ? data.ringkasan : list[idx].ringkasan,
          konten: data.konten !== undefined ? data.konten : list[idx].konten,
          mediaUrl: data.mediaUrl !== undefined ? data.mediaUrl : list[idx].mediaUrl,
          attachments: data.attachments !== undefined ? data.attachments : (list[idx].attachments || []),
          groups: groups,
          pembagianKelompok: rawKelompok,
          hasTask: hasTask,
          taskInstructions: taskInst,
          status: data.status !== undefined ? data.status : list[idx].status,
          tanggalUpdate: new Date().toISOString()
        });

        await this._saveLearningsStore(list);

        const sb = getClient();
        if (sb) {
          try {
            await sb.from('Learnings').update({
              'Judul': list[idx]['Judul'] || list[idx].judul,
              'ID Mapel': list[idx]['ID Mapel'] || list[idx].idMapel || '',
              'Nama Mapel': list[idx]['Nama Mapel'] || list[idx].namaMapel || '',
              'ID Kelas': list[idx]['ID Kelas'] || list[idx].idKelas || '',
              'Nama Kelas': list[idx]['Nama Kelas'] || list[idx].namaKelas || '',
              'ID Guru': list[idx]['ID Guru'] || list[idx].idGuru || '',
              'Nama Guru': list[idx]['Nama Guru'] || list[idx].namaGuru || '',
              'Token': list[idx]['Token'] || list[idx].token || '',
              'Ringkasan': list[idx]['Ringkasan'] || list[idx].ringkasan || '',
              'Konten': list[idx]['Konten'] || list[idx].konten || '',
              'Media URL': list[idx]['Media URL'] || list[idx].mediaUrl || '',
              'Status': list[idx]['Status'] || list[idx].status || 'active',
              'Tanggal Update': new Date().toISOString()
            }).eq('ID', id);
          } catch (eTbl) { }
        }

        return { success: true, message: 'Pembelajaran berhasil diperbarui!', data: list[idx] };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async deleteLearning(id) {
      try {
        _markIdDeleted('Learnings', id);
        let list = await this._loadLearningsStore();
        list = list.filter(item => item.id !== id && item.ID !== id);
        await this._saveLearningsStore(list);

        const sb = getClient();
        if (sb) {
          try {
            await sb.from('Learnings').delete().eq('ID', id);
          } catch (eTbl) { }
        }

        return { success: true, message: 'Pembelajaran berhasil dihapus.' };
      } catch (e) {
        return { success: true, message: 'Pembelajaran berhasil dihapus.' };
      }
    },

    async validateAndJoinLearning(namaSiswa, tokenInput) {
      try {
        if (!namaSiswa || !tokenInput) {
          return { success: false, message: 'Nama lengkap siswa dan token wajib diisi!' };
        }
        const cleanTok = tokenInput.trim().toUpperCase();
        const list = await this._loadLearningsStore();
        const match = list.find(item => {
          const itemTok = (item.token || item['Token'] || '').trim().toUpperCase();
          const itemId = (item.id || item['ID'] || '').trim().toUpperCase();
          const status = (item.status || item['Status'] || 'active').toLowerCase();
          return (itemTok === cleanTok || itemId === cleanTok) && status !== 'inactive';
        });

        if (!match) {
          return { success: false, message: 'Token Pembelajaran tidak valid atau materi sudah tidak aktif!' };
        }

        const normalizedMatch = this._normalizeLearning(match);

        // Catat kehadiran siswa (status aktif)
        const attendees = await this._loadLearningAttendeesStore();
        const now = new Date().toISOString();
        const attId = generateId('ATT');
        attendees.unshift({
          id: attId,
          idPembelajaran: normalizedMatch.id,
          judulPembelajaran: normalizedMatch.judul,
          namaSiswa: namaSiswa.trim(),
          waktuMasuk: now,
          waktuAkses: now,
          waktuKeluar: null,
          status: 'active'
        });
        await this._saveLearningAttendeesStore(attendees);

        // Sinkronkan ke tabel LearningSessions di Supabase
        const sb = getClient();
        if (sb) {
          try {
            await sb.from('LearningSessions').insert([{
              'ID': attId,
              'ID Pembelajaran': normalizedMatch.id,
              'Judul Pembelajaran': normalizedMatch.judul,
              'Nama Siswa': namaSiswa.trim(),
              'Waktu Masuk': now,
              'Catatan': 'Akses Siswa Web Portal'
            }]);
          } catch (eLs) { }
        }

        return {
          success: true,
          message: 'Berhasil bergabung!',
          learning: normalizedMatch,
          namaSiswa: namaSiswa.trim(),
          waktuMasuk: now,
          attendeeId: attId
        };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async recordLearningExit(attendeeId, learningId, namaSiswa) {
      try {
        const attendees = await this._loadLearningAttendeesStore();
        const now = new Date().toISOString();
        let updated = false;
        for (let a of attendees) {
          if ((attendeeId && a.id === attendeeId) || (!attendeeId && a.idPembelajaran === learningId && a.namaSiswa === namaSiswa && a.status === 'active')) {
            a.waktuKeluar = now;
            a.status = 'selesai';
            updated = true;
            break;
          }
        }
        if (updated) {
          await this._saveLearningAttendeesStore(attendees);
        }
        return { success: true, message: 'Kehadiran sesi belajar selesai dicatat' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async getLearningAttendees(learningId) {
      try {
        const attendees = await this._loadLearningAttendeesStore();
        const filtered = learningId ? attendees.filter(a => a.idPembelajaran === learningId || a['ID Pembelajaran'] === learningId) : attendees;
        return { success: true, data: filtered };
      } catch (e) {
        return { success: false, message: e.message, data: [] };
      }
    },

    async _loadLearningAttendeesStore() {
      const sb = getClient();
      let attendees = [];
      const seen = new Set();

      if (sb) {
        // 1. Ambil dari Settings
        try {
          const { data, error } = await sb.from('Settings').select('Value').eq('Key', 'app_learning_attendees_data').maybeSingle();
          if (!error && data && data.Value) {
            const parsed = typeof data.Value === 'string' ? JSON.parse(data.Value) : data.Value;
            if (Array.isArray(parsed)) {
              parsed.forEach(a => {
                const k = (a.idPembelajaran || a['ID Pembelajaran'] || '') + '_' + (a.nisSiswa || a.namaSiswa || a['Nama Siswa'] || '');
                if (!seen.has(k)) {
                  seen.add(k);
                  attendees.push(a);
                }
              });
            }
          }
        } catch (e) { }

        // 2. Ambil dari tabel LearningSessions (diinput oleh siswa via Android / mobile app)
        try {
          const { data: sessRows, error: sessErr } = await sb.from('LearningSessions').select('*');
          if (!sessErr && Array.isArray(sessRows)) {
            sessRows.forEach(ls => {
              const lId = ls['ID Pembelajaran'] || ls.idPembelajaran;
              const sN = ls['Nama Siswa'] || ls.namaSiswa;
              const k = (lId || '') + '_' + (sN || '');
              if (!seen.has(k)) {
                seen.add(k);
                attendees.push({
                  id: ls['ID'] || ls.id || ('ATT-' + Math.random().toString(36).substr(2, 6)),
                  idPembelajaran: lId,
                  judulPembelajaran: ls['Judul Pembelajaran'] || ls.judulPembelajaran || '',
                  namaSiswa: sN,
                  waktuMasuk: ls['Waktu Masuk'] || ls.waktuMasuk,
                  waktuAkses: ls['Waktu Masuk'] || ls.waktuMasuk,
                  waktuKeluar: ls['Waktu Keluar'] || null,
                  status: (ls['Catatan'] && ls['Catatan'].toLowerCase().includes('tugas')) ? 'tugas_dikumpulkan' : 'active',
                  tugasCatatan: ls['Catatan'] || ''
                });
              }
            });
          }
        } catch (e2) { }
      }

      if (attendees.length === 0) {
        try {
          const local = localStorage.getItem('portal_learning_attendees_data');
          if (local) {
            const parsed = JSON.parse(local);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
          }
        } catch (e) { }
      }

      return attendees;
    },

    async _saveLearningAttendeesStore(list) {
      const sb = getClient();
      if (sb) {
        try {
          await sb.from('Settings').upsert([{
            'Key': 'app_learning_attendees_data',
            'Value': JSON.stringify(list || []),
            'Label': 'Data Hadir Ruang Belajar',
            'Keterangan': 'Sync riwayat siswa masuk & keluar ruang pembelajaran',
            'Diupdate': new Date().toISOString()
          }]);
        } catch (e) { }
      }
      try {
        localStorage.setItem('portal_learning_attendees_data', JSON.stringify(list || []));
      } catch (e) { }
    },

    // ── FORUM DISKUSI INTERAKTIF RUANG PEMBELAJARAN ──
    async getLearningDiscussions(learningId) {
      try {
        const all = await this._loadLearningDiscussionsStore();
        const filtered = learningId ? all.filter(d => (d.idPembelajaran === learningId || d['ID Pembelajaran'] === learningId)) : all;
        return { success: true, data: filtered };
      } catch (e) {
        return { success: false, message: e.message, data: [] };
      }
    },

    async postLearningComment(learningId, commentData) {
      try {
        if (!commentData || !commentData.content || !commentData.content.trim()) {
          return { success: false, message: 'Isi pertanyaan atau komentar wajib diisi!' };
        }
        const all = await this._loadLearningDiscussionsStore();
        const now = new Date().toISOString();
        const newComment = {
          id: generateId('DSC'),
          idPembelajaran: learningId,
          senderName: (commentData.senderName || 'Anonim').trim(),
          senderRole: commentData.senderRole || 'siswa', // 'siswa' atau 'guru' atau 'admin'
          senderId: commentData.senderId || '',
          category: commentData.category || 'pertanyaan',
          content: commentData.content.trim(),
          parentId: commentData.parentId || null,
          createdAt: now,
          timestamp: now
        };
        all.push(newComment);
        await this._saveLearningDiscussionsStore(all);
        return { success: true, message: 'Pesan berhasil dikirim ke forum diskusi!', data: newComment };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async deleteLearningComment(learningId, commentId) {
      try {
        let all = await this._loadLearningDiscussionsStore();
        all = all.filter(c => c.id !== commentId && c.parentId !== commentId);
        await this._saveLearningDiscussionsStore(all);
        return { success: true, message: 'Komentar diskusi berhasil dihapus.' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async _loadLearningDiscussionsStore() {
      const sb = getClient();
      if (sb) {
        try {
          const { data, error } = await sb.from('Settings').select('Value').eq('Key', 'app_learning_discussions_data').maybeSingle();
          if (!error && data && data.Value) {
            const parsed = typeof data.Value === 'string' ? JSON.parse(data.Value) : data.Value;
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
          }
        } catch (e) { }
      }
      try {
        const local = localStorage.getItem('portal_learning_discussions_data');
        if (local) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (e) { }

      // Tidak ada dummy data diskusi
      return [];
    },

    async _saveLearningDiscussionsStore(list) {
      const sb = getClient();
      if (sb) {
        try {
          await sb.from('Settings').upsert([{
            'Key': 'app_learning_discussions_data',
            'Value': JSON.stringify(list || []),
            'Label': 'Data Diskusi Ruang Pembelajaran',
            'Keterangan': 'Sync forum tanya jawab & saran materi pembelajaran',
            'Diupdate': new Date().toISOString()
          }]);
        } catch (e) { }
      }
      try {
        localStorage.setItem('portal_learning_discussions_data', JSON.stringify(list || []));
      } catch (e) { }
    },

    // ── PENGUMPULAN TUGAS SISWA ──
    async _loadLearningTasksStore() {
      const sb = getClient();
      if (sb) {
        try {
          const { data, error } = await sb.from('Settings').select('Value').eq('Key', 'app_learning_tasks_data').maybeSingle();
          if (!error && data && data.Value) {
            const parsed = typeof data.Value === 'string' ? JSON.parse(data.Value) : data.Value;
            if (Array.isArray(parsed)) return parsed;
          }
        } catch (e) { }
      }
      try {
        const local = localStorage.getItem('portal_learning_tasks_data');
        if (local) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (e) { }
      return [];
    },

    async _saveLearningTasksStore(list) {
      const sb = getClient();
      if (sb) {
        try {
          await sb.from('Settings').upsert([{
            'Key': 'app_learning_tasks_data',
            'Value': JSON.stringify(list || []),
            'Label': 'Data Tugas Ruang Pembelajaran',
            'Keterangan': 'Sync lembar tugas siswa terintegrasi',
            'Diupdate': new Date().toISOString()
          }]);
        } catch (e) { }
      }
      try {
        localStorage.setItem('portal_learning_tasks_data', JSON.stringify(list || []));
      } catch (e) { }
    },

    async getLearningTasks(learningId) {
      try {
        const all = await this._loadLearningTasksStore();
        // Gabungkan juga dari app_learning_attendees_data jika ada siswa yang mengunggah tugas di sana
        const attendees = await this._loadLearningAttendeesStore();
        attendees.forEach(att => {
          if (att.tugasFile || att.tugasCatatan || att.status === 'tugas_dikumpulkan') {
            const attLrnId = att.idPembelajaran || att.learningId;
            const exists = all.some(t => (t.learningId === attLrnId) && ((t.studentNis && t.studentNis === att.nisSiswa) || (t.studentName && t.studentName === att.namaSiswa)));
            if (!exists) {
              all.push({
                id: att.id || ('TSK-' + Math.random().toString(36).substr(2, 6)),
                learningId: attLrnId,
                judul: att.judulPembelajaran || att.judul || '',
                studentName: att.namaSiswa || att.studentName || '',
                studentNis: att.nisSiswa || att.studentNis || '',
                className: att.namaKelas || att.className || '',
                taskNote: att.tugasCatatan || att.taskNote || '',
                taskFile: att.tugasFile || att.taskFile || '',
                taskFileName: att.tugasFileName || att.taskFileName || '',
                submittedAt: att.tugasWaktu || att.waktuMasuk || new Date().toISOString()
              });
            }
          }
        });
        const filtered = learningId ? all.filter(t => t.learningId === learningId || t.idPembelajaran === learningId) : all;
        return { success: true, data: filtered };
      } catch (e) {
        return { success: false, message: e.message, data: [] };
      }
    },

    async submitLearningTask(taskData) {
      try {
        const all = await this._loadLearningTasksStore();
        const finalId = taskData.id || generateId('TSK');
        const now = new Date().toISOString();
        const newRecord = {
          id: finalId,
          learningId: taskData.learningId,
          judul: taskData.judul || '',
          studentName: taskData.studentName || '',
          studentNis: taskData.studentNis || '',
          className: taskData.className || '',
          taskNote: taskData.taskNote || '',
          taskFile: taskData.taskFile || '',
          taskFileName: taskData.taskFileName || '',
          submittedAt: now
        };

        const idx = all.findIndex(t => (t.learningId === taskData.learningId) && (t.studentNis && t.studentNis === taskData.studentNis));
        if (idx !== -1) all[idx] = newRecord;
        else all.unshift(newRecord);

        await this._saveLearningTasksStore(all);

        // Update juga ke attendees store jika attendee sudah ada
        try {
          const attendees = await this._loadLearningAttendeesStore();
          const attIdx = attendees.findIndex(a => (a.idPembelajaran === taskData.learningId) && (a.nisSiswa === taskData.studentNis || a.namaSiswa === taskData.studentName));
          if (attIdx !== -1) {
            attendees[attIdx].status = 'tugas_dikumpulkan';
            attendees[attIdx].tugasCatatan = taskData.taskNote || '';
            attendees[attIdx].tugasFile = taskData.taskFile || '';
            attendees[attIdx].tugasFileName = taskData.taskFileName || '';
            attendees[attIdx].tugasWaktu = now;
            await this._saveLearningAttendeesStore(attendees);
          }
        } catch (eAtt) { }

        return { success: true, message: 'Tugas berhasil dikumpulkan!', data: newRecord };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    // ══════════════════════════════════════════════════════════════════
    // SPMB (SISTEM PENERIMAAN MURID BARU) HANDLERS
    // ══════════════════════════════════════════════════════════════════
    async _loadSpmbStore() {
      const isDummySpmbItem = (item) => {
        if (!item) return true;
        const nisn = String(item.nisn || '').trim();
        const nama = String(item.namaLengkap || '').trim().toUpperCase();
        const sekolah = String(item.asalSekolah || '').trim().toUpperCase();
        return (
          nisn === '0089123456' ||
          nisn === '9080706050' ||
          nama === 'BUDI SANTOSOS' ||
          sekolah.includes('CONTOH')
        );
      };
      const sb = getClient();
      if (sb) {
        try {
          const { data, error } = await sb.from('Settings').select('Value').eq('Key', 'app_spmb_registrations').maybeSingle();
          if (!error && data && data.Value) {
            const parsed = JSON.parse(data.Value);
            if (Array.isArray(parsed)) {
              const cleaned = parsed.filter(item => !isDummySpmbItem(item));
              try {
                localStorage.setItem('portal_spmb_registrations', JSON.stringify(cleaned));
              } catch (e) { }
              return cleaned;
            }
          }
        } catch (e) { }
      }
      try {
        const local = localStorage.getItem('portal_spmb_registrations');
        if (local) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) {
            return parsed.filter(item => !isDummySpmbItem(item));
          }
        }
      } catch (e) { }

      return [];
    },

    async _saveSpmbStore(list) {
      const sb = getClient();
      if (sb) {
        try {
          await sb.from('Settings').upsert([{
            'Key': 'app_spmb_registrations',
            'Value': JSON.stringify(list),
            'Label': 'Data SPMB Pendaftar Baru',
            'Keterangan': 'Sync data pendaftaran penerimaan murid baru online',
            'Diupdate': new Date().toISOString()
          }], { onConflict: 'Key' });
        } catch (e) { }
      }
      try {
        localStorage.setItem('portal_spmb_registrations', JSON.stringify(list));
      } catch (e) { }
    },

    async getSpmbRegistrations(filterStatus, filterJalur) {
      return this.getSpmbList(filterStatus, filterJalur);
    },

    async registerSpmb(data) {
      return this.submitSpmbRegistration(data);
    },

    async getSpmbStatus(nisnOrNoReg) {
      return this.checkSpmbStatus(nisnOrNoReg);
    },

    async getSpmbList(filterStatus, filterJalur) {
      try {
        let list = await this._loadSpmbStore();
        if (filterStatus && filterStatus !== 'all') {
          list = list.filter(item => (item.status || 'menunggu').toLowerCase() === filterStatus.toLowerCase());
        }
        if (filterJalur && filterJalur !== 'all') {
          list = list.filter(item => (item.jalurPendaftaran || '').toLowerCase() === filterJalur.toLowerCase());
        }
        return { success: true, data: list };
      } catch (e) {
        return { success: false, message: e.message, data: [] };
      }
    },

    async getSpmbById(id) {
      try {
        const list = await this._loadSpmbStore();
        const found = list.find(item => item.id === id);
        if (!found) return { success: false, message: 'Data pendaftar tidak ditemukan.' };
        return { success: true, data: found };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async submitSpmbRegistration(data) {
      try {
        if (!data.namaLengkap || !data.nisn) {
          return { success: false, message: 'Nama lengkap dan NISN calon siswa wajib diisi!' };
        }
        const list = await this._loadSpmbStore();

        // Cek apakah NISN sudah terdaftar
        const existing = list.find(item => item.nisn === data.nisn.trim());
        if (existing) {
          return {
            success: false,
            message: 'NISN ' + data.nisn + ' sudah pernah didaftarkan pada nomor registrasi ' + (existing.nomorPendaftaran || existing.id) + '!'
          };
        }

        const nextNum = list.length + 1;
        const regCode = 'SPMB-2026-' + String(nextNum).padStart(4, '0');
        const regNomor = 'SPMB/2026/' + String(nextNum).padStart(4, '0');

        const newApplicant = {
          id: regCode,
          nomorPendaftaran: regNomor,
          tanggalDaftar: new Date().toISOString(),
          status: 'menunggu',
          catatanPetugas: 'Pendaftaran baru diterima, menunggu verifikasi berkas.',
          verifikator: '',
          // 1. Data Akun & Registrasi Awal
          nisn: (data.nisn || '').trim(),
          nik: (data.nik || '').trim(),
          namaLengkap: (data.namaLengkap || '').trim(),
          tempatLahir: (data.tempatLahir || '').trim(),
          tanggalLahir: (data.tanggalLahir || '').trim(),
          asalSekolah: (data.asalSekolah || '').trim(),
          jenjangAsal: (data.jenjangAsal || 'SMP').trim(),
          tahunLulus: (data.tahunLulus || '2026').trim(),
          jalurPendaftaran: (data.jalurPendaftaran || 'Zonasi/Domisili').trim(),
          // 2. Biodata Calon Siswa & Orang Tua
          jenisKelamin: (data.jenisKelamin || 'Laki-laki').trim(),
          agama: (data.agama || 'Islam').trim(),
          namaIbuKandung: (data.namaIbuKandung || '').trim(),
          nomorKk: (data.nomorKk || '').trim(),
          namaAyahWali: (data.namaAyahWali || '').trim(),
          teleponOrtu: (data.teleponOrtu || '').trim(),
          pekerjaanOrtu: (data.pekerjaanOrtu || '').trim(),
          kebutuhanKhusus: (data.kebutuhanKhusus || 'Tidak Ada').trim(),
          // 3. Data Alamat & Titik Domisili
          provinsi: (data.provinsi || 'Sulawesi Tenggara').trim(),
          kabupaten: (data.kabupaten || 'Muna Barat').trim(),
          kecamatan: (data.kecamatan || '').trim(),
          desaKelurahan: (data.desaKelurahan || '').trim(),
          rtRw: (data.rtRw || '').trim(),
          kodePos: (data.kodePos || '').trim(),
          alamatLengkap: (data.alamatLengkap || '').trim(),
          titikKoordinat: (data.titikKoordinat || '').trim(),
          fotoRumah: data.fotoRumah || '',
          // 4. Data Akademik & Nilai Rapor
          nilaiRataRata: (data.nilaiRataRata || '0.00').trim(),
          detailNilai: data.detailNilai || {},
          // 5. Dokumen Persyaratan
          dokumen: data.dokumen || {}
        };

        list.unshift(newApplicant);
        await this._saveSpmbStore(list);
        return {
          success: true,
          message: 'Pendaftaran SPMB Berhasil Dikirim!',
          data: newApplicant
        };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async updateSpmbStatus(id, newStatus, catatan, verifikatorNama) {
      try {
        const list = await this._loadSpmbStore();
        const idx = list.findIndex(item => item.id === id);
        if (idx === -1) return { success: false, message: 'Data pendaftar tidak ditemukan.' };

        list[idx].status = newStatus;
        if (catatan !== undefined) list[idx].catatanPetugas = catatan;
        if (verifikatorNama) list[idx].verifikator = verifikatorNama;
        list[idx].tanggalVerifikasi = new Date().toISOString();

        await this._saveSpmbStore(list);
        return { success: true, message: 'Status verifikasi pendaftaran berhasil diperbarui!' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async updateSpmbRegistration(id, updatedData) {
      try {
        const list = await this._loadSpmbStore();
        const idx = list.findIndex(item => item.id === id);
        if (idx === -1) return { success: false, message: 'Data pendaftar tidak ditemukan.' };

        list[idx] = {
          ...list[idx],
          ...updatedData,
          id: list[idx].id,
          nomorPendaftaran: list[idx].nomorPendaftaran,
          tanggalUpdate: new Date().toISOString()
        };

        await this._saveSpmbStore(list);
        return { success: true, message: 'Data pendaftar SPMB berhasil diperbarui!' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    async deleteSpmb(id) {
      try {
        _markIdDeleted('SPMB', id);
        let list = await this._loadSpmbStore();
        list = list.filter(item => item.id !== id && item.noRegistrasi !== id);
        await this._saveSpmbStore(list);
        return { success: true, message: 'Data pendaftar berhasil dihapus.' };
      } catch (e) {
        return { success: true, message: 'Data pendaftar berhasil dihapus.' };
      }
    },

    async checkSpmbStatus(nisnOrNoReg) {
      try {
        if (!nisnOrNoReg) return { success: false, message: 'Masukkan NISN atau Nomor Pendaftaran!' };
        const query = String(nisnOrNoReg).trim().toLowerCase();
        const list = await this._loadSpmbStore();
        const match = list.find(item => {
          return (item.nisn && item.nisn.toLowerCase() === query) ||
            (item.id && item.id.toLowerCase() === query) ||
            (item.nomorPendaftaran && item.nomorPendaftaran.toLowerCase() === query);
        });
        if (!match) {
          return { success: false, message: 'Data pendaftar dengan NISN / Nomor "' + nisnOrNoReg + '" tidak ditemukan.' };
        }
        return { success: true, data: match };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    // ══════════════════════════════════════════════════════════════════
    // BACKUP, RESTORE & GANTI DATA PER-SEMESTER FORMAT .BACKUP (POSTGRESQL CLUSTER DUMP SUPABASE)
    // ══════════════════════════════════════════════════════════════════
    _unescapePgCopyVal(val) {
      if (val === '\\N' || val === undefined || val === null) return '';
      return String(val).replace(/\\([bfnrtv\\])/g, (match, ch) => {
        switch (ch) {
          case 'b': return '\b';
          case 'f': return '\f';
          case 'n': return '\n';
          case 'r': return '\r';
          case 't': return '\t';
          case 'v': return '\v';
          case '\\': return '\\';
          default: return ch;
        }
      });
    },

    _escapePgCopyVal(val) {
      if (val === null || val === undefined) return '\\N';
      const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
      return s
        .replace(/\\/g, '\\\\')
        .replace(/\t/g, '\\t')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
    },

    parsePostgresBackupDump(rawText, fileName = 'db_cluster.backup') {
      if (!rawText) throw new Error('Isi file .backup kosong.');
      if (typeof rawText === 'object' && rawText.tables) return rawText;
      const trimmed = String(rawText).trim();

      // Jika file ternyata berformat JSON, tetap dukung otomatis
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const parsedJson = JSON.parse(trimmed);
        if (parsedJson && parsedJson.tables) return parsedJson;
      }

      const NUMERIC_COLS = new Set([
        'Kapasitas', 'Jumlah Siswa', 'SKS', 'Durasi (menit)', 'Jumlah Soal',
        'Total Nilai', 'Batas Pelanggaran', 'Nomor Soal', 'Poin', 'Nilai',
        'Jumlah Benar', 'Jumlah Salah', 'Total Soal', 'Nilai Akhir',
        'Jumlah Pelanggaran', 'Pelanggaran'
      ]);

      const KNOWN_TEACHER_PHOTOS = {
        'USRMVL3A5K7HB02': 'cloud-media/teachers/USRMVL3A5K7HB02.jpg',
        'USRMVL3KPCGXBVZ': 'cloud-media/teachers/USRMVL3KPCGXBVZ.jpg',
        'USRMVLS1SJ33FOG': 'cloud-media/teachers/USRMVLS1SJ33FOG.jpg',
        'USRMVLZ3DDLIH3T': 'cloud-media/teachers/USRMVLZ3DDLIH3T.jpg',
        'USRMVM21Z6SHJZ6': 'cloud-media/teachers/USRMVM21Z6SHJZ6.jpg',
        'USRMVNUMVEGZ2GE': 'cloud-media/teachers/USRMVNUMVEGZ2GE.jpg',
        'USRMVNV3EY0Z0Q3': 'cloud-media/teachers/USRMVNV3EY0Z0Q3.jpg',
        'USRMVNV7HLF8OWP': 'cloud-media/teachers/USRMVNV7HLF8OWP.jpg',
        'USRMVNVCZN3F8R4': 'cloud-media/teachers/USRMVNVCZN3F8R4.jpg',
        'USRMVNVFO9PWZ0V': 'cloud-media/teachers/USRMVNVFO9PWZ0V.jpg',
        'USRMVNVP3CZIRSB': 'cloud-media/teachers/USRMVNVP3CZIRSB.jpg',
        'USRMVNVSCESNYR7': 'cloud-media/teachers/USRMVNVSCESNYR7.jpg',
        'USRMVNVVHPWXA14': 'cloud-media/teachers/USRMVNVVHPWXA14.jpg',
        'USRMVNVYN602X02': 'cloud-media/teachers/USRMVNVYN602X02.jpg',
        'USRMVNW1D0B50GO': 'cloud-media/teachers/USRMVNW1D0B50GO.jpg',
        'USRMVNW49WI05H2': 'cloud-media/teachers/USRMVNW49WI05H2.jpg',
        'USRMVNW8O3OOQO5': 'cloud-media/teachers/USRMVNW8O3OOQO5.jpg',
        'USRMVNWB9YX4NR2': 'cloud-media/teachers/USRMVNWB9YX4NR2.jpg',
        'USRMVNWEUE9L58E': 'cloud-media/teachers/USRMVNWEUE9L58E.jpg',
        'USRMVNWGZ579WL1': 'cloud-media/teachers/USRMVNWGZ579WL1.jpg',
        'USRMVNWJ01WHJYI': 'cloud-media/teachers/USRMVNWJ01WHJYI.jpg',
        'USRMVNWNM4N3REE': 'cloud-media/teachers/USRMVNWNM4N3REE.jpg',
        'USRMVNWPN4BGC91': 'cloud-media/teachers/USRMVNWPN4BGC91.jpg',
        'USRMVOW3VFZ8LCZ': 'cloud-media/teachers/admin-avatar.jpg'
      };

      const lines = String(rawText).split(/\r?\n/);
      const tables = {};
      const summary = {};
      let totalRows = 0;
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith('COPY public.')) {
          const m = line.match(/^COPY\s+public\."?([^"\s(]+)"?\s*\((.+)\)\s*FROM\s+stdin;/i);
          if (m) {
            const tableName = m[1].trim();
            const cols = m[2].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
            const rows = [];
            i++;
            while (i < lines.length && lines[i] !== '\\.') {
              const rowLine = lines[i];
              if (rowLine.length > 0) {
                const parts = rowLine.split('\t');
                const obj = {};
                for (let c = 0; c < cols.length; c++) {
                  const colName = cols[c];
                  const rawVal = parts[c] !== undefined ? parts[c] : '\\N';
                  let val = this._unescapePgCopyVal(rawVal);
                  if (NUMERIC_COLS.has(colName)) {
                    val = val === '' ? 0 : (isNaN(Number(val)) ? val : Number(val));
                  }
                  obj[colName] = val;
                }
                // Optimasi foto profil guru Base64 ke file aset atau vault
                if (tableName === 'Users') {
                  const uId = String(obj['ID'] || '').trim();
                  const fUrl = String(obj['Foto Profil URL'] || '');
                  if (fUrl.startsWith('data:') && KNOWN_TEACHER_PHOTOS[uId]) {
                    obj['Foto Profil URL'] = KNOWN_TEACHER_PHOTOS[uId];
                  }
                }
                rows.push(obj);
              }
              i++;
            }
            tables[tableName] = rows;
            summary[tableName] = rows.length;
            totalRows += rows.length;
          }
        }
        i++;
      }

      if (Object.keys(tables).length === 0) {
        throw new Error('Tidak ditemukan blok tabel PostgreSQL (COPY public."..." FROM stdin;) di dalam file .backup ini.');
      }

      // Ekstrak Settings & Extra Stores dari COPY public."Settings"
      const settingsMap = {};
      let spmbRegistrations = [];
      let learnings = Array.isArray(tables.Learnings) ? tables.Learnings.slice() : [];
      let learningDiscussions = [];
      let learningAttendees = [];
      let learningTasks = [];
      let guruExtraMetadata = {};
      let galleryImages = [];

      if (Array.isArray(tables.Settings)) {
        tables.Settings.forEach(row => {
          const k = row.Key;
          let v = row.Value || '';
          if (!k) return;

          if (k === 'school_logo_url' && v.startsWith('data:')) {
            v = 'cloud-media/settings/school-logo.jpg';
            row.Value = v;
          } else if (k === 'school_background_url' && v.startsWith('data:')) {
            v = 'cloud-media/settings/school-bg.jpg';
            row.Value = v;
          } else if (k === 'principal_photo' && v.startsWith('data:')) {
            v = 'cloud-media/settings/principal-photo.jpg';
            row.Value = v;
          } else if (k === 'app_learnings_data') {
            try {
              const parsedLrn = JSON.parse(v);
              if (Array.isArray(parsedLrn)) {
                parsedLrn.forEach(item => {
                  if (Array.isArray(item.attachments)) {
                    item.attachments.forEach(att => {
                      if (att.name === 'Fisika-BS-KLS-XI-39-48.pdf' && att.dataUrl && att.dataUrl.startsWith('data:')) {
                        att.dataUrl = 'cloud-media/learnings/Fisika-BS-KLS-XI-39-48.pdf';
                      } else if (att.name && att.name.includes('KartuUjian_7403010707990002') && att.dataUrl && att.dataUrl.startsWith('data:')) {
                        att.dataUrl = 'cloud-media/learnings/KartuUjian_7403010707990002_1758369091280.pdf';
                      }
                    });
                  }
                  if (item.pdfUrl && item.pdfUrl.startsWith('data:')) {
                    if ((item.pdfName || '').includes('Fisika-BS-KLS-XI')) {
                      item.pdfUrl = 'cloud-media/learnings/Fisika-BS-KLS-XI-39-48.pdf';
                      item['PDF URL'] = item.pdfUrl;
                    } else if ((item.pdfName || '').includes('KartuUjian_7403010707990002')) {
                      item.pdfUrl = 'cloud-media/learnings/KartuUjian_7403010707990002_1758369091280.pdf';
                      item['PDF URL'] = item.pdfUrl;
                    }
                  }
                });
                learnings = parsedLrn;
                row.Value = JSON.stringify(parsedLrn);
              }
            } catch (e) { }
          } else if (k === 'app_learning_discussions_data') {
            try { learningDiscussions = JSON.parse(v) || []; } catch (e) { }
          } else if (k === 'app_learning_attendees_data') {
            try { learningAttendees = JSON.parse(v) || []; } catch (e) { }
          } else if (k === 'app_learning_tasks_data') {
            try { learningTasks = JSON.parse(v) || []; } catch (e) { }
          } else if (k === 'app_spmb_registrations') {
            try {
              const parsedSpmb = JSON.parse(v) || [];
              spmbRegistrations = parsedSpmb.filter(s => {
                if (!s) return false;
                const nm = String(s.namaLengkap || '').toUpperCase();
                const sk = String(s.asalSekolah || '').toUpperCase();
                return nm !== 'BUDI SANTOSOS' && !sk.includes('CONTOH');
              });
              row.Value = JSON.stringify(spmbRegistrations);
            } catch (e) { }
          } else if (k === 'gallery_images') {
            try {
              const parsedGal = JSON.parse(v) || [];
              if (Array.isArray(parsedGal)) {
                parsedGal.forEach((g, idx) => {
                  if (g && g.url && g.url.startsWith('data:') && idx < 10) {
                    g.url = `cloud-media/gallery/gallery-${idx + 1}.jpg`;
                  }
                });
                galleryImages = parsedGal;
                row.Value = JSON.stringify(parsedGal);
              }
            } catch (e) { }
          } else if (k === 'guru_extra_metadata') {
            try { guruExtraMetadata = JSON.parse(v) || {}; } catch (e) { }
          }
          settingsMap[k] = row.Value;
        });
      }

      if ((!tables.Learnings || tables.Learnings.length === 0) && learnings.length > 0) {
        tables.Learnings = learnings.map(l => this._normalizeLearning(l));
        summary.Learnings = tables.Learnings.length;
      }

      // Gabungkan guruExtraMetadata (Jenis Kelamin & Jenis PTK) ke dalam baris Users
      if (Array.isArray(tables.Users) && guruExtraMetadata && typeof guruExtraMetadata === 'object') {
        tables.Users.forEach(u => {
          const meta = guruExtraMetadata[u.ID] || guruExtraMetadata[u.Username] || {};
          if (!u['Jenis Kelamin'] && meta['Jenis Kelamin']) u['Jenis Kelamin'] = meta['Jenis Kelamin'];
          if (!u['Jenis PTK'] && meta['Jenis PTK']) u['Jenis PTK'] = meta['Jenis PTK'];
        });
      }

      // Sintesis Grades otomatis dari ExamSessions yang sudah selesai (_score di Jawaban JSON) bila belum ada di tabel Grades
      if (Array.isArray(tables.ExamSessions)) {
        if (!Array.isArray(tables.Grades)) tables.Grades = [];
        tables.ExamSessions.forEach(sess => {
          if (sess && sess['Jawaban JSON']) {
            try {
              const ans = typeof sess['Jawaban JSON'] === 'string' ? JSON.parse(sess['Jawaban JSON']) : sess['Jawaban JSON'];
              if (ans && ans._score !== undefined) {
                const ex = (tables.Exams || []).find(e => e['ID Ujian'] === sess['ID Ujian']) || {};
                const exists = tables.Grades.some(g => g['ID Ujian'] === sess['ID Ujian'] && g['NIS Siswa'] === sess['NIS Siswa']);
                if (!exists) {
                  tables.Grades.push({
                    'ID Nilai': 'NLI_' + (sess['ID Sesi'] || generateId('NLI')),
                    'ID Ujian': sess['ID Ujian'] || '',
                    'Judul Ujian': sess['Judul Ujian'] || ex['Judul Ujian'] || '',
                    'ID Mapel': ex['ID Mapel'] || '',
                    'Nama Mapel': ex['Nama Mapel'] || '',
                    'ID Kelas': sess['ID Kelas'] || ex['ID Kelas'] || '',
                    'Nama Kelas': sess['Nama Kelas'] || ex['Nama Kelas'] || '',
                    'NIS Siswa': sess['NIS Siswa'] || '',
                    'Nama Siswa': sess['Nama Siswa'] || '',
                    'Nilai': Number(ans._score),
                    'Jumlah Benar': Number(ans._correct || 0),
                    'Jumlah Salah': Number((ans._total || 0) - (ans._correct || 0)),
                    'Total Soal': Number(ans._total || 0),
                    'Waktu Mulai': sess['Waktu Masuk'] || '',
                    'Waktu Selesai': sess['Waktu Selesai'] || ans._finishedAt || '',
                    'Durasi Mengerjakan': '',
                    'ID Guru': ex['ID Guru'] || '',
                    'Nama Guru': ex['Nama Guru'] || '',
                    'Catatan Guru': '',
                    'Nilai Akhir': Number(ans._score),
                    'Tanggal Input': sess['Waktu Selesai'] || ans._finishedAt || sess['Waktu Masuk'] || '',
                    'Status': 'final'
                  });
                }
              }
            } catch (e) { }
          }
        });
        summary.Grades = tables.Grades.length;
      }

      summary.SPMB = spmbRegistrations.length;
      summary.LearningDiscussions = learningDiscussions.length;
      summary.LearningTasks = learningTasks.length;

      // Ekstrak tanggal dari nama file db_cluster-DD-MM-YYYY@HH-MM-SS.backup jika ada
      let exportedAt = new Date().toISOString();
      const fnMatch = String(fileName || '').match(/(\d{2})-(\d{2})-(\d{4})@(\d{2})-(\d{2})-(\d{2})/);
      if (fnMatch) {
        exportedAt = `${fnMatch[3]}-${fnMatch[2]}-${fnMatch[1]}T${fnMatch[4]}:${fnMatch[5]}:${fnMatch[6]}.000Z`;
      }

      const academicYear = settingsMap.academic_year || (tables.Classes && tables.Classes[0] && tables.Classes[0]['Tahun Ajaran']) || '2026/2027';
      const semester = settingsMap.semester || (tables.Subjects && tables.Subjects[0] && tables.Subjects[0]['Semester']) || 'Ganjil';
      const schoolName = settingsMap.school_name || 'SMA Negeri 12 Muna Barat';

      return {
        backupFormat: 'POSTGRESQL_CLUSTER_DUMP_BACKUP',
        sourceFileName: fileName,
        version: '17.11',
        exportedAt: exportedAt,
        schoolName: schoolName,
        academicYear: academicYear,
        semester: semester,
        semesterLabel: `Tahun Ajaran ${academicYear} - Semester ${semester}`,
        totalRecords: totalRows,
        summary: summary,
        tables: tables,
        extraStores: {
          spmbRegistrations,
          learnings,
          learningDiscussions,
          learningAttendees,
          learningTasks,
          guruExtraMetadata,
          galleryImages,
          settingsMap
        }
      };
    },

    _buildPostgresClusterDumpString(backupPayload) {
      const t = backupPayload.tables || {};
      const extra = backupPayload.extraStores || {};
      const now = new Date();

      // Pastikan tabel Settings menyertakan seluruh extraStores agar dump PostgreSQL 100% utuh seperti pg_dump Supabase
      const settingsRows = Array.isArray(t.Settings) ? JSON.parse(JSON.stringify(t.Settings)) : [];
      const upsertSettingRow = (key, val, label, ket) => {
        const idx = settingsRows.findIndex(r => r.Key === key);
        const rowObj = {
          'Key': key,
          'Value': typeof val === 'string' ? val : JSON.stringify(val),
          'Label': label || key,
          'Keterangan': ket || '',
          'Diupdate': now.toISOString()
        };
        if (idx !== -1) settingsRows[idx] = Object.assign({}, settingsRows[idx], rowObj);
        else settingsRows.push(rowObj);
      };

      if (backupPayload.academicYear) upsertSettingRow('academic_year', backupPayload.academicYear, 'Tahun Ajaran', 'Tahun ajaran aktif');
      if (backupPayload.semester) upsertSettingRow('semester', backupPayload.semester, 'Semester', 'Semester aktif');
      if (Array.isArray(extra.learnings)) upsertSettingRow('app_learnings_data', JSON.stringify(extra.learnings), 'Data Ruang Pembelajaran', 'Sync modul ruang pembelajaran mandiri');
      if (Array.isArray(extra.learningDiscussions)) upsertSettingRow('app_learning_discussions_data', JSON.stringify(extra.learningDiscussions), 'Data Diskusi Ruang Pembelajaran', 'Sync forum tanya jawab & saran materi pembelajaran');
      if (Array.isArray(extra.learningAttendees)) upsertSettingRow('app_learning_attendees_data', JSON.stringify(extra.learningAttendees), 'Data Hadir Ruang Belajar', 'Sync riwayat siswa masuk & keluar ruang pembelajaran');
      if (Array.isArray(extra.learningTasks) && extra.learningTasks.length > 0) upsertSettingRow('app_learning_tasks_data', JSON.stringify(extra.learningTasks), 'Data Tugas Ruang Pembelajaran', 'Sync lembar tugas siswa terintegrasi');
      if (Array.isArray(extra.spmbRegistrations)) upsertSettingRow('app_spmb_registrations', JSON.stringify(extra.spmbRegistrations), 'Data SPMB Pendaftar Baru', 'Sync data pendaftaran penerimaan murid baru online');
      if (Array.isArray(extra.galleryImages)) upsertSettingRow('gallery_images', JSON.stringify(extra.galleryImages), 'Galeri Foto', 'Daftar foto galeri bergerak landing page');
      if (extra.guruExtraMetadata) upsertSettingRow('guru_extra_metadata', JSON.stringify(extra.guruExtraMetadata), 'Metadata Guru', 'Jenis Kelamin & Jenis PTK Guru');

      const TABLE_SCHEMA_COLS = {
        Announcements: ['ID', 'Judul', 'Konten', 'Kategori', 'Prioritas', 'ID Pembuat', 'Nama Pembuat', 'Role Pembuat', 'Tanggal Buat', 'Tanggal Update', 'Status', 'Gambar URL'],
        Attendance: ['ID Absen', 'Tanggal', 'Hari', 'ID Kelas', 'Nama Kelas', 'ID Guru', 'Nama Guru', 'ID Mapel', 'Nama Mapel', 'NIS Siswa', 'Nama Siswa', 'Status', 'Keterangan', 'Jam Absen', 'Diubah Oleh', 'Waktu Ubah'],
        Classes: ['ID Kelas', 'Nama Kelas', 'Tingkat', 'Jurusan', 'ID Wali Kelas', 'Nama Wali Kelas', 'Tahun Ajaran', 'Kapasitas', 'Jumlah Siswa', 'Ruangan', 'Keterangan'],
        ExamSessions: ['ID Sesi', 'ID Ujian', 'Judul Ujian', 'ID Kelas', 'Nama Kelas', 'NIS Siswa', 'Nama Siswa', 'Status Sesi', 'Waktu Masuk', 'Waktu Selesai', 'Jawaban JSON', 'Pelanggaran', 'IP Address', 'User Agent'],
        Exams: ['ID Ujian', 'Judul Ujian', 'ID Mapel', 'Nama Mapel', 'ID Kelas', 'Nama Kelas', 'ID Guru', 'Nama Guru', 'Tanggal Mulai', 'Tanggal Selesai', 'Durasi (menit)', 'Status', 'Jumlah Soal', 'Total Nilai', 'Anti Curang', 'Tanggal Dibuat', 'Keterangan', 'Batas Pelanggaran', 'Token'],
        Grades: ['ID Nilai', 'ID Ujian', 'Judul Ujian', 'ID Mapel', 'Nama Mapel', 'ID Kelas', 'Nama Kelas', 'NIS Siswa', 'Nama Siswa', 'Nilai', 'Jumlah Benar', 'Jumlah Salah', 'Total Soal', 'Waktu Mulai', 'Waktu Selesai', 'Durasi Mengerjakan', 'ID Guru', 'Nama Guru', 'Catatan Guru', 'Nilai Akhir', 'Tanggal Input', 'Status'],
        PendingUsers: ['ID', 'Username', 'Password', 'Nama Lengkap', 'Email', 'NIP', 'Telepon', 'Alamat', 'Status', 'Tanggal Daftar', 'Catatan'],
        Questions: ['ID Soal', 'ID Ujian', 'Nomor Soal', 'Tipe Soal', 'Pertanyaan', 'Opsi A', 'Opsi B', 'Opsi C', 'Opsi D', 'Opsi E', 'Jawaban Benar', 'Poin', 'Pembahasan'],
        Settings: ['Key', 'Value', 'Label', 'Keterangan', 'Diupdate'],
        Students: ['ID Siswa', 'NIS', 'NISN', 'Nama Siswa', 'Jenis Kelamin', 'ID Kelas', 'Nama Kelas', 'Telepon', 'Alamat', 'Status'],
        Subjects: ['ID Mapel', 'Nama Mapel', 'Kode Mapel', 'ID Kelas', 'Nama Kelas', 'ID Guru', 'Nama Guru', 'SKS', 'Hari', 'Jam Mulai', 'Jam Selesai', 'Ruangan', 'Semester'],
        Users: ['ID', 'Username', 'Password', 'Nama Lengkap', 'Email', 'Role', 'Status', 'Foto Profil URL', 'Tanggal Daftar', 'Tanggal Approve', 'NIP', 'Telepon', 'Alamat'],
        Violations: ['ID', 'ID Ujian', 'Judul Ujian', 'ID Kelas', 'Nama Kelas', 'NIS Siswa', 'Nama Siswa', 'Jenis Pelanggaran', 'Waktu Pelanggaran', 'Detail', 'Jumlah Pelanggaran'],
        Learnings: ['ID', 'Judul', 'ID Mapel', 'Nama Mapel', 'ID Kelas', 'Nama Kelas', 'ID Guru', 'Nama Guru', 'Token', 'Ringkasan', 'Konten', 'Media URL', 'Status', 'Tanggal Buat', 'Tanggal Update'],
        LearningSessions: ['ID', 'ID Pembelajaran', 'Judul Pembelajaran', 'Nama Siswa', 'Waktu Masuk', 'Catatan']
      };

      const out = [];
      out.push('--');
      out.push('-- PostgreSQL database cluster dump');
      out.push(`-- Portal Sekolah: ${backupPayload.schoolName || 'SMA Negeri 12 Muna Barat'}`);
      out.push(`-- Periode: Tahun Ajaran ${backupPayload.academicYear || '2026/2027'} | Semester ${backupPayload.semester || 'Ganjil'}`);
      out.push(`-- Exported At: ${backupPayload.exportedAt || now.toISOString()}`);
      out.push('--');
      out.push('');
      out.push('SET default_transaction_read_only = off;');
      out.push("SET client_encoding = 'UTF8';");
      out.push('SET standard_conforming_strings = on;');
      out.push('');
      out.push('\\connect postgres');
      out.push('');
      out.push('SET statement_timeout = 0;');
      out.push('SET lock_timeout = 0;');
      out.push('SET idle_in_transaction_session_timeout = 0;');
      out.push("SET client_encoding = 'UTF8';");
      out.push('SET standard_conforming_strings = on;');
      out.push("SELECT pg_catalog.set_config('search_path', '', false);");
      out.push('SET check_function_bodies = false;');
      out.push('SET xmloption = content;');
      out.push('SET client_min_messages = warning;');
      out.push('SET row_security = off;');
      out.push('');

      for (const tblName of Object.keys(TABLE_SCHEMA_COLS)) {
        const cols = TABLE_SCHEMA_COLS[tblName];
        const rows = tblName === 'Settings' ? settingsRows : (Array.isArray(t[tblName]) ? t[tblName] : []);
        const quotedCols = cols.map(c => `"${c}"`).join(', ');

        out.push('--');
        out.push(`-- Data for Name: ${tblName}; Type: TABLE DATA; Schema: public; Owner: postgres`);
        out.push('--');
        out.push('');
        out.push(`COPY public."${tblName}" (${quotedCols}) FROM stdin;`);
        for (const r of rows) {
          if (!r || typeof r !== 'object') continue;
          const lineVals = cols.map(col => {
            let v = r[col];
            if (v === undefined && tblName === 'Attendance' && col === 'ID Absen') v = r['ID Absensi'];
            if (v === undefined && tblName === 'Announcements' && col === 'ID') v = r['ID Pengumuman'];
            return this._escapePgCopyVal(v);
          });
          out.push(lineVals.join('\t'));
        }
        out.push('\\.');
        out.push('');
        out.push('');
      }

      out.push('--');
      out.push('-- PostgreSQL database cluster dump complete');
      out.push('--');
      return out.join('\n');
    },

    async exportFullDatabaseBackup(options = {}) {
      try {
        const sb = getClient();
        const rawClient = (sb && sb.__rawClient) || rawSupabaseClient;
        const allTables = [
          'Announcements', 'Attendance', 'Classes', 'ExamSessions', 'Exams',
          'Grades', 'PendingUsers', 'Questions', 'Settings', 'Students',
          'Subjects', 'Users', 'Violations', 'Learnings', 'LearningSessions'
        ];

        const tablesData = {};
        const summary = {};
        let totalRows = 0;

        for (const tbl of allTables) {
          let rows = [];
          let fetchedFromRemote = false;
          if (rawClient && typeof rawClient.from === 'function' && !_isQuotaRestricted()) {
            try {
              const { data, error } = await rawClient.from(tbl).select('*');
              if (!error && Array.isArray(data) && (data.length > 0 || _isSemesterOverridden(tbl))) {
                rows = data;
                fetchedFromRemote = true;
              }
            } catch (err) { }
          }
          if (!fetchedFromRemote) {
            rows = _getTableCache(tbl);
          }
          const cleanRows = (Array.isArray(rows) ? rows : []).map(r => {
            const copy = { ...r };
            return PortalCloudStorage.hydrateFromVault(copy);
          });
          tablesData[tbl] = cleanRows;
          summary[tbl] = cleanRows.length;
          totalRows += cleanRows.length;
        }

        const spmbList = await this._loadSpmbStore();
        const learningsList = await this._loadLearningsStore();
        const discussionsList = await this._loadLearningDiscussionsStore();
        const attendeesList = await this._loadLearningAttendeesStore();
        const tasksList = await this._loadLearningTasksStore();
        const guruMeta = await this._loadGuruMeta();
        let galleryImages = [];
        try {
          const galRaw = localStorage.getItem('portal_gallery_images');
          if (galRaw) galleryImages = JSON.parse(galRaw);
        } catch (e) { }
        if (!Array.isArray(galleryImages) || galleryImages.length === 0) {
          galleryImages = REAL_SCHOOL_SNAPSHOT.GalleryImages || [];
        }

        summary.SPMB = spmbList.length;
        summary.LearningTasks = tasksList.length;
        summary.LearningDiscussions = discussionsList.length;

        const settingsRes = await this.getSettings();
        const curSettings = (settingsRes && settingsRes.data) || this.getDefaultSettings();
        const schoolName = curSettings.school_name || 'SMA Negeri 12 Muna Barat';
        const academicYear = options.academicYear || curSettings.academic_year || '2026/2027';
        const semester = options.semester || curSettings.semester || 'Ganjil';
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const mi = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');

        const backupPayload = {
          backupFormat: 'POSTGRESQL_CLUSTER_DUMP_BACKUP',
          version: '17.11',
          exportedAt: now.toISOString(),
          schoolName: schoolName,
          academicYear: academicYear,
          semester: semester,
          semesterLabel: `Tahun Ajaran ${academicYear} - Semester ${semester}`,
          notes: options.notes || `PostgreSQL database cluster dump (${schoolName}) Semester ${semester} TA ${academicYear}`,
          totalRecords: totalRows + spmbList.length,
          summary: summary,
          tables: tablesData,
          extraStores: {
            spmbRegistrations: spmbList,
            learnings: learningsList,
            learningDiscussions: discussionsList,
            learningAttendees: attendeesList,
            learningTasks: tasksList,
            guruExtraMetadata: guruMeta,
            galleryImages: galleryImages,
            settingsMap: curSettings
          }
        };

        const backupContent = this._buildPostgresClusterDumpString(backupPayload);
        const filename = `db_cluster-${dd}-${mm}-${yyyy}@${hh}-${mi}-${ss}.backup`;

        return {
          success: true,
          message: `File backup database (${filename}) untuk Semester ${semester} (${academicYear}) berhasil dibuat (${totalRows} baris data).`,
          filename: filename,
          backupContent: backupContent,
          backup: backupPayload,
          summary: summary
        };
      } catch (e) {
        console.error('[exportFullDatabaseBackup error]:', e);
        return { success: false, message: e.message || 'Gagal menyiapkan file .backup database.' };
      }
    },

    async importFullDatabaseBackup(backupInput, options = {}) {
      try {
        let backupData = backupInput;
        if (typeof backupInput === 'string') {
          backupData = this.parsePostgresBackupDump(backupInput, options.fileName || 'db_cluster.backup');
        }
        if (!backupData || typeof backupData !== 'object' || !backupData.tables || typeof backupData.tables !== 'object') {
          return { success: false, message: 'Format file .backup database tidak valid atau rusak!' };
        }

        const mode = options.mode || 'replace'; // 'replace' | 'academic_only' | 'merge'
        const preserveAdminAndCloud = options.preserveAdminAndCloud !== false;

        // Pastikan selalu menggunakan URL & Key database Supabase baru (reset circuit breaker lama)
        _clearQuotaRestricted();
        const sbCfg = _getActiveSbConfig();
        const sb = getClient();
        const candidateKeys = Array.from(new Set([
          sbCfg.SUPABASE_ANON_KEY,
          sbCfg.SUPABASE_SECRET_KEY
        ].map(k => String(k || '').trim()).filter(Boolean)));
        let activeWriteClient = _createRawClientWithKey(sbCfg.SUPABASE_URL, candidateKeys[0]) || (sb && sb.__rawClient) || rawSupabaseClient;
        let currentKeyIdx = 0;
        let remoteAuthOrNetBlocked = false;
        let remoteSyncNote = '';
        let remoteTablesSynced = 0;

        // Kolom resmi untuk masing-masing tabel sesuai schema.sql Supabase
        const TABLE_ALLOWED_COLUMNS = {
          Users: ['ID', 'Username', 'Password', 'Nama Lengkap', 'Email', 'Role', 'Status', 'Foto Profil URL', 'Tanggal Daftar', 'Tanggal Approve', 'NIP', 'Telepon', 'Alamat', 'Jenis Kelamin', 'Jenis PTK'],
          PendingUsers: ['ID', 'Username', 'Password', 'Nama Lengkap', 'Email', 'NIP', 'Telepon', 'Alamat', 'Status', 'Tanggal Daftar', 'Catatan'],
          Classes: ['ID Kelas', 'Nama Kelas', 'Tingkat', 'Jurusan', 'ID Wali Kelas', 'Nama Wali Kelas', 'Tahun Ajaran', 'Kapasitas', 'Jumlah Siswa', 'Ruangan', 'Keterangan'],
          Students: ['ID Siswa', 'NIS', 'NISN', 'Nama Siswa', 'Jenis Kelamin', 'ID Kelas', 'Nama Kelas', 'Telepon', 'Alamat', 'Status'],
          Subjects: ['ID Mapel', 'Nama Mapel', 'Kode Mapel', 'ID Kelas', 'Nama Kelas', 'ID Guru', 'Nama Guru', 'SKS', 'Hari', 'Jam Mulai', 'Jam Selesai', 'Ruangan', 'Semester'],
          Attendance: ['ID Absen', 'Tanggal', 'Hari', 'ID Kelas', 'Nama Kelas', 'ID Guru', 'Nama Guru', 'ID Mapel', 'Nama Mapel', 'NIS Siswa', 'Nama Siswa', 'Status', 'Keterangan', 'Jam Absen', 'Diubah Oleh', 'Waktu Ubah'],
          Exams: ['ID Ujian', 'Judul Ujian', 'ID Mapel', 'Nama Mapel', 'ID Kelas', 'Nama Kelas', 'ID Guru', 'Nama Guru', 'Tanggal Mulai', 'Tanggal Selesai', 'Durasi (menit)', 'Status', 'Jumlah Soal', 'Total Nilai', 'Anti Curang', 'Tanggal Dibuat', 'Keterangan', 'Batas Pelanggaran', 'Token'],
          Questions: ['ID Soal', 'ID Ujian', 'Nomor Soal', 'Tipe Soal', 'Pertanyaan', 'Opsi A', 'Opsi B', 'Opsi C', 'Opsi D', 'Opsi E', 'Jawaban Benar', 'Poin', 'Pembahasan'],
          Grades: ['ID Nilai', 'ID Ujian', 'Judul Ujian', 'ID Mapel', 'Nama Mapel', 'ID Kelas', 'Nama Kelas', 'NIS Siswa', 'Nama Siswa', 'Nilai', 'Jumlah Benar', 'Jumlah Salah', 'Total Soal', 'Waktu Mulai', 'Waktu Selesai', 'Durasi Mengerjakan', 'ID Guru', 'Nama Guru', 'Catatan Guru', 'Nilai Akhir', 'Tanggal Input', 'Status'],
          Violations: ['ID', 'ID Ujian', 'Judul Ujian', 'ID Kelas', 'Nama Kelas', 'NIS Siswa', 'Nama Siswa', 'Jenis Pelanggaran', 'Waktu Pelanggaran', 'Detail', 'Jumlah Pelanggaran'],
          ExamSessions: ['ID Sesi', 'ID Ujian', 'Judul Ujian', 'ID Kelas', 'Nama Kelas', 'NIS Siswa', 'Nama Siswa', 'Status Sesi', 'Waktu Masuk', 'Waktu Selesai', 'Jawaban JSON', 'Pelanggaran', 'IP Address', 'User Agent'],
          Announcements: ['ID', 'Judul', 'Konten', 'Kategori', 'Prioritas', 'ID Pembuat', 'Nama Pembuat', 'Role Pembuat', 'Tanggal Buat', 'Tanggal Update', 'Status', 'Gambar URL'],
          Settings: ['Key', 'Value', 'Label', 'Keterangan', 'Diupdate'],
          Learnings: ['ID', 'Judul', 'ID Mapel', 'Nama Mapel', 'ID Kelas', 'Nama Kelas', 'ID Guru', 'Nama Guru', 'Token', 'Ringkasan', 'Konten', 'Media URL', 'Status', 'Tanggal Buat', 'Tanggal Update'],
          LearningSessions: ['ID', 'ID Pembelajaran', 'Judul Pembelajaran', 'Nama Siswa', 'Waktu Masuk', 'Catatan']
        };

        const academicOnlyTables = [
          'Classes', 'Students', 'Subjects', 'Attendance', 'Exams',
          'Questions', 'Grades', 'Violations', 'ExamSessions',
          'Announcements', 'Learnings', 'LearningSessions'
        ];
        const allTables = Object.keys(TABLE_ALLOWED_COLUMNS);
        const tablesToProcess = mode === 'academic_only' ? academicOnlyTables : allTables;

        // Simpan akun Admin saat ini bila preserveAdminAndCloud aktif
        const currentUsers = _getTableCache('Users');
        const currentAdminRows = currentUsers.filter(u => (u.Role || u.role || '').toLowerCase() === 'admin' || (u.Username || '').toUpperCase() === 'DZULKIFLI');
        const currentCloudCfg = PortalCloudStorage.getConfig();

        const restoredSummary = {};
        let totalRestored = 0;

        for (const tbl of tablesToProcess) {
          if (!Array.isArray(backupData.tables[tbl])) continue;
          const pk = _getPrimaryKeyCol(tbl);
          let incomingRows = JSON.parse(JSON.stringify(backupData.tables[tbl]));

          // Jika tabel Users dan preserveAdminAndCloud aktif, pastikan akun Admin utama tetap ada
          if (tbl === 'Users' && preserveAdminAndCloud && currentAdminRows.length > 0) {
            currentAdminRows.forEach(adm => {
              const admId = adm.ID || adm.id;
              const exists = incomingRows.some(r => (r.ID || r.id) === admId || (r.Username || '').toUpperCase() === (adm.Username || '').toUpperCase());
              if (!exists) incomingRows.push(adm);
            });
          }

          // Sanitize & upload media Base64 ke Cloudinary bila terkonfigurasi
          incomingRows = await PortalCloudStorage.sanitizeForSupabaseAsync(incomingRows, tbl.toLowerCase());

          if (mode === 'replace' || mode === 'academic_only') {
            try {
              localStorage.setItem('portal_semester_override_' + tbl, 'true');
              localStorage.removeItem('portal_semester_cleared_' + tbl);
              localStorage.removeItem('portal_db_deleted_' + tbl);
            } catch (e) { }
            _setTableCache(tbl, incomingRows);
          } else if (mode === 'merge') {
            try {
              localStorage.removeItem('portal_semester_cleared_' + tbl);
            } catch (e) { }
            const existing = _getTableCache(tbl);
            const mapById = new Map();
            existing.forEach(r => {
              const k = String(r[pk] || r.ID || r.id || '');
              if (k) mapById.set(k, r);
            });
            incomingRows.forEach(r => {
              const k = String(r[pk] || r.ID || r.id || '');
              if (k) {
                _unmarkIdDeleted(tbl, k);
                mapById.set(k, Object.assign({}, mapById.get(k) || {}, r));
              }
            });
            _setTableCache(tbl, Array.from(mapById.values()));
          }

          // Sinkronkan ke Database Supabase Baru dalam batch (chunk 100 baris)
          let remoteSyncOk = false;
          if (activeWriteClient && typeof activeWriteClient.from === 'function' && !remoteAuthOrNetBlocked) {
            try {
              const allowedCols = TABLE_ALLOWED_COLUMNS[tbl];
              const cleanForDb = incomingRows.map(row => {
                const dbRow = {};
                if (tbl === 'Attendance' && !row['ID Absen'] && row['ID Absensi']) {
                  row['ID Absen'] = row['ID Absensi'];
                }
                if (tbl === 'Announcements' && !row['ID'] && row['ID Pengumuman']) {
                  row['ID'] = row['ID Pengumuman'];
                }
                allowedCols.forEach(col => {
                  if (row[col] !== undefined) {
                    dbRow[col] = row[col];
                  }
                });
                return dbRow;
              }).filter(r => r[pk] !== undefined && r[pk] !== null && String(r[pk]).trim() !== '');

              if (cleanForDb.length === 0) {
                if (mode === 'replace' || mode === 'academic_only') {
                  const { error: delErr } = await activeWriteClient.from(tbl).delete().neq(pk, '__PORTAL_NEVER_MATCH__');
                  if (!delErr) remoteSyncOk = true;
                  else if (_isQuotaOrNetworkError(delErr)) {
                    if (currentKeyIdx + 1 < candidateKeys.length) {
                      currentKeyIdx++;
                      activeWriteClient = _createRawClientWithKey(sbCfg.SUPABASE_URL, candidateKeys[currentKeyIdx]);
                      const retryDel = await activeWriteClient.from(tbl).delete().neq(pk, '__PORTAL_NEVER_MATCH__');
                      if (!retryDel.error) remoteSyncOk = true;
                    }
                    if (!remoteSyncOk) {
                      remoteAuthOrNetBlocked = true;
                      remoteSyncNote = String(delErr.message || delErr.hint || delErr.code || '');
                      _markQuotaRestricted();
                    }
                  }
                } else {
                  remoteSyncOk = true;
                }
              } else {
                let allChunksOk = true;
                let tableClearedBeforeInsertFallback = false;
                const chunkSize = 100;
                for (let i = 0; i < cleanForDb.length; i += chunkSize) {
                  const chunk = cleanForDb.slice(i, i + chunkSize);
                  let { error: upErr } = await activeWriteClient.from(tbl).upsert(chunk, { onConflict: pk });

                  // Jika gagal karena key pertama ditolak (401/403) dan ada key kandidat kedua, coba key kedua
                  if (upErr && _isQuotaOrNetworkError(upErr) && currentKeyIdx + 1 < candidateKeys.length) {
                    currentKeyIdx++;
                    activeWriteClient = _createRawClientWithKey(sbCfg.SUPABASE_URL, candidateKeys[currentKeyIdx]);
                    const retryKeyRes = await activeWriteClient.from(tbl).upsert(chunk, { onConflict: pk });
                    upErr = retryKeyRes ? retryKeyRes.error : null;
                  }

                  // Fallback untuk tabel Users bila kolom Jenis Kelamin / Jenis PTK belum ada di schema
                  if (upErr && tbl === 'Users') {
                    const fallbackChunk = chunk.map(u => {
                      const copy = { ...u };
                      delete copy['Jenis Kelamin'];
                      delete copy['Jenis PTK'];
                      return copy;
                    });
                    const retryRes = await activeWriteClient.from(tbl).upsert(fallbackChunk, { onConflict: pk });
                    upErr = retryRes ? retryRes.error : null;
                  }

                  // Fallback ke delete + insert bila tabel di Supabase baru belum memiliki constraint UNIQUE/PK untuk ON CONFLICT
                  if (upErr && !_isQuotaOrNetworkError(upErr) && (mode === 'replace' || mode === 'academic_only')) {
                    if (!tableClearedBeforeInsertFallback) {
                      await activeWriteClient.from(tbl).delete().neq(pk, '__PORTAL_NEVER_MATCH__');
                      tableClearedBeforeInsertFallback = true;
                    }
                    let insChunk = chunk;
                    if (tbl === 'Users') {
                      insChunk = chunk.map(u => {
                        const copy = { ...u };
                        delete copy['Jenis Kelamin'];
                        delete copy['Jenis PTK'];
                        return copy;
                      });
                    }
                    const insRes = await activeWriteClient.from(tbl).insert(insChunk);
                    upErr = insRes ? insRes.error : null;
                  }

                  if (upErr) {
                    allChunksOk = false;
                    remoteSyncNote = String(upErr.message || upErr.hint || upErr.details || upErr.code || '');
                    if (_isQuotaOrNetworkError(upErr)) {
                      remoteAuthOrNetBlocked = true;
                      _markQuotaRestricted();
                    }
                    break;
                  }
                }
                if (allChunksOk) {
                  // Pada mode replace / academic_only, hapus sisa baris lama di Supabase yang tidak ada di file backup
                  if ((mode === 'replace' || mode === 'academic_only') && !tableClearedBeforeInsertFallback) {
                    try {
                      const keepIds = cleanForDb.map(r => String(r[pk] || '').trim()).filter(Boolean);
                      if (keepIds.length > 0 && keepIds.length <= 250) {
                        const quotedIn = '(' + keepIds.map(id => '"' + id.replace(/"/g, '\\"') + '"').join(',') + ')';
                        await activeWriteClient.from(tbl).delete().not(pk, 'in', quotedIn);
                      }
                    } catch (pruneErr) { }
                  }
                  remoteSyncOk = true;
                  remoteTablesSynced++;
                }
              }
            } catch (dbSyncErr) {
              console.warn(`[importFullDatabaseBackup] Sinkronisasi tabel ${tbl} ke Supabase catatan:`, dbSyncErr);
              remoteSyncNote = String(dbSyncErr.message || dbSyncErr || '');
            }
          }

          try {
            if (remoteSyncOk) {
              localStorage.removeItem('portal_backup_local_only_' + tbl);
            } else {
              localStorage.setItem('portal_backup_local_only_' + tbl, 'true');
            }
          } catch (e) { }

          restoredSummary[tbl] = incomingRows.length;
          totalRestored += incomingRows.length;
        }

        // Pulihkan Extra Stores (SPMB, Ruang Belajar, Diskusi, Tugas, Galeri, Metadata Guru)
        const extra = backupData.extraStores || {};
        if (Array.isArray(extra.spmbRegistrations)) {
          await this._saveSpmbStore(extra.spmbRegistrations);
        }
        if (Array.isArray(extra.learnings)) {
          await this._saveLearningsStore(extra.learnings);
        }
        if (Array.isArray(extra.learningDiscussions)) {
          await this._saveLearningDiscussionsStore(extra.learningDiscussions);
        }
        if (Array.isArray(extra.learningAttendees)) {
          await this._saveLearningAttendeesStore(extra.learningAttendees);
        }
        if (Array.isArray(extra.learningTasks)) {
          await this._saveLearningTasksStore(extra.learningTasks);
        }
        if (extra.guruExtraMetadata && typeof extra.guruExtraMetadata === 'object') {
          try {
            localStorage.setItem('portal_guru_extra_metadata', JSON.stringify(extra.guruExtraMetadata));
          } catch (e) { }
        }
        if (Array.isArray(extra.galleryImages) && extra.galleryImages.length > 0) {
          try {
            localStorage.setItem('portal_gallery_images', JSON.stringify(extra.galleryImages));
          } catch (e) { }
        }
        try {
          localStorage.removeItem('portal_landing_teachers_cache');
        } catch (e) { }

        const settingsUpdate = {};
        if (extra.settingsMap && typeof extra.settingsMap === 'object') {
          const skipSettingBlobs = new Set([
            'app_learnings_data', 'app_learning_discussions_data',
            'app_learning_attendees_data', 'app_learning_tasks_data',
            'app_spmb_registrations', 'guru_extra_metadata'
          ]);
          Object.keys(extra.settingsMap).forEach(k => {
            if (!skipSettingBlobs.has(k) && extra.settingsMap[k] !== undefined) {
              settingsUpdate[k] = extra.settingsMap[k];
            }
          });
        }
        if (backupData.academicYear) settingsUpdate.academic_year = backupData.academicYear;
        if (backupData.semester) settingsUpdate.semester = backupData.semester;
        const syncEpoch = new Date().toISOString();
        const emptyTablesList = tablesToProcess.filter(tbl => Array.isArray(backupData.tables[tbl]) && backupData.tables[tbl].length === 0);
        settingsUpdate.portal_db_sync_epoch = syncEpoch;
        settingsUpdate.portal_db_empty_tables = JSON.stringify(emptyTablesList);
        try {
          localStorage.setItem('portal_db_sync_epoch', syncEpoch);
          localStorage.setItem('portal_db_remote_empty_tables', settingsUpdate.portal_db_empty_tables);
        } catch (e) { }
        if (preserveAdminAndCloud && currentCloudCfg.cloudinaryCloudName) {
          PortalCloudStorage.saveConfig(currentCloudCfg);
          settingsUpdate.cloudinary_cloud_name = currentCloudCfg.cloudinaryCloudName;
          settingsUpdate.cloudinary_upload_preset = currentCloudCfg.cloudinaryUploadPreset || '';
          settingsUpdate.cloudinary_folder = currentCloudCfg.cloudinaryFolder || 'portal-sekolah-smandum';
        }
        if (Object.keys(settingsUpdate).length > 0) {
          await this.updateSettings(settingsUpdate);
        }

        const targetHost = sbCfg.SUPABASE_URL.replace(/^https?:\/\//, '');
        return {
          success: true,
          message: remoteTablesSynced > 0
            ? `File backup (${backupData.sourceFileName || 'db_cluster.backup'}) berhasil disimpan ke database Supabase baru (${targetHost}) & diterapkan di aplikasi (${totalRestored} baris data)!`
            : `File backup (${backupData.sourceFileName || 'db_cluster.backup'}) berhasil diterapkan di aplikasi (${totalRestored} baris data) dengan target database ${targetHost}${remoteSyncNote ? ' (Catatan API Supabase: ' + remoteSyncNote + ')' : ''}!`,
          remoteSyncedTables: remoteTablesSynced,
          remoteSyncNote: remoteSyncNote,
          targetSupabaseUrl: sbCfg.SUPABASE_URL,
          summary: restoredSummary,
          academicYear: backupData.academicYear || '',
          semester: backupData.semester || ''
        };
      } catch (e) {
        console.error('[importFullDatabaseBackup error]:', e);
        return { success: false, message: e.message || 'Gagal memulihkan file .backup database.' };
      }
    },

    async syncCurrentDatabaseToSupabase(customCfg = {}) {
      try {
        if (customCfg && (customCfg.url || customCfg.anonKey || customCfg.secretKey)) {
          window.resetPortalSupabaseClient(customCfg.url, customCfg.anonKey, customCfg.secretKey);
        } else {
          _clearQuotaRestricted();
        }
        const exported = await this.exportFullDatabaseBackup();
        if (!exported || !exported.success || !exported.backup) {
          return { success: false, message: 'Gagal mengumpulkan data aplikasi saat ini untuk disinkronkan.' };
        }
        return await this.importFullDatabaseBackup(exported.backup, {
          mode: 'replace',
          preserveAdminAndCloud: true
        });
      } catch (e) {
        return { success: false, message: e.message || 'Gagal menyinkronkan data ke Supabase baru.' };
      }
    },

    async resetSemesterTransactionalData(options = {}) {
      try {
        const sb = getClient();
        const rawClient = (sb && sb.__rawClient) || rawSupabaseClient;
        const newAcademicYear = (options.academicYear || '').trim();
        const newSemester = (options.semester || '').trim();

        const transactionalTables = [
          'Attendance', 'Exams', 'Questions', 'Grades',
          'Violations', 'ExamSessions', 'Learnings', 'LearningSessions'
        ];
        if (options.clearAnnouncements) transactionalTables.push('Announcements');

        for (const tbl of transactionalTables) {
          const pk = _getPrimaryKeyCol(tbl);
          try {
            localStorage.setItem('portal_semester_override_' + tbl, 'true');
            localStorage.setItem('portal_semester_cleared_' + tbl, 'true');
            localStorage.setItem('portal_backup_local_only_' + tbl, 'true');
            localStorage.removeItem('portal_db_deleted_' + tbl);
          } catch (e) { }
          _setTableCache(tbl, []);

          if (rawClient && typeof rawClient.from === 'function' && !_isQuotaRestricted()) {
            try {
              const { error: delErr } = await rawClient.from(tbl).delete().neq(pk, '__PORTAL_NEVER_MATCH__');
              if (!delErr) {
                try { localStorage.removeItem('portal_backup_local_only_' + tbl); } catch (e2) { }
              }
            } catch (e) { }
          }
        }

        // Kosongkan store ruang belajar & tugas semester lama
        await this._saveLearningsStore([]);
        await this._saveLearningDiscussionsStore([]);
        await this._saveLearningAttendeesStore([]);
        await this._saveLearningTasksStore([]);
        if (options.clearSpmb) {
          await this._saveSpmbStore([]);
        }

        // Perbarui Semester pada jadwal Mata Pelajaran (Subjects) & Pengaturan Sekolah
        if (newSemester) {
          const subjects = _getTableCache('Subjects').map(s => ({ ...s, 'Semester': newSemester }));
          _setTableCache('Subjects', subjects);
          if (rawClient && typeof rawClient.from === 'function' && !_isQuotaRestricted()) {
            try {
              await rawClient.from('Subjects').update({ 'Semester': newSemester }).neq('ID Mapel', '__NEVER__');
            } catch (e) { }
          }
        }

        const settingsPayload = {};
        if (newAcademicYear) settingsPayload.academic_year = newAcademicYear;
        if (newSemester) settingsPayload.semester = newSemester;
        const resetEpoch = new Date().toISOString();
        settingsPayload.portal_db_sync_epoch = resetEpoch;
        settingsPayload.portal_db_empty_tables = JSON.stringify(transactionalTables);
        try {
          localStorage.setItem('portal_db_sync_epoch', resetEpoch);
          localStorage.setItem('portal_db_remote_empty_tables', settingsPayload.portal_db_empty_tables);
        } catch (e) { }
        if (Object.keys(settingsPayload).length > 0) {
          await this.updateSettings(settingsPayload);
        }

        return {
          success: true,
          message: `Data transaksi semester lama berhasil dikosongkan. Aplikasi kini siap untuk Semester ${newSemester || 'Baru'} Tahun Ajaran ${newAcademicYear || 'Baru'}!`
        };
      } catch (e) {
        return { success: false, message: e.message || 'Gagal mereset data transaksi semester.' };
      }
    },

    async migrateAllMediaToCloudinary() {
      try {
        if (!PortalCloudStorage.isCloudinaryConfigured()) {
          return {
            success: false,
            message: 'Harap isi Cloud Name dan Upload Preset (atau API Key & Secret) Cloudinary terlebih dahulu lalu klik Simpan.'
          };
        }

        let migratedCount = 0;
        let failedCount = 0;

        // 1. Migrasi seluruh entri di Local Media Vault
        const vaultMap = PortalCloudStorage._getVaultMap();
        for (const id of Object.keys(vaultMap)) {
          const entry = vaultMap[id];
          if (entry && entry.dataUri && entry.dataUri.startsWith('data:') && (!entry.remoteUrl || !entry.remoteUrl.includes('cloudinary.com'))) {
            const res = await PortalCloudStorage.uploadToCloudinary(entry.dataUri, {
              folder: entry.label || 'vault',
              label: entry.label || id,
              strict: true
            });
            if (res && res.success && res.url && res.url.startsWith('http')) {
              entry.remoteUrl = res.url;
              migratedCount++;
            } else {
              failedCount++;
            }
          }
        }
        PortalCloudStorage._saveVaultMap(vaultMap);

        // 2. Migrasi Foto Profil Guru & Admin di tabel Users
        const users = _getTableCache('Users');
        let usersChanged = false;
        for (const u of users) {
          const foto = u['Foto Profil URL'] || u.fotoProfil || '';
          if (foto && (foto.startsWith('data:') || foto.startsWith('drive://'))) {
            const rawData = foto.startsWith('drive://') ? PortalCloudStorage.resolveVaultUri(foto) : foto;
            if (rawData && rawData.startsWith('data:')) {
              const res = await PortalCloudStorage.uploadToCloudinary(rawData, { folder: 'teachers', label: u.ID || 'user', strict: true });
              if (res && res.success && res.url && res.url.startsWith('http')) {
                u['Foto Profil URL'] = res.url;
                u.fotoProfil = res.url;
                u.Foto = res.url;
                u.foto = res.url;
                usersChanged = true;
                migratedCount++;
                await this.adminUpdateUser(u.ID || u.id, { fotoProfilUrl: res.url });
              }
            }
          }
        }
        if (usersChanged) _setTableCache('Users', users);

        // 3. Migrasi Pengaturan Sekolah (Logo, Background, Foto Kepsek, Foto Admin, Galeri)
        const sRes = await this.getSettings();
        const s = (sRes && sRes.data) || {};
        const sUpdates = {};
        for (const key of ['school_logo_url', 'school_background_url', 'principal_photo', 'admin_photo']) {
          const val = s[key] || '';
          if (val && (val.startsWith('data:') || val.startsWith('drive://'))) {
            const rawData = val.startsWith('drive://') ? PortalCloudStorage.resolveVaultUri(val) : val;
            if (rawData && rawData.startsWith('data:')) {
              const res = await PortalCloudStorage.uploadToCloudinary(rawData, { folder: 'settings', label: key, strict: true });
              if (res && res.success && res.url && res.url.startsWith('http')) {
                sUpdates[key] = res.url;
                migratedCount++;
              }
            }
          }
        }

        // Migrasi Foto Galeri
        try {
          let gal = [];
          const galRaw = localStorage.getItem('portal_gallery_images') || s.gallery_images;
          if (galRaw) gal = typeof galRaw === 'string' ? JSON.parse(galRaw) : galRaw;
          if (Array.isArray(gal)) {
            let galChanged = false;
            for (let i = 0; i < gal.length; i++) {
              const gUrl = (gal[i] && gal[i].url) || '';
              if (gUrl && (gUrl.startsWith('data:') || gUrl.startsWith('drive://'))) {
                const rawData = gUrl.startsWith('drive://') ? PortalCloudStorage.resolveVaultUri(gUrl) : gUrl;
                if (rawData && rawData.startsWith('data:')) {
                  const res = await PortalCloudStorage.uploadToCloudinary(rawData, { folder: 'gallery', label: `gallery_${i + 1}`, strict: true });
                  if (res && res.success && res.url && res.url.startsWith('http')) {
                    gal[i].url = res.url;
                    galChanged = true;
                    migratedCount++;
                  }
                }
              }
            }
            if (galChanged) {
              localStorage.setItem('portal_gallery_images', JSON.stringify(gal));
              sUpdates.gallery_images = JSON.stringify(gal);
            }
          }
        } catch (e) { }

        if (Object.keys(sUpdates).length > 0) {
          await this.updateSettings(sUpdates);
        }

        // 4. Migrasi Berkas Ruang Pembelajaran & Tugas Siswa
        const learnings = await this._loadLearningsStore();
        let lrnChanged = false;
        for (const lrn of learnings) {
          if (Array.isArray(lrn.attachments)) {
            for (const att of lrn.attachments) {
              if (att && att.dataUrl && (att.dataUrl.startsWith('data:') || att.dataUrl.startsWith('drive://'))) {
                const rawData = att.dataUrl.startsWith('drive://') ? PortalCloudStorage.resolveVaultUri(att.dataUrl) : att.dataUrl;
                if (rawData && rawData.startsWith('data:')) {
                  const res = await PortalCloudStorage.uploadToCloudinary(rawData, { folder: 'learnings', label: att.name || 'materi', strict: true });
                  if (res && res.success && res.url && res.url.startsWith('http')) {
                    att.dataUrl = res.url;
                    lrnChanged = true;
                    migratedCount++;
                  }
                }
              }
            }
          }
        }
        if (lrnChanged) await this._saveLearningsStore(learnings);

        return {
          success: true,
          migratedCount,
          failedCount,
          message: migratedCount > 0
            ? `Berhasil memigrasikan ${migratedCount} berkas media (foto/file/video) ke Cloudinary CDN dan memperbarui database Supabase!`
            : 'Seluruh foto, file, dan video di database sudah optimal dan bebas dari Base64 di Supabase!'
        };
      } catch (e) {
        return { success: false, message: e.message || 'Gagal memigrasikan media ke Cloudinary.' };
      }
    }
  };

  window.parsePostgresBackupDump = function (rawText, fileName) {
    return Handlers.parsePostgresBackupDump(rawText, fileName);
  };

  // 3. PROXY SHIM UNTUK google.script.run
  // Mereplikasi pola sintaksis Google Apps Script:
  // google.script.run.withSuccessHandler(cb).withFailureHandler(cb).namaFungsi(arg1, arg2...)
  window.google = window.google || {};
  window.google.script = window.google.script || {};

  function createRunner() {
    let onSuccess = null;
    let onFailure = null;
    let userObj = null;

    const proxy = new Proxy({}, {
      get(target, prop) {
        if (prop === 'withSuccessHandler') {
          return function (fn) {
            onSuccess = fn;
            return proxy;
          };
        }
        if (prop === 'withFailureHandler') {
          return function (fn) {
            onFailure = fn;
            return proxy;
          };
        }
        if (prop === 'withUserObject') {
          return function (obj) {
            userObj = obj;
            return proxy;
          };
        }

        return async function (...args) {
          const successCb = onSuccess;
          const failureCb = onFailure;
          const uObj = userObj;

          try {
            const execPromise = (typeof Handlers[prop] === 'function')
              ? Handlers[prop](...args)
              : (console.warn(`[Supabase Bridge] Handler "${prop}" belum terdaftar, mencoba fallback getAllData.`), Handlers.getAllData(prop));

            // Timeout fleksibel: 35s untuk query biasa, 180s untuk backup/restore/migrasi/upload berkas/video
            const pLow = (prop || '').toLowerCase();
            const isHeavyOp = (pLow.includes('upload') || pLow.includes('photo') || pLow.includes('doc') || pLow.includes('file') || pLow.includes('backup') || pLow.includes('import') || pLow.includes('export') || pLow.includes('migrate') || pLow.includes('semester'));
            const timeoutMs = isHeavyOp ? 180000 : 35000;
            let runnerTimer = null;
            const timeoutPromise = new Promise((_, reject) => {
              runnerTimer = setTimeout(() => reject(new Error('Waktu tunggu koneksi habis. Silakan periksa koneksi internet Anda.')), timeoutMs);
            });

            let result;
            try {
              result = await Promise.race([execPromise, timeoutPromise]);
            } finally {
              if (runnerTimer) clearTimeout(runnerTimer);
            }

            if (successCb) {
              try {
                successCb(result, uObj);
              } catch (cbErr) {
                console.error(`[Supabase Bridge] Error inside success handler of ${prop}:`, cbErr);
              }
            }
            return result;
          } catch (err) {
            console.error(`[Supabase Bridge Error] pada ${prop}:`, err);
            if (failureCb) {
              try {
                failureCb(err, uObj);
              } catch (cbErr) {
                console.error(`[Supabase Bridge] Error inside failure handler of ${prop}:`, cbErr);
              }
            }
          }
        };
      }
    });

    return proxy;
  }

  Object.defineProperty(window.google.script, 'run', {
    get() {
      return createRunner();
    },
    configurable: true,
    enumerable: true
  });

  console.log('✅ [Portal Sekolah] Supabase Bridge aktif dan siap melayani permintaan.');
})();
