/**
 * Bilingual Emergency Protocols and SOS Reflex Cards Manager v3.4
 */

import { t, getLanguage } from './i18n.js?v=3.4';

export class EmergencyManager {
  constructor(app) {
    this.app = app;
    this.protocols = [];
    this.activeProtocol = null;
  }

  async loadProtocols() {
    try {
      const res = await fetch('./data/emergency_protocols.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.protocols = data.protocols || [];
      return this.protocols;
    } catch (err) {
      console.error('Failed to load emergency protocols:', err);
      return [];
    }
  }

  renderEmergencyGrid(container) {
    if (!container) return;
    container.innerHTML = '';

    const lang = getLanguage();
    const isEn = lang === 'en';

    const header = document.createElement('div');
    header.className = 'emergency-intro';
    header.innerHTML = `
      <div class="sos-banner">
        <span class="sos-badge">${t('sos_badge', lang)}</span>
        <h2>${t('sos_banner_title', lang)}</h2>
        <p>${t('sos_banner_desc', lang)}</p>
      </div>
    `;
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'emergency-card-grid';

    this.protocols.forEach(proto => {
      const title = isEn ? (proto.title_en || proto.title) : proto.title;
      const summary = isEn ? (proto.summary_en || proto.summary) : proto.summary;
      const catKey = 'cat_' + proto.category;
      const catLabel = t(catKey, lang);

      const card = document.createElement('div');
      card.className = `emergency-card card-cat-${proto.category}`;
      card.innerHTML = `
        <div class="em-card-top">
          <span class="em-icon">${proto.icon}</span>
          <span class="em-tag">${catLabel}</span>
        </div>
        <h3 class="em-title">${title}</h3>
        <p class="em-summary">${summary}</p>
        <button class="btn btn-sos-action" data-protocol-id="${proto.id}">
          ${t('sos_open_btn', lang)}
        </button>
      `;

      card.querySelector('.btn-sos-action').addEventListener('click', () => {
        this.openProtocolModal(proto.id);
      });

      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  openProtocolModal(protocolId) {
    const proto = (this.protocols || []).find(p => p.id === protocolId);
    if (!proto) return;

    this.activeProtocol = proto;
    const lang = getLanguage();
    const isEn = lang === 'en';

    const title = isEn ? (proto.title_en || proto.title) : proto.title;
    const summary = isEn ? (proto.summary_en || proto.summary) : proto.summary;
    const steps = isEn ? (proto.steps_en || proto.steps) : proto.steps;
    const warnings = isEn ? (proto.warnings_en || proto.warnings) : proto.warnings;

    const modal = document.getElementById('protocol-modal');
    const modalTitle = document.getElementById('modal-proto-title');
    const modalBody = document.getElementById('modal-proto-body');

    modalTitle.innerHTML = `${proto.icon} ${title}`;

    const stepsHtml = steps.map((step, idx) => `
      <div class="step-item">
        <div class="step-num">${idx + 1}</div>
        <div class="step-text">${step}</div>
      </div>
    `).join('');

    let warningsHtml = '';
    if (warnings && warnings.length) {
      warningsHtml = `
        <div class="protocol-warnings">
          <h4>${t('sos_modal_warnings', lang)}</h4>
          <ul>
            ${warnings.map(w => `<li>${w}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    modalBody.innerHTML = `
      <div class="protocol-desc-box">${summary}</div>
      ${warningsHtml}
      <div class="protocol-steps-list">
        <h4>${t('sos_modal_steps', lang)}</h4>
        ${stepsHtml}
      </div>
      <div class="modal-proto-actions">
        <button id="btn-ask-ai-proto" class="btn btn-primary">
          ${t('sos_ask_ai_btn', lang)}
        </button>
      </div>
    `;

    document.getElementById('btn-ask-ai-proto').addEventListener('click', () => {
      modal.close();
      this.app.switchTab('chat');
      const query = isEn
        ? `Emergency Protocol: [${title}]. What are the immediate life-saving steps to apply and what critical hazards must I avoid?`
        : `Protocole d'urgence : [${title}]. Quelles sont les étapes critiques à appliquer immédiatement et que dois-je éviter à tout prix ?`;
      const forcedContext = isEn
        ? `Emergency Protocol: ${title} - ${summary}\nDirectives: ${steps.join(' | ')}`
        : `Contexte d'urgence : ${title} - ${summary}\nConsignes : ${steps.join(' | ')}`;
      this.app.sendChatMessage(query, forcedContext);
    });

    modal.showModal();
  }
}
