# Plan : Unity Bridge Integration pour OScribe

## Préparation

```bash
git checkout main
git pull origin main
git checkout -b feature/unity-bridge
```

## Résumé

Ajouter une nouvelle stratégie `unity` dans la cascade de détection UI d'OScribe. Le Unity Bridge permet d'accéder directement au scene tree des jeux Unity via TCP/JSON, offrant une précision bien supérieure à l'UI Automation native.

**Ordre de priorité de la cascade (après implémentation):**
1. **Unity Bridge** (localhost:9876) - jeux Unity avec plugin BepInEx
2. **Browser CDP** - navigateurs Chromium
3. **Native UIA / Document / MSAA** - apps classiques
4. **Vision** - fallback universel

---

## Structure des fichiers

```
oscribe/
├── src/core/
│   └── unity-bridge.ts          ← NEW: Client TCP (Node.js)
├── plugins/
│   └── unity-bridge/            ← NEW: Plugin BepInEx (C#)
│       ├── OScribeBridge.cs     ← Plugin principal
│       ├── SceneTreeWalker.cs   ← Walker du scene tree
│       ├── UIElementDetector.cs ← Détection éléments UI
│       ├── TcpServer.cs         ← Serveur TCP :9876
│       ├── Protocol.cs          ← Types JSON partagés
│       └── README.md            ← Instructions installation
```

---

## Partie 1 : Client TCP (Node.js)

### `oscribe/src/core/unity-bridge.ts` (nouveau)

