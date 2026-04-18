// PDF document loading utilities

import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import type * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ErrorCode, PdfError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { resolvePath } from '../utils/pathUtils.js';
import { validateUrl } from '../utils/urlValidator.js';

const logger = createLogger('Loader');

// Resolve CMap path relative to pdfjs-dist package location
// This ensures CMap files are found regardless of the current working directory
const require = createRequire(import.meta.url);
const CMAP_URL = require.resolve('pdfjs-dist/package.json').replace('package.json', 'cmaps/');

/**
 * Load a PDF document from a local file path or URL
 * @param source - Object containing either path or url
 * @param sourceDescription - Description for error messages
 * @returns PDF document proxy
 */
export const loadPdfDocument = async (
  source: { path?: string | undefined; url?: string | undefined },
  sourceDescription: string
): Promise<pdfjsLib.PDFDocumentProxy> => {
  let pdfDataSource: Uint8Array | { url: string };

  try {
    if (source.path) {
      const safePath = resolvePath(source.path);
      const buffer = await fs.readFile(safePath);
      pdfDataSource = new Uint8Array(buffer);
    } else if (source.url) {
      await validateUrl(source.url, sourceDescription);
      pdfDataSource = { url: source.url };
    } else {
      throw new PdfError(
        ErrorCode.InvalidParams,
        `Source ${sourceDescription} missing 'path' or 'url'.`
      );
    }
  } catch (err: unknown) {
    if (err instanceof PdfError) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    const errorCode = ErrorCode.InvalidRequest;

    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      err.code === 'ENOENT' &&
      source.path
    ) {
      throw new PdfError(errorCode, `File not found at '${source.path}'.`, {
        cause: err instanceof Error ? err : undefined,
      });
    }

    throw new PdfError(
      errorCode,
      `Failed to prepare PDF source ${sourceDescription}. Reason: ${message}`,
      { cause: err instanceof Error ? err : undefined }
    );
  }

  const documentParams =
    pdfDataSource instanceof Uint8Array ? { data: pdfDataSource } : pdfDataSource;

  const loadingTask = getDocument({
    ...documentParams,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
  });

  try {
    return await loadingTask.promise;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('PDF.js loading error', { sourceDescription, error: message });
    throw new PdfError(
      ErrorCode.InvalidRequest,
      `Failed to load PDF document from ${sourceDescription}. Reason: ${message || 'Unknown loading error'}`,
      { cause: err instanceof Error ? err : undefined }
    );
  }
};
