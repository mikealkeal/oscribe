using System;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using UnityEngine;

namespace OScribe.UnityBridge
{
    /// <summary>
    /// Lite TCP Server - uses Unity's JsonUtility instead of Newtonsoft.Json
    /// Length-prefix framing: [4 bytes big-endian length] + [JSON payload]
    /// </summary>
    public class TcpServer
    {
        private TcpListener _listener;
        private Thread _thread;
        private volatile bool _running;
        private readonly int _port;

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
                    Debug.LogError("[OScribe] TCP error: " + ex.Message);
                }
            }
        }

        private void SendResponse(TcpClient client, BridgeResponse response)
        {
            try
            {
                // Manual JSON serialization (no Newtonsoft dependency)
                var json = SerializeResponse(response);
                var payload = Encoding.UTF8.GetBytes(json);

                // Length-prefix framing: 4 bytes (big-endian) + payload
                var lengthBytes = BitConverter.GetBytes(payload.Length);
                if (BitConverter.IsLittleEndian)
                    Array.Reverse(lengthBytes);

                var stream = client.GetStream();
                stream.Write(lengthBytes, 0, 4);
                stream.Write(payload, 0, payload.Length);
                stream.Flush();
            }
            catch (Exception ex)
            {
                Debug.LogError("[OScribe] Send error: " + ex.Message);
            }
            finally
            {
                client?.Close();
            }
        }

        /// <summary>
        /// Manual JSON serialization - avoids Newtonsoft.Json dependency
        /// </summary>
        private string SerializeResponse(BridgeResponse response)
        {
            var inv = CultureInfo.InvariantCulture;
            var sb = new StringBuilder();
            sb.Append("{");
            sb.AppendFormat("\"version\":\"{0}\",", Escape(response.Version));
            sb.Append("\"gameInfo\":{");
            sb.AppendFormat("\"name\":\"{0}\",", Escape(response.GameInfo.Name));
            sb.AppendFormat("\"scene\":\"{0}\",", Escape(response.GameInfo.Scene));
            sb.Append("\"resolution\":{\"width\":");
            sb.Append(response.GameInfo.Resolution.Width);
            sb.Append(",\"height\":");
            sb.Append(response.GameInfo.Resolution.Height);
            sb.Append("}");
            sb.Append("},");
            sb.Append("\"elements\":[");
            for (int i = 0; i < response.Elements.Count; i++)
            {
                if (i > 0) sb.Append(",");
                var el = response.Elements[i];
                sb.Append("{");
                sb.AppendFormat("\"type\":\"{0}\",", Escape(el.Type));
                sb.AppendFormat("\"name\":\"{0}\",", Escape(el.Name));
                sb.AppendFormat("\"path\":\"{0}\",", Escape(el.Path));
                sb.Append("\"screenRect\":{\"x\":");
                sb.Append(el.ScreenRect.X.ToString("F1", inv));
                sb.Append(",\"y\":");
                sb.Append(el.ScreenRect.Y.ToString("F1", inv));
                sb.Append(",\"width\":");
                sb.Append(el.ScreenRect.Width.ToString("F1", inv));
                sb.Append(",\"height\":");
                sb.Append(el.ScreenRect.Height.ToString("F1", inv));
                sb.Append("},");
                sb.AppendFormat("\"isInteractable\":{0},", el.IsInteractable ? "true" : "false");
                sb.AppendFormat("\"isVisible\":{0},", el.IsVisible ? "true" : "false");
                sb.AppendFormat("\"value\":{0},", el.Value != null ? "\"" + Escape(el.Value) + "\"" : "null");
                sb.AppendFormat("\"automationId\":{0},", el.AutomationId != null ? "\"" + Escape(el.AutomationId) + "\"" : "null");
                sb.AppendFormat("\"is3D\":{0}", el.Is3D ? "true" : "false");
                sb.Append("}");
            }
            sb.Append("],");
            sb.AppendFormat("\"timestamp\":\"{0}\"", Escape(response.Timestamp));
            sb.Append("}");
            return sb.ToString();
        }

        private string Escape(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
        }
    }
}
