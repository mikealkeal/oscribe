/**
 * Token usage tracker - Monitor API costs
 * Tracks input/output tokens per call and session totals
 * Following logging-best-practices skill pattern
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Model pricing (USD per 1M tokens) - Updated 2025
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Claude 4 / Sonnet 4
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  // Claude 3.5
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  // Claude 3
  'claude-3-opus-20240229': { input: 15, output: 75 },
  'claude-3-sonnet-20240229': { input: 3, output: 15 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  // Default fallback
  'default': { input: 3, output: 15 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface TokenEvent {
  timestamp: string;
  sessionId: string;
  action: 'locate' | 'describe' | 'verify' | 'other';
  model: string;
  usage: TokenUsage;
  estimatedCostUsd: number;
}

export interface SessionStats {
  sessionId: string;
  startTime: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCostUsd: number;
  callCount: number;
  byAction: Record<string, { calls: number; tokens: number; cost: number }>;
}

// Session state
let currentSessionId: string = generateSessionId();
let sessionStartTime: string = new Date().toISOString();
let sessionStats: SessionStats = createEmptyStats();

const LOGS_DIR = join(homedir(), '.osbot', 'logs');

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyStats(): SessionStats {
  return {
    sessionId: currentSessionId,
    startTime: sessionStartTime,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalCostUsd: 0,
    callCount: 0,
    byAction: {},
  };
}

function ensureLogsDir(): void {
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function getTokenLogPath(): string {
  const date = new Date().toISOString().split('T')[0];
  return join(LOGS_DIR, `tokens-${date}.jsonl`);
}

// Default pricing fallback
const DEFAULT_PRICING = { input: 3, output: 15 };

/**
 * Calculate estimated cost for token usage
 */
function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;

  // Cache tokens are charged at reduced rates (typically 10% for reads, 25% for creation)
  const cacheCreationCost = ((usage.cacheCreationInputTokens ?? 0) / 1_000_000) * pricing.input * 1.25;
  const cacheReadCost = ((usage.cacheReadInputTokens ?? 0) / 1_000_000) * pricing.input * 0.1;

  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}

/**
 * Record token usage for an API call
 */
export function recordTokenUsage(
  action: TokenEvent['action'],
  model: string,
  usage: TokenUsage
): TokenEvent {
  const cost = calculateCost(model, usage);

  const event: TokenEvent = {
    timestamp: new Date().toISOString(),
    sessionId: currentSessionId,
    action,
    model,
    usage,
    estimatedCostUsd: cost,
  };

  // Update session stats
  sessionStats.totalInputTokens += usage.inputTokens;
  sessionStats.totalOutputTokens += usage.outputTokens;
  sessionStats.totalCacheCreationTokens += usage.cacheCreationInputTokens ?? 0;
  sessionStats.totalCacheReadTokens += usage.cacheReadInputTokens ?? 0;
  sessionStats.totalCostUsd += cost;
  sessionStats.callCount += 1;

  // Track by action type
  if (!sessionStats.byAction[action]) {
    sessionStats.byAction[action] = { calls: 0, tokens: 0, cost: 0 };
  }
  sessionStats.byAction[action].calls += 1;
  sessionStats.byAction[action].tokens += usage.inputTokens + usage.outputTokens;
  sessionStats.byAction[action].cost += cost;

  // Log to file
  ensureLogsDir();
  appendFileSync(getTokenLogPath(), JSON.stringify(event) + '\n');

  return event;
}

/**
 * Get current session statistics
 */
export function getSessionStats(): SessionStats {
  return { ...sessionStats };
}

/**
 * Reset session (start fresh tracking)
 */
export function resetSession(): void {
  currentSessionId = generateSessionId();
  sessionStartTime = new Date().toISOString();
  sessionStats = createEmptyStats();
}

/**
 * Format stats for display
 */
export function formatStats(stats: SessionStats): string {
  const lines: string[] = [
    `Session: ${stats.sessionId}`,
    `Started: ${stats.startTime}`,
    ``,
    `Total Tokens:`,
    `  Input:  ${stats.totalInputTokens.toLocaleString()}`,
    `  Output: ${stats.totalOutputTokens.toLocaleString()}`,
    `  Total:  ${(stats.totalInputTokens + stats.totalOutputTokens).toLocaleString()}`,
    ``,
    `Estimated Cost: $${stats.totalCostUsd.toFixed(4)} USD`,
    `API Calls: ${stats.callCount}`,
    ``,
    `By Action:`,
  ];

  for (const [action, data] of Object.entries(stats.byAction)) {
    lines.push(`  ${action}: ${data.calls} calls, ${data.tokens.toLocaleString()} tokens, $${data.cost.toFixed(4)}`);
  }

  return lines.join('\n');
}

/**
 * Get daily totals from log file
 */
export function getDailyStats(date?: string): SessionStats | null {
  const targetDate = date ?? new Date().toISOString().split('T')[0] ?? '';
  const logPath = join(LOGS_DIR, `tokens-${targetDate}.jsonl`);

  if (!existsSync(logPath)) {
    return null;
  }

  const content = readFileSync(logPath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  const dailyStats: SessionStats = {
    sessionId: `daily-${targetDate}`,
    startTime: targetDate,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalCostUsd: 0,
    callCount: 0,
    byAction: {},
  };

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as TokenEvent;
      dailyStats.totalInputTokens += event.usage.inputTokens;
      dailyStats.totalOutputTokens += event.usage.outputTokens;
      dailyStats.totalCacheCreationTokens += event.usage.cacheCreationInputTokens ?? 0;
      dailyStats.totalCacheReadTokens += event.usage.cacheReadInputTokens ?? 0;
      dailyStats.totalCostUsd += event.estimatedCostUsd;
      dailyStats.callCount += 1;

      // Track by action type
      const actionStats = dailyStats.byAction[event.action] ?? { calls: 0, tokens: 0, cost: 0 };
      actionStats.calls += 1;
      actionStats.tokens += event.usage.inputTokens + event.usage.outputTokens;
      actionStats.cost += event.estimatedCostUsd;
      dailyStats.byAction[event.action] = actionStats;
    } catch {
      // Skip malformed lines
    }
  }

  return dailyStats;
}
