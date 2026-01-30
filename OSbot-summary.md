# OSbot - Résumé Projet

> "Si tu peux le voir, OSbot peut cliquer dessus."

---

## 🎯 Positionnement

OSbot est le **fallback universel** pour l'automation desktop.

```
Écosystème automation
│
├── APIs disponibles      → ClawdBot, n8n, Zapier
├── UI Automation marche  → UiPath, Power Automate
│
└── RIEN ne marche        → OSbot ✅
```

### Ce qu'OSbot fait

- Contrôle **n'importe quelle app** via vision (screenshot + VLM)
- Fonctionne même sur les apps legacy, custom, "fermées"
- S'intègre comme **MCP server** dans les agents existants (ClawdBot, Claude Code, etc.)

### Ce qu'OSbot ne fait PAS

- Pas d'APIs (d'autres le font mieux)
- Pas de UI Automation (volontaire - on reste focused)
- Pas un agent complet (on est un outil, pas un orchestrateur)
- **Pas d'UI graphique** (c'est un moteur CLI/MCP)

### Vision produit

```
Phase 1 : OSbot (moteur)     → CLI + MCP server, pour devs/agents
Phase 2 : OSbot Studio       → UI graphique, pour non-devs (futur)
```

---

## 🏆 Avantage concurrentiel

| Concurrent | Approche | Limite |
|------------|----------|--------|
| UiPath / Power Automate | UI Automation (DOM-like) | Échoue si l'app n'expose pas ses éléments |
| ClawdBot | API / CLI / CDP | Échoue si pas d'API disponible |
| **OSbot** | **Vision + Input simulation** | **Marche sur tout ce qui s'affiche** |

### Pourquoi vision-based gagne

- **Résilient** : pas de sélecteurs qui cassent quand l'UI change
- **Universel** : marche sur apps legacy, custom, jeux, tout
- **Simple** : "clique sur le bouton bleu" vs "//button[@id='submit-form-v2']"

---

## 💰 Business Model

### License : BSL (Business Source License)

```
✅ GRATUIT pour :
   - Usage personnel
   - Projets open-source  
   - Évaluation / testing
   - Éducation / recherche

💰 LICENSE PAYANTE pour :
   - Usage commercial
   - Intégration dans un produit vendu
   - Usage en entreprise (>1 user)

⏰ Après 4 ans : conversion automatique en MIT
```

### Pourquoi BSL

- Code visible = confiance, contributions, auditable
- Protection contre fork commercial par les gros
- Revenus via licenses entreprise
- Modèle prouvé (Sentry, MariaDB, Airbyte, HashiCorp)

### Pricing suggéré (à valider)

| Tier | Prix | Cible |
|------|------|-------|
| Personal | Gratuit | Devs, side projects |
| Pro | $29/mois | Freelances, petites équipes |
| Enterprise | $299/mois | Entreprises, support inclus |

---

## 🔧 Stack Technique

```
OSbot (Node.js pur)
├── screenshot-desktop    → Capture écran (npm)
├── nut.js               → Contrôle souris/clavier
├── Claude Vision API     → Analyse screenshot → coordonnées
├── MCP Server           → Interface pour agents externes
└── pkg                  → Packaging en binaire unique
```

### Pourquoi Node.js pur (pas Electron)

| Option | Taille | Raison |
|--------|--------|--------|
| Electron | ~150MB | Overkill, embarque Chromium pour rien |
| **Node.js pur** | **~50MB** | **Léger, CLI/daemon, pas besoin d'UI** |
| Tauri | ~10MB | Pour OSbot Studio (futur, avec UI) |

### Pourquoi ces choix

| Composant | Choix | Raison |
|-----------|-------|--------|
| Runtime | Node.js | Simple, vibe-codable, écosystème npm |
| Screenshot | screenshot-desktop | Simple, 1 ligne, fiable |
| Input | nut.js | Actif, cross-platform, bien maintenu |
| Vision | Claude API | Précis, computer-use optimisé |
| Interface | MCP | Standard Anthropic, intégration agents |
| Packaging | pkg | Binaire unique sans Node installé |

### Pas de VLM local (pour l'instant)

- Les 7B sont pas assez précis pour du clic UI
- Le 72B demande une machine à $10k
- Cloud API = ~$0.01-0.03/action (acceptable)
- Option locale possible plus tard quand les modèles s'améliorent

