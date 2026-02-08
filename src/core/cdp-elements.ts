/**
 * CDP Elements Module
 *
 * Extracts DOM elements from browser via Chrome DevTools Protocol
 * and converts them to OScribe's UIElement format.
 *
 * Uses Accessibility Tree for semantic element information
 * and DOM.getBoxModel() for precise bounding boxes.
 */

import type { CDPConnection } from './cdp-client.js';
import type { UIElement } from './uiautomation.js';

// Accessibility Node from CDP
interface AXNode {
  nodeId: string;
  ignored: boolean;
  role?: { type: string; value: string };
  name?: { type: string; value: string };
  description?: { type: string; value: string };
  value?: { type: string; value: string };
  checked?: { type: string; value: boolean };
  selected?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  focused?: boolean;
  children?: AXNode[];
  backendDOMNodeId?: number;
}

// DOM Box Model from CDP
interface DOMBoxModel {
  content: number[]; // [x1, y1, x2, y2, x3, y3, x4, y4]
  padding: number[];
  border: number[];
  margin: number[];
  width: number;
  height: number;
}

// Map ARIA/AX roles to UIElement types
const ROLE_TO_TYPE: Record<string, string> = {
  button: 'Button',
  link: 'Hyperlink',
  textbox: 'Edit',
  'search box': 'Edit',
  combobox: 'ComboBox',
  checkbox: 'CheckBox',
  radio: 'RadioButton',
  menuitem: 'MenuItem',
  menuitemcheckbox: 'MenuItem',
  menuitemradio: 'MenuItem',
  tab: 'TabItem',
  tabpanel: 'TabItem',
  heading: 'Text',
  image: 'Image',
  img: 'Image',
  list: 'List',
  listitem: 'ListItem',
  table: 'Table',
  row: 'DataItem',
  cell: 'DataItem',
  columnheader: 'Header',
  rowheader: 'Header',
  slider: 'Slider',
  spinbutton: 'Spinner',
  progressbar: 'ProgressBar',
  scrollbar: 'ScrollBar',
  toolbar: 'ToolBar',
  status: 'StatusBar',
  alert: 'Text',
  dialog: 'Window',
  document: 'Document',
};

// Interactive roles that should be included
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'search box',
  'combobox',
  'checkbox',
  'radio',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'slider',
  'spinbutton',
]);

// Simple logger
const logger = {
  debug: (msg: string, data?: Record<string, unknown>): void => {
    if (process.env['DEBUG']) console.log(`[cdp-elements] ${msg}`, data ?? '');
  },
  info: (msg: string, data?: Record<string, unknown>): void => {
    console.log(`[cdp-elements] ${msg}`, data ?? '');
  },
  warn: (msg: string, data?: Record<string, unknown>): void => {
    console.warn(`[cdp-elements] ${msg}`, data ?? '');
  },
  error: (msg: string, data?: Record<string, unknown>): void => {
    console.error(`[cdp-elements] ${msg}`, data ?? '');
  },
};

/**
 * Get all interactive elements from the page via CDP
 *
 * @param cdp - CDP connection instance
 * @returns Array of UIElements
 */
/**
 * Get Chrome UI offset (toolbar height)
 * Returns the exact height of Chrome's UI (title bar + tabs + address bar)
 */
export async function getChromeUIOffset(cdp: CDPConnection): Promise<number> {
  try {
    // Execute JavaScript to get the difference between outer and inner height
    const result = await cdp.Runtime.evaluate({
      expression: 'window.outerHeight - window.innerHeight',
      returnByValue: true,
    });

    if (result.result?.value && typeof result.result.value === 'number') {
      return result.result.value;
    }

    // Fallback: estimate based on platform
    return process.platform === 'darwin' ? 140 : 120;
  } catch {
    // Fallback on error
    return process.platform === 'darwin' ? 140 : 120;
  }
}

export async function getInteractiveElements(
  cdp: CDPConnection
): Promise<UIElement[]> {
  // Wide event pattern - single log for entire operation
  const event = {
    action: 'cdp_get_elements',
    timestamp: new Date().toISOString(),
    duration_ms: 0,
    success: false,
    elementsFound: 0,
  };

  const startTime = Date.now();

  try {
    // Enable Accessibility domain
    await cdp.Accessibility.enable();

    // Get the full accessibility tree
    // Pass empty object {} as required by CDP API
    const { nodes } = await cdp.Accessibility.getFullAXTree({});

    logger.debug(`Retrieved ${nodes.length} accessibility nodes`);

    // Filter and convert nodes to UIElements
    const elements: UIElement[] = [];

    for (const node of nodes) {
      const element = await convertAXNodeToUIElement(cdp, node as unknown as AXNode);
      if (element) {
        elements.push(element);
      }
    }

    // Disable Accessibility domain to save resources
    await cdp.Accessibility.disable();

    event.duration_ms = Date.now() - startTime;
    event.success = true;
    event.elementsFound = elements.length;

    logger.info('Interactive elements extracted', event);

    return elements;
  } catch (error) {
    event.duration_ms = Date.now() - startTime;

    logger.error('Failed to get interactive elements', {
      ...event,
      error: String(error),
    });

    return [];
  }
}

