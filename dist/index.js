#!/usr/bin/env node

// src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode as ErrorCode5,
  ListToolsRequestSchema,
  McpError as McpError5
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

// src/handlers/readPdf.ts
import { ErrorCode as ErrorCode4, McpError as McpError4 } from "@modelcontextprotocol/sdk/types.js";
import { z as z2 } from "zod";

// src/pdf/extractor.ts
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PNG } from "pngjs";
var encodePixelsToPNG = (pixelData, width, height, channels) => {
  const png = new PNG({ width, height });
  if (channels === 4) {
    png.data = Buffer.from(pixelData);
  } else if (channels === 3) {
    for (let i = 0;i < width * height; i++) {
      const srcIdx = i * 3;
      const dstIdx = i * 4;
      png.data[dstIdx] = pixelData[srcIdx] ?? 0;
      png.data[dstIdx + 1] = pixelData[srcIdx + 1] ?? 0;
      png.data[dstIdx + 2] = pixelData[srcIdx + 2] ?? 0;
      png.data[dstIdx + 3] = 255;
    }
  } else if (channels === 1) {
    for (let i = 0;i < width * height; i++) {
      const gray = pixelData[i] ?? 0;
      const dstIdx = i * 4;
      png.data[dstIdx] = gray;
      png.data[dstIdx + 1] = gray;
      png.data[dstIdx + 2] = gray;
      png.data[dstIdx + 3] = 255;
    }
  }
  const pngBuffer = PNG.sync.write(png);
  return pngBuffer.toString("base64");
};
var extractMetadataAndPageCount = async (pdfDocument, includeMetadata, includePageCount) => {
  const output = {};
  if (includePageCount) {
    output.num_pages = pdfDocument.numPages;
  }
  if (includeMetadata) {
    try {
      const pdfMetadata = await pdfDocument.getMetadata();
      const infoData = pdfMetadata.info;
      if (infoData !== undefined) {
        output.info = infoData;
      }
      const metadataObj = pdfMetadata.metadata;
      if (typeof metadataObj.getAll === "function") {
        output.metadata = metadataObj.getAll();
      } else {
        const metadataRecord = {};
        for (const key in metadataObj) {
          if (Object.hasOwn(metadataObj, key)) {
            metadataRecord[key] = metadataObj[key];
          }
        }
        output.metadata = metadataRecord;
      }
    } catch (metaError) {
      console.warn(`[PDF Reader MCP] Error extracting metadata: ${metaError instanceof Error ? metaError.message : String(metaError)}`);
    }
  }
  return output;
};
var buildWarnings = (invalidPages, totalPages) => {
  if (invalidPages.length === 0) {
    return [];
  }
  return [
    `Requested page numbers ${invalidPages.join(", ")} exceed total pages (${String(totalPages)}).`
  ];
};
var extractPageContent = async (pdfDocument, pageNum, includeImages, sourceDescription) => {
  const contentItems = [];
  try {
    const page = await pdfDocument.getPage(pageNum);
    const textContent = await page.getTextContent();
    const textByY = new Map;
    for (const item of textContent.items) {
      const textItem = item;
      const yCoord = textItem.transform[5];
      if (yCoord === undefined)
        continue;
      const y = Math.round(yCoord);
      if (!textByY.has(y)) {
        textByY.set(y, []);
      }
      textByY.get(y)?.push(textItem.str);
    }
    for (const [y, textParts] of textByY.entries()) {
      const textContent2 = textParts.join("");
      if (textContent2.trim()) {
        contentItems.push({
          type: "text",
          yPosition: y,
          textContent: textContent2
        });
      }
    }
    if (includeImages) {
      const operatorList = await page.getOperatorList();
      const imageIndices = [];
      for (let i = 0;i < operatorList.fnArray.length; i++) {
        const op = operatorList.fnArray[i];
        if (op === OPS.paintImageXObject || op === OPS.paintXObject) {
          imageIndices.push(i);
        }
      }
      const imagePromises = imageIndices.map((imgIndex, arrayIndex) => new Promise((resolve) => {
        const argsArray = operatorList.argsArray[imgIndex];
        if (!argsArray || argsArray.length === 0) {
          resolve(null);
          return;
        }
        const imageName = argsArray[0];
        let yPosition = 0;
        if (argsArray.length > 1 && Array.isArray(argsArray[1])) {
          const transform = argsArray[1];
          const yCoord = transform[5];
          if (yCoord !== undefined) {
            yPosition = Math.round(yCoord);
          }
        }
        const processImageData = (imageData) => {
          if (!imageData || typeof imageData !== "object") {
            return null;
          }
          const img = imageData;
          if (!img.data || !img.width || !img.height) {
            return null;
          }
          const channels = img.kind === 1 ? 1 : img.kind === 3 ? 4 : 3;
          const format = img.kind === 1 ? "grayscale" : img.kind === 3 ? "rgba" : "rgb";
          const pngBase64 = encodePixelsToPNG(img.data, img.width, img.height, channels);
          return {
            type: "image",
            yPosition,
            imageData: {
              page: pageNum,
              index: arrayIndex,
              width: img.width,
              height: img.height,
              format,
              data: pngBase64
            }
          };
        };
        if (imageName.startsWith("g_")) {
          try {
            const imageData = page.commonObjs.get(imageName);
            if (imageData) {
              const result = processImageData(imageData);
              resolve(result);
              return;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[PDF Reader MCP] Error getting image from commonObjs ${imageName}: ${message}`);
          }
        }
        try {
          const imageData = page.objs.get(imageName);
          if (imageData !== undefined) {
            const result = processImageData(imageData);
            resolve(result);
            return;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[PDF Reader MCP] Sync image get failed for ${imageName}, trying async: ${message}`);
        }
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.warn(`[PDF Reader MCP] Image extraction timeout for ${imageName} on page ${String(pageNum)}`);
            resolve(null);
          }
        }, 1e4);
        page.objs.get(imageName, (imageData) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            const result = processImageData(imageData);
            resolve(result);
          }
        });
      }));
      const resolvedImages = await Promise.all(imagePromises);
      contentItems.push(...resolvedImages.filter((item) => item !== null));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[PDF Reader MCP] Error extracting page content for page ${String(pageNum)} in ${sourceDescription}: ${message}`);
    return [
      {
        type: "text",
        yPosition: 0,
        textContent: `Error processing page: ${message}`
      }
    ];
  }
  return contentItems.sort((a, b) => b.yPosition - a.yPosition);
};

// src/pdf/loader.ts
import fs from "node:fs/promises";
import { ErrorCode as ErrorCode2, McpError as McpError2 } from "@modelcontextprotocol/sdk/types.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// src/utils/pathUtils.ts
import path from "node:path";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
var PROJECT_ROOT = process.cwd();
var resolvePath = (userPath) => {
  if (typeof userPath !== "string") {
    throw new McpError(ErrorCode.InvalidParams, "Path must be a string.");
  }
  const normalizedUserPath = path.normalize(userPath);
  if (path.isAbsolute(normalizedUserPath)) {
    return normalizedUserPath;
  }
  return path.resolve(PROJECT_ROOT, normalizedUserPath);
};

// src/pdf/loader.ts
var loadPdfDocument = async (source, sourceDescription) => {
  let pdfDataSource;
  try {
    if (source.path) {
      const safePath = resolvePath(source.path);
      const buffer = await fs.readFile(safePath);
      pdfDataSource = new Uint8Array(buffer);
    } else if (source.url) {
      pdfDataSource = { url: source.url };
    } else {
      throw new McpError2(ErrorCode2.InvalidParams, `Source ${sourceDescription} missing 'path' or 'url'.`);
    }
  } catch (err) {
    if (err instanceof McpError2) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    const errorCode = ErrorCode2.InvalidRequest;
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT" && source.path) {
      throw new McpError2(errorCode, `File not found at '${source.path}'.`, {
        cause: err instanceof Error ? err : undefined
      });
    }
    throw new McpError2(errorCode, `Failed to prepare PDF source ${sourceDescription}. Reason: ${message}`, { cause: err instanceof Error ? err : undefined });
  }
  const loadingTask = getDocument(pdfDataSource);
  try {
    return await loadingTask.promise;
  } catch (err) {
    console.error(`[PDF Reader MCP] PDF.js loading error for ${sourceDescription}:`, err);
    const message = err instanceof Error ? err.message : String(err);
    throw new McpError2(ErrorCode2.InvalidRequest, `Failed to load PDF document from ${sourceDescription}. Reason: ${message || "Unknown loading error"}`, { cause: err instanceof Error ? err : undefined });
  }
};

// src/pdf/parser.ts
import { ErrorCode as ErrorCode3, McpError as McpError3 } from "@modelcontextprotocol/sdk/types.js";
var MAX_RANGE_SIZE = 1e4;
var parseRangePart = (part, pages) => {
  const trimmedPart = part.trim();
  if (trimmedPart.includes("-")) {
    const splitResult = trimmedPart.split("-");
    const startStr = splitResult[0] || "";
    const endStr = splitResult[1];
    const start = parseInt(startStr, 10);
    const end = endStr === "" || endStr === undefined ? Infinity : parseInt(endStr, 10);
    if (Number.isNaN(start) || Number.isNaN(end) || start <= 0 || start > end) {
      throw new Error(`Invalid page range values: ${trimmedPart}`);
    }
    const practicalEnd = Math.min(end, start + MAX_RANGE_SIZE);
    for (let i = start;i <= practicalEnd; i++) {
      pages.add(i);
    }
    if (end === Infinity && practicalEnd === start + MAX_RANGE_SIZE) {
      console.warn(`[PDF Reader MCP] Open-ended range starting at ${String(start)} was truncated at page ${String(practicalEnd)}.`);
    }
  } else {
    const page = parseInt(trimmedPart, 10);
    if (Number.isNaN(page) || page <= 0) {
      throw new Error(`Invalid page number: ${trimmedPart}`);
    }
    pages.add(page);
  }
};
var parsePageRanges = (ranges) => {
  const pages = new Set;
  const parts = ranges.split(",");
  for (const part of parts) {
    parseRangePart(part, pages);
  }
  if (pages.size === 0) {
    throw new Error("Page range string resulted in zero valid pages.");
  }
  return Array.from(pages).sort((a, b) => a - b);
};
var getTargetPages = (sourcePages, sourceDescription) => {
  if (!sourcePages) {
    return;
  }
  try {
    if (typeof sourcePages === "string") {
      return parsePageRanges(sourcePages);
    }
    if (sourcePages.some((p) => !Number.isInteger(p) || p <= 0)) {
      throw new Error("Page numbers in array must be positive integers.");
    }
    const uniquePages = [...new Set(sourcePages)].sort((a, b) => a - b);
    if (uniquePages.length === 0) {
      throw new Error("Page specification resulted in an empty set of pages.");
    }
    return uniquePages;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new McpError3(ErrorCode3.InvalidParams, `Invalid page specification for source ${sourceDescription}: ${message}`);
  }
};
var determinePagesToProcess = (targetPages, totalPages, includeFullText) => {
  if (targetPages) {
    const pagesToProcess = targetPages.filter((p) => p <= totalPages);
    const invalidPages = targetPages.filter((p) => p > totalPages);
    return { pagesToProcess, invalidPages };
  }
  if (includeFullText) {
    const pagesToProcess = Array.from({ length: totalPages }, (_, i) => i + 1);
    return { pagesToProcess, invalidPages: [] };
  }
  return { pagesToProcess: [], invalidPages: [] };
};

// src/schemas/readPdf.ts
import { z } from "zod";
var pageSpecifierSchema = z.union([
  z.array(z.number().int().min(1)).min(1).describe("Array of page numbers (1-based)"),
  z.string().min(1).refine((val) => /^[0-9,-]+$/.test(val.replace(/\s/g, "")), {
    message: "Page string must contain only numbers, commas, and hyphens."
  }).describe('Page range string (e.g., "1-5,10,15-20")')
]);
var pdfSourceSchema = z.object({
  path: z.string().min(1).optional().describe("Path to the local PDF file (absolute or relative to cwd)."),
  url: z.string().url().optional().describe("URL of the PDF file."),
  pages: pageSpecifierSchema.optional().describe("Extract text only from specific pages (1-based) or ranges for this source. If provided, 'include_full_text' is ignored for this source.")
}).strict().refine((data) => !!(data.path && !data.url) || !!(!data.path && data.url), {
  message: "Each source must have either 'path' or 'url', but not both."
});
var readPdfArgsSchema = z.object({
  sources: z.array(pdfSourceSchema).min(1).describe("An array of PDF sources to process, each can optionally specify pages."),
  include_full_text: z.boolean().optional().default(false).describe("Include the full text content of each PDF (only if 'pages' is not specified for that source)."),
  include_metadata: z.boolean().optional().default(true).describe("Include metadata and info objects for each PDF."),
  include_page_count: z.boolean().optional().default(true).describe("Include the total number of pages for each PDF."),
  include_images: z.boolean().optional().default(false).describe("Extract and include embedded images from the PDF pages as base64-encoded data.")
}).strict();

// src/handlers/readPdf.ts
var processSingleSource = async (source, options) => {
  const sourceDescription = source.path ?? source.url ?? "unknown source";
  let individualResult = { source: sourceDescription, success: false };
  try {
    const targetPages = getTargetPages(source.pages, sourceDescription);
    const { pages: _pages, ...loadArgs } = source;
    const pdfDocument = await loadPdfDocument(loadArgs, sourceDescription);
    const totalPages = pdfDocument.numPages;
    const metadataOutput = await extractMetadataAndPageCount(pdfDocument, options.includeMetadata, options.includePageCount);
    const output = { ...metadataOutput };
    const { pagesToProcess, invalidPages } = determinePagesToProcess(targetPages, totalPages, options.includeFullText);
    const warnings = buildWarnings(invalidPages, totalPages);
    if (warnings.length > 0) {
      output.warnings = warnings;
    }
    if (pagesToProcess.length > 0) {
      const pageContents = await Promise.all(pagesToProcess.map((pageNum) => extractPageContent(pdfDocument, pageNum, options.includeImages, sourceDescription)));
      output.page_contents = pageContents.map((items, idx) => ({
        page: pagesToProcess[idx],
        items
      }));
      const extractedPageTexts = pageContents.map((items, idx) => ({
        page: pagesToProcess[idx],
        text: items.filter((item) => item.type === "text").map((item) => item.textContent).join("")
      }));
      if (targetPages) {
        output.page_texts = extractedPageTexts;
      } else {
        output.full_text = extractedPageTexts.map((p) => p.text).join(`

