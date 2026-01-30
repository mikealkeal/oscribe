/**
 * Screenshot capture module
 */

import screenshot from 'screenshot-desktop';

export interface ScreenshotOptions {
  screen?: number;
  format?: 'png' | 'jpg';
}

export interface ScreenshotResult {
  buffer: Buffer;
  base64: string;
  width?: number;
  height?: number;
}

export async function captureScreen(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
  const { screen = 0, format = 'png' } = options;

  const displays = await screenshot.listDisplays();
  const display = displays[screen];

  if (!display) {
    throw new Error(`Screen ${screen} not found. Available: 0-${displays.length - 1}`);
  }

  const buffer = await screenshot({ screen: display.id, format });

  return {
    buffer,
    base64: buffer.toString('base64'),
  };
}

interface Display {
  id: number | string;
  name?: string;
}

export async function listScreens(): Promise<Array<{ id: string; name: string }>> {
  const displays = await screenshot.listDisplays();
  return displays.map((d: Display, i: number) => ({
    id: String(d.id),
    name: d.name ?? `Display ${i}`,
  }));
}
