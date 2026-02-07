/**
 * MCP Server for OScribe
 * Exposes desktop automation tools via Model Context Protocol
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { captureScreen, listScreens } from '../core/screenshot.js';
import { click, typeText, hotkey, scroll, moveMouse, getMousePosition, clickAtCurrentPosition, mouseDown, mouseUp, drag } from '../core/input.js';
import { listWindows, focusWindow } from '../core/windows.js';
import { getUIElements, getElementAtPoint, findSystemUIElements, getTaskbarConfig } from '../core/uiautomation.js';
import { isNvdaInstalled, isNvdaRunning, initNvda, startNvda, stopNvda, getNvdaStatus } from '../core/nvda.js';
import { isVoiceOverRunning, startVoiceOver, stopVoiceOver, getVoiceOverStatus } from '../core/voiceover.js';
import { restartBrowserWithCDP } from '../core/browser-restart.js';
import { setupUnityBridge } from '../core/unity-setup.js';
import { RestrictedActionError } from '../core/security.js';
import { UserInterruptError, resetKillSwitch, checkResumeSignal } from '../core/killswitch.js';
import { SessionRecorder, ScreenContext, UIElementContext } from '../core/session-recorder.js';

// Known client image size limits for calculating resize ratio
// When models receive images larger than their limit, they resize them
interface ClientImageLimit {
  maxLongEdge: number;
  name: string;
}

const CLIENT_IMAGE_LIMITS: Record<string, ClientImageLimit> = {
  // Claude models (Claude Desktop, Claude Code, etc.)
  claude: { maxLongEdge: 1568, name: 'Claude' },
  anthropic: { maxLongEdge: 1568, name: 'Claude' },
  // OpenAI models
  openai: { maxLongEdge: 2048, name: 'GPT-4V' },
  // Google models
  gemini: { maxLongEdge: 3072, name: 'Gemini' },
  google: { maxLongEdge: 3072, name: 'Gemini' },
  // Default fallback (conservative estimate)
  default: { maxLongEdge: 1568, name: 'Unknown' },
};

/**
 * Calculate image resize ratio based on client
 * Models resize images when the long edge exceeds their limit
 */
function calculateImageRatio(width: number, height: number, clientName?: string): { ratio: number; clientType: string } {
  const longEdge = Math.max(width, height);
  const defaultLimit: ClientImageLimit = { maxLongEdge: 1568, name: 'Unknown' };

  // Try to match client name to known limits
  let clientLimit: ClientImageLimit = defaultLimit;
  if (clientName) {
    const lowerName = clientName.toLowerCase();
    for (const [key, limit] of Object.entries(CLIENT_IMAGE_LIMITS)) {
      if (key !== 'default' && lowerName.includes(key)) {
        clientLimit = limit;
        break;
      }
    }
  }

  // If image is larger than limit, calculate resize ratio
  const ratio = longEdge > clientLimit.maxLongEdge
    ? longEdge / clientLimit.maxLongEdge
    : 1;

  return { ratio, clientType: clientLimit.name };
}

// Get version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../../package.json'), 'utf-8')
) as {
  version: string;
};

