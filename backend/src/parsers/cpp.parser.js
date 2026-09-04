/**
 * C/C++ code-aware parser using regex-based structural analysis.
 * Extracts: functions, classes, structs, enums, namespaces, and template definitions.
 * Handles both C (.c, .h) and C++ (.cpp, .cc, .hpp) files.
 */

/**
 * Parse C/C++ source into semantic code chunks.
 * @param {string} content - Source file content
 * @param {string} filePath - Relative file path
 * @param {string} language - 'cpp' or 'c'
 * @returns {Array} Array of code chunk objects
 */
const parseCpp = (content, filePath, language = 'cpp') => {
  const lines = content.split('\n');
  const chunks = [];

  // C/C++ structural patterns
  const CLASS_PATTERN     = /^(?:template\s*<[^>]*>\s*)?(?:class|struct)\s+(\w+)(?:\s*:\s*(?:public|protected|private)\s+\w+)?(?:\s*)\{/;
  const NAMESPACE_PATTERN = /^namespace\s+(\w+)\s*\{/;
  const ENUM_PATTERN      = /^enum(?:\s+class)?\s+(\w+)/;
  const FUNC_PATTERN      = /^(?:(?:static|virtual|inline|explicit|constexpr|[[nodiscard\]]*)\s+)*(?:[\w:<>*&~\s]+?)\s+(?:(\w+)::)?(\w+)\s*\([^;]*$/;
  const TEMPLATE_PATTERN  = /^template\s*</;
  const TYPEDEF_PATTERN   = /^typedef\s+.+\s+(\w+)\s*;/;
  const USING_PATTERN     = /^using\s+(\w+)\s*=/;

  let i = 0;
  let classStack = []; // for tracking parent class context

  while (i < lines.length) {
    const line = lines[i].trimEnd();

    // Skip preprocessor directives, comments, empty lines
    if (line.startsWith('#') || line.startsWith('//') || line.startsWith('/*') || line.trim() === '') {
      i++;
      continue;
    }

    const classMatch = CLASS_PATTERN.exec(line);
    if (classMatch) {
      const name = classMatch[1];
      const endLine = findBraceEnd(lines, i);
      const parentClass = classStack.length > 0 ? classStack[classStack.length - 1] : null;

      chunks.push({
        filePath,
        language,
        symbolName: name,
        symbolType: 'class',
        parentSymbol: parentClass,
        startLine: i + 1,
        endLine,
        content: lines.slice(i, endLine).join('\n'),
      });

      classStack.push(name);
      i++;
      continue;
    }

    const nsMatch = NAMESPACE_PATTERN.exec(line);
    if (nsMatch) {
      const name = nsMatch[1];
      const endLine = findBraceEnd(lines, i);
      chunks.push({
        filePath,
        language,
        symbolName: name,
        symbolType: 'namespace',
        parentSymbol: null,
        startLine: i + 1,
        endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      i++;
      continue;
    }

    const enumMatch = ENUM_PATTERN.exec(line);
    if (enumMatch && line.includes('{')) {
      const name = enumMatch[1];
      const endLine = findBraceEnd(lines, i);
      chunks.push({
        filePath,
        language,
        symbolName: name,
        symbolType: 'enum',
        parentSymbol: null,
        startLine: i + 1,
        endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      i = endLine;
      continue;
    }

    // Function definition — heuristic: contains ( and { and is not a declaration (no semicolon after closing paren)
    const funcMatch = FUNC_PATTERN.exec(line);
    if (funcMatch && !line.endsWith(';') && (line.endsWith('{') || hasFuncBody(lines, i))) {
      const qualifier = funcMatch[1] || null;   // ClassName:: prefix
      const name = funcMatch[2];
      const parentClass = qualifier || (classStack.length > 0 ? classStack[classStack.length - 1] : null);
      const fullName = qualifier ? `${qualifier}::${name}` : name;
      const endLine = findBraceEnd(lines, i);

      chunks.push({
        filePath,
        language,
        symbolName: fullName,
        symbolType: parentClass ? 'method' : 'function',
        parentSymbol: parentClass,
        startLine: i + 1,
        endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      i = endLine;
      continue;
    }

    // Pop class context at closing brace (rough heuristic)
    if (line === '};' || line === '}') {
      if (classStack.length > 0) classStack.pop();
    }

    i++;
  }

  if (chunks.length === 0) {
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

  return chunks;
};

/** Check if a function body starts within a few lines (multi-line signature). */
const hasFuncBody = (lines, startIndex) => {
  for (let i = startIndex; i < Math.min(startIndex + 5, lines.length); i++) {
    if (lines[i].includes('{')) return true;
    if (lines[i].trim().endsWith(';')) return false;
  }
  return false;
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

module.exports = { parseCpp };
