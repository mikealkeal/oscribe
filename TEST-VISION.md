# Test Manual - Vision-Based Click

## Prérequis

1. Authentification configurée:
```bash
osbot login --key sk-ant-xxx
# OU
osbot login  # OAuth avec Claude Max/Pro
```

2. Build à jour:
```bash
npm run build
```

## Test 1: CLI `osbot click`

### Ouvrir une application avec des boutons visibles

Par exemple, ouvre Notepad:
```bash
notepad
```

### Tester le click vision-based

```bash
# Test avec dry-run (ne clique pas)
osbot click "Close button" --dry-run --verbose

# Test réel
osbot click "File menu"
```

**Résultat attendu:**
```
✔ Found "File menu" at (123, 45)
Confidence: 95%
Clicked!
```

## Test 2: MCP Server avec Claude Desktop

### 1. Configurer MCP

Ajoute à `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "osbot": {
      "command": "C:\\Users\\Mickael\\Desktop\\BOT\\osbot\\dist\\bin\\osbot.js",
      "args": ["serve"]
    }
  }
}
```

### 2. Redémarrer Claude Desktop

### 3. Tester les tools

Dans Claude Desktop, demande:

**Test os_click:**
> "Use osbot to take a screenshot and click on the Start menu"

**Test os_locate:**
> "Use osbot to find the coordinates of the taskbar clock"

**Test os_click_at (fallback):**
> "Use osbot to click at coordinates 100, 100"

## Test 3: Vérifier la confidence

Les résultats doivent afficher un pourcentage de confiance correct, pas 0%:

```
✅ Found "Submit button" at (456, 789) with 87% confidence.
❌ Found "Submit button" at (456, 789) with 0% confidence.  # BUG FIXÉ
```

## Test 4: Multi-écran

Si tu as plusieurs écrans:

```bash
# Lister les écrans
osbot screenshot --list

# Click sur écran secondaire
osbot click "Browser tab" --screen 1
```

## Résultats des Tests

### ✅ Tests Automatiques

- [x] Build sans erreurs
- [x] Lint sans erreurs
- [x] MCP tools correctement configurés (test-mcp-tools.js)
- [x] CLI commandes disponibles
- [x] Screenshot fonctionne
- [x] MCP server démarre

### 🔄 Tests Manuels (Nécessitent authentification)

- [ ] `osbot click "target"` trouve et clique
- [ ] Confidence affichée correctement (pas 0%)
- [ ] MCP `os_click` avec target fonctionne
- [ ] MCP `os_locate` retourne coordonnées
- [ ] MCP `os_click_at` fallback fonctionne
- [ ] Multi-écran fonctionne

## Notes

- **Sans authentification**: Les commandes screenshot, windows, type, hotkey fonctionnent
- **Avec authentification**: Les commandes vision-based (click, describe) fonctionnent
- **Dry-run mode**: Permet de tester sans exécuter réellement

## Debugging

Si ça ne marche pas:

```bash
# Verbose mode
osbot click "target" --verbose

# Check logs
node dist/bin/osbot.js click "target" 2>&1 | tee debug.log

# Test screenshot first
osbot screenshot --describe
```
