# Test CLI Smart Click

Test manuel du feedback loop via la ligne de commande.

## Prérequis

1. Build le projet: `npm run build`
2. Application ouverte (Brave, Notepad, etc.)
3. Auth configurée (CLAUDE_CODE_OAUTH_TOKEN ou API key)

## Tests

### Test 1: Smart Click avec vérification (défaut)

```bash
# Click avec feedback loop activé (défaut)
node dist/bin/osbot.js click "address bar" --verbose

# Attendu:
# [Attempt 1/3] Looking for "address bar"...
# Found at (450, 120) with 95% confidence
# ✓ Action verified successfully
# ✓ Clicked "address bar" at (450, 120) after 1 attempt(s)
```

### Test 2: Smart Click sans vérification (mode rapide)

```bash
# Click simple sans feedback loop
node dist/bin/osbot.js click "address bar" --no-verify

# Attendu:
# ✓ Found "address bar" at (450, 120)
# Confidence: 95%
# Clicked!
```

### Test 3: Retry intelligent

```bash
# Click sur élément qui peut nécessiter plusieurs tentatives
node dist/bin/osbot.js click "Submit button" --max-attempts 5 --verbose

# Attendu (si échec à la 1ère tentative):
# [Attempt 1/5] Looking for "Submit button"...
# Found at (300, 400) with 85% confidence
# ✗ Verification failed, retrying...
# [Attempt 2/5] Looking for "Submit button"...
# Found at (305, 402) with 90% confidence
# ✓ Action verified successfully
# ✓ Clicked "Submit button" at (305, 402) after 2 attempt(s)
```

### Test 4: Dry Run avec Smart Click

```bash
# Dry run désactive automatiquement la vérification
node dist/bin/osbot.js click "File menu" --dry-run

# Attendu:
# ✓ Found "File menu" at (50, 30)
# [DRY RUN] Would click at (50, 30)
```

## Comparaison

| Mode | Commande | Vérification | Retry | Tokens |
|------|----------|--------------|-------|--------|
| **Smart** | `osbot click "target"` | ✅ | ✅ | ~2× (before + after) |
| **Simple** | `osbot click "target" --no-verify` | ❌ | ❌ | ~1× (before only) |
| **Dry Run** | `osbot click "target" --dry-run` | ❌ | ❌ | ~1× (before only) |

## Configuration

Dans `~/.osbot/config.json`:

```json
{
  "maxAttempts": 3,
  "verifyDelay": 800
}
```

- `maxAttempts`: Nombre max de tentatives (1-10, défaut: 3)
- `verifyDelay`: Délai en ms avant vérification (0-5000, défaut: 800)

## Notes

- Le feedback loop **double les tokens** (2 screenshots au lieu de 1)
- Mais augmente la **fiabilité** des actions
- Utilisez `--no-verify` pour économiser si l'action est simple
- Le retry intelligent permet de gérer les éléments difficiles à cliquer
