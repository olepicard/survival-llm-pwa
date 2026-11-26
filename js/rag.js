/**
 * Bilingual RAG (Retrieval-Augmented Generation) Engine v3.4
 * Searches local offline emergency protocols and survival guides in French or English,
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

const ENGLISH_STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for',
  'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him',
  'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more',
  'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
  'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some',
  'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we',
  'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you',
  'your', 'yours', 'yourself', 'yourselves', 'steps', 'step', 'please', 'emergency', 'tell', 'need'
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

  extractKeywords(query, lang = 'fr') {
    const norm = this.normalize(query);
    const stopWords = (lang === 'en') ? ENGLISH_STOP_WORDS : FRENCH_STOP_WORDS;
    const tokens = norm.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
    if (tokens.length === 0) {
      return norm.split(/\s+/).filter(w => w.length >= 2);
    }
    return tokens;
  }

  /**
   * Find top relevant context for a user query
   * @param {string} userQuery
   * @param {boolean} compactMode - True when using WebGPU in-browser engine
   * @param {string} lang - 'fr' | 'en'
   * @returns {Promise<{contextText: string, sources: Array<{title: string, id: number|string}>}>}
   */
  async retrieveContext(userQuery, compactMode = false, lang = 'fr') {
    if (!this.enabled || !userQuery || userQuery.trim().length < 3) {
      return { contextText: '', sources: [] };
    }

    const isEn = lang === 'en';
    const matchedSources = [];
    const contextSnippets = [];
    const maxSnippets = compactMode ? 1 : 2;
    const maxExcerptChars = compactMode ? 350 : 650;

    const keywords = this.extractKeywords(userQuery, lang);
    const normQuery = this.normalize(userQuery);

    // 1. Check emergency reflex protocols with weighted scoring
    if (this.emergencyMgr && this.emergencyMgr.protocols && this.emergencyMgr.protocols.length) {
      let bestProto = null;
      let maxScore = 0;

      for (const proto of this.emergencyMgr.protocols) {
        let score = 0;
        const protoTitle = isEn ? (proto.title_en || proto.title) : proto.title;
        const protoSummary = isEn ? (proto.summary_en || proto.summary) : proto.summary;
        const kwList = isEn 
          ? ((proto.keywords_en || []).concat(proto.keywords || []))
          : (proto.keywords || []);

        const protoTitleNorm = this.normalize(protoTitle);
        const protoSummaryNorm = this.normalize(protoSummary || '');
        const normKwList = kwList.map(k => this.normalize(k));

        // Keywords list check (6 pts per keyword match)
        for (const kw of normKwList) {
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
        const protoTitle = isEn ? (bestProto.title_en || bestProto.title) : bestProto.title;
        const steps = isEn ? (bestProto.steps_en || bestProto.steps) : bestProto.steps;
        const warnings = isEn ? (bestProto.warnings_en || bestProto.warnings) : bestProto.warnings;

        const sourceLabel = isEn ? `[Reflex Card] ${protoTitle}` : `[Fiche Réflexe] ${protoTitle}`;
        matchedSources.push({ title: sourceLabel, id: bestProto.id });

        const stepsFormatted = steps.map((st, i) => `${i + 1}. ${st}`).join(' ');
        const warnPrefix = isEn ? ' (WARNING: ' : ' (ATTENTION : ';
        const warnText = warnings && warnings.length ? `${warnPrefix}${warnings[0]})` : '';
        const protoPrefix = isEn ? `EMERGENCY PROTOCOL : ${protoTitle}. ` : `PROTOCOLE D'URGENCE : ${protoTitle}. `;
        contextSnippets.push(`${protoPrefix}${stepsFormatted}${warnText}`.slice(0, maxExcerptChars));
      }
    }

    // 2. Search local guide index if we still have room for snippets
    if (contextSnippets.length < maxSnippets) {
      try {
        const guides = await this.db.searchGuides(userQuery, 'all', compactMode ? 2 : 4);
        for (const guide of guides) {
          const guidePrefix = isEn ? '[Guide]' : '[Guide]';
          matchedSources.push({ title: `${guidePrefix} ${guide.title}`, id: guide.id });

          const full = await this.db.getArticle(guide.id);
          const header = isEn ? `TECHNICAL MANUAL [${guide.title}] : ` : `GUIDE TECHNIQUE [${guide.title}] : `;
          if (full && full.body) {
            const excerpt = this.extractRelevantPassage(full.body, keywords, maxExcerptChars);
            contextSnippets.push(`${header}${excerpt}`);
          } else if (guide.snippet) {
            contextSnippets.push(`${header}${guide.snippet.slice(0, maxExcerptChars)}`);
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

    // 3. Format prompt template tailored for instruction LLMs (Bilingual)
    if (isEn) {
      if (compactMode) {
        const prompt = `SURVIVAL & FIRST AID DIRECTIVES :\n${contextSnippets[0]}\n\nUSER QUESTION :\n${userQuery}\n\nInstructions: Respond strictly in English in a concise, direct, and structured manner with numbered action steps (1, 2, 3) adhering strictly to these directives.`;
        return { contextText: prompt, sources: matchedSources };
      }
      const contextBlock = contextSnippets.join('\n\n---\n\n');
      const prompt = `--- OFFLINE SURVIVAL & FIRST AID DIRECTIVES ---\n${contextBlock}\n--- END OF DIRECTIVES ---\n\nUSER QUESTION :\n${userQuery}\n\nInstructions: Respond strictly in English in a clear, concise, and structured manner with numbered action steps (1, 2, 3) prioritizing the directives above.`;
      return { contextText: prompt, sources: matchedSources };
    }

    // French prompt templates
    if (compactMode) {
      const prompt = `DIRECTIVES DE SURVIE ET SECOURS :\n${contextSnippets[0]}\n\nQUESTION DE L'UTILISATEUR :\n${userQuery}\n\nConsigne : Réponds exclusivement en français, de manière concise, directe et structurée par étapes d'action numérotées (1, 2, 3) en t'appuyant rigoureusement sur ces directives.`;
      return { contextText: prompt, sources: matchedSources };
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
