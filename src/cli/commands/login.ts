/**
 * login command - OAuth authentication with Claude Max/Pro
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { login as oauthLogin, isLoggedIn, logout } from '../../core/auth.js';

export function loginCommand(): Command {
  return new Command('login')
    .description('Authenticate with your Claude account (Max/Pro)')
    .option('--logout', 'Log out and remove stored credentials')
    .option('--status', 'Check login status')
    .action(async (options: { logout?: boolean; status?: boolean }) => {
      // Check status
      if (options.status) {
        if (isLoggedIn()) {
          console.log(chalk.green('✓ Logged in'));
        } else {
          console.log(chalk.yellow('Not logged in. Run "osbot login" to authenticate.'));
        }
        return;
      }

      // Logout
      if (options.logout) {
        logout();
        console.log(chalk.green('Logged out successfully.'));
        return;
      }

      // Check if already logged in
      if (isLoggedIn()) {
        console.log(chalk.yellow('Already logged in. Use --logout to log out first.'));
        return;
      }

      // OAuth login
      const spinner = ora('Starting authentication...').start();

      try {
        spinner.text = 'Waiting for browser authentication...';
        await oauthLogin();

        spinner.succeed(chalk.green('Authentication successful!'));
        console.log();
        console.log('You can now use OSbot with your Claude Max/Pro subscription.');
        console.log();
        console.log('Try:');
        console.log(`  ${chalk.cyan('osbot screenshot --describe')}`);
        console.log(`  ${chalk.cyan('osbot click "the Start button"')}`);
      } catch (error) {
        spinner.fail(chalk.red('Authentication failed'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
