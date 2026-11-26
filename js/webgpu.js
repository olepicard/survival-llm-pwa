/**
 * WebGPU Local In-Browser LLM Engine v3.3 (Tuned Sampling Hyperparameters + Smart Hardware Profiler + Full Offline)
 * Automatically detects GPU/VRAM/RAM capabilities to select the optimal LLM model for the device,
 * downloads all WebGPU resources ONCE into permanent CacheStorage, and runs 100% offline.
 */

const LOCAL_WEBLLM_URL = './vendor/web-llm.js?v=3.3';

export const WEBGPU_MODELS = [
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 360M Instruct',
    sizeMB: 195,
    vramMB: 376,
    tier: 'mobile',
    desc: 'Idéal smartphone Adreno / S25 Ultra : ne consomme que 376 Mo de VRAM (fenêtre 4096 tokens), ultra-rapide et 100% stable sans crash GPU (~195 Mo)'
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 0.5B Instruct',
    sizeMB: 360,
    vramMB: 550,
    tier: 'mobile-flagship',
    desc: 'Modèle 500M compact et précis en français pour smartphones haut de gamme (8 Go+ RAM) et tablettes (~360 Mo)'
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 1B Instruct',
    sizeMB: 720,
    vramMB: 880,
    tier: 'pc-laptop',
    desc: 'Modèle 1B idéal pour PC portables, Mac et tablettes Pro (~720 Mo • 880 Mo VRAM)'
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 3B Instruct',
    sizeMB: 1800,
    vramMB: 2260,
    tier: 'pc-desktop',
    desc: 'Modèle 3B haute précision pour PC avec carte graphique dédiée (RTX / Radeon) ou Apple Silicon M1/M2/M3/M4 (~1.8 Go • 2.3 Go VRAM)'
  }
];

