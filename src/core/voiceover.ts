/**
 * VoiceOver Screen Reader Management
 *
 * Manages VoiceOver for Electron app accessibility on macOS.
 * VoiceOver triggers Chromium/Electron to expose accessibility trees
 * that are otherwise invisible to standard accessibility APIs.
 *
 * Why VoiceOver is needed:
 * - Electron/Chromium only exposes its accessibility tree when a screen reader is detected
 * - VoiceOver on macOS triggers this behavior system-wide
 * - Without it, Electron apps show minimal UI elements (3-5 instead of 100+)
 *
 * Platform note:
 * - This module only works on macOS (darwin)
 * - On Windows/Linux, all functions return false/no-op
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const isMacOS = process.platform === 'darwin';

// Simple logger for VoiceOver module
const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => {
    if (process.env['DEBUG']) console.log(`[voiceover] ${msg}`, data ?? '');
  },
  info: (msg: string, data?: Record<string, unknown>) => {
    console.log(`[voiceover] ${msg}`, data ?? '');
  },
  warn: (msg: string, data?: Record<string, unknown>) => {
    console.warn(`[voiceover] ${msg}`, data ?? '');
  },
  error: (msg: string, data?: Record<string, unknown>) => {
    console.error(`[voiceover] ${msg}`, data ?? '');
  },
};

export interface VoiceOverStatus {
  available: boolean;
  running: boolean;
  canControl: boolean;
  platform: string;
}

/**
 * Check if VoiceOver is available on this system
 * Only available on macOS
 */
export function isVoiceOverAvailable(): boolean {
  return isMacOS;
}

/**
 * Check if VoiceOver is currently running
 */
export async function isVoiceOverRunning(): Promise<boolean> {
  if (!isMacOS) {
    return false;
  }

  try {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to return (name of processes) contains "VoiceOver"'`
    );
    return stdout.trim().toLowerCase() === 'true';
  } catch {
    logger.debug('Failed to check VoiceOver status');
    return false;
  }
}

/**
 * Start VoiceOver
 * @param silent - If true, mute speech output (keep accessibility tree access)
 */
export async function startVoiceOver(silent = false): Promise<boolean> {
  if (!isMacOS) {
    logger.debug('VoiceOver only available on macOS');
    return false;
  }

  try {
    // Check if already running
    if (await isVoiceOverRunning()) {
      logger.debug('VoiceOver already running');
      return true;
    }

    logger.info('Starting VoiceOver...');

    // Configure speech settings BEFORE starting VoiceOver
    if (silent) {
      await execAsync('defaults write com.apple.VoiceOver4.default SCREnableSpeech -int 0');
      logger.debug('VoiceOver speech disabled in preferences');
    }

    // Start VoiceOver using open command (more reliable than AppleScript)
    await execAsync('open -a VoiceOver');

    // Wait for VoiceOver to start (needs time to initialize)
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Verify it started
    const running = await isVoiceOverRunning();
    if (!running) {
      logger.warn('VoiceOver did not start');
      return false;
    }

    logger.info('VoiceOver started successfully');
    return true;
  } catch (error) {
    logger.error('Failed to start VoiceOver', { error: String(error) });
    return false;
  }
}

/**
 * Stop VoiceOver
 * @param restoreSpeech - If true, unmute before stopping
 */
export async function stopVoiceOver(restoreSpeech = false): Promise<boolean> {
  if (!isMacOS) {
    return true; // No-op on non-macOS
  }

  try {
    if (!(await isVoiceOverRunning())) {
      logger.debug('VoiceOver not running');
      return true;
    }

    if (restoreSpeech) {
      await execAsync('defaults write com.apple.VoiceOver4.default SCREnableSpeech -int 1');
      logger.debug('VoiceOver speech re-enabled in preferences');
    }

    logger.info('Stopping VoiceOver...');

    // Stop VoiceOver using killall (more reliable)
    await execAsync('killall VoiceOver');

    // Wait for VoiceOver to stop
    await new Promise((resolve) => setTimeout(resolve, 1000));

    logger.info('VoiceOver stopped');
    return true;
  } catch (error) {
    logger.error('Failed to stop VoiceOver', { error: String(error) });
    return false;
  }
}

/**
 * Get VoiceOver status
 */
export async function getVoiceOverStatus(): Promise<VoiceOverStatus> {
  const canControl = await checkAccessibilityPermissions();
  return {
    available: isVoiceOverAvailable(),
    running: await isVoiceOverRunning(),
    canControl,
    platform: process.platform,
  };
}

/**
 * Check if we have accessibility permissions to control VoiceOver
 */
async function checkAccessibilityPermissions(): Promise<boolean> {
  if (!isMacOS) {
    return false;
  }

  try {
    // Try to check if System Events can be controlled
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to return true'`
    );
    return stdout.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/**
 * Ensure VoiceOver is running for Electron app accessibility
 * Starts VoiceOver in silent mode if not already running
 * Used by uiautomation.ts for Electron apps with low element counts
 */
export async function ensureVoiceOverForElectron(): Promise<boolean> {
  if (!isMacOS) {
    return false;
  }

  // Check if already running
  if (await isVoiceOverRunning()) {
    logger.debug('VoiceOver already running for Electron');
    return true;
  }

  // Start in silent mode
  return startVoiceOver(true);
}

