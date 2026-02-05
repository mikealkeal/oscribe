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
