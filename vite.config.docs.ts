import { resolve } from 'node:path';
import { createLeafPlugin, routesPlugin } from '@sylphx/leaf';
import { defineConfig } from 'vite';

const docsDir = resolve(process.cwd(), 'docs');

export default defineConfig({
  root: docsDir,
  plugins: [
    routesPlugin(docsDir),
    ...createLeafPlugin({
      title: 'PDF Reader MCP Server',
      description: 'MCP Server for reading PDF files securely within a project',
      base: '/',
    }),
  ],
  resolve: {
    dedupe: ['preact', 'preact/hooks', 'preact/compat'],
  },
  build: {
    outDir: resolve(process.cwd(), 'docs/dist'),
    emptyOutDir: true,
  },
});
