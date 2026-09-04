/**
 * Python code-aware parser using regex-based structural analysis.
 * Extracts classes, functions, and methods via indentation + def/class keywords.
 * (tree-sitter is used if available, falls back to regex)
 */

/**
 * Parse Python source into semantic code chunks.
 * @param {string} content - Source file content
 * @param {string} filePath - Relative file path
 * @returns {Array} Array of code chunk objects
 */
const parsePython = (content, filePath) => {
  const lines = content.split('\n');
  const chunks = [];

  // Regex patterns for Python structures
  const CLASS_PATTERN = /^(\s*)class\s+(\w+)/;
  const FUNC_PATTERN = /^(\s*)(?:async\s+)?def\s+(\w+)/;
  const DECORATOR_PATTERN = /^(\s*)@\w+/;

  let i = 0;
  const classStack = []; // track { name, indent }

  while (i < lines.length) {
    const line = lines[i];

    const classMatch = CLASS_PATTERN.exec(line);
    const funcMatch = FUNC_PATTERN.exec(line);

    if (classMatch) {
      const indent = classMatch[1].length;
      const className = classMatch[2];

      // Pop class stack entries that are at same or deeper indent
      while (classStack.length > 0 && classStack[classStack.length - 1].indent >= indent) {
        classStack.pop();
      }

      const startLine = i + 1;
      const endLine = findBlockEnd(lines, i, indent);

      chunks.push({
        filePath,
        language: 'python',
        symbolName: className,
        symbolType: 'class',
        parentSymbol: classStack.length > 0 ? classStack[classStack.length - 1].name : null,
        startLine,
        endLine,
        content: lines.slice(i, endLine).join('\n'),
      });

      classStack.push({ name: className, indent });
      i++;
      continue;
    }

    if (funcMatch) {
      const indent = funcMatch[1].length;
      const funcName = funcMatch[2];

      // Pop class stack to find parent
      while (classStack.length > 0 && classStack[classStack.length - 1].indent >= indent) {
        classStack.pop();
      }

      // Find decorator start
      let decoratorStart = i;
      while (decoratorStart > 0 && DECORATOR_PATTERN.test(lines[decoratorStart - 1])) {
        decoratorStart--;
      }

      const parentClass = classStack.length > 0 ? classStack[classStack.length - 1].name : null;
      const startLine = decoratorStart + 1;
      const endLine = findBlockEnd(lines, i, indent);
      const fullName = parentClass ? `${parentClass}.${funcName}` : funcName;

      chunks.push({
        filePath,
        language: 'python',
        symbolName: fullName,
        symbolType: parentClass ? 'method' : 'function',
        parentSymbol: parentClass,
        startLine,
        endLine,
        content: lines.slice(decoratorStart, endLine).join('\n'),
      });
    }

    i++;
  }

  if (chunks.length === 0) {
    return [{
      filePath,
      language: 'python',
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
 * Find the end line of an indented block starting at lineIndex.
 * Returns a line number (1-indexed end, exclusive).
 */
const findBlockEnd = (lines, startIndex, baseIndent) => {
  let i = startIndex + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    const currentIndent = line.search(/\S/);
    if (currentIndent !== -1 && currentIndent <= baseIndent) {
      break;
    }
    i++;
  }
  return Math.min(i, lines.length);
};

module.exports = { parsePython };
