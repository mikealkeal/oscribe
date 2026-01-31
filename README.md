# OSbot

> Vision-based desktop automation CLI and MCP server. Control any application via screenshot + AI vision, without APIs or UI Automation.

[![CI](https://github.com/mikealkeal/osbot/workflows/CI/badge.svg)](https://github.com/mikealkeal/osbot/actions/workflows/ci.yml)
[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)

**OSbot** is a universal fallback for desktop automation when APIs and accessibility frameworks don't work. It uses AI vision (Claude) to understand what's on screen and native OS controls to interact with it.

## Why OSbot?

> **"If you can see it, OSbot can click it."**

| Tool              | Approach               | Limitation                                          |
| ----------------- | ---------------------- | --------------------------------------------------- |
| **APIs/CLI**      | Direct integration     | No API = stuck. App must expose programmatic access |
| **UI Automation** | DOM/Accessibility tree | App must expose UI elements. Fails on canvas/games  |
| **OSbot**         | Vision + AI            | **Works on anything visible on screen**             |

OSbot is your fallback when traditional automation tools fail:

- **Legacy apps** without APIs
- **Games and canvas apps** without DOM
- **Third-party software** you can't modify
- **Cross-platform testing** without platform-specific tools
- **Ad-hoc automation** without infrastructure setup

## Features

- 🎯 **Vision-based** - Locate UI elements by description using Claude vision
- 🔍 **UI Automation** - Get element coordinates via Windows accessibility tree
- 🖱️ **Cross-platform** - Windows, macOS, and Linux support
- 🔧 **CLI + MCP** - Use standalone or integrate with AI agents (12 tools)
- 🔐 **OAuth Support** - Uses your Claude Max/Pro subscription (no API costs!)
- ⚡ **Native Input** - Uses robotjs for reliable mouse/keyboard control
- 📸 **Multi-monitor** - Supports multiple screens with DPI awareness

## Quick Start

```bash
# Install from source
git clone https://github.com/mikealkeal/osbot.git
cd osbot
npm install
npm run build
npm link

# Initialize and login
osbot init
osbot login

# Try it out - The magic of vision-based clicking!
osbot click "Submit button"          # Click by description - that's OSbot!
osbot click "File menu"              # Works on any visible element
osbot screenshot --describe          # See what Claude sees on screen
osbot type "hello world"             # Type text anywhere
```

## Installation

### Requirements

- **Node.js 22+** (22.0.0 or higher)
- **Claude Max or Pro subscription** (for OAuth authentication)

### From Source (Recommended)

```bash
git clone https://github.com/mikealkeal/osbot.git
cd osbot
npm install
npm run build
npm link
```

### Platform-Specific Setup

#### Windows

- PowerShell (included)
- No additional dependencies needed

#### macOS

- Grant accessibility permissions: **System Preferences > Security & Privacy > Accessibility**
- Add Terminal or your shell to the allowed apps

#### Linux

```bash
# Install screenshot tool (choose one)
sudo apt install scrot           # Option 1: scrot
sudo apt install imagemagick     # Option 2: ImageMagick

# Install window manager control (optional, for focus/list windows)
sudo apt install wmctrl
```

## Usage

### CLI Commands

#### Authentication

```bash
osbot init                    # Initialize config directory
osbot login                   # Login with Claude (opens browser)
osbot login --status          # Check login status
osbot login --logout          # Logout
osbot login --key sk-ant-xxx  # Use API key instead of OAuth
```

#### Vision-Based Clicking (The Core of OSbot!)

```bash
osbot click "Submit button"              # Click by description - the magic!
osbot click "File menu"                  # Works on any visible element
osbot click "Export as PNG" --screen 1   # Target specific monitor
osbot click "Close" --dry-run            # Preview without clicking
```

#### Input & Automation

```bash
osbot type "hello world"                 # Type text
osbot hotkey "ctrl+c"                    # Press keyboard shortcut
osbot hotkey "ctrl+shift+esc"            # Multiple modifiers
```

#### Screenshots

```bash
osbot screenshot                      # Capture primary screen
osbot screenshot -o capture.png       # Save to file
osbot screenshot --screen 1           # Capture second monitor
osbot screenshot --list               # List available screens
osbot screenshot --describe           # Describe screen content with AI
```

#### Window Management

```bash
osbot windows                         # List open windows
osbot focus "Chrome"                  # Focus window by name
osbot focus "Calculator"              # Works with partial matches
```

#### MCP Server

```bash
osbot serve                          # Start MCP server (stdio transport)
```

### Global Options

```bash
--verbose, -v          # Detailed output
--dry-run              # Simulate without executing
--quiet, -q            # Minimal output
--screen N             # Target specific screen (default: 0)
```

### Examples

```bash
# Take screenshot and save
osbot screenshot -o desktop.png

# Type with delay between keystrokes
osbot type "slow typing" --delay 100

# Use second monitor
osbot screenshot --screen 1 --describe

# Dry run to see what would happen
osbot type "test" --dry-run
```

## MCP Integration

OSbot exposes tools via [Model Context Protocol](https://modelcontextprotocol.io) for AI agents like Claude Desktop.

### Configuration

Add to your MCP config file:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "osbot": {
      "command": "osbot",
      "args": ["serve"]
    }
  }
}
```

Or if using from source:

```json
{
  "mcpServers": {
    "osbot": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/osbot/bin/osbot.ts", "serve"]
    }
  }
}
```

### Available MCP Tools

| Tool             | Description                                            | Parameters                         |
| ---------------- | ------------------------------------------------------ | ---------------------------------- |
| `os_screenshot`  | 📸 Capture screenshot + cursor position                | `screen?` (default: 0)             |
| `os_inspect`     | 🔍 **Get UI elements via Windows UI Automation**       | `window?`                          |
| `os_inspect_at`  | 🎯 Get element info at coordinates                     | `x`, `y`                           |
| `os_move`        | Move mouse cursor                                      | `x`, `y`                           |
| `os_click`       | Click at current cursor position                       | `window?`, `button?`               |
| `os_click_at`    | Move + click in one action                             | `x`, `y`, `window?`, `button?`     |
| `os_type`        | Type text                                              | `text`                             |
| `os_hotkey`      | Press keyboard shortcut                                | `keys` (e.g., "ctrl+c")            |
| `os_scroll`      | Scroll in direction                                    | `direction`, `amount?`             |
| `os_windows`     | List open windows + screens                            | -                                  |
| `os_focus`       | Focus window by name                                   | `window`                           |
| `os_wait`        | Wait for duration (UI loading)                         | `ms` (max 30000)                   |

### MCP Usage Example

Once configured, Claude can automate your desktop:

> "Take a screenshot and describe what you see"

> "Inspect the UI elements and click the Submit button"

> "List all windows and focus on Chrome"

> "Type 'hello world' and press Ctrl+Enter"

**Workflow**: Claude uses `os_screenshot` to see the screen, `os_inspect` to get element coordinates, then `os_move` + `os_click` for precise interaction.

## Configuration

Config directory: `~/.osbot/`

### Files

- **`config.json`** - Application settings
- **`oauth-token.json`** - OAuth credentials (managed automatically)

### config.json

```json
{
  "defaultScreen": 0,
  "dryRun": false,
  "logLevel": "info",
  "cursorSize": 128,
  "model": "claude-sonnet-4-20250514",
  "maxTokensLocate": 256,
  "maxTokensDescribe": 1024,
  "redirectPort": 9876
}
```

### Configuration Options

| Option              | Type    | Default                      | Description                                 |
| ------------------- | ------- | ---------------------------- | ------------------------------------------- |
| `defaultScreen`     | number  | `0`                          | Default monitor to capture                  |
| `dryRun`            | boolean | `false`                      | Simulate actions without executing          |
| `logLevel`          | string  | `"info"`                     | Log level: `debug`, `info`, `warn`, `error` |
| `cursorSize`        | number  | `128`                        | Cursor size in screenshots (32-256)         |
| `model`             | string  | `"claude-sonnet-4-20250514"` | Claude model to use                         |
| `maxTokensLocate`   | number  | `256`                        | Max tokens for element location             |
| `maxTokensDescribe` | number  | `1024`                       | Max tokens for screen description           |
| `redirectPort`      | number  | `9876`                       | OAuth redirect port                         |

### Environment Variables

You can also use environment variables (`.env` file supported):

```bash
# Option 1: Claude OAuth token (recommended)
CLAUDE_CODE_OAUTH_TOKEN=your-token-here