export class WebGPUEngine {
  constructor() {
    this.engine = null;
    this.hardwareProfile = null;
    let saved = localStorage.getItem('webgpu_model');
    const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    if (isMobile && (!saved || saved.includes('Llama') || saved.includes('3B'))) {
      saved = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
      localStorage.setItem('webgpu_model', saved);
    }
    this.currentModel = saved || (isMobile ? 'SmolLM2-360M-Instruct-q4f16_1-MLC' : 'Llama-3.2-1B-Instruct-q4f16_1-MLC');
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
   * Detect GPU, VRAM buffer limits, FP16 support, system RAM & CPU cores,
   * and determine the most performant & stable LLM model for this smartphone or PC.
   */
  async detectHardwareProfile() {
    if (this.hardwareProfile) return this.hardwareProfile;

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isMobile = /Android|iPhone|iPod|Mobile/i.test(ua);
    const isTablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
    const ramGB = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : (isMobile ? 8 : 16);
    const cpuCores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 8;

    const profile = {
      supported: false,
      isMobile,
      isTablet,
      isDesktop: !isMobile && !isTablet,
      deviceCategory: isMobile ? 'Smartphone' : (isTablet ? 'Tablette' : 'PC / Mac'),
      gpuVendor: 'Inconnu',
      gpuArch: '',
      gpuDescription: 'GPU Standard',
      maxBufferMB: 256,
      maxStorageBindingMB: 128,
      maxWorkgroupStorageKB: 16,
      hasF16: false,
      ramGB,
      cpuCores,
      tier: 'mobile-standard',
      tierLabel: 'Smartphone Standard',
      recommendedModel: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
      alternativeModel: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      reason: 'Modèle ultra-léger recommandé par défaut.'
    };

    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      profile.reason = 'API WebGPU non supportée sur ce navigateur (utilisez Chrome ou Edge).';
      this.hardwareProfile = profile;
      return profile;
    }

    try {
      let adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
      if (!adapter) {
        adapter = await navigator.gpu.requestAdapter();
      }
      if (!adapter) {
        profile.reason = 'Aucun adaptateur matériel WebGPU détecté.';
        this.hardwareProfile = profile;
        return profile;
      }

      profile.supported = true;

      // Extract GPU info
      const info = adapter.info || {};
      const vendor = (info.vendor || '').toLowerCase();
      const arch = (info.architecture || '').toLowerCase();
      const desc = info.description || info.device || '';

      profile.gpuVendor = info.vendor ? info.vendor.toUpperCase() : (isMobile ? 'QUALCOMM / ARM' : 'GPU');
      profile.gpuArch = info.architecture || '';
      profile.gpuDescription = desc || [profile.gpuVendor, profile.gpuArch].filter(Boolean).join(' ') || 'Adaptateur WebGPU';

      // Extract WebGPU hardware memory & compute limits
      const limits = adapter.limits || {};
      profile.maxBufferMB = Math.round((limits.maxBufferSize || 268435456) / (1024 * 1024));
      profile.maxStorageBindingMB = Math.round((limits.maxStorageBufferBindingSize || 134217728) / (1024 * 1024));
      profile.maxWorkgroupStorageKB = Math.round((limits.maxComputeWorkgroupStorageSize || 16384) / 1024);
      profile.hasF16 = adapter.features ? adapter.features.has('shader-f16') : false;

      // Classify device into 4 performance tiers
      const isDedicatedDesktopGPU =
        !isMobile &&
        !isTablet &&
        (
          vendor.includes('nvidia') ||
          vendor.includes('amd') ||
          vendor.includes('apple') ||
          (profile.maxBufferMB >= 2048 && profile.maxStorageBindingMB >= 1024 && ramGB >= 8)
        );

      if (isMobile) {
        const isFlagshipPhone =
          profile.hasF16 &&
          profile.maxBufferMB >= 1024 &&
          profile.maxStorageBindingMB >= 512 &&
          ramGB >= 8;

        if (isFlagshipPhone) {
          profile.tier = 'mobile-flagship';
          profile.tierLabel = '📱🚀 Smartphone Haut de Gamme (Flagship WebGPU FP16)';
          profile.recommendedModel = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
          profile.alternativeModel = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
          profile.reason =
            `Puce mobile haut de gamme (${profile.gpuDescription}, FP16 actif, buffer ${profile.maxBufferMB} Mo, ~${ramGB} Go RAM). ` +
            `SmolLM2 360M (376 Mo VRAM) est sélectionné pour une vitesse instantanée et 0% de crash pilote Vulkan. ` +
            `Votre appareil supporte aussi Qwen 2.5 0.5B (360 Mo).`;
        } else {
          profile.tier = 'mobile-standard';
          profile.tierLabel = '📱 Smartphone Standard / Éco';
          profile.recommendedModel = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
          profile.alternativeModel = null;
          profile.reason =
            `Smartphone (${profile.gpuDescription}, binding max ${profile.maxStorageBindingMB} Mo). ` +
            `SmolLM2 360M (376 Mo VRAM) est le seul modèle garantissant une exécution stable sans dépassement mémoire.`;
        }
      } else if (isDedicatedDesktopGPU && profile.maxBufferMB >= 2048 && profile.maxStorageBindingMB >= 1024) {
        profile.tier = 'pc-desktop';
        profile.tierLabel = '🖥️ PC Haute Performance / GPU Dédié ou Apple Silicon';
        profile.recommendedModel = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';
        profile.alternativeModel = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
        profile.reason =
          `GPU puissant détecté (${profile.gpuDescription}, buffer max ${profile.maxBufferMB} Mo, binding ${profile.maxStorageBindingMB} Mo, ~${ramGB} Go RAM). ` +
          `Votre machine peut exécuter Llama 3.2 3B (1.8 Go) à pleine vitesse, ou Llama 3.2 1B (720 Mo) pour des réponses ultra-rapides.`;
      } else {
        profile.tier = 'pc-laptop';
        profile.tierLabel = isTablet ? '📲 Tablette WebGPU' : '💻 PC Portable / GPU Intégré';
        profile.recommendedModel = isTablet ? 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC' : 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
        profile.alternativeModel = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
        profile.reason =
          `${profile.deviceCategory} (${profile.gpuDescription}, buffer max ${profile.maxBufferMB} Mo, ~${ramGB} Go RAM). ` +
          `Le modèle ${profile.recommendedModel.split('-Instruct')[0]} offre le meilleur équilibre entre qualité et fluidité sur ce GPU.`;
      }

      console.log(
        `[WebGPU v3.2 Profil Matériel] ${profile.tierLabel} | GPU: ${profile.gpuDescription} | ` +
        `BufferMax: ${profile.maxBufferMB} Mo | BindingMax: ${profile.maxStorageBindingMB} Mo | FP16: ${profile.hasF16} | ` +
        `RAM: ~${profile.ramGB} Go | Cœurs: ${profile.cpuCores} => Modèle optimal : ${profile.recommendedModel}`
      );
    } catch (err) {
      console.warn('[WebGPU v3.2] Erreur profilage matériel:', err.message);
    }

    this.hardwareProfile = profile;
    return profile;
  }

  /**
   * Automatically select the optimal model for this hardware on first run
   * (while preserving any model already downloaded in offline CacheStorage!)
   */
  async autoSelectOptimalModel() {
    const profile = await this.detectHardwareProfile();
    if (!profile.supported) return profile;

    // 1. If the user explicitly locked a model choice in Settings, respect it (unless it's a 1B/3B model on mobile that would crash Adreno)
    const userLocked = localStorage.getItem('webgpu_model_user_locked') === 'true';
    if (userLocked) {
      if (profile.isMobile && (this.currentModel.includes('Llama') || this.currentModel.includes('3B'))) {
        this.currentModel = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
        localStorage.setItem('webgpu_model', this.currentModel);
      }
      return profile;
    }

    // 2. If the currently set model is ALREADY downloaded in offline cache, keep it so we never trigger an unwanted download!
    const currentIsCached = await this.isModelCached(this.currentModel);
    if (currentIsCached) {
      return profile;
    }

    // 3. Check if any other compatible model is already cached offline
    for (const m of WEBGPU_MODELS) {
      if (profile.isMobile && (m.id.includes('Llama') || m.id.includes('3B'))) continue;
      if (await this.isModelCached(m.id)) {
        this.currentModel = m.id;
        localStorage.setItem('webgpu_model', m.id);
        return profile;
      }
    }

    // 4. First time setup (no model cached yet): automatically select the hardware-recommended model!
    this.currentModel = profile.recommendedModel;
    localStorage.setItem('webgpu_model', this.currentModel);
    return profile;
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
      console.warn('[WebGPU v3.2] Vérification cache complet:', e.message);
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
        `[WebGPU v3.2] Modèle ${targetModel} en cache permanent hors-ligne : ${
          isAlreadyCached ? 'OUI (100% Hors-Ligne, 0 Mo réseau)' : 'NON (Téléchargement initial unique requis)'
        }`
      );

