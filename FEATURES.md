# Features & Ideas

Idées de fonctionnalités à implémenter dans OSbot.

---

## Performance & Optimization

### Screenshot Resolution Scaling
**Objectif:** Réduire les tokens API en diminuant la résolution envoyée à Claude.

**Implémentation:**
- Option `maxWidth` ou `scaleFactor` dans config
- Resize proportionnel (garder aspect ratio)
- Scale back des coordonnées retournées par Claude

**Exemple:**
```typescript
// Original: 1920×1080 → ~1500 tokens
// Resize: 960×540 → ~375 tokens (4× moins!)
// Claude retourne: {x: 480, y: 270}
// On clique à: {x: 960, y: 540} (× 2)
```

**Config:**
```json
{
  "maxResolution": 1920,
  "scaleForVision": 0.5
}
```

**Status:** 💡 Idée - À implémenter

---

## Monitoring & Debugging

### Lightweight Monitoring UI
**Objectif:** Voir ce que OSbot fait pendant l'automation sans casser le flow.

**Besoins:**
- Overlay léger (transparent, petit coin d'écran)
- Affiche action en cours + output
- ESC pour arrêter le recording
- Pas d'interférence avec l'automation

**Questions:**
- Intégré dans OSbot ou projet séparé?
- Electron? Terminal overlay? Web UI?

**Status:** 💡 Idée - À définir

---

## Vision & Detection

### Format d'image alternatif
**Évalué:** WebP vs PNG vs GIF

**Conclusion:**
- WebP = plus léger (25-35%) mais **même tokens** (résolution identique)
- GIF = 256 couleurs max, dégradation qualité
- PNG = safe pour UI/texte

**Décision:** Garder PNG pour l'instant, WebP si besoin d'optimiser upload.

**Status:** ⏸️ Pas prioritaire

---

## CLI Enhancements

### Commande `osbot locate`
**Status:** ✅ Implémenté

**Usage:**
```bash
osbot locate "Login button"
# → Found at (450, 320) with 95% confidence
```

---

## MCP & Integration

### Cursor Position Tracking
**Status:** ✅ Implémenté

**Problème:** L'agent ne calibrait pas ses clics car il ne voyait pas où était le curseur.

**Solution:** `os_screenshot` retourne maintenant la position du curseur avec l'image:
```
Cursor position: (450, 320)
```

L'agent peut ainsi comparer la position actuelle du curseur avec la cible et ajuster.

---

### Move + Click Séparés
**Status:** ✅ Implémenté

**Problème:** Les clics manquaient leur cible car mouvement et clic étaient combinés.

**Solution:**
- `os_click` = clic à la position actuelle (sans coordonnées)
- `os_click_at` = déplacer + cliquer (coordonnées requises)
- `os_move` = déplacer le curseur sans cliquer

**Workflow recommandé:**
1. `os_screenshot` → voir l'écran + position curseur
2. `os_move` → déplacer vers la cible
3. `os_screenshot` → vérifier le curseur est bien positionné
4. `os_click` → cliquer à la position actuelle

---

### Windows UI Automation (Accessibility Tree)
**Status:** ✅ Implémenté

**Concept:** Utiliser les APIs d'accessibilité Windows (comme les lecteurs d'écran) pour obtenir un "DOM" du desktop.

**MCP Tools:**
- `os_inspect` → liste tous les éléments interactifs de la fenêtre
- `os_inspect_at` → élément à une coordonnée précise

**Données retournées par élément:**
```typescript
{
  type: string,        // Button, Edit, Text, ComboBox, CheckBox,
                       // RadioButton, ListItem, MenuItem, TabItem,
                       // Hyperlink, Image
  name: string,        // Label visible ("Save", "Cancel", "Search...")
  automationId: string,// ID interne (stable, pour devs)
  x: number,           // Position X
  y: number,           // Position Y
  width: number,       // Largeur
  height: number,      // Hauteur
  isEnabled: boolean,  // Actif ou grisé
  value?: string       // Contenu (pour TextBox)
}
```

**Exemple de retour `os_inspect`:**
```
Window: Notepad
Elements (5):
- Edit: "Text Editor" at (450, 300) [800x400] id="Edit1"
- Button: "Save" at (100, 50) [80x30]
- Button: "Open" at (190, 50) [80x30]
- MenuItem: "File" at (30, 25) [50x25]
- MenuItem: "Edit" at (85, 25) [50x25]
```

**Avantages vs Vision seule:**
| Vision | UI Automation |
|--------|---------------|
| "Je vois un bouton bleu" | `Button name="Save" at (450, 320)` |
| Estimation de position | Coordonnées exactes |
| Peut rater du texte | Texte garanti |
| Coûte des tokens | Gratuit, instantané |

**L'agent a maintenant 3 sources:**
1. **Screenshot** → contexte visuel
2. **Cursor position** → calibration
3. **UI Tree** → données structurées (DOM du desktop)

---

### Supprimer messages d'auth inutiles
**Problème:** Erreurs auth dans contexte MCP (Claude Code) alors que ça marche.

**Solution:**
- Détecter si `CLAUDE_CODE_OAUTH_TOKEN` existe
- Pas d'erreur si token présent
- Ou commentaire moins agressif

**Status:** 🔴 Frustration utilisateur - À corriger

---

## Session Recording

### Custom Session Directory
**Status:** ✅ Implémenté (`sessionDir` dans config)

### Screenshots dans rapport
**Status:** ✅ Implémenté (REPORT.md avec screenshots)

---

## Légende

- ✅ Implémenté
- 🔴 Prioritaire / Bug
- 💡 Idée validée
- ⏸️ Pas prioritaire
- ❓ À discuter
