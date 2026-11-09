# 🛡️ Survival LLM • PWA Standalone Android & PC

Version **Progressive Web App (PWA)** autonome en pur JavaScript/HTML5/CSS3 de **Survival LLM**.

Au lieu de dépendre d'un binaire C++ compilé (`llama.cpp` / NDK), cette application fonctionne **dans n'importe quel navigateur moderne (Chrome, Samsung Internet, Edge, Firefox)** et se connecte via des **requêtes API HTTP en streaming (`fetch`)** à votre moteur LLM local préféré :
* **Ollama sur PC Windows** (accessible sur le réseau WiFi local)
* **Ollama local sur Android (via Termux)** sur smartphone (ex: Samsung Galaxy S25 Ultra avec Snapdragon 8 Elite)
* **Edge Gallery / PocketPal AI / LocalAI / MLC LLM** sur Android (API compatible OpenAI).

---

## 📱 Points forts pour Android (Galaxy S25 Ultra)

1. **Installation native (PWA WebAPK)** :
   * Ouvrez l'application dans Chrome ou Samsung Internet.
   * Cliquez sur le bouton **« 📲 Installer l'App »** ou via le menu du navigateur : **« Ajouter à l'écran d'accueil »**.
   * L'application s'ouvre en **plein écran**, avec son icône d'application dédiée, sans barre d'URL.
2. **Fonctionnement 100% Hors-Ligne (Offline-First)** :
   * L'application est mise en cache localement par le **Service Worker (`sw.js`)**.
   * **670 guides de survie traduits en français** (SERE, FEMA, TCCC, secourisme militaire, hygiène, conserves sûres USDA, WikiCiv) sont stockés dans la base locale (`IndexedDB`).
   * **8 fiches réflexes d'urgence vitale** (Garrot tourniquet, arrêt cardiaque RCR, étouffement Heimlich, purification d'eau, hypothermie, feu, brûlures, retombées CBRN) sont accessibles instantanément sans réseau ni modèle IA.
3. **Moteur RAG Hybride Local** :
   * Lorsque vous posez une question dans le Chat, l'application recherche automatiquement les extraits les plus pertinents dans les guides de survie hors-ligne et les injecte dans le prompt envoyé au LLM local.
4. **Interface AMOLED Ultra-Économe** :
   * Thème sombre noir profond spécialement conçu pour préserver la batterie des écrans AMOLED en situation de survie ou de coupure électrique.

---

## 🚀 Démarrage Rapide

### 1. Lancer le serveur local sur PC

Double-cliquez sur :
```bat
start.bat
```
Ou en ligne de commande :
```bash
python server.py
```
Le terminal affichera :
* L'URL pour votre PC : `http://localhost:8000`
* L'URL pour votre smartphone Android sur le même WiFi : `http://192.168.1.X:8000`

---

## ⚙️ Configuration du Moteur LLM

Rendez-vous dans l'onglet **⚙️ Réglages** de l'application :

### Cas 1 : Ollama tourne sur votre PC Windows (interrogé depuis votre smartphone)
Par défaut, Ollama écoute uniquement sur `127.0.0.1` (ce qui bloque les connexions venant du smartphone). Pour autoriser votre Galaxy S25 Ultra :
1. Fermez Ollama dans la barre des tâches Windows.
2. Ouvrez une invite de commandes Windows (`cmd`) et tapez :
   ```cmd
   set OLLAMA_HOST=0.0.0.0
   set OLLAMA_ORIGINS=*
   ollama serve
   ```
3. Dans la PWA sur votre smartphone, entrez l'adresse IP de votre PC :
   * **URL API** : `http://192.168.1.50:11434` *(remplacez par l'IP de votre PC affichée par server.py)*
   * **Protocole** : `Ollama (/api/chat, /api/tags)`
4. Cliquez sur **« 🔄 Tester la connexion & lister les modèles »** puis **« 💾 Enregistrer »**.

---

### Cas 2 : Ollama tourne directement sur votre Samsung Galaxy S25 Ultra (100% autonome)
Grâce à la puissance du processeur **Snapdragon 8 Elite** et des 12/16 Go de RAM du S25 Ultra, vous pouvez faire tourner Ollama directement sur votre téléphone via **Termux** :
1. Installez **Termux** sur votre smartphone (depuis F-Droid ou GitHub).
2. Dans Termux, installez Ollama :
   ```bash
   pkg update && pkg install ollama
   ```
3. Lancez le serveur Ollama en arrière-plan :
   ```bash
   ollama serve &
   ```
4. Téléchargez un modèle compact et ultra-rapide (3B recommandé) :
   ```bash
   ollama run llama3.2:3b
   ```
5. Dans la PWA sur votre smartphone, sélectionnez le préréglage :
   * **URL API** : `http://127.0.0.1:11434`
   * **Protocole** : `Ollama`

---

### Cas 3 : Edge Gallery / PocketPal AI / LocalAI sur Android
Si vous utilisez une application Android dédiée qui héberge un modèle GGUF local :
* **Edge Gallery** ou **PocketPal AI** : activez l'option *« Local API Server »*.
* Dans la PWA :
  * **URL API** : `http://127.0.0.1:8080` (ou port indiqué par l'app)
  * **Protocole** : `OpenAI Compatible (/v1/chat/completions)`

---

## 📁 Structure du Projet

```
js pwa standealone/
├── index.html                  # Interface utilisateur mobile PWA
├── manifest.webmanifest        # Manifeste PWA Android
├── sw.js                       # Service Worker pour fonctionnement 100% offline
├── server.py                   # Serveur de distribution local (MIME types & IP LAN)
├── start.bat                   # Lanceur rapide Windows
├── css/
│   └── styles.css              # Thème AMOLED responsive et styles Markdown
├── js/
│   ├── app.js                  # Contrôleur général de l'application
│   ├── api.js                  # Client API HTTP (Ollama & OpenAI) avec streaming
│   ├── db.js                   # Gestionnaire IndexedDB et recherche hors-ligne
│   ├── emergency.js            # Gestionnaire des fiches réflexes d'urgence
│   ├── rag.js                  # Moteur RAG d'injection de contexte local
│   └── markdown.js             # Moteur de rendu Markdown ultra-léger
├── data/
│   ├── emergency_protocols.json # Protocoles vitaux immédiats
│   ├── guides_index.json       # Index des 670 guides de survie en français
│   ├── guides_survival.json    # Manuels SERE & plans de catastrophe FEMA
│   ├── guides_medical.json     # Secourisme & médecine tactique de combat TCCC
│   ├── guides_food.json        # Eau potable & conserves sécurisées USDA
│   └── guides_tech.json        # WikiCiv : reconstruction des technologies vitales
└── icons/
    ├── icon.svg                # Logo vectoriel haute fidélité
    ├── icon-192.png            # Icône écran d'accueil Android 192x192
    └── icon-512.png            # Icône splash screen Android 512x512
```

---

## 🛡️ Sécurité & Modern Web Standards (LNA)
L'application intègre le standard moderne **Local Network Access (LNA)** (`targetAddressSpace: 'loopback'` / `'local'`), garantissant que les navigateurs basés sur Chromium récents (Chrome 145+) ne bloquent pas les requêtes locales vers votre machine ou loopback sans avertissement clair.
