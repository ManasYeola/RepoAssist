/**
 * Java code-aware parser using regex-based structural analysis.
 * Extracts classes, interfaces, methods, and constructors.
 */

/**
 * Parse Java source into semantic code chunks.
 * @param {string} content - Source file content
 * @param {string} filePath - Relative file path
 * @returns {Array} Array of code chunk objects
 */
const parseJava = (content, filePath) => {
  const lines = content.split('\n');
  const chunks = [];

  // Patterns for Java structures
  const CLASS_PATTERN = /^\s*(?:public|private|protected|abstract|final|static)?\s*(?:class|interface|enum|record)\s+(\w+)/;
  const METHOD_PATTERN = /^\s*(?:public|private|protected|static|final|synchronized|abstract|native|default)[\s\w<>\[\]@]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+\w+(?:\s*,\s*\w+)*)?\s*\{/;
  const ANNOTATION_PATTERN = /^\s*@\w+/;

  const classStack = []; // { name, braceDepth }
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track brace depth
    for (const char of line) {
      if (char === '{') braceDepth++;
      else if (char === '}') {
        braceDepth--;
        if (classStack.length > 0 && braceDepth < classStack[classStack.length - 1].braceDepth) {
          classStack.pop();
        }
      }
    }

    const classMatch = CLASS_PATTERN.exec(line);
    if (classMatch) {
      const className = classMatch[1];
      const startLine = i + 1;
      const endLine = findJavaBlockEnd(lines, i);
      const symbolType = /\binterface\b/.test(line) ? 'interface' :
                         /\benum\b/.test(line) ? 'enum' : 'class';

      chunks.push({
        filePath,
        language: 'java',
        symbolName: className,
        symbolType,
        parentSymbol: classStack.length > 0 ? classStack[classStack.length - 1].name : null,
        startLine,
        endLine,
        content: lines.slice(i, endLine).join('\n'),
      });

      classStack.push({ name: className, braceDepth });
      continue;
    }

    const methodMatch = METHOD_PATTERN.exec(line);
    if (methodMatch && classStack.length > 0) {
      const methodName = methodMatch[1];
      const parentClass = classStack[classStack.length - 1].name;

      // Check for annotations above
      let annotationStart = i;
      while (annotationStart > 0 && ANNOTATION_PATTERN.test(lines[annotationStart - 1])) {
        annotationStart--;
      }

      const startLine = annotationStart + 1;
      const endLine = findJavaBlockEnd(lines, i);

      chunks.push({
        filePath,
        language: 'java',
        symbolName: `${parentClass}.${methodName}`,
        symbolType: methodName === parentClass ? 'constructor' : 'method',
        parentSymbol: parentClass,
        startLine,
        endLine,
        content: lines.slice(annotationStart, endLine).join('\n'),
      });
    }
  }

  if (chunks.length === 0) {
    return [{
      filePath,
      language: 'java',
      symbolName: filePath.split('/').pop().replace('.java', ''),
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
 * Find the end of a Java block by matching braces.
 */
const findJavaBlockEnd = (lines, startIndex) => {
  let depth = 0;
  let started = false;

  for (let i = startIndex; i < lines.length; i++) {
    for (const char of lines[i]) {
      if (char === '{') { depth++; started = true; }
      else if (char === '}') {
        depth--;
        if (started && depth === 0) return i + 1;
      }
    }
  }
  return lines.length;
};

module.exports = { parseJava };
