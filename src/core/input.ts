/**
 * Input module - Mouse and keyboard control
 */

import robot from 'robotjs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

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

  if (dryRun) {
    console.log(`[DRY RUN] Move mouse to (${x}, ${y})`);
    return;
  }

  robot.moveMouse(x, y);
}

export async function click(x: number, y: number, options: ClickOptions = {}): Promise<void> {
  const { button = 'left', double = false, dryRun = false } = options;

  if (dryRun) {
    console.log(`[DRY RUN] Click ${button} at (${x}, ${y})${double ? ' (double)' : ''}`);
    return;
  }

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
}

export async function typeText(text: string, options: TypeOptions = {}): Promise<void> {
  const { delay = 0, dryRun = false } = options;

  if (dryRun) {
    console.log(`[DRY RUN] Type: "${text}"`);
    return;
  }

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
}

export async function hotkey(keys: string[], options: { dryRun?: boolean } = {}): Promise<void> {
  const { dryRun = false } = options;

  if (dryRun) {
    console.log(`[DRY RUN] Hotkey: ${keys.join('+')}`);
    return;
  }

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
}

export async function scroll(
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number = 3,
  options: { dryRun?: boolean } = {}
): Promise<void> {
  const { dryRun = false } = options;

  if (dryRun) {
    console.log(`[DRY RUN] Scroll ${direction} by ${amount}`);
    return;
  }

  // robotjs scrollMouse(x, y) - positive y scrolls down, negative up
  const x = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
  const y = direction === 'down' ? amount : direction === 'up' ? -amount : 0;

  robot.scrollMouse(x, y);
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
