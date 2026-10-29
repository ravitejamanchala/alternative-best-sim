import type { World, CompiledWorld } from './types';
export class CompilerJob {
  private worker: Worker | null = null;
  private reject: ((e: Error) => void) | null = null;
  private serial = 0;
  cancel() {
    this.worker?.terminate();
    this.worker = null;
    this.reject?.(new DOMException('Generation cancelled', 'AbortError'));
    this.reject = null;
  }
  run(world: World): Promise<CompiledWorld> {
    if (this.reject) this.cancel();
    return new Promise((resolve, reject) => {
      this.reject = reject;
      const worker =
        this.worker || new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      const id = ++this.serial;
      worker.onmessage = ({ data }) => {
        if (data.id !== id) return;
        this.reject = null;
        if (data.error) reject(Error(data.error));
        else resolve(data.result);
      };
      worker.onerror = (e) => {
        worker.terminate();
        this.worker = null;
        this.reject = null;
        reject(Error(e.message));
      };
      worker.postMessage({ id, world });
    });
  }
}
