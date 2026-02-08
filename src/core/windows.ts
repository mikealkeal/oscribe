/**
 * Window management module
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const platform = process.platform;

export interface WindowInfo {
  id: string;
  title: string;
  app?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export async function listWindows(): Promise<WindowInfo[]> {
  if (platform === 'win32') {
    return listWindowsWindows();
  } else if (platform === 'darwin') {
    return listWindowsMacOS();
  } else {
    return listWindowsLinux();
  }
}

async function listWindowsWindows(): Promise<WindowInfo[]> {
  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Add-Type -AssemblyName UIAutomationClient;
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@;

$windows = New-Object System.Collections.ArrayList;
$callback = {
    param($hwnd, $lParam)
    if ([Win32]::IsWindowVisible($hwnd)) {
        $length = [Win32]::GetWindowTextLength($hwnd);
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1);
            [Win32]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null;
            $title = $sb.ToString();
            if ($title) {
                $rect = New-Object Win32+RECT;
                $gotRect = [Win32]::GetWindowRect($hwnd, [ref]$rect);
                if ($gotRect) {
                    $bx = $rect.Left;
                    $by = $rect.Top;
                    $bw = $rect.Right - $rect.Left;
                    $bh = $rect.Bottom - $rect.Top;
                    $windows.Add("$hwnd|$title|$bx|$by|$bw|$bh") | Out-Null;
                } else {
                    $windows.Add("$hwnd|$title") | Out-Null;
                }
            }
        }
    }
    return $true;
};
[Win32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null;
$windows | ForEach-Object { Write-Output $_ };
`;

  try {
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    const { stdout } = await execAsync(`powershell -NoProfile -EncodedCommand ${encoded}`, {
      windowsHide: true,
    });

    const lines = stdout.trim().split('\n').filter(Boolean);
    return lines.map((line) => {
      const parts = line.trim().split('|');
      const id = parts[0] ?? '';
      // Title may contain '|', but bounds are always the last 4 numeric fields
      // Format: hwnd|title|x|y|w|h — title cannot start with a digit after '|'
      // Safe approach: check if last 4 parts are numeric
      if (parts.length >= 6) {
        const maybeH = parseInt(parts[parts.length - 1]!, 10);
        const maybeW = parseInt(parts[parts.length - 2]!, 10);
        const maybeY = parseInt(parts[parts.length - 3]!, 10);
        const maybeX = parseInt(parts[parts.length - 4]!, 10);
        if (!isNaN(maybeX) && !isNaN(maybeY) && !isNaN(maybeW) && !isNaN(maybeH)) {
          const title = parts.slice(1, parts.length - 4).join('|');
          return { id, title, bounds: { x: maybeX, y: maybeY, width: maybeW, height: maybeH } };
        }
      }
      const title = parts.slice(1).join('|');
      return { id, title };
    });
  } catch (error) {
    console.error('Failed to list windows:', error);
    return [];
  }
}

async function listWindowsMacOS(): Promise<WindowInfo[]> {
  try {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to get name of (processes where background only is false)'`
    );
    const apps = stdout.trim().split(', ');
    return apps.map((app, i) => ({
      id: String(i),
      title: app,
      app,
    }));
  } catch {
    return [];
  }
}

async function listWindowsLinux(): Promise<WindowInfo[]> {
  try {
    const { stdout } = await execAsync('wmctrl -l');
    const lines = stdout.split('\n').filter(Boolean);
    return lines.map((line) => {
      const parts = line.split(/\s+/);
      const id = parts[0] ?? '';
      const title = parts.slice(3).join(' ');
      return { id, title };
    });
  } catch {
    return [];
  }
}

export async function focusWindow(titleOrApp: string): Promise<boolean> {
  if (platform === 'win32') {
    return focusWindowWindows(titleOrApp);
  } else if (platform === 'darwin') {
    return focusWindowMacOS(titleOrApp);
  } else {
    return focusWindowLinux(titleOrApp);
  }
}

async function focusWindowWindows(titleOrApp: string): Promise<boolean> {
  // Escape for PowerShell string (double the single quotes)
  const escaped = titleOrApp.replace(/'/g, "''");

  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@;

$targetWindow = $null;
$searchTerm = '${escaped}';
$callback = {
    param($hwnd, $lParam)
    if ([Win32]::IsWindowVisible($hwnd)) {
        $length = [Win32]::GetWindowTextLength($hwnd);
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1);
            [Win32]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null;
            $title = $sb.ToString();
            if ($title.IndexOf($searchTerm, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $script:targetWindow = $hwnd;
                return $false;
            }
        }
    }
    return $true;
};

[Win32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null;

if ($targetWindow -eq $null) {
    exit 1;
}

[Win32]::ShowWindow($targetWindow, 9) | Out-Null;
[Win32]::SetForegroundWindow($targetWindow) | Out-Null;
exit 0;
`;

  try {
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    await execAsync(`powershell -NoProfile -EncodedCommand ${encoded}`, {
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function focusWindowMacOS(titleOrApp: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "${titleOrApp}" to activate'`);
    return true;
  } catch {
    return false;
  }
}

async function focusWindowLinux(titleOrApp: string): Promise<boolean> {
  try {
    await execAsync(`wmctrl -a "${titleOrApp}"`);
    return true;
  } catch {
    return false;
  }
}

export async function getActiveWindow(): Promise<WindowInfo | null> {
  if (platform === 'win32') {
    return getActiveWindowWindows();
  } else if (platform === 'darwin') {
    return getActiveWindowMacOS();
  } else {
    return getActiveWindowLinux();
  }
}

async function getActiveWindowWindows(): Promise<WindowInfo | null> {
  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Active {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }
}
"@;

$hwnd = [Win32Active]::GetForegroundWindow();
if ($hwnd -eq [IntPtr]::Zero) {
    exit 1;
}
$length = [Win32Active]::GetWindowTextLength($hwnd);
$title = "";
if ($length -gt 0) {
    $sb = New-Object System.Text.StringBuilder($length + 1);
    [Win32Active]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null;
    $title = $sb.ToString();
}
$rect = New-Object Win32Active+RECT;
$gotRect = [Win32Active]::GetWindowRect($hwnd, [ref]$rect);
if ($gotRect) {
    $bx = $rect.Left;
    $by = $rect.Top;
    $bw = $rect.Right - $rect.Left;
    $bh = $rect.Bottom - $rect.Top;
    Write-Output "$hwnd|$title|$bx|$by|$bw|$bh";
} else {
    Write-Output "$hwnd|$title";
}
`;

  try {
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    const { stdout } = await execAsync(`powershell -NoProfile -EncodedCommand ${encoded}`, {
      windowsHide: true,
    });

    const line = stdout.trim();
    if (!line) return null;

    const parts = line.split('|');
    const id = parts[0] ?? '';
    const title = parts[1] ?? '';
    // Parse bounds if available (parts[2..5])
    if (parts.length >= 6) {
      const x = parseInt(parts[2]!, 10);
      const y = parseInt(parts[3]!, 10);
      const width = parseInt(parts[4]!, 10);
      const height = parseInt(parts[5]!, 10);
      if (!isNaN(x) && !isNaN(y) && !isNaN(width) && !isNaN(height)) {
        return { id, title, bounds: { x, y, width, height } };
      }
    }
    return { id, title };
  } catch {
    return null;
  }
}

async function getActiveWindowMacOS(): Promise<WindowInfo | null> {
  try {
    // Get frontmost app name AND window title
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        try
          set windowTitle to name of front window of frontApp
          return appName & "|" & windowTitle
        on error
          return appName & "|"
        end try
      end tell
    `;

    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    const parts = stdout.trim().split('|');
    const app = parts[0] ?? '';
    const windowTitle = parts[1] ?? app; // Fallback to app name if no window title

    return { id: '0', title: windowTitle, app };
  } catch {
    return null;
  }
}

async function getActiveWindowLinux(): Promise<WindowInfo | null> {
  try {
    // Get active window ID
    const { stdout: idOut } = await execAsync('xdotool getactivewindow');
    const id = idOut.trim();

    // Get window name
    const { stdout: nameOut } = await execAsync(`xdotool getwindowname ${id}`);
    const title = nameOut.trim();

    return { id, title };
  } catch {
    return null;
  }
}
