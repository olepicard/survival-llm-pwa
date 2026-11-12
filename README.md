# 🛡️ Survival LLM • PWA Standalone Android & PC

🌐 **Application en ligne (GitHub Pages)** : **[https://olepicard.github.io/survival-llm-pwa/](https://olepicard.github.io/survival-llm-pwa/)**

Version **Progressive Web App (PWA)** autonome en pur JavaScript/HTML5/CSS3 de **Survival LLM**, optimisée pour fonctionnement 100% hors-ligne en mode avion sur smartphone (Samsung Galaxy S25 Ultra, Pixel, etc.) et PC.

---

## ⚡ Deux Modes d'Exécution IA au Choix

L'application prend en charge deux approches complémentaires configurables dans l'onglet **⚙️ Réglages** :

### 1. 🌐 Moteur WebGPU Embarqué (In-Browser) — *Activé par Défaut*
* **Zéro installation, aucun terminal, aucun Termux requis.**
* Le modèle IA (ex: **Llama 3.2 1B Instruct**, ~720 Mo) s'exécute **directement dans le navigateur** en tirant parti du GPU de votre smartphone (ex: **Qualcomm Adreno 830** sur Galaxy S25 Ultra avec pilotes Vulkan).
* Les poids du modèle sont mis en cache localement dans le navigateur lors du premier chargement et fonctionnent ensuite **100% hors-ligne en mode avion**.
* Modèles disponibles :
  * `Llama-3.2-1B-Instruct-q4f16_1-MLC` (Recommandé mobile • 720 Mo)
  * `SmolLM2-360M-Instruct-q4f16_1-MLC` (Ultra Léger • 210 Mo)
  * `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` (Compact & Précis • 360 Mo)
  * `Llama-3.2-3B-Instruct-q4f16_1-MLC` (Haute Précision PC / 12 Go+ RAM • 1.8 Go)

### 2. 📱 Moteur Natif Ollama / llama.cpp (Port 11434 / 8080)
Pour les utilisateurs qui souhaitent exploiter la vitesse maximale brute en C++ ou des modèles plus lourds (3B ou 7B) :
* **Sur Android via Termux (Ollama ARM64) :**
  ```bash
  pkg update && pkg install ollama
  ollama serve &
  ollama run llama3.2:1b
  ```
  *Dans la PWA, l'URL est `http://127.0.0.1:11434`.*
* **Sur Android via Application Graphique (PocketPal AI) :**
  Installez PocketPal AI, chargez un modèle GGUF et cochez *« Démarrer le serveur local »* (port 8080).
* **Sur PC Windows partagé en WiFi local vers le smartphone :**
  ```cmd
  set OLLAMA_HOST=0.0.0.0
  set OLLAMA_ORIGINS=*
  ollama serve
  ```

---

## 💾 Gestionnaire de Capacité Mémoire & Modes Hors-Ligne

L'application teste automatiquement la capacité disque de votre appareil via `navigator.storage.estimate()` et demande la persistance anti-purge via `navigator.storage.persist()` :

| Mode de Stockage | Taille Disque | Contenu & Disponibilité Hors-Ligne | Recommandé pour |
| :--- | :--- | :--- | :--- |
| **📦 Full Hors-Ligne** *(Recommandé)* | **~16 Mo** | **100% des 670 guides intégraux** téléchargés et stockés dans `IndexedDB` & `CacheStorage`. Zéro réseau requis, tous les manuels de survie et protocoles médicaux s'ouvrent en mode avion sans erreur. | Expéditions, zones blanches, pannes réseau, autonomie totale. |
| **⚡ Mode Partiel / Léger** | **~1.5 Mo** | Fiches réflexes SOS d'urgence, index de recherche et extraits RAG conservés hors-ligne. Les manuels intégraux affichent une fiche résumé avec bouton de téléchargement en un clic. | Appareils avec espace très restreint. |

---

## 📱 Points forts pour Android (Galaxy S25 Ultra)

1. **Installation native (PWA WebAPK)** :
   * Ouvrez l'application dans Chrome ou Samsung Internet.
   * Cliquez sur le bouton **« 📲 Installer »** ou via le menu du navigateur : **« Ajouter à l'écran d'accueil »**.
   * L'application s'ouvre en **plein écran**, avec son icône d'application dédiée, sans barre d'URL.
2. **Fonctionnement 100% Hors-Ligne (Offline-First)** :
   * L'application est mise en cache localement par le **Service Worker (`sw.js` v2.1)** avec stratégie Cache-First pour les données.
   * **670 guides de survie traduits en français** (SERE, FEMA, TCCC, secourisme militaire, hygiène, conserves sûres USDA, WikiCiv) sont stockés dans la base locale (`IndexedDB`).
   * **8 fiches réflexes d'urgence vitale** (Garrot tourniquet, arrêt cardiaque RCR, étouffement Heimlich, purification d'eau, hypothermie, feu, brûlures, retombées CBRN) sont accessibles instantanément.
3. **Moteur RAG Hybride Local** :
   * Recherche instantanée dans les 670 guides et injection automatique du contexte vérifié dans le prompt LLM local.
4. **Interface AMOLED Ultra-Économe** :
   * Thème sombre noir absolu pour préserver la batterie en situation de crise.

---

## 📁 Structure du Projet

```
js pwa standealone/
├── index.html                  # Interface utilisateur PWA et sélecteur de moteurs
├── manifest.webmanifest        # Manifeste PWA Android
├── sw.js                       # Service Worker v2.1 (Cache-First Offline)
├── server.py                   # Serveur local de distribution (MIME types & IP LAN)
├── start.bat                   # Lanceur rapide Windows
├── css/
│   └── styles.css              # Thème AMOLED, radio cards moteurs, jauge et cartes
├── js/
│   ├── app.js                  # Contrôleur général et gestionnaire du cycle de vie
│   ├── api.js                  # Client API unifié (WebGPU, Ollama, OpenAI)
│   ├── webgpu.js               # Moteur WebLLM WebGPU in-browser (zéro-install)
│   ├── arch.js                 # Détection architecture matérielle & moteur llama.cpp
│   ├── db.js                   # IndexedDB, estimation quota & packs Full/Partiel
│   ├── emergency.js            # Protocoles réflexes d'urgence immédiate
│   ├── rag.js                  # Moteur RAG d'injection de contexte local
│   └── markdown.js             # Moteur de rendu Markdown ultra-léger
├── data/
│   ├── emergency_protocols.json # 8 protocoles vitaux immédiats
│   ├── guides_index.json       # Index des 670 guides de survie en français
│   ├── guides_survival.json    # Manuels SERE & plans de catastrophe FEMA (6.6 Mo)
│   ├── guides_medical.json     # Secourisme & médecine tactique TCCC (7.0 Mo)
│   ├── guides_food.json        # Eau potable & conserves sécurisées USDA (0.4 Mo)
│   └── guides_tech.json        # WikiCiv : reconstruction des technologies vitales (1.2 Mo)
└── icons/
    ├── icon.svg                # Logo vectoriel haute fidélité
    ├── icon-192.png            # Icône écran d'accueil Android 192x192
    └── icon-512.png            # Icône splash screen Android 512x512
```

---

## 🛡️ Sécurité & Modern Web Standards (LNA)
L'application intègre le standard moderne **Local Network Access (LNA)** (`targetAddressSpace: 'loopback'` / `'local'`), garantissant que les navigateurs basés sur Chromium récents ne bloquent pas les requêtes locales vers votre machine sans avertissement clair.
