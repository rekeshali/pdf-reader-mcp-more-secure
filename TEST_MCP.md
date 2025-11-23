# Testing PDF Reader MCP Server

The PDF Reader MCP server has been added to your `.mcp.json` configuration.

## Configuration

```json
{
  "mcpServers": {
    "pdf-reader": {
      "type": "stdio",
      "command": "node",
      "args": ["./dist/index.js"]
    }
  }
}
```

**Note**: Uses relative path `./dist/index.js` - MCP client will resolve it relative to the project directory.

## How to Test

### Option 1: Using Claude Desktop / Claude Code

1. **Restart your MCP client** (completely quit and reopen)
2. The `read_pdf` tool should now be available
3. Try asking Claude to read a PDF:

**Example prompts:**
- "Read the PDF at https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
- "Extract text from the first 3 pages of report.pdf"
- "Get metadata from document.pdf and tell me the author and title"

### Option 2: Direct CLI Testing

Test the server directly from command line:

```bash
# List available tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  node /Users/kyle/pdf-reader-mcp/dist/index.js

# Read a PDF from URL
cat << 'EOF' | node /Users/kyle/pdf-reader-mcp/dist/index.js
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_pdf","arguments":{"sources":[{"url":"https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"}],"include_full_text":true}}}
EOF
```

## Test Cases

### 1. Read PDF from URL
```json
{
  "sources": [
    {
      "url": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
    }
  ],
  "include_full_text": true,
  "include_metadata": true,
  "include_page_count": true
}
```

### 2. Read Local PDF with Page Range
```json
{
  "sources": [
    {
      "path": "test-files/sample.pdf",
      "pages": "1-3"
    }
  ],
  "include_full_text": true
}
```

### 3. Extract Images from PDF (v1.2.0 Feature!)
```json
{
  "sources": [
    {
      "path": "presentation.pdf",
      "pages": [1, 2, 3]
    }
  ],
  "include_images": true,
  "include_full_text": true
}
```

**Note**: Images will be returned in the exact order they appear in the document, interleaved with text!

### 4. Multiple PDFs in One Request
```json
{
  "sources": [
    { "path": "doc1.pdf", "pages": "1-5" },
    { "url": "https://example.com/doc2.pdf" }
  ],
  "include_full_text": true
}
```

## Expected Output

The tool returns content parts in order:

1. **First part**: JSON summary with metadata and text
2. **Following parts**: Images (if `include_images: true`) in document order

### Example with Images:

For a PDF with layout:
```
Page 1:
  [Title text]
  [Chart image]
  [Description text]
  [Photo A]
  [Photo B]
  [Conclusion text]
```

Content parts returned:
```
[
  { type: "text", text: "JSON summary..." },
  { type: "text", text: "Title text" },
  { type: "image", data: "base64...", mimeType: "image/jpeg" },  // Chart
  { type: "text", text: "Description text" },
  { type: "image", data: "base64...", mimeType: "image/jpeg" },  // Photo A
  { type: "image", data: "base64...", mimeType: "image/jpeg" },  // Photo B
  { type: "text", text: "Conclusion text" }
]
```

## Troubleshooting

### "No tools" showing up

1. **Make sure you rebuilt the project**:
   ```bash
   cd /Users/kyle/pdf-reader-mcp
   pnpm run build
   ```

2. **Completely restart your MCP client** (not just reload)

3. **Check server logs** in your MCP client's developer console

### Testing without MCP Client

You can test the built server directly:
```bash
node /Users/kyle/pdf-reader-mcp/dist/index.js
```

You should see:
```
[Filesystem MCP - pathUtils] Project Root determined from CWD: /Users/kyle/pdf-reader-mcp
[PDF Reader MCP] Server running on stdio
```

Then type a JSON-RPC request (tools/list or tools/call).

## Version Info

- **Current Version**: 1.2.0
- **Features**:
  - ✅ Text extraction from PDF
  - ✅ Metadata extraction
  - ✅ Image extraction (v1.1.0)
  - ✅ Y-coordinate based content ordering (v1.2.0)
  - ✅ URL and local file support
  - ✅ Parallel processing for speed
  - ✅ Batch processing multiple PDFs

Enjoy testing! 🚀
