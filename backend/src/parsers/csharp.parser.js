/**
 * C# code-aware parser using regex-based structural analysis.
 * Extracts: classes, interfaces, enums, structs, records, methods, properties, and namespaces.
 */

const parseCSharp = (content, filePath) => {
  const lines = content.split('\n');
  const chunks = [];

  const CLASS_PATTERN     = /^\s*(?:public|private|protected|internal|static|abstract|sealed|partial|\s)*(?:class|record)\s+(\w+)/;
  const INTERFACE_PATTERN = /^\s*(?:public|private|protected|internal|\s)*interface\s+(\w+)/;
  const STRUCT_PATTERN    = /^\s*(?:public|private|protected|internal|readonly|\s)*struct\s+(\w+)/;
  const ENUM_PATTERN      = /^\s*(?:public|private|protected|internal|\s)*enum\s+(\w+)/;
  const NAMESPACE_PATTERN = /^\s*namespace\s+([\w.]+)/;
  const METHOD_PATTERN    = /^\s*(?:public|private|protected|internal|static|virtual|override|async|abstract|\s)*(?:[\w<>\[\]?]+\s+)+(\w+)\s*\([^;]*$/;
  const PROP_PATTERN      = /^\s*(?:public|private|protected|internal|static|virtual|override|\s)*(?:[\w<>\[\]?]+\s+)+(\w+)\s*\{/;
  const ATTR_PATTERN      = /^\s*\[/;

  let classStack = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const nsMatch = NAMESPACE_PATTERN.exec(line);
    if (nsMatch && line.trim().endsWith('{')) {
      const name = nsMatch[1];
      const endLine = findBraceEnd(lines, i);
      chunks.push({
        filePath, language: 'csharp',
        symbolName: name, symbolType: 'namespace',
        parentSymbol: null, startLine: i + 1, endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      i++;
      continue;
    }

    const classMatch = CLASS_PATTERN.exec(line);
    if (classMatch && (line.includes('{') || hasBraceAhead(lines, i))) {
      const name = classMatch[1];
      const parent = classStack.length > 0 ? classStack[classStack.length - 1] : null;
      const endLine = findBraceEnd(lines, i);
      chunks.push({
        filePath, language: 'csharp',
        symbolName: name, symbolType: 'class',
        parentSymbol: parent, startLine: i + 1, endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      classStack.push(name);
      i++;
      continue;
    }

    const ifaceMatch = INTERFACE_PATTERN.exec(line);
    if (ifaceMatch && (line.includes('{') || hasBraceAhead(lines, i))) {
      const name = ifaceMatch[1];
      const endLine = findBraceEnd(lines, i);
      chunks.push({
        filePath, language: 'csharp',
        symbolName: name, symbolType: 'interface',
        parentSymbol: null, startLine: i + 1, endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      i++;
      continue;
    }

    const enumMatch = ENUM_PATTERN.exec(line);
    if (enumMatch) {
      const name = enumMatch[1];
      const endLine = findBraceEnd(lines, i);
      chunks.push({
        filePath, language: 'csharp',
        symbolName: name, symbolType: 'enum',
        parentSymbol: null, startLine: i + 1, endLine,
        content: lines.slice(i, endLine).join('\n'),
      });
      i = endLine;
      continue;
    }

    const methodMatch = METHOD_PATTERN.exec(line);
    if (methodMatch && !line.trim().startsWith('//') && !ATTR_PATTERN.test(line) && hasBraceAhead(lines, i)) {
      const name = methodMatch[1];
      const parent = classStack.length > 0 ? classStack[classStack.length - 1] : null;

      // Collect preceding attributes
      let attrStart = i;
      while (attrStart > 0 && ATTR_PATTERN.test(lines[attrStart - 1])) attrStart--;

      const endLine = findBraceEnd(lines, i);
      chunks.push({
        filePath, language: 'csharp',
        symbolName: parent ? `${parent}.${name}` : name,
        symbolType: 'method', parentSymbol: parent,
        startLine: attrStart + 1, endLine,
        content: lines.slice(attrStart, endLine).join('\n'),
      });
      i = endLine;
      continue;
    }

    if (line.trim() === '}' && classStack.length > 0) {
      classStack.pop();
    }
  }

  if (chunks.length === 0) {
    return [{
      filePath, language: 'csharp',
      symbolName: filePath.split('/').pop(), symbolType: 'file',
      parentSymbol: null, startLine: 1, endLine: lines.length, content,
    }];
  }

  return chunks;
};

const hasBraceAhead = (lines, startIndex) => {
  for (let i = startIndex; i < Math.min(startIndex + 4, lines.length); i++) {
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

module.exports = { parseCSharp };