`);
      }
      if (options.includeImages) {
        const extractedImages = pageContents.flatMap((items) => items.filter((item) => item.type === "image" && item.imageData)).map((item) => item.imageData).filter((img) => img !== undefined);
        if (extractedImages.length > 0) {
          output.images = extractedImages;
        }
      }
    }
    individualResult = { ...individualResult, data: output, success: true };
  } catch (error) {
    let errorMessage = `Failed to process PDF from ${sourceDescription}.`;
    if (error instanceof McpError4) {
      errorMessage = error.message;
    } else if (error instanceof Error) {
      errorMessage += ` Reason: ${error.message}`;
    } else {
      errorMessage += ` Unknown error: ${JSON.stringify(error)}`;
    }
    individualResult.error = errorMessage;
    individualResult.success = false;
    individualResult.data = undefined;
  }
  return individualResult;
};
var handleReadPdfFunc = async (args) => {
  let parsedArgs;
  try {
    parsedArgs = readPdfArgsSchema.parse(args);
  } catch (error) {
    if (error instanceof z2.ZodError) {
      throw new McpError4(ErrorCode4.InvalidParams, `Invalid arguments: ${error.issues.map((e) => `${e.path.join(".")} (${e.message})`).join(", ")}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new McpError4(ErrorCode4.InvalidParams, `Argument validation failed: ${message}`);
  }
  const { sources, include_full_text, include_metadata, include_page_count, include_images } = parsedArgs;
  const results = await Promise.all(sources.map((source) => processSingleSource(source, {
    includeFullText: include_full_text,
    includeMetadata: include_metadata,
    includePageCount: include_page_count,
    includeImages: include_images
  })));
  const content = [];
  const resultsForJson = results.map((result) => {
    if (result.data) {
      const { images, page_contents, ...dataWithoutBinaryContent } = result.data;
      if (images) {
        const imageInfo = images.map((img) => ({
          page: img.page,
          index: img.index,
          width: img.width,
          height: img.height,
          format: img.format
        }));
        return { ...result, data: { ...dataWithoutBinaryContent, image_info: imageInfo } };
      }
      return { ...result, data: dataWithoutBinaryContent };
    }
    return result;
  });
  content.push({
    type: "text",
    text: JSON.stringify({ results: resultsForJson }, null, 2)
  });
  for (const result of results) {
    if (!result.success || !result.data?.page_contents)
      continue;
    for (const pageContent of result.data.page_contents) {
      for (const item of pageContent.items) {
        if (item.type === "text" && item.textContent) {
          content.push({
            type: "text",
            text: item.textContent
          });
        } else if (item.type === "image" && item.imageData) {
          content.push({
            type: "image",
            data: item.imageData.data,
            mimeType: "image/png"
          });
        }
      }
    }
  }
  return { content };
};
var readPdfToolDefinition = {
  name: "read_pdf",
  description: "Reads content/metadata/images from one or more PDFs (local/URL). Each source can specify pages to extract.",
  schema: readPdfArgsSchema,
  handler: handleReadPdfFunc
};