/**
 * Convert AX node to UIElement
 *
 * @param cdp - CDP connection
 * @param node - Accessibility node
 * @returns UIElement or null if node should be filtered
 */
async function convertAXNodeToUIElement(
  cdp: CDPConnection,
  node: AXNode
): Promise<UIElement | null> {
  // Skip ignored nodes
  if (node.ignored || !node.role) {
    return null;
  }

  const role = node.role.value;
  const type = ROLE_TO_TYPE[role] ?? 'Control';

  // Filter non-interactive elements (unless they're specific types we want)
  if (!INTERACTIVE_ROLES.has(role) && type === 'Control') {
    return null;
  }

  const name = node.name?.value ?? '';

  // Skip unnamed non-interactive elements
  if (!name && !INTERACTIVE_ROLES.has(role)) {
    return null;
  }

  // Get bounding box if we have a DOM node ID
  let bounds = { x: 0, y: 0, width: 0, height: 0 };

  if (node.backendDOMNodeId) {
    bounds = await getBoundingBox(cdp, node.backendDOMNodeId);
  }

  // Skip elements with no size (hidden or not rendered)
  if (bounds.width === 0 || bounds.height === 0) {
    return null;
  }

  const element: UIElement = {
    type,
    name,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isEnabled: !node.disabled && !node.readonly,
  };

  // Add optional properties only if they exist
  if (node.description?.value) {
    element.description = node.description.value;
  }

  if (node.value?.value) {
    element.value = node.value.value;
  }

  return element;
}

/**
 * Get bounding box for a DOM node
 *
 * @param cdp - CDP connection
 * @param nodeId - Backend DOM node ID
 * @returns Bounding box { x, y, width, height }
 */
async function getBoundingBox(
  cdp: CDPConnection,
  nodeId: number
): Promise<{ x: number; y: number; width: number; height: number }> {
  try {
    const { model } = await cdp.DOM.getBoxModel({ backendNodeId: nodeId });

    if (!model) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const boxModel = model as unknown as DOMBoxModel;

    // Content quad is [x1, y1, x2, y2, x3, y3, x4, y4]
    // We want top-left corner (x1, y1) and dimensions
    const x = Math.min(
      boxModel.content[0] ?? 0,
      boxModel.content[2] ?? 0,
      boxModel.content[4] ?? 0,
      boxModel.content[6] ?? 0
    );
    const y = Math.min(
      boxModel.content[1] ?? 0,
      boxModel.content[3] ?? 0,
      boxModel.content[5] ?? 0,
      boxModel.content[7] ?? 0
    );
    const width = boxModel.width;
    const height = boxModel.height;

    return { x, y, width, height };
  } catch (error) {
    // Node might not have a box model (e.g., display: none)
    logger.debug(`Failed to get box model for node ${nodeId}`, {
      error: String(error),
    });
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

/**
 * Get element at specific coordinates
 *
 * @param cdp - CDP connection
 * @param x - X coordinate
 * @param y - Y coordinate
 * @returns UIElement at coordinates or null
 */
export async function getElementAtCoordinates(
  cdp: CDPConnection,
  x: number,
  y: number
): Promise<UIElement | null> {
  try {
    // Get node at coordinates
    const { nodeId } = await cdp.DOM.getNodeForLocation({ x, y });

    if (!nodeId) {
      return null;
    }

    // Get accessibility node for this DOM node
    await cdp.Accessibility.enable();
    const { nodes } = await cdp.Accessibility.getPartialAXTree({
      nodeId,
      fetchRelatives: false,
    });
    await cdp.Accessibility.disable();

    if (nodes.length === 0) {
      return null;
    }

    const axNode = nodes[0] as unknown as AXNode;
    return convertAXNodeToUIElement(cdp, axNode);
  } catch (error) {
    logger.error('Failed to get element at coordinates', {
      x,
      y,
      error: String(error),
    });
    return null;
  }
}
