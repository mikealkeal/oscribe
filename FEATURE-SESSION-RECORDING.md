# Feature: Session Recording

## Concept

Enregistrer automatiquement toutes les actions OSbot dans une session avec:
- ✅ Demande initiale (goal)
- ✅ Actions effectuées (succès/erreur)
- ✅ Screenshots à chaque étape
- ✅ Rapport Markdown généré

## Structure

```
~/.osbot/sessions/
└── 2026-01-30_14-30-45_a8f3c2/
    ├── session.json           # Raw data
    ├── REPORT.md              # Human-readable report
    └── screenshots/
        ├── 1_open-brave.png
        ├── 2_new-tab.png
        └── 3_google.png
```

## Utilisation

### CLI avec --record

```bash
# Start recorded session
osbot --record "Ouvrir Brave et aller sur Google" \
  click "Brave icon" && \
  hotkey "ctrl+t" && \
  type "google.com" && \
  hotkey "enter"

# Session saved to: ~/.osbot/sessions/2026-01-30_14-30-45_a8f3c2/
```

### API Usage

```typescript
import { SessionRecorder } from './core/session-recorder.js';

const recorder = new SessionRecorder("Ouvrir Brave et aller sur Google");

// Record click action
await recorder.recordAction(
  'click',
  { target: 'Brave icon' },
  async () => {
    const screenshot = await captureScreen();
    recorder.saveScreenshot(screenshot.base64, 'before-click');

    const coords = await locateElement('Brave icon', screenshot.base64);
    await click(coords.x, coords.y);

    const after = await captureScreen();
    recorder.saveScreenshot(after.base64, 'after-click');

    return coords;
  }
);

// Record type action
await recorder.recordAction(
  'type',
  { text: 'google.com' },
  async () => {
    await typeText('google.com');
  }
);

// End session and generate report
recorder.endSession();

console.log(`Session saved: ${recorder.getSessionDir()}`);
```

## Rapport Généré (REPORT.md)

```markdown
# Session Report

**Session ID:** 2026-01-30_14-30-45_a8f3c2

**Start:** 2026-01-30T14:30:45.123Z
**End:** 2026-01-30T14:31:12.456Z
**Duration:** 27.33s

---

## Initial Request

> Ouvrir Brave et aller sur Google

---

## Summary

- ✅ Success: 4
- ❌ Errors: 0
- 📸 Screenshots: 8

---

## Actions Timeline

### 1. ✅ click

**Time:** 14:30:45 | **Duration:** 1234ms

**Parameters:**
\`\`\`json
{
  "target": "Brave icon"
}
\`\`\`

**Screenshot:** [1_before-click.png](screenshots/1_before-click.png)

![Screenshot](screenshots/1_before-click.png)

---

### 2. ✅ type

**Time:** 14:30:48 | **Duration:** 234ms

**Parameters:**
\`\`\`json
{
  "text": "google.com"
}
\`\`\`

---
```

## Intégration dans MCP

```typescript
// src/mcp/server.ts

import { SessionRecorder } from '../core/session-recorder.js';

// Global recorder (or per-client)
let currentSession: SessionRecorder | null = null;

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Auto-start session on first action
  if (!currentSession) {
    currentSession = new SessionRecorder(`MCP Session ${new Date().toISOString()}`);
  }

  try {
    switch (name) {
      case 'os_click': {
        return await currentSession.recordAction(
          'os_click',
          args as Record<string, unknown>,
          async () => {
            const { target, screen, window: windowName } = ClickSchema.parse(args);

            if (windowName) {
              await focusWindow(windowName);
            }

            const screenshot = await captureScreen({ screen });
            currentSession!.saveScreenshot(screenshot.base64, `before-click-${target}`);

            const coords = await locateElement(target, screenshot.base64);
            await click(coords.x, coords.y);

            const after = await captureScreen({ screen });
            currentSession!.saveScreenshot(after.base64, `after-click-${target}`);

            return {
              content: [
                {
                  type: 'text',
                  text: `Found "${target}" at (${coords.x}, ${coords.y}) with ${((coords.confidence ?? 0) * 100).toFixed(0)}% confidence. Clicked successfully.`,
                },
              ],
            };
          }
        );
      }

      // ... autres tools
    }
  } catch (error) {
    // Error is already logged by recordAction
    throw error;
  }
});
```

## CLI Option

Ajouter l'option `--record` au CLI:

```typescript
// bin/osbot.ts

program
  .option('--record <description>', 'Record session with description')
  .hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();
    if (options.record) {
      // Start global session recorder
      global.sessionRecorder = new SessionRecorder(options.record);
    }
  })
  .hook('postAction', () => {
    if (global.sessionRecorder) {
      global.sessionRecorder.endSession();
      console.log(`\nSession saved: ${global.sessionRecorder.getSessionDir()}`);
    }
  });
```

## Avantages

1. **Debugging** - Voir exactement ce qui s'est passé
2. **Replay** - Rejouer une session pour reproduire un bug
3. **Documentation** - Générer automatiquement des guides avec screenshots
4. **Testing** - Vérifier que les actions produisent les bons résultats
5. **Analytics** - Mesurer la performance des actions

## Améliorations Futures

- [ ] Replay mode: `osbot replay <session-id>`
- [ ] Video recording (GIF animation)
- [ ] Diff screenshots pour voir les changements
- [ ] Export to test suite
- [ ] Session comparison
- [ ] Cloud storage des sessions

---

**Ready to implement!** 🎬
