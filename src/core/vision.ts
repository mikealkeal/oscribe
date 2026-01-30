/**
 * Vision module - Claude API integration
 * Supports:
 * - CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`)
 * - API key (ANTHROPIC_API_KEY or config)
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { getApiKey, loadConfig } from '../config/index.js';

const CoordinatesSchema = z.object({
  x: z.number(),
  y: z.number(),
  confidence: z.number().min(0).max(1).optional(),
});

export type Coordinates = z.infer<typeof CoordinatesSchema>;

export interface LocateOptions {
  retries?: number;
  retryDelay?: number;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) {
    return client;
  }

  // Priority: CLAUDE_CODE_OAUTH_TOKEN > API key > ANTHROPIC_API_KEY
  const oauthToken = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  if (oauthToken) {
    client = new Anthropic({ apiKey: oauthToken });
    return client;
  }

  const apiKey = getApiKey();
  if (apiKey) {
    client = new Anthropic({ apiKey });
    return client;
  }

  throw new Error(
    'Not authenticated. Options:\n' +
    '  1. Run "claude setup-token" and set CLAUDE_CODE_OAUTH_TOKEN\n' +
    '  2. Run "osbot login --key sk-ant-xxx" with your API key'
  );
}

export async function locateElement(
  target: string,
  screenshotBase64: string,
  options: LocateOptions = {}
): Promise<Coordinates> {
  const { retries = 3, retryDelay = 1000 } = options;

  const prompt = `Look at this screenshot and find the element described as: "${target}"

Return ONLY a JSON object with the x,y coordinates of the center of the element:
{"x": number, "y": number, "confidence": number}

The confidence should be between 0 and 1, where 1 means you are certain.
If the element is not found, return {"x": -1, "y": -1, "confidence": 0}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const anthropic = getClient();
      const config = loadConfig();

      const response = await anthropic.messages.create({
        model: config.model,
        max_tokens: config.maxTokensLocate,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: screenshotBase64,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      });

      const text =
        response.content[0]?.type === 'text' ? response.content[0].text : '';

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      const coordinates = CoordinatesSchema.parse(parsed);

      if (coordinates.x === -1 && coordinates.y === -1) {
        throw new Error(`Element not found: "${target}"`);
      }

      return coordinates;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Reset client on auth errors to retry with fresh token
      if (lastError.message.includes('401') || lastError.message.includes('auth')) {
        client = null;
      }

      if (attempt < retries - 1) {
        await sleep(retryDelay);
      }
    }
  }

  throw lastError ?? new Error('Failed to locate element');
}

export async function describeScreen(screenshotBase64: string): Promise<string> {
  const anthropic = getClient();
  const config = loadConfig();

  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: config.maxTokensDescribe,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: screenshotBase64,
            },
          },
          {
            type: 'text',
            text: 'Describe what you see on this screen. List the main UI elements visible.',
          },
        ],
      },
    ],
  });

  return response.content[0]?.type === 'text' ? response.content[0].text : '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
