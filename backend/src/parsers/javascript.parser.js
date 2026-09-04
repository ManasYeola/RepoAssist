const { parse } = require('@babel/parser');

/**
 * Supported node types to extract as code chunks.
 */
const SUPPORTED_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassDeclaration',
  'ClassExpression',
  'ClassMethod',
  'ObjectMethod',
  'ExportDefaultDeclaration',
  'ExportNamedDeclaration',
]);

/**
 * Parse JavaScript source code using Babel AST and extract semantic code chunks.
 * @param {string} content - Source file content
 * @param {string} filePath - Relative file path (for metadata)
 * @returns {Array} Array of code chunk objects
 */
const parseJavaScript = (content, filePath) => {
  let ast;
  try {
    ast = parse(content, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator', 'classProperties'],
      errorRecovery: true,
    });
  } catch (err) {
    // Return a single fallback chunk for the whole file
    return [{
      filePath,
      language: 'javascript',
      symbolName: filePath.split('/').pop(),
      symbolType: 'file',
      parentSymbol: null,
      startLine: 1,
      endLine: content.split('\n').length,
      content,
    }];
  }

  const lines = content.split('\n');
  const chunks = [];

  const extractChunk = (node, parentName = null) => {
    const start = node.loc?.start?.line;
    const end = node.loc?.end?.line;
    if (!start || !end) return;

    const chunkContent = lines.slice(start - 1, end).join('\n');

    let symbolName = null;
    let symbolType = 'unknown';

    switch (node.type) {
      case 'FunctionDeclaration':
        symbolName = node.id?.name;
        symbolType = 'function';
        break;
      case 'ClassDeclaration':
        symbolName = node.id?.name;
        symbolType = 'class';
        break;
      case 'ClassMethod':
      case 'ObjectMethod':
        symbolName = node.key?.name || node.key?.value;
        symbolType = 'method';
        if (parentName) symbolName = `${parentName}.${symbolName}`;
        break;
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        symbolType = 'function';
        break;
      case 'ExportDefaultDeclaration':
        symbolType = 'export';
        symbolName = 'default';
        break;
      case 'ExportNamedDeclaration':
        symbolType = 'export';
        symbolName = node.declaration?.id?.name || 'named';
        break;
    }

    chunks.push({
      filePath,
      language: 'javascript',
      symbolName,
      symbolType,
      parentSymbol: parentName,
      startLine: start,
      endLine: end,
      content: chunkContent,
    });
  };

  const traverse = (node, parentName = null) => {
    if (!node || typeof node !== 'object') return;

    if (SUPPORTED_TYPES.has(node.type)) {
      const currentName =
        node.id?.name ||
        (node.type === 'ClassMethod' || node.type === 'ObjectMethod'
          ? node.key?.name
          : null);
      extractChunk(node, parentName);

      // Recurse into class bodies
      if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        node.body?.body?.forEach((child) => traverse(child, currentName));
        return;
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((c) => traverse(c, parentName));
      } else if (child && typeof child === 'object' && child.type) {
        traverse(child, parentName);
      }
    }
  };

  ast.program.body.forEach((node) => traverse(node));

  // If no chunks extracted, return the whole file as one chunk
  if (chunks.length === 0) {
    return [{
      filePath,
      language: 'javascript',
      symbolName: filePath.split('/').pop(),
      symbolType: 'file',
      parentSymbol: null,
      startLine: 1,
      endLine: lines.length,
      content,
    }];
  }

  return chunks;
};

module.exports = { parseJavaScript };
