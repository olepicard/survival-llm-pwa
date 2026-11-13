/**
 * WebGPU Local In-Browser LLM Engine (powered by WebLLM)
 * Enables 100% in-browser offline AI inference on Snapdragon Adreno / PC GPUs
 * Zero installation, zero terminal, zero Termux required!
 */

const WEBGPU_CDN_URL = 'https://esm.run/@mlc-ai/web-llm';

export const WEBGPU_MODELS = [
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 360M Instruct (Recommandé Smartphone • Stable VRAM)',
    sizeMB: 210,
    desc: 'Idéal smartphone Adreno / S25 Ultra : ne consomme que 376 Mo de VRAM, 100% stable sans crash GPU (210 Mo)'
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 1B Instruct (Recommandé PC / Tablettes)',
    sizeMB: 720,
    desc: 'Modèle 1B (attention : peut saturer la VRAM sur certains smartphones Android) (720 Mo)'
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 0.5B Instruct (Léger & Précis)',
    sizeMB: 360,
    desc: 'Très compact et efficace pour les fiches d\'urgence (360 Mo)'
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
      console.log('[WebGPU] Smartphone détecté : configuration forcée sur SmolLM2-360M (376 Mo VRAM) pour éliminer le crash Adreno.');
      saved = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
      localStorage.setItem('webgpu_model', saved);
    }
    this.currentModel = saved || 'SmolLM2-360M-Instruct-q4f16_1-MLC';
    this.isLoaded = false;
    this.isLoading = false;
    this.webLLMModule = null;
    this.wakeLock = null;

    // Réactivation automatique du WakeLock si l'utilisateur revient sur l'onglet pendant un téléchargement
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
   * (Évite la rupture des sockets réseau et l'erreur Cache.add() sur Android)
   */
  async _acquireWakeLock() {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && !this.wakeLock) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        console.log('[WebGPU] WakeLock actif : écran maintenu allumé pour sécuriser le transfert.');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      } catch (e) {
        console.warn('[WebGPU] WakeLock écran refusé ou non supporté:', e.message);
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
        console.log('[WebGPU] WakeLock relâché.');
      } catch (e) {
        // ignore
      }
      this.wakeLock = null;
    }
  }

  /**
   * Check if the browser and hardware support WebGPU
   */
  async checkSupport() {
    if (!('gpu' in navigator)) {
      console.warn('[WebGPU] navigator.gpu non disponible dans ce navigateur.');
      return {
        supported: false,
        reason: 'L\'API WebGPU n\'est pas disponible dans ce navigateur. Utilisez Chrome ou Edge récent.'
      };
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        console.warn('[WebGPU] requestAdapter a renvoyé null (aucun adaptateur GPU compatible).');
        return {
          supported: false,
          reason: 'Aucun adaptateur GPU compatible WebGPU détecté sur cet appareil.'
        };
      }
      console.log('[WebGPU] Adaptateur GPU détecté avec succès.');
      return { supported: true, adapter };
    } catch (err) {
      console.error('[WebGPU] Erreur lors de requestAdapter:', err);
      return {
        supported: false,
        reason: `Erreur d'initialisation WebGPU: ${err.message}`
      };
    }
  }

  /**
   * Dynamically import WebLLM library
   */
  async _getWebLLM() {
    if (this.webLLMModule) return this.webLLMModule;
    try {
      console.log(`[WebGPU] Chargement du module WebLLM depuis ${WEBGPU_CDN_URL}...`);
      this.webLLMModule = await import(WEBGPU_CDN_URL);
      console.log('[WebGPU] Module WebLLM chargé depuis esm.run.');
      return this.webLLMModule;
    } catch (err) {
      console.warn('[WebGPU] Échec esm.run, tentative de secours jsdelivr...', err);
      try {
        this.webLLMModule = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/+esm');
        console.log('[WebGPU] Module WebLLM chargé depuis jsdelivr.');
        return this.webLLMModule;
      } catch (err2) {
        console.error('[WebGPU] Échec complet chargement WebLLM:', err2);
        throw new Error(`Impossible de charger la bibliothèque WebGPU WebLLM (${err.message}). Vérifiez votre connexion Internet pour le chargement initial.`);
      }
    }
  }

  /**
   * Initialize or switch model
   */
  async loadModel(modelId, onProgress) {
    let targetModel = modelId || this.currentModel;

    if (this.engine && this.currentModel === targetModel && this.isLoaded) {
      console.log(`[WebGPU] Modèle ${targetModel} déjà instancié en VRAM.`);
      return this.engine;
    }

    console.log(`[WebGPU] Démarrage chargement modèle : ${targetModel}`);
    const support = await this.checkSupport();
    if (!support.supported) {
      throw new Error(support.reason);
    }

    this.isLoading = true;
    await this._acquireWakeLock();
    const webllm = await this._getWebLLM();

    try {
      // Validate model exists in prebuilt catalog or fallback to recommended
      if (webllm.prebuiltAppConfig && Array.isArray(webllm.prebuiltAppConfig.model_list)) {
        const found = webllm.prebuiltAppConfig.model_list.some(m => m.model_id === targetModel);
        if (!found) {
          console.warn(`[WebGPU] Modèle ${targetModel} non répertorié dans prebuiltAppConfig, repli sur Llama-3.2-1B-Instruct-q4f16_1-MLC`);
          targetModel = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
        }
      }

      console.log(`[WebGPU] Création du moteur CreateMLCEngine pour ${targetModel}...`);
      let lastPercent = -1;
      const initProgressCallback = (report) => {
        const percent = Math.round(report.progress * 100);
        if (percent !== lastPercent && (percent % 10 === 0 || percent === 100)) {
          lastPercent = percent;
          console.log(`[WebGPU Téléchargement] ${report.text} (${percent}%)`);
        }
        if (onProgress) {
          onProgress({
            text: report.text,
            progress: report.progress,
            percent: isNaN(percent) ? 0 : percent
          });
        }
      };

      // CRITICAL: Do NOT pass a bare appConfig object without model_list!
      // Passing { initProgressCallback } lets WebLLM safely use its internal prebuiltAppConfig.model_list.
      // Passing { context_window_size: 1024 } optimizes KV-Cache memory consumption on mobile Adreno GPUs by 75%!
      this.engine = await webllm.CreateMLCEngine(targetModel, {
        initProgressCallback
      }, {
        context_window_size: 1024
      });

      this.currentModel = targetModel;
      this.isLoaded = true;
      localStorage.setItem('webgpu_model', targetModel);
      console.log(`[WebGPU] Modèle ${targetModel} initialisé et opérationnel.`);
      return this.engine;
    } catch (err) {
      console.error(`[WebGPU] Erreur dans loadModel(${targetModel}):`, err);
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
    console.log(`[WebGPU] Requête streamChat (${messages.length} messages) pour modèle: ${this.currentModel}`);
    if (!this.isLoaded || !this.engine) {
      console.log('[WebGPU] Modèle non chargé, appel préalable à loadModel()...');
      await this.loadModel(this.currentModel, onLoadingProgress);
    }

    await this._acquireWakeLock();
    try {
      console.log('[WebGPU] Lancement chat.completions.create...');
      const stream = await this.engine.chat.completions.create({
        messages,
        stream: true,
        temperature: parseFloat(localStorage.getItem('llm_temperature') || '0.7'),
        max_tokens: 1536
      });

      let fullText = '';
      let tokenCount = 0;
      for await (const chunk of stream) {
        if (signal && signal.aborted) {
          console.log('[WebGPU] Signal d\'annulation reçu pendant l\'inférence.');
          break;
        }
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          if (tokenCount === 0) {
            console.log('[WebGPU] Premier jeton reçu.');
          }
          tokenCount++;
          fullText += delta;
          if (onToken) onToken(delta, fullText);
        }
      }

      console.log(`[WebGPU] Fin de génération (${tokenCount} jetons).`);
      return fullText;
    } catch (err) {
      if (err.message && (err.message.includes('Device was lost') || err.message.includes('Instance reference no longer exists') || err.message.includes('dropped in popErrorScope'))) {
        console.warn('[WebGPU] Contexte GPU perdu (Device was lost). Réinitialisation de l\'instance pour libérer la VRAM.');
        this.engine = null;
        this.isLoaded = false;
      }
      console.error('[WebGPU] Erreur durant streamChat:', err);
      throw err;
    } finally {
      await this._releaseWakeLock();
    }
  }

  /**
   * Reset / unload model to free memory
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
   * Clear downloaded model shards from browser CacheStorage
   */
  async clearCache() {
    await this.unload();
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (const key of keys) {
          if (key.includes('webllm') || key.includes('mlc') || key.includes('wasm')) {
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
