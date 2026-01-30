# CLAUDE.md - OSbot

## Projet

OSbot est un moteur d'automation desktop basé sur la vision. Il permet de contrôler n'importe quelle application via screenshot + VLM (Vision Language Model), sans dépendre d'APIs ou d'UI Automation.

**Positionnement** : Fallback universel quand les APIs et l'UI Automation ne marchent pas.

## Stack Technique

- **Runtime** : Node.js pur (pas Electron)
- **Screenshot** : screenshot-desktop
- **Input** : nut.js (souris/clavier)
- **Vision** : Claude API
- **Interface** : CLI + MCP Server
- **Packaging** : pkg (binaire unique)

## Structure

```
osbot/
├── bin/osbot.js           # CLI entry point
├── src/
│   ├── core/              # screenshot, vision, input, windows, actions
│   ├── cli/commands/      # init, auth, click, type, screenshot, serve, etc.
│   ├── mcp/server.js      # MCP server
│   └── config/            # Gestion config
├── package.json
├── LICENSE                # BSL 1.1
└── README.md
```

## Commandes CLI principales

```bash
osbot init                    # Setup initial
osbot auth                    # Configure API key
osbot windows                 # Liste fenêtres
osbot focus "App"             # Focus fenêtre
osbot click "target"          # Clic via vision
osbot type "text"             # Saisie texte
osbot screenshot              # Capture écran
osbot serve                   # Lance MCP server
osbot repl                    # Mode interactif
```

## Config

Fichier : `~/.osbot/config.json`

## Conventions

- Code en anglais
- CLI en anglais avec messages utilisateur clairs
- License BSL 1.1 (gratuit perso/open-source, payant commercial)

## MCP Tools

`os_windows`, `os_focus`, `os_screenshot`, `os_click`, `os_type`, `os_scroll`, `os_hotkey`

## Ressources

- Voir `OSbot-summary.md` pour la spec complete