```typescript
/**
 * Unity Bridge Client
 *
 * TCP client for communicating with Unity games running the OScribe Bridge plugin.
 * Protocol: Length-prefix framing (4 bytes big-endian length + JSON payload)
 */

import { createConnection, Socket } from 'node:net';
import { z } from 'zod';
import { UIElement } from './uiautomation.js';

// ============================================================================
// Types
// ============================================================================

const UnityBridgeConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.number().default(9876),
  timeout: z.number().default(3000),
});

type UnityBridgeConfig = z.infer<typeof UnityBridgeConfigSchema>;

interface UnityBridgeResponse {
  version: string;
  gameInfo: {
    name: string;
    scene: string;
    resolution: { width: number; height: number };
  };
  elements: UnityUIElement[];
  timestamp: string;
}

interface UnityUIElement {
  type: string;
  name: string;
  path: string;
  screenRect: { x: number; y: number; width: number; height: number };
  isInteractable: boolean;
  isVisible: boolean;
  value?: string;
  automationId?: string;
  is3D?: boolean;
}

// ============================================================================
// Custom Errors
// ============================================================================

export class UnityBridgeNotRunningError extends Error {
  constructor(port: number) {
    super(`Unity Bridge not running on port ${port}`);
    this.name = 'UnityBridgeNotRunningError';
  }
}

export class UnityBridgeTimeoutError extends Error {
  constructor(timeout: number) {
    super(`Unity Bridge connection timeout after ${timeout}ms`);
    this.name = 'UnityBridgeTimeoutError';
  }
}

export class UnityBridgeProtocolError extends Error {
  constructor(message: string) {
    super(`Unity Bridge protocol error: ${message}`);
    this.name = 'UnityBridgeProtocolError';
  }
}

// ============================================================================
// Circuit Breaker
// ============================================================================

let circuitBreakerFailures = 0;
let circuitBreakerLastFailure: number | null = null;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_TIME = 30000;

function isCircuitBreakerOpen(): boolean {
  if (circuitBreakerFailures < CIRCUIT_BREAKER_THRESHOLD) return false;
  if (!circuitBreakerLastFailure) return false;

  const elapsed = Date.now() - circuitBreakerLastFailure;
  if (elapsed > CIRCUIT_BREAKER_RESET_TIME) {
    // Reset circuit breaker
    circuitBreakerFailures = 0;
    circuitBreakerLastFailure = null;
    return false;
  }
  return true;
}

function recordFailure(): void {
  circuitBreakerFailures++;
  circuitBreakerLastFailure = Date.now();
}

function recordSuccess(): void {
  circuitBreakerFailures = 0;
  circuitBreakerLastFailure = null;
}

// ============================================================================
// Detection
// ============================================================================

const UNITY_WINDOW_CLASSES = ['UnityWndClass', 'UnityContainerWndClass'];

export function detectUnityGame(processName: string, windowClass: string): boolean {
  // Check window class
  if (UNITY_WINDOW_CLASSES.some(cls => windowClass.includes(cls))) {
    return true;
  }

  // Check known Unity process names (add more as needed)
  const knownUnityProcesses = [
    'hearthstone',
    'among us',
    'genshin',
    'hollow knight',
  ];

  const procLower = processName.toLowerCase();
  return knownUnityProcesses.some(name => procLower.includes(name));
}

// ============================================================================
// TCP Client with Length-Prefix Framing
// ============================================================================

/**
 * Read response with length-prefix framing protocol.
 * Format: [4 bytes big-endian length] + [JSON payload]
 */
async function readFramedResponse(socket: Socket, timeout: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let expectedLength: number | null = null;
    let totalReceived = 0;

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new UnityBridgeTimeoutError(timeout));
    }, timeout);

    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      totalReceived += chunk.length;

      // Read length header (first 4 bytes)
      if (expectedLength === null && totalReceived >= 4) {
        const headerBuffer = Buffer.concat(chunks);
        expectedLength = headerBuffer.readUInt32BE(0); // Big-endian

        // Sanity check: max 10MB
        if (expectedLength > 10 * 1024 * 1024) {
          clearTimeout(timer);
          socket.destroy();
          reject(new UnityBridgeProtocolError(`Invalid length: ${expectedLength}`));
          return;
        }
      }

      // Check if we have the full payload
      if (expectedLength !== null && totalReceived >= 4 + expectedLength) {
        clearTimeout(timer);
        const fullBuffer = Buffer.concat(chunks);
        const payload = fullBuffer.subarray(4, 4 + expectedLength);
        resolve(payload);
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.on('close', () => {
      clearTimeout(timer);
      if (expectedLength === null || totalReceived < 4 + expectedLength) {
        reject(new UnityBridgeProtocolError('Connection closed before full response'));
      }
    });
  });
}

// ============================================================================
// Public API
// ============================================================================

export async function isUnityBridgeAvailable(port = 9876): Promise<boolean> {
  if (isCircuitBreakerOpen()) return false;

  try {
    const socket = createConnection({ host: 'localhost', port });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      setTimeout(() => reject(new Error('timeout')), 500);
    });
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}

export async function getUnityElements(config?: Partial<UnityBridgeConfig>): Promise<{
  elements: UIElement[];
  gameInfo: UnityBridgeResponse['gameInfo'];
}> {
  const cfg = UnityBridgeConfigSchema.parse(config ?? {});

  if (isCircuitBreakerOpen()) {
    throw new UnityBridgeNotRunningError(cfg.port);
  }

  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: cfg.host, port: cfg.port });

    socket.once('connect', async () => {
      try {
        const payload = await readFramedResponse(socket, cfg.timeout);
        const json = payload.toString('utf-8');
        const response: UnityBridgeResponse = JSON.parse(json);

        recordSuccess();

        // Convert Unity elements to UIElement format
        const elements: UIElement[] = response.elements.map(el => ({
          type: el.is3D ? `${el.type}` : el.type,
          name: el.name,
          description: el.path,
          automationId: el.automationId,
          x: Math.round(el.screenRect.x),
          y: Math.round(el.screenRect.y),
          width: Math.round(el.screenRect.width),
          height: Math.round(el.screenRect.height),
          isEnabled: el.isInteractable && el.isVisible,
          value: el.value,
        }));

        resolve({ elements, gameInfo: response.gameInfo });
      } catch (err) {
        recordFailure();
        reject(err);
      } finally {
        socket.destroy();
      }
    });

    socket.once('error', (err: NodeJS.ErrnoException) => {
      recordFailure();
      if (err.code === 'ECONNREFUSED') {
        reject(new UnityBridgeNotRunningError(cfg.port));
      } else {
        reject(err);
      }
    });
  });
}
```

