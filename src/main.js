import { TitleScene } from './scenes/TitleScene.js';
import { GameScene } from './scenes/GameScene.js';
import { HUDScene } from './scenes/HUDScene.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#05060c',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  input: { activePointers: 3 },
  dom: { createContainer: true },
  scene: [TitleScene, GameScene, HUDScene],
};

new Phaser.Game(config);
