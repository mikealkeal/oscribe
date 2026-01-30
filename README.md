# OSbot

Vision-based desktop automation engine. Control any application via screenshot + AI vision, without relying on APIs or UI Automation frameworks.

## Installation

### From source (recommended for now)

```bash
# Clone the repository
git clone https://github.com/mikealkeal/osbot.git
cd osbot

# Install dependencies
npm install

# Build
npm run build

# Run CLI (development)
npx tsx bin/osbot.ts --help

# Or link globally
npm link
osbot --help
```

### Requirements

- **Node.js 22+**
- **Anthropic API key** (Claude) - Get one at <https://console.anthropic.com/>

#### Windows

- PowerShell (included with Windows)
- No additional dependencies needed

#### macOS

- Grant accessibility permissions: System Preferences > Security & Privacy > Accessibility

#### Linux

- Install `scrot` or `imagemagick` for screenshots: `sudo apt install scrot`

## Quick Start

```bash
# 1. Initialize config
osbot init

# 2. Configure API key
osbot login --key sk-ant-your-key
# Or set environment variable: export ANTHROPIC_API_KEY=sk-ant-...

# 3. Test screenshot
osbot screenshot --list          # List available screens
osbot screenshot -o test.png     # Capture screen

# 4. Test with vision (requires API key)
osbot screenshot --describe      # Describe what's on screen
osbot click "the Start button"   # Click via vision
osbot type "hello world"         # Type text
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `osbot init` | Initialize configuration |
| `osbot login` | Configure Anthropic API key |
| `osbot click <target>` | Click element by description |
| `osbot type <text>` | Type text |
| `osbot screenshot` | Capture screen |
| `osbot windows` | List open windows |
| `osbot focus <window>` | Focus a window |
| `osbot serve` | Start MCP server |

### Options

```bash
osbot click "button" --dry-run    # Show what would happen
osbot click "button" --screen 1   # Use second monitor
osbot click "button" --verbose    # Detailed output
osbot screenshot --list           # List available screens
osbot screenshot --describe       # Describe screen content
```

## MCP Server

OSbot exposes tools via Model Context Protocol for AI agents.

Add to your MCP config (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "osbot": {
      "command": "npx",
      "args": ["tsx", "/path/to/osbot/bin/osbot.ts", "serve"]
    }
  }
}
```

Or if installed globally:

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

### Available Tools

| Tool | Description |
|------|-------------|
| `os_click` | Click on element via vision |
| `os_type` | Type text |
| `os_screenshot` | Capture and optionally describe screen |
| `os_windows` | List open windows |
| `os_focus` | Focus window by name |
| `os_scroll` | Scroll in direction |
| `os_hotkey` | Press keyboard shortcut (e.g., "ctrl+c") |

## Configuration

Config file: `~/.osbot/config.json`

```json
{
  "apiKey": "sk-ant-...",
  "defaultScreen": 0,
  "dryRun": false,
  "logLevel": "info"
}
```

Environment variables:

- `ANTHROPIC_API_KEY` - API key (alternative to config file)

## Development

```bash
# Install dependencies
npm install

# Development mode (watch)
npm run dev

# Build TypeScript
npm run build

# Type check only
npm run typecheck

# Lint
npm run lint

# Format code
npm run format
```

### Project Structure

```text
osbot/
├── bin/osbot.ts              # CLI entry point
├── src/
│   ├── core/
│   │   ├── screenshot.ts     # Screen capture (PowerShell/screencapture/scrot)
│   │   ├── vision.ts         # Claude API integration
│   │   ├── input.ts          # Mouse/keyboard control (nut.js)
│   │   └── windows.ts        # Window management
│   ├── cli/commands/         # CLI command handlers
│   ├── mcp/server.ts         # MCP server implementation
│   └── config/index.ts       # Config management
├── package.json
└── tsconfig.json
```

## How It Works

1. **Screenshot** - Captures the screen using native OS tools
2. **Vision** - Claude analyzes the image to find UI elements by description
3. **Input** - nut.js controls mouse/keyboard to interact with the element

This approach works with any application, regardless of its technology stack or accessibility support.

## Troubleshooting

### Windows: Screenshot not working

- Ensure PowerShell is available (it should be by default)
- Try running as administrator if permissions are an issue

### macOS: Input not working

- Grant accessibility permissions in System Preferences

### Linux: Screenshot not working

- Install scrot: `sudo apt install scrot`
- Or imagemagick: `sudo apt install imagemagick`

### API errors

- Verify your API key is correct
- Check your Anthropic account has credits

## License

BSL 1.1 - Free for personal and open-source use. Commercial use requires a license.
