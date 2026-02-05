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
