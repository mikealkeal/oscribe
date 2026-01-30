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
        description: 'Capture a screenshot and get current cursor position. Returns the image AND cursor coordinates (x, y) for calibration. Always check cursor position before clicking to ensure accuracy.',
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
        // Click at current cursor position (no movement)
        const { window: windowName, button } = ClickAtSchema.parse(args);

        if (windowName) {
          await focusWindow(windowName);
        }

        const pos = getMousePosition();
        await clickAtCurrentPosition({ button });

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

        if (windowName) {
          await focusWindow(windowName);
        }

        await click(x, y, { button });

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
        const cursor = getMousePosition();

        // Return image + cursor position for calibration
        return {
          content: [
            {
              type: 'image',
              data: screenshot.base64,
              mimeType: 'image/png',
            },
            {
              type: 'text',
              text: `Cursor position: (${cursor.x}, ${cursor.y})`,
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

      case 'os_wait': {
        const { ms } = WaitSchema.parse(args);
        await new Promise((resolve) => setTimeout(resolve, ms));

        return {
          content: [
            {
              type: 'text',
              text: `Waited ${ms}ms`,
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