---

## 📁 Structure du Projet

```
osbot/
├── bin/
│   └── osbot.js              # CLI entry point
├── src/
│   ├── core/
│   │   ├── screenshot.js     # Capture écran
│   │   ├── vision.js         # Claude API
│   │   ├── input.js          # nut.js wrapper (click, type, scroll)
│   │   ├── windows.js        # Gestion fenêtres (list, focus)
│   │   └── actions.js        # Actions haut niveau
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── init.js
│   │   │   ├── auth.js
│   │   │   ├── windows.js
│   │   │   ├── focus.js
│   │   │   ├── click.js
│   │   │   ├── type.js
│   │   │   ├── screenshot.js
│   │   │   ├── serve.js
│   │   │   ├── run.js
│   │   │   └── repl.js
│   │   └── index.js
│   ├── mcp/
│   │   └── server.js         # MCP server
│   └── config/
│       └── index.js          # Gestion config
├── package.json
├── LICENSE                   # BSL 1.1
└── README.md
```

---

## 💻 Interface CLI

### Installation & Setup

```bash
# Installation globale
npm install -g osbot

# Setup initial (crée ~/.osbot/config.json)
osbot init

# Configure API key Claude
osbot auth
```

### Commandes principales

| Commande | Description |
|----------|-------------|
| `osbot init` | Setup initial |
| `osbot auth` | Configure API key |
| `osbot windows` | Liste les fenêtres ouvertes |
| `osbot focus "Figma"` | Met une fenêtre au premier plan |
| `osbot click "target"` | Clic sur élément (écran entier) |
| `osbot click "target" --window "Figma"` | Clic dans une fenêtre spécifique |
| `osbot type "text"` | Saisir du texte |
| `osbot hotkey "cmd+s"` | Raccourci clavier |
| `osbot scroll up/down 500` | Scroll |
| `osbot screenshot` | Capture écran entier |
| `osbot screenshot --window "Figma"` | Capture une fenêtre spécifique |
| `osbot screenshot --describe` | Capture + décrit contenu |
| `osbot serve --port 3333` | Lance MCP server |
| `osbot run script.osbot` | Exécute un script |
| `osbot repl` | Mode interactif debug |
| `osbot test` | Tests automatisés |

### Gestion des fenêtres

```bash
# Lister toutes les fenêtres ouvertes
osbot windows
# → 1. Figma - Homepage.fig
# → 2. Google Chrome - Claude
# → 3. Terminal - osbot
# → 4. Finder

# Mettre une fenêtre au premier plan
osbot focus "Figma"

# Travailler dans une fenêtre spécifique
osbot click "Export button" --window "Figma"
osbot screenshot --window "Chrome"
```

### Exemples d'utilisation

```bash
# Test simple : cliquer sur un bouton (écran entier)
osbot click "the blue Submit button"

# Cliquer dans une fenêtre spécifique
osbot click "Export" --window "Figma"

# Saisir du texte
osbot type "hello@example.com"

# Screenshot + description (debug)
osbot screenshot --describe
# → "Je vois une fenêtre Figma avec un artboard 'Homepage'..."

# Screenshot d'une fenêtre spécifique
osbot screenshot --window "Figma" --describe

# Mode interactif (REPL)
osbot repl
> windows
📋 Open windows:
   1. Figma - Homepage.fig
   2. Google Chrome - Claude
   3. Terminal
> focus "Figma"
✓ Focused: Figma - Homepage.fig
> screenshot
📸 Saved to /tmp/osbot-screenshot.png
> find "Submit button"
🎯 Found at {x: 450, y: 320, confidence: 0.94}
> click
✓ Clicked at {x: 450, y: 320}
> exit
```

### Scripts (.osbot files)

```bash
# Fichier : export-figma.osbot

# Cibler la fenêtre Figma
window "Figma"

# Actions
click "File menu"
wait 500
click "Export"
click "PNG"
type "/Users/me/export.png"
click "Save"

# Exécuter
osbot run export-figma.osbot
```

---

## ⚙️ Configuration

Fichier : `~/.osbot/config.json`

