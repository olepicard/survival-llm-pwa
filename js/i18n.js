/**
 * Internationalization (i18n) Engine for Survival LLM PWA
 * Auto-detects system/browser language (English if not French, French if starts with 'fr').
 * Allows seamless runtime switching between French and English.
 */

export const TRANSLATIONS = {
  fr: {
    app_title: "Survival LLM",
    app_badge: "100% Hors-Ligne",
    lang_switch_btn: "🇬🇧 EN",
    lang_switch_title: "Basculer en anglais / Switch to English",

    // Navigation
    nav_chat: "🛡️ Assistant",
    nav_emergency: "🩸 Fiches Réflexes",
    nav_guides: "📚 Guides",
    nav_settings: "⚙️ Réglages",

    // Chat
    welcome_title: "Assistant de Survie & Secourisme",
    welcome_desc: "Posez vos questions d'urgence, de premiers soins, d'autonomie ou de gestion de crise.",
    chip_water: "💧 Filtre à eau naturel",
    chip_water_q: "Comment fabriquer un filtre à eau avec du sable et du charbon ?",
    chip_bleeding: "🩸 Urgence hémorragie",
    chip_bleeding_q: "Quelles sont les priorités absolues en cas d'accident avec hémorragie ?",
    chip_shelter: "🏕️ Abri d'urgence",
    chip_shelter_q: "Comment construire un abri anti-froid en forêt ?",
    chip_botulism: "🥫 Prévention botulisme",
    chip_botulism_q: "Quels aliments stériliser à la cocotte-minute contre le botulisme ?",
    chat_input_placeholder: "Posez une question de survie ou de secours...",
    chat_send: "Envoyer",
    chat_stop: "Arrêter",
    chat_clear: "Effacer",
    chat_clear_confirm: "Effacer l'historique de la conversation ?",
    sources_consulted: "📚 Sources locales consultées :",
    copy_btn_title: "Copier la réponse",
    copied: "Copié !",

    // Emergency (SOS)
    sos_badge: "URGENCES VITALES",
    sos_banner_title: "Fiches Réflexes Immédiates",
    sos_banner_desc: "Protocoles d'action rapide hors-ligne utilisables immédiatement sans attendre de réseau ni de modèle IA.",
    sos_open_btn: "Ouvrir le protocole ➔",
    sos_modal_warnings: "⚠️ DANGERS & CONTRE-INDICATIONS",
    sos_modal_steps: "📋 ÉTAPES D'ACTION IMMÉDIATES :",
    sos_ask_ai_btn: "💬 Poser une question à l'IA sur ce cas",
    cat_medical: "MÉDICAL",
    cat_survival: "SURVIE",
    cat_tech: "TECHNIQUE",
    cat_food: "ALIMENTATION",

    // Guides Library
    search_guides_placeholder: "Rechercher dans les 670 guides...",
    filter_all: "Tous les thèmes",
    filter_medical: "Médical & Secourisme",
    filter_survival: "Survie & Bushcraft",
    filter_tech: "Technique & Autonomie",
    filter_food: "Alimentation & Eau",
    guides_count_badge: "guides disponibles hors-ligne",
    read_guide_btn: "Lire le guide",
    close_modal_btn: "Fermer",

    // Settings
    settings_storage_title: "💾 Gestionnaire de Stockage Hors-Ligne",
    settings_storage_desc: "Testez et configurez le stockage de votre smartphone pour garantir l'accès 100% hors-ligne aux 670 guides en mode avion.",
    storage_used: "Espace utilisé :",
    storage_available: "Disponible :",
    storage_btn_dl_full: "📥 Télécharger le pack Full Hors-Ligne (16 Mo)",
    storage_btn_clear: "🗑️ Vider les guides complets",
    settings_engine_title: "🤖 Sélection du Moteur IA",
    settings_engine_desc: "Choisissez le mode d'exécution de l'intelligence artificielle sur votre appareil :",
    engine_webgpu_title: "🌐 WebGPU Embarqué (In-Browser)",
    engine_webgpu_desc: "Exécution directe sur le GPU de votre smartphone. Zéro terminal, aucun Termux, 100% hors-ligne.",
    engine_webgpu_badge: "Par défaut",
    engine_ollama_title: "📱 Ollama / llama.cpp Local (Port 11434)",
    engine_ollama_desc: "Inférence C++ native pure avec instructions ARM NEON ou GPU PC (Ollama sous Termux ou PC Windows).",
    engine_openai_title: "🤖 Serveur Local / App APK (Port 8080)",
    engine_openai_desc: "Application Android avec interface graphique (PocketPal AI) ou serveur API local compatible OpenAI.",
    webgpu_hw_title: "🔬 Profil Matériel WebGPU détecté :",
    webgpu_btn_auto: "🎯 Sélectionner automatiquement le modèle optimal pour cet appareil",
    webgpu_model_label: "Modèle WebGPU In-Browser",
    webgpu_btn_preload: "📥 Télécharger / Mettre en cache",
    webgpu_btn_clear: "🔄 Réinitialiser le cache WebGPU",
    temp_label: "Température :",
    temp_hint: "0.2 - 0.6 : Réponses strictes et factuelles (recommandé survie/médical). 0.7+ : Plus créatif.",
    sys_prompt_label: "Prompt Système de Survie",
    btn_save_settings: "💾 Enregistrer les Réglages",
    toast_settings_saved: "Réglages enregistrés avec succès !",
    logs_title: "📋 Journal des Logs & Diagnostic",
    logs_desc: "Consultez en temps réel les logs d'exécution, les erreurs WebGPU (allocation VRAM, mapAsync) ou réseau directement sur votre smartphone.",
    status_online: "En ligne",
    status_offline: "Hors-ligne",
    status_checking: "Vérification...",
    status_ready: "Prêt",
    status_airplane_ready: "Prêt pour mode avion"
  },
  en: {
    app_title: "Survival LLM",
    app_badge: "100% Offline",
    lang_switch_btn: "🇫🇷 FR",
    lang_switch_title: "Switch to French / Basculer en français",

    // Navigation
    nav_chat: "🛡️ Assistant",
    nav_emergency: "🩸 Reflex Cards",
    nav_guides: "📚 Guides",
    nav_settings: "⚙️ Settings",

    // Chat
    welcome_title: "Survival & Tactical First Aid Assistant",
    welcome_desc: "Ask life-saving questions regarding emergencies, trauma first aid, off-grid autonomy, and disaster resilience.",
    chip_water: "💧 Natural water filter",
    chip_water_q: "How to build an emergency water filter using sand and charcoal?",
    chip_bleeding: "🩸 Severe bleeding SOS",
    chip_bleeding_q: "What are the immediate critical priorities for massive hemorrhage bleeding?",
    chip_shelter: "🏕️ Emergency shelter",
    chip_shelter_q: "How to build an emergency cold-weather shelter in the woods?",
    chip_botulism: "🥫 Botulism prevention",
    chip_botulism_q: "Which low-acid foods must be pressure-canned to prevent botulism?",
    chat_input_placeholder: "Ask a survival or emergency first aid question...",
    chat_send: "Send",
    chat_stop: "Stop",
    chat_clear: "Clear",
    chat_clear_confirm: "Clear conversation history?",
    sources_consulted: "📚 Local offline sources consulted:",
    copy_btn_title: "Copy response",
    copied: "Copied!",

    // Emergency (SOS)
    sos_badge: "CRITICAL EMERGENCIES",
    sos_banner_title: "Immediate Action Reflex Cards",
    sos_banner_desc: "Fast offline action protocols usable immediately without waiting for network or AI model latency.",
    sos_open_btn: "Open protocol ➔",
    sos_modal_warnings: "⚠️ DANGERS & CONTRAINDICATIONS",
    sos_modal_steps: "📋 IMMEDIATE ACTION STEPS:",
    sos_ask_ai_btn: "💬 Ask AI about this emergency case",
    cat_medical: "MEDICAL",
    cat_survival: "SURVIVAL",
    cat_tech: "OFF-GRID TECH",
    cat_food: "FOOD & WATER",

    // Guides Library
    search_guides_placeholder: "Search 670 survival guides...",
    filter_all: "All themes",
    filter_medical: "Medical & First Aid",
    filter_survival: "Survival & Bushcraft",
    filter_tech: "Tech & Off-Grid",
    filter_food: "Food & Water",
    guides_count_badge: "guides available offline",
    read_guide_btn: "Read guide",
    close_modal_btn: "Close",

    // Settings
    settings_storage_title: "💾 Offline Storage Manager",
    settings_storage_desc: "Check and manage device storage to guarantee 100% offline access to all 670 guides in airplane mode.",
    storage_used: "Space used:",
    storage_available: "Available:",
    storage_btn_dl_full: "📥 Download Full Offline Pack (16 MB)",
    storage_btn_clear: "🗑️ Clear full guides cache",
    settings_engine_title: "🤖 AI Engine Selection",
    settings_engine_desc: "Choose how artificial intelligence runs on your device:",
    engine_webgpu_title: "🌐 Embedded WebGPU (In-Browser)",
    engine_webgpu_desc: "Runs directly on your smartphone GPU. Zero terminal, no Termux, 100% offline.",
    engine_webgpu_badge: "Default",
    engine_ollama_title: "📱 Ollama / llama.cpp Local (Port 11434)",
    engine_ollama_desc: "Pure native C++ inference with ARM NEON instructions or PC GPU (Ollama in Termux or Windows PC).",
    engine_openai_title: "🤖 Local Server / APK App (Port 8080)",
    engine_openai_desc: "Android app with graphical UI (PocketPal AI) or OpenAI-compatible local API server.",
    webgpu_hw_title: "🔬 Detected WebGPU Hardware Profile:",
    webgpu_btn_auto: "🎯 Automatically select optimal model for this device",
    webgpu_model_label: "WebGPU In-Browser Model",
    webgpu_btn_preload: "📥 Download / Cache Model",
    webgpu_btn_clear: "🔄 Reset WebGPU Cache",
    temp_label: "Temperature:",
    temp_hint: "0.2 - 0.6: Strict and factual responses (recommended for medical/survival). 0.7+: More creative.",
    sys_prompt_label: "Survival System Prompt",
    btn_save_settings: "💾 Save Settings",
    toast_settings_saved: "Settings saved successfully!",
    logs_title: "📋 Logs & Diagnostic Journal",
    logs_desc: "Monitor real-time execution logs, WebGPU errors (VRAM allocation, mapAsync), or network events on your device.",
    status_online: "Online",
    status_offline: "Offline",
    status_checking: "Checking...",
    status_ready: "Ready",
    status_airplane_ready: "Airplane mode ready"
  }
};

