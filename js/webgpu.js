/**
 * WebGPU Local In-Browser LLM Engine v3.1 (Full Offline & Adreno Safe-Decode Edition)
 * Downloads all WebGPU resources ONCE into permanent CacheStorage and runs 100% offline.
 * Zero installation, zero terminal, zero Termux required!
 */

const LOCAL_WEBLLM_URL = './vendor/web-llm.js?v=3.1';

export const WEBGPU_MODELS = [
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 360M Instruct (Recommandé Smartphone • Stable VRAM)',
    sizeMB: 195,
    desc: 'Idéal smartphone Adreno / S25 Ultra : ne consomme que 376 Mo de VRAM (fenêtre 4096 tokens), 100% stable et 100% hors-ligne après 1er téléchargement (195 Mo)'
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 0.5B Instruct (Léger & Précis)',
    sizeMB: 360,
    desc: 'Très compact et efficace pour les fiches d\'urgence en français (360 Mo)'
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 1B Instruct (Recommandé PC / Tablettes)',
    sizeMB: 720,
    desc: 'Modèle 1B pour PC ou tablettes (peut dépasser le timeout GPU Vulkan sur certains smartphones Android) (720 Mo)'
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 3B Instruct (Haute Précision PC)',
    sizeMB: 1800,
    desc: 'Modèle complet pour PC avec GPU dédié 6 Go+ VRAM (1.8 Go)'
  }
];

