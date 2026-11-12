/**
 * WebGPU Local In-Browser LLM Engine (powered by WebLLM)
 * Enables 100% in-browser offline AI inference on Snapdragon Adreno / PC GPUs
 * Zero installation, zero terminal, zero Termux required!
 */

const WEBGPU_CDN_URL = 'https://esm.run/@mlc-ai/web-llm';

export const WEBGPU_MODELS = [
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 1B Instruct (Recommandé S25 Ultra)',
    sizeMB: 720,
    desc: 'Ultra rapide, excellent en français et premiers secours (720 Mo)'
  },
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 360M Instruct (Ultra Léger)',
    sizeMB: 210,
    desc: 'Téléchargement éclair, idéal pour tester ou stockage restreint (210 Mo)'
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 0.5B Instruct (Léger & Précis)',
    sizeMB: 360,
    desc: 'Très compact et efficace pour les fiches d\'urgence (360 Mo)'
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 3B Instruct (Haute Précision)',
    sizeMB: 1800,
    desc: 'Modèle complet pour PC ou smartphones 12 Go+ de RAM (1.8 Go)'
  }
];

export class WebGPUEngine {
  constructor() {
    this.engine = null;
    this.currentModel = localStorage.getItem('webgpu_model') || 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
    this.isLoaded = false;
    this.isLoading = false;
    this.webLLMModule = null;
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
   * Dynamically import WebLLM library
   */
  async _getWebLLM() {
    if (this.webLLMModule) return this.webLLMModule;
    try {
      this.webLLMModule = await import(WEBGPU_CDN_URL);
      return this.webLLMModule;
    } catch (err) {
      try {
        this.webLLMModule = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/+esm');
        return this.webLLMModule;
      } catch (err2) {
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
      return this.engine;
    }

    const support = await this.checkSupport();
    if (!support.supported) {
      throw new Error(support.reason);
    }

    this.isLoading = true;
    const webllm = await this._getWebLLM();

    try {
      // Validate model exists in prebuilt catalog or fallback to recommended
      if (webllm.prebuiltAppConfig && Array.isArray(webllm.prebuiltAppConfig.model_list)) {
        const found = webllm.prebuiltAppConfig.model_list.some(m => m.model_id === targetModel);
        if (!found) {
          console.warn(`Modèle ${targetModel} non répertorié dans prebuiltAppConfig, repli sur Llama-3.2-1B-Instruct-q4f16_1-MLC`);
          targetModel = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
        }
      }

      const initProgressCallback = (report) => {
        if (onProgress) {
          const percent = Math.round(report.progress * 100);
          onProgress({
            text: report.text,
            progress: report.progress,
            percent: isNaN(percent) ? 0 : percent
          });
        }
      };

      // CRITICAL: Do NOT pass a bare appConfig object without model_list!
      // Passing { initProgressCallback } lets WebLLM safely use its internal prebuiltAppConfig.model_list.
      this.engine = await webllm.CreateMLCEngine(targetModel, {
        initProgressCallback
      });

      this.currentModel = targetModel;
      this.isLoaded = true;
      localStorage.setItem('webgpu_model', targetModel);
      return this.engine;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Stream chat completion directly in-browser
   */
  async streamChat(messages, onToken, signal, onLoadingProgress) {
    if (!this.isLoaded || !this.engine) {
      await this.loadModel(this.currentModel, onLoadingProgress);
    }

    const stream = await this.engine.chat.completions.create({
      messages,
      stream: true,
      temperature: parseFloat(localStorage.getItem('llm_temperature') || '0.7'),
      max_tokens: 1536
    });

    let fullText = '';
    for await (const chunk of stream) {
      if (signal && signal.aborted) {
        break;
      }
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullText += delta;
        if (onToken) onToken(delta, fullText);
      }
    }

    return fullText;
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
