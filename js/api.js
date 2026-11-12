/**
 * Unified Local LLM Client for Survival PWA
 * Supports:
 * 1. WebGPU In-Browser Engine (Default - zero install, zero Termux)
 * 2. Ollama / llama.cpp Local (Port 11434 - Termux / PC Windows)
 * 3. OpenAI-compatible Local Servers (Port 8080 - PocketPal AI / LocalAI)
 */

import { WebGPUEngine, WEBGPU_MODELS } from './webgpu.js';

export class LLMClient {
  constructor() {
    // Engine mode: 'webgpu' (default) | 'ollama' | 'openai'
    this.engineMode = localStorage.getItem('llm_engine_mode') || 'webgpu';

    // Ollama / OpenAI settings
    this.endpoint = localStorage.getItem('llm_endpoint') || 'http://127.0.0.1:11434';
    this.apiType = localStorage.getItem('llm_api_type') || 'ollama'; // 'ollama' | 'openai'
    this.model = localStorage.getItem('llm_model') || 'llama3.2:1b';
    this.temperature = parseFloat(localStorage.getItem('llm_temperature') || '0.7');
    this.systemPrompt = localStorage.getItem('llm_system_prompt') || this.getDefaultSystemPrompt();

    // WebGPU Engine instance
    this.webgpu = new WebGPUEngine();
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
    if (settings.engineMode !== undefined) {
      this.engineMode = settings.engineMode;
      localStorage.setItem('llm_engine_mode', this.engineMode);
    }
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
    if (settings.webgpuModel !== undefined) {
      this.webgpu.currentModel = settings.webgpuModel;
      localStorage.setItem('webgpu_model', settings.webgpuModel);
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
      if (fetchOpts.targetAddressSpace) {
        delete fetchOpts.targetAddressSpace;
        return await fetch(url, fetchOpts);
      }
      throw err;
    }
  }

  /**
   * Test connection and retrieve available models (for Ollama / OpenAI)
   */
  async checkConnectionAndGetModels() {
    const base = this.endpoint;
    const errors = [];

    if (this.apiType === 'ollama') {
      try {
        const res = await this.lnaFetch(`${base}/api/tags`, { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          const models = (data.models || []).map(m => m.name || m.model);
          return { ok: true, type: 'ollama', models: models.length ? models : ['llama3.2:1b'] };
        }
      } catch (err) {
        errors.push(`Ollama /api/tags: ${err.message}`);
      }
    }

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
   * Unified stream chat completion
   */
  async streamChat(messages, onToken, signal, onLoadingProgress) {
    const fullMessages = [
      { role: 'system', content: this.systemPrompt },
      ...messages
    ];

    // 1. WebGPU Mode (Default)
    if (this.engineMode === 'webgpu') {
      return this.webgpu.streamChat(fullMessages, onToken, signal, onLoadingProgress);
    }

    // 2. Ollama Mode
    if (this.engineMode === 'ollama' || (this.engineMode === 'external' && this.apiType === 'ollama')) {
      return this._streamOllama(this.endpoint, fullMessages, onToken, signal);
    }

    // 3. OpenAI Compatible Mode (PocketPal / llama-server / LocalAI)
    return this._streamOpenAI(this.endpoint, fullMessages, onToken, signal);
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
      buffer = lines.pop();

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
          // ignore
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
