/**
 * Input module - Mouse and keyboard control
 * With security features: logging, restricted mode, kill switch
 */

import robot from 'robotjs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { withLogging, withLoggingSync } from './logger.js';
import { checkRestrictions } from './security.js';
import { checkUserActivity, recordActionDone } from './killswitch.js';

const execAsync = promisify(exec);

// Detect if Windows has swapped mouse buttons
let mouseButtonsSwapped = false;

async function detectSwappedMouseButtons(): Promise<void> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync(
        `powershell -Command "Get-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' | Select-Object -ExpandProperty SwapMouseButtons"`
      );
      mouseButtonsSwapped = stdout.trim() === '1';
      if (mouseButtonsSwapped) {
        console.error('[OSBot] Detected swapped mouse buttons in Windows - adapting clicks');
      }
    } catch {
      mouseButtonsSwapped = false;
    }
  }
}

// Call on module load
detectSwappedMouseButtons();

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  double?: boolean;
  dryRun?: boolean;
}

export interface TypeOptions {
  delay?: number;
  dryRun?: boolean;
}

export async function moveMouse(
  x: number,
  y: number,
  options: { dryRun?: boolean } = {}
): Promise<void> {
  const { dryRun = false } = options;
  const params = { x, y, dryRun };

  if (dryRun) {
    console.log(`[DRY RUN] Move mouse to (${x}, ${y})`);
    return;
  }

  // Security: check for user activity (kill switch)
  checkUserActivity();

  // Execute with logging
  await withLogging('move', params, async () => {
    robot.moveMouse(x, y);
  });

  // Update kill switch state
  recordActionDone();
}

export async function click(x: number, y: number, options: ClickOptions = {}): Promise<void> {
  const { button = 'left', double = false, dryRun = false } = options;
  const params = { x, y, button, double, dryRun };

  if (dryRun) {
    console.log(`[DRY RUN] Click ${button} at (${x}, ${y})${double ? ' (double)' : ''}`);
    return;
  }

  // Security: check for user activity (kill switch)
  checkUserActivity();

  // Security: check restricted mode (blocked apps)
  await checkRestrictions('click', params);

  // Execute with logging
  await withLogging('click', params, async () => {
    // Adapt to Windows swapped mouse buttons
    let effectiveButton = button;
    if (mouseButtonsSwapped && process.platform === 'win32') {
      if (button === 'left') effectiveButton = 'right';
      else if (button === 'right') effectiveButton = 'left';
    }

    // Move to position
    robot.moveMouse(x, y);

    // Small delay to ensure position is set
    await wait(50);

    console.error(`[OSBot] Click ${button} (effective: ${effectiveButton}) at (${x}, ${y})`);

    // Click
    if (double) {
      robot.mouseToggle('down', effectiveButton);
      robot.mouseToggle('up', effectiveButton);
      await wait(100);
      robot.mouseToggle('down', effectiveButton);
      robot.mouseToggle('up', effectiveButton);
    } else {
      robot.mouseToggle('down', effectiveButton);
      robot.mouseToggle('up', effectiveButton);
    }
  });

  // Update kill switch state
  recordActionDone();
}

export async function typeText(text: string, options: TypeOptions = {}): Promise<void> {
  const { delay = 0, dryRun = false } = options;
  const params = { text, delay, dryRun };

  if (dryRun) {
    console.log(`[DRY RUN] Type: "${text}"`);
    return;
  }

  // Security: check for user activity (kill switch)
  checkUserActivity();

  // Security: check restricted mode (blocked apps)
  await checkRestrictions('type', params);

  // Execute with logging
  await withLogging('type', params, async () => {
    console.error(`[OSBot] Typing text: "${text}"`);

    if (delay > 0) {
      robot.setKeyboardDelay(delay);
    }

    try {
      robot.typeString(text);
      console.error(`[OSBot] Typing complete`);
    } catch (error) {
      console.error(`[OSBot] Typing error:`, error);
      throw error;
    }
  });

  // Update kill switch state
  recordActionDone();
}

