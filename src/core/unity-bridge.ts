/**
 * Unity Bridge Client
 *
 * TCP client for communicating with Unity games running the OScribe Bridge plugin.
 * Protocol: Length-prefix framing (4 bytes big-endian length + JSON payload)
 */

import { createConnection, Socket } from 'node:net';
import { z } from 'zod';
import type { UIElement } from './uiautomation.js';

// ============================================================================
// Types
// ============================================================================

const UnityBridgeConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
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
    const socket = createConnection({ host: '127.0.0.1', port });
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
        const elements: UIElement[] = response.elements.map(el => {
          const element: UIElement = {
            type: el.is3D ? `${el.type}` : el.type,
            name: el.name,
            description: el.path,
            x: Math.round(el.screenRect.x),
            y: Math.round(el.screenRect.y),
            width: Math.round(el.screenRect.width),
            height: Math.round(el.screenRect.height),
            isEnabled: el.isInteractable && el.isVisible,
          };
          if (el.automationId) element.automationId = el.automationId;
          if (el.value) element.value = el.value;
          return element;
        });

        resolve({ elements, gameInfo: response.gameInfo });
      } catch (err) {
        recordFailure();
        reject(err);
      } finally {
        socket.destroy();
      }
    });

    socket.once('error', (err: Error & { code?: string }) => {
      recordFailure();
      if (err.code === 'ECONNREFUSED') {
        reject(new UnityBridgeNotRunningError(cfg.port));
      } else {
        reject(err);
      }
    });
  });
}
