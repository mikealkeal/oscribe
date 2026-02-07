#!/usr/bin/env tsx
/**
 * Cross-platform script to copy config files to dist
 * Works on Windows, macOS, and Linux
 */
import { cpSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const src = join(projectRoot, 'src', 'config');
const dst = join(projectRoot, 'dist', 'src', 'config');

// Create destination directory if it doesn't exist
mkdirSync(dst, { recursive: true });

// Copy all JSON files
if (existsSync(src)) {
  cpSync(src, dst, {
    recursive: true,
    filter: (source: string) => {
      // Include directories and .json files
      return !source.includes('.') || source.endsWith('.json');
    }
  });
  console.log('✓ Config files copied to dist/src/config/');
} else {
  console.log('⚠ No src/config directory found, skipping copy');
}
