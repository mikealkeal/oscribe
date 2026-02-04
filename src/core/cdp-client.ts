/**
 * CDP Client Module
 *
 * Manages connections to Chrome DevTools Protocol with retry logic,
 * circuit breaker pattern, and proper error handling.
 *
 * Cross-platform support: Windows, macOS, Linux
 */

import CDP from 'chrome-remote-interface';

// CDP Connection configuration
export interface CDPConnectionConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  target?: string; // Tab ID
}

// CDP Connection type (from chrome-remote-interface)
export type CDPConnection = CDP.Client;

// Custom error classes
export class CDPConnectionError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'CDPConnectionError';
  }
}

export class CDPNotEnabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CDPNotEnabledError';
  }
}

export class CDPTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CDPTimeoutError';
  }
}

// Circuit breaker state
let circuitBreakerFailures = 0;
let circuitBreakerLastFailure: number | null = null;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_TIME = 30000; // 30 seconds

// Simple logger
const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => {
    if (process.env['DEBUG']) console.log(`[cdp-client] ${msg}`, data ?? '');
  },
  info: (msg: string, data?: Record<string, unknown>) => {
    console.log(`[cdp-client] ${msg}`, data ?? '');
  },
  warn: (msg: string, data?: Record<string, unknown>) => {
    console.warn(`[cdp-client] ${msg}`, data ?? '');
  },
  error: (msg: string, data?: Record<string, unknown>) => {
    console.error(`[cdp-client] ${msg}`, data ?? '');
  },
};

/**
 * Connect to Chrome DevTools Protocol
 *
 * @param config - Connection configuration
 * @returns CDP client instance
 * @throws CDPConnectionError if connection fails
 */
export async function connectCDP(
  config: CDPConnectionConfig = {}
): Promise<CDPConnection> {
  const { host = 'localhost', port = 9222, secure = false, target } = config;

  // Check circuit breaker
  if (isCircuitBreakerOpen()) {
    throw new CDPConnectionError(
      'Circuit breaker open - too many consecutive failures',
      'CIRCUIT_BREAKER_OPEN'
    );
  }

  // Wide event pattern - single log for entire operation
  const event = {
    action: 'cdp_connect',
    host,
    port,
    timestamp: new Date().toISOString(),
    duration_ms: 0,
    success: false,
  };

  const startTime = Date.now();

  try {
    logger.debug('Connecting to CDP', { host, port, target });

    // Retry with exponential backoff: 500ms → 1000ms → 2000ms
    const connection = await retryWithBackoff(
      () =>
        CDP({
          host,
          port,
          secure,
          target,
        }),
      3,
      500
    );

    event.duration_ms = Date.now() - startTime;
    event.success = true;

    // Reset circuit breaker on success
    circuitBreakerFailures = 0;
    circuitBreakerLastFailure = null;

    logger.info('CDP connection established', event);

    return connection;
  } catch (error) {
    event.duration_ms = Date.now() - startTime;

    // Increment circuit breaker
    circuitBreakerFailures++;
    circuitBreakerLastFailure = Date.now();

    logger.error('CDP connection failed', { ...event, error: String(error) });

    if ((error as Error).message.includes('ECONNREFUSED')) {
      throw new CDPNotEnabledError(
        'Remote debugging not enabled - launch browser with --remote-debugging-port=9222'
      );
    }

    if ((error as Error).message.includes('timeout')) {
      throw new CDPTimeoutError('CDP connection timeout after 5 seconds');
    }

    throw new CDPConnectionError(
      `Failed to connect to CDP: ${(error as Error).message}`,
      'CONNECTION_FAILED'
    );
  }
}

/**
 * Get the active tab target
 *
 * @param connection - Optional CDP connection (if not provided, creates a new one)
 * @returns Active tab target or null if no tab is active
 */
export async function getActiveTab(
  _connection?: CDPConnection
): Promise<CDP.Target | null> {
  try {
    const targets = (await CDP.List()) as CDP.Target[];

    // Find the first "page" type target (browser tab)
    // Accept chrome://newtab/ for fresh browser starts, but exclude other chrome:// URLs
    const activeTab = targets.find(
      (target) => target.type === 'page' && (
        !target.url.startsWith('chrome://') ||
        target.url.startsWith('chrome://newtab/')
      )
    );

    if (!activeTab) {
      logger.warn('No active tab found');
      return null;
    }

    logger.debug('Active tab found', {
      title: activeTab.title,
      url: activeTab.url,
      id: activeTab.id,
    });

    return activeTab;
  } catch (error) {
    logger.error('Failed to get active tab', { error: String(error) });
    return null;
  }
}

/**
 * Disconnect from CDP and cleanup
 *
 * @param connection - CDP connection to close
 */
export async function disconnectCDP(
  connection: CDPConnection
): Promise<void> {
  try {
    await connection.close();
    logger.debug('CDP connection closed');
  } catch (error) {
    logger.error('Failed to close CDP connection', { error: String(error) });
  }
}

/**
 * Retry a function with exponential backoff
 *
 * @param fn - Function to retry
 * @param maxAttempts - Maximum number of attempts (default: 3)
 * @param initialDelay - Initial delay in ms (default: 500)
 * @returns Result of the function
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  initialDelay = 500
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxAttempts - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        logger.debug(`Retry attempt ${attempt + 1}/${maxAttempts} after ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Check if circuit breaker is open (too many failures)
 */
function isCircuitBreakerOpen(): boolean {
  if (circuitBreakerFailures < CIRCUIT_BREAKER_THRESHOLD) {
    return false;
  }

  // Check if reset time has passed
  if (
    circuitBreakerLastFailure &&
    Date.now() - circuitBreakerLastFailure > CIRCUIT_BREAKER_RESET_TIME
  ) {
    // Reset circuit breaker
    circuitBreakerFailures = 0;
    circuitBreakerLastFailure = null;
    logger.info('Circuit breaker reset');
    return false;
  }

  logger.warn('Circuit breaker open', {
    failures: circuitBreakerFailures,
    lastFailure: circuitBreakerLastFailure,
  });

  return true;
}
