// MsaaReader.cs - Standalone MSAA element reader for Electron apps
// Compile: csc /target:exe /out:MsaaReader.exe MsaaReader.cs
// Usage: MsaaReader.exe "Window Title"

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using Accessibility;

class MsaaReader
{
    [DllImport("oleacc.dll")]
    static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint objId, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IAccessible acc);

    [DllImport("oleacc.dll")]
    static extern int AccessibleChildren(IAccessible paccContainer, int iChildStart, int cChildren, [Out] object[] rgvarChildren, out int pcObtained);

    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    static extern int GetWindowTextLength(IntPtr hWnd);

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    static Guid IID_IAccessible = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");

    static IntPtr targetHwnd = IntPtr.Zero;
    static string searchTitle = "";

    static Dictionary<int, string> roleNames = new Dictionary<int, string> {
        {9, "Window"}, {10, "Client"}, {12, "MenuItem"}, {16, "Pane"}, {15, "Document"},
        {20, "Group"}, {30, "Link"}, {41, "Text"}, {42, "Edit"}, {43, "Button"},
        {44, "CheckBox"}, {45, "RadioButton"}, {46, "ComboBox"}, {33, "List"}, {34, "ListItem"},
        {51, "Slider"}, {52, "SpinButton"}, {37, "TabItem"}, {57, "MenuButton"}, {60, "TabList"},
        {2, "TitleBar"}, {3, "ScrollBar"}, {4, "Grip"}, {11, "MenuPopup"}, {21, "Separator"}
    };

    static List<Dictionary<string, object>> elements = new List<Dictionary<string, object>>();

    static void Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        searchTitle = args.Length > 0 ? args[0] : "SendStock";

        // Find window
        EnumWindows((hwnd, lParam) => {
            if (IsWindowVisible(hwnd)) {
                int len = GetWindowTextLength(hwnd);
                if (len > 0) {
                    var sb = new StringBuilder(len + 1);
                    GetWindowText(hwnd, sb, sb.Capacity);
                    if (sb.ToString().IndexOf(searchTitle, StringComparison.OrdinalIgnoreCase) >= 0) {
                        targetHwnd = hwnd;
                        return false;
                    }
                }
            }
            return true;
        }, IntPtr.Zero);

        if (targetHwnd == IntPtr.Zero) {
            Console.WriteLine("{\"error\": \"Window not found\"}");
            return;
        }

        // Get IAccessible
        IAccessible acc;
        int hr = AccessibleObjectFromWindow(targetHwnd, 0, ref IID_IAccessible, out acc);
        if (hr != 0 || acc == null) {
            Console.WriteLine("{\"error\": \"Failed to get IAccessible\"}");
            return;
        }

        // Walk tree
        WalkAccessible(acc, 0, 0);

        // Output JSON
        Console.Write("{\"window\":\"" + EscapeJson(searchTitle) + "\",\"strategy\":\"msaa\",\"total\":" + elements.Count);
        Console.Write(",\"elements\":[");

        bool first = true;
        foreach (var el in elements) {
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
        Console.WriteLine("]}");
    }

    static void WalkAccessible(IAccessible acc, int childId, int depth)
    {
        if (depth > 25 || elements.Count > 500) return;

        try {
            string name = null;
            int role = 0;
            int x = 0, y = 0, w = 0, h = 0;

            try { name = acc.get_accName(childId); } catch {}
            try { role = (int)acc.get_accRole(childId); } catch {}
            try { acc.accLocation(out x, out y, out w, out h, childId); } catch {}

            string roleStr = roleNames.ContainsKey(role) ? roleNames[role] : "Role" + role;

            // Only add elements with bounds and interactive types
            if (w > 0 && h > 0) {
                bool isInteractive = roleStr == "Button" || roleStr == "Link" || roleStr == "CheckBox" ||
                    roleStr == "RadioButton" || roleStr == "ComboBox" || roleStr == "Edit" ||
                    roleStr == "ListItem" || roleStr == "MenuItem" || roleStr == "TabItem" ||
                    roleStr == "Slider" || roleStr == "SpinButton" || roleStr == "MenuButton" ||
                    (roleStr == "Text" && !string.IsNullOrEmpty(name));

                if (isInteractive || !string.IsNullOrEmpty(name)) {
                    elements.Add(new Dictionary<string, object> {
                        {"type", roleStr},
                        {"name", name ?? ""},
                        {"x", x},
                        {"y", y},
                        {"width", w},
                        {"height", h}
                    });
                }
            }

            // Only walk children for IAccessible objects (childId == 0)
            if (childId == 0) {
                int childCount = 0;
                try { childCount = acc.accChildCount; } catch {}

                if (childCount > 0) {
                    object[] children = new object[childCount];
                    int obtained;
                    AccessibleChildren(acc, 0, childCount, children, out obtained);

                    for (int i = 0; i < obtained; i++) {
                        if (children[i] == null) continue;

                        if (children[i] is IAccessible) {
                            WalkAccessible((IAccessible)children[i], 0, depth + 1);
                        } else if (children[i] is int) {
                            WalkAccessible(acc, (int)children[i], depth + 1);
                        }
                    }
                }
            }
        } catch {}
    }

    static string EscapeJson(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
    }
}
