#!/usr/bin/env node

/**
 * Direct test of accessibility functions
 */

import { getAccessibilityTree, findAccessibilityElement } from './dist/src/core/accessibility.js';

console.log('🧪 Testing Accessibility Tools\n');

async function test1() {
  console.log('=== Test 1: Extract tree ===');
  try {
    const tree = await getAccessibilityTree();
    console.log('✅ Tree extracted');
    console.log(`- Root: ${tree.role}`);
    console.log(`- Position: ${tree.absolute_position}`);
    console.log(`- Size: ${tree.size}`);
    console.log(`- Children: ${tree.children.length}`);
    return tree;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return null;
  }
}

async function test2(tree) {
  console.log('\n=== Test 2: Find element "7" ===');
  if (!tree) {
    console.log('⏭️  Skipped (no tree)');
    return;
  }

  try {
    const element = findAccessibilityElement(tree, '7');
    if (element && element.position) {
      console.log('✅ Element found');
      console.log(`- Role: ${element.role}`);
      console.log(`- Value: ${element.value}`);
      console.log(`- Position: (${element.position.x}, ${element.position.y})`);
      console.log(`- Size: ${element.position.width}x${element.position.height}`);

      const centerX = Math.floor(element.position.x + (element.position.width || 0) / 2);
      const centerY = Math.floor(element.position.y + (element.position.height || 0) / 2);
      console.log(`- Center: (${centerX}, ${centerY})`);
    } else {
      console.log('❌ Element not found');
    }
  } catch (error) {
    console.error('❌ Failed:', error.message);
  }
}

async function test3(tree) {
  console.log('\n=== Test 3: Find nonexistent element ===');
  if (!tree) {
    console.log('⏭️  Skipped (no tree)');
    return;
  }

  try {
    const element = findAccessibilityElement(tree, 'nonexistent_button_12345');
    if (element) {
      console.log('❌ Should not have found element');
    } else {
      console.log('✅ Correctly returned null for nonexistent element');
    }
  } catch (error) {
    console.error('❌ Failed:', error.message);
  }
}

async function main() {
  console.log('📱 Make sure Calculator is open and focused!\n');
  await new Promise(resolve => setTimeout(resolve, 1000));

  const tree = await test1();
  await test2(tree);
  await test3(tree);

  console.log('\n✅ All tests complete!');
}

main();
