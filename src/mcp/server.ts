/**
 * MCP Server for OSbot
 * Exposes desktop automation tools via Model Context Protocol
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { captureScreen, listScreens } from '../core/screenshot.js';
import { locateElement, describeScreen } from '../core/vision.js';
import { click, typeText, hotkey, scroll } from '../core/input.js';
import { listWindows, focusWindow } from '../core/windows.js';

const server = new Server(
  {
    name: 'osbot',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool schemas
const ClickSchema = z.object({
  target: z.string().describe('Description of the element to click'),
  window: z.string().optional().describe('Window to focus first'),
  screen: z.number().default(0).describe('Screen number'),
});

const TypeSchema = z.object({
  text: z.string().describe('Text to type'),
});

const ScreenshotSchema = z.object({
  window: z.string().optional().describe('Window to capture'),
  screen: z.number().default(0).describe('Screen number'),
  describe: z.boolean().default(false).describe('Describe screen content'),
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
        name: 'os_click',
        description: 'Click on an element identified by description using vision',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Description of the element to click' },
            window: { type: 'string', description: 'Window to focus first (optional)' },
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
        description: 'Capture a screenshot and optionally describe its content',
        inputSchema: {
          type: 'object',
          properties: {
            screen: { type: 'number', description: 'Screen number (default: 0)' },
            describe: { type: 'boolean', description: 'Describe screen content (default: false)' },
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
      case 'os_click': {
        const { target, window: windowName, screen } = ClickSchema.parse(args);

        if (windowName) {
          await focusWindow(windowName);
        }

        const screenshot = await captureScreen({ screen });
        const coords = await locateElement(target, screenshot.base64);
        await click(coords.x, coords.y);

        return {
          content: [
            {
              type: 'text',
              text: `Clicked on "${target}" at (${coords.x}, ${coords.y})`,
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
        const { screen, describe } = ScreenshotSchema.parse(args);
        const screenshot = await captureScreen({ screen });

        if (describe) {
          const description = await describeScreen(screenshot.base64);
          return {
            content: [
              {
                type: 'text',
                text: description,
              },
            ],
          };
        }

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
