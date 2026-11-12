/**
 * Emergency Protocols and SOS Reflex Cards Manager
 */

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

    const header = document.createElement('div');
    header.className = 'emergency-intro';
    header.innerHTML = `
      <div class="sos-banner">
        <span class="sos-badge">URGENCES VITALES</span>
        <h2>Fiches Réflexes Immédiates</h2>
        <p>Protocoles d'action rapide hors-ligne utilisables immédiatement sans attendre de réseau ni de modèle IA.</p>
      </div>
    `;
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'emergency-card-grid';

    this.protocols.forEach(proto => {
      const card = document.createElement('div');
      card.className = `emergency-card card-cat-${proto.category}`;
      card.innerHTML = `
        <div class="em-card-top">
          <span class="em-icon">${proto.icon}</span>
          <span class="em-tag">${proto.category.toUpperCase()}</span>
        </div>
        <h3 class="em-title">${proto.title}</h3>
        <p class="em-summary">${proto.summary}</p>
        <button class="btn btn-sos-action" data-protocol-id="${proto.id}">
          Ouvrir le protocole ➔
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
    const modal = document.getElementById('protocol-modal');
    const modalTitle = document.getElementById('modal-proto-title');
    const modalBody = document.getElementById('modal-proto-body');

    modalTitle.innerHTML = `${proto.icon} ${proto.title}`;

    let stepsHtml = proto.steps.map((step, idx) => `
      <div class="step-item">
        <div class="step-num">${idx + 1}</div>
        <div class="step-text">${step}</div>
      </div>
    `).join('');

    let warningsHtml = '';
    if (proto.warnings && proto.warnings.length) {
      warningsHtml = `
        <div class="protocol-warnings">
          <h4>⚠️ DANGERS & CONTRE-INDICATIONS</h4>
          <ul>
            ${proto.warnings.map(w => `<li>${w}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    modalBody.innerHTML = `
      <div class="protocol-desc-box">${proto.summary}</div>
      ${warningsHtml}
      <div class="protocol-steps-list">
        <h4>📋 ÉTAPES D'ACTION IMMÉDIATES :</h4>
        ${stepsHtml}
      </div>
      <div class="modal-proto-actions">
        <button id="btn-ask-ai-proto" class="btn btn-primary">
          💬 Poser une question à l'IA sur ce cas
        </button>
      </div>
    `;

    document.getElementById('btn-ask-ai-proto').addEventListener('click', () => {
      modal.close();
      this.app.switchTab('chat');
      const query = `Protocole d'urgence : [${proto.title}]. Quelles sont les étapes critiques à appliquer immédiatement et que dois-je éviter à tout prix ?`;
      this.app.sendChatMessage(query, `Contexte d'urgence : ${proto.title} - ${proto.summary}\nConsignes : ${proto.steps.join(' | ')}`);
    });

    modal.showModal();
  }
}
