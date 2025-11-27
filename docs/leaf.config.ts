import { defineConfig } from '@sylphx/leaf';

export default defineConfig({
  title: 'PDF Reader MCP Server',
  description: 'MCP Server for reading PDF files securely within a project',
  head: [
    // Open Graph meta tags
    ['meta', { property: 'og:type', content: 'website' }],
    [
      'meta',
      {
        property: 'og:title',
        content: 'PDF Reader MCP Server - Secure PDF Processing',
      },
    ],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'A Model Context Protocol server for secure PDF reading with path validation and resource management',
      },
    ],
    [
      'meta',
      {
        property: 'og:url',
        content: 'https://github.com/SylphxAI/pdf-reader-mcp',
      },
    ],
    ['meta', { property: 'og:site_name', content: 'PDF Reader MCP Server' }],

    // Twitter Card meta tags
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    [
      'meta',
      {
        name: 'twitter:title',
        content: 'PDF Reader MCP Server - Secure PDF Processing',
      },
    ],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'A Model Context Protocol server for secure PDF reading with path validation and resource management',
      },
    ],
    ['meta', { name: 'twitter:site', content: '@sylphxai' }],

    // Additional SEO meta tags
    [
      'meta',
      {
        name: 'keywords',
        content:
          'mcp, model context protocol, pdf, reader, parser, typescript, node, ai, agent, tool',
      },
    ],
    ['meta', { name: 'author', content: 'Sylphx' }],
    ['meta', { name: 'robots', content: 'index, follow' }],
    [
      'link',
      {
        rel: 'canonical',
        href: 'https://github.com/SylphxAI/pdf-reader-mcp',
      },
    ],
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
      { text: 'API Reference', link: '/api/' },
      { text: 'Design', link: '/design/' },
      { text: 'Performance', link: '/performance/' },
      { text: 'Comparison', link: '/comparison/' },
    ],
    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/SylphxAI/pdf-reader-mcp',
      },
      {
        icon: 'npm',
        link: 'https://www.npmjs.com/package/@sylphx/pdf-reader-mcp',
      },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is PDF Reader MCP?', link: '/guide/' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Getting Started', link: '/guide/getting-started' },
        ],
      },
      {
        text: 'API Reference',
        items: [{ text: 'Tool: read_pdf', link: '/api/read_pdf' }],
      },
      {
        text: 'Design',
        items: [{ text: 'Philosophy', link: '/design/' }],
      },
      {
        text: 'Performance',
        items: [{ text: 'Benchmarks', link: '/performance/' }],
      },
      {
        text: 'Comparison',
        items: [{ text: 'Other Solutions', link: '/comparison/' }],
      },
    ],
  },
});
