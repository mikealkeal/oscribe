/**
 * Input module - Mouse and keyboard control
 * With security features: logging, restricted mode, kill switch
 */

import robot from 'robotjs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { withLogging } from './logger.js';
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
    if (process.platform === 'win32') {
      // Use PowerShell on Windows - robotjs scrollMouse is broken on Windows
      // WHEEL_DELTA = 120 per "click", multiply by amount
      const wheelDelta = 120 * amount;
      const scrollValue = direction === 'down' ? -wheelDelta : direction === 'up' ? wheelDelta : 0;
      const horizontalValue = direction === 'right' ? wheelDelta : direction === 'left' ? -wheelDelta : 0;

      if (scrollValue !== 0) {
        // Vertical scroll using PowerShell + C# interop
        // Use single quotes in PowerShell to avoid here-string issues
        const csharpCode = `using System; using System.Runtime.InteropServices; public class MouseScroll { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo); public const uint MOUSEEVENTF_WHEEL = 0x0800; }`;
        const psCommand = `Add-Type -TypeDefinition '${csharpCode}'; [MouseScroll]::mouse_event([MouseScroll]::MOUSEEVENTF_WHEEL, 0, 0, ${scrollValue}, 0)`;
        await execAsync(`powershell -Command "${psCommand}"`);
      } else if (horizontalValue !== 0) {
        // Horizontal scroll
        const csharpCode = `using System; using System.Runtime.InteropServices; public class MouseScroll { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo); public const uint MOUSEEVENTF_HWHEEL = 0x01000; }`;
        const psCommand = `Add-Type -TypeDefinition '${csharpCode}'; [MouseScroll]::mouse_event([MouseScroll]::MOUSEEVENTF_HWHEEL, 0, 0, ${horizontalValue}, 0)`;
        await execAsync(`powershell -Command "${psCommand}"`);
      }
    } else {
      // Use robotjs on macOS/Linux where it works
      const x = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
      const y = direction === 'down' ? -amount : direction === 'up' ? amount : 0;
      robot.scrollMouse(x, y);
    }
  });

  // Update kill switch state
  recordActionDone();
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Press mouse button down at current position
 */
export async function mouseDown(
  button: 'left' | 'right' | 'middle' = 'left',
  options: { dryRun?: boolean } = {}
): Promise<void> {
  const { dryRun = false } = options;
  const pos = getMousePosition();
  const params = { x: pos.x, y: pos.y, button, dryRun };

  if (dryRun) {
    console.log(`[DRY RUN] Mouse down ${button} at (${pos.x}, ${pos.y})`);
    return;
  }

  // Security: check for user activity (kill switch)
  checkUserActivity();

  // Security: check restricted mode
  await checkRestrictions('click', params);

  // Execute with logging
  await withLogging('mouseDown', params, async () => {
    let effectiveButton = button;
    if (mouseButtonsSwapped && process.platform === 'win32') {
      if (button === 'left') effectiveButton = 'right';
      else if (button === 'right') effectiveButton = 'left';
    }

    console.error(`[OSBot] Mouse down ${button} (effective: ${effectiveButton}) at (${pos.x}, ${pos.y})`);
    robot.mouseToggle('down', effectiveButton);
  });

  // Update kill switch state
  recordActionDone();
}

/**
 * Release mouse button at current position
 */
export async function mouseUp(
  button: 'left' | 'right' | 'middle' = 'left',
  options: { dryRun?: boolean } = {}
): Promise<void> {
  const { dryRun = false } = options;
  const pos = getMousePosition();
  const params = { x: pos.x, y: pos.y, button, dryRun };

  if (dryRun) {
    console.log(`[DRY RUN] Mouse up ${button} at (${pos.x}, ${pos.y})`);
    return;
  }

  // Security: check for user activity (kill switch)
  checkUserActivity();

  // Execute with logging
  await withLogging('mouseUp', params, async () => {
    let effectiveButton = button;
    if (mouseButtonsSwapped && process.platform === 'win32') {
      if (button === 'left') effectiveButton = 'right';
      else if (button === 'right') effectiveButton = 'left';
    }

    console.error(`[OSBot] Mouse up ${button} (effective: ${effectiveButton}) at (${pos.x}, ${pos.y})`);
    robot.mouseToggle('up', effectiveButton);
  });

  // Update kill switch state
  recordActionDone();
}

export interface DragOptions {
  button?: 'left' | 'right' | 'middle';
  dryRun?: boolean;
  /** Duration in ms for the drag movement (default: 500) */
  duration?: number;
  /** Number of steps for smooth movement (default: 20) */
  steps?: number;
}

/**
 * Drag from one position to another (click, hold, move, release)
 */
export async function drag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  options: DragOptions = {}
): Promise<void> {
  const { button = 'left', dryRun = false, duration = 500, steps = 20 } = options;
  const params = { fromX, fromY, toX, toY, button, dryRun, duration, steps };

  if (dryRun) {
    console.log(`[DRY RUN] Drag ${button} from (${fromX}, ${fromY}) to (${toX}, ${toY})`);
    return;
  }

  // Security: check for user activity (kill switch)
  checkUserActivity();

  // Security: check restricted mode
  await checkRestrictions('click', params);

  // Execute with logging
  await withLogging('drag', params, async () => {
    let effectiveButton = button;
    if (mouseButtonsSwapped && process.platform === 'win32') {
      if (button === 'left') effectiveButton = 'right';
      else if (button === 'right') effectiveButton = 'left';
    }

    console.error(`[OSBot] Drag ${button} (effective: ${effectiveButton}) from (${fromX}, ${fromY}) to (${toX}, ${toY})`);

    // Move to start position
    robot.moveMouse(fromX, fromY);
    await wait(50);

    // Press button
    robot.mouseToggle('down', effectiveButton);
    await wait(50);

    // Smooth movement to destination
    const stepDelay = duration / steps;
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const currentX = Math.round(fromX + (toX - fromX) * progress);
      const currentY = Math.round(fromY + (toY - fromY) * progress);
      robot.moveMouse(currentX, currentY);
      await wait(stepDelay);
    }

    // Small delay at destination before release
    await wait(50);

    // Release button
    robot.mouseToggle('up', effectiveButton);
    console.error(`[OSBot] Drag complete`);
  });

  // Update kill switch state
  recordActionDone();
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
