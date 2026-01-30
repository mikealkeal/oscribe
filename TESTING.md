# Testing Guide

Manual testing checklist for OSbot functionality.

## Prerequisites

### Windows
- PowerShell (included)
- No additional dependencies

### macOS
- Grant accessibility permissions: System Preferences > Security & Privacy > Accessibility
- Add Terminal to allowed apps

### Linux
```bash
sudo apt install scrot wmctrl
```

## Build and Validation

### Quick Validation

```bash
# Run validation script
./scripts/validate.sh         # Linux/macOS
./scripts/validate.ps1         # Windows
```

### Manual Build Check

```bash
npm run build
npm run lint
npm run typecheck
node dist/bin/osbot.js --help
```

## Core Functionality Tests

### 1. Configuration

```bash
# Initialize config
osbot init

# Check config location
ls ~/.osbot/config.json
```

Expected: Config file created with defaults.

### 2. Authentication

```bash
# Test login (opens browser)
osbot login

# Check status
osbot login --status

# Test API key fallback
osbot login --key sk-ant-xxx
```

Expected: OAuth flow completes, token saved.

### 3. Screenshot

```bash
# List screens
osbot screenshot --list

# Capture primary screen
osbot screenshot -o test.png

# Capture specific screen (if multi-monitor)
osbot screenshot --screen 1 -o screen2.png

# Test describe (requires login)
osbot screenshot --describe
```

**Multi-screen test:**
- If you have multiple monitors, verify each screen index works
- Check DPI scaling on HiDPI displays
- Verify cursor is captured in screenshots

### 4. Window Management

```bash
# List open windows
osbot windows

# Focus window
osbot focus "Calculator"
osbot focus "Chrome"
```

Expected: Windows listed with titles, focus switches correctly.

### 5. Input Automation

```bash
# Type text
osbot type "Hello World"

# Keyboard shortcuts
osbot hotkey "ctrl+a"
osbot hotkey "ctrl+shift+esc"

# Click (requires vision)
osbot click "Start button"
```

**Test in dry-run mode first:**
```bash
osbot type "test" --dry-run
osbot click "button" --dry-run
```

### 6. MCP Server

```bash
# Start MCP server
osbot serve
```

**Test with Claude Desktop:**
1. Add to `claude_desktop_config.json`:
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

2. Restart Claude Desktop
3. Ask: "Take a screenshot and describe what's on screen"
4. Ask: "List open windows"

## Platform-Specific Tests

### Windows

- [ ] Screenshot captures cursor
- [ ] Mouse button swap detection works
- [ ] PowerShell scripts run without errors
- [ ] Window enumeration works

### macOS

- [ ] Accessibility permissions requested
- [ ] screencapture command works
- [ ] osascript window management works
- [ ] Focus window by app name works

### Linux

- [ ] scrot/ImageMagick screenshot works
- [ ] wmctrl window management works
- [ ] X11 display detection works

## Multi-Screen Validation

If you have multiple monitors:

```bash
# List all screens
osbot screenshot --list

# Test each screen
osbot screenshot --screen 0 -o screen0.png
osbot screenshot --screen 1 -o screen1.png

# Verify coordinates
osbot screenshot --screen 0 --describe
osbot screenshot --screen 1 --describe
```

**Check:**
- [ ] All screens detected
- [ ] Correct resolution reported
- [ ] Primary screen marked correctly
- [ ] Screenshots captured from right screen
- [ ] Coordinates adjusted per screen

## DPI Scaling Test

On HiDPI displays (4K, Retina, etc.):

```bash
# Capture screenshot
osbot screenshot -o hidpi-test.png

# Check cursor visibility
# Adjust cursorSize in ~/.osbot/config.json if needed
```

**Cursor sizes to test:** 32, 64, 128, 256

## Vision & API Tests

Requires authentication (`osbot login`).

```bash
# Test basic description
osbot screenshot --describe

# Test element location (if implemented)
osbot click "visible button"

# Test retry logic
osbot click "nonexistent element"  # Should fail after retries
```

## Error Handling Tests

```bash
# Invalid screen
osbot screenshot --screen 99

# Not authenticated
osbot screenshot --describe  # Before login

# Invalid hotkey
osbot hotkey "invalid+combo"
```

Expected: Clear error messages, no crashes.

## Performance Checks

```bash
# Measure screenshot time
time osbot screenshot -o test.png

# Measure vision API time
time osbot screenshot --describe
```

**Benchmarks (approximate):**
- Screenshot: < 1s
- Vision API: 1-3s
- Window list: < 500ms

## CI/CD Validation

```bash
# Verify GitHub Actions pass
# Check: https://github.com/mikealkeal/osbot/actions

# Test locally like CI
npm ci
npm run lint
npm run typecheck
npm run build
```

## Troubleshooting

### Screenshot Issues
- **Windows:** Check cursor size in config
- **macOS:** Verify privacy permissions
- **Linux:** Install scrot or imagemagick

### Window Management Issues
- **macOS:** Check accessibility permissions
- **Linux:** Install wmctrl

### Authentication Issues
- Check firewall isn't blocking port 9876
- Try different port in config
- Use API key as fallback

### Vision/API Issues
- Verify token with `osbot login --status`
- Check Claude API status
- Try with API key instead of OAuth

## Test Results Template

```markdown
## Test Run: [Date]
- **Platform:** [Windows/macOS/Linux]
- **Node:** [version]
- **Screens:** [count]

### Results
- [ ] Build & Lint
- [ ] Config & Auth
- [ ] Screenshot (single)
- [ ] Screenshot (multi-screen)
- [ ] Window management
- [ ] Input automation
- [ ] MCP server
- [ ] Vision API

### Issues Found
[None / List issues]

### Notes
[Any observations]
```