**Protocole JSON:**
```typescript
interface UnityBridgeResponse {
  version: string;
  gameInfo: {
    name: string;
    scene: string;
    resolution: { width: number; height: number };
  };
  elements: UnityUIElement[];
  timestamp: string;
}

interface UnityUIElement {
  type: string;           // "Button", "Text", "Slider", "TMPro.TextMeshProUGUI"
  name: string;           // GameObject name
  path: string;           // "Canvas/MainMenu/StartButton"
  screenRect: { x: number; y: number; width: number; height: number };
  isInteractable: boolean;
  isVisible: boolean;
  value?: string;         // Text content, slider value, etc.
  automationId?: string;  // Custom ID if set
}
```

---

## Partie 2 : Plugin BepInEx (C#)

### `oscribe/plugins/unity-bridge/Protocol.cs`

```csharp
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
```

### `oscribe/plugins/unity-bridge/OScribeBridge.cs`

```csharp
using BepInEx;
using BepInEx.Logging;
using System.Collections.Concurrent;
using UnityEngine;

namespace OScribe.UnityBridge
{
    [BepInPlugin("com.oscribe.bridge", "OScribe Bridge", "1.0.0")]
    public class OScribeBridge : BaseUnityPlugin
    {
        private TcpServer _server;
        private SceneTreeWalker _walker;

        // Queue pour les requêtes - résout le problème du main thread
        internal static ConcurrentQueue<System.Action<BridgeResponse>> PendingRequests
            = new ConcurrentQueue<System.Action<BridgeResponse>>();

        void Awake()
        {
            _walker = new SceneTreeWalker();
            _server = new TcpServer(9876);
            _server.Start();
            Logger.LogInfo("OScribe Bridge started on port 9876");
        }

        void Update()
        {
            // Process pending requests on main thread (Unity API safe)
            while (PendingRequests.TryDequeue(out var callback))
            {
                var response = new BridgeResponse
                {
                    Version = "1.0",
                    GameInfo = new GameInfo
                    {
                        Name = Application.productName,
                        Scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene().name,
                        Resolution = new ScreenResolution
                        {
                            Width = Screen.width,
                            Height = Screen.height
                        }
                    },
                    Elements = _walker.GetAllElements(), // Canvas + 3D
                    Timestamp = System.DateTime.UtcNow.ToString("o")
                };
                callback(response);
            }
        }

        void OnDestroy()
        {
            _server?.Stop();
        }
    }
}
```

### `oscribe/plugins/unity-bridge/SceneTreeWalker.cs`

