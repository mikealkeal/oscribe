/**
 * macOS Accessibility Tree extraction via Swift script
 *
 * Provides access to the macOS Accessibility API to extract
 * the complete UI element tree with positions, roles, and values.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Accessibility element structure (matches Swift output)
 */
export interface AccessibilityElement {
  role: string;
  title?: string | null;
  value?: string | null;
  description?: string | null;
  absolute_position?: string | null; // Format: "x;y"
  size?: string | null; // Format: "width;height"
  enabled?: boolean | null;
  path: string;
  children: AccessibilityElement[];
}

/**
 * Element position parsed from absolute_position string
 */
export interface ElementPosition {
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * Extract the complete accessibility tree for the frontmost window
 *
 * @returns Parsed accessibility tree
 * @throws Error if script execution fails or permissions denied
 */
export async function getAccessibilityTree(): Promise<AccessibilityElement> {
  // When running from dist/src/core/, we need to go up 3 levels to project root
  const scriptPath = path.join(__dirname, '../../../scripts/macos/accessibility_tree.swift');

  try {
    const { stdout, stderr } = await execFileAsync('swift', [scriptPath], {
      timeout: 10000,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large trees
    });

    if (stderr && stderr.includes('Error:')) {
      throw new Error(`Accessibility extraction failed: ${stderr}`);
    }

    const tree = JSON.parse(stdout) as AccessibilityElement;
    return tree;
  } catch (error) {
    if (error instanceof Error) {
      // Check for common errors
      if (error.message.includes('Accessibility permissions not granted')) {
        throw new Error(
          'Accessibility permissions required. Please grant accessibility permissions to this app in System Settings > Privacy & Security > Accessibility.'
        );
      }
      throw new Error(`Failed to extract accessibility tree: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Parse position string ("x;y") to coordinates
 */
function parsePosition(positionStr: string): { x: number; y: number } {
  const parts = positionStr.split(';');
  return {
    x: Number(parts[0]),
    y: Number(parts[1]),
  };
}

/**
 * Parse size string ("width;height") to dimensions
 */
function parseSize(sizeStr: string): { width: number; height: number } {
  const parts = sizeStr.split(';');
  return {
    width: Number(parts[0]),
    height: Number(parts[1]),
  };
}

/**
 * Recursively search for an element by value, title, or description
 *
 * @param tree Root element to search from
 * @param query Search query (matched against value, title, description)
 * @param role Optional role filter (e.g., "AXButton", "AXTextField")
 * @returns Element with position if found, null otherwise
 */
export function findAccessibilityElement(
  tree: AccessibilityElement,
  query: string,
  role?: string
): (AccessibilityElement & { position?: ElementPosition }) | null {
  const normalizedQuery = query.toLowerCase();

  // Check current element
  const matches =
    (tree.value?.toLowerCase().includes(normalizedQuery)) ||
    (tree.title?.toLowerCase().includes(normalizedQuery)) ||
    (tree.description?.toLowerCase().includes(normalizedQuery));

  const roleMatches = !role || tree.role === role;

  if (matches && roleMatches && tree.absolute_position) {
    const pos = parsePosition(tree.absolute_position);
    const sizeData = tree.size ? parseSize(tree.size) : undefined;

    return {
      ...tree,
      position: {
        x: pos.x,
        y: pos.y,
        width: sizeData?.width,
        height: sizeData?.height,
      },
    };
  }

  // Search children recursively
  for (const child of tree.children) {
    const found = findAccessibilityElement(child, query, role);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * Find all elements matching a query
 *
 * @param tree Root element to search from
 * @param query Search query
 * @param role Optional role filter
 * @returns Array of matching elements with positions
 */
export function findAllElements(
  tree: AccessibilityElement,
  query: string,
  role?: string
): Array<AccessibilityElement & { position?: ElementPosition }> {
  const results: Array<AccessibilityElement & { position?: ElementPosition }> = [];
  const normalizedQuery = query.toLowerCase();

  function search(element: AccessibilityElement): void {
    const matches =
      (element.value?.toLowerCase().includes(normalizedQuery)) ||
      (element.title?.toLowerCase().includes(normalizedQuery)) ||
      (element.description?.toLowerCase().includes(normalizedQuery));

    const roleMatches = !role || element.role === role;

    if (matches && roleMatches && element.absolute_position) {
      const pos = parsePosition(element.absolute_position);
      const sizeData = element.size ? parseSize(element.size) : undefined;

      results.push({
        ...element,
        position: {
          x: pos.x,
          y: pos.y,
          width: sizeData?.width,
          height: sizeData?.height,
        },
      });
    }

    for (const child of element.children) {
      search(child);
    }
  }

  search(tree);
  return results;
}

/**
 * Get element at specific coordinates
 *
 * @param tree Root element
 * @param x X coordinate
 * @param y Y coordinate
 * @returns Element at position if found, null otherwise
 */
export function getElementAt(
  tree: AccessibilityElement,
  x: number,
  y: number
): (AccessibilityElement & { position?: ElementPosition }) | null {
  function search(element: AccessibilityElement): (AccessibilityElement & { position?: ElementPosition }) | null {
    if (!element.absolute_position || !element.size) {
      // Search children even if parent has no position
      for (const child of element.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    }

    const pos = parsePosition(element.absolute_position);
    const size = parseSize(element.size);

    // Check if point is within element bounds
    if (
      x >= pos.x &&
      x <= pos.x + size.width &&
      y >= pos.y &&
      y <= pos.y + size.height
    ) {
      // Search children first (deeper elements take precedence)
      for (const child of element.children) {
        const found = search(child);
        if (found) return found;
      }

      // Return this element if no child matched
      return {
        ...element,
        position: {
          x: pos.x,
          y: pos.y,
          width: size.width,
          height: size.height,
        },
      };
    }

    return null;
  }

  return search(tree);
}

/**
 * Check if accessibility permissions are granted
 * This is a lightweight check without extracting the full tree
 */
export async function checkAccessibilityPermissions(): Promise<boolean> {
  try {
    await getAccessibilityTree();
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Accessibility permissions')) {
      return false;
    }
    throw error;
  }
}
