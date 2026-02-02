/**
 * Screenshot capture module
 * Cross-platform: PowerShell (Windows), screencapture (macOS), screenshot-desktop (Linux)
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config/index.js';

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
  const tempDir = await mkdtemp(join(tmpdir(), 'oscribe-'));
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

    // Extract dimensions from PNG header (IHDR chunk)
    // PNG structure: 8-byte signature + 4-byte length + 4-byte "IHDR" + 4-byte width + 4-byte height
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);

    return {
      buffer,
      base64: buffer.toString('base64'),
      width,
      height,
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
  // Generate unique namespace to avoid type conflicts
  const uniqueId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const config = loadConfig();
  const cursorSize = config.cursorSize;
  const cursorMultiplier = Math.floor(cursorSize / 32);

  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'OScribe${uniqueId}.CursorCapture').Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Drawing;

namespace OScribe${uniqueId} {
    public class CursorCapture {
        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int x; public int y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct CURSORINFO {
            public int cbSize;
            public int flags;
            public IntPtr hCursor;
            public POINT ptScreenPos;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct ICONINFO {
            public bool fIcon;
            public int xHotspot;
            public int yHotspot;
            public IntPtr hbmMask;
            public IntPtr hbmColor;
        }

        [DllImport("user32.dll")]
        public static extern bool GetCursorInfo(out CURSORINFO pci);

        [DllImport("user32.dll")]
        public static extern bool GetIconInfo(IntPtr hIcon, out ICONINFO piconinfo);

        [DllImport("user32.dll")]
        public static extern bool DrawIconEx(IntPtr hdc, int xLeft, int yTop, IntPtr hIcon,
            int cxWidth, int cyHeight, int istepIfAniCur, IntPtr hbrFlickerFreeDraw, int diFlags);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteObject(IntPtr hObject);

        public const int CURSOR_SHOWING = 0x00000001;
        public const int DI_NORMAL = 0x0003;
    }
}
'@
}

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$allScreens = [System.Windows.Forms.Screen]::AllScreens
if ($allScreens.Length -gt ${screenIndex}) { $screen = $allScreens[${screenIndex}] }
$bounds = $screen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

$cursorInfo = New-Object OScribe${uniqueId}.CursorCapture+CURSORINFO
$cursorInfo.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($cursorInfo)
if ([OScribe${uniqueId}.CursorCapture]::GetCursorInfo([ref]$cursorInfo)) {
    if (($cursorInfo.flags -band [OScribe${uniqueId}.CursorCapture]::CURSOR_SHOWING) -ne 0) {
        $iconInfo = New-Object OScribe${uniqueId}.CursorCapture+ICONINFO
        if ([OScribe${uniqueId}.CursorCapture]::GetIconInfo($cursorInfo.hCursor, [ref]$iconInfo)) {
            $x = $cursorInfo.ptScreenPos.x - $bounds.X - ($iconInfo.xHotspot * ${cursorMultiplier})
            $y = $cursorInfo.ptScreenPos.y - $bounds.Y - ($iconInfo.yHotspot * ${cursorMultiplier})
            $hdc = $graphics.GetHdc()
            [OScribe${uniqueId}.CursorCapture]::DrawIconEx($hdc, $x, $y, $cursorInfo.hCursor, ${cursorSize}, ${cursorSize}, 0, [IntPtr]::Zero, [OScribe${uniqueId}.CursorCapture]::DI_NORMAL) | Out-Null
            $graphics.ReleaseHdc($hdc)
            if ($iconInfo.hbmMask -ne [IntPtr]::Zero) { [OScribe${uniqueId}.CursorCapture]::DeleteObject($iconInfo.hbmMask) | Out-Null }
            if ($iconInfo.hbmColor -ne [IntPtr]::Zero) { [OScribe${uniqueId}.CursorCapture]::DeleteObject($iconInfo.hbmColor) | Out-Null }
        }
    }
}

$bitmap.Save('${outputPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`;

  // Write to temp file (script too long for command line)
  const tempDir = await mkdtemp(join(tmpdir(), 'oscribe-'));
  const tempScript = join(tempDir, 'capture.ps1');

  try {
    await writeFile(tempScript, psScript, 'utf8');
    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempScript}"`, {
      windowsHide: true,
    });
  } finally {
    try {
      await unlink(tempScript);
    } catch {
      // Ignore cleanup errors
    }
  }
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
        filename: outputPath,
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
    const data = JSON.parse(stdout) as {
      SPDisplaysDataType?: Array<{ spdisplays_ndrvs?: Array<{ _name?: string }> }>;
    };
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
