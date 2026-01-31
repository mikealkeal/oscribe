/**
 * Security module - Restricted mode
 * Blocks actions on sensitive apps and dangerous hotkeys
 */

import { loadConfig } from '../config/index.js';
import { getActiveWindow } from './windows.js';

/**
 * Custom error for restricted actions
 * Following error-handling-patterns skill
 */
export class RestrictedActionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'RestrictedActionError';
    // Preserve stack trace (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Normalize hotkey for comparison
 * "Ctrl+Alt+Delete" -> "alt+ctrl+delete" (sorted, lowercase)
 */
function normalizeHotkey(keys: string[]): string {
  return keys.map(k => k.toLowerCase()).sort().join('+');
}

/**
 * Check if action is allowed based on restricted mode config
 * Throws RestrictedActionError if blocked
 */
export async function checkRestrictions(
  action: string,
  params: Record<string, unknown>
): Promise<void> {
  const config = loadConfig();
  const { restrictedMode } = config;

  // Skip if restricted mode is disabled
  if (!restrictedMode.enabled) {
    return;
  }

  // Check blocked hotkeys
  if (action === 'hotkey' && Array.isArray(params['keys'])) {
    const inputKeys = params['keys'] as string[];
    const normalized = normalizeHotkey(inputKeys);

    const blocked = restrictedMode.blockedHotkeys.find(
      h => normalizeHotkey(h.split('+')) === normalized
    );

    if (blocked) {
      throw new RestrictedActionError(
        `Hotkey "${inputKeys.join('+')}" is blocked by security policy`,
        'BLOCKED_HOTKEY',
        { hotkey: inputKeys, pattern: blocked }
      );
    }
  }

  // Check blocked apps for UI-interacting actions
  if (['click', 'type', 'hotkey', 'scroll'].includes(action)) {
    const activeWindow = await getActiveWindow();

    if (activeWindow) {
      const title = activeWindow.title.toLowerCase();

      // Whitelist mode: if allowedApps is non-empty, only those are allowed
      if (restrictedMode.allowedApps.length > 0) {
        const allowed = restrictedMode.allowedApps.some(
          app => title.includes(app.toLowerCase())
        );

        if (!allowed) {
          throw new RestrictedActionError(
            `App "${activeWindow.title}" is not in allowed list`,
            'APP_NOT_ALLOWED',
            { window: activeWindow.title, allowedApps: restrictedMode.allowedApps }
          );
        }
        return;
      }

      // Blacklist mode: check if app matches any blocked pattern
      const blocked = restrictedMode.blockedApps.find(
        app => title.includes(app.toLowerCase())
      );

      if (blocked) {
        throw new RestrictedActionError(
          `Actions blocked on "${activeWindow.title}" (matches: "${blocked}")`,
          'BLOCKED_APP',
          { window: activeWindow.title, pattern: blocked }
        );
      }
    }
  }
}
