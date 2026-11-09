/**
 * API Client for Ollama & OpenAI-compatible local LLM engines
 * Supports streaming, auto-detection, and Modern Web Local Network Access (LNA)
 */

export class LLMClient {
  constructor() {
    this.endpoint = localStorage.getItem('llm_endpoint') || 'http://127.0.0.1:11434';
    this.apiType = localStorage.getItem('llm_api_type') || 'ollama'; // 'ollama' | 'openai'
    this.model = localStorage.getItem('llm_model') || 'llama3.2:3b';
    this.temperature = parseFloat(localStorage.getItem('llm_temperature') || '0.7');
    this.systemPrompt = localStorage.getItem('llm_system_prompt') || this.getDefaultSystemPrompt();
  }

  getDefaultSystemPrompt() {
    return `Tu es Survival LLM, un assistant expert en survie en milieu hostile, premiers secours tactiques (TCCC), autonomie et gestion des catastrophes naturelles ou technologiques.
DIRECTIVES :
1. Réponds toujours en FRANÇAIS, avec un ton calme, clair, structuré et direct.
2. Pour les urgences médicales ou vitales, donne les étapes d'action immédiates NUMÉROTÉES (1, 2, 3) en mettant en évidence les DANGERS et contre-indications.
3. Si un contexte de guides de survie est fourni, appuie-toi dessus avec rigueur.
4. Reste concis, pragmatique et compréhensible même sous stress extrême.`;
  }

  saveSettings(settings) {
    if (settings.endpoint !== undefined) {
      this.endpoint = settings.endpoint.replace(/\/+$/, '');
      localStorage.setItem('llm_endpoint', this.endpoint);
    }
    if (settings.apiType !== undefined) {
      this.apiType = settings.apiType;
      localStorage.setItem('llm_api_type', this.apiType);
    }
    if (settings.model !== undefined) {
      this.model = settings.model;
      localStorage.setItem('llm_model', this.model);
    }
    if (settings.temperature !== undefined) {
      this.temperature = parseFloat(settings.temperature);
      localStorage.setItem('llm_temperature', this.temperature.toString());
    }
    if (settings.systemPrompt !== undefined) {
      this.systemPrompt = settings.systemPrompt;
      localStorage.setItem('llm_system_prompt', this.systemPrompt);
    }
  }

  /**
   * Determine targetAddressSpace for modern Local Network Access standard
   */
  getAddressSpace(urlStr) {
    try {
      const parsed = new URL(urlStr);
      const host = parsed.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return 'loopback';
      }
      if (
        host.startsWith('192.168.') ||
        host.startsWith('10.') ||
        host.endsWith('.local') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
      ) {
        return 'local';
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  /**
   * Safe fetch with Local Network Access (LNA) fallback
   */
  async lnaFetch(url, options = {}) {
    const addressSpace = this.getAddressSpace(url);
    const fetchOpts = {
      ...options,
      mode: 'cors'
    };

    if (addressSpace) {
      try {
        fetchOpts.targetAddressSpace = addressSpace;
      } catch {
        // unsupported by browser
      }
    }

    try {
      return await fetch(url, fetchOpts);
    } catch (err) {
      // If failed with targetAddressSpace, retry once without it in case of strict error
      if (fetchOpts.targetAddressSpace) {
        delete fetchOpts.targetAddressSpace;
        return await fetch(url, fetchOpts);
      }
      throw err;
    }
  }

  /**
   * Test connection and retrieve available models
   */
  async checkConnectionAndGetModels() {
    const base = this.endpoint;
    const errors = [];

    // Try Ollama endpoint first if apiType is ollama or auto
    if (this.apiType === 'ollama') {
      try {
        const res = await this.lnaFetch(`${base}/api/tags`, { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          const models = (data.models || []).map(m => m.name || m.model);
          return { ok: true, type: 'ollama', models: models.length ? models : ['llama3.2:3b'] };
        }
      } catch (err) {
        errors.push(`Ollama /api/tags: ${err.message}`);
      }
    }

    // Try OpenAI endpoint
    try {
      const res = await this.lnaFetch(`${base}/v1/models`, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        const models = (data.data || []).map(m => m.id);
        return { ok: true, type: 'openai', models: models.length ? models : ['default'] };
      }
    } catch (err) {
      errors.push(`OpenAI /v1/models: ${err.message}`);
    }

    // Direct ping test fallback
    try {
      const res = await this.lnaFetch(base, { method: 'GET' });
      if (res.ok) {
        return { ok: true, type: this.apiType, models: [this.model] };
      }
    } catch (err) {
      errors.push(`Racine HTTP: ${err.message}`);
    }

    throw new Error(`Impossible de joindre le serveur LLM à ${base}.\nDétails:\n${errors.join('\n')}`);
  }

  /**
   * Send a chat request with streaming tokens
   * @param {Array<{role: string, content: string}>} messages
   * @param {Function} onToken - callback(tokenText, fullText)
   * @param {AbortSignal} signal
   */
  async streamChat(messages, onToken, signal) {
    const isOllama = this.apiType === 'ollama';
    const base = this.endpoint;

    // Prepend system prompt if not present
    const fullMessages = [
      { role: 'system', content: this.systemPrompt },
      ...messages
    ];

    if (isOllama) {
      return this._streamOllama(base, fullMessages, onToken, signal);
    } else {
      return this._streamOpenAI(base, fullMessages, onToken, signal);
    }
  }

  async _streamOllama(base, messages, onToken, signal) {
    const url = `${base}/api/chat`;
    const body = {
      model: this.model,
      messages: messages,
      stream: true,
      options: {
        temperature: this.temperature
      }
    };

    const response = await this.lnaFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Erreur Ollama HTTP ${response.status}: ${errText || response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep partial line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.message && parsed.message.content) {
            const token = parsed.message.content;
            fullText += token;
            if (onToken) onToken(token, fullText);
          }
          if (parsed.done) {
            return fullText;
          }
        } catch {
          // ignore malformed JSON chunk
        }
      }
    }

    return fullText;
  }

  async _streamOpenAI(base, messages, onToken, signal) {
    const url = `${base}/v1/chat/completions`;
    const body = {
      model: this.model,
      messages: messages,
      stream: true,
      temperature: this.temperature
    };

    const response = await this.lnaFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Erreur API compatible OpenAI HTTP ${response.status}: ${errText || response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') return fullText;

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              if (onToken) onToken(delta, fullText);
            }
          } catch {
            // ignore
          }
        }
      }
    }

    return fullText;
  }
}
