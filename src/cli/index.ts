/**
 * CLI commands registration
 */

import type { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { loginCommand } from './commands/login.js';
import { clickCommand } from './commands/click.js';
import { locateCommand } from './commands/locate.js';
import { typeCommand } from './commands/type.js';
import { hotkeyCommand } from './commands/hotkey.js';
import { screenshotCommand } from './commands/screenshot.js';
import { windowsCommand } from './commands/windows.js';
import { focusCommand } from './commands/focus.js';
import { serveCommand } from './commands/serve.js';
import { tokensCommand } from './commands/tokens.js';
import { gifCommand } from './commands/gif.js';

export function registerCommands(program: Command): void {
  program.addCommand(initCommand());
  program.addCommand(loginCommand());
  program.addCommand(clickCommand());
  program.addCommand(locateCommand());
  program.addCommand(typeCommand());
  program.addCommand(hotkeyCommand());
  program.addCommand(screenshotCommand());
  program.addCommand(windowsCommand());
  program.addCommand(focusCommand());
  program.addCommand(serveCommand());
  program.addCommand(tokensCommand());
  program.addCommand(gifCommand());
}