```json
{
  "anthropic_api_key": "sk-ant-...",
  "model": "claude-sonnet-4-20250514",
  "default_timeout": 5000,
  "screenshot_quality": 80,
  "debug": false,
  "log_level": "info",
  "mcp_port": 3333,
  
  "window": {
    "default": null,           // null = écran entier, ou "Figma"
    "auto_focus": true,        // Focus la fenêtre avant action
    "screenshot_mode": "screen" // "screen" = écran entier, "window" = fenêtre seule
  }
}
```

---

## 🧪 Modes de Test

### 1. Test CLI (manuel)

```bash
# Teste un clic en live
osbot click "Submit button"
```

### 2. Test unitaire (sans écran)

```bash
# Vérifie que Claude parse bien les coordonnées
osbot test vision
```

### 3. Test intégration (avec écran)

```bash
# Ouvre une fenêtre test et vérifie le flow complet
osbot test click

# Résultat :
# ✓ Screenshot captured (1920x1080)
# ✓ Claude found element at {x: 450, y: 320}
# ✓ Click executed
# ✓ Verification screenshot OK
```

### 4. Mode REPL (debug interactif)

```bash
osbot repl
# Permet de tester commande par commande
```

---

## 🔄 Flow Technique

### Flow standard (écran entier)

```
1. Agent (ClawdBot, etc.) appelle OSbot via MCP
   └── "Clique sur le bouton Submit"

2. OSbot capture screenshot écran entier
   └── screenshot-desktop → PNG base64

3. Envoi à Claude Vision
   └── "Trouve 'bouton Submit' → retourne {x, y}"

4. Claude retourne coordonnées
   └── { x: 450, y: 320, confidence: 0.95 }

5. OSbot exécute l'action
   └── nut.js → mouse.click(450, 320)

6. (Optionnel) Screenshot de vérification

7. Retour à l'agent
   └── "Done" ou "Error: element not found"
```

### Flow avec fenêtre ciblée

```
1. Agent appelle OSbot
   └── "Clique sur Export dans Figma"

2. OSbot trouve la fenêtre
   └── nut.js getWindows() → find "Figma"

3. Focus la fenêtre
   └── nut.js focusWindow(figma)

4. Screenshot (fenêtre au premier plan)
   └── screenshot-desktop → PNG base64

5. Envoi à Claude Vision
   └── "Trouve 'Export'" → {x, y}

6. Clic aux coordonnées
   └── mouse.click(x, y)

7. Retour à l'agent
   └── "Done"
```

---

## 🛡️ Sécurité & Permissions

### Permissions OS requises

| OS | Permission | Comment |
|----|------------|---------|
| macOS | Accessibility | User autorise manuellement dans System Preferences |
| Windows | Généralement OK | Parfois UAC pour apps protégées |
| Linux | X11 OK | Wayland plus restrictif |

### Points clés

- **L'user doit consentir explicitement** (pas de contrôle caché)
- App doit être **signée** (Apple Developer Certificate)
- Code **auditable** (source-available)
- Même modèle que UiPath, Keyboard Maestro, Alfred

---

## 📊 Marché

### Taille du marché RPA

- **$28B en 2025** → **$247B en 2035**
- CAGR de 24%
- Segments clés : BFSI (29%), Healthcare (croissance la plus rapide)

### Pain points actuels (UiPath, etc.)

| Problème | Impact |
|----------|--------|
| Prix élevé | PME exclues |
| Setup complexe | Besoin d'experts RPA |
| Bots fragiles | Cassent quand l'UI change |
| Apps "fermées" | UI Automation échoue |

### Opportunité OSbot

- **Prix accessible** : open-source + license abordable
- **Simple** : natural language, pas de code
- **Résilient** : vision-based vs DOM selectors
- **Universel** : marche où les autres échouent

---

## 🗺️ Roadmap

### Phase 1 : MVP Core (2-3 semaines)

- [ ] Setup projet Node.js + structure
- [ ] Core : screenshot-desktop intégration
- [ ] Core : nut.js wrapper (click, type, scroll, hotkey)
- [ ] Core : Claude Vision API (screenshot → coordonnées)
- [ ] CLI : commandes de base (click, type, screenshot)
- [ ] CLI : mode REPL pour debug
- [ ] Config : gestion ~/.osbot/config.json
- [ ] Test : permissions macOS/Windows

