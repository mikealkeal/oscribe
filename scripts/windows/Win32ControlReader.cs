// Win32ControlReader.cs - Read Win32 control items via cross-process memory
// Compile: csc /platform:x64 /target:exe /out:Win32ControlReader.exe Win32ControlReader.cs
// Usage: Win32ControlReader.exe "Window Title" [--debug]
//
// Reads items from Win32 common controls that UIA doesn't expose:
// - SysTreeView32, SysListView32, ComboBox/ComboBoxEx32 (specific readers)
// - SysTabControl32 (tab items), msctls_statusbar32 (status bar parts)
// - Generic catch-all for ALL other visible child windows with text
// Works for native apps (wxWidgets, MFC, Win32) where UIA doesn't expose items.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

class Win32ControlReader
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
    static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);

    [DllImport("user32.dll")]
    static extern IntPtr GetMenu(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern IntPtr GetSubMenu(IntPtr hMenu, int nPos);

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    // ── TreeView Messages ────────────────────────────────────────────
    const uint TVM_GETCOUNT       = 0x1105;
    const uint TVM_GETNEXTITEM    = 0x110A;
    const uint TVM_GETITEMW       = 0x113E;
    const uint TVM_GETITEMRECT    = 0x1104;

    // TVM_GETNEXTITEM flags
    const uint TVGN_ROOT          = 0x0000;
    const uint TVGN_NEXT          = 0x0001;
    const uint TVGN_CHILD         = 0x0004;

    // TVITEM mask
    const uint TVIF_TEXT          = 0x0001;
    const uint TVIF_HANDLE        = 0x0010;

    // ── ListView Messages ────────────────────────────────────────────
    const uint LVM_GETITEMCOUNT   = 0x1004;
    const uint LVM_GETITEMTEXTW   = 0x1073;
    const uint LVM_GETSUBITEMRECT = 0x1038;
    const uint LVM_GETCOLUMNCOUNT = 0x1000 + 0x211; // Not standard, use Header
    const uint LVM_GETHEADER      = 0x101F;
    const uint LVM_GETITEMRECT    = 0x100E;

    // Header messages
    const uint HDM_GETITEMCOUNT   = 0x1200;

    // LVITEM mask
    const uint LVIF_TEXT          = 0x0001;

    // ── ComboBox Messages ────────────────────────────────────────────
    const uint CB_GETCOUNT        = 0x0146;
    const uint CB_GETLBTEXTLEN    = 0x0149;
    const uint CB_GETLBTEXT       = 0x0148;
    const uint CB_GETCURSEL       = 0x0147;

    // ── TabControl Messages ─────────────────────────────────────────
    const uint TCM_GETITEMCOUNT   = 0x1304;
    const uint TCM_GETITEMW       = 0x133C;
    const uint TCM_GETITEMRECT    = 0x130A;
    const uint TCM_GETCURSEL      = 0x130B;

    // TCITEM mask
    const uint TCIF_TEXT          = 0x0001;

    // ── StatusBar Messages ──────────────────────────────────────────
    const uint SB_GETPARTS        = 0x0406;
    const uint SB_GETTEXTLENGTHW  = 0x040C;
    const uint SB_GETTEXTW        = 0x040D;
    const uint SB_GETRECT         = 0x040A;

    // ── Menu Messages & API ──────────────────────────────────────────
    const uint MN_GETHMENU        = 0x01E1;
    const uint MIIM_STRING        = 0x0040;
    const uint MIIM_FTYPE         = 0x0100;
    const uint MIIM_STATE         = 0x0001;
    const uint MIIM_SUBMENU       = 0x0004;
    const uint MFT_SEPARATOR      = 0x0800;

    [DllImport("user32.dll")]
    static extern int GetMenuItemCount(IntPtr hMenu);

    [DllImport("user32.dll")]
    static extern bool GetMenuItemInfoW(IntPtr hMenu, uint uItem, bool fByPosition, byte[] lpmii);

    [DllImport("user32.dll")]
    static extern bool GetMenuItemRect(IntPtr hWnd, IntPtr hMenu, uint uItem, out RECT lprcItem);

    // ── State ────────────────────────────────────────────────────────
    static IntPtr targetHwnd = IntPtr.Zero;
    static List<ControlInfo> controls = new List<ControlInfo>();
    static List<Dictionary<string, object>> elements = new List<Dictionary<string, object>>();
    static bool debugMode = false;

    struct ControlInfo
    {
        public IntPtr hwnd;
        public string className;
        public string controlType; // "TreeView", "ListView", "ComboBox", "TabControl", "StatusBar", "Generic"
    }

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
            Console.WriteLine("[]");
            return;
        }

        // Find all target child controls — specific readers + generic catch-all
        var handledHwnds = new HashSet<IntPtr>();
        EnumChildWindows(targetHwnd, (hwnd, lParam) => {
            var className = new StringBuilder(256);
            GetClassName(hwnd, className, 256);
            string cls = className.ToString();

            if (cls == "SysTreeView32")
            {
                controls.Add(new ControlInfo { hwnd = hwnd, className = cls, controlType = "TreeView" });
                handledHwnds.Add(hwnd);
            }
            else if (cls == "SysListView32")
            {
                controls.Add(new ControlInfo { hwnd = hwnd, className = cls, controlType = "ListView" });
                handledHwnds.Add(hwnd);
            }
            else if (cls == "ComboBox" || cls == "ComboBoxEx32")
            {
                controls.Add(new ControlInfo { hwnd = hwnd, className = cls, controlType = "ComboBox" });
                handledHwnds.Add(hwnd);
            }
            else if (cls == "SysTabControl32")
            {
                controls.Add(new ControlInfo { hwnd = hwnd, className = cls, controlType = "TabControl" });
                handledHwnds.Add(hwnd);
            }
            else if (cls == "msctls_statusbar32")
            {
                controls.Add(new ControlInfo { hwnd = hwnd, className = cls, controlType = "StatusBar" });
                handledHwnds.Add(hwnd);
            }

            return true;
        }, IntPtr.Zero);

        // Generic catch-all: enumerate ALL visible child windows with text
        // Catches controls UIA misses that aren't covered by specific readers above
        EnumChildWindows(targetHwnd, (hwnd, lParam) => {
            if (handledHwnds.Contains(hwnd)) return true; // Already handled
            if (!IsWindowVisible(hwnd)) return true;

            int textLen = GetWindowTextLength(hwnd);
            if (textLen <= 0) return true;

            var textBuf = new StringBuilder(textLen + 1);
            GetWindowText(hwnd, textBuf, textBuf.Capacity);
            string text = textBuf.ToString();
            if (string.IsNullOrEmpty(text)) return true;

            RECT rect;
            GetWindowRect(hwnd, out rect);
            int w = rect.Right - rect.Left;
            int h = rect.Bottom - rect.Top;
            if (w <= 0 || h <= 0) return true;

            var className = new StringBuilder(256);
            GetClassName(hwnd, className, 256);
            string cls = className.ToString();

            // Skip generic containers (just noise)
            if (cls == "ScrollBar" || cls == "tooltips_class32" || cls == "#32770") return true;

            elements.Add(new Dictionary<string, object> {
                {"type", MapWin32Class(cls)},
                {"name", text},
                {"x", rect.Left},
                {"y", rect.Top},
                {"width", w},
                {"height", h}
            });
            Debug("  Generic[" + cls + "]: " + text);

            return true;
        }, IntPtr.Zero);

        // Read window menu bar (HMENU) — catches Fichier/Édition/Affichage etc.
        // Native HMENU menus live in the non-client area, NOT as child windows.
        // wxWidgets, MFC, and all native Win32 apps use HMENU for their menu bar.
        IntPtr hMenuBar = GetMenu(targetHwnd);
        if (hMenuBar != IntPtr.Zero)
        {
            int menuCount = GetMenuItemCount(hMenuBar);
            if (menuCount > 0)
            {
                Debug("Menu bar has " + menuCount + " items");
                ReadMenuBarItems(hMenuBar, targetHwnd, menuCount);
            }
        }

        // Also find any visible popup menus (#32768) owned by the same process
        uint targetProcessId;
        GetWindowThreadProcessId(targetHwnd, out targetProcessId);

        List<IntPtr> popupMenuHwnds = new List<IntPtr>();
        EnumWindows((hwnd, lParam) => {
            if (IsWindowVisible(hwnd))
            {
                var className = new StringBuilder(256);
                GetClassName(hwnd, className, 256);
                if (className.ToString() == "#32768")
                {
                    uint menuPid;
                    GetWindowThreadProcessId(hwnd, out menuPid);
                    if (menuPid == targetProcessId)
                        popupMenuHwnds.Add(hwnd);
                }
            }
            return true;
        }, IntPtr.Zero);

        if (controls.Count == 0 && popupMenuHwnds.Count == 0)
        {
            Console.WriteLine("[]");
            return;
        }

        Debug("Found " + controls.Count + " control(s), " + popupMenuHwnds.Count + " popup menu(s)");

        // Read popup menus first (no cross-process memory needed for menus)
        foreach (var menuHwnd in popupMenuHwnds)
        {
            ReadPopupMenu(menuHwnd);
        }

        if (controls.Count == 0)
        {
            OutputJson();
            return;
        }

        // Get process ID for cross-process memory access
        IntPtr hProcess = OpenProcess(
            PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_QUERY_INFORMATION,
            false, targetProcessId);

        if (hProcess == IntPtr.Zero)
        {
            // Still output any popup menu items we found
            OutputJson();
            return;
        }

        try
        {
            foreach (var ctrl in controls)
            {
                Debug("Reading " + ctrl.controlType + " (class=" + ctrl.className + ")");
                if (ctrl.controlType == "TreeView")
                    ReadTreeView(ctrl.hwnd, hProcess);
                else if (ctrl.controlType == "ListView")
                    ReadListView(ctrl.hwnd, hProcess);
                else if (ctrl.controlType == "ComboBox")
                    ReadComboBox(ctrl.hwnd, hProcess);
                else if (ctrl.controlType == "TabControl")
                    ReadTabControl(ctrl.hwnd, hProcess);
                else if (ctrl.controlType == "StatusBar")
                    ReadStatusBar(ctrl.hwnd, hProcess);
            }
        }
        finally
        {
            CloseHandle(hProcess);
        }

        OutputJson();
    }

    // ── TreeView Reader ──────────────────────────────────────────────
    static void ReadTreeView(IntPtr tvHwnd, IntPtr hProcess)
    {
        int count = (int)SendMessage(tvHwnd, TVM_GETCOUNT, IntPtr.Zero, IntPtr.Zero);
        if (count <= 0) return;

        Debug("TreeView has " + count + " items");

        // Allocate remote memory for TVITEMW + text buffer
        int tvItemSize = 72; // TVITEMEXW on x64
        int textBufSize = 512;
        int totalAlloc = tvItemSize + textBufSize * 2 + 64;
        IntPtr remoteMem = VirtualAllocEx(hProcess, IntPtr.Zero, totalAlloc, MEM_COMMIT, PAGE_READWRITE);
        if (remoteMem == IntPtr.Zero) return;

        IntPtr remoteTextBuf = new IntPtr(remoteMem.ToInt64() + tvItemSize + 32);

        try
        {
            // Start from root
            IntPtr hItem = SendMessage(tvHwnd, TVM_GETNEXTITEM, (IntPtr)TVGN_ROOT, IntPtr.Zero);
            ReadTreeViewRecursive(tvHwnd, hProcess, hItem, remoteMem, remoteTextBuf, tvItemSize, textBufSize, 0);
        }
        finally
        {
            VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        }
    }

    static void ReadTreeViewRecursive(IntPtr tvHwnd, IntPtr hProcess, IntPtr hItem,
        IntPtr remoteMem, IntPtr remoteTextBuf, int tvItemSize, int textBufSize, int depth)
    {
        if (hItem == IntPtr.Zero || depth > 10) return; // Max depth to avoid infinite loops

        while (hItem != IntPtr.Zero)
        {
            // Build TVITEMW: mask=TVIF_TEXT|TVIF_HANDLE, hItem, pszText, cchTextMax
            byte[] tvItem = new byte[tvItemSize];
            Array.Clear(tvItem, 0, tvItemSize);
            BitConverter.GetBytes((uint)(TVIF_TEXT | TVIF_HANDLE)).CopyTo(tvItem, 0); // mask
            BitConverter.GetBytes(hItem.ToInt64()).CopyTo(tvItem, 8);                  // hItem (offset 8 on x64)
            BitConverter.GetBytes(remoteTextBuf.ToInt64()).CopyTo(tvItem, 24);          // pszText (offset 24 on x64)
            BitConverter.GetBytes(textBufSize).CopyTo(tvItem, 32);                     // cchTextMax (offset 32 on x64)

            int bw;
            WriteProcessMemory(hProcess, remoteMem, tvItem, tvItemSize, out bw);

            SendMessage(tvHwnd, TVM_GETITEMW, IntPtr.Zero, remoteMem);

            // Read text
            byte[] textBytes = new byte[textBufSize * 2];
            int br;
            ReadProcessMemory(hProcess, remoteTextBuf, textBytes, textBytes.Length, out br);
            string text = Encoding.Unicode.GetString(textBytes).TrimEnd('\0');
            if (text.IndexOf('\0') >= 0) text = text.Substring(0, text.IndexOf('\0'));

            if (!string.IsNullOrEmpty(text))
            {
                // Get item rect
                int x = 0, y = 0, w = 0, h = 0;
                // For TVM_GETITEMRECT, write hItem to the remote buffer first (lParam points to RECT, but first DWORD is hItem)
                byte[] hItemBytes = new byte[8];
                // Pass TRUE in wParam to get text-only rect, but we want full item rect
                BitConverter.GetBytes(hItem.ToInt64()).CopyTo(hItemBytes, 0);
                WriteProcessMemory(hProcess, remoteMem, hItemBytes, 8, out bw);
                IntPtr result = SendMessage(tvHwnd, TVM_GETITEMRECT, (IntPtr)1, remoteMem);
                if (result != IntPtr.Zero)
                {
                    byte[] rectBuf = new byte[16];
                    ReadProcessMemory(hProcess, remoteMem, rectBuf, 16, out br);
                    int left = BitConverter.ToInt32(rectBuf, 0);
                    int top = BitConverter.ToInt32(rectBuf, 4);
                    int right = BitConverter.ToInt32(rectBuf, 8);
                    int bottom = BitConverter.ToInt32(rectBuf, 12);

                    // Convert client to screen
                    POINT pt;
                    pt.X = left; pt.Y = top;
                    ClientToScreen(tvHwnd, ref pt);
                    x = pt.X; y = pt.Y;
                    w = right - left;
                    h = bottom - top;
                }

                string indent = depth > 0 ? new string(' ', depth * 2) : "";
                elements.Add(new Dictionary<string, object> {
                    {"type", "TreeItem"},
                    {"name", text},
                    {"depth", depth},
                    {"x", x},
                    {"y", y},
                    {"width", w},
                    {"height", h}
                });

                Debug("  " + indent + "TreeItem: " + text);
            }

            // Recurse into children
            IntPtr hChild = SendMessage(tvHwnd, TVM_GETNEXTITEM, (IntPtr)TVGN_CHILD, hItem);
            if (hChild != IntPtr.Zero)
                ReadTreeViewRecursive(tvHwnd, hProcess, hChild, remoteMem, remoteTextBuf, tvItemSize, textBufSize, depth + 1);

            // Next sibling
            hItem = SendMessage(tvHwnd, TVM_GETNEXTITEM, (IntPtr)TVGN_NEXT, hItem);
        }
    }

    // ── ListView Reader ──────────────────────────────────────────────
    static void ReadListView(IntPtr lvHwnd, IntPtr hProcess)
    {
        int itemCount = (int)SendMessage(lvHwnd, LVM_GETITEMCOUNT, IntPtr.Zero, IntPtr.Zero);
        if (itemCount <= 0) return;

        // Get column count via header control
        IntPtr hHeader = SendMessage(lvHwnd, LVM_GETHEADER, IntPtr.Zero, IntPtr.Zero);
        int colCount = hHeader != IntPtr.Zero
            ? (int)SendMessage(hHeader, HDM_GETITEMCOUNT, IntPtr.Zero, IntPtr.Zero)
            : 1;
        if (colCount <= 0) colCount = 1;
        if (colCount > 20) colCount = 20; // Safety limit

        Debug("ListView has " + itemCount + " items, " + colCount + " columns");

        // Cap items to avoid huge output
        int maxItems = Math.Min(itemCount, 200);

        // LVITEMW on x64: 72 bytes
        int lvItemSize = 72;
        int textBufSize = 512;
        int totalAlloc = lvItemSize + textBufSize * 2 + 64;
        IntPtr remoteMem = VirtualAllocEx(hProcess, IntPtr.Zero, totalAlloc, MEM_COMMIT, PAGE_READWRITE);
        if (remoteMem == IntPtr.Zero) return;

        IntPtr remoteTextBuf = new IntPtr(remoteMem.ToInt64() + lvItemSize + 32);

        try
        {
            for (int i = 0; i < maxItems; i++)
            {
                List<string> columns = new List<string>();

                for (int col = 0; col < colCount; col++)
                {
                    // Build LVITEMW: mask=LVIF_TEXT, iItem, iSubItem, pszText, cchTextMax
                    byte[] lvItem = new byte[lvItemSize];
                    Array.Clear(lvItem, 0, lvItemSize);
                    BitConverter.GetBytes((uint)LVIF_TEXT).CopyTo(lvItem, 0);           // mask
                    BitConverter.GetBytes(i).CopyTo(lvItem, 4);                          // iItem
                    BitConverter.GetBytes(col).CopyTo(lvItem, 8);                        // iSubItem
                    BitConverter.GetBytes(remoteTextBuf.ToInt64()).CopyTo(lvItem, 24);    // pszText (offset 24 on x64)
                    BitConverter.GetBytes(textBufSize).CopyTo(lvItem, 32);               // cchTextMax (offset 32 on x64)

                    int bw;
                    WriteProcessMemory(hProcess, remoteMem, lvItem, lvItemSize, out bw);

                    SendMessage(lvHwnd, LVM_GETITEMTEXTW, (IntPtr)i, remoteMem);

                    // Read text
                    byte[] textBytes = new byte[textBufSize * 2];
                    int br;
                    ReadProcessMemory(hProcess, remoteTextBuf, textBytes, textBytes.Length, out br);
                    string text = Encoding.Unicode.GetString(textBytes).TrimEnd('\0');
                    if (text.IndexOf('\0') >= 0) text = text.Substring(0, text.IndexOf('\0'));

                    columns.Add(text);
                }

                if (columns.Count == 0 || string.IsNullOrEmpty(columns[0])) continue;

                // Get item rect
                int x = 0, y = 0, w = 0, h = 0;
                byte[] rectInput = new byte[16];
                BitConverter.GetBytes(0).CopyTo(rectInput, 0); // LVIR_BOUNDS = 0
                int bw2;
                WriteProcessMemory(hProcess, remoteMem, rectInput, 16, out bw2);
                SendMessage(lvHwnd, LVM_GETITEMRECT, (IntPtr)i, remoteMem);

                byte[] rectBuf = new byte[16];
                int br2;
                ReadProcessMemory(hProcess, remoteMem, rectBuf, 16, out br2);
                int left = BitConverter.ToInt32(rectBuf, 0);
                int top = BitConverter.ToInt32(rectBuf, 4);
                int right = BitConverter.ToInt32(rectBuf, 8);
                int bottom = BitConverter.ToInt32(rectBuf, 12);

                POINT pt;
                pt.X = left; pt.Y = top;
                ClientToScreen(lvHwnd, ref pt);
                x = pt.X; y = pt.Y;
                w = right - left;
                h = bottom - top;

                // Build name from columns
                string name = columns[0];
                string subItems = "";
                if (columns.Count > 1)
                {
                    var subs = new List<string>();
                    for (int c = 1; c < columns.Count; c++)
                    {
                        if (!string.IsNullOrEmpty(columns[c]))
                            subs.Add(columns[c]);
                    }
                    if (subs.Count > 0)
                        subItems = string.Join(" | ", subs.ToArray());
                }

                var el = new Dictionary<string, object> {
                    {"type", "ListItem"},
                    {"name", name},
                    {"x", x},
                    {"y", y},
                    {"width", w},
                    {"height", h}
                };
                if (!string.IsNullOrEmpty(subItems))
                    el["value"] = subItems;

                elements.Add(el);

                Debug("  ListItem[" + i + "]: " + name + (subItems != "" ? " (" + subItems + ")" : ""));
            }
        }
        finally
        {
            VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        }
    }

    // ── ComboBox Reader ──────────────────────────────────────────────
    static void ReadComboBox(IntPtr cbHwnd, IntPtr hProcess)
    {
        int count = (int)SendMessage(cbHwnd, CB_GETCOUNT, IntPtr.Zero, IntPtr.Zero);
        if (count <= 0 || count > 500) return; // Safety

        int curSel = (int)SendMessage(cbHwnd, CB_GETCURSEL, IntPtr.Zero, IntPtr.Zero);

        Debug("ComboBox has " + count + " items, selected=" + curSel);

        // Get combobox position
        RECT cbRect;
        GetWindowRect(cbHwnd, out cbRect);

        // Allocate remote text buffer
        int textBufSize = 512;
        IntPtr remoteMem = VirtualAllocEx(hProcess, IntPtr.Zero, textBufSize * 2, MEM_COMMIT, PAGE_READWRITE);
        if (remoteMem == IntPtr.Zero) return;

        try
        {
            for (int i = 0; i < count; i++)
            {
                int textLen = (int)SendMessage(cbHwnd, CB_GETLBTEXTLEN, (IntPtr)i, IntPtr.Zero);
                if (textLen <= 0 || textLen > textBufSize) continue;

                // CB_GETLBTEXT writes directly to lParam buffer
                SendMessage(cbHwnd, CB_GETLBTEXT, (IntPtr)i, remoteMem);

                byte[] textBytes = new byte[(textLen + 1) * 2];
                int br;
                ReadProcessMemory(hProcess, remoteMem, textBytes, textBytes.Length, out br);
                string text = Encoding.Unicode.GetString(textBytes).TrimEnd('\0');
                if (text.IndexOf('\0') >= 0) text = text.Substring(0, text.IndexOf('\0'));

                if (string.IsNullOrEmpty(text)) continue;

                var el = new Dictionary<string, object> {
                    {"type", "ComboItem"},
                    {"name", text},
                    {"index", i},
                    {"selected", i == curSel},
                    {"x", cbRect.Left},
                    {"y", cbRect.Top},
                    {"width", cbRect.Right - cbRect.Left},
                    {"height", cbRect.Bottom - cbRect.Top}
                };

                elements.Add(el);
                Debug("  ComboItem[" + i + "]: " + text + (i == curSel ? " (selected)" : ""));
            }
        }
        finally
        {
            VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        }
    }

    // ── TabControl Reader ─────────────────────────────────────────────
    static void ReadTabControl(IntPtr tabHwnd, IntPtr hProcess)
    {
        int count = (int)SendMessage(tabHwnd, TCM_GETITEMCOUNT, IntPtr.Zero, IntPtr.Zero);
        if (count <= 0 || count > 50) return; // Safety limit

        int curSel = (int)SendMessage(tabHwnd, TCM_GETCURSEL, IntPtr.Zero, IntPtr.Zero);

        Debug("TabControl has " + count + " items, selected=" + curSel);

        // TCITEMW on x64: 40 bytes
        // offset 0: mask (4), offset 4: dwState (4), offset 8: dwStateMask (4),
        // offset 12: padding (4), offset 16: pszText (8), offset 24: cchTextMax (4),
        // offset 28: iImage (4), offset 32: lParam (8)
        int tcItemSize = 40;
        int textBufSize = 256;
        int totalAlloc = tcItemSize + textBufSize * 2 + 16;
        IntPtr remoteMem = VirtualAllocEx(hProcess, IntPtr.Zero, totalAlloc, MEM_COMMIT, PAGE_READWRITE);
        if (remoteMem == IntPtr.Zero) return;

        IntPtr remoteTextBuf = new IntPtr(remoteMem.ToInt64() + tcItemSize + 8);

        try
        {
            for (int i = 0; i < count; i++)
            {
                // Build TCITEMW
                byte[] tcItem = new byte[tcItemSize];
                Array.Clear(tcItem, 0, tcItemSize);
                BitConverter.GetBytes((uint)TCIF_TEXT).CopyTo(tcItem, 0);           // mask
                BitConverter.GetBytes(remoteTextBuf.ToInt64()).CopyTo(tcItem, 16);   // pszText
                BitConverter.GetBytes(textBufSize).CopyTo(tcItem, 24);              // cchTextMax

                int bw;
                WriteProcessMemory(hProcess, remoteMem, tcItem, tcItemSize, out bw);

                SendMessage(tabHwnd, TCM_GETITEMW, (IntPtr)i, remoteMem);

                // Read text
                byte[] textBytes = new byte[textBufSize * 2];
                int br;
                ReadProcessMemory(hProcess, remoteTextBuf, textBytes, textBytes.Length, out br);
                string text = Encoding.Unicode.GetString(textBytes).TrimEnd('\0');
                if (text.IndexOf('\0') >= 0) text = text.Substring(0, text.IndexOf('\0'));

                if (string.IsNullOrEmpty(text)) continue;

                // Get item rect (client coordinates)
                int x = 0, y = 0, w = 0, h = 0;
                byte[] rectInput = new byte[16];
                Array.Clear(rectInput, 0, 16);
                WriteProcessMemory(hProcess, remoteMem, rectInput, 16, out bw);
                IntPtr result = SendMessage(tabHwnd, TCM_GETITEMRECT, (IntPtr)i, remoteMem);
                if (result != IntPtr.Zero)
                {
                    byte[] rectBuf = new byte[16];
                    ReadProcessMemory(hProcess, remoteMem, rectBuf, 16, out br);
                    int left = BitConverter.ToInt32(rectBuf, 0);
                    int top = BitConverter.ToInt32(rectBuf, 4);
                    int right = BitConverter.ToInt32(rectBuf, 8);
                    int bottom = BitConverter.ToInt32(rectBuf, 12);

                    // Convert client to screen
                    POINT pt;
                    pt.X = left; pt.Y = top;
                    ClientToScreen(tabHwnd, ref pt);
                    x = pt.X; y = pt.Y;
                    w = right - left;
                    h = bottom - top;
                }

                elements.Add(new Dictionary<string, object> {
                    {"type", "TabItem"},
                    {"name", text},
                    {"x", x},
                    {"y", y},
                    {"width", w},
                    {"height", h},
                    {"selected", i == curSel}
                });

                Debug("  TabItem[" + i + "]: " + text + (i == curSel ? " (selected)" : ""));
            }
        }
        finally
        {
            VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        }
    }

    // ── StatusBar Reader ─────────────────────────────────────────────
    static void ReadStatusBar(IntPtr sbHwnd, IntPtr hProcess)
    {
        // Get number of parts
        int partCount = (int)SendMessage(sbHwnd, SB_GETPARTS, IntPtr.Zero, IntPtr.Zero);
        if (partCount <= 0 || partCount > 20) return; // Safety limit

        Debug("StatusBar has " + partCount + " parts");

        int textBufSize = 512;
        IntPtr remoteMem = VirtualAllocEx(hProcess, IntPtr.Zero, textBufSize * 2, MEM_COMMIT, PAGE_READWRITE);
        if (remoteMem == IntPtr.Zero) return;

        try
        {
            for (int i = 0; i < partCount; i++)
            {
                // Get text length
                int textInfo = (int)SendMessage(sbHwnd, SB_GETTEXTLENGTHW, (IntPtr)i, IntPtr.Zero);
                int textLen = textInfo & 0xFFFF;
                if (textLen <= 0 || textLen > textBufSize) continue;

                // Get text
                SendMessage(sbHwnd, SB_GETTEXTW, (IntPtr)i, remoteMem);

                byte[] textBytes = new byte[(textLen + 1) * 2];
                int br;
                ReadProcessMemory(hProcess, remoteMem, textBytes, textBytes.Length, out br);
                string text = Encoding.Unicode.GetString(textBytes).TrimEnd('\0');
                if (text.IndexOf('\0') >= 0) text = text.Substring(0, text.IndexOf('\0'));

                if (string.IsNullOrEmpty(text)) continue;

                // Get part rect (client coordinates)
                int x = 0, y = 0, w = 0, h = 0;
                IntPtr result = SendMessage(sbHwnd, SB_GETRECT, (IntPtr)i, remoteMem);
                if (result != IntPtr.Zero)
                {
                    byte[] rectBuf = new byte[16];
                    ReadProcessMemory(hProcess, remoteMem, rectBuf, 16, out br);
                    int left = BitConverter.ToInt32(rectBuf, 0);
                    int top = BitConverter.ToInt32(rectBuf, 4);
                    int right = BitConverter.ToInt32(rectBuf, 8);
                    int bottom = BitConverter.ToInt32(rectBuf, 12);

                    POINT pt;
                    pt.X = left; pt.Y = top;
                    ClientToScreen(sbHwnd, ref pt);
                    x = pt.X; y = pt.Y;
                    w = right - left;
                    h = bottom - top;
                }

                elements.Add(new Dictionary<string, object> {
                    {"type", "StatusBarItem"},
                    {"name", text},
                    {"x", x},
                    {"y", y},
                    {"width", w},
                    {"height", h}
                });

                Debug("  StatusBarItem[" + i + "]: " + text);
            }
        }
        finally
        {
            VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        }
    }

    // ── Win32 Class → UI Type ────────────────────────────────────────
    static string MapWin32Class(string className)
    {
        switch (className)
        {
            case "Button": return "Button";
            case "Static": return "Text";
            case "Edit": return "Edit";
            case "RichEdit": case "RichEdit20W": case "RICHEDIT50W": return "Edit";
            case "ListBox": case "ComboLBox": return "ListBox";
            case "msctls_trackbar32": return "Slider";
            case "msctls_updown32": return "Spinner";
            case "msctls_progress32": return "ProgressBar";
            case "msctls_hotkey32": return "HotKey";
            case "SysDateTimePick32": return "DatePicker";
            case "SysMonthCal32": return "Calendar";
            case "SysIPAddress32": return "IPAddress";
            case "SysLink": return "Link";
            case "SysHeader32": return "Header";
            case "ReBarWindow32": return "Toolbar";
            case "ToolbarWindow32": return "Toolbar";
            default: return "Control";
        }
    }

    // ── Menu Bar Reader ─────────────────────────────────────────────
    // Reads HMENU-based menu bar items (Fichier, Édition, Affichage, etc.)
    // and recurses one level into submenus for dropdown items.
    static void ReadMenuBarItems(IntPtr hMenu, IntPtr ownerHwnd, int count)
    {
        byte[] textBuf = new byte[512];
        GCHandle handle = GCHandle.Alloc(textBuf, GCHandleType.Pinned);

        try
        {
            IntPtr textPtr = handle.AddrOfPinnedObject();
            int miiSize = 80; // MENUITEMINFOW on x64

            for (uint i = 0; i < (uint)count; i++)
            {
                Array.Clear(textBuf, 0, textBuf.Length);

                byte[] mii = new byte[miiSize];
                Array.Clear(mii, 0, miiSize);
                BitConverter.GetBytes(miiSize).CopyTo(mii, 0);                                    // cbSize
                BitConverter.GetBytes(MIIM_STRING | MIIM_FTYPE | MIIM_SUBMENU).CopyTo(mii, 4);     // fMask
                BitConverter.GetBytes(textPtr.ToInt64()).CopyTo(mii, 56);                           // dwTypeData
                BitConverter.GetBytes(256).CopyTo(mii, 64);                                        // cch

                bool ok = GetMenuItemInfoW(hMenu, i, true, mii);
                if (!ok) continue;

                uint fType = BitConverter.ToUInt32(mii, 8);
                if ((fType & MFT_SEPARATOR) != 0) continue;

                string text = Encoding.Unicode.GetString(textBuf).TrimEnd('\0');
                if (text.IndexOf('\0') >= 0) text = text.Substring(0, text.IndexOf('\0'));
                text = text.Replace("&", ""); // Strip accelerator markers
                if (string.IsNullOrEmpty(text)) continue;

                // Get item rect
                RECT itemRect;
                int x = 0, y = 0, w = 0, h = 0;
                if (GetMenuItemRect(ownerHwnd, hMenu, i, out itemRect))
                {
                    x = itemRect.Left;
                    y = itemRect.Top;
                    w = itemRect.Right - itemRect.Left;
                    h = itemRect.Bottom - itemRect.Top;
                }

                elements.Add(new Dictionary<string, object> {
                    {"type", "MenuItem"},
                    {"name", text},
                    {"x", x},
                    {"y", y},
                    {"width", w},
                    {"height", h}
                });

                Debug("  MenuBar[" + i + "]: " + text);

                // Recurse into submenu (one level — dropdown items)
                IntPtr hSubMenu = GetSubMenu(hMenu, (int)i);
                if (hSubMenu != IntPtr.Zero)
                {
                    int subCount = GetMenuItemCount(hSubMenu);
                    if (subCount > 0 && subCount < 50)
                    {
                        ReadMenuItems(hSubMenu, ownerHwnd, subCount);
                    }
                }
            }
        }
        finally
        {
            handle.Free();
        }
    }

    // ── JSON Output ──────────────────────────────────────────────────
    // ── Popup Menu Reader ─────────────────────────────────────────────
    static void ReadPopupMenu(IntPtr menuHwnd)
    {
        // Get the HMENU from the popup window
        IntPtr hMenu = SendMessage(menuHwnd, MN_GETHMENU, IntPtr.Zero, IntPtr.Zero);
        if (hMenu == IntPtr.Zero) return;

        int count = GetMenuItemCount(hMenu);
        if (count <= 0) return;

        Debug("Popup menu has " + count + " items");

        ReadMenuItems(hMenu, menuHwnd, count);
    }

    static void ReadMenuItems(IntPtr hMenu, IntPtr ownerHwnd, int count)
    {
        // Pre-allocate a large text buffer and pin it for the entire loop
        byte[] textBuf = new byte[512];
        GCHandle handle = GCHandle.Alloc(textBuf, GCHandleType.Pinned);

        try
        {
            IntPtr textPtr = handle.AddrOfPinnedObject();

            // MENUITEMINFOW size on x64: 80 bytes
            int miiSize = 80;

            for (uint i = 0; i < (uint)count; i++)
            {
                // Clear text buffer
                Array.Clear(textBuf, 0, textBuf.Length);

                // Build MENUITEMINFOW with pre-allocated text buffer
                byte[] mii = new byte[miiSize];
                Array.Clear(mii, 0, miiSize);
                BitConverter.GetBytes(miiSize).CopyTo(mii, 0);                              // cbSize
                BitConverter.GetBytes(MIIM_STRING | MIIM_FTYPE | MIIM_STATE).CopyTo(mii, 4); // fMask
                BitConverter.GetBytes(textPtr.ToInt64()).CopyTo(mii, 56);                     // dwTypeData
                BitConverter.GetBytes(256).CopyTo(mii, 64);                                  // cch (buffer size in chars)

                bool ok = GetMenuItemInfoW(hMenu, i, true, mii);
                if (!ok)
                {
                    Debug("  GetMenuItemInfoW failed for item " + i);
                    continue;
                }

                uint fType = BitConverter.ToUInt32(mii, 8);
                if ((fType & MFT_SEPARATOR) != 0) continue; // Skip separators

                // Read text from our buffer
                string text = Encoding.Unicode.GetString(textBuf).TrimEnd('\0');
                if (text.IndexOf('\0') >= 0) text = text.Substring(0, text.IndexOf('\0'));

                // Strip accelerator key markers (&)
                text = text.Replace("&", "");

                if (string.IsNullOrEmpty(text)) continue;

                // Get item rect (screen coords)
                RECT itemRect;
                int x = 0, y = 0, w = 0, h = 0;
                if (GetMenuItemRect(ownerHwnd, hMenu, i, out itemRect))
                {
                    x = itemRect.Left;
                    y = itemRect.Top;
                    w = itemRect.Right - itemRect.Left;
                    h = itemRect.Bottom - itemRect.Top;
                }

                elements.Add(new Dictionary<string, object> {
                    {"type", "MenuItem"},
                    {"name", text},
                    {"x", x},
                    {"y", y},
                    {"width", w},
                    {"height", h}
                });

                Debug("  MenuItem[" + i + "]: " + text);
            }
        }
        finally
        {
            handle.Free();
        }
    }

    static void OutputJson()
    {
        Console.Write("[");
        bool first = true;
        foreach (var el in elements)
        {
            if (!first) Console.Write(",");
            first = false;
            Console.Write("{");
            bool firstField = true;
            foreach (var kv in el)
            {
                if (!firstField) Console.Write(",");
                firstField = false;
                if (kv.Value is string)
                    Console.Write("\"" + kv.Key + "\":\"" + EscapeJson((string)kv.Value) + "\"");
                else if (kv.Value is bool)
                    Console.Write("\"" + kv.Key + "\":" + ((bool)kv.Value ? "true" : "false"));
                else
                    Console.Write("\"" + kv.Key + "\":" + kv.Value);
            }
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
