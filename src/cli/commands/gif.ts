/**
 * gif command - Create GIF from session screenshots
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../../config/index.js';

const execAsync = promisify(exec);

interface GifOptions {
  list?: boolean;
  delete?: string;
  from?: string;
  to?: string;
  delay?: string;
  output?: string;
  scale?: string;
}

/**
 * Get sessions directory
 */
function getSessionsDir(): string {
  const config = loadConfig();
  return config.sessionDir ?? join(homedir(), '.oscribe', 'sessions');
}

/**
 * List all sessions
 */
function listSessions(): { id: string; date: Date; screenshotCount: number }[] {
  const sessionsDir = getSessionsDir();
  if (!existsSync(sessionsDir)) {
    return [];
  }

  const sessions = readdirSync(sessionsDir)
    .filter((dir) => {
      const sessionPath = join(sessionsDir, dir);
      return statSync(sessionPath).isDirectory() && existsSync(join(sessionPath, 'session.json'));
    })
    .map((id) => {
      const screenshotsDir = join(sessionsDir, id, 'screenshots');
      const screenshotCount = existsSync(screenshotsDir)
        ? readdirSync(screenshotsDir).filter((f) => f.endsWith('.png')).length
        : 0;

      // Parse date from session ID (format: YYYY-MM-DD_HH-MM-SS_random)
      const dateMatch = id.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/);
      const datePart = dateMatch?.[1] ?? '1970-01-01';
      const timePart = dateMatch?.[2]?.replace(/-/g, ':') ?? '00:00:00';
      const date = new Date(`${datePart}T${timePart}`);

      return { id, date, screenshotCount };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime()); // Most recent first

  return sessions;
}

/**
 * Get screenshots from a session
 */
function getScreenshots(sessionId: string): string[] {
  const sessionsDir = getSessionsDir();
  const screenshotsDir = join(sessionsDir, sessionId, 'screenshots');

  if (!existsSync(screenshotsDir)) {
    return [];
  }

  return readdirSync(screenshotsDir)
    .filter((f) => f.endsWith('.png'))
    .sort((a, b) => {
      // Sort by index (format: 0_label.png, 1_label.png, ...)
      const indexA = parseInt(a.split('_')[0] ?? '0', 10);
      const indexB = parseInt(b.split('_')[0] ?? '0', 10);
      return indexA - indexB;
    })
    .map((f) => join(screenshotsDir, f));
}

/**
 * Check if ffmpeg is available
 */