let currentLang = 'fr';

/**
 * Detect initial language:
 * If saved in localStorage ('fr' or 'en'), use it.
 * Otherwise, detect system/browser language: if starts with 'fr', use 'fr', else 'en'.
 */
export function detectInitialLanguage() {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('app_language') : null;
  if (saved === 'fr' || saved === 'en') {
    currentLang = saved;
    return saved;
  }
  const sys = (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) ? (navigator.language || navigator.userLanguage) : 'en';
  currentLang = sys.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('app_language', currentLang);
  }
  return currentLang;
}

export function getLanguage() {
  return currentLang;
}

export function setLanguage(lang) {
  if (lang !== 'fr' && lang !== 'en') return;
  currentLang = lang;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('app_language', lang);
  }
  updateDOMTranslations(lang);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('language-changed', { detail: { lang } }));
  }
}

export function t(key, lang = currentLang) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.fr;
  return dict[key] !== undefined ? dict[key] : (TRANSLATIONS.fr[key] || key);
}

/**
 * Update all elements in DOM with [data-i18n] or [data-i18n-placeholder]
 */
export function updateDOMTranslations(lang = currentLang) {
  if (typeof document === 'undefined') return;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      const val = t(key, lang);
      if (val) el.textContent = val;
    }
  });

  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (key) {
      const val = t(key, lang);
      if (val) el.innerHTML = val;
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      const val = t(key, lang);
      if (val) el.setAttribute('placeholder', val);
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      const val = t(key, lang);
      if (val) el.setAttribute('title', val);
    }
  });

  // Update HTML lang attribute
  document.documentElement.lang = lang;
}
