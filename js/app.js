/**
 * Main Application Controller for Survival LLM PWA
 * Orchestrates local offline guides, storage capacity management,
 * WebGPU in-browser engine (default), and external Ollama / llama.cpp engines.
 */

import { LLMClient } from './api.js';
import { GuidesDB } from './db.js';
import { EmergencyManager } from './emergency.js';
import { RAGEngine } from './rag.js';
import { ArchitectureDetector } from './arch.js';
import { renderMarkdown, escapeHtml } from './markdown.js';

// In-Memory Circular Log Buffer for Mobile UI Debugging
export const APP_LOGS = [];
const MAX_LOG_ENTRIES = 250;

function formatLogEntry(level, args) {
  const now = new Date();
  const time = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const msg = args.map(arg => {
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.stringify(arg);
      } catch (e) {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
  return `[${time}] [${level}] ${msg}`;
}

const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origError = console.error.bind(console);

console.log = (...args) => {
  origLog(...args);
  APP_LOGS.push(formatLogEntry('LOG', args));
  if (APP_LOGS.length > MAX_LOG_ENTRIES) APP_LOGS.shift();
  window.dispatchEvent(new CustomEvent('app-log-updated'));
};

console.warn = (...args) => {
  origWarn(...args);
  APP_LOGS.push(formatLogEntry('WARN', args));
  if (APP_LOGS.length > MAX_LOG_ENTRIES) APP_LOGS.shift();
  window.dispatchEvent(new CustomEvent('app-log-updated'));
};

console.error = (...args) => {
  origError(...args);
  APP_LOGS.push(formatLogEntry('ERROR', args));
  if (APP_LOGS.length > MAX_LOG_ENTRIES) APP_LOGS.shift();
  window.dispatchEvent(new CustomEvent('app-log-updated'));
};

window.addEventListener('error', (event) => {
  console.error(`Uncaught error: ${event.message} at ${event.filename}:${event.lineno}`);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error(`Unhandled Promise rejection: ${event.reason}`);
});

class SurvivalApp {
  constructor() {
    this.api = new LLMClient();
    this.db = new GuidesDB();
    this.emergency = new EmergencyManager(this);
    this.rag = new RAGEngine(this.db, this.emergency);
    this.arch = new ArchitectureDetector();

    this.activeTab = 'chat';
    this.chatHistory = []; // { role: 'user'|'assistant', content: string }
    this.currentAbortController = null;
    this.deferredInstallPrompt = null;
    this.isDownloadingGuides = false;
    this.isGenerating = false;
    this.isUserAborted = false;

    this.init();
  }

  async init() {
    this.setupServiceWorker();
    this.setupInstallPrompt();
    this.setupTabs();
    this.setupSettingsUI();
    this.setupLogsUI();
    this.setupChatUI();
    this.setupGuidesUI();
    this.setupStorageUI();

    // Load emergency protocols
    await this.emergency.loadProtocols();
    this.emergency.renderEmergencyGrid(document.getElementById('sos-container'));

    // Load offline guides database
    await this.db.init();
    this.renderGuidesThemeSelector();
    this.searchAndRenderGuides();

    // Check storage & offline status
    await this.updateStorageStatusUI();
    this.checkInitialStoragePrompt();

    // Check network status
    this.updateOnlineStatus();
    window.addEventListener('online', () => this.updateOnlineStatus());
    window.addEventListener('offline', () => this.updateOnlineStatus());

    // Detect hardware architecture & update UI
    this.initArchitectureDisplay();

    // Auto-migrate to SmolLM2 on mobile to prevent Adreno GPU Device Lost crashes
    const isMobileDevice = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    const savedModel = localStorage.getItem('webgpu_model');
    if (isMobileDevice && (!localStorage.getItem('webgpu_mobile_migrated_v2') || savedModel === 'Llama-3.2-1B-Instruct-q4f16_1-MLC')) {
      console.log('[WebGPU] Smartphone détecté : sélection par défaut de SmolLM2-360M (376 Mo VRAM) pour garantir la stabilité Adreno.');
      localStorage.setItem('webgpu_model', 'SmolLM2-360M-Instruct-q4f16_1-MLC');
      localStorage.setItem('webgpu_mobile_migrated_v2', 'true');
      this.api.webgpu.currentModel = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
      const webgpuModelSel = document.getElementById('setting-webgpu-model');
      if (webgpuModelSel) webgpuModelSel.value = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
    }

    // Update engine badge
    this.updateEngineDisplayUI();
  }

  setupServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        console.log('ServiceWorker registered with scope:', reg.scope);
      }).catch((err) => {
        console.warn('ServiceWorker registration failed:', err);
      });
    }
  }

  setupInstallPrompt() {
    const installBtn = document.getElementById('btn-install-pwa');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      if (installBtn) {
        installBtn.style.display = 'inline-flex';
      }
    });

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!this.deferredInstallPrompt) return;
        this.deferredInstallPrompt.prompt();
        const { outcome } = await this.deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          installBtn.style.display = 'none';
        }
        this.deferredInstallPrompt = null;
      });
    }
  }

  updateOnlineStatus() {
    const badge = document.getElementById('status-badge');
    if (!badge) return;
    if (navigator.onLine) {
      badge.textContent = 'En ligne';
      badge.className = 'status-badge online';
    } else {
      badge.textContent = 'Hors-ligne (Avion)';
      badge.className = 'status-badge offline';
    }
  }

  updateEngineDisplayUI() {
    const topBadge = document.getElementById('engine-mode-badge');
    const activeBadge = document.getElementById('active-engine-badge');
    const chatDesc = document.getElementById('chat-engine-desc');

    const mode = this.api.engineMode;
    let label = '';
    let pillClass = 'badge-pill badge-primary';
    let desc = '';

    if (mode === 'webgpu') {
      label = '⚡ WebGPU In-Browser';
      pillClass = 'badge-pill badge-success';
      desc = 'Moteur IA actif : <strong>WebGPU Embarqué</strong> (s\'exécute directement sur le GPU de votre appareil, 100% hors-ligne, aucun terminal).';
    } else if (mode === 'ollama') {
      label = '📱 Ollama Local (11434)';
      pillClass = 'badge-pill badge-primary';
      desc = 'Moteur IA actif : <strong>Ollama / llama.cpp</strong> (port 11434 via Termux ou PC distant).';
    } else {
      label = '🤖 Serveur API (8080)';
      pillClass = 'badge-pill badge-neutral';
      desc = 'Moteur IA actif : <strong>Serveur Compatible OpenAI</strong> (PocketPal / LocalAI).';
    }

    if (topBadge) {
      topBadge.textContent = label;
      topBadge.className = pillClass;
    }
    if (activeBadge) {
      activeBadge.textContent = label;
      activeBadge.className = pillClass;
    }
    if (chatDesc) {
      chatDesc.innerHTML = desc;
    }
  }

  /* ---------------- Storage Management ---------------- */

  async updateStorageStatusUI() {
    const stats = await this.db.getStorageStats();
    const modeBadge = document.getElementById('storage-mode-badge');
    const statusPill = document.getElementById('storage-status-pill');
    const usageText = document.getElementById('storage-usage-text');
    const quotaText = document.getElementById('storage-quota-text');
    const meterFill = document.getElementById('storage-meter-fill');
    const persistHint = document.getElementById('storage-persistence-hint');
    const promptDeviceStats = document.getElementById('prompt-device-stats');

    const isFull = stats.isFullOffline;

    if (modeBadge) {
      if (isFull) {
        modeBadge.textContent = 'Full Hors-Ligne (16 Mo) ✅';
        modeBadge.className = 'badge-pill badge-success';
      } else {
        modeBadge.textContent = 'Mode Partiel (1.5 Mo) ⚠️';
        modeBadge.className = 'badge-pill badge-warning';
      }
    }

    if (statusPill) {
      if (isFull) {
        statusPill.textContent = 'Complet (670 guides prêts)';
        statusPill.className = 'badge-pill badge-success';
      } else {
        statusPill.textContent = 'Partiel (Index + SOS)';
        statusPill.className = 'badge-pill badge-warning';
      }
    }

    if (usageText) {
      usageText.textContent = `Stockage PWA : ${stats.usageMB} Mo utilisés`;
    }
    if (quotaText) {
      if (stats.availableMB > 1024) {
        const gb = (stats.availableMB / 1024).toFixed(1);
        quotaText.textContent = `Disque libre : ~${gb} Go`;
      } else {
        quotaText.textContent = `Disque libre : ~${stats.availableMB} Mo`;
      }
    }

    if (meterFill) {
      meterFill.style.width = `${Math.max(2, stats.percent)}%`;
    }

    if (persistHint) {
      persistHint.textContent = stats.persisted
        ? '🔒 Stockage persistant accordé (Android ne supprimera pas vos guides).'
        : '⚠️ Stockage persistant non verrouillé (cliquez pour sécuriser les données).';
    }

    if (promptDeviceStats) {
      const avail = stats.availableMB > 1024 ? `${(stats.availableMB / 1024).toFixed(1)} Go` : `${stats.availableMB} Mo`;
      promptDeviceStats.innerHTML = `<strong>Capacité testée :</strong> ${avail} libres sur votre appareil • <em>Requis pour Full : ~16 Mo</em>`;
    }

    return stats;
  }

  async checkInitialStoragePrompt() {
    const hasPrompted = localStorage.getItem('storage_prompt_shown');
    const isFull = await this.db.isFullOfflineReady();

    if (!hasPrompted && !isFull) {
      const modal = document.getElementById('storage-prompt-modal');
      if (modal && typeof modal.showModal === 'function') {
        modal.showModal();
      }
    }
  }

  setupStorageUI() {
    const promptModal = document.getElementById('storage-prompt-modal');
    const btnPromptFull = document.getElementById('btn-prompt-download-full');
    const btnPromptPartial = document.getElementById('btn-prompt-keep-partial');
    const btnDownloadFull = document.getElementById('btn-download-full-offline');
    const btnSwitchPartial = document.getElementById('btn-switch-partial-mode');
    const btnReqPersistence = document.getElementById('btn-request-persistence');

    if (btnPromptFull) {
      btnPromptFull.addEventListener('click', async () => {
        await this.triggerFullDownload('prompt');
      });
    }

    if (btnPromptPartial) {
      btnPromptPartial.addEventListener('click', () => {
        localStorage.setItem('storage_prompt_shown', 'true');
        localStorage.setItem('storage_offline_mode', 'partial');
        if (promptModal) promptModal.close();
        this.updateStorageStatusUI();
      });
    }

    if (btnDownloadFull) {
      btnDownloadFull.addEventListener('click', async () => {
        await this.triggerFullDownload('settings');
      });
    }

    if (btnSwitchPartial) {
      btnSwitchPartial.addEventListener('click', async () => {
        if (confirm('Voulez-vous libérer le cache des 670 guides intégraux et revenir au Mode Partiel (~1.5 Mo) ?')) {
          await this.db.clearFullGuidesCache();
          await this.updateStorageStatusUI();
          this.searchAndRenderGuides();
          alert('Mode Partiel activé. Les résumés et fiches SOS restent disponibles hors-ligne.');
        }
      });
    }

    if (btnReqPersistence) {
      btnReqPersistence.addEventListener('click', async () => {
        const granted = await this.db.requestPersistence();
        if (granted) {
          alert('✅ Stockage persistant accordé par le système !');
        } else {
          alert('ℹ️ Persistance automatique gérée par le navigateur.');
        }
        await this.updateStorageStatusUI();
      });
    }
  }

  async triggerFullDownload(source = 'settings') {
    if (this.isDownloadingGuides) return;
    this.isDownloadingGuides = true;

    const progressContainer = source === 'prompt'
      ? document.getElementById('prompt-download-progress-container')
      : document.getElementById('storage-download-progress-container');
    const statusText = source === 'prompt'
      ? document.getElementById('prompt-progress-status-text')
      : document.getElementById('storage-progress-status-text');
    const percentText = source === 'prompt'
      ? document.getElementById('prompt-progress-percent-text')
      : document.getElementById('storage-progress-percent-text');
    const fillEl = source === 'prompt'
      ? document.getElementById('prompt-download-fill')
      : document.getElementById('storage-download-fill');

    if (progressContainer) progressContainer.style.display = 'block';

    try {
      await this.db.downloadAllGuides((info) => {
        if (statusText) statusText.textContent = info.status;
        if (percentText) percentText.textContent = `${info.percent}%`;
        if (fillEl) fillEl.style.width = `${info.percent}%`;
      });

      localStorage.setItem('storage_prompt_shown', 'true');
      await this.updateStorageStatusUI();

      setTimeout(() => {
        if (progressContainer) progressContainer.style.display = 'none';
        if (source === 'prompt') {
          const modal = document.getElementById('storage-prompt-modal');
          if (modal) modal.close();
        }
        alert('🎉 Mode Full Hors-Ligne activé ! Tous les 670 guides sont enregistrés sur votre appareil.');
      }, 1000);

    } catch (err) {
      console.error('Download error:', err);
      if (statusText) statusText.textContent = `Erreur: ${err.message}`;
      alert(`Erreur lors du téléchargement des guides : ${err.message}\nVérifiez votre connexion Internet pour le téléchargement initial.`);
    } finally {
      this.isDownloadingGuides = false;
    }
  }

  /* ---------------- Architecture & Target Engine ---------------- */

  async initArchitectureDisplay() {
    try {
      const archInfo = await this.arch.detect();
      const devName = document.getElementById('arch-device-name');
      const cpuName = document.getElementById('arch-cpu-name');
      const engineName = document.getElementById('arch-engine-name');
      const cmdText = document.getElementById('arch-cmd-text');
      const copyBtn = document.getElementById('btn-copy-arch-cmd');

      if (devName) {
        devName.textContent = archInfo.model || `${archInfo.platform} (${archInfo.arch})`;
      }
      if (cpuName) {
        cpuName.textContent = `${archInfo.arch.toUpperCase()} (${archInfo.bitness} bits)`;
      }
      if (engineName) {
        engineName.textContent = archInfo.engine.ollamaBinary;
      }

      if (cmdText && archInfo.engine.launchCommands && archInfo.engine.launchCommands[0]) {
        cmdText.textContent = archInfo.engine.launchCommands[0].cmd;
      }

      if (copyBtn && cmdText) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(cmdText.textContent).then(() => {
            copyBtn.textContent = '✅ Copié !';
            setTimeout(() => { copyBtn.textContent = '📋 Copier'; }, 2000);
          });
        });
      }

    } catch (e) {
      console.warn('Erreur détection architecture:', e);
    }
  }

  /* ---------------- Tabs Navigation ---------------- */

  setupTabs() {
    const navButtons = document.querySelectorAll('.nav-tab-btn');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        this.switchTab(targetTab);
      });
    });
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.toggle('active', view.id === `tab-${tabName}`);
    });
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    if (tabName === 'chat') {
      this.scrollChatToBottom();
    } else if (tabName === 'settings') {
      this.updateStorageStatusUI();
      if (typeof this.updateLogsDisplay === 'function') {
        this.updateLogsDisplay();
      }
    }
  }

  /* ---------------- In-App Logs & Diagnostics UI ---------------- */

  setupLogsUI() {
    const logsViewer = document.getElementById('app-logs-viewer');
    const btnRefreshLogs = document.getElementById('btn-refresh-logs');
    const btnCopyLogs = document.getElementById('btn-copy-logs');
    const btnClearLogs = document.getElementById('btn-clear-logs');

    this.updateLogsDisplay = () => {
      if (!logsViewer) return;
      if (APP_LOGS.length === 0) {
        logsViewer.textContent = 'Aucun log enregistré pour le moment.';
      } else {
        logsViewer.textContent = APP_LOGS.join('\n');
        logsViewer.scrollTop = logsViewer.scrollHeight;
      }
    };

    if (btnRefreshLogs) {
      btnRefreshLogs.addEventListener('click', () => {
        this.updateLogsDisplay();
      });
    }

    if (btnCopyLogs) {
      btnCopyLogs.addEventListener('click', () => {
        const text = APP_LOGS.join('\n');
        navigator.clipboard.writeText(text).then(() => {
          btnCopyLogs.textContent = '✅ Copié';
          setTimeout(() => { btnCopyLogs.textContent = '📋 Copier'; }, 2000);
        }).catch(() => {
          alert('Impossible d\'accéder au presse-papier.');
        });
      });
    }

    if (btnClearLogs) {
      btnClearLogs.addEventListener('click', () => {
        APP_LOGS.length = 0;
        this.updateLogsDisplay();
      });
    }

    window.addEventListener('app-log-updated', () => {
      if (this.activeTab === 'settings') {
        this.updateLogsDisplay();
      }
    });

    this.updateLogsDisplay();
  }

  /* ---------------- Chat UI & Streaming ---------------- */

  setupChatUI() {
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');
    const stopBtn = document.getElementById('btn-stop-chat');
    const clearBtn = document.getElementById('btn-clear-chat');
    const ragToggle = document.getElementById('toggle-rag-checkbox');

    if (ragToggle) {
      ragToggle.checked = this.rag.enabled;
      ragToggle.addEventListener('change', () => {
        this.rag.setEnabled(ragToggle.checked);
      });
    }

    if (form && input) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (this.isGenerating) return;
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        this.sendChatMessage(text);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (this.isGenerating) return;
          form.dispatchEvent(new Event('submit'));
        }
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        console.log('[Chat] Action utilisateur : clic sur le bouton Arrêter la génération.');
        this.isUserAborted = true;
        if (this.currentAbortController) {
          this.currentAbortController.abort();
          this.currentAbortController = null;
        }
        this.setGenerating(false);
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Effacer l\'historique de la conversation ?')) {
          this.chatHistory = [];
          const container = document.getElementById('chat-messages');
          container.innerHTML = `
            <div class="chat-welcome">
              <div class="welcome-icon">🛡️</div>
              <h3>Assistant de Survie & Secourisme</h3>
              <p>Posez vos questions d'urgence, de premiers soins, d'autonomie ou de gestion de crise.</p>
              <div class="quick-prompts">
                <button class="btn-prompt-chip" data-q="Comment fabriquer un filtre à eau avec du sable et du charbon ?">💧 Filtre à eau naturel</button>
                <button class="btn-prompt-chip" data-q="Quelles sont les priorités absolues en cas d'accident avec hémorragie ?">🩸 Urgence hémorragie</button>
                <button class="btn-prompt-chip" data-q="Comment construire un abri anti-froid en forêt ?">🏕️ Abri d'urgence</button>
                <button class="btn-prompt-chip" data-q="Quels aliments stériliser à la cocotte-minute contre le botulisme ?">🥫 Prévention botulisme</button>
              </div>
            </div>
          `;
          this.attachQuickPrompts();
        }
      });
    }

    this.attachQuickPrompts();
  }

  attachQuickPrompts() {
    document.querySelectorAll('.btn-prompt-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = chip.getAttribute('data-q');
        if (q) {
          this.sendChatMessage(q);
        }
      });
    });
  }

  setGenerating(isGenerating) {
    this.isGenerating = isGenerating;
    const sendBtn = document.getElementById('btn-send-chat');
    const stopBtn = document.getElementById('btn-stop-chat');
    const input = document.getElementById('chat-input');

    if (sendBtn) sendBtn.style.display = isGenerating ? 'none' : 'inline-flex';
    if (stopBtn) stopBtn.style.display = isGenerating ? 'inline-flex' : 'none';
    if (input) input.disabled = isGenerating;
  }

  async sendChatMessage(text, forcedContext = '') {
    if (this.isGenerating) {
      console.warn('[Chat] Requête ignorée : une génération est déjà en cours.');
      return;
    }

    const messagesContainer = document.getElementById('chat-messages');
    
    const welcome = messagesContainer.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    this.isUserAborted = false;
    this.setGenerating(true);

    // Garde-fou automatique smartphone : empêche l'exécution de Llama 3.2 1B qui sature le GPU Adreno (Device was lost)
    const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    if (this.api.engineMode === 'webgpu' && isMobile && (this.api.webgpu.currentModel.includes('Llama') || this.api.webgpu.currentModel.includes('3B'))) {
      console.warn('[Chat] Garde-fou mobile : Llama 3.2 sature le GPU Adreno. Bascule automatique vers SmolLM2 360M.');
      const smol = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
      this.api.webgpu.currentModel = smol;
      this.api.saveSettings({ webgpuModel: smol });
      const sel = document.getElementById('setting-webgpu-model');
      if (sel) sel.value = smol;
      this.updateEngineDisplayUI();
    }

    // 1. Add User Message
    this.chatHistory.push({ role: 'user', content: text });
    const userMsgEl = document.createElement('div');
    userMsgEl.className = 'chat-message message-user';
    userMsgEl.innerHTML = `
      <div class="msg-bubble">${escapeHtml(text)}</div>
    `;
    messagesContainer.appendChild(userMsgEl);
    this.scrollChatToBottom();

    // 2. Prepare Context (RAG)
    let ragResult = { contextText: '', sources: [] };
    if (forcedContext) {
      ragResult.contextText = `\n\n${forcedContext}\nConsigne : Appuie-toi sur ces directives.`;
      ragResult.sources = [{ title: 'Protocole SOS Direct', id: 0 }];
    } else if (this.rag.enabled) {
      try {
        ragResult = await this.rag.retrieveContext(text);
      } catch (err) {
        console.warn('RAG retrieval failed:', err);
      }
    }

    // 3. Create Assistant Message Element
    const assistantMsgEl = document.createElement('div');
    assistantMsgEl.className = 'chat-message message-assistant';

    let sourcesHtml = '';
    if (ragResult.sources.length) {
      const badges = ragResult.sources.map(s => `<span class="source-tag">${escapeHtml(s.title)}</span>`).join(' ');
      sourcesHtml = `<div class="msg-sources"><span class="sources-title">📚 Sources locales consultées :</span> ${badges}</div>`;
    }

    const modelDisplayName = this.api.engineMode === 'webgpu' 
      ? `WebGPU (${(this.api.webgpu.currentModel || '').split('-')[0]})` 
      : this.api.model;

    assistantMsgEl.innerHTML = `
      <div class="msg-avatar">🛡️</div>
      <div class="msg-body">
        ${sourcesHtml}
        <div class="msg-bubble streaming-cursor">...</div>
        <div class="msg-footer">
          <span class="msg-model">${escapeHtml(modelDisplayName)}</span>
          <button class="btn-copy-msg" title="Copier la réponse">📋</button>
        </div>
      </div>
    `;
    messagesContainer.appendChild(assistantMsgEl);
    this.scrollChatToBottom();

    const bubbleEl = assistantMsgEl.querySelector('.msg-bubble');
    const copyBtn = assistantMsgEl.querySelector('.btn-copy-msg');

    // 4. Construct messages array for LLM
    const apiMessages = this.chatHistory.map(m => ({ ...m }));
    if (ragResult.contextText) {
      apiMessages[apiMessages.length - 1].content += ragResult.contextText;
    }

    this.currentAbortController = new AbortController();
    const startTime = performance.now();

    try {
      let accumulatedText = '';
      const fullResponse = await this.api.streamChat(
        apiMessages,
        (token, currentFull) => {
          accumulatedText = currentFull;
          bubbleEl.innerHTML = renderMarkdown(currentFull);
          this.scrollChatToBottom();
        },
        this.currentAbortController.signal,
        (loadingProgress) => {
          const percent = loadingProgress.percent || 0;
          bubbleEl.innerHTML = `
            <div class="webgpu-chat-loading-box">
              <div style="display: flex; justify-content: space-between; font-size: 0.82rem; margin-bottom: 6px;">
                <span>📥 <strong>[WebGPU] Chargement des poids...</strong></span>
                <span><strong>${percent}%</strong></span>
              </div>
              <div class="storage-progress-bar" style="height: 6px; margin-bottom: 6px;">
                <div class="progress-fill progress-fill-active" style="width: ${percent}%;"></div>
              </div>
              <div style="font-size: 0.74rem; color: var(--text-muted);">
                ${escapeHtml(loadingProgress.text || 'Téléchargement en cache...')}
                <br/><em>(Écran maintenu allumé grâce au WakeLock)</em>
              </div>
            </div>
          `;
          this.scrollChatToBottom();
        }
      );

      bubbleEl.classList.remove('streaming-cursor');
      bubbleEl.innerHTML = renderMarkdown(fullResponse || accumulatedText || '*(Aucune réponse générée)*');
      
      this.chatHistory.push({ role: 'assistant', content: fullResponse || accumulatedText });

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      const footerModel = assistantMsgEl.querySelector('.msg-model');
      if (footerModel) {
        footerModel.textContent = `${modelDisplayName} • ${elapsed}s`;
      }

      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(fullResponse || accumulatedText).then(() => {
          copyBtn.textContent = '✅';
          setTimeout(() => { copyBtn.textContent = '📋'; }, 2000);
        });
      });

    } catch (err) {
      bubbleEl.classList.remove('streaming-cursor');
      console.error('[Chat] Erreur interceptée dans sendChatMessage:', err);

      const errType = err.name || 'Erreur';
      const errMsg = err.message || String(err);

      if (this.isUserAborted) {
        bubbleEl.innerHTML += '<p class="text-muted"><em>[Génération arrêtée par l\'utilisateur]</em></p>';
      } else if (
        errMsg.includes('Device was lost') || 
        errMsg.includes('insufficient memory') || 
        errMsg.includes('Instance reference no longer exists') || 
        errMsg.includes('dropped in popErrorScope') ||
        errMsg.includes('Buffer was unmapped') ||
        errMsg.includes('mapAsync')
      ) {
        // Purge dead GPU instance and force auto-switch to SmolLM2
        const smolModel = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
        this.api.saveSettings({ webgpuModel: smolModel });
        this.api.webgpu.currentModel = smolModel;
        this.api.webgpu.engine = null;
        this.api.webgpu.isLoaded = false;
        const sel = document.getElementById('setting-webgpu-model');
        if (sel) sel.value = smolModel;
        this.updateEngineDisplayUI();

        bubbleEl.innerHTML = `
          <div class="alert alert-error">
            <strong>⚠️ Saturation GPU Adreno (Device was lost) :</strong><br/>
            Le modèle <strong>${escapeHtml(modelDisplayName)}</strong> a dépassé le délai de calcul maximal autorisé par le pilote Vulkan d'Android (plus de 20s de calcul continu).
          </div>
          <div class="error-help">
            <p>💡 <strong>Bascule automatique effectuée :</strong></p>
            <p>L'application a automatiquement configuré le modèle <strong>SmolLM2 360M (~210 Mo)</strong>. Il ne requiert que <strong>376 Mo de VRAM</strong> et répond en quelques secondes sans aucun crash sur processeur Snapdragon / Adreno.</p>
            <button type="button" class="btn btn-primary btn-block" id="btn-quick-switch-smollm2" style="margin-top: 10px;">
              🚀 Répondre avec SmolLM2 360M (Recommandé Smartphone)
            </button>
          </div>
        `;
        const quickSwitchBtn = bubbleEl.querySelector('#btn-quick-switch-smollm2');
        if (quickSwitchBtn) {
          quickSwitchBtn.addEventListener('click', () => {
            quickSwitchBtn.textContent = '🔄 Lancement avec SmolLM2 en cours...';
            quickSwitchBtn.disabled = true;
            assistantMsgEl.remove();
            this.sendChatMessage(text, forcedContext);
          });
        }
      } else if (errMsg.includes('Cache.add') || errMsg.includes('network error') || errMsg.includes("Failed to execute 'add' on 'Cache'")) {
        bubbleEl.innerHTML = `
          <div class="alert alert-error">
            <strong>⚠️ Téléchargement WebGPU interrompu (Erreur réseau) :</strong><br/>
            Le téléchargement des poids du modèle depuis Hugging Face a été coupé (coupure réseau, micro-déconnexion ou mode avion actif sans accès internet).
          </div>
          <div class="error-help">
            <p>💡 <strong>Solutions rapides :</strong></p>
            <ul>
              <li><strong>Option 1 (Idéale sur smartphone) :</strong> Ouvrez l'onglet <strong>⚙️ Réglages</strong> et sélectionnez le modèle ultra-léger <strong>SmolLM2 360M (~210 Mo)</strong>. Ses fragments font 33 Mo au lieu de 131 Mo et se téléchargent en quelques secondes sans interruption !</li>
              <li><strong>Option 2 (Pour Llama 3.2 1B ~720 Mo) :</strong> Allez dans <strong>⚙️ Réglages</strong>, vérifiez que le Wi-Fi a bien accès à Internet (désactivez temporairement le mode avion), puis cliquez sur <strong>📥 Télécharger / Mettre en cache</strong> pour suivre la barre de progression.</li>
              <li>Une fois le modèle téléchargé à 100% dans le cache, vous pouvez réactiver le mode avion total et l'utiliser 100% hors-ligne.</li>
            </ul>
          </div>
        `;
      } else {
        bubbleEl.innerHTML = `
          <div class="alert alert-error">
            <strong>Erreur de génération (${escapeHtml(errType)}) :</strong><br/>
            ${escapeHtml(errMsg)}
          </div>
          <div class="error-help">
            <p>💡 <strong>Diagnostic &amp; Conseils :</strong></p>
            <ul>
              <li><strong>Consultez les logs détaillés :</strong> Rendez-vous dans l'onglet <strong>⚙️ Réglages</strong> &gt; section <strong>📋 Journal des Logs &amp; Diagnostic</strong> pour voir la trace technique exacte sans PC.</li>
              <li><strong>Si WebGPU :</strong> Assurez-vous que le modèle est préchargé à 100% dans Réglages. Si la mémoire GPU est saturée (GPUBuffer mapAsync / OOM), basculez vers le modèle ultra-léger <em>SmolLM2 (210 Mo)</em>.</li>
              <li><strong>Si Ollama :</strong> Vérifiez que votre serveur local Termux écoute avec <code>export OLLAMA_ORIGINS="*"</code>.</li>
            </ul>
          </div>
        `;
      }
    } finally {
      this.currentAbortController = null;
      this.isUserAborted = false;
      this.setGenerating(false);
      this.scrollChatToBottom();
    }
  }

  scrollChatToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  /* ---------------- Guides Library UI ---------------- */

  setupGuidesUI() {
    const searchInput = document.getElementById('guides-search-input');
    const themeSelect = document.getElementById('guides-theme-select');

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.searchAndRenderGuides();
      });
    }

    if (themeSelect) {
      themeSelect.addEventListener('change', () => {
        this.searchAndRenderGuides();
      });
    }
  }

  renderGuidesThemeSelector() {
    const select = document.getElementById('guides-theme-select');
    if (!select || !this.db.indexData || !this.db.indexData.themes) return;

    select.innerHTML = '<option value="all">Tous les thèmes (670 guides)</option>';
    const themes = this.db.indexData.themes;
    for (const key of Object.keys(themes)) {
      const th = themes[key];
      select.innerHTML += `<option value="${key}">${th.icon} ${th.title}</option>`;
    }
  }

  async searchAndRenderGuides() {
    const listContainer = document.getElementById('guides-list-container');
    const searchInput = document.getElementById('guides-search-input');
    const themeSelect = document.getElementById('guides-theme-select');

    if (!listContainer) return;

    const query = searchInput ? searchInput.value : '';
    const theme = themeSelect ? themeSelect.value : 'all';

    listContainer.innerHTML = '<div class="loading-spinner">Recherche des guides...</div>';

    const results = await this.db.searchGuides(query, theme, 60);

    if (results.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <p>🔍 Aucun guide ne correspond à « ${escapeHtml(query)} ».</p>
          <small>Essayez d'autres mots-clés : eau, feu, fracture, garrot, radio, abri, conserves...</small>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = '';
    results.forEach(g => {
      const card = document.createElement('div');
      card.className = `guide-card theme-${g.theme}`;
      card.innerHTML = `
        <div class="guide-card-header">
          <span class="guide-badge-theme">${g.theme.toUpperCase()}</span>
          <span class="guide-badge-source">${escapeHtml(g.source_label)}</span>
        </div>
        <h4 class="guide-card-title">${escapeHtml(g.title)}</h4>
        <p class="guide-card-snippet">${escapeHtml(g.snippet || '')}</p>
        <div class="guide-card-actions">
          <button class="btn btn-sm btn-outline btn-read-guide" data-id="${g.id}">
            📖 Lire le guide
          </button>
          <button class="btn btn-sm btn-secondary btn-ask-ai-guide" data-id="${g.id}" data-title="${escapeHtml(g.title)}">
            💬 Interroger l'IA
          </button>
        </div>
      `;

      card.querySelector('.btn-read-guide').addEventListener('click', () => {
        this.openGuideViewer(g.id);
      });

      card.querySelector('.btn-ask-ai-guide').addEventListener('click', () => {
        this.switchTab('chat');
        this.sendChatMessage(`Peux-tu me résumer les consignes clés du guide de survie : "${g.title}" ?`);
      });

      listContainer.appendChild(card);
    });
  }

  async openGuideViewer(id) {
    const modal = document.getElementById('guide-modal');
    const titleEl = document.getElementById('guide-modal-title');
    const bodyEl = document.getElementById('guide-modal-body');

    modal.showModal();
    titleEl.textContent = 'Chargement du document...';
    bodyEl.innerHTML = '<div class="loading-spinner">Chargement du guide de survie hors-ligne...</div>';

    const article = await this.db.getArticle(id);
    if (!article) {
      bodyEl.innerHTML = '<div class="alert alert-error">Document non trouvé dans l\'index local.</div>';
      return;
    }

    titleEl.textContent = article.title;

    let partialBanner = '';
    if (article.isPartial) {
      partialBanner = `
        <div class="alert alert-warning" style="margin-bottom: 16px;">
          <span>📦 Ce guide est affiché en <strong>Mode Partiel</strong> (résumé).</span>
          <button type="button" class="btn btn-sm btn-primary" id="btn-modal-dl-full" style="margin-top: 8px;">
            📥 Télécharger le Pack Complet (16 Mo)
          </button>
        </div>
      `;
    }

    bodyEl.innerHTML = `
      <div class="article-meta-banner">
        <span><strong>Source :</strong> ${escapeHtml(article.source_label)}</span>
        ${article.url ? ` • <a href="${article.url}" target="_blank" rel="noopener">Lien d'origine ↗</a>` : ''}
      </div>
      ${partialBanner}
      <div class="markdown-content">
        ${renderMarkdown(article.body)}
      </div>
    `;

    const dlBtn = bodyEl.querySelector('#btn-modal-dl-full');
    if (dlBtn) {
      dlBtn.addEventListener('click', async () => {
        dlBtn.disabled = true;
        dlBtn.textContent = 'Téléchargement en cours...';
        await this.triggerFullDownload('settings');
        this.openGuideViewer(id);
      });
    }
  }

  /* ---------------- Settings UI ---------------- */

  setupSettingsUI() {
    // Engine mode radios
    const engineRadios = document.querySelectorAll('input[name="engine-mode"]');
    const sectionWebgpu = document.getElementById('section-webgpu-config');
    const sectionExternal = document.getElementById('section-external-config');
    const webgpuModelSelect = document.getElementById('setting-webgpu-model');
    const btnPreloadWebgpu = document.getElementById('btn-preload-webgpu');
    const webgpuProgressBox = document.getElementById('webgpu-preload-progress');
    const webgpuStatusText = document.getElementById('webgpu-status-text');
    const webgpuPercentText = document.getElementById('webgpu-percent-text');
    const webgpuFill = document.getElementById('webgpu-fill');

    // External engine inputs
    const endpointInput = document.getElementById('setting-endpoint');
    const apiTypeSelect = document.getElementById('setting-api-type');
    const modelSelect = document.getElementById('setting-model');
    const tempInput = document.getElementById('setting-temp');
    const tempValDisplay = document.getElementById('setting-temp-val');
    const sysPromptInput = document.getElementById('setting-system-prompt');
    const saveBtn = document.getElementById('btn-save-settings');
    const testBtn = document.getElementById('btn-test-connection');
    const testResultEl = document.getElementById('test-conn-result');
    const presetBtns = document.querySelectorAll('.btn-preset');

    // Set active engine radio
    engineRadios.forEach(radio => {
      if (radio.value === this.api.engineMode) {
        radio.checked = true;
        const parentCard = radio.closest('.engine-radio-card');
        if (parentCard) parentCard.classList.add('active');
      } else {
        const parentCard = radio.closest('.engine-radio-card');
        if (parentCard) parentCard.classList.remove('active');
      }

      radio.addEventListener('change', () => {
        document.querySelectorAll('.engine-radio-card').forEach(c => c.classList.remove('active'));
        const parentCard = radio.closest('.engine-radio-card');
        if (parentCard) parentCard.classList.add('active');

        this.api.saveSettings({ engineMode: radio.value });
        this.toggleEngineSubconfigs(radio.value);
        this.updateEngineDisplayUI();
      });
    });

    this.toggleEngineSubconfigs(this.api.engineMode);

    // WebGPU model selector
    if (webgpuModelSelect) {
      webgpuModelSelect.value = this.api.webgpu.currentModel;
      webgpuModelSelect.addEventListener('change', () => {
        this.api.saveSettings({ webgpuModel: webgpuModelSelect.value });
        this.updateEngineDisplayUI();
      });
    }

    const btnClearWebgpu = document.getElementById('btn-clear-webgpu-cache');

    // Preload WebGPU Model
    if (btnPreloadWebgpu) {
      btnPreloadWebgpu.addEventListener('click', async () => {
        if (!navigator.onLine) {
          alert('⚠️ Vous êtes actuellement hors-ligne ou en mode avion.\nPour télécharger le modèle la première fois (~720 Mo), désactivez le mode avion et connectez-vous au WiFi.');
          return;
        }

        if (webgpuProgressBox) webgpuProgressBox.style.display = 'block';
        btnPreloadWebgpu.disabled = true;

        try {
          await this.api.webgpu.loadModel(webgpuModelSelect.value, (report) => {
            if (webgpuStatusText) webgpuStatusText.textContent = report.text;
            if (webgpuPercentText) webgpuPercentText.textContent = `${report.percent}%`;
            if (webgpuFill) webgpuFill.style.width = `${report.percent}%`;
          });

          if (webgpuStatusText) webgpuStatusText.textContent = '✅ Modèle WebGPU chargé et prêt hors-ligne !';
          alert('🎉 Modèle WebGPU téléchargé et stocké dans le cache du navigateur ! Il est 100% opérationnel en mode avion.');
        } catch (err) {
          console.error('WebGPU load error:', err);
          let userHint = err.message;
          if (err.message.includes('network error') || err.message.includes('Cache.add') || err.message.includes('Failed to fetch')) {
            userHint = `Erreur réseau : le téléchargement a été interrompu.\n1. Vérifiez que le mode avion est désactivé et que vous êtes bien connecté à Internet.\n2. Cliquez sur « Réinitialiser le cache WebGPU » puis relancez le téléchargement.\n3. Astuce : vous pouvez aussi choisir le modèle ultra-léger SmolLM2 (210 Mo) pour un téléchargement plus rapide.`;
          }
          if (webgpuStatusText) webgpuStatusText.textContent = `Erreur: ${err.message}`;
          alert(`Échec du téléchargement WebGPU :\n${userHint}`);
        } finally {
          btnPreloadWebgpu.disabled = false;
        }
      });
    }

    // Reset / Clear WebGPU Cache
    if (btnClearWebgpu) {
      btnClearWebgpu.addEventListener('click', async () => {
        if (confirm('Voulez-vous réinitialiser et vider les fichiers temporaires du modèle WebGPU ?')) {
          await this.api.webgpu.clearCache();
          if (webgpuProgressBox) webgpuProgressBox.style.display = 'none';
          if (webgpuFill) webgpuFill.style.width = '0%';
          alert('Cache WebGPU réinitialisé. Vous pouvez relancer le téléchargement proprement.');
        }
      });
    }

    // Populate external engine values
    if (endpointInput) endpointInput.value = this.api.endpoint;
    if (apiTypeSelect) apiTypeSelect.value = this.api.apiType;
    if (modelSelect) modelSelect.value = this.api.model;
    if (tempInput) {
      tempInput.value = this.api.temperature;
      if (tempValDisplay) tempValDisplay.textContent = this.api.temperature;
      tempInput.addEventListener('input', () => {
        if (tempValDisplay) tempValDisplay.textContent = tempInput.value;
      });
    }
    if (sysPromptInput) sysPromptInput.value = this.api.systemPrompt;

    // Presets
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url');
        const type = btn.getAttribute('data-type');
        if (endpointInput) endpointInput.value = url;
        if (apiTypeSelect) apiTypeSelect.value = type;
      });
    });

    // Test connection (Ollama/OpenAI)
    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        testResultEl.className = 'test-result-box loading';
        testResultEl.innerHTML = '🔄 Tentative de connexion au serveur LLM...';

        this.api.saveSettings({
          endpoint: endpointInput.value,
          apiType: apiTypeSelect.value
        });

        try {
          const res = await this.api.checkConnectionAndGetModels();
          testResultEl.className = 'test-result-box success';
          testResultEl.innerHTML = `
            ✅ <strong>Connexion réussie !</strong> Moteur détecté : <code>${res.type}</code><br/>
            Modèles disponibles : ${res.models.join(', ')}
          `;

          if (modelSelect && res.models.length) {
            modelSelect.innerHTML = res.models.map(m => `<option value="${m}">${m}</option>`).join('');
            if (res.models.includes(this.api.model)) {
              modelSelect.value = this.api.model;
            } else {
              modelSelect.value = res.models[0];
            }
          }
        } catch (err) {
          testResultEl.className = 'test-result-box error';
          testResultEl.innerHTML = `
            ❌ <strong>Échec de connexion :</strong><br/>
            ${escapeHtml(err.message)}
            <div class="alert alert-warning" style="margin-top: 10px; font-size: 0.85rem; text-align: left;">
              <strong>💡 Solution erreur 403 / CORS dans Termux :</strong><br/>
              Si les logs de Termux affichent des lignes <code>403</code> (Forbidden), Ollama bloque l'accès web.<br/>
              Dans Termux, arrêtez Ollama puis relancez-le avec l'autorisation d'origine :<br/>
              <pre style="margin: 6px 0; padding: 6px; background: rgba(0,0,0,0.4); color: #38bdf8;">pkill ollama&#10;export OLLAMA_ORIGINS="*"&#10;ollama serve &amp;</pre>
            </div>
          `;
        }
      });
    }

    // Save settings
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const activeRadio = document.querySelector('input[name="engine-mode"]:checked');
        const currentMode = activeRadio ? activeRadio.value : 'webgpu';

        this.api.saveSettings({
          engineMode: currentMode,
          webgpuModel: webgpuModelSelect ? webgpuModelSelect.value : undefined,
          endpoint: endpointInput ? endpointInput.value : undefined,
          apiType: apiTypeSelect ? apiTypeSelect.value : undefined,
          model: modelSelect ? modelSelect.value : undefined,
          temperature: tempInput ? tempInput.value : undefined,
          systemPrompt: sysPromptInput ? sysPromptInput.value : undefined
        });

        this.updateEngineDisplayUI();

        const toast = document.getElementById('settings-toast');
        if (toast) {
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 2500);
        }
      });
    }
  }

  toggleEngineSubconfigs(mode) {
    const sectionWebgpu = document.getElementById('section-webgpu-config');
    const sectionExternal = document.getElementById('section-external-config');

    if (mode === 'webgpu') {
      if (sectionWebgpu) sectionWebgpu.style.display = 'block';
      if (sectionExternal) sectionExternal.style.display = 'none';
    } else {
      if (sectionWebgpu) sectionWebgpu.style.display = 'none';
      if (sectionExternal) sectionExternal.style.display = 'block';
    }
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new SurvivalApp();
});