// src/handlers/index.ts
var allToolDefinitions = [readPdfToolDefinition];

// src/index.ts
var server = new Server({
  name: "pdf-reader-mcp",
  version: "1.3.0",
  description: "MCP Server for reading PDF files and extracting text, metadata, images, and page information."
}, {
  capabilities: { tools: {} }
});
var generateInputSchema = (schema) => {
  return zodToJsonSchema(schema, { target: "openApi3" });
};
server.setRequestHandler(ListToolsRequestSchema, () => {
  const availableTools = allToolDefinitions.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: generateInputSchema(def.schema)
  }));
  return { tools: availableTools };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolDefinition = allToolDefinitions.find((def) => def.name === request.params.name);
  if (!toolDefinition) {
    throw new McpError5(ErrorCode5.MethodNotFound, `Unknown tool: ${request.params.name}`);
  }
  return toolDefinition.handler(request.params.arguments);
});
async function main() {
  const transport = new StdioServerTransport;
  await server.connect(transport);
  if (process.env.DEBUG_MCP) {
    console.error("[PDF Reader MCP] Server running on stdio");
    console.error("[PDF Reader MCP] Project root:", process.cwd());
  }
}
main().catch((error) => {
  console.error("[PDF Reader MCP] Server error:", error);
  process.exit(1);
});
