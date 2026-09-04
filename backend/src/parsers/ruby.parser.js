/**
 * Ruby code-aware parser using regex-based structural analysis.
 * Extracts: modules, classes, methods (def/end blocks), and constants.
 */

const parseRuby = (content, filePath) => {
  const lines = content.split('\n');
  const chunks = [];

  const CLASS_PATTERN  = /^(\s*)class\s+(\w+(?:::\w+)?)/;
  const MODULE_PATTERN = /^(\s*)module\s+(\w+(?:::\w+)?)/;
  const DEF_PATTERN    = /^(\s*)def\s+(?:self\.)?(\w+[?!]?)/;
  const END_PATTERN    = /^(\s*)end\s*$/;

  // Stack entries: { type, name, indent }
  const contextStack = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const classMatch = CLASS_PATTERN.exec(line);
    if (classMatch) {
      const indent = classMatch[1].length;
      const name = classMatch[2];
      // Pop stack for same or deeper indent
      while (contextStack.length > 0 && contextStack[contextStack.length - 1].indent >= indent) {
        contextStack.pop();
      }
      const parent = contextStack.length > 0 ? contextStack[contextStack.length - 1].name : null;
      const endLine = findRubyEnd(lines, i, indent);
      chunks.push({
        filePath, language: 'ruby',
        symbolName: name, symbolType: 'class',
        parentSymbol: parent, startLine: i + 1, endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      contextStack.push({ type: 'class', name, indent });
      continue;
    }

    const moduleMatch = MODULE_PATTERN.exec(line);
    if (moduleMatch) {
      const indent = moduleMatch[1].length;
      const name = moduleMatch[2];
      while (contextStack.length > 0 && contextStack[contextStack.length - 1].indent >= indent) {
        contextStack.pop();
      }
      const endLine = findRubyEnd(lines, i, indent);
      chunks.push({
        filePath, language: 'ruby',
        symbolName: name, symbolType: 'module',
        parentSymbol: null, startLine: i + 1, endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      contextStack.push({ type: 'module', name, indent });
      continue;
    }

    const defMatch = DEF_PATTERN.exec(line);
    if (defMatch) {
      const indent = defMatch[1].length;
      const name = defMatch[2];
      while (contextStack.length > 0 && contextStack[contextStack.length - 1].indent >= indent) {
        contextStack.pop();
      }
      const parent = contextStack.length > 0 ? contextStack[contextStack.length - 1].name : null;
      const endLine = findRubyEnd(lines, i, indent);
      const fullName = parent ? `${parent}#${name}` : name;
      chunks.push({
        filePath, language: 'ruby',
        symbolName: fullName, symbolType: parent ? 'method' : 'function',
        parentSymbol: parent, startLine: i + 1, endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
    }
  }

  if (chunks.length === 0) {
    return [{
      filePath, language: 'ruby',
      symbolName: filePath.split('/').pop(), symbolType: 'file',
      parentSymbol: null, startLine: 1, endLine: lines.length, content,
    }];
  }

  return chunks;
};

/**
 * Find the matching `end` for a Ruby block starting at startIndex.
 * Counts indented `do`, `def`, `class`, `module`, `if`, `unless`, etc. vs `end`.
 */
const findRubyEnd = (lines, startIndex, baseIndent) => {
  const BLOCK_START = /^\s*(?:def|class|module|if|unless|case|begin|do|for|while|until)\b/;
  let depth = 1;
  for (let i = startIndex + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (BLOCK_START.test(lines[i])) depth++;
    if (t === 'end' || t.startsWith('end ') || t.startsWith('end#')) {
      depth--;
      if (depth === 0) return Math.min(i + 1, lines.length);
    }
  }
  return lines.length;
};

module.exports = { parseRuby };
