#!/usr/bin/env node
/**
 * UB-Mode Metrics Lever (Zero external dependencies, pure Node ESM)
 *
 * Scans backend/src/**\/*.ts and reports:
 * 1. Top functions by Cyclomatic Complexity (CC)
 *    Counts: if, for, while, do, case, catch, ?, &&, ||, ??
 * 2. Duplicate function/handler pairs (5-token normalized shingle Jaccard >= 0.80, >= 15 lines)
 *
 * Usage:
 *   node backend/scripts/check-ub-metrics.mjs [--strict] [--max-cc=20] [--dry-threshold=0.80] [--top=20] [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SRC_DIR = path.resolve(__dirname, '../src');

const KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends',
  'false', 'finally', 'for', 'from', 'function', 'if', 'implements', 'import',
  'in', 'instanceof', 'interface', 'let', 'new', 'null', 'of', 'package',
  'private', 'protected', 'public', 'return', 'static', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'var',
  'void', 'while', 'with', 'yield', 'as', 'satisfies', 'keyof', 'readonly',
]);

const CONTROL_HEADERS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'with',
]);

const CC_KEYWORDS = new Set(['if', 'for', 'while', 'do', 'case', 'catch']);
const CC_OPS = new Set(['&&', '||', '??']);

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'throw', 'case', 'in', 'instanceof', 'typeof', 'void', 'delete',
  'new', 'yield', 'await', 'else', 'do',
]);

const REGEX_PRECEDING_PUNCT = new Set([
  '(', '[', '{', ',', ';', ':', '=', '!', '&', '|', '?', '~', '^',
  '+', '-', '*', '/', '%', '<', '>', '=>', '&&', '||', '??', '==', '!=',
  '===', '!==', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '??=', '&&=', '||=',
]);

function collectTsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results.sort();
}

function canStartRegex(prevToken) {
  if (!prevToken) return true;
  if (prevToken.type === 'kw') return REGEX_PRECEDING_KEYWORDS.has(prevToken.value);
  if (prevToken.type === 'punct') return REGEX_PRECEDING_PUNCT.has(prevToken.value);
  return false;
}

function tokenize(source) {
  const tokens = [];
  const len = source.length;
  let i = 0;
  let line = 1;
  const templateStack = [];

  const pushTok = (type, value, tokLine, startPos) => {
    tokens.push({ type, value, line: tokLine, pos: startPos });
  };

  const scanTemplateSegment = (startLine, startPos, isHead) => {
    let buf = '';
    while (i < len) {
      const ch = source[i];
      if (ch === '`') {
        i++;
        pushTok('tpl', isHead ? `\`${buf}\`` : `}${buf}\``, startLine, startPos);
        return;
      }
      if (ch === '\\') {
        buf += ch;
        i++;
        if (i < len) {
          if (source[i] === '\n') line++;
          buf += source[i];
          i++;
        }
        continue;
      }
      if (ch === '$' && source[i + 1] === '{') {
        i += 2;
        pushTok('tpl', isHead ? `\`${buf}\${` : `}${buf}\${`, startLine, startPos);
        templateStack.push({ braceDepth: 0 });
        return;
      }
      if (ch === '\n') line++;
      buf += ch;
      i++;
    }
    pushTok('tpl', buf, startLine, startPos);
  };

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }

    // Line comment
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') i++;
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }

    // Template literal continuation when closing ${ ... }
    if (ch === '}' && templateStack.length > 0) {
      const top = templateStack[templateStack.length - 1];
      if (top.braceDepth === 0) {
        const startLine = line;
        const startPos = i;
        templateStack.pop();
        i++; // consume }
        scanTemplateSegment(startLine, startPos, false);
        continue;
      }
      top.braceDepth--;
    } else if (ch === '{' && templateStack.length > 0) {
      templateStack[templateStack.length - 1].braceDepth++;
    }

    // String literals
    if (ch === '\'' || ch === '"') {
      const quote = ch;
      const startLine = line;
      const startPos = i;
      i++;
      let val = quote;
      while (i < len) {
        const c = source[i];
        val += c;
        if (c === '\\') {
          i++;
          if (i < len) {
            if (source[i] === '\n') line++;
            val += source[i];
            i++;
          }
          continue;
        }
        if (c === '\n') line++;
        i++;
        if (c === quote) break;
      }
      pushTok('str', val, startLine, startPos);
      continue;
    }

    // Template literal start
    if (ch === '`') {
      const startLine = line;
      const startPos = i;
      i++;
      scanTemplateSegment(startLine, startPos, true);
      continue;
    }

    // Regex literal
    if (ch === '/' && canStartRegex(tokens[tokens.length - 1])) {
      const startLine = line;
      const startPos = i;
      i++;
      let inClass = false;
      let val = '/';
      while (i < len) {
        const c = source[i];
        if (c === '\n') break;
        val += c;
        if (c === '\\') {
          i++;
          if (i < len && source[i] !== '\n') {
            val += source[i];
            i++;
          }
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
          i++;
          while (i < len && /[a-zA-Z]/.test(source[i])) {
            val += source[i];
            i++;
          }
          break;
        }
        i++;
      }
      pushTok('regex', val, startLine, startPos);
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next || ''))) {
      const startLine = line;
      const startPos = i;
      let val = '';
      while (i < len && /[0-9a-fA-FxXoObBn._]/.test(source[i])) {
        val += source[i];
        i++;
      }
      pushTok('num', val, startLine, startPos);
      continue;
    }

    // Identifiers & keywords
    if (/[a-zA-Z_$]/.test(ch)) {
      const startLine = line;
      const startPos = i;
      let val = '';
      while (i < len && /[a-zA-Z0-9_$]/.test(source[i])) {
        val += source[i];
        i++;
      }
      pushTok(KEYWORDS.has(val) ? 'kw' : 'id', val, startLine, startPos);
      continue;
    }

    // Multi-char punctuation
    const three = source.slice(i, i + 3);
    const two = source.slice(i, i + 2);
    const startLine = line;
    const startPos = i;
    if (['===', '!==', '...', '??=', '&&=', '||=', '>>>'].includes(three)) {
      pushTok('punct', three, startLine, startPos);
      i += 3;
      continue;
    }
    if ([
      '=>', '?.', '??', '&&', '||', '==', '!=', '<=', '>=',
      '++', '--', '+=', '-=', '*=', '/=', '%=', '<<', '>>', '::',
    ].includes(two)) {
      pushTok('punct', two, startLine, startPos);
      i += 2;
      continue;
    }

    pushTok('punct', ch, startLine, startPos);
    i++;
  }

  return tokens;
}

function findMatching(tokens, openIdx, openChar, closeChar) {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    const v = tokens[i].value;
    if (v === openChar) depth++;
    else if (v === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipTypeAnnotationAfterParen(tokens, closeParenIdx) {
  let j = closeParenIdx + 1;
  if (j >= tokens.length || tokens[j].value !== ':') return closeParenIdx;
  j++;
  let angle = 0;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  while (j < tokens.length) {
    const t = tokens[j];
    if (angle === 0 && paren === 0 && brace === 0 && bracket === 0) {
      if (t.value === '=>' || t.value === '{') return j - 1;
    }
    if (t.value === '<') angle++;
    else if (t.value === '>' && angle > 0) angle--;
    else if (t.value === '(') paren++;
    else if (t.value === ')') paren--;
    else if (t.value === '{') brace++;
    else if (t.value === '}') brace--;
    else if (t.value === '[') bracket++;
    else if (t.value === ']') bracket--;
    j++;
  }
  return j - 1;
}

function inferRouteOrVarName(tokens, arrowStartIdx) {
  // Check for `const/let/var foo = ...`
  let k = arrowStartIdx - 1;
  if (k >= 0 && tokens[k].value === 'async') k--;
  if (k >= 1 && tokens[k].value === '=' && tokens[k - 1].type === 'id') {
    return tokens[k - 1].value;
  }
  // Check for `foo: async (...) =>`
  if (k >= 1 && tokens[k].value === ':' && tokens[k - 1].type === 'id') {
    return tokens[k - 1].value;
  }
  // Check for `router.post('/path', ..., async (c) =>`
  let parenDepth = 0;
  for (let j = arrowStartIdx - 1; j >= Math.max(0, arrowStartIdx - 40); j--) {
    const v = tokens[j].value;
    if (v === ')') parenDepth++;
    else if (v === '(') {
      if (parenDepth === 0) {
        // Check token before '('
        const methodTok = tokens[j - 1];
        const dotTok = tokens[j - 2];
        const objTok = tokens[j - 3];
        if (methodTok && dotTok?.value === '.' && objTok?.type === 'id') {
          const argTok = tokens[j + 1];
          const routeStr = argTok?.type === 'str' ? ` ${argTok.value}` : '';
          return `${objTok.value}.${methodTok.value}(${routeStr.trim()})`;
        }
        break;
      }
      parenDepth--;
    }
  }
  return null;
}

function extractFunctions(tokens, filePath) {
  const functions = [];
  const blockRanges = new Map(); // openBraceIdx -> fnMeta

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // 1. `function [name](...) { ... }`
    if (t.type === 'kw' && t.value === 'function') {
      let j = i + 1;
      if (tokens[j]?.value === '*') j++;
      let name = '<anonymous>';
      if (tokens[j]?.type === 'id') {
        name = tokens[j].value;
        j++;
      }
      // skip generic <T>
      if (tokens[j]?.value === '<') {
        let g = 1;
        j++;
        while (j < tokens.length && g > 0) {
          if (tokens[j].value === '<') g++;
          else if (tokens[j].value === '>') g--;
          j++;
        }
      }
      if (tokens[j]?.value === '(') {
        const closeParen = findMatching(tokens, j, '(', ')');
        if (closeParen !== -1) {
          const afterType = skipTypeAnnotationAfterParen(tokens, closeParen);
          const bodyOpen = afterType + 1;
          if (tokens[bodyOpen]?.value === '{') {
            const bodyClose = findMatching(tokens, bodyOpen, '{', '}');
            if (bodyClose !== -1) {
              const fn = {
                file: filePath,
                name,
                startLine: t.line,
                endLine: tokens[bodyClose].line,
                openIdx: bodyOpen,
                closeIdx: bodyClose,
              };
              functions.push(fn);
              blockRanges.set(bodyOpen, fn);
              i = bodyOpen;
              continue;
            }
          }
        }
      }
    }

    // 2. Arrow function `=> { ... }`
    if (t.type === 'punct' && t.value === '=>') {
      if (tokens[i + 1]?.value === '{') {
        const bodyOpen = i + 1;
        const bodyClose = findMatching(tokens, bodyOpen, '{', '}');
        if (bodyClose !== -1) {
          // Walk backward to find param start for naming
          let paramStart = i - 1;
          // Might have return type annotation before =>
          // Search backward for matching ')' if preceding token isn't ')' or id
          let k = i - 1;
          while (k >= 0 && ![';', '{', '}', ','].includes(tokens[k].value)) {
            if (tokens[k].value === ')') {
              // check if this ')' closes param list
              let depth = 1;
              let p = k - 1;
              while (p >= 0 && depth > 0) {
                if (tokens[p].value === ')') depth++;
                else if (tokens[p].value === '(') depth--;
                p--;
              }
              paramStart = p + 1;
              break;
            }
            if (tokens[k].type === 'id' && k === i - 1) {
              paramStart = k;
              break;
            }
            k--;
          }
          const inferred = inferRouteOrVarName(tokens, paramStart);
          const name = inferred || `<arrow@${tokens[i].line}>`;
          const fn = {
            file: filePath,
            name,
            startLine: tokens[paramStart]?.line ?? t.line,
            endLine: tokens[bodyClose].line,
            openIdx: bodyOpen,
            closeIdx: bodyClose,
          };
          functions.push(fn);
          blockRanges.set(bodyOpen, fn);
          i = bodyOpen;
          continue;
        }
      }
    }

    // 3. Class / object method: `name(...) { ... }`
    if (
      (t.type === 'id' || (t.type === 'kw' && !CONTROL_HEADERS.has(t.value) && t.value !== 'return' && t.value !== 'throw' && t.value !== 'new')) &&
      tokens[i + 1]?.value === '(' &&
      i > 0 &&
      ['{', ';', '}', ',', 'async', 'static', 'public', 'private', 'protected', 'readonly'].includes(tokens[i - 1].value)
    ) {
      const closeParen = findMatching(tokens, i + 1, '(', ')');
      if (closeParen !== -1) {
        const afterType = skipTypeAnnotationAfterParen(tokens, closeParen);
        const bodyOpen = afterType + 1;
        if (tokens[bodyOpen]?.value === '{') {
          const bodyClose = findMatching(tokens, bodyOpen, '{', '}');
          if (bodyClose !== -1) {
            const fn = {
              file: filePath,
              name: t.value,
              startLine: t.line,
              endLine: tokens[bodyClose].line,
              openIdx: bodyOpen,
              closeIdx: bodyClose,
            };
            functions.push(fn);
            blockRanges.set(bodyOpen, fn);
            i = bodyOpen;
            continue;
          }
        }
      }
    }
  }

  return { functions, blockRanges };
}

function computeFunctionMetrics(tokens, fn, blockRanges) {
  let cc = 1;
  const normTokens = [];

  for (let i = fn.openIdx + 1; i < fn.closeIdx; i++) {
    // Skip nested block-bodied functions so each function owns its own CC & DRY tokens
    const nested = blockRanges.get(i);
    if (nested && nested !== fn) {
      i = nested.closeIdx;
      continue;
    }

    const tok = tokens[i];
    if (tok.type === 'kw' && CC_KEYWORDS.has(tok.value)) {
      cc++;
    } else if (tok.type === 'punct' && CC_OPS.has(tok.value)) {
      cc++;
    } else if (tok.type === 'punct' && tok.value === '?' && tokens[i + 1]?.value !== ':') {
      cc++;
    }

    if (tok.type === 'id') normTokens.push('ID');
    else if (tok.type === 'str') normTokens.push('STR');
    else if (tok.type === 'num') normTokens.push('NUM');
    else if (tok.type === 'tpl') normTokens.push('TPL');
    else if (tok.type === 'regex') normTokens.push('RGX');
    else normTokens.push(tok.value);
  }

  const lines = fn.endLine - fn.startLine + 1;
  return { cc, normTokens, lines };
}

function buildShingles(normTokens, k = 5) {
  const set = new Set();
  if (normTokens.length < k) return set;
  for (let i = 0; i <= normTokens.length - k; i++) {
    set.add(`${normTokens[i]}\x00${normTokens[i + 1]}\x00${normTokens[i + 2]}\x00${normTokens[i + 3]}\x00${normTokens[i + 4]}`);
  }
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const s of small) {
    if (large.has(s)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function parseArgs(argv) {
  const opts = {
    strict: false,
    maxCc: 20,
    dryThreshold: 0.80,
    top: 20,
    json: false,
    srcDir: DEFAULT_SRC_DIR,
  };
  for (const arg of argv) {
    if (arg === '--strict') opts.strict = true;
    else if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--max-cc=')) opts.maxCc = Number(arg.split('=')[1]);
    else if (arg.startsWith('--dry-threshold=')) opts.dryThreshold = Number(arg.split('=')[1]);
    else if (arg.startsWith('--top=')) opts.top = Number(arg.split('=')[1]);
    else if (arg.startsWith('--src=')) opts.srcDir = path.resolve(arg.split('=')[1]);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = collectTsFiles(opts.srcDir);
  const allFunctions = [];

  for (const absPath of files) {
    const relPath = path.relative(path.resolve(opts.srcDir, '..'), absPath).replaceAll('\\', '/');
    const source = fs.readFileSync(absPath, 'utf8');
    const tokens = tokenize(source);
    const { functions, blockRanges } = extractFunctions(tokens, relPath);
    for (const fn of functions) {
      const { cc, normTokens, lines } = computeFunctionMetrics(tokens, fn, blockRanges);
      const shingles = lines >= 15 ? buildShingles(normTokens, 5) : null;
      allFunctions.push({
        file: fn.file,
        name: fn.name,
        startLine: fn.startLine,
        endLine: fn.endLine,
        lines,
        cc,
        shingles,
      });
    }
  }

  const byCc = [...allFunctions].sort((a, b) => b.cc - a.cc || b.lines - a.lines);
  const dryCandidates = allFunctions.filter((f) => f.lines >= 15 && f.shingles && f.shingles.size > 0);
  const dryPairs = [];

  for (let i = 0; i < dryCandidates.length; i++) {
    for (let j = i + 1; j < dryCandidates.length; j++) {
      const a = dryCandidates[i];
      const b = dryCandidates[j];
      const sim = jaccard(a.shingles, b.shingles);
      if (sim >= opts.dryThreshold) {
        dryPairs.push({
          similarity: Number(sim.toFixed(3)),
          a: { file: a.file, name: a.name, startLine: a.startLine, endLine: a.endLine, lines: a.lines },
          b: { file: b.file, name: b.name, startLine: b.startLine, endLine: b.endLine, lines: b.lines },
        });
      }
    }
  }
  dryPairs.sort((x, y) => y.similarity - x.similarity);

  const overThreshold = byCc.filter((f) => f.cc > opts.maxCc);
  const maxCc = byCc[0]?.cc ?? 0;

  if (opts.json) {
    console.log(JSON.stringify({
      filesScanned: files.length,
      functionsAnalyzed: allFunctions.length,
      maxCc,
      overMaxCcCount: overThreshold.length,
      maxCcThreshold: opts.maxCc,
      dryPairsCount: dryPairs.length,
      dryThreshold: opts.dryThreshold,
      topFunctions: byCc.slice(0, opts.top).map(({ shingles: _s, ...rest }) => rest),
      dryPairs,
    }, null, 2));
  } else {
    console.log(`UB-Mode Metrics Report (${files.length} files, ${allFunctions.length} functions)`);
    console.log(`Max CC: ${maxCc} | Functions > ${opts.maxCc}: ${overThreshold.length} | DRY >= ${opts.dryThreshold.toFixed(2)} pairs: ${dryPairs.length}`);
    console.log(`\nTop ${Math.min(opts.top, byCc.length)} Functions by Cyclomatic Complexity:`);
    for (const fn of byCc.slice(0, opts.top)) {
      const flag = fn.cc > opts.maxCc ? ' [OVER]' : '';
      console.log(`  CC ${String(fn.cc).padStart(3)} | ${String(fn.lines).padStart(4)}L | ${fn.file}:${fn.startLine} ${fn.name}${flag}`);
    }
    console.log(`\nDRY >= ${opts.dryThreshold.toFixed(2)} Pairs (${dryPairs.length}):`);
    if (dryPairs.length === 0) {
      console.log('  None');
    } else {
      for (const pair of dryPairs) {
        console.log(
          `  DRY ${pair.similarity.toFixed(3)} | ${pair.a.file}:${pair.a.startLine} ${pair.a.name} (${pair.a.lines}L) <-> ${pair.b.file}:${pair.b.startLine} ${pair.b.name} (${pair.b.lines}L)`
        );
      }
    }
  }

  if (opts.strict && (overThreshold.length > 0 || dryPairs.length > 0)) {
    process.exitCode = 1;
  }
}

main();