async function checkFfmpeg(): Promise<boolean> {
  try {
    await execAsync('ffmpeg -version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Create GIF using ffmpeg
 */
async function createGif(
  screenshots: string[],
  outputPath: string,
  delay: number,
  scale?: number
): Promise<void> {
  // Create a temporary file list for ffmpeg
  const frameRate = 1000 / delay; // Convert delay (ms) to framerate

  // Build ffmpeg filter
  let filter = '';
  if (scale) {
    filter = `-vf "scale=${scale}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer"`;
  } else {
    filter = `-vf "split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer"`;
  }

  // Create concat file content
  const concatContent = screenshots.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n');
  const concatFile = join(getSessionsDir(), '_temp_concat.txt');

  // Write concat file
  const { writeFileSync } = await import('node:fs');
  writeFileSync(concatFile, concatContent);

  try {
    // Run ffmpeg
    const cmd = `ffmpeg -y -f concat -safe 0 -r ${frameRate} -i "${concatFile}" ${filter} -loop 0 "${outputPath}"`;
    await execAsync(cmd);
  } finally {
    // Clean up temp file
    if (existsSync(concatFile)) {
      unlinkSync(concatFile);
    }
  }
}

export function gifCommand(): Command {
  return new Command('gif')
    .description('Create GIF from session screenshots')
    .argument('[session-id]', 'Session ID (default: latest session)')
    .option('--list', 'List available sessions')
    .option('--delete <indices>', 'Delete screenshots by index (e.g., "1,2,5")')
    .option('--from <index>', 'Start from screenshot index')
    .option('--to <index>', 'End at screenshot index')
    .option('--delay <ms>', 'Delay between frames in ms', '500')
    .option('-o, --output <file>', 'Output file path')
    .option('--scale <width>', 'Scale to width (e.g., "800")')
    .action(async (sessionId: string | undefined, options: GifOptions) => {
      try {
        // List sessions
        if (options.list) {
          const sessions = listSessions();
          if (sessions.length === 0) {
            console.log(chalk.yellow('No sessions found'));
            return;
          }

          console.log(chalk.cyan('Available sessions:\n'));
          sessions.forEach((s, i) => {
            const dateStr = s.date.toLocaleString();
            const isLatest = i === 0 ? chalk.green(' (latest)') : '';
            console.log(`  ${chalk.bold(s.id)}${isLatest}`);
            console.log(`    Date: ${dateStr}`);
            console.log(`    Screenshots: ${s.screenshotCount}`);
            console.log();
          });
          return;
        }

        // Get session ID (default to latest)
        const sessions = listSessions();
        if (sessions.length === 0) {
          console.error(chalk.red('No sessions found'));
          process.exit(1);
        }

        const targetSessionId = sessionId ?? sessions[0]?.id;
        if (!targetSessionId) {
          console.error(chalk.red('No session found'));
          process.exit(1);
        }

        // Verify session exists
        const sessionsDir = getSessionsDir();
        const sessionDir = join(sessionsDir, targetSessionId);
        if (!existsSync(sessionDir)) {
          console.error(chalk.red(`Session not found: ${targetSessionId}`));
          process.exit(1);
        }

        // Get screenshots
        let screenshots = getScreenshots(targetSessionId);
        if (screenshots.length === 0) {
          console.error(chalk.red('No screenshots in this session'));
          process.exit(1);
        }

        console.log(chalk.cyan(`Session: ${targetSessionId}`));
        console.log(chalk.cyan(`Found ${screenshots.length} screenshots`));

        // Handle delete option
        if (options.delete) {
          const indicesToDelete = options.delete
            .split(',')
            .map((i) => parseInt(i.trim(), 10))
            .filter((i) => !isNaN(i));

          const toDelete = screenshots.filter((_, i) => indicesToDelete.includes(i));

          if (toDelete.length === 0) {
            console.log(chalk.yellow('No screenshots matched the indices to delete'));
          } else {
            console.log(chalk.yellow(`Deleting ${toDelete.length} screenshots...`));
            toDelete.forEach((path) => {
              unlinkSync(path);
              console.log(chalk.gray(`  Deleted: ${path.split(/[/\\]/).pop()}`));
            });
            // Refresh screenshots list
            screenshots = getScreenshots(targetSessionId);
            console.log(chalk.green(`${screenshots.length} screenshots remaining`));
          }

          if (screenshots.length === 0) {
            console.log(chalk.yellow('No screenshots left to create GIF'));
            return;
          }
        }

        // Apply --from and --to filters
        const fromIndex = options.from ? parseInt(options.from, 10) : 0;
        const toIndex = options.to ? parseInt(options.to, 10) : screenshots.length - 1;

        screenshots = screenshots.slice(fromIndex, toIndex + 1);

        if (screenshots.length === 0) {
          console.error(chalk.red('No screenshots in the specified range'));
          process.exit(1);
        }

        console.log(chalk.cyan(`Using ${screenshots.length} screenshots (${fromIndex} to ${toIndex})`));

        // Check ffmpeg
        const hasFfmpeg = await checkFfmpeg();
        if (!hasFfmpeg) {
          console.error(chalk.red('ffmpeg is required but not found'));
          console.log(chalk.yellow('\nInstall ffmpeg:'));
          console.log(chalk.gray('  Windows: winget install ffmpeg'));
          console.log(chalk.gray('  macOS:   brew install ffmpeg'));
          console.log(chalk.gray('  Linux:   apt install ffmpeg'));
          process.exit(1);
        }

        // Create GIF
        const delay = parseInt(options.delay ?? '500', 10);
        const scale = options.scale ? parseInt(options.scale, 10) : undefined;
        const outputPath = options.output ?? join(sessionDir, 'session.gif');

        const spinner = ora('Creating GIF...').start();

        try {
          await createGif(screenshots, outputPath, delay, scale);
          spinner.succeed(chalk.green(`GIF created: ${outputPath}`));

          // Show file size
          const stats = statSync(outputPath);
          const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
          console.log(chalk.gray(`  Size: ${sizeMB} MB`));
        } catch (error) {
          spinner.fail(chalk.red('Failed to create GIF'));
          throw error;
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
