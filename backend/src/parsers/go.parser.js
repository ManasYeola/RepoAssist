/**
 * Go code-aware parser using regex-based structural analysis.
 * Extracts: functions, methods (with receiver), structs, interfaces, and type aliases.
 */

/**
 * Parse Go source into semantic code chunks.
 * @param {string} content - Source file content
 * @param {string} filePath - Relative file path
 * @returns {Array} Array of code chunk objects
 */
const parseGo = (content, filePath) => {
  const lines = content.split('\n');
  const chunks = [];

  // Go structural patterns
  const FUNC_PATTERN  = /^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(/;
  const STRUCT_PATTERN = /^type\s+(\w+)\s+struct\s*\{/;
  const IFACE_PATTERN  = /^type\s+(\w+)\s+interface\s*\{/;
  const TYPE_PATTERN   = /^type\s+(\w+)\s+/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const funcMatch = FUNC_PATTERN.exec(line);
    if (funcMatch) {
      const receiver = funcMatch[2] || null;   // struct the method belongs to
      const name = funcMatch[3];
      const fullName = receiver ? `${receiver}.${name}` : name;
      const endLine = findBraceEnd(lines, i);

      chunks.push({
        filePath,
        language: 'go',
        symbolName: fullName,
        symbolType: receiver ? 'method' : 'function',
        parentSymbol: receiver || null,
        startLine: i + 1,
        endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      continue;
    }

    const structMatch = STRUCT_PATTERN.exec(line);
    if (structMatch) {
      const name = structMatch[1];
      const endLine = findBraceEnd(lines, i);
      chunks.push({
        filePath,
        language: 'go',
        symbolName: name,
        symbolType: 'struct',
        parentSymbol: null,
        startLine: i + 1,
        endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      continue;
    }

    const ifaceMatch = IFACE_PATTERN.exec(line);
    if (ifaceMatch) {
      const name = ifaceMatch[1];
      const endLine = findBraceEnd(lines, i);
      chunks.push({
        filePath,
        language: 'go',
        symbolName: name,
        symbolType: 'interface',
        parentSymbol: null,
        startLine: i + 1,
        endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      continue;
    }

    const typeMatch = TYPE_PATTERN.exec(line);
    if (typeMatch && !STRUCT_PATTERN.test(line) && !IFACE_PATTERN.test(line)) {
      const name = typeMatch[1];
      chunks.push({
        filePath,
        language: 'go',
        symbolName: name,
        symbolType: 'type',
        parentSymbol: null,
        startLine: i + 1,
        endLine: i + 1,
        content: line,
      });
    }
  }

  if (chunks.length === 0) {
    return [{
      filePath,
      language: 'go',
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

/**
 * Find the closing brace matching the opening brace on the start line.
 * Returns the 1-indexed line number of the closing brace (inclusive).
 */
const findBraceEnd = (lines, startIndex) => {
  let depth = 0;
  for (let i = startIndex; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return Math.min(i + 1, lines.length);
      }
    }
  }
  return lines.length;
};

module.exports = { parseGo };
