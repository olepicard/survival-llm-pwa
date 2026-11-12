/**
 * Target Architecture Detector & Ollama / llama.cpp Engine Matcher
 * Identifies smartphone (Android ARM64 / Snapdragon 8 Elite) vs PC (Windows x86_64 / Linux)
 * and provides targeted native llama.cpp / Ollama commands and configurations from https://github.com/ollama/ollama/
 */

export class ArchitectureDetector {
  constructor() {
    this.info = null;
  }

  async detect() {
    if (this.info) return this.info;

    const ua = navigator.userAgent || '';
    let platform = navigator.platform || '';
    let arch = 'unknown';
    let bitness = '64';
    let model = '';
    let isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    let isAndroid = /Android/i.test(ua);
    let isWindows = /Windows/i.test(ua);
    let isMac = /Macintosh|Mac OS X/i.test(ua);
    let isLinux = /Linux/i.test(ua) && !isAndroid;

    // Use User-Agent Client Hints if available
    if (navigator.userAgentData) {
      isMobile = navigator.userAgentData.mobile || isMobile;
      platform = navigator.userAgentData.platform || platform;

      if (navigator.userAgentData.getHighEntropyValues) {
        try {
          const hints = await navigator.userAgentData.getHighEntropyValues([
            'architecture',
            'bitness',
            'model',
            'platform',
            'platformVersion'
          ]);
          if (hints.architecture) arch = hints.architecture.toLowerCase();
          if (hints.bitness) bitness = hints.bitness;
          if (hints.model) model = hints.model;
          if (hints.platform) platform = hints.platform;
        } catch (e) {
          console.warn('Erreur lecture UserAgentData:', e);
        }
      }
    }

    // Heuristics for Android / S25 Ultra
    if (isAndroid) {
      if (arch === 'unknown' || !arch) arch = 'arm64';
      // Detect Samsung S25 Ultra or modern Samsung flagships
      if (/SM-S938|SM-S928|SM-S918/i.test(ua) || /SM-S938|SM-S928|SM-S918/i.test(model)) {
        model = model || 'Samsung Galaxy S25/S24 Ultra';
      }
    } else if (isWindows) {
      if (arch === 'unknown' || !arch) arch = 'x86_64';
    }

    // Inspect GPU renderer via WebGL
    const gpuInfo = this._getGPUInfo();

    // Map to Ollama & llama.cpp runner configuration from github.com/ollama/ollama
    let engineConfig = null;

    if (isAndroid || (arch.includes('arm') && isMobile)) {
      engineConfig = {
        targetName: 'Android ARM64 (Qualcomm Snapdragon / AArch64)',
        ollamaBinary: 'ollama-linux-arm64 (llama.cpp avec backend ggml-cpu NEON / Vulkan)',
        recommendedModel: 'llama3.2:1b (1.3 Go) ou llama3.2:3b (2.0 Go)',
        defaultEndpoint: 'http://127.0.0.1:11434',
        apiType: 'ollama',
        launchCommands: [
          {
            title: 'Option A : Ollama Natif sur Android (via Termux)',
            badge: 'Recommandé 100% Hors-Ligne',
            cmd: 'export OLLAMA_ORIGINS="*"\nollama serve &\nollama run llama3.2:1b'
          },
          {
            title: 'Option B : Serveur llama.cpp autonome ARM64 (llama-server)',
            badge: 'Ultra Rapide Adreno Vulkan',
            cmd: 'llama-server -m llama-3.2-1b-instruct-q4_k_m.gguf --port 11434 --host 127.0.0.1 -ngl 99'
          },
          {
            title: 'Option C : PocketPal AI / Edge Gallery (APK Android)',
            badge: 'Interface Graphique Port 8080',
            cmd: 'Activer le mode "Local Server" dans l\'application PocketPal AI (port 8080 ou 11434)'
          }
        ]
      };
    } else if (isWindows) {
      engineConfig = {
        targetName: 'Windows x86_64 (AVX2 / CUDA / Vulkan)',
        ollamaBinary: 'ollama-windows-amd64.exe (llama.cpp runner avec CUDA/Vulkan)',
        recommendedModel: 'llama3.2:3b (2.0 Go) ou mistral:7b (4.1 Go)',
        defaultEndpoint: 'http://127.0.0.1:11434',
        apiType: 'ollama',
        launchCommands: [
          {
            title: 'Ollama Windows Local (sur le même PC)',
            badge: 'Local Direct',
            cmd: 'ollama run llama3.2:3b'
          },
          {
            title: 'Partage réseau local PC vers Smartphone S25 Ultra (WiFi/Hotspot)',
            badge: 'Accès Réseau Local',
            cmd: 'set OLLAMA_HOST=0.0.0.0\nset OLLAMA_ORIGINS=*\nollama serve'
          }
        ]
      };
    } else {
      engineConfig = {
        targetName: `${platform} ${arch}`,
        ollamaBinary: `ollama-${platform.toLowerCase()}-${arch}`,
        recommendedModel: 'llama3.2:3b',
        defaultEndpoint: 'http://127.0.0.1:11434',
        apiType: 'ollama',
        launchCommands: [
          {
            title: 'Lancement standard Ollama',
            badge: 'Local',
            cmd: 'ollama run llama3.2:3b'
          }
        ]
      };
    }

    this.info = {
      platform,
      arch,
      bitness,
      model,
      isMobile,
      isAndroid,
      isWindows,
      gpu: gpuInfo,
      engine: engineConfig
    };

    return this.info;
  }

  _getGPUInfo() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return 'WebGL non disponible';
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'GPU Inconnu';
      }
    } catch {
      // ignore
    }
    return 'Accélérateur graphique standard';
  }
}