```csharp
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using System.Collections.Generic;
using System.Linq;

namespace OScribe.UnityBridge
{
    public class SceneTreeWalker
    {
        private Camera _mainCamera;

        /// <summary>
        /// Récupère TOUS les éléments : Canvas UI + GameObjects 3D interactifs
        /// </summary>
        public List<UIElementData> GetAllElements()
        {
            _mainCamera = Camera.main;
            var elements = new List<UIElementData>();

            // 1. Canvas UI (boutons, textes, etc.)
            GetCanvasElements(elements);

            // 2. GameObjects 3D avec Collider (cartes, personnages, objets cliquables)
            Get3DInteractiveElements(elements);

            return elements;
        }

        #region Canvas UI Elements

        private void GetCanvasElements(List<UIElementData> elements)
        {
            var canvases = Object.FindObjectsOfType<Canvas>()
                .Where(c => c.gameObject.activeInHierarchy);

            foreach (var canvas in canvases)
            {
                WalkCanvasTransform(canvas.transform, elements, canvas.name);
            }
        }

        private void WalkCanvasTransform(Transform t, List<UIElementData> elements, string path)
        {
            var fullPath = string.IsNullOrEmpty(path) ? t.name : $"{path}/{t.name}";

            var element = TryCreateUIElement(t, fullPath);
            if (element != null)
            {
                elements.Add(element);
            }

            foreach (Transform child in t)
            {
                WalkCanvasTransform(child, elements, fullPath);
            }
        }

        private UIElementData TryCreateUIElement(Transform t, string path)
        {
            var rectTransform = t.GetComponent<RectTransform>();
            if (rectTransform == null) return null;

            // Detect UI component type
            string type = null;
            string value = null;
            bool isInteractable = false;

            var button = t.GetComponent<Button>();
            var toggle = t.GetComponent<Toggle>();
            var slider = t.GetComponent<Slider>();
            var inputField = t.GetComponent<InputField>();
            var tmpInput = t.GetComponent<TMP_InputField>();
            var dropdown = t.GetComponent<Dropdown>();
            var tmpDropdown = t.GetComponent<TMP_Dropdown>();
            var text = t.GetComponent<Text>();
            var tmpText = t.GetComponent<TMP_Text>();
            var image = t.GetComponent<Image>();

            if (button != null)
            {
                type = "Button";
                isInteractable = button.interactable;
            }
            else if (toggle != null)
            {
                type = "Toggle";
                value = toggle.isOn.ToString();
                isInteractable = toggle.interactable;
            }
            else if (slider != null)
            {
                type = "Slider";
                value = slider.value.ToString("F2");
                isInteractable = slider.interactable;
            }
            else if (inputField != null)
            {
                type = "InputField";
                value = inputField.text;
                isInteractable = inputField.interactable;
            }
            else if (tmpInput != null)
            {
                type = "InputField";
                value = tmpInput.text;
                isInteractable = tmpInput.interactable;
            }
            else if (dropdown != null || tmpDropdown != null)
            {
                type = "Dropdown";
                isInteractable = dropdown?.interactable ?? tmpDropdown?.interactable ?? false;
            }
            else if (tmpText != null)
            {
                type = "Text";
                value = tmpText.text;
            }
            else if (text != null)
            {
                type = "Text";
                value = text.text;
            }
            else if (image != null && image.raycastTarget)
            {
                type = "Image";
                isInteractable = true; // Clickable image
            }

            if (type == null) return null;

            var screenRect = GetScreenRectFromRectTransform(rectTransform);

            return new UIElementData
            {
                Type = type,
                Name = t.name,
                Path = path,
                ScreenRect = screenRect,
                IsInteractable = isInteractable,
                IsVisible = t.gameObject.activeInHierarchy && IsVisibleOnScreen(screenRect),
                Value = value,
                Is3D = false
            };
        }

        #endregion

        #region 3D Interactive Elements

        private void Get3DInteractiveElements(List<UIElementData> elements)
        {
            if (_mainCamera == null) return;

            // Find all GameObjects with Colliders that are interactive
            var colliders = Object.FindObjectsOfType<Collider>()
                .Where(c => c.gameObject.activeInHierarchy)
                .Where(c => IsInteractive3DObject(c.gameObject));

            foreach (var collider in colliders)
            {
                var element = TryCreate3DElement(collider);
                if (element != null)
                {
                    elements.Add(element);
                }
            }

            // Also check 2D colliders (for 2D games)
            var colliders2D = Object.FindObjectsOfType<Collider2D>()
                .Where(c => c.gameObject.activeInHierarchy)
                .Where(c => IsInteractive3DObject(c.gameObject));

            foreach (var collider in colliders2D)
            {
                var element = TryCreate2DElement(collider);
                if (element != null)
                {
                    elements.Add(element);
                }
            }
        }

        private bool IsInteractive3DObject(GameObject go)
        {
            // Has click handler, or is tagged as interactive, or has common interactive components
            return go.GetComponent<IPointerClickHandler>() != null
                || go.GetComponent<IPointerDownHandler>() != null
                || go.CompareTag("Interactable")
                || go.CompareTag("Card")
                || go.layer == LayerMask.NameToLayer("Interactive")
                || go.layer == LayerMask.NameToLayer("UI");
        }

        private UIElementData TryCreate3DElement(Collider collider)
        {
            var bounds = collider.bounds;
            var screenRect = GetScreenRectFrom3DBounds(bounds);

            if (screenRect == null) return null; // Behind camera or off-screen

            var go = collider.gameObject;
            return new UIElementData
            {
                Type = Detect3DType(go),
                Name = go.name,
                Path = GetGameObjectPath(go),
                ScreenRect = screenRect,
                IsInteractable = true,
                IsVisible = true,
                Is3D = true,
                Value = GetGameObjectValue(go)
            };
        }

        private UIElementData TryCreate2DElement(Collider2D collider)
        {
            var bounds = collider.bounds;
            var screenRect = GetScreenRectFrom3DBounds(bounds);

            if (screenRect == null) return null;

            var go = collider.gameObject;
            return new UIElementData
            {
                Type = Detect3DType(go),
                Name = go.name,
                Path = GetGameObjectPath(go),
                ScreenRect = screenRect,
                IsInteractable = true,
                IsVisible = true,
                Is3D = true,
                Value = GetGameObjectValue(go)
            };
        }

        private string Detect3DType(GameObject go)
        {
            // Heuristics based on name/tag/components
            var nameLower = go.name.ToLower();
            if (nameLower.Contains("card")) return "Card3D";
            if (nameLower.Contains("button")) return "Button3D";
            if (nameLower.Contains("hero") || nameLower.Contains("character")) return "Character3D";
            if (nameLower.Contains("minion")) return "Minion3D";
            if (go.CompareTag("Card")) return "Card3D";
            return "Interactive3D";
        }

        private string GetGameObjectValue(GameObject go)
        {
            // Try to get text from child TextMeshPro or Text
            var tmp = go.GetComponentInChildren<TMP_Text>();
            if (tmp != null) return tmp.text;

            var text = go.GetComponentInChildren<Text>();
            if (text != null) return text.text;

            return null;
        }

        #endregion

        #region Coordinate Conversion

        private ScreenRect GetScreenRectFromRectTransform(RectTransform rt)
        {
            var corners = new Vector3[4];
            rt.GetWorldCorners(corners);

            var min = RectTransformUtility.WorldToScreenPoint(null, corners[0]);
            var max = RectTransformUtility.WorldToScreenPoint(null, corners[2]);

            // Flip Y (Unity screen Y=0 is bottom, we want Y=0 at top)
            return new ScreenRect
            {
                X = min.x,
                Y = Screen.height - max.y,
                Width = max.x - min.x,
                Height = max.y - min.y
            };
        }

        private ScreenRect GetScreenRectFrom3DBounds(Bounds bounds)
        {
            if (_mainCamera == null) return null;

            // Project 8 corners of bounds to screen
            var corners = new Vector3[8];
            var c = bounds.center;
            var e = bounds.extents;

            corners[0] = c + new Vector3(-e.x, -e.y, -e.z);
            corners[1] = c + new Vector3(e.x, -e.y, -e.z);
            corners[2] = c + new Vector3(-e.x, e.y, -e.z);
            corners[3] = c + new Vector3(e.x, e.y, -e.z);
            corners[4] = c + new Vector3(-e.x, -e.y, e.z);
            corners[5] = c + new Vector3(e.x, -e.y, e.z);
            corners[6] = c + new Vector3(-e.x, e.y, e.z);
            corners[7] = c + new Vector3(e.x, e.y, e.z);

            float minX = float.MaxValue, minY = float.MaxValue;
            float maxX = float.MinValue, maxY = float.MinValue;

            foreach (var corner in corners)
            {
                var screenPos = _mainCamera.WorldToScreenPoint(corner);

                // Behind camera check
                if (screenPos.z < 0) return null;

                minX = Mathf.Min(minX, screenPos.x);
                maxX = Mathf.Max(maxX, screenPos.x);
                minY = Mathf.Min(minY, screenPos.y);
                maxY = Mathf.Max(maxY, screenPos.y);
            }

            // Off-screen check
            if (maxX < 0 || minX > Screen.width || maxY < 0 || minY > Screen.height)
                return null;

            return new ScreenRect
            {
                X = minX,
                Y = Screen.height - maxY, // Flip Y
                Width = maxX - minX,
                Height = maxY - minY
            };
        }

        private bool IsVisibleOnScreen(ScreenRect rect)
        {
            return rect.X + rect.Width > 0
                && rect.X < Screen.width
                && rect.Y + rect.Height > 0
                && rect.Y < Screen.height;
        }

        private string GetGameObjectPath(GameObject go)
        {
            var path = go.name;
            var parent = go.transform.parent;
            while (parent != null)
            {
                path = parent.name + "/" + path;
                parent = parent.parent;
            }
            return path;
        }

        #endregion
    }
}
```

