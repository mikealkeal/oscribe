# OSbot

Vision-based desktop automation engine. Control any application via screenshot + AI vision, without relying on APIs or UI Automation frameworks.

## Quick Start

```bash
# Install
npm install -g osbot

# Initialize
osbot init

# Configure API key
osbot login --key sk-ant-your-key

# Test
osbot screenshot --describe
osbot click "the search button"
osbot type "hello world"
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

- `--dry-run` - Show what would happen without executing
- `--screen N` - Target specific screen (multi-monitor)
- `--verbose` - Detailed output

## MCP Server

OSbot exposes tools via Model Context Protocol for AI agents:

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

- `os_click` - Click on element via vision
- `os_type` - Type text
- `os_screenshot` - Capture and describe screen
- `os_windows` - List windows
- `os_focus` - Focus window
- `os_scroll` - Scroll in direction
- `os_hotkey` - Press keyboard shortcut

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
- `ANTHROPIC_API_KEY` - API key (alternative to config)

## Requirements

- Node.js 22+
- Anthropic API key (Claude)
- OS permissions for screen capture and input control

### Windows

The screenshot module requires .NET Framework to be installed.

### macOS

Grant accessibility permissions in System Preferences > Security & Privacy > Accessibility.

## Development

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build
npm run build

# Type check
npm run typecheck
```

## How It Works

1. **Screenshot** - Captures the screen
2. **Vision** - Claude analyzes the image to find UI elements
3. **Input** - nut.js controls mouse/keyboard to interact

This approach works with any application, regardless of its technology stack or accessibility support.

## License

BSL 1.1 - Free for personal and open-source use. Commercial use requires a license.
