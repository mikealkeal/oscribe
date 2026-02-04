#!/usr/bin/env node

import { getAccessibilityTree, findAccessibilityElement } from './dist/src/core/accessibility.js';

async function main() {
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

    // Save full tree to file
    console.log('\nSaving full tree to /tmp/accessibility_tree.json');
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/accessibility_tree.json', JSON.stringify(tree, null, 2));
    console.log('✅ Saved!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