      if (!isAlreadyCached && typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error(
          `Le modèle WebGPU (${targetModel}) n'a pas encore été téléchargé dans le cache hors-ligne. ` +
          `Activez Internet une seule fois pour télécharger les ressources WebGPU, puis utilisez l'application 100% hors-ligne.`
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
            `[WebGPU v3.2 ${fromCache ? 'Cache Local Hors-Ligne -> VRAM' : 'Téléchargement Initial Unique'}] ${text} (${percent}%)`
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
      console.log(`[WebGPU v3.2] Modèle ${targetModel} monté en VRAM et prêt (100% Hors-Ligne, fenêtre ${contextWindowSize} tokens).`);
      window.dispatchEvent(new CustomEvent('webgpu-ready', { detail: { model: targetModel } }));
      return this.engine;
    })();

    try {
      return await this.loadPromise;
    } catch (err) {
      console.error(`[WebGPU v3.2] Erreur dans loadModel(${targetModel}):`, err);
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
    console.log(`[WebGPU v3.2] Requête streamChat (${messages.length} messages) pour modèle: ${this.currentModel}`);
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
      const modelId = this.currentModel || '';

      // Modèle-spécifique : hyperparamètres de sampling optimisés pour éviter les répétitions et l'incohérence
      let temperature = parseFloat(localStorage.getItem('llm_temperature') || '0.6');
      let top_p = 0.80;
      let repetition_penalty = 1.10;
      let max_tokens = 512;
      let stop = ["<|im_end|>", "<|endoftext|>"];

      if (modelId.includes('SmolLM2')) {
        top_p = 0.85;
        repetition_penalty = 1.15;
        max_tokens = 450;
      } else if (modelId.includes('Qwen2.5')) {
        // Paramètres recommandés MLC pour Qwen 2.5 0.5B Instruct :
        // top_p: 0.80, repetition_penalty: 1.10, ChatML stops
        top_p = 0.80;
        repetition_penalty = 1.10;
        max_tokens = 512;
        stop = ["<|im_end|>", "<|endoftext|>", "user<|im_end|>", "assistant<|im_end|>"];
      } else if (modelId.includes('Llama-3.2-1B')) {
        top_p = 0.90;
        repetition_penalty = 1.10;
        max_tokens = 600;
        stop = ["<|eot_id|>", "<|end_of_text|>"];
      } else if (modelId.includes('Llama-3.2-3B')) {
        top_p = 0.90;
        repetition_penalty = 1.08;
        max_tokens = 768;
        stop = ["<|eot_id|>", "<|end_of_text|>"];
      }

      // Respecter les surcharges manuelles utilisateur si définies
      const customTopP = parseFloat(localStorage.getItem('llm_top_p') || '');
      if (!isNaN(customTopP) && customTopP > 0 && customTopP <= 1) {
        top_p = customTopP;
      }
      const customRepPenalty = parseFloat(localStorage.getItem('llm_repetition_penalty') || '');
      if (!isNaN(customRepPenalty) && customRepPenalty >= 1) {
        repetition_penalty = customRepPenalty;
      }

      console.log(`[WebGPU v3.3] Inférence ${modelId} | temp=${temperature} | top_p=${top_p} | rep_penalty=${repetition_penalty} | max_tokens=${max_tokens}`);

      const stream = await this.engine.chat.completions.create({
        messages,
        stream: true,
        temperature,
        top_p,
        repetition_penalty,
        max_tokens,
        stop
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
            console.log(`[WebGPU v3.2] Premier jeton généré en ${ttft}s !`);
          }
          tokenCount++;
          fullText += delta;
          if (onToken) onToken(delta, fullText);
        }
      }

      const totalSec = ((performance.now() - t0) / 1000).toFixed(2);
      console.log(`[WebGPU v3.2] Fin de génération (${tokenCount} jetons en ${totalSec}s, raison: ${finishReason || 'stop'}).`);
      return fullText;
    } catch (err) {
      const msg = err?.message || String(err);
      if (
        msg.includes('Device was lost') ||
        msg.includes('Instance reference no longer exists') ||
        msg.includes('dropped in popErrorScope') ||
        msg.includes('Buffer was unmapped')
      ) {
        console.warn('[WebGPU v3.2] Contexte GPU perdu (Device was lost). Réinitialisation de l\'instance.');
        await this.unload();
      }
      console.error('[WebGPU v3.2] Erreur durant streamChat:', err);
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