### Phase 2 : MCP + Validation (2-3 semaines)

- [ ] MCP server avec tools de base
- [ ] Test intégration avec ClawdBot
- [ ] Scripts .osbot (workflows simples)
- [ ] Documentation README
- [ ] Post sur Discord ClawdBot, r/RPA
- [ ] Feedback early adopters

### Phase 3 : Launch Public (2-4 semaines)

- [ ] Repo public (BSL license)
- [ ] Packaging binaire (pkg)
- [ ] Landing page osbot.dev
- [ ] npm publish
- [ ] Pricing / license commerciale
- [ ] Support communauté

### Phase 4 : OSbot Studio (futur)

- [ ] UI graphique (Tauri)
- [ ] Enregistrement visuel de workflows
- [ ] Marketplace de scripts
- [ ] Multi-provider VLM (GPT-4o, Gemini)
- [ ] VLM local (quand viable)

---

## 📝 MCP Server - Tools API

```json
{
  "tools": [
    {
      "name": "os_windows",
      "description": "List all open windows"
    },
    {
      "name": "os_focus",
      "description": "Focus a window by name",
      "params": {
        "window": "string (ex: 'Figma')"
      }
    },
    {
      "name": "os_screenshot",
      "description": "Capture screenshot and describe what's visible",
      "params": {
        "window": "string (optional - specific window)",
        "describe": "boolean (optional - ask Claude to describe)"
      }
    },
    {
      "name": "os_click", 
      "description": "Click on element described in natural language",
      "params": { 
        "target": "string (ex: 'the blue Submit button')",
        "window": "string (optional - specific window)"
      }
    },
    {
      "name": "os_type",
      "description": "Type text at current cursor position",
      "params": { 
        "text": "string" 
      }
    },
    {
      "name": "os_scroll",
      "description": "Scroll in a direction",
      "params": { 
        "direction": "up | down | left | right",
        "amount": "number (pixels)"
      }
    },
    {
      "name": "os_hotkey",
      "description": "Press keyboard shortcut",
      "params": {
        "keys": "string (ex: 'ctrl+c', 'cmd+shift+s')"
      }
    }
  ]
}
```

---

## 🔗 Intégration ClawdBot

OSbot devient un **skill** que ClawdBot appelle quand il n'a pas d'autre option :

```
User : "Exporte l'artboard Figma en PNG"

ClawdBot :
├── Check skill Figma API ? → Non
├── Check CLI ? → Non  
├── Fallback OSbot ✅
    ↓
OSbot :
├── Screenshot
├── "Trouve menu File" → clic
├── "Trouve Export" → clic
├── "Trouve PNG option" → clic
├── "Trouve Save" → clic
    ↓
ClawdBot : "C'est fait !"
```

---

## ✅ Checklist avant de coder

- [ ] Vérifier dispo nom "OSbot" (domaine, npm, GitHub)
- [ ] Créer repo privé GitHub
- [ ] `npm init` + structure dossiers
- [ ] Installer deps : screenshot-desktop, nut.js, @anthropic-ai/sdk, commander
- [ ] Tester nut.js + permissions macOS (Accessibility)
- [ ] Tester screenshot-desktop
- [ ] Tester Claude Vision API avec un screenshot
- [ ] Assembler le flow complet : screenshot → Claude → click
- [ ] Première commande CLI : `osbot click "target"`

---

## 📚 Références

- [nut.js](https://github.com/nut-tree/nut.js) - Input automation
- [screenshot-desktop](https://www.npmjs.com/package/screenshot-desktop) - Screen capture
- [commander.js](https://github.com/tj/commander.js) - CLI framework
- [pkg](https://github.com/vercel/pkg) - Packaging Node.js en binaire
- [MCP Specification](https://modelcontextprotocol.io/) - Protocol Anthropic
- [ClawdBot/Moltbot](https://github.com/moltbot/moltbot) - Agent de référence
- [BSL License](https://mariadb.com/bsl11/) - Business Source License

---

## 🎯 Résumé en une phrase

**OSbot = moteur CLI/MCP qui permet à n'importe quel agent de contrôler n'importe quelle app desktop via vision, sans dépendre d'APIs ou d'UI Automation.**

---

*Document généré le 30/01/2026*
