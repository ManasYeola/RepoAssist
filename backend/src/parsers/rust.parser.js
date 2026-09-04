/**
 * Rust code-aware parser using regex-based structural analysis.
 * Extracts: functions, impl blocks (methods), structs, enums, traits, type aliases, and macros.
 */

/**
 * Parse Rust source into semantic code chunks.
 * @param {string} content - Source file content
 * @param {string} filePath - Relative file path
 * @returns {Array} Array of code chunk objects
 */
const parseRust = (content, filePath) => {
  const lines = content.split('\n');
  const chunks = [];

  // Rust structural patterns
  const FN_PATTERN    = /^(?:pub(?:\(\w+\))?\s+)?(?:async\s+)?fn\s+(\w+)/;
  const IMPL_PATTERN  = /^(?:pub\s+)?impl(?:<[^>]+>)?\s+(?:\w+\s+for\s+)?(\w+)/;
  const STRUCT_PATTERN = /^(?:pub(?:\(\w+\))?\s+)?struct\s+(\w+)/;
  const ENUM_PATTERN  = /^(?:pub(?:\(\w+\))?\s+)?enum\s+(\w+)/;
  const TRAIT_PATTERN = /^(?:pub(?:\(\w+\))?\s+)?trait\s+(\w+)/;
  const TYPE_PATTERN  = /^(?:pub(?:\(\w+\))?\s+)?type\s+(\w+)/;
  const MOD_PATTERN   = /^(?:pub\s+)?mod\s+(\w+)\s*\{/;
  const MACRO_PATTERN = /^macro_rules!\s+(\w+)/;
  const ATTR_PATTERN  = /^#\[/;

  let i = 0;
  let implContext = null; // current impl block name

  while (i < lines.length) {
    const line = lines[i].trimEnd();

    // Track impl context so methods know their parent type
    const implMatch = IMPL_PATTERN.exec(line);
    if (implMatch && line.endsWith('{')) {
      implContext = implMatch[1];
      i++;
      continue;
    }

    const fnMatch = FN_PATTERN.exec(line);
    if (fnMatch) {
      const name = fnMatch[1];

      // Collect preceding attribute lines (#[...])
      let attrStart = i;
      while (attrStart > 0 && ATTR_PATTERN.test(lines[attrStart - 1])) {
        attrStart--;
      }

      const endLine = findBraceEnd(lines, i);
      chunks.push({
        filePath,
        language: 'rust',
        symbolName: implContext ? `${implContext}::${name}` : name,
        symbolType: implContext ? 'method' : 'function',
        parentSymbol: implContext || null,
        startLine: attrStart + 1,
        endLine,
        content: lines.slice(attrStart, endLine).join('\n'),
      });
      i = endLine;
      continue;
    }

    const structMatch = STRUCT_PATTERN.exec(line);
    if (structMatch) {
      const name = structMatch[1];
      const endLine = line.endsWith(';') ? i + 1 : findBraceEnd(lines, i);
      chunks.push({
        filePath,
        language: 'rust',
        symbolName: name,
        symbolType: 'struct',
        parentSymbol: null,
        startLine: i + 1,
        endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      implContext = null;
      i = endLine;
      continue;
    }

    const enumMatch = ENUM_PATTERN.exec(line);
    if (enumMatch) {
      const name = enumMatch[1];
      const endLine = findBraceEnd(lines, i);
      chunks.push({
        filePath,
        language: 'rust',
        symbolName: name,
        symbolType: 'enum',
        parentSymbol: null,
        startLine: i + 1,
        endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      implContext = null;
      i = endLine;
      continue;
    }

    const traitMatch = TRAIT_PATTERN.exec(line);
    if (traitMatch) {
      const name = traitMatch[1];
      const endLine = findBraceEnd(lines, i);
      chunks.push({
        filePath,
        language: 'rust',
        symbolName: name,
        symbolType: 'trait',
        parentSymbol: null,
        startLine: i + 1,
        endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      i = endLine;
      continue;
    }

    const macroMatch = MACRO_PATTERN.exec(line);
    if (macroMatch) {
      const name = macroMatch[1];
      const endLine = findBraceEnd(lines, i);
      chunks.push({
        filePath,
        language: 'rust',
        symbolName: name,
        symbolType: 'macro',
        parentSymbol: null,
        startLine: i + 1,
        endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      i = endLine;
      continue;
    }

    // Reset impl context when we see a closing brace at column 0
    if (line === '}') {
      implContext = null;
    }

    i++;
  }

  if (chunks.length === 0) {
    return [{
      filePath,
      language: 'rust',
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

module.exports = { parseRust };
