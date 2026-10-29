import { compile } from './compiler';
self.onmessage = ({ data }) => {
  try {
    postMessage({ id: data.id, result: compile(data.world) });
  } catch (e) {
    postMessage({ id: data.id, error: e instanceof Error ? e.message : String(e) });
  }
};
