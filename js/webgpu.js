/**
 * WebGPU Local In-Browser LLM Engine v3.0 (Adreno Safe-Decode Edition)
 * Enables 100% in-browser offline AI inference on Snapdragon Adreno / PC GPUs
 * Zero installation, zero terminal, zero Termux required!
 */

const LOCAL_WEBLLM_URL = './vendor/web-llm.js?v=3.0';

export const WEBGPU_MODELS = [
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 360M Instruct (Recommandé Smartphone • Stable VRAM)',
    sizeMB: 210,
    desc: 'Idéal smartphone Adreno / S25 Ultra : ne consomme que 376 Mo de VRAM (fenêtre 4096 tokens), 100% stable sans crash GPU (210 Mo)'
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
      console.log('[WebGPU v3.0] Smartphone détecté : configuration forcée sur SmolLM2-360M (376 Mo VRAM) pour éliminer le crash Adreno.');
      saved = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
      localStorage.setItem('webgpu_model', saved);
    }
    this.currentModel = saved || 'SmolLM2-360M-Instruct-q4f16_1-MLC';
    this.isLoaded = false;
    this.isLoading = false;
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
        console.log('[WebGPU v3.0] WakeLock actif : écran maintenu allumé.');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      } catch (e) {
        console.warn('[WebGPU v3.0] WakeLock écran refusé ou non supporté:', e.message);
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
          const granted = await navigator.storage.persist();
          console.log(`[WebGPU v3.0] Stockage persistant navigateur : ${granted ? 'accordé' : 'géré automatiquement'}.`);
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
      console.warn('[WebGPU v3.0] navigator.gpu non disponible dans ce navigateur.');
      return {
        supported: false,
        reason: 'L\'API WebGPU n\'est pas disponible dans ce navigateur. Utilisez Chrome ou Edge récent.'
      };
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        console.warn('[WebGPU v3.0] requestAdapter a renvoyé null (aucun adaptateur GPU compatible).');
        return {
          supported: false,
          reason: 'Aucun adaptateur GPU compatible WebGPU détecté sur cet appareil.'
        };
      }
      console.log('[WebGPU v3.0] Adaptateur GPU détecté avec succès.');
      return { supported: true, adapter };
    } catch (err) {
      console.error('[WebGPU v3.0] Erreur lors de requestAdapter:', err);
      return {
        supported: false,
        reason: `Erreur d'initialisation WebGPU: ${err.message}`
      };
    }
  }

  /**
   * Load patched WebLLM library from local PWA bundle (100% offline, zero network, Adreno Safe-Decode patched)
   */
  async _getWebLLM() {
    if (this.webLLMModule) return this.webLLMModule;
    console.log('[WebGPU v3.0] Chargement du moteur WebLLM local patché (./vendor/web-llm.js?v=3.0)...');
    this.webLLMModule = await import(LOCAL_WEBLLM_URL);
    console.log('[WebGPU v3.0] Module WebLLM local chargé (Adreno Safe-Decode actif, 0 Mo réseau).');
    return this.webLLMModule;
  }

  /**
   * Verify if model weights are already stored in the local browser cache
   */
  async isModelCached(modelId) {
    try {
      const webllm = await this._getWebLLM();
      if (typeof webllm.hasModelInCache === 'function') {
        return await webllm.hasModelInCache(modelId || this.currentModel);
      }
    } catch (e) {
      console.warn('[WebGPU v3.0] Impossible de vérifier hasModelInCache:', e);
    }
    return false;
  }

  /**
   * Initialize or switch model
   */
  async loadModel(modelId, onProgress) {
    let targetModel = modelId || this.currentModel;

    if (this.engine && this.currentModel === targetModel && this.isLoaded) {
      console.log(`[WebGPU v3.0] Modèle ${targetModel} déjà instancié en VRAM.`);
      return this.engine;
    }

    console.log(`[WebGPU v3.0] Démarrage initialisation modèle : ${targetModel}`);
    const support = await this.checkSupport();
    if (!support.supported) {
      throw new Error(support.reason);
    }

    this.isLoading = true;
    await this._acquireWakeLock();
    await this._ensurePersistentStorage();
    const webllm = await this._getWebLLM();

    try {
      if (webllm.prebuiltAppConfig && Array.isArray(webllm.prebuiltAppConfig.model_list)) {
        const found = webllm.prebuiltAppConfig.model_list.some(m => m.model_id === targetModel);
        if (!found) {
          console.warn(`[WebGPU v3.0] Modèle ${targetModel} non trouvé, repli sur SmolLM2-360M-Instruct-q4f16_1-MLC`);
          targetModel = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
        }
      }

      const isAlreadyCached = await this.isModelCached(targetModel);
      console.log(`[WebGPU v3.0] Modèle ${targetModel} en cache local hors-ligne : ${isAlreadyCached ? 'OUI (0 téléchargement Internet)' : 'NON (1er téléchargement requis)'}`);

      let lastPercent = -1;
      const initProgressCallback = (report) => {
        const percent = Math.round((report.progress || 0) * 100);
        const text = report.text || '';
        const isFetchingFromNet = !isAlreadyCached && text.includes('Fetching param cache');
        if (percent !== lastPercent && (percent % 10 === 0 || percent === 100)) {
          lastPercent = percent;
          console.log(`[WebGPU v3.0 ${isFetchingFromNet ? 'Téléchargement 1ère fois' : 'Lecture Cache Local -> GPU'}] ${text} (${percent}%)`);
        }
        if (onProgress) {
          onProgress({
            text,
            progress: report.progress,
            percent: isNaN(percent) ? 0 : percent,
            fromCache: isAlreadyCached || text.includes('Loading model from cache')
          });
        }
      };

      const contextWindowSize = targetModel.includes('SmolLM2') || targetModel.includes('Qwen') ? 4096 : 2048;
      const chatOpts = {
        context_window_size: contextWindowSize,
        sliding_window_size: -1
      };

      await this.unload();

      console.log(`[WebGPU v3.0] Création CreateMLCEngine (Adreno Safe-Decode, context_window_size=${contextWindowSize})...`);
      this.engine = await webllm.CreateMLCEngine(
        targetModel,
        { initProgressCallback },
        chatOpts
      );

      this.currentModel = targetModel;
      this.isLoaded = true;
      localStorage.setItem('webgpu_model', targetModel);
      console.log(`[WebGPU v3.0] Modèle ${targetModel} initialisé et prêt en VRAM (fenêtre: ${contextWindowSize} tokens).`);
      return this.engine;
    } catch (err) {
      console.error(`[WebGPU v3.0] Erreur dans loadModel(${targetModel}):`, err);
      throw err;
    } finally {
      this.isLoading = false;
      await this._releaseWakeLock();
    }
  }

  /**
   * Stream chat completion directly in-browser
   */
  async streamChat(messages, onToken, signal, onLoadingProgress) {
    console.log(`[WebGPU v3.0] Requête streamChat (${messages.length} messages) pour modèle: ${this.currentModel}`);
    if (!this.isLoaded || !this.engine) {
      console.log('[WebGPU v3.0] Modèle non encore monté en VRAM, chargement depuis le cache local...');
      await this.loadModel(this.currentModel, onLoadingProgress);
    }

    let abortHandler = null;
    if (signal) {
      if (signal.aborted) {
        throw new DOMException('Génération annulée par l\'utilisateur', 'AbortError');
      }
      abortHandler = () => {
        console.log('[WebGPU v3.0] Signal abort reçu : appel de engine.interruptGenerate()');
        if (this.engine && typeof this.engine.interruptGenerate === 'function') {
          this.engine.interruptGenerate();
        }
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    await this._acquireWakeLock();
    try {
      const t0 = performance.now();
      console.log('[WebGPU v3.0] Lancement chat.completions.create (Adreno Safe-Decode)...');
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
          console.log('[WebGPU v3.0] Signal d\'annulation détecté dans la boucle de streaming.');
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
            console.log(`[WebGPU v3.0] Premier jeton généré avec succès en ${ttft}s !`);
          }
          tokenCount++;
          fullText += delta;
          if (onToken) onToken(delta, fullText);
        }
      }

      const totalSec = ((performance.now() - t0) / 1000).toFixed(2);
      console.log(`[WebGPU v3.0] Fin de génération (${tokenCount} jetons en ${totalSec}s, raison: ${finishReason || 'stop'}).`);
      return fullText;
    } catch (err) {
      const msg = err?.message || String(err);
      if (
        msg.includes('Device was lost') ||
        msg.includes('Instance reference no longer exists') ||
        msg.includes('dropped in popErrorScope') ||
        msg.includes('Buffer was unmapped')
      ) {
        console.warn('[WebGPU v3.0] Contexte GPU perdu (Device was lost). Réinitialisation de l\'instance.');
        await this.unload();
      }
      console.error('[WebGPU v3.0] Erreur durant streamChat:', err);
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
        console.warn('Erreur déchargement WebGPU:', e);
      }
      this.engine = null;
    }
    this.isLoaded = false;
    this.isLoading = false;
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
        return true;
      } catch (e) {
        console.warn('Erreur suppression cache WebGPU:', e);
      }
    }
    return false;
  }
}
