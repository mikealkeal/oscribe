/**
 * AXManualAccessibility Management
 *
 * Enables macOS Accessibility Tree for Electron apps WITHOUT VoiceOver.
 * This is the preferred method as it:
 * - Has no audio output
 * - Is faster (no screen reader startup time)
 * - Is lighter (no additional process)
 * - Works on macOS only
 *
 * How it works:
 * - Uses the AXManualAccessibility attribute to force Electron/Chromium
 *   to expose its accessibility tree
 * - This attribute can be set programmatically on any running app
 * - No system-wide screen reader needed
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);

const isMacOS = process.platform === 'darwin';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the enable_ax binary
const ENABLE_AX_BIN = path.join(__dirname, '../../bin/enable_ax');

// Simple logger
const logger = {
  debug: (msg: string, data?: Record<string, unknown>): void => {
    if (process.env['DEBUG']) console.log(`[axmanual] ${msg}`, data ?? '');
  },
  info: (msg: string, data?: Record<string, unknown>): void => {
    console.log(`[axmanual] ${msg}`, data ?? '');
  },
  warn: (msg: string, data?: Record<string, unknown>): void => {
    console.warn(`[axmanual] ${msg}`, data ?? '');
  },
  error: (msg: string, data?: Record<string, unknown>): void => {
    console.error(`[axmanual] ${msg}`, data ?? '');
  },
};

export interface AXManualStatus {
  available: boolean;
  platform: string;
}

/**
 * Check if AXManualAccessibility is available on this system
 * Only available on macOS
 */
export function isAXManualAvailable(): boolean {
  return isMacOS;
}

/**
 * Enable AXManualAccessibility for a specific app
 * @param appNameOrPid - App name, bundle ID, or PID
 * @returns Promise<boolean> - true if successful
 */
export async function enableAXManual(appNameOrPid: string | number): Promise<boolean> {
  if (!isMacOS) {
    logger.debug('AXManualAccessibility only available on macOS');
    return false;
  }

  try {
    const target = String(appNameOrPid);
    logger.debug(`Enabling AXManualAccessibility for: ${target}`);

    const { stdout, stderr } = await execAsync(`"${ENABLE_AX_BIN}" "${target}"`);

    if (stdout.includes('SUCCESS')) {
      logger.info(`AXManualAccessibility enabled for ${target}`);
      return true;
    } else {
      logger.warn(`Failed to enable AXManualAccessibility: ${stderr || stdout}`);
      return false;
    }
  } catch (error) {
    logger.error('Failed to enable AXManualAccessibility', { error: String(error) });
    return false;
  }
}

/**
 * Get AXManualAccessibility status
 */
export async function getAXManualStatus(): Promise<AXManualStatus> {
  return {
    available: isAXManualAvailable(),
    platform: process.platform,
  };
}

/**
 * Enable accessibility for an Electron app
 * This is a convenience function that handles common Electron app scenarios
 */
export async function enableElectronAccessibility(
  appIdentifier: string | number
): Promise<boolean> {
  if (!isMacOS) {
    logger.debug('Electron accessibility only needed on macOS');
    return false;
  }

  return enableAXManual(appIdentifier);
}
