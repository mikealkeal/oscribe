/**
 * Session Recorder - Track automation sessions
 * Logs actions, screenshots, errors for playback/debugging
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig } from '../config/index.js';

export interface SessionAction {
  timestamp: string;
  action: string;
  params: Record<string, unknown>;
  result: 'success' | 'error';
  error?: string;
  screenshot?: string; // Path to screenshot
  duration_ms: number;
}

export interface Session {
  id: string;
  startTime: string;
  endTime?: string;
  initialRequest: string;
  actions: SessionAction[];
  screenshots: string[];
}

export class SessionRecorder {
  private session: Session;
  private sessionDir: string;
  private screenshotDir: string;

  constructor(initialRequest: string) {
    const sessionId = this.generateSessionId();
    const config = loadConfig();

    // Use configured session dir or default to ~/.osbot/sessions
    const baseDir = config.sessionDir
      ? config.sessionDir
      : join(homedir(), '.osbot', 'sessions');

    this.sessionDir = join(baseDir, sessionId);
    this.screenshotDir = join(this.sessionDir, 'screenshots');

    // Create directories
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }
    if (!existsSync(this.screenshotDir)) {
      mkdirSync(this.screenshotDir, { recursive: true });
    }

    this.session = {
      id: sessionId,
      startTime: new Date().toISOString(),
      initialRequest,
      actions: [],
      screenshots: [],
    };

    this.saveSession();
  }

  private generateSessionId(): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0] ?? 'unknown';
    const time = (now.toTimeString().split(' ')[0] ?? '00-00-00').replace(/:/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `${date}_${time}_${random}`;
  }

  /**
   * Record an action in the session
   */
  async recordAction(
    action: string,
    params: Record<string, unknown>,
    fn: () => Promise<unknown>
  ): Promise<unknown> {
    const start = Date.now();
    const timestamp = new Date().toISOString();
    let result: 'success' | 'error' = 'success';
    let errorMsg: string | undefined = undefined;
    let returnValue: unknown;

    try {
      returnValue = await fn();
    } catch (err) {
      result = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const duration_ms = Date.now() - start;

      const actionRecord: SessionAction = {
        timestamp,
        action,
        params,
        result,
        duration_ms,
      };

      if (errorMsg !== undefined) {
        actionRecord.error = errorMsg;
      }

      this.session.actions.push(actionRecord);
      this.saveSession();
    }

    return returnValue;
  }

  /**
   * Save a screenshot with the session
   */
  saveScreenshot(screenshotBase64: string, label?: string): string {
    const filename = `${this.session.actions.length}_${label || 'screenshot'}.png`;
    const filepath = join(this.screenshotDir, filename);

    // Save screenshot
    const buffer = Buffer.from(screenshotBase64, 'base64');
    writeFileSync(filepath, buffer);

    this.session.screenshots.push(filepath);

    // Update last action with screenshot reference
    if (this.session.actions.length > 0) {
      const lastAction = this.session.actions[this.session.actions.length - 1];
      if (lastAction) {
        lastAction.screenshot = filepath;
      }
    }

    this.saveSession();
    return filepath;
  }

  /**
   * End the session
   */
  endSession(): void {
    this.session.endTime = new Date().toISOString();
    this.saveSession();
    this.generateReport();
  }

  /**
   * Save session to JSON
   */
  private saveSession(): void {
    const sessionFile = join(this.sessionDir, 'session.json');
    writeFileSync(sessionFile, JSON.stringify(this.session, null, 2));
  }

  /**
   * Generate Markdown report
   */
  private generateReport(): void {
    const reportFile = join(this.sessionDir, 'REPORT.md');

    const duration = this.session.endTime
      ? new Date(this.session.endTime).getTime() - new Date(this.session.startTime).getTime()
      : 0;

    const successCount = this.session.actions.filter((a) => a.result === 'success').length;
    const errorCount = this.session.actions.filter((a) => a.result === 'error').length;

    let report = `# Session Report\n\n`;
    report += `**Session ID:** ${this.session.id}\n\n`;
    report += `**Start:** ${this.session.startTime}\n`;
    report += `**End:** ${this.session.endTime || 'In progress'}\n`;
    report += `**Duration:** ${(duration / 1000).toFixed(2)}s\n\n`;
    report += `---\n\n`;
    report += `## Initial Request\n\n`;
    report += `> ${this.session.initialRequest}\n\n`;
    report += `---\n\n`;
    report += `## Summary\n\n`;
    report += `- ✅ Success: ${successCount}\n`;
    report += `- ❌ Errors: ${errorCount}\n`;
    report += `- 📸 Screenshots: ${this.session.screenshots.length}\n\n`;
    report += `---\n\n`;
    report += `## Actions Timeline\n\n`;

    this.session.actions.forEach((action, index) => {
      const icon = action.result === 'success' ? '✅' : '❌';
      const time = new Date(action.timestamp).toLocaleTimeString();

      report += `### ${index + 1}. ${icon} ${action.action}\n\n`;
      report += `**Time:** ${time} | **Duration:** ${action.duration_ms}ms\n\n`;
      report += `**Parameters:**\n\`\`\`json\n${JSON.stringify(action.params, null, 2)}\n\`\`\`\n\n`;

      if (action.error) {
        report += `**Error:**\n\`\`\`\n${action.error}\n\`\`\`\n\n`;
      }

      if (action.screenshot) {
        const screenshotName = action.screenshot.split(/[/\\]/).pop();
        report += `**Screenshot:** [${screenshotName}](screenshots/${screenshotName})\n\n`;
        report += `![Screenshot](screenshots/${screenshotName})\n\n`;
      }

      report += `---\n\n`;
    });

    report += `## Session Files\n\n`;
    report += `- [session.json](session.json) - Raw session data\n`;
    report += `- [screenshots/](screenshots/) - All screenshots\n\n`;

    writeFileSync(reportFile, report);
  }

  /**
   * Get session directory path
   */
  getSessionDir(): string {
    return this.sessionDir;
  }
}
