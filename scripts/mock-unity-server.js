/**
 * Mock Unity Bridge Server
 * Simulates a Unity game with OScribe Bridge plugin on port 9876
 *
 * Usage: node scripts/mock-unity-server.js
 */

import { createServer } from 'node:net';

const MOCK_RESPONSE = {
  version: '1.0',
  gameInfo: {
    name: 'MockUnityGame',
    scene: 'MainMenu',
    resolution: { width: 1920, height: 1080 },
  },
  elements: [
    {
      type: 'Button',
      name: 'PlayButton',
      path: 'Canvas/MainMenu/PlayButton',
      screenRect: { x: 860, y: 440, width: 200, height: 60 },
      isInteractable: true,
      isVisible: true,
      value: 'PLAY',
      is3D: false,
    },
    {
      type: 'Button',
      name: 'SettingsButton',
      path: 'Canvas/MainMenu/SettingsButton',
      screenRect: { x: 860, y: 520, width: 200, height: 60 },
      isInteractable: true,
      isVisible: true,
      value: 'SETTINGS',
      is3D: false,
    },
    {
      type: 'Button',
      name: 'QuitButton',
      path: 'Canvas/MainMenu/QuitButton',
      screenRect: { x: 860, y: 600, width: 200, height: 60 },
      isInteractable: true,
      isVisible: true,
      value: 'QUIT',
      is3D: false,
    },
    {
      type: 'Text',
      name: 'TitleText',
      path: 'Canvas/MainMenu/TitleText',
      screenRect: { x: 660, y: 100, width: 600, height: 80 },
      isInteractable: false,
      isVisible: true,
      value: 'Mock Unity Game',
      is3D: false,
    },
    {
      type: 'Slider',
      name: 'VolumeSlider',
      path: 'Canvas/MainMenu/VolumeSlider',
      screenRect: { x: 760, y: 700, width: 400, height: 40 },
      isInteractable: true,
      isVisible: true,
      value: '0.75',
      is3D: false,
    },
    {
      type: 'Card3D',
      name: 'HandCard_0',
      path: 'GameBoard/Hand/HandCard_0',
      screenRect: { x: 400, y: 700, width: 120, height: 180 },
      isInteractable: true,
      isVisible: true,
      value: 'Fireball',
      is3D: true,
    },
    {
      type: 'Card3D',
      name: 'HandCard_1',
      path: 'GameBoard/Hand/HandCard_1',
      screenRect: { x: 540, y: 700, width: 120, height: 180 },
      isInteractable: true,
      isVisible: true,
      value: 'Frost Nova',
      is3D: true,
    },
    {
      type: 'Character3D',
      name: 'HeroPortrait',
      path: 'GameBoard/Heroes/HeroPortrait',
      screenRect: { x: 860, y: 850, width: 160, height: 160 },
      isInteractable: true,
      isVisible: true,
      value: 'Jaina - 30 HP',
      is3D: true,
    },
  ],
  timestamp: new Date().toISOString(),
};

const server = createServer((socket) => {
  console.log('[mock] Client connected');

  const json = JSON.stringify(MOCK_RESPONSE);
  const payload = Buffer.from(json, 'utf-8');

  // Length-prefix framing: 4 bytes big-endian + payload
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(payload.length, 0);

  socket.write(lengthBuf);
  socket.write(payload);
  socket.end();

  console.log(`[mock] Sent ${MOCK_RESPONSE.elements.length} elements (${payload.length} bytes)`);
});

server.listen(9876, 'localhost', () => {
  console.log('');
  console.log('  Mock Unity Bridge Server');
  console.log('  Port: localhost:9876');
  console.log(`  Elements: ${MOCK_RESPONSE.elements.length}`);
  console.log('');
  console.log('  Waiting for OScribe connections...');
  console.log('  Press Ctrl+C to stop');
  console.log('');
});