### `oscribe/plugins/unity-bridge/TcpServer.cs`

```csharp
using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections.Concurrent;
using Newtonsoft.Json;

namespace OScribe.UnityBridge
{
    /// <summary>
    /// TCP Server with length-prefix framing protocol.
    /// Framing: [4 bytes length (big-endian)] + [JSON payload]
    /// This handles messages >64kb without truncation.
    /// </summary>
    public class TcpServer
    {
        private TcpListener _listener;
        private Thread _thread;
        private volatile bool _running;
        private readonly int _port;

        // Queue of pending client connections waiting for response
        private readonly ConcurrentQueue<TcpClient> _pendingClients
            = new ConcurrentQueue<TcpClient>();

        public TcpServer(int port)
        {
            _port = port;
        }

        public void Start()
        {
            _listener = new TcpListener(IPAddress.Loopback, _port);
            _listener.Start();
            _running = true;
            _thread = new Thread(ListenLoop) { IsBackground = true };
            _thread.Start();
        }

        public void Stop()
        {
            _running = false;
            _listener?.Stop();
            _thread?.Join(1000);

            // Clean up pending clients
            while (_pendingClients.TryDequeue(out var client))
            {
                client?.Close();
            }
        }

        private void ListenLoop()
        {
            while (_running)
            {
                try
                {
                    if (_listener.Pending())
                    {
                        var client = _listener.AcceptTcpClient();
                        client.ReceiveTimeout = 5000;
                        client.SendTimeout = 5000;

                        // Queue request to be processed on Unity main thread
                        OScribeBridge.PendingRequests.Enqueue(response =>
                        {
                            SendResponse(client, response);
                        });
                    }
                    else
                    {
                        Thread.Sleep(10);
                    }
                }
                catch (SocketException) when (!_running)
                {
                    // Expected during shutdown
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[OScribe] TCP error: {ex.Message}");
                }
            }
        }

        private void SendResponse(TcpClient client, BridgeResponse response)
        {
            try
            {
                var json = JsonConvert.SerializeObject(response, Formatting.None);
                var payload = Encoding.UTF8.GetBytes(json);

                // Length-prefix framing: 4 bytes (big-endian) + payload
                var lengthBytes = BitConverter.GetBytes(payload.Length);
                if (BitConverter.IsLittleEndian)
                {
                    Array.Reverse(lengthBytes); // Convert to big-endian
                }

                var stream = client.GetStream();
                stream.Write(lengthBytes, 0, 4);
                stream.Write(payload, 0, payload.Length);
                stream.Flush();
            }
            catch (Exception ex)
            {
                Debug.LogError($"[OScribe] Send error: {ex.Message}");
            }
            finally
            {
                client?.Close();
            }
        }
    }
}
```

