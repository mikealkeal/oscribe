// Win32ToolbarReader.cs - Read toolbar button tooltips via cross-process memory
// Compile: csc /platform:x64 /target:exe /out:Win32ToolbarReader.exe Win32ToolbarReader.cs
// Usage: Win32ToolbarReader.exe "Window Title" [--debug]
//
// Detects ToolbarWindow32 controls in a window, reads button positions
// and tooltip text using Win32 Toolbar API with cross-process memory.
// Works for native apps (wxWidgets, MFC, Win32) where UIA/MSAA fail.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

class Win32ToolbarReader
{
    // ── Process & Memory ─────────────────────────────────────────────
    const uint PROCESS_VM_OPERATION = 0x0008;
    const uint PROCESS_VM_READ = 0x0010;
    const uint PROCESS_VM_WRITE = 0x0020;
    const uint PROCESS_QUERY_INFORMATION = 0x0400;
    const uint MEM_COMMIT = 0x1000;
    const uint MEM_RELEASE = 0x8000;
    const uint PAGE_READWRITE = 0x04;

    [DllImport("kernel32.dll")]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll")]
    static extern IntPtr VirtualAllocEx(IntPtr hProcess, IntPtr addr, int size, uint type, uint protect);

    [DllImport("kernel32.dll")]
    static extern bool VirtualFreeEx(IntPtr hProcess, IntPtr addr, int size, uint type);

