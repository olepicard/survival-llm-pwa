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
   * @param {boolean} compactMode - True when using WebGPU in-browser engine to keep prompt token count low (~80 tokens)
   * @returns {Promise<{contextText: string, sources: Array<{title: string, id: number}>}>}
   */
  async retrieveContext(userQuery, compactMode = false) {
    if (!this.enabled || !userQuery || userQuery.trim().length < 3) {
      return { contextText: '', sources: [] };
    }

    const matchedSources = [];
    const contextSnippets = [];
    const maxSnippets = compactMode ? 1 : 2;
    const maxExcerptChars = compactMode ? 320 : 650;

    // 1. Check emergency protocols first
    const normQuery = this.normalize(userQuery);
    if (this.emergencyMgr && this.emergencyMgr.protocols) {
      for (const proto of this.emergencyMgr.protocols) {
        const protoTitle = this.normalize(proto.title);
        if (
          normQuery.includes(protoTitle) ||
          protoTitle.split(/\s+/).some(w => w.length > 3 && normQuery.includes(w))
        ) {
          matchedSources.push({ title: `[Fiche Réflexe] ${proto.title}`, id: proto.id });
          const stepsText = proto.steps.join(' | ').slice(0, maxExcerptChars);
          contextSnippets.push(`URGENCE ${proto.title} : ${stepsText}`);
          break;
        }
      }
    }

    // 2. Search local guide index if we still need snippets
    if (contextSnippets.length < maxSnippets) {
      const guides = await this.db.searchGuides(userQuery, 'all', compactMode ? 2 : 4);
      for (const guide of guides) {
        matchedSources.push({ title: guide.title, id: guide.id });

        const full = await this.db.getArticle(guide.id);
        if (full && full.body) {
          const excerpt = this.extractRelevantPassage(full.body, userQuery, maxExcerptChars);
          contextSnippets.push(`[${guide.title}] : ${excerpt}`);
        } else if (guide.snippet) {
          contextSnippets.push(`[${guide.title}] : ${guide.snippet.slice(0, maxExcerptChars)}`);
        }

        if (contextSnippets.length >= maxSnippets) break;
      }
    }

    if (contextSnippets.length === 0) {
      return { contextText: '', sources: [] };
    }

    if (compactMode) {
      return {
        contextText: `\n[ Contexte survie : ${contextSnippets[0]} ]`,
        sources: matchedSources
      };
    }

    const contextText = `\n\n--- EXTRAITS DE GUIDES DE SURVIE HORS-LIGNE DISPONIBLES ---\n${contextSnippets.join('\n\n---\n\n')}\n--- FIN DU CONTEXTE DE SURVIE ---\nConsigne : Utilise prioritairement ces extraits validés pour formuler ta réponse.`;

    return { contextText, sources: matchedSources };
  }

  extractRelevantPassage(body, query, maxLen = 650) {
    const terms = this.normalize(query).split(/\s+/).filter(w => w.length > 2);
    const paragraphs = body.split(/\n\s*\n/);

    let bestP = paragraphs[0] || '';
    let maxScore = -1;

    for (const p of paragraphs) {
      if (p.trim().length < 40) continue;
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
