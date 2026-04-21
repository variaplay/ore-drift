import { Controller } from './Controller.js';

// Slither-style: pointer position relative to screen center = steering target.
// Pointer down (held) = boost. Lift = keep last heading.
export class LocalInputController extends Controller {
  constructor(scene) {
    super();
    this.scene = scene;
    this.lastHeading = 0;
    this.active = false;
    this.boost = false;

    scene.input.on('pointerdown', this._onDown, this);
    scene.input.on('pointerup', this._onUp, this);
    scene.input.on('pointerupoutside', this._onUp, this);
    scene.input.on('pointermove', this._onMove, this);
  }

  _onDown(pointer) {
    this.active = true;
    this.boost = true;
    this._updateFromPointer(pointer);
  }

  _onUp() {
    this.active = false;
    this.boost = false;
  }

  _onMove(pointer) {
    if (this.active) this._updateFromPointer(pointer);
    else if (pointer.isDown === false) {
      // desktop hover-steer: follow mouse without boosting
      this._updateFromPointer(pointer);
    }
  }

  _updateFromPointer(pointer) {
    const cam = this.scene.cameras.main;
    const dx = pointer.x - cam.width * 0.5;
    const dy = pointer.y - cam.height * 0.5;
    if (dx * dx + dy * dy < 16) return; // deadzone
    this.lastHeading = Math.atan2(dy, dx);
  }

  update() {
    return { heading: this.lastHeading, boost: this.boost };
  }
}
