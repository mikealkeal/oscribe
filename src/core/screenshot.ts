/**
 * Screenshot capture module
 * Cross-platform: PowerShell (Windows), screencapture (macOS), screenshot-desktop (Linux)
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execAsync = promisify(exec);

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

interface Display {
  id: string;
  name: string;
}

const platform = process.platform;

/**
 * Capture screenshot using platform-native methods
 */
export async function captureScreen(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
  const { screen = 0 } = options;

  // Create temp file for screenshot
  const tempDir = await mkdtemp(join(tmpdir(), 'osbot-'));
  const tempFile = join(tempDir, 'screenshot.png');

  try {
    if (platform === 'win32') {
      await captureWindows(tempFile, screen);
    } else if (platform === 'darwin') {
      await captureMacOS(tempFile, screen);
    } else {
      await captureLinux(tempFile, screen);
    }

    const buffer = await readFile(tempFile);

    return {
      buffer,
      base64: buffer.toString('base64'),
    };
  } finally {
    // Cleanup temp file
    try {
      await unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Windows: Use PowerShell with .NET
 */
async function captureWindows(outputPath: string, screenIndex: number): Promise<void> {
  // Use base64-encoded command for reliable execution
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms;
Add-Type -AssemblyName System.Drawing;
$screen = [System.Windows.Forms.Screen]::PrimaryScreen;
$allScreens = [System.Windows.Forms.Screen]::AllScreens;
if ($allScreens.Length -gt ${screenIndex}) { $screen = $allScreens[${screenIndex}] };
$bounds = $screen.Bounds;
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height);
$graphics = [System.Drawing.Graphics]::FromImage($bitmap);
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);
$bitmap.Save('${outputPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png);
$graphics.Dispose();
$bitmap.Dispose();
`;

  // Encode as base64 for reliable execution
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

  await execAsync(`powershell -NoProfile -EncodedCommand ${encoded}`, {
    windowsHide: true,
  });
}

/**
 * macOS: Use native screencapture command
 */
async function captureMacOS(outputPath: string, screen: number): Promise<void> {
  // -x: no sound, -D: display number (1-indexed)
  const displayArg = screen > 0 ? `-D ${screen + 1}` : '';
  await execAsync(`screencapture -x ${displayArg} "${outputPath}"`);
}

/**
 * Linux: Use screenshot-desktop as fallback
 */
async function captureLinux(outputPath: string, screen: number): Promise<void> {
  // Try import (gnome-screenshot) first, then scrot, then screenshot-desktop
  try {
    await execAsync(`import -window root "${outputPath}"`);
  } catch {
    try {
      await execAsync(`scrot "${outputPath}"`);
    } catch {
      // Fallback to screenshot-desktop
      const screenshot = await import('screenshot-desktop');
      const displays = await screenshot.default.listDisplays();
      const display = displays[screen];
      if (!display) {
        throw new Error(`Screen ${screen} not found`);
      }
      const buffer = await screenshot.default({
        screen: display.id,
        filename: outputPath
      });
      if (!buffer) {
        throw new Error('Failed to capture screenshot');
      }
    }
  }
}

/**
 * List available screens
 */
export async function listScreens(): Promise<Display[]> {
  if (platform === 'win32') {
    return listScreensWindows();
  } else if (platform === 'darwin') {
    return listScreensMacOS();
  } else {
    return listScreensLinux();
  }
}

async function listScreensWindows(): Promise<Display[]> {
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms;
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  Write-Output "$($_.DeviceName);$($_.Primary);$($_.Bounds.Width)x$($_.Bounds.Height)"
}
`;

  try {
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    const { stdout } = await execAsync(`powershell -NoProfile -EncodedCommand ${encoded}`, {
      windowsHide: true,
    });

    const lines = stdout.trim().split('\n').filter(Boolean);
    return lines.map((line, i) => {
      const parts = line.trim().split(';');
      const name = parts[0] ?? `Display ${i}`;
      const isPrimary = parts[1] === 'True';
      const resolution = parts[2] ?? '';
      return {
        id: String(i),
        name: `${name} ${resolution}${isPrimary ? ' (Primary)' : ''}`.trim(),
      };
    });
  } catch {
    return [{ id: '0', name: 'Primary Display' }];
  }
}

async function listScreensMacOS(): Promise<Display[]> {
  try {
    const { stdout } = await execAsync('system_profiler SPDisplaysDataType -json');
    const data = JSON.parse(stdout) as { SPDisplaysDataType?: Array<{ spdisplays_ndrvs?: Array<{ _name?: string }> }> };
    const displays = data.SPDisplaysDataType?.[0]?.spdisplays_ndrvs ?? [];

    return displays.map((d, i) => ({
      id: String(i),
      name: d._name ?? `Display ${i}`,
    }));
  } catch {
    return [{ id: '0', name: 'Primary Display' }];
  }
}

async function listScreensLinux(): Promise<Display[]> {
  try {
    const { stdout } = await execAsync('xrandr --listmonitors');
    const lines = stdout.split('\n').slice(1).filter(Boolean);

    return lines.map((line, i) => {
      const match = line.match(/^\s*\d+:\s+\+?\*?(\S+)/);
      return {
        id: String(i),
        name: match?.[1] ?? `Display ${i}`,
      };
    });
  } catch {
    return [{ id: '0', name: 'Primary Display' }];
  }
}