# Option 2: Anthropic API key
ANTHROPIC_API_KEY=sk-ant-...

# Other settings
LOG_LEVEL=info
DRY_RUN=false
```

## How It Works

OSbot uses a multi-layer approach for universal desktop automation:

1. **Screenshot Layer** - Captures screen using native OS tools:
   - Windows: PowerShell + .NET System.Drawing
   - macOS: `screencapture` command
   - Linux: `scrot` or ImageMagick `import`

2. **UI Automation Layer** (Windows) - Gets element coordinates via accessibility tree:
   - Uses Windows UI Automation API via PowerShell
   - Returns interactive elements with screen coordinates
   - Works like a DOM for desktop apps

3. **Vision Layer** - Claude analyzes screenshots to:
   - Locate UI elements by natural language description
   - Describe screen content
   - Provide coordinates for interaction

4. **Input Layer** - Uses robotjs for:
   - Mouse movement and clicks
   - Keyboard input and hotkeys
   - Cross-platform native control
   - Adapts to Windows mouse button swap settings

**Best strategy**: Use `os_inspect` for precise coordinates when UI Automation works, fall back to vision-based analysis for canvas apps, games, or legacy software.

## Development

### Setup

```bash
git clone https://github.com/mikealkeal/osbot.git
cd osbot
npm install
```

### Scripts

```bash
npm run build       # Build TypeScript
npm run dev         # Development mode (watch)
npm run typecheck   # Type check only
npm run lint        # Run ESLint
npm run lint:fix    # Fix linting issues
npm run format      # Format with Prettier
npm run clean       # Remove dist folder
```

### Project Structure

```
osbot/
├── bin/
│   └── osbot.ts              # CLI entry point
├── src/
│   ├── core/
│   │   ├── screenshot.ts     # Multi-platform screen capture
│   │   ├── auth.ts           # OAuth 2.0 + PKCE authentication
│   │   ├── vision.ts         # Claude API integration
│   │   ├── input.ts          # Mouse/keyboard control (robotjs)
│   │   ├── windows.ts        # Window management
│   │   └── uiautomation.ts   # Windows UI Automation (accessibility)
│   ├── cli/
│   │   ├── commands/         # CLI command implementations
│   │   └── index.ts          # Command registration
│   ├── mcp/
│   │   └── server.ts         # MCP server (12 tools)
│   ├── config/
│   │   └── index.ts          # Config management with Zod
│   └── index.ts              # Main exports
├── package.json
├── tsconfig.json
├── .env.example
└── LICENSE
```

### Tech Stack

- **Runtime**: Node.js 22+ (ESM)
- **Language**: TypeScript 5.7+ (strict mode)
- **Validation**: Zod
- **CLI**: Commander + Chalk + Ora
- **Vision**: Anthropic SDK (Claude Sonnet 4)
- **Input**: robotjs (native automation)
- **Screenshot**: screenshot-desktop + platform-specific tools
- **MCP**: @modelcontextprotocol/sdk

## Troubleshooting

### Windows Issues

**Screenshot not capturing cursor:**

- Adjust `cursorSize` in config.json (32-256)
- Larger cursors are easier for AI to detect

**Clicks not working:**

- OSbot auto-detects swapped mouse buttons
- No manual configuration needed

### macOS Issues

**"Accessibility permissions required":**

1. Open System Preferences > Security & Privacy > Accessibility
2. Add Terminal or your shell to the list
3. Restart the terminal

**Screenshot not working:**

- `screencapture` is built-in, should work out of the box
- Check privacy settings if denied

### Linux Issues

**Screenshot fails:**

```bash
# Install one of these
sudo apt install scrot           # Recommended
sudo apt install imagemagick
```

**Window focus/list not working:**

```bash
sudo apt install wmctrl
```

### Authentication Issues

**OAuth flow times out:**

- Check firewall isn't blocking port 9876
- Change port in `~/.osbot/config.json` if needed
- Try `osbot login --key sk-ant-xxx` as fallback

**"Not authenticated" errors:**

```bash
osbot login --status    # Check status
osbot login --logout    # Clear credentials
osbot login             # Re-authenticate
```

### Vision/API Issues

**"Element not found":**

- Be more specific in descriptions
- Try `osbot screenshot --describe` to see what Claude sees
- Ensure element is visible on screen

**Rate limiting:**

- Wait a few moments between requests
- Consider using API key for higher limits

## License

**BSL 1.1** (Business Source License 1.1)

- ✅ **Free** for personal use
- ✅ **Free** for open-source projects
- ⚠️ **Commercial use** requires a license after 4 years
- 🔄 Automatically converts to **MIT** after 4 years (2029-01-30)

See [LICENSE](LICENSE) for full terms.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Guidelines

1. Follow the existing code style (ESLint + Prettier configured)
2. Add tests for new features
3. Update documentation as needed
4. Ensure `npm run build` succeeds
5. Check types with `npm run typecheck`

### Areas for Contribution

- [ ] Additional platform support (BSD, other Unix variants)
- [ ] More sophisticated element location strategies
- [ ] Performance optimizations
- [ ] Additional MCP tools
- [ ] Better error messages
- [ ] Documentation improvements

## Support

- 🐛 **Bug reports**: [GitHub Issues](https://github.com/mikealkeal/osbot/issues)
- 💬 **Questions**: [GitHub Discussions](https://github.com/mikealkeal/osbot/discussions)
- 📖 **Documentation**: This README + inline code comments

## Roadmap

- [ ] npm package distribution
- [ ] Web interface for remote control
- [ ] Recording and playback of automation sequences
- [ ] Multi-provider vision support (GPT-4V, Gemini)
- [ ] Plugin system for custom tools
- [ ] Docker container distribution

---

**Built with [Claude](https://claude.ai) • Powered by [robotjs](https://github.com/octalmage/robotjs) • MCP-enabled**
