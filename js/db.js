/**
 * Local Offline Guides & IndexedDB Database Manager
 * Supports Full Offline (~16 MB) and Partial (~1.5 MB) storage modes,
 * disk capacity estimation, persistence requests, and graceful offline fallback.
 */

const DB_NAME = 'SurvivalGuidesDB';
const DB_VERSION = 2;
export const THEME_BUNDLES = ['survival', 'medical', 'food', 'tech'];

export class GuidesDB {
  constructor() {
    this.indexData = null; // { themes, count, guides: [...] }
    this.cachedThemeBundles = {}; // theme -> { doc_id: { id, title, body, ... } }
    this.db = null;
  }

  async init() {
    await this._initIndexedDB();
    await this.loadIndex();
  }

  _initIndexedDB() {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('articles')) {
          db.createObjectStore('articles', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onerror = (e) => {
        console.warn('IndexedDB indisponible, repli mémoire:', e);
        resolve(null);
      };
    });
  }

  /**
   * Load the master index of 670 guides (~311 KB)
   */
  async loadIndex() {
    if (this.indexData) return this.indexData;

    // Check IndexedDB cache first
    if (this.db) {
      try {
        const cachedMeta = await this._getFromStore('meta', 'index_data');
        if (cachedMeta && cachedMeta.data) {
          this.indexData = cachedMeta.data;
          return this.indexData;
        }
      } catch (err) {
        console.warn('Erreur lecture index IndexedDB:', err);
      }
    }

    // Fetch from JSON file
    try {
      const res = await fetch('./data/guides_index.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.indexData = await res.json();

      // Persist to IndexedDB
      if (this.db && this.indexData) {
        this._putToStore('meta', { key: 'index_data', data: this.indexData }).catch(() => {});
      }
      return this.indexData;
    } catch (err) {
      console.error('Échec de chargement de guides_index.json:', err);
      return { themes: {}, count: 0, guides: [] };
    }
  }

  /**
   * Search guides by keyword and optional theme
   */
  async searchGuides(query = '', themeFilter = 'all', limit = 60) {
    const index = await this.loadIndex();
    if (!index || !index.guides) return [];

    let results = index.guides;

    if (themeFilter && themeFilter !== 'all') {
      results = results.filter(g => g.theme === themeFilter);
    }

    if (query && query.trim()) {
      const terms = this.normalize(query).split(/\s+/).filter(Boolean);
      results = results.filter(g => {
        const titleNorm = this.normalize(g.title);
        const snipNorm = this.normalize(g.snippet || '');
        const srcNorm = this.normalize(g.source_label || '');
        return terms.every(term => 
          titleNorm.includes(term) || snipNorm.includes(term) || srcNorm.includes(term)
        );
      });
    }

    return results.slice(0, limit);
  }

  /**
   * Load the full article content by ID
   * Guarantees NO blocking error: falls back gracefully to index summary if bundle isn't cached.
   */
  async getArticle(id) {
    const numId = parseInt(id, 10);

    // 1. Check IndexedDB
    if (this.db) {
      try {
        const cached = await this._getFromStore('articles', numId);
        if (cached) return cached;
      } catch (err) {
        console.warn('Erreur lecture article IndexedDB:', err);
      }
    }

    // 2. Determine theme from index
    const index = await this.loadIndex();
    const meta = (index.guides || []).find(g => g.id === numId);
    const theme = meta ? meta.theme : 'survival';

    // 3. Try to load from theme bundle if available in memory
    if (this.cachedThemeBundles[theme] && this.cachedThemeBundles[theme][numId.toString()]) {
      return this.cachedThemeBundles[theme][numId.toString()];
    }

    // 4. Try network fetch or cache
    try {
      const res = await fetch(`./data/guides_${theme}.json`);
      if (res.ok) {
        const bundle = await res.json();
        this.cachedThemeBundles[theme] = bundle;

        // Save entire bundle to IndexedDB asynchronously
        if (this.db) {
          const tx = this.db.transaction('articles', 'readwrite');
          const store = tx.objectStore('articles');
          for (const key of Object.keys(bundle)) {
            store.put(bundle[key]);
          }
        }

        const doc = bundle[numId.toString()];
        if (doc) return doc;
      }
    } catch (err) {
      console.warn(`Mode hors-ligne: impossible de télécharger guides_${theme}.json (${err.message}). Utilisation du repli local.`);
    }

    // 5. GRACEFUL FALLBACK (Eliminates "Impossible de charger le document" error)
    if (meta) {
      return {
        id: numId,
        title: meta.title,
        theme: meta.theme,
        source_label: meta.source_label,
        url: meta.url || '',
        isPartial: true,
        body: `> [!NOTE]\n> **Mode Hors-Ligne Partiel Actif**\n> Le texte complet (${meta.theme}) n'a pas encore été téléchargé dans la mémoire de votre appareil.\n\n### 📋 Fiche résumé disponible hors-ligne :\n${meta.snippet || 'Aucun extrait disponible.'}\n\n---\n\n**💡 Pour lire l'intégralité du guide sans aucune connexion Internet :**\nAllez dans l'onglet **⚙️ Réglages** > **Gestionnaire de Stockage** et cliquez sur **« Télécharger le pack Full Hors-Ligne (16 Mo) »**.`
      };
    }

    return null;
  }

  /**
   * Check storage quota and estimate capacity on smartphone/PC
   * @returns {Promise<{supported: boolean, quotaMB: number, usageMB: number, availableMB: number, percent: number, persisted: boolean, isFullOffline: boolean}>}
   */
  async getStorageStats() {
    let supported = false;
    let quotaMB = 0;
    let usageMB = 0;
    let availableMB = 0;
    let percent = 0;
    let persisted = false;

    if (navigator.storage && navigator.storage.estimate) {
      try {
        supported = true;
        const estimate = await navigator.storage.estimate();
        const quotaBytes = estimate.quota || 0;
        const usageBytes = estimate.usage || 0;

        quotaMB = Math.round(quotaBytes / (1024 * 1024));
        usageMB = parseFloat((usageBytes / (1024 * 1024)).toFixed(1));
        availableMB = Math.max(0, quotaMB - usageMB);
        percent = quotaBytes > 0 ? Math.min(100, Math.round((usageBytes / quotaBytes) * 100)) : 0;
      } catch (e) {
        console.warn('Erreur estimation stockage:', e);
      }
    }

    if (navigator.storage && navigator.storage.persisted) {
      try {
        persisted = await navigator.storage.persisted();
      } catch (e) {
        // ignore
      }
    }

    const isFullOffline = await this.isFullOfflineReady();

    return {
      supported,
      quotaMB,
      usageMB,
      availableMB,
      percent,
      persisted,
      isFullOffline
    };
  }

  /**
   * Request persistent storage to prevent Android/browser auto-eviction
   */
  async requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      try {
        return await navigator.storage.persist();
      } catch (e) {
        console.warn('Erreur persistance stockage:', e);
        return false;
      }
    }
    return false;
  }

  /**
   * Check if all guide bundles are present in IndexedDB
   */
  async isFullOfflineReady() {
    if (!this.db) {
      const mode = localStorage.getItem('storage_offline_mode');
      return mode === 'full';
    }

    try {
      const count = await this._countStore('articles');
      // If we have >= 600 articles cached, full offline is active
      if (count >= 600) return true;

      const metaFull = await this._getFromStore('meta', 'full_offline_ready');
      if (metaFull && metaFull.value) return true;
    } catch (e) {
      console.warn('Erreur verification cache complet:', e);
    }
    return localStorage.getItem('storage_offline_mode') === 'full';
  }

  /**
   * Count items in an IndexedDB store
   */
  _countStore(storeName) {
    return new Promise((resolve) => {
      if (!this.db) return resolve(0);
      try {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });
  }

  /**
   * Download all 4 theme bundles and store them permanently
   * @param {Function} onProgress - ({ theme, current, total, percent, status })
   */
  async downloadAllGuides(onProgress) {
    const bundles = [
      { theme: 'survival', title: 'Survie & Bivouac', approxMB: 6.6 },
      { theme: 'medical', title: 'Secourisme & Médical', approxMB: 7.0 },
      { theme: 'tech', title: 'Technique & Radio', approxMB: 1.2 },
      { theme: 'food', title: 'Eau & Alimentation', approxMB: 0.4 }
    ];

    let totalArticlesSaved = 0;
    const totalBundles = bundles.length;

    // Request persistence first
    await this.requestPersistence();

    for (let i = 0; i < bundles.length; i++) {
      const b = bundles[i];
      if (onProgress) {
        onProgress({
          theme: b.theme,
          title: b.title,
          current: i + 1,
          total: totalBundles,
          percent: Math.round((i / totalBundles) * 100),
          status: `Téléchargement du pack ${b.title} (~${b.approxMB} Mo)...`
        });
      }

      const url = `./data/guides_${b.theme}.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Échec de téléchargement de ${b.theme}: HTTP ${res.status}`);

      const data = await res.json();
      this.cachedThemeBundles[b.theme] = data;

      // Put into CacheStorage if available
      if ('caches' in window) {
        try {
          const cache = await caches.open('survival-llm-v2.0');
          const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
          await cache.put(url, new Response(blob, {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=31536000' }
          }));
        } catch (e) {
          console.warn('CacheStorage put error:', e);
        }
      }

      // Put into IndexedDB
      if (this.db) {
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction('articles', 'readwrite');
          const store = tx.objectStore('articles');
          for (const key of Object.keys(data)) {
            store.put(data[key]);
            totalArticlesSaved++;
          }
          tx.oncomplete = () => resolve();
          tx.onerror = (e) => reject(e);
        });
      }
    }

    // Mark completed in meta & localStorage
    if (this.db) {
      await this._putToStore('meta', { key: 'full_offline_ready', value: true, date: Date.now() });
    }
    localStorage.setItem('storage_offline_mode', 'full');

    if (onProgress) {
      onProgress({
        theme: 'all',
        title: 'Terminé',
        current: totalBundles,
        total: totalBundles,
        percent: 100,
        status: `✅ 670 guides complets enregistrés avec succès (${totalArticlesSaved} articles) !`
      });
    }

    return totalArticlesSaved;
  }

  /**
   * Clear full guide bodies from IndexedDB to revert to Partial mode (~1.5 MB)
   */
  async clearFullGuidesCache() {
    if (this.db) {
      await new Promise((resolve) => {
        const tx = this.db.transaction('articles', 'readwrite');
        const store = tx.objectStore('articles');
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
      await this._putToStore('meta', { key: 'full_offline_ready', value: false });
    }

    this.cachedThemeBundles = {};
    localStorage.setItem('storage_offline_mode', 'partial');
    return true;
  }

  normalize(str) {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  _getFromStore(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  _putToStore(storeName, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}
