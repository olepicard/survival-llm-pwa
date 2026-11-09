/**
 * Local RAG (Retrieval-Augmented Generation) Engine
 * Searches local offline survival guides and injects relevant military/medical context into prompts
 */

export class RAGEngine {
  constructor(db, emergencyMgr) {
    this.db = db;
    this.emergencyMgr = emergencyMgr;
    this.enabled = localStorage.getItem('rag_enabled') !== 'false'; // default true
  }

  setEnabled(val) {
    this.enabled = !!val;
    localStorage.setItem('rag_enabled', this.enabled.toString());
  }

  /**
   * Find top relevant context for a user query
   * @param {string} userQuery
   * @returns {Promise<{contextText: string, sources: Array<{title: string, id: number}>}>}
   */
  async retrieveContext(userQuery) {
    if (!this.enabled || !userQuery || userQuery.trim().length < 3) {
      return { contextText: '', sources: [] };
    }

    const matchedSources = [];
    const contextSnippets = [];

    // 1. Check emergency protocols first
    const normQuery = this.normalize(userQuery);
    if (this.emergencyMgr && this.emergencyMgr.protocols) {
      for (const proto of this.emergencyMgr.protocols) {
        const protoTitle = this.normalize(proto.title);
        const protoSummary = this.normalize(proto.summary);
        if (
          normQuery.includes(protoTitle) ||
          protoTitle.split(/\s+/).some(w => w.length > 3 && normQuery.includes(w))
        ) {
          matchedSources.push({ title: `[Fiche Réflexe] ${proto.title}`, id: proto.id });
          contextSnippets.push(`FICHE D'URGENCE VITAL : ${proto.title}\nRésumé : ${proto.summary}\nÉtapes : ${proto.steps.join(' | ')}`);
          break;
        }
      }
    }

    // 2. Search local guide index
    const guides = await this.db.searchGuides(userQuery, 'all', 4);
    for (const guide of guides) {
      matchedSources.push({ title: guide.title, id: guide.id });
      
      // Try to get full article or excerpt
      const full = await this.db.getArticle(guide.id);
      if (full && full.body) {
        // Extract most relevant 1200 characters from body
        const excerpt = this.extractRelevantPassage(full.body, userQuery, 1400);
        contextSnippets.push(`EXTRAIT MANUEL [${guide.title}] (${guide.source_label}) :\n${excerpt}`);
      } else if (guide.snippet) {
        contextSnippets.push(`EXTRAIT [${guide.title}] :\n${guide.snippet}`);
      }

      if (contextSnippets.length >= 3) break;
    }

    if (contextSnippets.length === 0) {
      return { contextText: '', sources: [] };
    }

    const contextText = `\n\n--- EXTRAITS DE GUIDES DE SURVIE HORS-LIGNE DISPONIBLES ---\n${contextSnippets.join('\n\n---\n\n')}\n--- FIN DU CONTEXTE DE SURVIE ---\nConsigne : Utilise prioritairement ces extraits validés pour formuler ta réponse.`;

    return { contextText, sources: matchedSources };
  }

  extractRelevantPassage(body, query, maxLen = 1200) {
    const terms = this.normalize(query).split(/\s+/).filter(w => w.length > 2);
    const paragraphs = body.split(/\n\s*\n/);

    let bestP = paragraphs[0] || '';
    let maxScore = -1;

    for (const p of paragraphs) {
      if (p.trim().length < 50) continue;
      const pNorm = this.normalize(p);
      let score = 0;
      for (const t of terms) {
        if (pNorm.includes(t)) score += 1;
      }
      if (score > maxScore) {
        maxScore = score;
        bestP = p;
      }
    }

    // Clean markdown hashes and excessive whitespace
    const clean = bestP.replace(/#+\s*/g, '').replace(/\s+/g, ' ').trim();
    return clean.slice(0, maxLen);
  }

  normalize(str) {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
}
