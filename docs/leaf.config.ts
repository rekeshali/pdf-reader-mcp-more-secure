import { defineConfig } from '@sylphx/leaf';

export default defineConfig({
  title: 'PDF Reader MCP',
  description: 'MCP Server for reading PDF files - extract text, metadata, and images',
  head: [
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'PDF Reader MCP - Extract PDF Content for AI' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'A high-performance MCP server for reading text, metadata, and images from PDF files',
      },
    ],
    ['meta', { property: 'og:url', content: 'https://pdf-reader-mcp.vercel.app' }],
    ['meta', { property: 'og:site_name', content: 'PDF Reader MCP' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'PDF Reader MCP' }],
    ['meta', { name: 'twitter:description', content: 'Extract PDF content for AI agents via MCP' }],
    ['meta', { name: 'twitter:site', content: '@sylphxai' }],
    [
      'meta',
      {
        name: 'keywords',
        content: 'mcp, pdf, reader, ai, claude, model context protocol, typescript',
      },
    ],
    ['meta', { name: 'author', content: 'Sylphx' }],
    ['meta', { name: 'robots', content: 'index, follow' }],
    ['link', { rel: 'canonical', href: 'https://pdf-reader-mcp.vercel.app' }],
  ],
  theme: {
    editLink: {
      pattern: 'https://github.com/SylphxAI/pdf-reader-mcp/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    lastUpdated: true,
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/' },
      { text: 'API', link: '/guide/getting-started' },
      { text: 'Design', link: '/design/' },
      { text: 'Performance', link: '/performance/' },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/SylphxAI/pdf-reader-mcp' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@sylphx/pdf-reader-mcp' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Introduction', link: '/guide/' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Getting Started', link: '/guide/getting-started' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Design Philosophy', link: '/design/' },
          { text: 'Performance', link: '/performance/' },
          { text: 'Comparison', link: '/comparison/' },
        ],
      },
    ],
  },
});
