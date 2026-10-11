using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections.Concurrent;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

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

                        // Commande optionnelle : une trame reçue dans les 150 ms demande une action
                        // (click, drag, scroll, screenshot, cursor). Sans trame : instantané des éléments (comportement historique).
                        var command = TryReadCommand(client);
                        if (command != null)
                        {
                            OScribeBridge.PendingCommands.Enqueue(new BridgeCommand
                            {
                                Command = command,
                                Reply = json => SendJson(client, json)
                            });
                            continue;
                        }

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

        private static JObject TryReadCommand(TcpClient client)
        {
            try
            {
                var stream = client.GetStream();
                for (int i = 0; i < 15 && !stream.DataAvailable; i++) Thread.Sleep(10);
                if (!stream.DataAvailable) return null;

                var head = new byte[4];
                if (!ReadExactly(stream, head, 4)) return null;
                if (BitConverter.IsLittleEndian) Array.Reverse(head);
                var length = BitConverter.ToInt32(head, 0);
                if (length <= 0 || length > 65536) return null;

                var body = new byte[length];
                if (!ReadExactly(stream, body, length)) return null;
                return JObject.Parse(Encoding.UTF8.GetString(body));
            }
            catch (Exception ex)
            {
                Debug.LogError($"[OScribe] Command read error: {ex.Message}");
                return null;
            }
        }

        private static bool ReadExactly(NetworkStream stream, byte[] buffer, int count)
        {
            var read = 0;
            while (read < count)
            {
                var n = stream.Read(buffer, read, count - read);
                if (n <= 0) return false;
                read += n;
            }
            return true;
        }

        private static void SendJson(TcpClient client, string json)
        {
            try
            {
                var payload = Encoding.UTF8.GetBytes(json);
                var lengthBytes = BitConverter.GetBytes(payload.Length);
                if (BitConverter.IsLittleEndian) Array.Reverse(lengthBytes);

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
