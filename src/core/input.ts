/**
 * Input module - Mouse and keyboard control
 */

import { mouse, keyboard, Point, Key, Button } from '@nut-tree-fork/nut-js';

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  double?: boolean;
  dryRun?: boolean;
}

export interface TypeOptions {
  delay?: number;
  dryRun?: boolean;
}

export async function click(x: number, y: number, options: ClickOptions = {}): Promise<void> {
  const { button = 'left', double = false, dryRun = false } = options;

  if (dryRun) {
    console.log(`[DRY RUN] Click ${button} at (${x}, ${y})${double ? ' (double)' : ''}`);
    return;
  }

  const point = new Point(x, y);
  await mouse.setPosition(point);

  const btn = button === 'right' ? Button.RIGHT : button === 'middle' ? Button.MIDDLE : Button.LEFT;

  if (double) {
    await mouse.doubleClick(btn);
  } else {
    await mouse.click(btn);
  }
}

export async function typeText(text: string, options: TypeOptions = {}): Promise<void> {
  const { delay = 0, dryRun = false } = options;

  if (dryRun) {
    console.log(`[DRY RUN] Type: "${text}"`);
    return;
  }

  if (delay > 0) {
    keyboard.config.autoDelayMs = delay;
  }

  await keyboard.type(text);
}

export async function hotkey(keys: string[], options: { dryRun?: boolean } = {}): Promise<void> {
  const { dryRun = false } = options;

  if (dryRun) {
    console.log(`[DRY RUN] Hotkey: ${keys.join('+')}`);
    return;
  }

  const keyMap: Record<string, Key> = {
    ctrl: Key.LeftControl,
    control: Key.LeftControl,
    alt: Key.LeftAlt,
    shift: Key.LeftShift,
    cmd: Key.LeftCmd,
    command: Key.LeftCmd,
    win: Key.LeftWin,
    enter: Key.Enter,
    return: Key.Enter,
    tab: Key.Tab,
    escape: Key.Escape,
    esc: Key.Escape,
    space: Key.Space,
    backspace: Key.Backspace,
    delete: Key.Delete,
    up: Key.Up,
    down: Key.Down,
    left: Key.Left,
    right: Key.Right,
  };

  const mappedKeys = keys.map((k) => {
    const lower = k.toLowerCase();
    if (keyMap[lower]) {
      return keyMap[lower];
    }
    if (k.length === 1) {
      return k.toUpperCase() as unknown as Key;
    }
    throw new Error(`Unknown key: ${k}`);
  });

  await keyboard.pressKey(...mappedKeys);
  await keyboard.releaseKey(...mappedKeys.reverse());
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

  if (direction === 'up') {
    await mouse.scrollUp(amount);
  } else if (direction === 'down') {
    await mouse.scrollDown(amount);
  } else if (direction === 'left') {
    await mouse.scrollLeft(amount);
  } else {
    await mouse.scrollRight(amount);
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
