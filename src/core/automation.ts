/**
 * Automation module - Intelligent action loops with verification
 */

import { captureScreen } from './screenshot.js';
import { locateElement, verifyAction } from './vision.js';
import { click as inputClick } from './input.js';
import { loadConfig } from '../config/index.js';

export interface SmartClickOptions {
  screen?: number;
  maxAttempts?: number;
  verifyDelay?: number;
  button?: 'left' | 'right' | 'middle';
  verbose?: boolean;
}

export interface SmartClickResult {
  success: boolean;
  attempts: number;
  coordinates?: { x: number; y: number };
  confidence?: number | undefined;
  error?: string;
}

/**
 * Smart click with feedback loop and retry logic
 * 1. Screenshot
 * 2. Locate element
 * 3. Click
 * 4. Wait + Screenshot again
 * 5. Verify action succeeded
 * 6. Retry if failed
 */
export async function smartClick(
  target: string,
  options: SmartClickOptions = {}
): Promise<SmartClickResult> {
  const config = loadConfig();
  const {
    screen = config.defaultScreen,
    maxAttempts = 3,
    verifyDelay = 800,
    button = 'left',
    verbose = false,
  } = options;

  let lastError: string | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (verbose) {
        console.log(`[Attempt ${attempt + 1}/${maxAttempts}] Looking for "${target}"...`);
      }

      // 1. Capture BEFORE screenshot
      const beforeScreenshot = await captureScreen({ screen });

      // 2. Locate element
      const coords = await locateElement(target, beforeScreenshot.base64);

      if (verbose) {
        console.log(
          `Found at (${coords.x}, ${coords.y}) with ${((coords.confidence ?? 0) * 100).toFixed(0)}% confidence`
        );
      }

      // 3. Click
      await inputClick(coords.x, coords.y, { button });

      // 4. Wait for UI to update
      await sleep(verifyDelay);

      // 5. Capture AFTER screenshot
      const afterScreenshot = await captureScreen({ screen });

      // 6. Verify action succeeded
      const verified = await verifyAction(
        beforeScreenshot.base64,
        afterScreenshot.base64,
        'click',
        target
      );

      if (verified) {
        if (verbose) {
          console.log(`✓ Action verified successfully`);
        }

        return {
          success: true,
          attempts: attempt + 1,
          coordinates: { x: coords.x, y: coords.y },
          confidence: coords.confidence,
        };
      }

      lastError = 'Action verification failed - no visible change detected';

      if (verbose) {
        console.log(`✗ Verification failed, retrying...`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);

      if (verbose) {
        console.log(`✗ Error: ${lastError}`);
      }
    }
  }

  return {
    success: false,
    attempts: maxAttempts,
    error: lastError ?? 'Unknown error',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
