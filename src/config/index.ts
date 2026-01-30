/**
 * Configuration management for OSbot
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

const CONFIG_DIR = join(homedir(), '.osbot');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export const ConfigSchema = z.object({
  apiKey: z.string().optional(),
  defaultScreen: z.number().default(0),
  dryRun: z.boolean().default(false),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  cursorSize: z.number().min(32).max(256).default(128),
  // Vision settings
  model: z.string().default('claude-sonnet-4-20250514'),
  maxTokensLocate: z.number().default(256),
  maxTokensDescribe: z.number().default(1024),
  // OAuth settings
  redirectPort: z.number().default(9876),
  // Session recording
  sessionDir: z.string().optional(),
  // Smart automation
  maxAttempts: z.number().min(1).max(10).default(3),
  verifyDelay: z.number().min(0).max(5000).default(800),
});

export type Config = z.infer<typeof ConfigSchema>;

const DEFAULT_CONFIG: Config = {
  defaultScreen: 0,
  dryRun: false,
  logLevel: 'info',
  cursorSize: 128,
  model: 'claude-sonnet-4-20250514',
  maxTokensLocate: 256,
  maxTokensDescribe: 1024,
  redirectPort: 9876,
  maxAttempts: 3,
  verifyDelay: 800,
};

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureConfigDir();

  if (!existsSync(CONFIG_FILE)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return ConfigSchema.parse(parsed);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: Partial<Config>): void {
  ensureConfigDir();

  const current = loadConfig();
  const merged = { ...current, ...config };
  const validated = ConfigSchema.parse(merged);

  writeFileSync(CONFIG_FILE, JSON.stringify(validated, null, 2));
}

export function getApiKey(): string | undefined {
  const config = loadConfig();
  return config.apiKey ?? process.env['ANTHROPIC_API_KEY'];
}