const server = new Server(
  {
    name: 'oscribe',
    version: packageJson.version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool schemas
const MoveSchema = z.object({
  x: z.number().describe('X coordinate to move mouse to'),
  y: z.number().describe('Y coordinate to move mouse to'),
});

const ClickAtSchema = z.object({
  x: z.number().optional().describe('X coordinate to click (if omitted, clicks at current cursor position)'),
  y: z.number().optional().describe('Y coordinate to click (if omitted, clicks at current cursor position)'),
  window: z.string().optional().describe('Window to focus first (optional)'),
  button: z.enum(['left', 'right', 'middle']).default('left').describe('Mouse button to click'),
});

const TypeSchema = z.object({
  text: z.string().describe('Text to type'),
});

const ScreenshotSchema = z.object({
  screen: z.number().default(0).describe('Screen number (default: 0)'),
});

const ScrollSchema = z.object({
  direction: z.enum(['up', 'down', 'left', 'right']),
  amount: z.number().default(3).describe('Scroll amount'),
});

const HotkeySchema = z.object({
  keys: z.string().describe('Keys to press, e.g. "ctrl+c"'),
});

const FocusSchema = z.object({
  window: z.string().describe('Window title or app name'),
});

const WaitSchema = z.object({
  ms: z.number().min(0).max(30000).describe('Milliseconds to wait (max 30000)'),
});

const InspectPointSchema = z.object({
  x: z.number().describe('X coordinate'),
  y: z.number().describe('Y coordinate'),
});

const MouseToggleSchema = z.object({
  button: z.enum(['left', 'right', 'middle']).default('left').describe('Mouse button (default: left)'),
});

const DragSchema = z.object({
  fromX: z.number().describe('Starting X coordinate'),
  fromY: z.number().describe('Starting Y coordinate'),
  toX: z.number().describe('Ending X coordinate'),
  toY: z.number().describe('Ending Y coordinate'),
  button: z.enum(['left', 'right', 'middle']).default('left').describe('Mouse button (default: left)'),
  duration: z.number().default(500).describe('Duration of drag in ms (default: 500)'),
});

const UnitySetupSchema = z.object({
  gamePath: z.string().optional().describe(
    'Absolute path to the Unity game folder. ' +
    'Windows: folder with .exe. macOS: folder containing the .app bundle. ' +
    'If omitted, attempts to detect from active window.',
  ),
  step: z.enum(['auto', 'detect', 'bepinex', 'build', 'deploy'])
    .default('auto')
    .describe('Step to execute. "auto" runs full pipeline. "detect" only analyzes the game.'),
  force: z.boolean().default(false)
    .describe('Force re-install even if already present.'),
});

// Session recorder - initialized on first action
let sessionRecorder: SessionRecorder | null = null;

function getRecorder(): SessionRecorder {
  sessionRecorder ??= new SessionRecorder('MCP Session');
  return sessionRecorder;
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'os_move',
        description: 'Move mouse cursor to specific coordinates',
        inputSchema: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate to move to' },
            y: { type: 'number', description: 'Y coordinate to move to' },
          },
          required: ['x', 'y'],
        },
      },
      {
        name: 'os_click',
        description: 'Click at current cursor position. Use os_move first to position the cursor, then os_click to click. This ensures precise clicking by separating movement and click.',
        inputSchema: {
          type: 'object',
          properties: {
            window: { type: 'string', description: 'Window to focus first (optional)' },
            button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
          },
        },
      },
      {
        name: 'os_click_at',
        description: 'Click at specific screen coordinates (moves and clicks in one action). Prefer using os_move + os_click for more precise control.',
        inputSchema: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate to click' },
            y: { type: 'number', description: 'Y coordinate to click' },
            window: { type: 'string', description: 'Window to focus first (optional)' },
            button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
          },
          required: ['x', 'y'],
        },
      },
      {
        name: 'os_type',
        description: 'Type text using the keyboard',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to type' },
          },
          required: ['text'],
        },
      },
      {
        name: 'os_screenshot',
        description: `Capture a screenshot with UI elements and cursor position. Returns: (1) the image, (2) cursor coordinates (x, y), (3) UI elements from Windows UI Automation with their screen coordinates. Use this to see the screen AND know where to click precisely.

⚠️ CRITICAL - HOW TO CLICK ON ELEMENTS:
- ALWAYS use the center=(x,y) coordinates from the Elements list below
- NEVER guess or estimate positions visually from the image
- The JSON coordinates are EXACT screen positions, the image is only for visual context

Example: To click on Button "Enregistrer" center=(951,658) → use os_click_at(x=951, y=658)

🌐 BROWSER SUPPORT (Chrome, Edge, Brave, Arc, Opera):
- For Chromium browsers, OScribe uses Chrome DevTools Protocol (CDP) to detect 200-300+ interactive elements
- CDP requires the browser to be launched with remote debugging enabled
- To enable CDP: Close the browser, then launch it with: --remote-debugging-port=9222
  - Chrome: google-chrome --remote-debugging-port=9222
  - Edge: msedge --remote-debugging-port=9222
  - Brave: brave --remote-debugging-port=9222
- Without CDP, OScribe falls back to native UI Automation (detects only ~20-40 elements on macOS)
- The "Strategy" field in the response indicates which method was used: "browser" (CDP) or "native" (UI Automation)`,
        inputSchema: {
          type: 'object',
          properties: {
            screen: { type: 'number', description: 'Screen number (default: 0)' },
          },
        },
      },
      {
        name: 'os_windows',
        description: 'List all open windows',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'os_focus',
        description: 'Focus a window by title or app name',
        inputSchema: {
          type: 'object',
          properties: {
            window: { type: 'string', description: 'Window title or app name' },
          },
          required: ['window'],
        },
      },
      {
        name: 'os_scroll',
        description: 'Scroll in a direction',
        inputSchema: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
            amount: { type: 'number', description: 'Scroll amount (default: 3)' },
          },
          required: ['direction'],
        },
      },
      {
        name: 'os_hotkey',
        description: 'Press a keyboard shortcut',
        inputSchema: {
          type: 'object',
          properties: {
            keys: { type: 'string', description: 'Keys to press, e.g. "ctrl+c"' },
          },
          required: ['keys'],
        },
      },
      {
        name: 'os_wait',
        description: 'Wait for a specified duration (useful for waiting for UI to load)',
        inputSchema: {
          type: 'object',
          properties: {
            ms: { type: 'number', description: 'Milliseconds to wait (max 30000)' },
          },
          required: ['ms'],
        },
      },
      {
        name: 'os_inspect_at',
        description: 'Get the UI element at specific coordinates. Returns element type, name, bounds, and state.',
        inputSchema: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate' },
            y: { type: 'number', description: 'Y coordinate' },
          },
          required: ['x', 'y'],
        },
      },
      {
        name: 'os_system_ui',
        description: 'Get all Windows system UI elements (taskbar, Start button, system tray, desktop icons, action center, widgets). Use this to interact with OS-level UI independently of application windows. Returns clickable coordinates for all system elements.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'os_nvda_status',
        description: 'Check NVDA screen reader status (Windows only). NVDA is needed for Electron app accessibility.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'os_nvda_install',
        description: 'Download and install NVDA portable for Electron app accessibility. Windows only.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'os_nvda_start',
        description: 'Start NVDA screen reader in silent mode. Required for Electron app accessibility. Windows only.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'os_nvda_stop',
        description: 'Stop NVDA screen reader. Windows only.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'os_voiceover_status',
        description: 'Check VoiceOver screen reader status (macOS only). VoiceOver is needed for Electron app accessibility.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'os_voiceover_start',
        description: 'Start VoiceOver screen reader in silent mode (no audio). Required for Electron app accessibility. macOS only.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'os_voiceover_stop',
        description: 'Stop VoiceOver screen reader. macOS only.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'os_browser_restart_with_cdp',
        description: `Restart Chromium browser (Chrome, Edge, Brave, Arc) with Chrome DevTools Protocol (CDP) enabled.
Also works for CEF apps (Epic Games Launcher, Unreal Engine apps) — automatically detects and uses -cefdebug flag.

This tool:
1. Saves all open tabs (URLs)
2. Closes the browser gracefully
3. Relaunches with --remote-debugging-port=9222 (browsers) or -cefdebug=9225 (CEF apps)
4. Restores all tabs
5. Takes a screenshot automatically after restart to verify CDP is active

Use this when:
- Screenshot shows "Strategy: native (CDP not enabled ⚠️)"
- Screenshot shows "Strategy: cef (CEF detected, CDP not active ⚠️)"
- Browser warning suggests enabling CDP
- You need 200-300+ elements instead of 20-40

After restart, the screenshot will show "Strategy: browser (CDP active ✓)" or "Strategy: cef (CEF CDP active ✓)" and detect 10x more elements.`,
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'Remote debugging port (default: 9222)', default: 9222 },
            window: { type: 'string', description: 'Optional browser window/app name to target (e.g., "Google Chrome", "Microsoft Edge"). If not provided, uses active window.' },
          },
        },
      },
      {
        name: 'os_mouse_down',
        description: 'Press and hold mouse button at current cursor position. For drag-and-drop, prefer os_drag which handles the complete operation. Use os_mouse_down + os_move + os_mouse_up only for complex multi-step drag scenarios.',
        inputSchema: {
          type: 'object',
          properties: {
            button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
          },
        },
      },
      {
        name: 'os_mouse_up',
        description: 'Release mouse button at current cursor position. Use after os_mouse_down to complete manual drag operations. For simple drag-and-drop, prefer os_drag instead.',
        inputSchema: {
          type: 'object',
          properties: {
            button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
          },
        },
      },
      {
        name: 'os_drag',
        description: 'Perform a drag-and-drop operation: moves to start position, holds mouse button, smoothly drags to destination, then releases. Use this for moving files, reordering items, resizing windows, or any UI interaction requiring drag-and-drop.',
        inputSchema: {
          type: 'object',
          properties: {
            fromX: { type: 'number', description: 'Starting X coordinate' },
            fromY: { type: 'number', description: 'Starting Y coordinate' },
            toX: { type: 'number', description: 'Ending X coordinate' },
            toY: { type: 'number', description: 'Ending Y coordinate' },
            button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
            duration: { type: 'number', description: 'Duration of drag in ms (default: 500)' },
          },
          required: ['fromX', 'fromY', 'toX', 'toY'],
        },
      },
      {
        name: 'os_unity_setup',
        description: `Automatically set up the Unity Bridge for any Unity Mono game (Windows & macOS).

This tool automates the full pipeline:
1. **Detect**: Analyzes the game folder (runtime, DLLs, architecture)
2. **BepInEx**: Downloads and installs BepInEx 5 mod loader
3. **Build**: Compiles OScribeBridge.dll adapted to the game's DLLs
4. **Deploy**: Copies the plugin to BepInEx/plugins/

After setup, launch the game and the bridge exposes 80-100+ UI elements on port 9876.
Use os_screenshot to see Unity UI elements (strategy: "unity").

Requires: dotnet SDK installed (https://dot.net/download).
Supports: Unity Mono games only (not IL2CPP).`,
        inputSchema: {
          type: 'object',
          properties: {
            gamePath: {
              type: 'string',
              description: 'Absolute path to the Unity game folder. Windows: folder with .exe. macOS: folder with .app bundle. If omitted, detects from active window.',
            },
            step: {
              type: 'string',
              enum: ['auto', 'detect', 'bepinex', 'build', 'deploy'],
              description: 'Step to execute. "auto" runs full pipeline. "detect" only analyzes (read-only).',
              default: 'auto',
            },
            force: {
              type: 'boolean',
              description: 'Force re-install even if already present.',
              default: false,
            },
          },
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const recorder = getRecorder();

  // Check for user resume signal (from CLI: oscribe killswitch reset)
  // This allows the user to manually signal "I'm ready, continue automation"
  checkResumeSignal();

  // Reset kill switch at the start of each MCP call
  // This prevents false positives from previous mouse movements
  resetKillSwitch();

  try {
    switch (name) {
      case 'os_move': {
        const { x, y } = MoveSchema.parse(args);

        await recorder.recordAction('os_move', { x, y }, async () => {
          await moveMouse(x, y);
        });

        return {
          content: [
            {
              type: 'text',
              text: `Moved mouse to (${x}, ${y})`,
            },
          ],
        };
      }

      case 'os_click': {
        // Click at current cursor position (no movement)
        const { window: windowName, button } = ClickAtSchema.parse(args);
        const pos = getMousePosition();

        await recorder.recordAction('os_click', { x: pos.x, y: pos.y, button, window: windowName }, async () => {
          if (windowName) {
            await focusWindow(windowName);
          }
          await clickAtCurrentPosition({ button });
        });

        return {
          content: [
            {
              type: 'text',
              text: `${button === 'right' ? 'Right-clicked' : button === 'middle' ? 'Middle-clicked' : 'Clicked'} at current position (${pos.x}, ${pos.y})`,
            },
          ],
        };
      }

      case 'os_click_at': {
        // Move to coordinates then click
        const { x, y, window: windowName, button } = ClickAtSchema.parse(args);

        if (x === undefined || y === undefined) {
          throw new Error('os_click_at requires x and y coordinates. Use os_click to click at current position.');
        }

        await recorder.recordAction('os_click_at', { x, y, button, window: windowName }, async () => {
          if (windowName) {
            await focusWindow(windowName);
          }
          await click(x, y, { button });
        });

        return {
          content: [
            {
              type: 'text',
              text: `${button === 'right' ? 'Right-clicked' : button === 'middle' ? 'Middle-clicked' : 'Clicked'} at (${x}, ${y})`,
            },
          ],
        };
      }

      case 'os_type': {
        const { text } = TypeSchema.parse(args);

        await recorder.recordAction('os_type', { text }, async () => {
          await typeText(text);
        });

        return {
          content: [
            {
              type: 'text',
              text: `Typed: "${text}"`,
            },
          ],
        };
      }

      case 'os_screenshot': {
        const { screen } = ScreenshotSchema.parse(args);
        const screenshot = await captureScreen({ screen });
        const cursor = getMousePosition();

        // Get screenshot dimensions and calculate resize ratio for the client
        const width = screenshot.width ?? 0;
        const height = screenshot.height ?? 0;
        const clientVersion = server.getClientVersion();
        const { ratio, clientType } = calculateImageRatio(width, height, clientVersion?.name);

        // Get UI elements from focused window
        const tree = await getUIElements();

        // On Windows, always get system UI elements (taskbar, etc.)
        // Even if hidden (auto-hide), agent can move mouse to edge to reveal it
        // Skip if desktop is already active (getUIElements already returns taskbar)
        let systemElements: typeof tree.ui = [];
        let taskbarInfo = '';
        if (process.platform === 'win32' && tree.windowClass !== 'Shell_TrayWnd') {
          const taskbarConfig = await getTaskbarConfig();
          const sysElements = await findSystemUIElements();
          // Filter to only interactive elements (buttons mainly)
          systemElements = sysElements.filter((el) =>
            el.type === 'Button' && el.name && !(el as { source?: string }).source?.includes('Progman')
          );

          if (taskbarConfig.visible) {
            taskbarInfo = `\n📌 Taskbar: ${taskbarConfig.position}`;
          } else {
            taskbarInfo = `\n📌 Taskbar: ${taskbarConfig.position} (hidden - move mouse to ${taskbarConfig.position} edge to reveal)`;
          }
        } else if (process.platform === 'win32') {
          // Desktop active - taskbar already included in tree.ui
          taskbarInfo = `\n📌 Taskbar: active (desktop focused)`;
        }

        // Helper to format element with centered coordinates
        const formatElement = (el: typeof tree.ui[0]): UIElementContext => ({
          type: el.type,
          ...(el.name ? { name: el.name } : {}),
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          centerX: el.x + Math.floor(el.width / 2),
          centerY: el.y + Math.floor(el.height / 2),
          ...(!el.isEnabled ? { isEnabled: false } : {}),
          ...(el.automationId ? { automationId: el.automationId } : {}),
          ...(el.value ? { value: el.value } : {}),
        });

        // Build full context for session recording (includes content for reference)
        const screenContext: ScreenContext = {
          window: tree.window,
          cursor: { x: cursor.x, y: cursor.y },
          timestamp: new Date().toISOString(),
          elements: [...tree.elements, ...systemElements].map(formatElement),
        };

        // Save screenshot + full context to session
        const recorder = getRecorder();
        recorder.saveScreenshot(screenshot.base64, 'screenshot', screenContext);

        // Format text output - ONLY UI elements sent to AI (not Text content)
        // Show both corner (x,y) and center for clicking
        const elementsText = tree.ui.map((el) => {
          const cx = el.x + Math.floor(el.width / 2);
          const cy = el.y + Math.floor(el.height / 2);
          return `- ${el.type}: "${el.name}" pos=(${el.x},${el.y}) center=(${cx},${cy}) [${el.width}x${el.height}]${el.value ? ` value="${el.value}"` : ''}${el.automationId ? ` id="${el.automationId}"` : ''}`;
        }).join('\n');

        // Format system UI elements (taskbar buttons)
        const systemText = systemElements.length > 0
          ? `\n\n🖥️ System UI (${systemElements.length}):\n` + systemElements.map((el) => {
              const cx = el.x + Math.floor(el.width / 2);
              const cy = el.y + Math.floor(el.height / 2);
              return `- ${el.type}: "${el.name}" center=(${cx},${cy}) [${el.width}x${el.height}]${el.automationId ? ` id="${el.automationId}"` : ''}`;
            }).join('\n')
          : '';

        // Check if this is a Chromium browser (needed for warnings and strategy info)
        const { detectBrowser } = await import('../core/browser.js');
        const { getActiveWindow } = await import('../core/windows.js');
        const activeWindow = await getActiveWindow();
        const browserInfo = activeWindow ? await detectBrowser(tree.windowClass, activeWindow.app) : null;

        // Build image info section with dimensions and ratio
        const strategyInfo = `🔧 Strategy: ${tree.strategy}${tree.strategy === 'browser' ? ' (CDP active ✓)' : tree.strategy === 'cef' && tree.ui.length >= 10 ? ' (CEF CDP active ✓)' : tree.strategy === 'cef' ? ' (CEF detected, CDP not active ⚠️)' : tree.strategy === 'unity' && tree.unityBridgeActive ? ' (Unity Bridge active ✓)' : tree.strategy === 'unity' && !tree.unityBridgeActive ? ' (native fallback, Bridge not connected ⚠️)' : tree.strategy === 'native' && browserInfo ? ' (CDP not enabled ⚠️)' : ''}`;
        const imageInfo = `📐 Screenshot: ${width}x${height} | Client: ${clientType} | Ratio: ${ratio.toFixed(3)}${taskbarInfo}`;
        const ratioHint = ratio > 1
          ? `⚠️ Image resized by client. For visual estimates, multiply coordinates by ${ratio.toFixed(3)}`
          : `✓ Image at full resolution (no resize)`;

        // Add window bounds info for CDP (coordinate conversion)
        let windowBoundsInfo = '';
        if (tree.strategy === 'browser' && tree.windowBounds) {
          const { x, y, width: winWidth, height: winHeight } = tree.windowBounds;
          // Typical Chrome UI height on macOS: ~140px (window title bar ~28px + tab bar ~37px + address bar ~75px)
          const chromeUIHeight = 140;
          windowBoundsInfo = `\n🌐 Browser Window: position=(${x},${y}) size=${winWidth}x${winHeight}\n💡 CDP coordinates: Add viewport offset to convert CDP coords → screen coords\n   - CDP coordinate (cx, cy) → Screen coordinate (${x} + cx, ${y + chromeUIHeight} + cy)\n   - Viewport starts at approximately y=${y + chromeUIHeight} (after Chrome UI)`;
        }

        let accessibilityWarning = '';

        // 1. Check for Chromium browser without CDP (highest priority)
        if (browserInfo && !browserInfo.isDebuggingEnabled && tree.strategy === 'native' && tree.ui.length < 50) {
          const browserCommands: Record<string, string> = {
            chrome: 'open -a "Google Chrome" --args --remote-debugging-port=9222',
            edge: 'open -a "Microsoft Edge" --args --remote-debugging-port=9222',
            brave: 'open -a "Brave Browser" --args --remote-debugging-port=9222',
            arc: 'open -a "Arc" --args --remote-debugging-port=9222',
            chromium: 'open -a "Chromium" --args --remote-debugging-port=9222',
          };

          const command = browserCommands[browserInfo.type] || `${browserInfo.type} --remote-debugging-port=9222`;
          let platformCommand = command;
          if (process.platform === 'win32') {
            platformCommand = `start ${browserInfo.type === 'chrome' ? 'chrome' : browserInfo.type === 'edge' ? 'msedge' : browserInfo.type} --remote-debugging-port=9222`;
          } else if (process.platform === 'linux') {
            platformCommand = `${browserInfo.type === 'chrome' ? 'google-chrome' : browserInfo.type} --remote-debugging-port=9222 &`;
          }

          accessibilityWarning = `🌐 CHROMIUM BROWSER DETECTED WITHOUT CDP - Only ${tree.ui.length} elements detected (native UI Automation)
⚡ ACTION REQUIRED: Enable Chrome DevTools Protocol (CDP) to detect 200-300+ elements instead

STEPS TO ENABLE CDP:
1. Close ${browserInfo.type.charAt(0).toUpperCase() + browserInfo.type.slice(1)} completely
2. Relaunch with remote debugging: ${platformCommand}
3. Take another screenshot to verify CDP is active (Strategy should show "browser" instead of "native")

💡 TIP: You should suggest this to the user immediately so they can enable CDP for better automation.`;
        }
        // 2. Check for Unity game without Bridge (only warn if bridge is NOT active)
        else if (tree.strategy === 'unity' && !tree.unityBridgeActive && tree.ui.length < 10) {
          accessibilityWarning = `🎮 UNITY GAME DETECTED: "${tree.window}"\n⚠️ Strategy: native (Unity Bridge not running)\n\n💡 Unity Bridge provides 10x more elements.\n   Install: Copy OScribeBridge.dll to BepInEx/plugins/`;
        }
        // 2b. Check for CEF app without CDP (Unreal Engine / Epic Games etc.)
        else if (tree.strategy === 'cef' && tree.ui.length < 10) {
          accessibilityWarning = `🔧 CEF APP DETECTED: "${tree.window}"\n⚠️ Only ${tree.ui.length} elements (CDP not active)\n\n💡 To enable full element detection:\n   1. Close the app\n   2. Relaunch with: AppName.exe -cefdebug=9225\n   3. Take another screenshot\n\n   Or use os_browser_restart_with_cdp tool to restart automatically.`;
        }
        // 3. Check for Electron app with limited accessibility
        // Only warn if NVDA/VoiceOver is not running
        else if (process.platform === 'win32' &&
            (tree.strategy === 'electron' || tree.windowClass.includes('Chrome_WidgetWin')) &&
            tree.ui.length < 10 &&
            !isNvdaInstalled()) {
          accessibilityWarning = '⚠️ ELECTRON APP DETECTED - NVDA not installed. Run os_nvda_install then os_nvda_start to see all UI elements.';
        } else if (process.platform === 'darwin' &&
            (tree.strategy === 'electron' || tree.windowClass.includes('Electron')) &&
            tree.ui.length < 10 &&
            !(await isVoiceOverRunning())) {
          accessibilityWarning = '⚠️ ELECTRON APP DETECTED - VoiceOver not running. Run os_voiceover_start to see all UI elements (silent mode, no audio).';
        }

        // Return: 1) Accessibility warning FIRST if needed, 2) Window name, 3) Image info, 4) Instructions, 5) Elements, 6) Image
        const capturedWindow = tree.strategy === 'unity'
          ? `🎮 UNITY GAME: "${tree.window}"`
          : `📸 Captured window: "${tree.window}"`;
        const focusReminder = `→ If this is not the intended window, use os_focus("App Name") first, then take another screenshot.`;
        const instruction = `⚠️ IMPORTANT: To click on elements, use center=(x,y) coordinates from the Elements list below with os_click_at(x, y). Do NOT estimate positions from the image.`;

        // Put accessibility warning FIRST if Electron app detected without screen reader
        const warningFirst = accessibilityWarning ? `${accessibilityWarning.trim()}\n\n` : '';

        return {
          content: [
            {
              type: 'text',
              text: `${warningFirst}${capturedWindow}\n${focusReminder}\n\n${strategyInfo}\n${imageInfo}\n${ratioHint}${windowBoundsInfo}\n\n${instruction}\n\nCursor position: (${cursor.x}, ${cursor.y})\n\nElements (${tree.ui.length}):\n${elementsText || 'No interactive elements found'}${systemText}`,
            },
            {
              type: 'image',
              data: screenshot.base64,
              mimeType: 'image/png',
            },
          ],
        };
      }

      case 'os_windows': {
        const windows = await listWindows();
        const screens = await listScreens();

        return {
          content: [
            {
              type: 'text',
              text: `Windows:\n${windows.map((w) => `- ${w.title}`).join('\n') || 'No windows found'}\n\nScreens:\n${screens.map((s, i) => `- ${i}: ${s.name}`).join('\n')}`,
            },
          ],
        };
      }

      case 'os_focus': {
        const { window: windowName } = FocusSchema.parse(args);
        let success = false;

        await recorder.recordAction('os_focus', { window: windowName }, async () => {
          success = await focusWindow(windowName);
        });

        return {
          content: [
            {
              type: 'text',
              text: success ? `Focused: ${windowName}` : `Could not focus: ${windowName}`,
            },
          ],
        };
      }

      case 'os_scroll': {
        const { direction, amount } = ScrollSchema.parse(args);

        await recorder.recordAction('os_scroll', { direction, amount }, async () => {
          await scroll(direction, amount);
        });

        return {
          content: [
            {
              type: 'text',
              text: `Scrolled ${direction} by ${amount}`,
            },
          ],
        };
      }

      case 'os_hotkey': {
        const { keys } = HotkeySchema.parse(args);
        const keyList = keys.split('+').map((k) => k.trim());

        await recorder.recordAction('os_hotkey', { keys }, async () => {
          await hotkey(keyList);
        });

        return {
          content: [
            {
              type: 'text',
              text: `Pressed: ${keys}`,
            },
          ],
        };
      }

      case 'os_wait': {
        const { ms } = WaitSchema.parse(args);

        await recorder.recordAction('os_wait', { ms }, async () => {
          await new Promise((resolve) => setTimeout(resolve, ms));
        });

        return {
          content: [
            {
              type: 'text',
              text: `Waited ${ms}ms`,
            },
          ],
        };
      }

      case 'os_inspect_at': {
        const { x, y } = InspectPointSchema.parse(args);
        const element = await getElementAtPoint(x, y);

        if (!element) {
          return {
            content: [
              {
                type: 'text',
                text: `No element found at (${x}, ${y})`,
              },
            ],
          };
        }

        const center = { x: element.x + Math.floor(element.width / 2), y: element.y + Math.floor(element.height / 2) };
        return {
          content: [
            {
              type: 'text',
              text: `Element at (${x}, ${y}):\n- Type: ${element.type}\n- Name: "${element.name}"\n- Center: (${center.x}, ${center.y})\n- Bounds: ${element.x},${element.y} ${element.width}x${element.height}\n- Enabled: ${element.isEnabled}${element.automationId ? `\n- AutomationId: ${element.automationId}` : ''}`,
            },
          ],
        };
      }

      case 'os_system_ui': {
        const elements = await findSystemUIElements();

        if (elements.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No system UI elements found. Make sure the desktop or taskbar is visible.',
              },
            ],
          };
        }

        // Format elements with center coordinates for clicking
        const elementsText = elements.map((el) => {
          const cx = el.x + Math.floor(el.width / 2);
          const cy = el.y + Math.floor(el.height / 2);
          const source = (el as { source?: string }).source || 'unknown';
          return `- ${el.type}: "${el.name}" center=(${cx},${cy}) [${el.width}x${el.height}] source=${source}${el.automationId ? ` id="${el.automationId}"` : ''}`;
        }).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `🖥️ Windows System UI Elements (${elements.length}):\n\n⚠️ Use center=(x,y) coordinates with os_click_at(x, y) to click on elements.\n\n${elementsText}`,
            },
          ],
        };
      }

      case 'os_nvda_status': {
        if (process.platform !== 'win32') {
          return {
            content: [{ type: 'text', text: 'NVDA is only available on Windows.' }],
          };
        }

        const status = await getNvdaStatus();
        const statusText = status.installed
          ? status.running
            ? '✅ NVDA is running - Electron accessibility enabled'
            : '⚠️ NVDA installed but not running. Use os_nvda_start to enable Electron accessibility.'
          : '❌ NVDA not installed. Use os_nvda_install to enable Electron accessibility.';

        return {
          content: [{
            type: 'text',
            text: `NVDA Status:\n- Installed: ${status.installed ? 'Yes' : 'No'}\n- Running: ${status.running ? 'Yes' : 'No'}\n- Config: ${status.configValid ? 'Valid' : 'Not configured'}\n\n${statusText}`,
          }],
        };
      }

      case 'os_nvda_install': {
        if (process.platform !== 'win32') {
          return {
            content: [{ type: 'text', text: 'NVDA is only available on Windows.' }],
          };
        }

        if (isNvdaInstalled()) {
          return {
            content: [{ type: 'text', text: '✅ NVDA is already installed. Use os_nvda_start to run it.' }],
          };
        }

        const success = await initNvda(true); // forceDownload=true

        return {
          content: [{
            type: 'text',
            text: success
              ? '✅ NVDA portable installed successfully. Use os_nvda_start to enable Electron accessibility.'
              : '❌ Failed to install NVDA. Check network connection and try again.',
          }],
          isError: !success,
        };
      }

      case 'os_nvda_start': {
        if (process.platform !== 'win32') {
          return {
            content: [{ type: 'text', text: 'NVDA is only available on Windows.' }],
          };
        }

        const running = await isNvdaRunning();
        if (running) {
          return {
            content: [{ type: 'text', text: '✅ NVDA is already running.' }],
          };
        }

        if (!isNvdaInstalled()) {
          return {
            content: [{ type: 'text', text: '❌ NVDA not installed. Use os_nvda_install first.' }],
            isError: true,
          };
        }

        const success = await startNvda(false);

        return {
          content: [{
            type: 'text',
            text: success
              ? '✅ NVDA started in silent mode. Electron apps will now expose their full UI tree.'
              : '❌ Failed to start NVDA.',
          }],
          isError: !success,
        };
      }

      case 'os_nvda_stop': {
        if (process.platform !== 'win32') {
          return {
            content: [{ type: 'text', text: 'NVDA is only available on Windows.' }],
          };
        }

        const success = await stopNvda();

        return {
          content: [{
            type: 'text',
            text: success ? '✅ NVDA stopped.' : '❌ Failed to stop NVDA.',
          }],
          isError: !success,
        };
      }

      case 'os_voiceover_status': {
        if (process.platform !== 'darwin') {
          return {
            content: [{ type: 'text', text: 'VoiceOver is only available on macOS.' }],
          };
        }

        const status = await getVoiceOverStatus();
        const statusText = status.running
          ? '✅ VoiceOver is running - Electron accessibility enabled'
          : '⚠️ VoiceOver not running. Use os_voiceover_start to enable Electron accessibility.';

        return {
          content: [{
            type: 'text',
            text: `VoiceOver Status:\n- Available: ${status.available ? 'Yes' : 'No'}\n- Running: ${status.running ? 'Yes' : 'No'}\n- Can control: ${status.canControl ? 'Yes' : 'No (grant Accessibility permissions)'}\n\n${statusText}`,
          }],
        };
      }

      case 'os_voiceover_start': {
        if (process.platform !== 'darwin') {
          return {
            content: [{ type: 'text', text: 'VoiceOver is only available on macOS.' }],
          };
        }

        const running = await isVoiceOverRunning();
        if (running) {
          return {
            content: [{ type: 'text', text: '✅ VoiceOver is already running.' }],
          };
        }

        const success = await startVoiceOver(true); // silent=true

        return {
          content: [{
            type: 'text',
            text: success
              ? '✅ VoiceOver started in silent mode (no audio). Electron apps will now expose their full UI tree.'
              : '❌ Failed to start VoiceOver.',
          }],
          isError: !success,
        };
      }

      case 'os_voiceover_stop': {
        if (process.platform !== 'darwin') {
          return {
            content: [{ type: 'text', text: 'VoiceOver is only available on macOS.' }],
          };
        }

        const success = await stopVoiceOver(true); // restoreSpeech=true

        return {
          content: [{
            type: 'text',
            text: success ? '✅ VoiceOver stopped.' : '❌ Failed to stop VoiceOver.',
          }],
          isError: !success,
        };
      }

      case 'os_browser_restart_with_cdp': {
        const BrowserRestartSchema = z.object({
          port: z.number().optional().default(9222),
          window: z.string().optional(),
        });

        const { port, window } = BrowserRestartSchema.parse(args);

        await recorder.recordAction('os_browser_restart_with_cdp', { port, window }, async () => {
          // Action recorded in the function itself
        });

        // Check if active window is a CEF app (Unreal Engine / Epic Games etc.)
        const uiTree = await getUIElements();
        if (uiTree.strategy === 'cef') {
          console.error(`CEF app detected, restarting with -cefdebug=${port === 9222 ? 9225 : port}...`);
          const { restartCEFWithCDP } = await import('../core/browser-restart.js');
          const cefResult = await restartCEFWithCDP(port === 9222 ? 9225 : port);

          if (!cefResult.success) {
            return {
              content: [{
                type: 'text',
                text: `❌ Failed to restart CEF app with CDP: ${cefResult.error || 'Unknown error'}`,
              }],
              isError: true,
            };
          }

          // Take screenshot to verify
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const cefScreenshot = await captureScreen({ screen: 0 });
          const cefCursor = getMousePosition();
          const cefTree = await getUIElements();

          const cefWidth = cefScreenshot.width ?? 0;
          const cefHeight = cefScreenshot.height ?? 0;
          const cefClientVersion = server.getClientVersion();
          const { ratio: cefRatio, clientType: cefClientType } = calculateImageRatio(cefWidth, cefHeight, cefClientVersion?.name);

          const cefStrategyInfo = `🔧 Strategy: ${cefTree.strategy}${cefTree.strategy === 'cef' && cefTree.ui.length >= 10 ? ' (CEF CDP active ✓)' : ' (CEF CDP not active ⚠️)'}`;

          return {
            content: [
              {
                type: 'text',
                text: `✅ CEF app restarted with -cefdebug=${port === 9222 ? 9225 : port}!\n\n📊 Results:\n- CDP enabled: ${cefResult.cdpEnabled ? 'Yes ✓' : 'No ✗'}\n\n📸 Screenshot after restart:\n${cefStrategyInfo}\n📐 Screenshot: ${cefWidth}x${cefHeight} | Client: ${cefClientType} | Ratio: ${cefRatio.toFixed(3)}\nCursor: (${cefCursor.x}, ${cefCursor.y})\n\nElements detected: ${cefTree.ui.length}\n\nFirst 10 elements:\n${cefTree.ui.slice(0, 10).map((el) => {
                  const cx = el.x + Math.floor(el.width / 2);
                  const cy = el.y + Math.floor(el.height / 2);
                  return `- ${el.type}: "${el.name}" center=(${cx},${cy})`;
                }).join('\n')}`,
              },
              {
                type: 'image',
                data: cefScreenshot.base64,
                mimeType: 'image/png',
              },
            ],
          };
        }

        console.error(`Restarting browser with CDP on port ${port}${window ? ` (targeting: ${window})` : ''}...`);
        const result = await restartBrowserWithCDP(port, window);

        if (!result.success) {
          return {
            content: [{
              type: 'text',
              text: `❌ Failed to restart browser with CDP: ${result.error || 'Unknown error'}`,
            }],
            isError: true,
          };
        }

        // Take a screenshot automatically after restart to verify CDP is active
        console.error('Browser restarted, taking screenshot to verify CDP...');
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for browser to stabilize

        const screenshot = await captureScreen({ screen: 0 });
        const cursor = getMousePosition();
        const tree = await getUIElements();

        // Calculate resize ratio
        const width = screenshot.width ?? 0;
        const height = screenshot.height ?? 0;
        const clientVersion = server.getClientVersion();
        const { ratio, clientType } = calculateImageRatio(width, height, clientVersion?.name);

        // Format elements (not used in output but kept for potential future use)
        // const elementsText = tree.ui.map((el) => {
        //   const cx = el.x + Math.floor(el.width / 2);
        //   const cy = el.y + Math.floor(el.height / 2);
        //   return `- ${el.type}: "${el.name}" pos=(${el.x},${el.y}) center=(${cx},${cy}) [${el.width}x${el.height}]`;
        // }).join('\n');

        const strategyInfo = `🔧 Strategy: ${tree.strategy}${tree.strategy === 'browser' ? ' (CDP active ✓)' : ' (CDP not enabled ⚠️)'}`;
        const successMessage = `✅ Browser restarted successfully with CDP enabled!

📊 Results:
- Browser: ${result.browser}
- Tabs saved: ${result.tabsSaved}
- Tabs restored: ${result.tabsRestored}
- CDP enabled: ${result.cdpEnabled ? 'Yes ✓' : 'No ✗'}

📸 Screenshot after restart:
${strategyInfo}
📐 Screenshot: ${width}x${height} | Client: ${clientType} | Ratio: ${ratio.toFixed(3)}
Cursor: (${cursor.x}, ${cursor.y})

Elements detected: ${tree.ui.length} (was ~4 before, now ${tree.ui.length}!)

First 10 elements:
${tree.ui.slice(0, 10).map((el) => {
  const cx = el.x + Math.floor(el.width / 2);
  const cy = el.y + Math.floor(el.height / 2);
  return `- ${el.type}: "${el.name}" center=(${cx},${cy})`;
}).join('\n')}`;

        return {
          content: [
            {
              type: 'text',
              text: successMessage,
            },
            {
              type: 'image',
              data: screenshot.base64,
              mimeType: 'image/png',
            },
          ],
        };
      }

      case 'os_mouse_down': {
        const { button } = MouseToggleSchema.parse(args);
        const pos = getMousePosition();

        await recorder.recordAction('os_mouse_down', { x: pos.x, y: pos.y, button }, async () => {
          await mouseDown(button);
        });

        return {
          content: [
            {
              type: 'text',
              text: `Mouse ${button} button pressed at (${pos.x}, ${pos.y})`,
            },
          ],
        };
      }

      case 'os_mouse_up': {
        const { button } = MouseToggleSchema.parse(args);
        const pos = getMousePosition();

        await recorder.recordAction('os_mouse_up', { x: pos.x, y: pos.y, button }, async () => {
          await mouseUp(button);
        });

        return {
          content: [
            {
              type: 'text',
              text: `Mouse ${button} button released at (${pos.x}, ${pos.y})`,
            },
          ],
        };
      }

      case 'os_drag': {
        const { fromX, fromY, toX, toY, button, duration } = DragSchema.parse(args);

        await recorder.recordAction('os_drag', { fromX, fromY, toX, toY, button, duration }, async () => {
          await drag(fromX, fromY, toX, toY, { button, duration });
        });

        return {
          content: [
            {
              type: 'text',
              text: `Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY})`,
            },
          ],
        };
      }

      case 'os_unity_setup': {
        const { gamePath, step, force } = UnitySetupSchema.parse(args);

        const opts: Parameters<typeof setupUnityBridge>[0] = { step, force };
        if (gamePath) opts.gamePath = gamePath;

        const result = await setupUnityBridge(opts);

        // Format output
        const stepsText = result.steps.map((s) => {
          const icon = s.status === 'success' ? '✅' : s.status === 'skipped' ? '⏭️' : s.status === 'pending' ? '⏳' : '❌';
          const duration = s.duration_ms ? ` (${s.duration_ms}ms)` : '';
          return `${icon} ${s.name}: ${s.message}${duration}`;
        }).join('\n');

        const header = result.success
          ? `🎮 Unity Bridge setup ${step === 'detect' ? 'analysis' : 'complete'} for "${result.gameName}"`
          : `❌ Unity Bridge setup failed for "${result.gameName}"`;

        const meta = [
          `Game: ${result.gamePath}`,
          `Platform: ${result.platform} | Runtime: ${result.runtime}${result.compilationMode ? ` | Mode: ${result.compilationMode}` : ''}`,
        ].join('\n');

        const nextStepText = result.nextStep ? `\n👉 Next: ${result.nextStep}` : '';
        const errorText = result.error && !result.success ? `\n⚠️ Error: ${result.error}` : '';

        return {
          content: [{
            type: 'text',
            text: `${header}\n\n${meta}\n\nSteps:\n${stepsText}${nextStepText}${errorText}`,
          }],
          isError: !result.success,
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    // Format error message based on type
    let errorMessage = error instanceof Error ? error.message : String(error);

    // Security errors get special prefixes for clarity
    if (error instanceof RestrictedActionError) {
      errorMessage = `[RESTRICTED] ${error.message}`;
    } else if (error instanceof UserInterruptError) {
      errorMessage = `[KILL SWITCH] ${error.message}`;
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

export async function startServer(): Promise<void> {
  // NVDA is now started on-demand when Electron apps are detected (see uiautomation.ts)
  // and auto-stopped after UI scan to avoid keyboard interference (config: nvda.autoStop)

  // Test log file writing
  const testLogFile = join(homedir(), 'Desktop', 'oscribe-mcp-server-test.log');
  try {
    appendFileSync(testLogFile, `[${new Date().toISOString()}] MCP server starting...\n`, 'utf8');
  } catch (err) {
    console.error('Failed to write test log:', err);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('OScribe MCP server started');

  try {
    appendFileSync(testLogFile, `[${new Date().toISOString()}] MCP server started successfully\n`, 'utf8');
  } catch (err) {
    console.error('Failed to write test log:', err);
  }
}
