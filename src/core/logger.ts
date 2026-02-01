/**
 * Action logging module - Wide events pattern
 * One rich JSON event per action for audit and debugging
 */

import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig } from '../config/index.js';

// Wide event interface - all context for one action
export interface ActionEvent {
  timestamp: string;
  action: 'click' | 'move' | 'type' | 'hotkey' | 'scroll';
  params: Record<string, unknown>;
  duration_ms: number;
  success: boolean;
  error?: { message: string; code: string | undefined };
  platform: typeof process.platform;
}

const LOGS_DIR = join(homedir(), '.osbot', 'logs');

function ensureLogsDir(): void {
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function getLogPath(): string {
  const date = new Date().toISOString().split('T')[0];
  return join(LOGS_DIR, `actions-${date}.jsonl`);  // JSONL = 1 JSON per line
}

export function logAction(event: ActionEvent): void {
  const config = loadConfig();

  // Only log if logLevel is debug or info
  if (config.logLevel === 'warn' || config.logLevel === 'error') {
    return;
  }

  ensureLogsDir();
  appendFileSync(getLogPath(), JSON.stringify(event) + '\n');
}

/**
 * Wide event wrapper - guarantees log emission in finally block
 * Following logging-best-practices skill pattern
 */
export async function withLogging<T>(
  action: ActionEvent['action'],
  params: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const event: ActionEvent = {
    timestamp: new Date().toISOString(),
    action,
    params,
    duration_ms: 0,
    success: false,
    platform: process.platform,
  };
  const start = Date.now();

  try {
    const result = await fn();
    event.success = true;
    return result;
  } catch (err) {
    event.error = {
      message: err instanceof Error ? err.message : String(err),
      code: (err as { code?: string }).code,
    };
    throw err;
  } finally {
    event.duration_ms = Date.now() - start;
    logAction(event);
  }
}

/**
 * Synchronous version for non-async actions
 */
export function withLoggingSync<T>(
  action: ActionEvent['action'],
  params: Record<string, unknown>,
  fn: () => T
): T {
  const event: ActionEvent = {
    timestamp: new Date().toISOString(),
    action,
    params,
    duration_ms: 0,
    success: false,
    platform: process.platform,
  };
  const start = Date.now();

  try {
    const result = fn();
    event.success = true;
    return result;
  } catch (err) {
    event.error = {
      message: err instanceof Error ? err.message : String(err),
      code: (err as { code?: string }).code,
    };
    throw err;
  } finally {
    event.duration_ms = Date.now() - start;
    logAction(event);
  }
}
