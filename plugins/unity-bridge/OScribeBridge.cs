using BepInEx;
using BepInEx.Configuration;
using BepInEx.Logging;
using Newtonsoft.Json.Linq;
using System.Collections.Concurrent;
using UnityEngine;

namespace OScribe.UnityBridge
{
    [BepInPlugin("com.oscribe.bridge", "OScribe Bridge", "1.1.0")]
    public class OScribeBridge : BaseUnityPlugin
    {
        private TcpServer _server;
        private SceneTreeWalker _walker;
        private ConfigEntry<bool> _showCursor;
        private ConfigEntry<bool> _runInBackground;
        private Texture2D _dot;

        // Queue pour les requêtes - résout le problème du main thread
        internal static ConcurrentQueue<System.Action<BridgeResponse>> PendingRequests
            = new ConcurrentQueue<System.Action<BridgeResponse>>();

        // Commandes d'entrée (click, drag, scroll, screenshot, cursor), exécutées sur le thread principal
        internal static ConcurrentQueue<BridgeCommand> PendingCommands
            = new ConcurrentQueue<BridgeCommand>();

        void Awake()
        {
            _showCursor = Config.Bind("Input", "ShowVirtualCursor", true,
                "Dessine un curseur virtuel dans la fenêtre du jeu à l'endroit de chaque action injectée.");
            _runInBackground = Config.Bind("Input", "RunInBackground", true,
                "Le jeu continue de tourner (et de répondre aux commandes) quand sa fenêtre n'a pas le focus.");

            if (_runInBackground.Value) Application.runInBackground = true;

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

            while (PendingCommands.TryDequeue(out var cmd))
            {
                Run(cmd);
            }
        }

        private void Run(BridgeCommand cmd)
        {
            try
            {
                var name = (string)cmd.Command["cmd"];
                switch (name)
                {
                    case "click":
                        cmd.Reply(InputInjector.Click(F(cmd, "x"), F(cmd, "y")));
                        break;
                    case "scroll":
                        cmd.Reply(InputInjector.Scroll(F(cmd, "x"), F(cmd, "y"), F(cmd, "dy")));
                        break;
                    case "drag":
                        StartCoroutine(InputInjector.Drag(F(cmd, "x"), F(cmd, "y"), F(cmd, "x2"), F(cmd, "y2"), cmd.Reply));
                        break;
                    case "screenshot":
                        StartCoroutine(InputInjector.Screenshot(cmd.Reply));
                        break;
                    case "cursor":
                        _showCursor.Value = cmd.Command["show"] != null && (bool)cmd.Command["show"];
                        cmd.Reply(new JObject { ["ok"] = true, ["show"] = _showCursor.Value }.ToString(Newtonsoft.Json.Formatting.None));
                        break;
                    default:
                        cmd.Reply(InputInjector.Fail("commande inconnue : " + name));
                        break;
                }
            }
            catch (System.Exception ex)
            {
                cmd.Reply(InputInjector.Fail(ex.Message));
            }
        }

        private static float F(BridgeCommand cmd, string key)
        {
            var token = cmd.Command[key];
            return token == null ? 0f : (float)token;
        }

        // Curseur virtuel : visible 0,8 s après chaque action, uniquement dans l'image du jeu.
        void OnGUI()
        {
            if (!_showCursor.Value) return;
            var age = Time.realtimeSinceStartup - InputInjector.LastActionTime;
            if (age < 0f || age > 0.8f) return;

            if (_dot == null)
            {
                _dot = new Texture2D(1, 1);
                _dot.SetPixel(0, 0, Color.white);
                _dot.Apply();
            }

            var p = InputInjector.LastPoint;
            var radius = 8f + age * 40f;
            var alpha = 1f - age / 0.8f;
            GUI.color = new Color(1f, 0.2f, 0.2f, alpha);
            // Anneau (4 côtés) autour du point + point central
            GUI.DrawTexture(new Rect(p.x - radius, p.y - radius, radius * 2f, 2f), _dot);
            GUI.DrawTexture(new Rect(p.x - radius, p.y + radius, radius * 2f, 2f), _dot);
            GUI.DrawTexture(new Rect(p.x - radius, p.y - radius, 2f, radius * 2f), _dot);
            GUI.DrawTexture(new Rect(p.x + radius, p.y - radius, 2f, radius * 2f + 2f), _dot);
            GUI.DrawTexture(new Rect(p.x - 3f, p.y - 3f, 6f, 6f), _dot);
            GUI.color = Color.white;
        }

        void OnDestroy()
        {
            _server?.Stop();
        }
    }
}
