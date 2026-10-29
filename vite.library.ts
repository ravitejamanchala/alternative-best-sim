import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    outDir: 'dist-adapter',
    lib: {
      entry: 'src/sim/learner-bridge.ts',
      formats: ['es'],
      fileName: 'slaydrive-world-adapter',
    },
    rollupOptions: { external: ['three'] },
    sourcemap: true,
  },
});
