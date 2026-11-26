/**
 * Local RAG (Retrieval-Augmented Generation) Engine v3.3
 * Searches local offline emergency protocols and survival guides,
 * then constructs structured, highly-effective prompts tailored for local LLMs (Qwen 2.5, SmolLM2, Llama 3.2).
 */

const FRENCH_STOP_WORDS = new Set([
  'alors', 'au', 'aucuns', 'aussi', 'autre', 'avant', 'avec', 'avoir', 'bon', 'car',
  'ce', 'cela', 'ces', 'ceux', 'chaque', 'ci', 'comme', 'comment', 'dans', 'des',
  'du', 'dedans', 'dehors', 'depuis', 'devrait', 'doit', 'donc', 'dos', 'droite',
  'debut', 'elle', 'elles', 'en', 'encore', 'essai', 'est', 'et', 'etaient', 'etat',
  'ete', 'etiez', 'etions', 'etre', 'eu', 'fait', 'faites', 'fois', 'font', 'hors',
  'ici', 'il', 'ils', 'je', 'juste', 'la', 'le', 'les', 'leur', 'leurs', 'lui',
  'maintenant', 'mais', 'mes', 'mien', 'moins', 'mon', 'mot', 'meme', 'ni', 'nommes',
  'notre', 'nous', 'nouveaux', 'ou', 'par', 'parce', 'parole', 'pas', 'personnes',
  'peut', 'peu', 'piece', 'plupart', 'pour', 'pourquoi', 'quand', 'que', 'quel',
  'quelle', 'quelles', 'quels', 'qui', 'sa', 'sans', 'ses', 'seulement', 'si',
  'sien', 'son', 'sont', 'sous', 'soyez', 'sur', 'ta', 'tandis', 'tellement',
  'tels', 'tes', 'ton', 'tous', 'tout', 'trop', 'tres', 'tu', 'voient', 'vont',
  'votre', 'vous', 'vu', 'ca', 'faire', 'etapes', 'etape', 'quelles', 'sont', 'une', 'un',
  'aux', 'dont', 'qu', 'd', 'l', 's', 'j', 'n', 'c', 'm', 't', 'y', 'moi', 'toi'
]);

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

  normalize(str) {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ');
  }

  extractKeywords(query) {
    const norm = this.normalize(query);
    const tokens = norm.split(/\s+/).filter(w => w.length >= 3 && !FRENCH_STOP_WORDS.has(w));
    if (tokens.length === 0) {
      return norm.split(/\s+/).filter(w => w.length >= 2);
    }
    return tokens;
  }

  /**
   * Find top relevant context for a user query
   * @param {string} userQuery
   * @param {boolean} compactMode - True when using WebGPU in-browser engine
   * @returns {Promise<{contextText: string, sources: Array<{title: string, id: number|string}>}>}
   */
  async retrieveContext(userQuery, compactMode = false) {
    if (!this.enabled || !userQuery || userQuery.trim().length < 3) {
      return { contextText: '', sources: [] };
    }

    const matchedSources = [];
    const contextSnippets = [];
    const maxSnippets = compactMode ? 1 : 2;
    const maxExcerptChars = compactMode ? 350 : 650;

    const keywords = this.extractKeywords(userQuery);
    const normQuery = this.normalize(userQuery);

    // 1. Check emergency reflex protocols with weighted scoring
    if (this.emergencyMgr && this.emergencyMgr.protocols && this.emergencyMgr.protocols.length) {
      let bestProto = null;
      let maxScore = 0;

      for (const proto of this.emergencyMgr.protocols) {
        let score = 0;
        const protoTitleNorm = this.normalize(proto.title);
        const protoSummaryNorm = this.normalize(proto.summary || '');
        const kwList = (proto.keywords || []).map(k => this.normalize(k));

        // Keywords list check (6 pts per keyword match)
        for (const kw of kwList) {
          if (normQuery.includes(kw)) {
            score += 6;
          }
        }

        // Query tokens check
        for (const t of keywords) {
          const root = t.length >= 5 ? t.slice(0, 4) : t;
          if (protoTitleNorm.includes(t)) score += 5;
          else if (protoTitleNorm.includes(root)) score += 2.5;

          if (protoSummaryNorm.includes(t)) score += 3;
          else if (protoSummaryNorm.includes(root)) score += 1.5;
        }

        if (score > maxScore && score >= 4) {
          maxScore = score;
          bestProto = proto;
        }
      }

      if (bestProto) {
        matchedSources.push({ title: `[Fiche Réflexe] ${bestProto.title}`, id: bestProto.id });
        const stepsFormatted = bestProto.steps.map((st, i) => `${i + 1}. ${st}`).join(' ');
        const warnText = bestProto.warnings && bestProto.warnings.length ? ` (ATTENTION : ${bestProto.warnings[0]})` : '';
        contextSnippets.push(`PROTOCOLE D'URGENCE : ${bestProto.title}. ${stepsFormatted}${warnText}`.slice(0, maxExcerptChars));
      }
    }

    // 2. Search local guide index if we still have room for snippets
    if (contextSnippets.length < maxSnippets) {
      try {
        const guides = await this.db.searchGuides(userQuery, 'all', compactMode ? 2 : 4);
        for (const guide of guides) {
          matchedSources.push({ title: `[Guide] ${guide.title}`, id: guide.id });

          const full = await this.db.getArticle(guide.id);
          if (full && full.body) {
            const excerpt = this.extractRelevantPassage(full.body, keywords, maxExcerptChars);
            contextSnippets.push(`GUIDE TECHNIQUE [${guide.title}] : ${excerpt}`);
          } else if (guide.snippet) {
            contextSnippets.push(`GUIDE TECHNIQUE [${guide.title}] : ${guide.snippet.slice(0, maxExcerptChars)}`);
          }

          if (contextSnippets.length >= maxSnippets) break;
        }
      } catch (err) {
        console.warn('Erreur recherche guides RAG:', err);
      }
    }

    if (contextSnippets.length === 0) {
      return { contextText: '', sources: [] };
    }

    // 3. Format prompt template tailored for instruction LLMs
    if (compactMode) {
      const prompt = `DIRECTIVES DE SURVIE ET SECOURS :\n${contextSnippets[0]}\n\nQUESTION DE L'UTILISATEUR :\n${userQuery}\n\nConsigne : Réponds exclusivement en français, de manière concise, directe et structurée par étapes d'action numérotées (1, 2, 3) en t'appuyant rigoureusement sur ces directives.`;
      return {
        contextText: prompt,
        sources: matchedSources
      };
    }

    const contextBlock = contextSnippets.join('\n\n---\n\n');
    const prompt = `--- DIRECTIVES TECHNIQUES DE SURVIE HORS-LIGNE ---\n${contextBlock}\n--- FIN DES DIRECTIVES ---\n\nQUESTION DE L'UTILISATEUR :\n${userQuery}\n\nConsigne : Réponds en français de manière claire, structurée et immédiatement applicable (étapes numérotées 1, 2, 3) en priorisant les directives ci-dessus.`;

    return { contextText: prompt, sources: matchedSources };
  }

  extractRelevantPassage(body, keywords, maxLen = 650) {
    const paragraphs = body.split(/\n\s*\n/);
    let bestP = paragraphs[0] || '';
    let maxScore = -1;

    for (const p of paragraphs) {
      if (p.trim().length < 35) continue;
      const pNorm = this.normalize(p);
      let score = 0;
      for (const t of keywords) {
        const root = t.length >= 5 ? t.slice(0, 4) : t;
        if (pNorm.includes(t)) score += 2;
        else if (pNorm.includes(root)) score += 1;
      }
      if (score > maxScore) {
        maxScore = score;
        bestP = p;
      }
    }

    const clean = bestP.replace(/#+\s*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
    return clean.slice(0, maxLen);
  }
}