### `oscribe/plugins/unity-bridge/UIElementDetector.cs`

```csharp
using UnityEngine;
using UnityEngine.EventSystems;

namespace OScribe.UnityBridge
{
    /// <summary>
    /// Utility class for detecting interactable elements at screen positions.
    /// Used for debugging and validation.
    /// </summary>
    public static class UIElementDetector
    {
        /// <summary>
        /// Find UI element at screen position using EventSystem raycast.
        /// </summary>
        public static GameObject GetUIElementAtPosition(Vector2 screenPos)
        {
            var eventData = new PointerEventData(EventSystem.current)
            {
                position = screenPos
            };

            var results = new System.Collections.Generic.List<RaycastResult>();
            EventSystem.current?.RaycastAll(eventData, results);

            return results.Count > 0 ? results[0].gameObject : null;
        }

        /// <summary>
        /// Find 3D object at screen position using Physics raycast.
        /// </summary>
        public static GameObject Get3DElementAtPosition(Vector2 screenPos)
        {
            var camera = Camera.main;
            if (camera == null) return null;

            var ray = camera.ScreenPointToRay(screenPos);
            if (Physics.Raycast(ray, out var hit, Mathf.Infinity))
            {
                return hit.collider.gameObject;
            }

            // Try 2D raycast
            var hit2D = Physics2D.Raycast(screenPos, Vector2.zero);
            if (hit2D.collider != null)
            {
                return hit2D.collider.gameObject;
            }

            return null;
        }

        /// <summary>
        /// Get any element (UI or 3D) at screen position.
        /// UI takes priority over 3D.
        /// </summary>
        public static GameObject GetElementAtPosition(Vector2 screenPos)
        {
            return GetUIElementAtPosition(screenPos) ?? Get3DElementAtPosition(screenPos);
        }
    }
}
```

