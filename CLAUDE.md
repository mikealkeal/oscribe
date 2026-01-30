# CLAUDE.md - OSbot

## Projet

OSbot est un moteur d'automation desktop basé sur la vision. Il permet de contrôler n'importe quelle application via screenshot + VLM (Vision Language Model), sans dépendre d'APIs ou d'UI Automation.

**Positionnement** : Fallback universel quand les APIs et l'UI Automation ne marchent pas.

---

## Skills Installés

Ce projet utilise 14 skills dans `.agents/skills/`. **Consulter les skills avant d'implémenter** :

### Core Development
| Skill | Usage |
|-------|-------|
| `nodejs-best-practices` | Architecture layered, async patterns, validation Zod |
| `typescript-expert` | Types stricts, branded types, ESM-first, `satisfies` |
| `cross-platform-compatibility` | `path.join()`, `os.homedir()`, détection plateforme |
| `config-manager` | `.env.example`, validation Zod, 12-factor app |
| `error-handling-patterns` | Custom errors, Result types, retry + circuit breaker |

### MCP & Integration
| Skill | Usage |
|-------|-------|
| `mcp-builder` | Guide création MCP server TypeScript |
| `mcp-integration` | stdio/SSE/HTTP transports, tool naming |

### Quality & Ops
| Skill | Usage |
|-------|-------|
| `logging-best-practices` | Wide events (1 log/request), JSON structuré |
| `architecture-patterns` | Clean Architecture, Hexagonal, DDD |
| `secrets-management` | Env vars, pas de secrets dans git |
| `code-review-excellence` | Feedback constructif, checklists |

### Dev Workflow
| Skill | Usage |
|-------|-------|
| `token-efficiency` | Bash over Read, filter logs, Sonnet par défaut |
| `github-actions-templates` | Matrix builds, cache, reusable workflows |
| `crafting-effective-readmes` | Templates par type de projet |

---

## Stack Technique

- **Langage** : TypeScript (ESM, strict mode)
- **Runtime** : Node.js 22+
- **Screenshot** : screenshot-desktop
- **Input** : @nut-tree/nut-js
- **Vision** : Claude API via OAuth (Claude Max/Pro)
- **CLI** : commander + ora + chalk
- **Validation** : Zod
- **Interface** : CLI + MCP Server
- **License** : BSL 1.1

---

## Structure

```
osbot/
├── bin/
│   └── osbot.ts              # CLI entry point
├── src/
│   ├── core/
│   │   ├── screenshot.ts     # Multi-écran, DPI, base64
│   │   ├── auth.ts           # OAuth 2.0 + PKCE
│   │   ├── vision.ts         # Claude API, retry logic
│   │   ├── input.ts          # click, type, hotkey, dry-run
│   │   ├── windows.ts        # list, focus, active
│   │   └── index.ts
│   ├── cli/
│   │   ├── commands/         # init, login, click, type, etc.
│   │   └── index.ts
│   ├── mcp/
│   │   └── server.ts         # MCP stdio server
│   ├── config/
│   │   └── index.ts          # ~/.osbot/config.json
│   └── index.ts
├── package.json
├── tsconfig.json
├── LICENSE                   # BSL 1.1
└── README.md
```

---

## Guidelines (basées sur les skills)

### TypeScript (voir `typescript-expert`)
```typescript
// ESM-first
"type": "module" in package.json
"moduleResolution": "bundler" in tsconfig

// Strict mode
"strict": true, "noUncheckedIndexedAccess": true

// Branded types pour IDs
type UserId = string & { __brand: 'UserId' };

// Validation Zod
const configSchema = z.object({ ... });
```

### Cross-Platform (voir `cross-platform-compatibility`)
```typescript
// Paths
import path from 'path';
import os from 'os';
const configPath = path.join(os.homedir(), '.osbot', 'config.json');

// Platform detection
const isWindows = process.platform === 'win32';
const isMacOS = process.platform === 'darwin';
```

### Error Handling (voir `error-handling-patterns`)
```typescript
class OSBotError extends Error {
  constructor(message: string, public code: string, public statusCode = 500) {
    super(message);
    this.name = 'OSBotError';
  }
}

// Retry avec backoff
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T>
```

### Logging (voir `logging-best-practices`)
```typescript
// Wide event pattern - 1 log par opération
const event = {
  action: 'click',
  target: 'button',
  timestamp: new Date().toISOString(),
  duration_ms: 0,
  success: false
};
// ... exécution ...
event.duration_ms = Date.now() - start;
event.success = true;
logger.info(event);
```

### Config (voir `config-manager`)
```typescript
// ~/.osbot/config.json
// Validation au démarrage avec Zod
// Jamais de secrets dans le code
// .env.example documenté
```

### MCP Server (voir `mcp-builder`, `mcp-integration`)
```typescript
// TypeScript SDK recommandé
// stdio transport pour local
// Zod pour input schemas
// outputSchema pour structured responses
// Annotations: readOnlyHint, destructiveHint, etc.
```

---

## Commandes CLI

```bash
osbot init                    # Setup initial
osbot login                   # OAuth Anthropic (ouvre navigateur)
osbot click "target"          # Clic via vision
osbot type "text"             # Saisie texte
osbot screenshot [--describe] # Capture écran
osbot windows                 # Liste fenêtres
osbot focus "App"             # Focus fenêtre
osbot serve                   # Lance MCP server
```

### Options globales
- `--verbose` / `-v` : mode debug
- `--dry-run` : simulation sans exécuter
- `--quiet` / `-q` : mode silencieux
- `--screen N` : cibler un écran spécifique

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `os_click` | Clic sur élément (target, window?) |
| `os_type` | Saisie texte |
| `os_screenshot` | Capture (window?, describe?) |
| `os_windows` | Liste fenêtres |
| `os_focus` | Focus fenêtre |
| `os_scroll` | Scroll (direction, amount) |
| `os_hotkey` | Raccourci clavier |

---

## Ressources

- Plan : `C:\Users\Mickael\.claude\plans\keen-bouncing-riddle.md`
- Spec complète : `OSbot-summary.md`
- Skills : `.agents/skills/`
