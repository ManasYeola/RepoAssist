/**
 * Fallback token-based chunker for unsupported languages.
 * Splits source into overlapping chunks of ~60 lines with 10-line overlap.
 */

const CHUNK_SIZE = 60;  // lines per chunk
const OVERLAP = 10;     // overlapping lines between chunks

/**
 * Chunk source file by line windows.
 * @param {string} content - Source file content
 * @param {string} filePath - Relative file path
 * @param {string} language - Detected language name
 * @returns {Array} Array of code chunk objects
 */
const parseFallback = (content, filePath, language = 'unknown') => {
  const lines = content.split('\n');
  const chunks = [];

  if (lines.length <= CHUNK_SIZE) {
    // Small file: return as single chunk
    return [{
      filePath,
      language,
      symbolName: filePath.split('/').pop(),
      symbolType: 'file',
      parentSymbol: null,
      startLine: 1,
      endLine: lines.length,
      content,
    }];
  }

  let start = 0;
  let chunkIndex = 0;

  while (start < lines.length) {
    const end = Math.min(start + CHUNK_SIZE, lines.length);
    const chunkContent = lines.slice(start, end).join('\n');

    chunks.push({
      filePath,
      language,
      symbolName: `${filePath.split('/').pop()}#chunk${chunkIndex + 1}`,
      symbolType: 'chunk',
      parentSymbol: null,
      startLine: start + 1,
      endLine: end,
      content: chunkContent,
    });

    chunkIndex++;
    start += CHUNK_SIZE - OVERLAP;
  }

  return chunks;
};

module.exports = { parseFallback };
