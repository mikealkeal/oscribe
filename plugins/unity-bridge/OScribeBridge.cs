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

        // Curseur virtuel : flèche blanche à contour sombre et ombre douce, restant à la dernière position,
        // avec une onde cyan qui s'étend à chaque action. Textures générées au démarrage, dessin dans l'image du jeu uniquement.
        private Texture2D _arrow;
        private Texture2D _ring;

        private static readonly Vector2[] ArrowShape =
        {
            new Vector2(0f, 0f), new Vector2(0f, 21f), new Vector2(5.2f, 16.4f), new Vector2(8.6f, 24.6f),
            new Vector2(12.4f, 23f), new Vector2(9f, 15.2f), new Vector2(15.8f, 15.2f)
        };

        private static bool Inside(Vector2 p)
        {
            var inside = false;
            for (int i = 0, j = ArrowShape.Length - 1; i < ArrowShape.Length; j = i++)
            {
                var a = ArrowShape[i]; var b = ArrowShape[j];
                if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
            }
            return inside;
        }

        private void BuildTextures()
        {
            // Flèche 32x32 : masque suréchantillonné x4, contour = masque dilaté de 1,3 px
            const int size = 32, ss = 4, n = size * ss;
            var mask = new bool[n * n];
            for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                    mask[y * n + x] = Inside(new Vector2((x + 0.5f) / ss - 2f, (y + 0.5f) / ss - 2f));

            var pix = new Color[size * size];
            const int r = 5; // rayon de dilatation en sous-pixels
            for (var py = 0; py < size; py++)
            {
                for (var px = 0; px < size; px++)
                {
                    float fill = 0f, edge = 0f;
                    for (var sy = 0; sy < ss; sy++)
                    {
                        for (var sx = 0; sx < ss; sx++)
                        {
                            var x = px * ss + sx; var y = py * ss + sy;
                            if (mask[y * n + x]) { fill += 1f; edge += 1f; continue; }
                            var hit = false;
                            for (var dy = -r; dy <= r && !hit; dy += 2)
                                for (var dx = -r; dx <= r && !hit; dx += 2)
                                {
                                    var xx = x + dx; var yy = y + dy;
                                    if (xx >= 0 && yy >= 0 && xx < n && yy < n && dx * dx + dy * dy <= r * r && mask[yy * n + xx]) hit = true;
                                }
                            if (hit) edge += 1f;
                        }
                    }
                    var total = ss * ss;
                    var f = fill / total; var e = edge / total;
                    // blanc au centre, contour presque noir ; l'axe Y de la texture est inversé par rapport à l'écran
                    var c = Color.Lerp(new Color(0.06f, 0.08f, 0.12f, e), new Color(1f, 1f, 1f, 1f), f);
                    c.a = Mathf.Max(e, f);
                    pix[(size - 1 - py) * size + px] = c;
                }
            }
            _arrow = new Texture2D(size, size, TextureFormat.RGBA32, false) { filterMode = FilterMode.Bilinear };
            _arrow.SetPixels(pix); _arrow.Apply();

            // Anneau doux 64x64
            const int rs = 64;
            var rp = new Color[rs * rs];
            for (var y = 0; y < rs; y++)
                for (var x = 0; x < rs; x++)
                {
                    var d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(rs / 2f, rs / 2f)) / (rs / 2f);
                    var a = Mathf.Clamp01(1f - Mathf.Abs(d - 0.86f) / 0.09f);
                    rp[y * rs + x] = new Color(1f, 1f, 1f, a * a);
                }
            _ring = new Texture2D(rs, rs, TextureFormat.RGBA32, false) { filterMode = FilterMode.Bilinear };
            _ring.SetPixels(rp); _ring.Apply();
        }

        void OnGUI()
        {
            if (!_showCursor.Value) return;
            var age = Time.realtimeSinceStartup - InputInjector.LastActionTime;
            if (age < 0f) return;
            if (_arrow == null) BuildTextures();

            GUI.depth = -10000;
            var p = InputInjector.LastPoint;

            if (age < 0.7f)
            {
                var k = age / 0.7f;
                var radius = 10f + k * 38f;
                GUI.color = new Color(0.25f, 0.95f, 0.8f, 1f - k);
                GUI.DrawTexture(new Rect(p.x - radius, p.y - radius, radius * 2f, radius * 2f), _ring);
            }

            // Ombre portée puis flèche (la pointe est le point exact du clic)
            GUI.color = new Color(0f, 0f, 0f, 0.3f);
            GUI.DrawTexture(new Rect(p.x - 2f + 2f, p.y - 2f + 3f, 32f, 32f), _arrow);
            GUI.color = new Color(1f, 1f, 1f, age < 6f ? 1f : 0.85f);
            GUI.DrawTexture(new Rect(p.x - 2f, p.y - 2f, 32f, 32f), _arrow);
            GUI.color = Color.white;
        }

        void OnDestroy()
        {
            _server?.Stop();
        }
    }
}
