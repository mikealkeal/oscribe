# Tests OSbot

Tests de validation et exemples d'utilisation.

## Tests de Validation

### test-mcp-tools.js
Vérifie que les MCP tools sont correctement configurés.

```bash
node tests/test-mcp-tools.js
```

**Vérifie:**
- ✅ `os_click` avec paramètre `target` (vision-based)
- ✅ `os_click_at` pour coordonnées exactes
- ✅ `os_locate` pour localisation
- ✅ Import de `locateElement`
- ✅ Handlers utilisent vision

**Résultat attendu:** 6/6 tests passed

---

### test-session-recorder.js
Test basique du SessionRecorder sans automation réelle.

```bash
node tests/test-session-recorder.js
```

**Teste:**
- Création de session
- Enregistrement d'actions (succès/erreur)
- Sauvegarde de screenshots
- Génération de rapport Markdown

**Résultat:** Session créée dans `~/.osbot/sessions/`

---

## Tests d'Intégration

### test-automation-brave-focus.js
Test complet d'automation avec SessionRecorder.

```bash
node tests/test-automation-brave-focus.js
```

**Scénario:**
1. Focus sur Brave
2. Nouvel onglet (Ctrl+T)
3. Taper "google.com"
4. Enter
5. Screenshots à chaque étape

**Résultat:** Session enregistrée avec rapport + screenshots

---

### test-session-custom-dir.js
Vérifie que `sessionDir` configurable fonctionne.

```bash
node tests/test-session-custom-dir.js
```

**Teste:**
- Configuration de `sessionDir` custom
- Création de session dans dossier custom
- Restauration de config

**Résultat:** Session créée dans `./test-sessions/`

---

## Utilisation

### Avant de lancer les tests

```bash
# Build le projet
npm run build
```

### Lancer tous les tests

```bash
# Validation rapide
node tests/test-mcp-tools.js

# Test SessionRecorder
node tests/test-session-recorder.js

# Test automation complet (nécessite Brave ouvert)
node tests/test-automation-brave-focus.js

# Test config custom
node tests/test-session-custom-dir.js
```

---

## Notes

- Les tests d'automation (`test-automation-*`) utilisent robotjs
- Les sessions de test sont créées dans `~/.osbot/sessions/`
- Les tests de validation ne nécessitent pas d'authentification
- Les tests d'automation nécessitent que les applications soient disponibles
