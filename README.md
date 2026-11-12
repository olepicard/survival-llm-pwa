# 🛡️ Survival LLM • PWA Standalone Android & PC

🌐 **Application en ligne (GitHub Pages)** : **[https://olepicard.github.io/survival-llm-pwa/](https://olepicard.github.io/survival-llm-pwa/)**

Version **Progressive Web App (PWA)** autonome en pur JavaScript/HTML5/CSS3 de **Survival LLM**, optimisée pour fonctionnement 100% hors-ligne en mode avion sur smartphone (Samsung Galaxy S25 Ultra, Pixel, etc.) et PC.

Au lieu de dépendre d'un binaire C++ compilé monolithique, cette application fonctionne **dans n'importe quel navigateur moderne (Chrome, Samsung Internet, Edge, Firefox)** et se connecte via des **requêtes API HTTP en streaming (`fetch`)** à votre moteur LLM local préféré adapté à l'architecture matérielle cible :
* **Ollama / llama.cpp ARM64 natif sur Android (via Termux)** sur smartphone (ex: Snapdragon 8 Elite avec Adreno 830)
* **Ollama / llama.cpp x86_64 sur PC Windows** (accessible en local ou sur le réseau WiFi)
* **PocketPal AI / Edge Gallery / LocalAI / MLC LLM** sur Android (API compatible OpenAI).

---

## 💾 Gestionnaire de Capacité Mémoire & Modes Hors-Ligne

L'application teste automatiquement la capacité disque de votre smartphone ou PC via `navigator.storage.estimate()` et demande la persistance des données via `navigator.storage.persist()` :

| Mode de Stockage | Taille Disque | Contenu & Disponibilité Hors-Ligne | Recommandé pour |
| :--- | :--- | :--- | :--- |
| **📦 Full Hors-Ligne** *(Recommandé)* | **~16 Mo** | **100% des 670 guides intégraux** téléchargés et stockés dans `IndexedDB` & `CacheStorage`. Zéro réseau requis, tous les manuels de survie et protocoles médicaux s'ouvrent en mode avion sans erreur. | Expéditions, zones blanches, pannes réseau, autonomie totale. |
| **⚡ Mode Partiel / Léger** | **~1.5 Mo** | Fiches réflexes SOS d'urgence, index de recherche et extraits RAG conservés hors-ligne. Les manuels intégraux affichent une fiche résumé avec bouton de téléchargement en un clic. | Appareils avec espace très restreint. |

---

## 🎯 Architecture Cible & Moteur LLM Détecté

La PWA intègre un module de détection matérielle (`js/arch.js`) qui analyse l'architecture CPU et le GPU de l'appareil client pour fournir les instructions et binaires adaptés issus de [github.com/ollama/ollama](https://github.com/ollama/ollama/) (`llama.cpp`) :

### 1. Sur Smartphone Android ARM64 (ex: Samsung Galaxy S25 Ultra)
* **Processeur :** Qualcomm Snapdragon 8 Elite (AArch64 / ARMv9-A)
* **GPU :** Qualcomm Adreno 830 (Vulkan 1.3 / OpenCL)
* **Binaire adapté :** `ollama-linux-arm64` (ou `llama-server` compilé avec `ggml-cpu` NEON et shaders Vulkan)
* **Démarrage ultra-rapide dans Termux (sans root) :**
  ```bash
  pkg update && pkg install ollama
  ollama serve &
  ollama run llama3.2:1b
  ```
  *Dans la PWA, l'URL est directement `http://127.0.0.1:11434` !*

### 2. Sur PC Windows (x86_64 / AMD64)
* **Processeur :** x86_64 avec instructions vectorielles AVX2 / AVX-512
* **Accélération :** NVIDIA CUDA / Vulkan
* **Binaire adapté :** `ollama-windows-amd64.exe`
* **Démarrage sur PC partagé avec le Smartphone en WiFi :**
  ```cmd
  set OLLAMA_HOST=0.0.0.0
  set OLLAMA_ORIGINS=*
  ollama serve
  ```
  *Dans la PWA sur le S25 Ultra, entrez `http://192.168.1.X:11434` (IP locale de votre PC).*

---

## 📱 Points forts pour Android (Galaxy S25 Ultra)

1. **Installation native (PWA WebAPK)** :
   * Ouvrez l'application dans Chrome ou Samsung Internet.
   * Cliquez sur le bouton **« 📲 Installer »** ou via le menu du navigateur : **« Ajouter à l'écran d'accueil »**.
   * L'application s'ouvre en **plein écran**, avec son icône d'application dédiée, sans barre d'URL.
2. **Fonctionnement 100% Hors-Ligne (Offline-First)** :
   * L'application est mise en cache localement par le **Service Worker (`sw.js` v2.0)** avec stratégie Cache-First pour les données.
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
├── index.html                  # Interface utilisateur PWA et dialogues de stockage
├── manifest.webmanifest        # Manifeste PWA Android
├── sw.js                       # Service Worker v2.0 (Cache-First Offline)
├── server.py                   # Serveur local de distribution (MIME types & IP LAN)
├── start.bat                   # Lanceur rapide Windows
├── css/
│   └── styles.css              # Thème AMOLED, barre de quota, jauges et cartes
├── js/
│   ├── app.js                  # Contrôleur général et gestionnaire du cycle de vie
│   ├── api.js                  # Client API HTTP (Ollama & OpenAI) avec streaming
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