export class WebGPUEngine {
  constructor() {
    this.engine = null;
    let saved = localStorage.getItem('webgpu_model');
    const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    if (isMobile && (!saved || saved.includes('Llama') || saved.includes('3B'))) {
      console.log('[WebGPU v3.1] Smartphone détecté : configuration sur SmolLM2-360M (376 Mo VRAM) pour stabilité Adreno.');
      saved = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
      localStorage.setItem('webgpu_model', saved);
    }
    this.currentModel = saved || 'SmolLM2-360M-Instruct-q4f16_1-MLC';
    this.isLoaded = false;
    this.isLoading = false;
    this.loadPromise = null;
    this.progressListeners = new Set();
    this.webLLMModule = null;
    this.wakeLock = null;

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', async () => {
        if (this.isLoading && document.visibilityState === 'visible') {
          await this._acquireWakeLock();
        }
      });
    }
  }

  /**
   * Empêche l'extinction de l'écran et la mise en veille du smartphone
   */
  async _acquireWakeLock() {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && !this.wakeLock) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      } catch (e) {
        // ignore
      }
    }
  }

  /**
   * Relâche le verrou d'écran
   */
  async _releaseWakeLock() {
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
      } catch (e) {
        // ignore
      }
      this.wakeLock = null;
    }
  }

  /**
   * Verrouille le stockage persistant du navigateur pour empêcher Android d'effacer le cache WebGPU
   */
  async _ensurePersistentStorage() {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      try {
        const isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
          await navigator.storage.persist();
        }
      } catch (e) {
        // ignore
      }
    }
  }

  /**
   * Check if the browser and hardware support WebGPU
   */
  async checkSupport() {
    if (!('gpu' in navigator)) {
      return {
        supported: false,
        reason: 'L\'API WebGPU n\'est pas disponible dans ce navigateur. Utilisez Chrome ou Edge récent.'
      };
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        return {
          supported: false,
          reason: 'Aucun adaptateur GPU compatible WebGPU détecté sur cet appareil.'
        };
      }
      return { supported: true, adapter };
    } catch (err) {
      return {
        supported: false,
        reason: `Erreur d'initialisation WebGPU: ${err.message}`
      };
    }
  }

  /**
   * Load patched WebLLM library from local PWA bundle (100% offline, zero network)
   */
  async _getWebLLM() {
    if (this.webLLMModule) return this.webLLMModule;
    this.webLLMModule = await import(LOCAL_WEBLLM_URL);
    return this.webLLMModule;
  }

  /**
   * Get model record from WebLLM prebuiltAppConfig
   */
  async _getModelRecord(modelId) {
    const webllm = await this._getWebLLM();
    const targetId = modelId || this.currentModel;
    const list = webllm?.prebuiltAppConfig?.model_list || [];
    return list.find(m => m.model_id === targetId) || list.find(m => m.model_id === 'SmolLM2-360M-Instruct-q4f16_1-MLC');
  }

  /**
   * Normalize base model URL to HuggingFace /resolve/main/ format
   */
  _resolveModelBaseUrl(modelUrl) {
    let url = modelUrl.endsWith('/') ? modelUrl : `${modelUrl}/`;
    if (!/.+\/resolve\/.+\//.test(url)) {
      url += 'resolve/main/';
    }
    return new URL(url).href;
  }

  /**
   * Verify if ALL resources required by WebGPU (config + WASM binary + tokenizer + tensor-cache + all weight shards)
   * are stored in the local browser CacheStorage for 100% offline execution.
   */
  async isModelCached(modelId) {
    if (typeof caches === 'undefined') return false;
    try {
      const rec = await this._getModelRecord(modelId);
      if (!rec) return false;

      const baseUrl = this._resolveModelBaseUrl(rec.model);
      const configUrl = new URL('mlc-chat-config.json', baseUrl).href;
      const tensorCacheUrl = new URL('tensor-cache.json', baseUrl).href;
      const wasmUrl = rec.model_lib;

      const [configCache, wasmCache, modelCache] = await Promise.all([
        caches.open('webllm/config'),
        caches.open('webllm/wasm'),
        caches.open('webllm/model')
      ]);

      const [configMatch, wasmMatch, tensorCacheMatch] = await Promise.all([
        configCache.match(configUrl, { ignoreVary: true, ignoreSearch: true }),
        wasmCache.match(wasmUrl, { ignoreVary: true, ignoreSearch: true }),
        modelCache.match(tensorCacheUrl, { ignoreVary: true, ignoreSearch: true })
      ]);

      if (!configMatch || !wasmMatch || !tensorCacheMatch) {
        return false;
      }

      // Check tokenizer file from mlc-chat-config.json
      const chatConfig = await configMatch.clone().json();
      const tokFiles = chatConfig.tokenizer_files || ['tokenizer.json'];
      const tokFile = tokFiles.includes('tokenizer.json') ? 'tokenizer.json' : tokFiles[0];
      if (tokFile) {
        const tokUrl = new URL(tokFile, baseUrl).href;
        const tokMatch = await modelCache.match(tokUrl, { ignoreVary: true, ignoreSearch: true });
        if (!tokMatch) return false;
      }

      // Check all weight shards from tensor-cache.json
      const tensorManifest = await tensorCacheMatch.clone().json();
      const records = tensorManifest.records || [];
      if (records.length === 0) return false;

      const shardMatches = await Promise.all(
        records.map(r => modelCache.match(new URL(r.dataPath, baseUrl).href, { ignoreVary: true, ignoreSearch: true }))
      );

      return shardMatches.every(m => m !== undefined);
    } catch (e) {
      console.warn('[WebGPU v3.1] Vérification cache complet:', e.message);
      return false;
    }
  }

  /**
   * Initialize or switch model (deduplicated so background startup mount & user chat never collide)
   */
  async loadModel(modelId, onProgress) {
    let targetModel = modelId || this.currentModel;

    if (this.engine && this.currentModel === targetModel && this.isLoaded) {
      return this.engine;
    }

    if (onProgress) {
      this.progressListeners.add(onProgress);
    }

    if (this.isLoading && this.loadPromise && this.currentModel === targetModel) {
      try {
        return await this.loadPromise;
      } finally {
        if (onProgress) this.progressListeners.delete(onProgress);
      }
    }

    this.currentModel = targetModel;
    this.isLoading = true;

    this.loadPromise = (async () => {
      const support = await this.checkSupport();
      if (!support.supported) {
        throw new Error(support.reason);
      }

      await this._acquireWakeLock();
      await this._ensurePersistentStorage();
      const webllm = await this._getWebLLM();

      if (webllm.prebuiltAppConfig && Array.isArray(webllm.prebuiltAppConfig.model_list)) {
        const found = webllm.prebuiltAppConfig.model_list.some(m => m.model_id === targetModel);
        if (!found) {
          targetModel = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
        }
      }

      const isAlreadyCached = await this.isModelCached(targetModel);
      console.log(
        `[WebGPU v3.1] Modèle ${targetModel} en cache permanent hors-ligne : ${
          isAlreadyCached ? 'OUI (100% Hors-Ligne, 0 Mo réseau)' : 'NON (Téléchargement initial unique requis)'
        }`
      );

      if (!isAlreadyCached && typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error(
          `Le modèle WebGPU (${targetModel}) n'a pas encore été téléchargé dans le cache hors-ligne. ` +
          `Activez Internet une seule fois pour télécharger les ressources WebGPU (~195 Mo), puis utilisez l'application 100% hors-ligne.`
        );
      }

      let lastPercent = -1;
      const initProgressCallback = (report) => {
        const percent = Math.round((report.progress || 0) * 100);
        const text = report.text || '';
        const fromCache = isAlreadyCached || text.includes('Loading model from cache');
        if (percent !== lastPercent && (percent % 10 === 0 || percent === 100)) {
          lastPercent = percent;
          console.log(
            `[WebGPU v3.1 ${fromCache ? 'Cache Local Hors-Ligne -> VRAM' : 'Téléchargement Initial Unique'}] ${text} (${percent}%)`
          );
        }
        const payload = {
          text,
          progress: report.progress,
          percent: isNaN(percent) ? 0 : percent,
          fromCache
        };
        for (const listener of this.progressListeners) {
          try {
            listener(payload);
          } catch (e) {
            // ignore
          }
        }
      };

      const contextWindowSize = targetModel.includes('SmolLM2') || targetModel.includes('Qwen') ? 4096 : 2048;
      const chatOpts = {
        context_window_size: contextWindowSize,
        sliding_window_size: -1
      };

      await this.unload();

      this.engine = await webllm.CreateMLCEngine(
        targetModel,
        { initProgressCallback },
        chatOpts
      );

      this.currentModel = targetModel;
      this.isLoaded = true;
      localStorage.setItem('webgpu_model', targetModel);
      localStorage.setItem(`webgpu_cached_${targetModel}`, 'true');
      console.log(`[WebGPU v3.1] Modèle ${targetModel} monté en VRAM et prêt (100% Hors-Ligne, fenêtre ${contextWindowSize} tokens).`);
      window.dispatchEvent(new CustomEvent('webgpu-ready', { detail: { model: targetModel } }));
      return this.engine;
    })();

    try {
      return await this.loadPromise;
    } catch (err) {
      console.error(`[WebGPU v3.1] Erreur dans loadModel(${targetModel}):`, err);
      throw err;
    } finally {
      if (onProgress) this.progressListeners.delete(onProgress);
      this.isLoading = false;
      this.loadPromise = null;
      await this._releaseWakeLock();
    }
  }

  /**
   * Stream chat completion directly in-browser
   */
  async streamChat(messages, onToken, signal, onLoadingProgress) {
    console.log(`[WebGPU v3.1] Requête streamChat (${messages.length} messages) pour modèle: ${this.currentModel}`);
    if (!this.isLoaded || !this.engine) {
      await this.loadModel(this.currentModel, onLoadingProgress);
    }

    let abortHandler = null;
    if (signal) {
      if (signal.aborted) {
        throw new DOMException('Génération annulée par l\'utilisateur', 'AbortError');
      }
      abortHandler = () => {
        if (this.engine && typeof this.engine.interruptGenerate === 'function') {
          this.engine.interruptGenerate();
        }
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    await this._acquireWakeLock();
    try {
      const t0 = performance.now();
      const stream = await this.engine.chat.completions.create({
        messages,
        stream: true,
        temperature: parseFloat(localStorage.getItem('llm_temperature') || '0.7'),
        max_tokens: 512
      });

      let fullText = '';
      let tokenCount = 0;
      let finishReason = null;

      for await (const chunk of stream) {
        if (signal && signal.aborted) {
          if (this.engine && typeof this.engine.interruptGenerate === 'function') {
            this.engine.interruptGenerate();
          }
          break;
        }
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
        const delta = choice?.delta?.content || '';
        if (delta) {
          if (tokenCount === 0) {
            const ttft = ((performance.now() - t0) / 1000).toFixed(2);
            console.log(`[WebGPU v3.1] Premier jeton généré en ${ttft}s !`);
          }
          tokenCount++;
          fullText += delta;
          if (onToken) onToken(delta, fullText);
        }
      }

      const totalSec = ((performance.now() - t0) / 1000).toFixed(2);
      console.log(`[WebGPU v3.1] Fin de génération (${tokenCount} jetons en ${totalSec}s, raison: ${finishReason || 'stop'}).`);
      return fullText;
    } catch (err) {
      const msg = err?.message || String(err);
      if (
        msg.includes('Device was lost') ||
        msg.includes('Instance reference no longer exists') ||
        msg.includes('dropped in popErrorScope') ||
        msg.includes('Buffer was unmapped')
      ) {
        console.warn('[WebGPU v3.1] Contexte GPU perdu (Device was lost). Réinitialisation de l\'instance.');
        await this.unload();
      }
      console.error('[WebGPU v3.1] Erreur durant streamChat:', err);
      throw err;
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
      await this._releaseWakeLock();
    }
  }

  /**
   * Reset / unload model from VRAM (does NOT delete cached files on disk)
   */
  async unload() {
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch (e) {
        // ignore
      }
      this.engine = null;
    }
    this.isLoaded = false;
  }

  /**
   * Clear downloaded model shards from browser CacheStorage (only when user explicitly clicks Reset Cache)
   */
  async clearCache() {
    await this.unload();
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (const key of keys) {
          if (key.includes('webllm') || key.includes('mlc') || key.includes('wasm') || key.includes('tvmjs')) {
            await caches.delete(key);
          }
        }
        localStorage.removeItem(`webgpu_cached_${this.currentModel}`);
        return true;
      } catch (e) {
        console.warn('Erreur suppression cache WebGPU:', e);
      }
    }
    return false;
  }
}
