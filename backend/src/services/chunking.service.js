const { parseJavaScript } = require('../parsers/javascript.parser');
const { parseTypeScript } = require('../parsers/typescript.parser');
const { parsePython }     = require('../parsers/python.parser');
const { parseJava }       = require('../parsers/java.parser');
const { parseGo }         = require('../parsers/go.parser');
const { parseRust }       = require('../parsers/rust.parser');
const { parseCpp }        = require('../parsers/cpp.parser');
const { parseCSharp }     = require('../parsers/csharp.parser');
const { parseRuby }       = require('../parsers/ruby.parser');
const { parseFallback }   = require('../parsers/fallback.parser');

/**
 * File extension → language mapping
 */
const EXTENSION_MAP = {
  '.js':   'javascript',
  '.jsx':  'javascript',
  '.mjs':  'javascript',
  '.cjs':  'javascript',
  '.ts':   'typescript',
  '.tsx':  'typescript',
  '.py':   'python',
  '.java': 'java',
  '.go':   'go',
  '.cpp':  'cpp',
  '.cc':   'cpp',
  '.cxx':  'cpp',
  '.hpp':  'cpp',
  '.hxx':  'cpp',
  '.c':    'c',
  '.h':    'c',
  '.cs':   'csharp',
  '.rb':   'ruby',
  '.rs':   'rust',
  '.php':  'php',
  '.swift': 'swift',
  '.kt':   'kotlin',
  '.kts':  'kotlin',
  '.md':   'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml':  'yaml',
};

/**
 * Files to skip entirely during indexing
 */
const SKIP_PATTERNS = [
  /node_modules\//,
  /\.git\//,
  /dist\//,
  /build\//,
  /\.next\//,
  /coverage\//,
  /\.cache\//,
  /vendor\//,
  /target\//,          // Rust build dir
  /\.gradle\//,        // Java/Kotlin Gradle cache
  /\.min\.(js|css)$/,
  /\.bundle\.(js|css)$/,
  /\.d\.ts$/,
  /\.map$/,
  /\.vscode\//,
  /\.idea\//,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /Cargo\.lock$/,      // Rust lockfile
  /Gemfile\.lock$/,    // Ruby lockfile
];

/**
 * Maximum file size to index (150KB)
 */
const MAX_FILE_SIZE = 150 * 1024;

/**
 * Detect language from file path extension.
 */
const detectLanguage = (filePath) => {
  const ext = '.' + filePath.split('.').pop().toLowerCase();
  return EXTENSION_MAP[ext] || 'unknown';
};

/**
 * Check if a file path should be skipped.
 */
const shouldSkipFile = (filePath) => {
  return SKIP_PATTERNS.some((pattern) => pattern.test(filePath));
};

/**
 * Route file content to appropriate language parser and return code chunks.
 *
 * Language coverage:
 *   Full AST-aware:  JavaScript, TypeScript, Python, Java, Go, Rust, C/C++, C#, Ruby
 *   Fallback window: PHP, Swift, Kotlin, Markdown, and all other text-like files
 *
 * @param {string} content - File content
 * @param {string} filePath - Relative file path
 * @returns {Array} Normalized code chunks
 */
const chunkFile = (content, filePath) => {
  if (shouldSkipFile(filePath)) return [];
  if (content.length > MAX_FILE_SIZE) return [];

  const language = detectLanguage(filePath);

  try {
    switch (language) {
      case 'javascript':
        return parseJavaScript(content, filePath);
      case 'typescript':
        return parseTypeScript(content, filePath);
      case 'python':
        return parsePython(content, filePath);
      case 'java':
        return parseJava(content, filePath);
      case 'go':
        return parseGo(content, filePath);
      case 'rust':
        return parseRust(content, filePath);
      case 'cpp':
        return parseCpp(content, filePath, 'cpp');
      case 'c':
        return parseCpp(content, filePath, 'c');  // C parser reuses cpp parser
      case 'csharp':
        return parseCSharp(content, filePath);
      case 'ruby':
        return parseRuby(content, filePath);
      default:
        // Fallback line-window chunker for PHP, Swift, Kotlin, Markdown, etc.
        if (['php', 'swift', 'kotlin', 'markdown', 'yaml', 'json', 'unknown'].includes(language)) {
          return parseFallback(content, filePath, language);
        }
        return [];
    }
  } catch (err) {
    console.warn(`[Chunking] Failed to parse ${filePath}:`, err.message);
    return parseFallback(content, filePath, language);
  }
};

module.exports = { chunkFile, detectLanguage, shouldSkipFile };