    [DllImport("kernel32.dll")]
    static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr baseAddr, byte[] buffer, int size, out int bytesRead);

    [DllImport("kernel32.dll")]
    static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr baseAddr, byte[] buffer, int size, out int bytesWritten);

    // ── Window ───────────────────────────────────────────────────────
    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder buf, int maxCount);

    [DllImport("user32.dll")]
    static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern int GetClassName(IntPtr hWnd, StringBuilder buf, int maxCount);

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X, Y; }

    // ── Toolbar Messages ─────────────────────────────────────────────
    const uint TB_BUTTONCOUNT    = 0x0418;
    const uint TB_GETITEMRECT    = 0x041D;
    const uint TB_GETTOOLTIPS    = 0x0423;
    const uint TB_GETBUTTON      = 0x0417;
    const uint TB_GETBUTTONTEXTW = 0x004B;

    // ── Tooltip Messages ─────────────────────────────────────────────
    const uint TTM_GETTEXTW = 0x0438;

    // ── State ────────────────────────────────────────────────────────
    static IntPtr targetHwnd = IntPtr.Zero;
    static List<IntPtr> toolbarHwnds = new List<IntPtr>();
    static List<Dictionary<string, object>> elements = new List<Dictionary<string, object>>();
    static bool debugMode = false;

    static void Debug(string msg)
    {
        if (debugMode) Console.Error.WriteLine("[DEBUG] " + msg);
    }

    static void Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;

        string searchTitle = args.Length > 0 ? args[0] : "";
        debugMode = Array.Exists(args, a => a == "--debug");

        if (string.IsNullOrEmpty(searchTitle))
        {
            Console.WriteLine("{\"error\":\"No window title specified\"}");
            return;
        }

        // Find window
        EnumWindows((hwnd, lParam) => {
            if (IsWindowVisible(hwnd))
            {
                int len = GetWindowTextLength(hwnd);
                if (len > 0)
                {
                    var sb = new StringBuilder(len + 1);
                    GetWindowText(hwnd, sb, sb.Capacity);
                    if (sb.ToString().IndexOf(searchTitle, StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        targetHwnd = hwnd;
                        return false;
                    }
                }
            }
            return true;
        }, IntPtr.Zero);

        if (targetHwnd == IntPtr.Zero)
        {
            Console.WriteLine("{\"error\":\"Window not found\"}");
            return;
        }

        // Find all ToolbarWindow32 children
        EnumChildWindows(targetHwnd, (hwnd, lParam) => {
            var className = new StringBuilder(256);
            GetClassName(hwnd, className, 256);
            if (className.ToString() == "ToolbarWindow32")
                toolbarHwnds.Add(hwnd);
            return true;
        }, IntPtr.Zero);

        if (toolbarHwnds.Count == 0)
        {
            Console.WriteLine("[]");
            return;
        }

        Debug("Found " + toolbarHwnds.Count + " toolbar(s)");

        // Get process ID
        uint processId;
        GetWindowThreadProcessId(targetHwnd, out processId);
        IntPtr hProcess = OpenProcess(
            PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_QUERY_INFORMATION,
            false, processId);

        if (hProcess == IntPtr.Zero)
        {
            Console.WriteLine("{\"error\":\"Cannot open process\"}");
            return;
        }

        try
        {
            foreach (var tbHwnd in toolbarHwnds)
            {
                ReadToolbar(tbHwnd, hProcess);
            }
        }
        finally
        {
            CloseHandle(hProcess);
        }

        OutputJson();
    }

    static void ReadToolbar(IntPtr tbHwnd, IntPtr hProcess)
    {
        int buttonCount = (int)SendMessage(tbHwnd, TB_BUTTONCOUNT, IntPtr.Zero, IntPtr.Zero);
        if (buttonCount <= 0) return;

        Debug("Toolbar has " + buttonCount + " buttons");

        IntPtr tooltipHwnd = SendMessage(tbHwnd, TB_GETTOOLTIPS, IntPtr.Zero, IntPtr.Zero);
        Debug("Tooltip HWND: " + tooltipHwnd);

        // TOOLINFOW v5 (without lpReserved): 64 bytes on x64
        int toolInfoSize = 64;
        int textBufferSize = 256;
        int tbButtonSize = 32; // x64 TBBUTTON

        int totalAlloc = Math.Max(tbButtonSize, toolInfoSize) + textBufferSize * 2 + 128;
        IntPtr remoteMem = VirtualAllocEx(hProcess, IntPtr.Zero, totalAlloc, MEM_COMMIT, PAGE_READWRITE);
        if (remoteMem == IntPtr.Zero) return;

        IntPtr remoteTextBuf = new IntPtr(remoteMem.ToInt64() + 128);

        try
        {
            for (int i = 0; i < buttonCount; i++)
            {
                // Get TBBUTTON struct
                SendMessage(tbHwnd, TB_GETBUTTON, (IntPtr)i, remoteMem);

                byte[] localBuf = new byte[tbButtonSize];
                int bytesRead;
                ReadProcessMemory(hProcess, remoteMem, localBuf, tbButtonSize, out bytesRead);

                int idCommand = BitConverter.ToInt32(localBuf, 4);
                byte fsState = localBuf[8];
                byte fsStyle = localBuf[9];

                Debug("Button " + i + ": cmd=" + idCommand + " state=" + fsState + " style=" + fsStyle);

                // Skip separators (BTNS_SEP = 0x01)
                if ((fsStyle & 0x01) != 0) continue;

                // Get button rect (client coords)
                SendMessage(tbHwnd, TB_GETITEMRECT, (IntPtr)i, remoteMem);
                byte[] rectBuf = new byte[16];
                ReadProcessMemory(hProcess, remoteMem, rectBuf, 16, out bytesRead);

                int left = BitConverter.ToInt32(rectBuf, 0);
                int top = BitConverter.ToInt32(rectBuf, 4);
                int right = BitConverter.ToInt32(rectBuf, 8);
                int bottom = BitConverter.ToInt32(rectBuf, 12);

                // Convert client → screen coordinates
                POINT pt;
                pt.X = left; pt.Y = top;
                ClientToScreen(tbHwnd, ref pt);
                int screenX = pt.X;
                int screenY = pt.Y;
                int width = right - left;
                int height = bottom - top;

                if (width <= 0 || height <= 0) continue;

                // Get tooltip text via TTM_GETTEXTW
                string tooltip = "";
                if (tooltipHwnd != IntPtr.Zero)
                {
                    tooltip = GetTooltipForButton(tooltipHwnd, tbHwnd, idCommand, hProcess,
                                                   remoteMem, remoteTextBuf, toolInfoSize, textBufferSize);
                }

                // Fallback: TB_GETBUTTONTEXTW
                if (string.IsNullOrEmpty(tooltip))
                {
                    int textLen = (int)SendMessage(tbHwnd, TB_GETBUTTONTEXTW, (IntPtr)idCommand, remoteTextBuf);
                    if (textLen > 0)
                    {
                        byte[] textBytes = new byte[textLen * 2 + 2];
                        ReadProcessMemory(hProcess, remoteTextBuf, textBytes, textBytes.Length, out bytesRead);
                        tooltip = Encoding.Unicode.GetString(textBytes, 0, textLen * 2);
                    }
                }

                // Truncate long tooltips to first sentence
                if (tooltip.Length > 80)
                {
                    int dotIdx = tooltip.IndexOf('.');
                    if (dotIdx > 0 && dotIdx < 80) tooltip = tooltip.Substring(0, dotIdx + 1);
                    else tooltip = tooltip.Substring(0, 80);
                }

                string type = "Button";
                if ((fsStyle & 0x08) != 0 || (fsStyle & 0x20) != 0) type = "DropDown";

                elements.Add(new Dictionary<string, object> {
                    {"type", type},
                    {"name", tooltip},
                    {"x", screenX},
                    {"y", screenY},
                    {"width", width},
                    {"height", height}
                });
            }
        }
        finally
        {
            VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        }
    }

    static string GetTooltipForButton(IntPtr tooltipHwnd, IntPtr tbHwnd, int commandId,
                                       IntPtr hProcess, IntPtr remoteMem, IntPtr remoteTextBuf,
                                       int toolInfoSize, int textBufferSize)
    {
        // Build TOOLINFOW: hwnd=toolbar, uId=commandId, lpszText=our buffer
        byte[] tiBytes = new byte[toolInfoSize];
        Array.Clear(tiBytes, 0, toolInfoSize);

        BitConverter.GetBytes((uint)toolInfoSize).CopyTo(tiBytes, 0);    // cbSize
        BitConverter.GetBytes(tbHwnd.ToInt64()).CopyTo(tiBytes, 8);       // hwnd
        BitConverter.GetBytes((long)commandId).CopyTo(tiBytes, 16);       // uId
        BitConverter.GetBytes(remoteTextBuf.ToInt64()).CopyTo(tiBytes, 48); // lpszText

        int bw, br;
        byte[] zeroBuf = new byte[textBufferSize * 2];
        WriteProcessMemory(hProcess, remoteTextBuf, zeroBuf, textBufferSize * 2, out bw);
        WriteProcessMemory(hProcess, remoteMem, tiBytes, toolInfoSize, out bw);

        SendMessage(tooltipHwnd, TTM_GETTEXTW, (IntPtr)textBufferSize, remoteMem);

        // Read back to check where lpszText points
        byte[] resultTi = new byte[toolInfoSize];
        ReadProcessMemory(hProcess, remoteMem, resultTi, toolInfoSize, out br);
        long lpszText = BitConverter.ToInt64(resultTi, 48);

        string text = "";
        if (lpszText == remoteTextBuf.ToInt64())
        {
            byte[] textBuf = new byte[textBufferSize * 2];
            ReadProcessMemory(hProcess, remoteTextBuf, textBuf, textBuf.Length, out br);
            text = Encoding.Unicode.GetString(textBuf).TrimEnd('\0');
        }
        else if (lpszText > 0x10000 && lpszText != -1)
        {
            byte[] textBuf = new byte[textBufferSize * 2];
            ReadProcessMemory(hProcess, new IntPtr(lpszText), textBuf, textBuf.Length, out br);
            text = Encoding.Unicode.GetString(textBuf).TrimEnd('\0');
        }

        Debug("  TTM_GETTEXTW cmd=" + commandId + " text=[" + text + "]");
        return text;
    }

    static void OutputJson()
    {
        Console.Write("[");
        bool first = true;
        foreach (var el in elements)
        {
            if (!first) Console.Write(",");
            first = false;
            Console.Write("{\"type\":\"" + el["type"] + "\"");
            Console.Write(",\"name\":\"" + EscapeJson((string)el["name"]) + "\"");
            Console.Write(",\"x\":" + el["x"]);
            Console.Write(",\"y\":" + el["y"]);
            Console.Write(",\"width\":" + el["width"]);
            Console.Write(",\"height\":" + el["height"]);
            Console.Write("}");
        }
        Console.WriteLine("]");
    }

    static string EscapeJson(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
    }
}