### `oscribe/plugins/unity-bridge/README.md`

````markdown
# OScribe Unity Bridge Plugin

Plugin BepInEx pour exposer le scene tree Unity à OScribe via TCP.

## Installation

1. **Installer BepInEx** dans le jeu cible :
   - Télécharger BepInEx depuis https://github.com/BepInEx/BepInEx/releases
   - Extraire dans le dossier du jeu (à côté de l'exe)

2. **Copier le plugin** :
   ```
   BepInEx/plugins/OScribeBridge.dll
   ```

3. **Lancer le jeu** - le plugin démarre automatiquement sur le port 9876

## Build

```bash
cd oscribe/plugins/unity-bridge
dotnet build -c Release
```

Output: `bin/Release/net472/OScribeBridge.dll`

## Protocole TCP

**Port:** `localhost:9876`

**Framing:** Length-prefix (gère les payloads >64kb)
```
[4 bytes: length (big-endian)] + [JSON payload]
```

**Response JSON:**
```json
{
  "version": "1.0",
  "gameInfo": {
    "name": "Hearthstone",
    "scene": "MainMenu",
    "resolution": { "width": 1920, "height": 1080 }
  },
  "elements": [
    {
      "type": "Button",
      "name": "PlayButton",
      "path": "Canvas/MainMenu/PlayButton",
      "screenRect": { "x": 860, "y": 440, "width": 200, "height": 60 },
      "isInteractable": true,
      "isVisible": true,
      "value": null,
      "is3D": false
    },
    {
      "type": "Card3D",
      "name": "HandCard_0",
      "path": "GameBoard/Hand/HandCard_0",
      "screenRect": { "x": 400, "y": 700, "width": 120, "height": 180 },
      "isInteractable": true,
      "isVisible": true,
      "value": "Fireball",
      "is3D": true
    }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Éléments détectés

### Canvas UI
- Button, Toggle, Slider, InputField, Dropdown
- Text, TMP_Text
- Image (si raycastTarget=true)

### GameObjects 3D
- Tout objet avec Collider/Collider2D
- Filtré par : tag "Interactable"/"Card", layer "Interactive", ou handlers IPointer*

## Debugging

Logs dans la console BepInEx :
```
[Info   : OScribe] OScribe Bridge started on port 9876
```

Test manuel :
```bash
# Depuis PowerShell
$client = New-Object System.Net.Sockets.TcpClient("localhost", 9876)
# Lire la réponse...
```
````

---

## Partie 3 : Intégration OScribe

### `oscribe/src/core/uiautomation.ts`

**Modifications:**

1. **Ligne 36** - Ajouter 'unity' au type:
```typescript
strategy: 'native' | 'webview2' | 'electron' | 'uwp' | 'browser' | 'unity';
```

2. **Ligne 97** - Modifier `detectStrategy()`:
```typescript
function detectStrategy(windowClass: string, processName?: string): Strategy {
  // NEW: Check Unity first (highest priority after browser)
  if (detectUnityGame(processName || '', windowClass)) {
    return 'unity';
  }
  // ... reste inchangé
}
```

3. **Ligne ~191** - Ajouter handling Unity:
```typescript
if (strategy === 'unity') {
  if (await isUnityBridgeAvailable()) {
    elements = await getUnityElements();
  } else {
    console.warn('[uiautomation] Unity Bridge not available, fallback native');
    elements = await findNativeElements(windowInfo.name);
  }
}
```

### `oscribe/src/config/window-types.json`

```json
{
  "strategies": {
    "unity": {
      "description": "Unity games with OScribe Bridge - direct scene tree access",
      "method": "unityBridge",
      "scope": "gameProcess",
      "fallback": ["native", "vision"]
    }
  },
  "windowClasses": {
    "UnityWndClass": {
      "strategy": "unity",
      "note": "Standard Unity game window",
      "examples": ["Hearthstone", "Among Us"]
    }
  }
}
```

### `oscribe/src/mcp/server.ts`

Output de `os_screenshot` pour Unity:
```
🎮 UNITY GAME DETECTED: "Hearthstone"
🔧 Strategy: unity (Bridge active ✓)

Elements (42):
- Button: "Play" center=(960,540) path=Canvas/MainMenu/PlayButton
- Text: "Welcome" center=(960,200)
...
```

Si bridge non disponible:
```
🎮 UNITY GAME DETECTED: "Hearthstone"
⚠️ Strategy: native (Unity Bridge not running)

💡 Unity Bridge provides 10x more elements.
   Install: Copy OScribeBridge.dll to BepInEx/plugins/
```

---

## Vérification

1. **Build plugin C#**:
   ```bash
   cd oscribe/plugins/unity-bridge
   dotnet build -c Release
   ```

2. **Test mock server** (sans jeu):
   ```bash
   # Script Node.js qui simule le serveur TCP sur 9876
   node scripts/mock-unity-server.js
   ```

3. **Test intégration**:
   - `os_screenshot` sur app normale → strategy: native
   - `os_screenshot` sur fenêtre Unity sans plugin → strategy: native + warning
   - `os_screenshot` sur fenêtre Unity avec plugin → strategy: unity + éléments

4. **Test end-to-end**:
   - Installer plugin dans un jeu Unity
   - `os_screenshot` doit afficher le scene tree complet

---

## Fichiers critiques

| Fichier | Action |
|---------|--------|
| `oscribe/src/core/unity-bridge.ts` | Créer - Client TCP |
| `oscribe/src/core/uiautomation.ts` | Modifier - Ajouter stratégie unity |
| `oscribe/src/config/window-types.json` | Modifier - Ajouter UnityWndClass |
| `oscribe/src/core/index.ts` | Modifier - Export unity-bridge |
| `oscribe/plugins/unity-bridge/` | Créer - Plugin BepInEx complet |
