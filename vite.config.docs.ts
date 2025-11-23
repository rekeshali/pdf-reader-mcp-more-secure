import { resolve } from 'node:path';
import { createLeafPlugin, routesPlugin } from '@sylphx/leaf';
import { defineConfig } from 'vite';

const docsDir = resolve(process.cwd(), 'docs');

export default defineConfig({
  plugins: [
    routesPlugin(docsDir),
    ...createLeafPlugin({
      title: 'PDF Reader MCP Server',
      description: 'MCP Server for reading PDF files securely within a project',
      base: '/',
    }),
  ],
  resolve: {
    dedupe: ['solid-js', 'solid-js/web'],
  },
});
