#!/usr/bin/env node

/**
 * OScribe CLI - Vision-based desktop automation
 */

import 'dotenv/config';
import { Command } from 'commander';
import { registerCommands } from '../src/cli/index.js';

const program = new Command();

program.name('oscribe').description('Vision-based desktop automation engine').version('0.1.0');

registerCommands(program);

program.parse();
