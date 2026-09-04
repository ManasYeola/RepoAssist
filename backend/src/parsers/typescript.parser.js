const { parse } = require('@babel/parser');

/**
 * Parse TypeScript source code using Babel AST with TypeScript plugin.
 * Extends JS parser with interfaces, type aliases, and decorators.
 * @param {string} content - Source file content
 * @param {string} filePath - Relative file path
 * @returns {Array} Array of code chunk objects
 */
const parseTypeScript = (content, filePath) => {
  let ast;
  try {
    ast = parse(content, {
      sourceType: 'unambiguous',
      plugins: [
        'typescript',
        'jsx',
        'decorators-legacy',
        'classProperties',
        'optionalChaining',
        'nullishCoalescingOperator',
      ],
      errorRecovery: true,
    });
  } catch (err) {
    return [{
      filePath,
      language: 'typescript',
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

  const TS_TYPES = new Set([
    'FunctionDeclaration',
    'ClassDeclaration',
    'ClassMethod',
    'TSInterfaceDeclaration',
    'TSTypeAliasDeclaration',
    'TSEnumDeclaration',
    'ExportDefaultDeclaration',
    'ExportNamedDeclaration',
    'TSDeclareFunction',
  ]);

  const extractChunk = (node, parentName = null) => {
    const start = node.loc?.start?.line;
    const end = node.loc?.end?.line;
    if (!start || !end) return;

    const chunkContent = lines.slice(start - 1, end).join('\n');
    let symbolName = null;
    let symbolType = 'unknown';

    switch (node.type) {
      case 'FunctionDeclaration':
      case 'TSDeclareFunction':
        symbolName = node.id?.name;
        symbolType = 'function';
        break;
      case 'ClassDeclaration':
        symbolName = node.id?.name;
        symbolType = 'class';
        break;
      case 'ClassMethod':
        symbolName = node.key?.name;
        symbolType = 'method';
        if (parentName) symbolName = `${parentName}.${symbolName}`;
        break;
      case 'TSInterfaceDeclaration':
        symbolName = node.id?.name;
        symbolType = 'interface';
        break;
      case 'TSTypeAliasDeclaration':
        symbolName = node.id?.name;
        symbolType = 'type';
        break;
      case 'TSEnumDeclaration':
        symbolName = node.id?.name;
        symbolType = 'enum';
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
      language: 'typescript',
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

    if (TS_TYPES.has(node.type)) {
      const currentName = node.id?.name || null;
      extractChunk(node, parentName);

      if (node.type === 'ClassDeclaration') {
        node.body?.body?.forEach((child) => traverse(child, currentName));
        return;
      }
    }

    for (const key of Object.keys(node)) {
      if (['type', 'loc', 'start', 'end'].includes(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((c) => traverse(c, parentName));
      } else if (child && typeof child === 'object' && child.type) {
        traverse(child, parentName);
      }
    }
  };

  ast.program.body.forEach((node) => traverse(node));

  if (chunks.length === 0) {
    return [{
      filePath,
      language: 'typescript',
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

module.exports = { parseTypeScript };
