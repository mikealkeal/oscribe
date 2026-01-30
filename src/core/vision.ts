/**
 * Vision module - Claude API integration
 * Supports OAuth (Claude Max/Pro) and API key authentication
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { getApiKey } from '../config/index.js';
import { getAccessToken, isLoggedIn } from './auth.js';

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

async function getClient(): Promise<Anthropic> {
  if (client) {
    return client;
  }

  // Priority: OAuth token > API key > Environment variable
  if (isLoggedIn()) {
    try {
      const accessToken = await getAccessToken();
      client = new Anthropic({
        apiKey: accessToken, // OAuth token works as API key
      });
      return client;
    } catch {
      // OAuth failed, try API key
    }
  }

  const apiKey = getApiKey();
  if (apiKey) {
    client = new Anthropic({ apiKey });
    return client;
  }

  throw new Error('Not authenticated. Run "osbot login" to authenticate with your Claude account.');
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
      const anthropic = await getClient();

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
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
  const anthropic = await getClient();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
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
