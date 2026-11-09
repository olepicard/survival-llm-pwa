/**
 * Main Application Controller for Survival LLM PWA
 */

import { LLMClient } from './api.js';
import { GuidesDB } from './db.js';
import { EmergencyManager } from './emergency.js';
import { RAGEngine } from './rag.js';
import { renderMarkdown, escapeHtml } from './markdown.js';

class SurvivalApp {
  constructor() {
    this.api = new LLMClient();
    this.db = new GuidesDB();
    this.emergency = new EmergencyManager(this);
    this.rag = new RAGEngine(this.db, this.emergency);

    this.activeTab = 'chat';
    this.chatHistory = []; // { role: 'user'|'assistant', content: string }
    this.currentAbortController = null;
    this.deferredInstallPrompt = null;

    this.init();
  }

  async init() {
    this.setupServiceWorker();
    this.setupInstallPrompt();
    this.setupTabs();
    this.setupSettingsUI();
    this.setupChatUI();
    this.setupGuidesUI();

    // Load data
    await this.emergency.loadProtocols();
    this.emergency.renderEmergencyGrid(document.getElementById('sos-container'));

    await this.db.init();
    this.renderGuidesThemeSelector();
    this.searchAndRenderGuides();

    // Check network status
    this.updateOnlineStatus();
    window.addEventListener('online', () => this.updateOnlineStatus());
    window.addEventListener('offline', () => this.updateOnlineStatus());
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
      badge.textContent = 'En ligne (WiFi/4G)';
      badge.className = 'status-badge online';
    } else {
      badge.textContent = 'Hors-ligne (Local)';
      badge.className = 'status-badge offline';
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

    // Auto-scroll to bottom of chat if switching to chat
    if (tabName === 'chat') {
      this.scrollChatToBottom();
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

      // Enter to send (Shift+Enter for newline)
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
    
    // Remove welcome screen if present
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

    assistantMsgEl.innerHTML = `
      <div class="msg-avatar">🛡️</div>
      <div class="msg-body">
        ${sourcesHtml}
        <div class="msg-bubble streaming-cursor">...</div>
        <div class="msg-footer">
          <span class="msg-model">${escapeHtml(this.api.model)}</span>
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
    // Append RAG context to the last user message
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
        this.currentAbortController.signal
      );

      bubbleEl.classList.remove('streaming-cursor');
      bubbleEl.innerHTML = renderMarkdown(fullResponse || accumulatedText || '*(Aucune réponse générée)*');
      
      this.chatHistory.push({ role: 'assistant', content: fullResponse || accumulatedText });

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      const footerModel = assistantMsgEl.querySelector('.msg-model');
      if (footerModel) {
        footerModel.textContent = `${this.api.model} • ${elapsed}s`;
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
            <strong>Erreur de connexion au modèle :</strong><br/>
            ${escapeHtml(err.message)}
          </div>
          <div class="error-help">
            <p>💡 <strong>Conseils de dépannage :</strong></p>
            <ul>
              <li>Vérifiez dans l'onglet <strong>⚙️ Réglages</strong> que l'adresse du serveur est exacte.</li>
              <li>Si vous utilisez <strong>Ollama sur PC</strong> depuis votre smartphone Android, lancez Ollama avec l'autorisation réseau :
                <pre>set OLLAMA_ORIGINS=*<br/>set OLLAMA_HOST=0.0.0.0<br/>ollama serve</pre>
              </li>
              <li>Si vous utilisez <strong>Ollama sur Android</strong> (via Termux), vérifiez que le serveur est démarré sur <code>127.0.0.1:11434</code>.</li>
              <li>Si vous utilisez <strong>Edge Gallery ou PocketPal AI</strong>, activez le mode API OpenAI et port 8080/5000.</li>
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
      bodyEl.innerHTML = '<div class="alert alert-error">Impossible de charger le document demandé.</div>';
      return;
    }

    titleEl.textContent = article.title;
    bodyEl.innerHTML = `
      <div class="article-meta-banner">
        <span><strong>Source :</strong> ${escapeHtml(article.source_label)}</span>
        ${article.url ? ` • <a href="${article.url}" target="_blank" rel="noopener">Lien d'origine ↗</a>` : ''}
      </div>
      <div class="markdown-content">
        ${renderMarkdown(article.body)}
      </div>
    `;
  }

  /* ---------------- Settings UI ---------------- */

  setupSettingsUI() {
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

    // Populate current values
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

    // Test connection
    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        testResultEl.className = 'test-result-box loading';
        testResultEl.innerHTML = '🔄 Tentative de connexion au serveur LLM...';

        // Apply input values temporarily for testing
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

          // Populate model selector
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
          `;
        }
      });
    }

    // Save settings
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        this.api.saveSettings({
          endpoint: endpointInput.value,
          apiType: apiTypeSelect.value,
          model: modelSelect.value,
          temperature: tempInput.value,
          systemPrompt: sysPromptInput.value
        });

        const toast = document.getElementById('settings-toast');
        if (toast) {
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 2500);
        }
      });
    }
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new SurvivalApp();
});
