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
    // If VoiceOver is already running, stop it first to apply new preferences
    if (await isVoiceOverRunning()) {
      logger.debug('VoiceOver already running, restarting to apply preferences...');
      await execAsync('killall VoiceOver');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    logger.info('Starting VoiceOver...');

    // Configure speech settings BEFORE starting VoiceOver
    // VoiceOver MUST be stopped when we write these preferences
    // Write to BOTH preference domains to ensure settings are applied
    if (silent) {
      // Set volume to 0 in both preference domains
      await execAsync('defaults write com.apple.VoiceOver4.default SCRAudioVolume -float 0.0');
      await execAsync('defaults write com.apple.VoiceOver SCRAudioVolume -float 0.0');

      // Force macOS to sync the preferences to disk
      await execAsync('killall -u $(whoami) cfprefsd');

      logger.debug('VoiceOver audio volume set to 0 in both preference domains');
    } else {
      // Restore volume to default (0.8) in both preference domains
      await execAsync('defaults write com.apple.VoiceOver4.default SCRAudioVolume -float 0.8');
      await execAsync('defaults write com.apple.VoiceOver SCRAudioVolume -float 0.8');

      // Force macOS to sync the preferences to disk
      await execAsync('killall -u $(whoami) cfprefsd');

      logger.debug('VoiceOver audio volume restored to 0.8 in both preference domains');
    }

    // Start VoiceOver using open command (more reliable than AppleScript)
    await execAsync('open -a VoiceOver');

    // Wait for VoiceOver to start with retry logic
    // macOS Sequoia 15.x can take 6-10 seconds to start VoiceOver
    let running = false;
    const maxAttempts = 10;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      running = await isVoiceOverRunning();
      if (running) {
        logger.debug(`VoiceOver started after ${i + 1} seconds`);
        break;
      }
    }

    if (!running) {
      logger.warn('VoiceOver did not start after 10 seconds');
      return false;
    }

    // If silent mode requested, mute VoiceOver after it starts
    // Use keyboard shortcuts to control volume (VO + Command + Down Arrow to decrease)
    if (silent) {
      logger.debug('Muting VoiceOver audio using keyboard shortcuts...');

      // Wait for VoiceOver to fully initialize
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Send VO+Command+Down Arrow 10 times to set volume to 0
      // VO = Control+Option
      for (let i = 0; i < 10; i++) {
        await execAsync(
          'osascript -e \'tell application "System Events" to keystroke (ASCII character 31) using {control down, option down, command down}\''
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      logger.debug('VoiceOver volume muted via keyboard shortcuts');
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
      // Re-enable speech by unchecking "Mute speech"
      await execAsync('defaults write com.apple.VoiceOver4.default SCRMuteSpeech -int 0');
      logger.debug('VoiceOver speech unmuted in preferences (SCRMuteSpeech=0)');
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

