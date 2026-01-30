/**
 * CLI commands registration
 */

import type { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { loginCommand } from './commands/login.js';
import { clickCommand } from './commands/click.js';
import { typeCommand } from './commands/type.js';
import { hotkeyCommand } from './commands/hotkey.js';
import { screenshotCommand } from './commands/screenshot.js';
import { windowsCommand } from './commands/windows.js';
import { focusCommand } from './commands/focus.js';
import { serveCommand } from './commands/serve.js';

export function registerCommands(program: Command): void {
  program.addCommand(initCommand());
  program.addCommand(loginCommand());
  program.addCommand(clickCommand());
  program.addCommand(typeCommand());
  program.addCommand(hotkeyCommand());
  program.addCommand(screenshotCommand());
  program.addCommand(windowsCommand());
  program.addCommand(focusCommand());
  program.addCommand(serveCommand());
}
