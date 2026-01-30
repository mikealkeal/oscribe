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
import { click, typeText, hotkey, scroll, moveMouse } from '../core/input.js';
import { listWindows, focusWindow } from '../core/windows.js';
import { locateElement } from '../core/vision.js';

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

const ClickSchema = z.object({
  target: z.string().describe('Description of the element to click'),
  screen: z.number().default(0).describe('Screen number (default: 0)'),
  window: z.string().optional().describe('Window to focus first (optional)'),
});

const ClickAtSchema = z.object({
  x: z.number().describe('X coordinate to click'),
  y: z.number().describe('Y coordinate to click'),
  window: z.string().optional().describe('Window to focus first (optional)'),
});

const LocateSchema = z.object({
  target: z.string().describe('Description of the element to locate'),
  screen: z.number().default(0).describe('Screen number (default: 0)'),
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
        description: 'Click on an element identified by description using AI vision',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Description of the element to click (e.g., "Submit button", "File menu")' },
            screen: { type: 'number', description: 'Screen number (default: 0)' },
            window: { type: 'string', description: 'Window to focus first (optional)' },
          },
          required: ['target'],
        },
      },
      {
        name: 'os_click_at',
        description: 'Click at specific screen coordinates (fallback for when exact coordinates are known)',
        inputSchema: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate to click' },
            y: { type: 'number', description: 'Y coordinate to click' },
            window: { type: 'string', description: 'Window to focus first (optional)' },
          },
          required: ['x', 'y'],
        },
      },
      {
        name: 'os_locate',
        description: 'Locate an element by description and return its coordinates without clicking',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Description of the element to locate' },
            screen: { type: 'number', description: 'Screen number (default: 0)' },
          },
          required: ['target'],
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
        description: 'Capture a screenshot',
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
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'os_move': {
        const { x, y } = MoveSchema.parse(args);
        await moveMouse(x, y);

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
        const { target, screen, window: windowName } = ClickSchema.parse(args);

        if (windowName) {
          await focusWindow(windowName);
        }

        // Capture screenshot
        const screenshot = await captureScreen({ screen });

        // Locate element using vision
        const coords = await locateElement(target, screenshot.base64);

        // Click at located coordinates
        await click(coords.x, coords.y);

        return {
          content: [
            {
              type: 'text',
              text: `Found "${target}" at (${coords.x}, ${coords.y}) with ${((coords.confidence ?? 0) * 100).toFixed(0)}% confidence. Clicked successfully.`,
            },
          ],
        };
      }

      case 'os_click_at': {
        const { x, y, window: windowName } = ClickAtSchema.parse(args);

        if (windowName) {
          await focusWindow(windowName);
        }

        await click(x, y);

        return {
          content: [
            {
              type: 'text',
              text: `Clicked at (${x}, ${y})`,
            },
          ],
        };
      }

      case 'os_locate': {
        const { target, screen } = LocateSchema.parse(args);

        // Capture screenshot
        const screenshot = await captureScreen({ screen });

        // Locate element using vision
        const coords = await locateElement(target, screenshot.base64);

        return {
          content: [
            {
              type: 'text',
              text: `Found "${target}" at (${coords.x}, ${coords.y}) with ${((coords.confidence ?? 0) * 100).toFixed(0)}% confidence.`,
            },
          ],
        };
      }

      case 'os_type': {
        const { text } = TypeSchema.parse(args);
        await typeText(text);

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

        // Always return raw image - let MCP client (Claude Code) analyze it
        return {
          content: [
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
        const success = await focusWindow(windowName);

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
        await scroll(direction, amount);

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
        await hotkey(keyList);

        return {
          content: [
            {
              type: 'text',
              text: `Pressed: ${keys}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
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
