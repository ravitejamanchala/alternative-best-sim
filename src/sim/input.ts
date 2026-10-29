export interface DrivingInput {
  throttle: number;
  brake: number;
  steer: number;
  analog: boolean;
}
export class Input {
  keys = new Set<string>();
  touch = { throttle: 0, brake: 0, steer: 0 };
  private down = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.matches('input,textarea,select')) return;
    this.keys.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code))
      e.preventDefault();
  };
  private up = (e: KeyboardEvent) => this.keys.delete(e.code);
  private clear = () => {
    this.keys.clear();
    this.touch = { throttle: 0, brake: 0, steer: 0 };
  };
  constructor() {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.clear);
  }
  read(): DrivingInput {
    const k = this.keys;
    const pad = navigator.getGamepads?.()?.find((p) => p?.connected);
    if (pad && (Math.abs(pad.axes[0]) > 0.08 || pad.buttons[6]?.value || pad.buttons[7]?.value))
      return {
        throttle: pad.buttons[7]?.value || 0,
        brake: pad.buttons[6]?.value || 0,
        steer: -pad.axes[0],
        analog: true,
      };
    return {
      throttle: Math.max(this.touch.throttle, k.has('KeyW') || k.has('ArrowUp') ? 1 : 0),
      brake: Math.max(
        this.touch.brake,
        k.has('KeyS') || k.has('ArrowDown') || k.has('Space') ? 1 : 0,
      ),
      steer:
        this.touch.steer +
        (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) -
        (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0),
      analog: false,
    };
  }
  dispose() {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.clear);
  }
}
