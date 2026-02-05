using System.Collections.Generic;

namespace OScribe.UnityBridge
{
    // Framing: 4-byte length prefix (big-endian) + JSON payload
    // Permet de gérer les messages >64kb sans troncature

    public class BridgeResponse
    {
        public string Version { get; set; } = "1.0";
        public GameInfo GameInfo { get; set; }
        public List<UIElementData> Elements { get; set; }
        public string Timestamp { get; set; }
    }

    public class GameInfo
    {
        public string Name { get; set; }
        public string Scene { get; set; }
        public ScreenResolution Resolution { get; set; }
    }

    public class ScreenResolution
    {
        public int Width { get; set; }
        public int Height { get; set; }
    }

    public class UIElementData
    {
        public string Type { get; set; }        // "Button", "Text", "Card3D", etc.
        public string Name { get; set; }        // GameObject name
        public string Path { get; set; }        // Hierarchy path
        public ScreenRect ScreenRect { get; set; }
        public bool IsInteractable { get; set; }
        public bool IsVisible { get; set; }
        public string Value { get; set; }       // Text content, etc.
        public string AutomationId { get; set; }
        public bool Is3D { get; set; }          // True si c'est un GameObject 3D
    }

    public class ScreenRect
    {
        public float X { get; set; }
        public float Y { get; set; }
        public float Width { get; set; }
        public float Height { get; set; }
    }
}
