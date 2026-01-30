#!/usr/bin/env node

/**
 * OSbot CLI - Vision-based desktop automation
 */

import { Command } from 'commander';
import { registerCommands } from '../src/cli/index.js';

const program = new Command();

program
  .name('osbot')
  .description('Vision-based desktop automation engine')
  .version('0.1.0');

registerCommands(program);

program.parse();
