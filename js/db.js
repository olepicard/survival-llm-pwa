/**
 * Local Offline Guides & IndexedDB Database Manager
 */

const DB_NAME = 'SurvivalGuidesDB';
const DB_VERSION = 1;

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
    return new Promise((resolve, reject) => {
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
        console.warn('IndexedDB unavailable, falling back to in-memory store:', e);
        resolve(null);
      };
    });
  }

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
        console.warn('Could not read index from IndexedDB', err);
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
      console.error('Failed to load guides index:', err);
      return { themes: {}, count: 0, guides: [] };
    }
  }

  /**
   * Search guides by keyword and optional theme
   */
  async searchGuides(query = '', themeFilter = 'all', limit = 50) {
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
   */
  async getArticle(id) {
    const numId = parseInt(id, 10);

    // 1. Check IndexedDB
    if (this.db) {
      try {
        const cached = await this._getFromStore('articles', numId);
        if (cached) return cached;
      } catch (err) {
        console.warn('IndexedDB article read error:', err);
      }
    }

    // 2. Determine theme from index
    const index = await this.loadIndex();
    const meta = index.guides.find(g => g.id === numId);
    const theme = meta ? meta.theme : 'survival';

    // 3. Load theme bundle if needed
    if (!this.cachedThemeBundles[theme]) {
      try {
        const res = await fetch(`./data/guides_${theme}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.cachedThemeBundles[theme] = await res.json();

        // Background store into IndexedDB
        if (this.db) {
          const docs = this.cachedThemeBundles[theme];
          const tx = this.db.transaction('articles', 'readwrite');
          const store = tx.objectStore('articles');
          for (const key of Object.keys(docs)) {
            store.put(docs[key]);
          }
        }
      } catch (err) {
        console.error(`Failed to load guides_${theme}.json:`, err);
        return null;
      }
    }

    const doc = this.cachedThemeBundles[theme][numId.toString()];
    return doc || null;
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
