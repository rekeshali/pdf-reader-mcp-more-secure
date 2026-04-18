#!/usr/bin/env node

import { createServer, stdio } from '@sylphx/mcp-server-sdk';
import { readPdf } from './handlers/readPdf.js';

const server = createServer({
  name: 'pdf-reader-mcp',
  version: '2.1.0',
  instructions:
    'MCP Server for reading PDF files and extracting text, metadata, images, and page information.',
  tools: { read_pdf: readPdf },
  transport: stdio(),
});

async function main(): Promise<void> {
  await server.start();

  if (process.env['DEBUG_MCP']) {
    console.error('[PDF Reader MCP] Server running on stdio');
    console.error('[PDF Reader MCP] Project root:', process.cwd());
  }
}

main().catch((error: unknown) => {
  console.error('[PDF Reader MCP] Server error:', error);
  process.exit(1);
});
