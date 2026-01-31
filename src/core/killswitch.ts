/**
 * Kill switch module - Auto-stop on user activity
 * Detects when user moves the mouse and stops automation
 */

import { loadConfig } from '../config/index.js';

// Import getMousePosition from input.ts would create circular dependency
// So we import robotjs directly here
import robot from 'robotjs';

/**
 * Custom error for user interrupt
 * Following error-handling-patterns skill
 */
export class UserInterruptError extends Error {
  constructor(
    public readonly distance: number,
    public readonly threshold: number
  ) {
    super(`Kill switch triggered: mouse moved ${distance}px (threshold: ${threshold}px). Automation stopped.`);
    this.name = 'UserInterruptError';
    // Preserve stack trace (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// Module state
let lastPosition: { x: number; y: number } | null = null;
let lastActionTime = 0;

/**
 * Reset kill switch state
 * Call when starting a new automation session
 */
export function resetKillSwitch(): void {
  lastPosition = null;
  lastActionTime = 0;
}

/**
 * Calculate euclidean distance between two points
 */
function calculateDistance(
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): number {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

/**
 * Check for user activity BEFORE each action
 * Throws UserInterruptError if user moved the mouse
 */
export function checkUserActivity(): void {
  const config = loadConfig();
  const { killSwitch } = config;

  // Skip if kill switch is disabled
  if (!killSwitch.enabled) {
    return;
  }

  const current = robot.getMousePos();
  const now = Date.now();

  // First action: just record position
  if (lastPosition === null) {
    lastPosition = current;
    lastActionTime = now;
    return;
  }

  // Within cooldown period after our last action: skip check
  // This avoids false positives from our own mouse movements
  if (now - lastActionTime < killSwitch.cooldownMs) {
    lastPosition = current;
    lastActionTime = now;
    return;
  }

  // Check if user moved the mouse
  const distance = calculateDistance(lastPosition, current);

  if (distance > killSwitch.movementThreshold) {
    // User has taken control - STOP
    throw new UserInterruptError(
      Math.round(distance),
      killSwitch.movementThreshold
    );
  }

  // Update for next check
  lastPosition = current;
  lastActionTime = now;
}

/**
 * Record that an action was completed
 * Call AFTER each action to update the position tracking
 */
export function recordActionDone(): void {
  const config = loadConfig();

  if (!config.killSwitch.enabled) {
    return;
  }

  lastPosition = robot.getMousePos();
  lastActionTime = Date.now();
}
