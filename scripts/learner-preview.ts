import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const learner = resolve(process.env.LEARNER_ROOT || '/workspace/reference-simulator');
const root = process.cwd(),
  port = Number(process.env.LEARNER_PORT || 5175);
const hook = await readFile(resolve(root, 'integrations/learner-hook.js'), 'utf8');
const source = await readFile(resolve(learner, 'js/main.js'), 'utf8');
const marker = '  await areaChain; await new Promise(r => setTimeout(r, 0));';
if (!source.includes(marker))
  throw Error('Learner main has changed; review the integration hook before using this overlay.');
await stat(resolve(root, 'dist-adapter/slaydrive-world-adapter.js'));
const main =
  "import {loadWorldTrack,createLearnerView} from '/__world/adapter.js';\n" +
  source
    .replace(
      'const net = buildNet(d);',
      'renderer.outputEncoding = T.LinearEncoding;\n      const net = buildNet(d);',
    )
    .replace(marker, hook + '\n' + marker);
const mime: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
};
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname);
    if (path === '/auth-config.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end('window.LEARNER_CONFIG = {};');
      return;
    }
    if (path === '/js/main.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(main);
      return;
    }
    const special: Record<string, string> = {
      '/__world/adapter.js': 'dist-adapter/slaydrive-world-adapter.js',
      '/__world/three.min.js': 'node_modules/three/build/three.min.js',
      '/__world/three.module.js': 'node_modules/three/build/three.module.js',
      '/__world/GLTFLoader.js': 'node_modules/three/examples/js/loaders/GLTFLoader.js',
    };
    const file = special[path]
      ? resolve(root, special[path])
      : resolve(learner, '.' + (path === '/' ? '/index.html' : path));
    if (
      !special[path] &&
      (!file.startsWith(learner + sep) || path.split('/').some((p) => p.startsWith('.')))
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    let data = await readFile(file);
    if (path === '/' || path === '/index.html') {
      data = Buffer.from(
        data
          .toString()
          .replace(/<link[^>]+href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '')
          .replace(
            'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
            '/__world/three.min.js',
          )
          .replace(
            'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
            '/__world/GLTFLoader.js',
          )
          .replace(
            '</head>',
            '<script type="importmap">{"imports":{"three":"/__world/three.module.js"}}</script></head>',
          ),
      );
    }
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Local file not found');
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log('Read-only learner development overlay ready on port ' + port),
);
