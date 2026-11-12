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

    this.init();
  }

  async init() {
    this.setupServiceWorker();
    this.setupInstallPrompt();
    this.setupTabs();
    this.setupSettingsUI();
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
    }
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
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        this.sendChatMessage(text);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          form.dispatchEvent(new Event('submit'));
        }
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        if (this.currentAbortController) {
          this.currentAbortController.abort();
          this.currentAbortController = null;
          this.setGenerating(false);
        }
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
    const sendBtn = document.getElementById('btn-send-chat');
    const stopBtn = document.getElementById('btn-stop-chat');
    const input = document.getElementById('chat-input');

    if (sendBtn) sendBtn.style.display = isGenerating ? 'none' : 'inline-flex';
    if (stopBtn) stopBtn.style.display = isGenerating ? 'inline-flex' : 'none';
    if (input) input.disabled = isGenerating;
  }

  async sendChatMessage(text, forcedContext = '') {
    const messagesContainer = document.getElementById('chat-messages');
    
    const welcome = messagesContainer.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    // 1. Add User Message
    this.chatHistory.push({ role: 'user', content: text });
    const userMsgEl = document.createElement('div');
    userMsgEl.className = 'chat-message message-user';
    userMsgEl.innerHTML = `
      <div class="msg-bubble">${escapeHtml(text)}</div>
    `;
    messagesContainer.appendChild(userMsgEl);
    this.scrollChatToBottom();

    this.setGenerating(true);

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
          bubbleEl.innerHTML = `<div class="loading-spinner">🔄 [WebGPU] ${escapeHtml(loadingProgress.text)} (${loadingProgress.percent}%)</div>`;
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
      if (err.name === 'AbortError') {
        bubbleEl.innerHTML += '<p class="text-muted"><em>[Génération arrêtée par l\'utilisateur]</em></p>';
      } else {
        bubbleEl.innerHTML = `
          <div class="alert alert-error">
            <strong>Erreur de génération :</strong><br/>
            ${escapeHtml(err.message)}
          </div>
          <div class="error-help">
            <p>💡 <strong>Conseils selon votre moteur :</strong></p>
            <ul>
              <li><strong>Si WebGPU est sélectionné :</strong> Vérifiez que votre navigateur (Chrome/Edge) supporte WebGPU et que vous disposez d'une connexion pour le premier téléchargement des poids.</li>
              <li><strong>Si Ollama est sélectionné :</strong> Vérifiez qu'Ollama écoute sur <code>http://127.0.0.1:11434</code> (ou que l'IP de votre PC est correcte).</li>
              <li>Vous pouvez changer de moteur à tout moment dans l'onglet <strong>⚙️ Réglages</strong>.</li>
            </ul>
          </div>
        `;
      }
    } finally {
      this.currentAbortController = null;
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

    // Preload WebGPU Model
    if (btnPreloadWebgpu) {
      btnPreloadWebgpu.addEventListener('click', async () => {
        if (webgpuProgressBox) webgpuProgressBox.style.display = 'block';
        btnPreloadWebgpu.disabled = true;

        try {
          await this.api.webgpu.loadModel(webgpuModelSelect.value, (report) => {
            if (webgpuStatusText) webgpuStatusText.textContent = report.text;
            if (webgpuPercentText) webgpuPercentText.textContent = `${report.percent}%`;
            if (webgpuFill) webgpuFill.style.width = `${report.percent}%`;
          });

          if (webgpuStatusText) webgpuStatusText.textContent = '✅ Modèle WebGPU chargé et prêt hors-ligne !';
          alert('🎉 Modèle WebGPU téléchargé et stocké dans le cache du navigateur ! Il est 100% prêt pour une utilisation hors-ligne.');
        } catch (err) {
          if (webgpuStatusText) webgpuStatusText.textContent = `Erreur: ${err.message}`;
          alert(`Échec du chargement WebGPU : ${err.message}`);
        } finally {
          btnPreloadWebgpu.disabled = false;
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