export async function hotkey(keys: string[], options: { dryRun?: boolean } = {}): Promise<void> {
  const { dryRun = false } = options;
  const params = { keys, dryRun };

  if (dryRun) {
    console.log(`[DRY RUN] Hotkey: ${keys.join('+')}`);
    return;
  }

  // Security: check for user activity (kill switch)
  checkUserActivity();

  // Security: check restricted mode (blocked hotkeys and apps)
  await checkRestrictions('hotkey', params);

  // Execute with logging
  await withLogging('hotkey', params, async () => {
    console.error(`[OSBot] Hotkey: ${keys.join('+')}`);

    // Use robotjs - native, reliable, works on all platforms
    const keyMap: Record<string, string> = {
      ctrl: 'control',
      control: 'control',
      alt: 'alt',
      shift: 'shift',
      cmd: 'command',
      command: 'command',
      win: 'command', // robotjs uses 'command' for Windows key
      windows: 'command',
      enter: 'enter',
      return: 'enter',
      tab: 'tab',
      escape: 'escape',
      esc: 'escape',
      space: 'space',
      backspace: 'backspace',
      delete: 'delete',
      up: 'up',
      down: 'down',
      left: 'left',
      right: 'right',
      home: 'home',
      end: 'end',
      pageup: 'pageup',
      pagedown: 'pagedown',
    };

    const modifiers: string[] = [];
    let mainKey = '';

    // Separate modifiers from main key
    keys.forEach((k) => {
      const lower = k.toLowerCase();
      if (['ctrl', 'control', 'alt', 'shift', 'cmd', 'command', 'win', 'windows'].includes(lower)) {
        const mapped = keyMap[lower];
        if (mapped && !modifiers.includes(mapped)) {
          modifiers.push(mapped);
        }
      } else {
        mainKey = keyMap[lower] ?? k.toLowerCase();
      }
    });

    console.error(`[OSBot] Modifiers: ${modifiers.join('+')}, Main key: ${mainKey}`);

    try {
      robot.keyTap(mainKey, modifiers);
      console.error(`[OSBot] Hotkey complete`);
    } catch (error) {
      console.error(`[OSBot] Hotkey error:`, error);
      throw error;
    }
  });

  // Update kill switch state
  recordActionDone();
}

export async function scroll(
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number = 3,
  options: { dryRun?: boolean } = {}
): Promise<void> {
  const { dryRun = false } = options;
  const params = { direction, amount, dryRun };

  if (dryRun) {
    console.log(`[DRY RUN] Scroll ${direction} by ${amount}`);
    return;
  }

  // Security: check for user activity (kill switch)
  checkUserActivity();

  // Security: check restricted mode (blocked apps)
  await checkRestrictions('scroll', params);

  // Execute with logging
  await withLogging('scroll', params, async () => {
    // robotjs scrollMouse(x, y) - positive y scrolls down, negative up
    const x = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const y = direction === 'down' ? amount : direction === 'up' ? -amount : 0;

    robot.scrollMouse(x, y);
  });

  // Update kill switch state
  recordActionDone();
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get current mouse cursor position
 */
export function getMousePosition(): { x: number; y: number } {
  const pos = robot.getMousePos();
  return { x: pos.x, y: pos.y };
}

/**
 * Click at current mouse position (no movement)
 */
export async function clickAtCurrentPosition(options: Omit<ClickOptions, 'double'> & { double?: boolean } = {}): Promise<void> {
  const { button = 'left', double = false, dryRun = false } = options;
  const pos = getMousePosition();
  const params = { x: pos.x, y: pos.y, button, double, dryRun };

  if (dryRun) {
    console.log(`[DRY RUN] Click ${button} at current position (${pos.x}, ${pos.y})${double ? ' (double)' : ''}`);
    return;
  }

  // Security: check for user activity (kill switch)
  checkUserActivity();

  // Security: check restricted mode (blocked apps)
  await checkRestrictions('click', params);

  // Execute with logging
  await withLogging('click', params, async () => {
    // Adapt to Windows swapped mouse buttons
    let effectiveButton = button;
    if (mouseButtonsSwapped && process.platform === 'win32') {
      if (button === 'left') effectiveButton = 'right';
      else if (button === 'right') effectiveButton = 'left';
    }

    console.error(`[OSBot] Click ${button} (effective: ${effectiveButton}) at current position (${pos.x}, ${pos.y})`);

    if (double) {
      robot.mouseToggle('down', effectiveButton);
      robot.mouseToggle('up', effectiveButton);
      await wait(100);
      robot.mouseToggle('down', effectiveButton);
      robot.mouseToggle('up', effectiveButton);
    } else {
      robot.mouseToggle('down', effectiveButton);
      robot.mouseToggle('up', effectiveButton);
    }
  });

  // Update kill switch state
  recordActionDone();
}
