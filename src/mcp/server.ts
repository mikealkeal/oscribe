/**
 * MCP Server for OSbot
 * Exposes desktop automation tools via Model Context Protocol
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureScreen, listScreens } from '../core/screenshot.js';
import { click, typeText, hotkey, scroll, moveMouse, getMousePosition, clickAtCurrentPosition } from '../core/input.js';
import { listWindows, focusWindow } from '../core/windows.js';
import { getUIElements, getElementAtPoint } from '../core/uiautomation.js';
import { RestrictedActionError } from '../core/security.js';
import { UserInterruptError } from '../core/killswitch.js';
import { SessionRecorder, ScreenContext } from '../core/session-recorder.js';

// Get version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../../package.json'), 'utf-8')
) as {
  version: string;
};

const server = new Server(
  {
    name: 'osbot',
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

// Session recorder - initialized on first action
let sessionRecorder: SessionRecorder | null = null;

function getRecorder(): SessionRecorder {
  if (!sessionRecorder) {
    sessionRecorder = new SessionRecorder('MCP Session');
  }
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

Example: To click on Button "Enregistrer" center=(951,658) → use os_click_at(x=951, y=658)`,
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
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const recorder = getRecorder();

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

        // Get UI elements from focused window
        const tree = await getUIElements();

        // Helper to format element with centered coordinates
        const formatElement = (el: typeof tree.ui[0]) => ({
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
          elements: tree.elements.map(formatElement),
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

        // Return: 1) Instructions, 2) JSON with coordinates, 3) Image for visual context
        const instruction = `⚠️ IMPORTANT: To click on elements, use center=(x,y) coordinates from the Elements list below with os_click_at(x, y). Do NOT estimate positions from the image.`;

        return {
          content: [
            {
              type: 'text',
              text: `${instruction}\n\nCursor position: (${cursor.x}, ${cursor.y})\n\nWindow: ${tree.window}\nElements (${tree.ui.length}):\n${elementsText || 'No interactive elements found'}`,
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('OSbot MCP server started');
}
