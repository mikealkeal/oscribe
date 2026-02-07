#!/usr/bin/env tsx

import { getAccessibilityTree, findAccessibilityElement } from '../dist/src/core/accessibility.js';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

async function main(): Promise<void> {
  try {
    console.log('Extracting accessibility tree...');
    const tree = await getAccessibilityTree();

    console.log('✅ Tree extracted successfully!');
    console.log(`Root element: ${tree.role}`);
    console.log(`Children count: ${tree.children.length}`);
    console.log(`Position: ${tree.absolute_position}`);
    console.log(`Size: ${tree.size}`);

    // Try to find a button
    console.log('\nSearching for buttons...');
    const button = findAccessibilityElement(tree, '', 'AXButton');
    if (button && button.position) {
      console.log(`Found button at (${button.position.x}, ${button.position.y})`);
      console.log(`  Title: ${button.title || 'N/A'}`);
      console.log(`  Value: ${button.value || 'N/A'}`);
    }

    // Save full tree to file (cross-platform)
    const outPath = join(tmpdir(), 'accessibility_tree.json');
    console.log(`\nSaving full tree to ${outPath}`);
    await writeFile(outPath, JSON.stringify(tree, null, 2));
    console.log('✅ Saved!');

  } catch (error) {
    console.error('❌ Error:', (error as Error).message);
    process.exit(1);
  }
}

main();
