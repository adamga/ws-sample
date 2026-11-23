'use strict';

(function initChronicleMarkdown(globalScope) {
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  const LANGUAGE_ALIASES = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', javascript: 'javascript',
    ts: 'javascript', tsx: 'javascript', typescript: 'javascript',
    json: 'json', jsonc: 'json', jsonl: 'json',
    py: 'python', python: 'python',
    ps1: 'powershell', pwsh: 'powershell', powershell: 'powershell',
    sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
    html: 'xml', xml: 'xml', svg: 'xml',
    css: 'css',
    yml: 'yaml', yaml: 'yaml',
    md: 'markdown', markdown: 'markdown',
    sql: 'sql',
    cs: 'clike', csharp: 'clike', java: 'clike', go: 'clike', rust: 'clike', c: 'clike', cpp: 'clike',
    diff: 'diff', patch: 'diff'
  };

  const JS_KEYWORDS = new Set([
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
    'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for', 'from', 'function', 'get',
    'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'of', 'private',
    'protected', 'public', 'readonly', 'return', 'set', 'static', 'super', 'switch', 'this', 'throw',
    'try', 'type', 'typeof', 'var', 'void', 'while', 'with', 'yield'
  ]);
  const JS_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

  const PY_KEYWORDS = new Set([
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
    'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
    'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'
  ]);
  const PY_LITERALS = new Set(['True', 'False', 'None']);

  const SHELL_KEYWORDS = new Set([
    'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'until', 'case', 'esac',
    'function', 'return', 'local', 'export', 'unset', 'readonly', 'foreach', 'param', 'begin',
    'process', 'end', 'try', 'catch', 'finally', 'throw', 'switch', 'break', 'continue'
  ]);

  const SQL_KEYWORDS = new Set([
    'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create',
    'table', 'alter', 'drop', 'index', 'view', 'join', 'inner', 'left', 'right', 'full', 'outer',
    'on', 'as', 'and', 'or', 'not', 'null', 'is', 'in', 'exists', 'between', 'like', 'order', 'by',
    'group', 'having', 'limit', 'offset', 'union', 'all', 'distinct', 'primary', 'key', 'foreign',
    'references', 'default', 'constraint', 'begin', 'commit', 'rollback', 'with', 'case', 'when',
    'then', 'else', 'end', 'asc', 'desc', 'count', 'sum', 'avg', 'min', 'max'
  ]);

  const CLIKE_KEYWORDS = new Set([
    'abstract', 'async', 'await', 'bool', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
    'class', 'const', 'continue', 'default', 'defer', 'do', 'double', 'else', 'enum', 'extern',
    'false', 'final', 'finally', 'float', 'fn', 'for', 'func', 'go', 'if', 'impl', 'import', 'in',
    'int', 'interface', 'internal', 'let', 'long', 'loop', 'match', 'mod', 'mut', 'namespace',
    'new', 'nil', 'null', 'override', 'package', 'priv', 'private', 'protected', 'pub', 'public',
    ' ref', 'return', 'self', 'short', ' signed', 'static', 'string', 'struct', 'super', 'switch',
    'this', 'throw', 'throws', 'trait', 'true', 'try', 'type', 'unsafe', 'use', 'using', 'var',
    'virtual', 'void', 'where', 'while'
  ]);

  function normalizeLanguage(lang) {
    const key = String(lang || '').trim().toLowerCase();
    return LANGUAGE_ALIASES[key] || '';
  }

  function supportsLanguage(lang) {
    return Boolean(normalizeLanguage(lang));
  }

  function wrapToken(cls, raw) {
    return `<span class="hljs-${cls}">${escapeHtml(raw)}</span>`;
  }

  function highlightWithRegex(source, regex, classify) {
    let out = '';
    let last = 0;
    regex.lastIndex = 0;
    for (const match of source.matchAll(regex)) {
      if (match.index > last) out += escapeHtml(source.slice(last, match.index));
      const token = match[0];
      const cls = classify(match);
      out += cls ? wrapToken(cls, token) : escapeHtml(token);
      last = match.index + token.length;
    }
    if (last < source.length) out += escapeHtml(source.slice(last));
    return out;
  }

  function highlightCode(source, lang) {
    const text = String(source ?? '');
    const norm = normalizeLanguage(lang);
    if (!norm || text.length >= 100_000) return escapeHtml(text);

    if (norm === 'json') {
      const rx = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;
      return highlightWithRegex(text, rx, (m) => {
        if (m[1]) return 'comment';
        if (m[2]) {
          if (m[3]) return null; // handled specially below
          return 'string';
        }
        if (m[4]) return 'literal';
        if (m[5]) return 'number';
        return null;
      }).replace(/(&quot;(?:\\.|[^&]|&(?!quot;))*&quot;)(\s*:)/g, '<span class="hljs-attr">$1</span>$2');
    }

    if (norm === 'javascript') {
      const rx = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?n?)\b|\b([A-Za-z_$][\w$]*)\b(\s*\()?/g;
      let out = '';
      let last = 0;
      for (const m of text.matchAll(rx)) {
        if (m.index > last) out += escapeHtml(text.slice(last, m.index));
        if (m[1]) out += wrapToken('comment', m[1]);
        else if (m[2]) out += wrapToken('string', m[2]);
        else if (m[3]) out += wrapToken('number', m[3]);
        else if (m[4]) {
          const word = m[4];
          const suffix = m[5] || '';
          if (JS_KEYWORDS.has(word)) out += wrapToken('keyword', word) + escapeHtml(suffix);
          else if (JS_LITERALS.has(word)) out += wrapToken('literal', word) + escapeHtml(suffix);
          else if (suffix) out += wrapToken('title', word) + escapeHtml(suffix);
          else out += escapeHtml(m[0]);
        } else out += escapeHtml(m[0]);
        last = m.index + m[0].length;
      }
      if (last < text.length) out += escapeHtml(text.slice(last));
      return out;
    }

    if (norm === 'python') {
      const rx = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(@[A-Za-z_]\w*)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)\b/g;
      return highlightWithRegex(text, rx, (m) => {
        if (m[1]) return 'comment';
        if (m[2]) return 'string';
        if (m[3]) return 'attr';
        if (m[4]) return 'number';
        if (m[5]) {
          if (PY_KEYWORDS.has(m[5])) return 'keyword';
          if (PY_LITERALS.has(m[5])) return 'literal';
        }
        return null;
      });
    }

    if (norm === 'powershell' || norm === 'bash') {
      const rx = /(#[^\n]*)|("(?:\\.|`|[^"\\])*"|'[^']*')|(\$[A-Za-z_?][\w:]*|\$\{[^}]+\})|(\s-[A-Za-z][\w-]*)|\b([A-Za-z]+-[A-Za-z]\w*|[A-Za-z_]\w*)\b/g;
      return highlightWithRegex(text, rx, (m) => {
        if (m[1]) return 'comment';
        if (m[2]) return 'string';
        if (m[3]) return 'variable';
        if (m[4]) return 'attr';
        if (m[5]) {
          if (SHELL_KEYWORDS.has(m[5].toLowerCase())) return 'keyword';
          if (/^[A-Z][a-z]+-[A-Z]/.test(m[5])) return 'title';
        }
        return null;
      });
    }

    if (norm === 'xml') {
      const rx = /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][\w:-]*)|(\s[A-Za-z_:][\w:.-]*)(?=\s*=)|("(?:[^"])*"|'(?:[^'])*')|(\/?>)/g;
      return highlightWithRegex(text, rx, (m) => {
        if (m[1]) return 'comment';
        if (m[2] || m[5]) return 'keyword';
        if (m[3]) return 'attr';
        if (m[4]) return 'string';
        return null;
      });
    }

    if (norm === 'css') {
      const rx = /(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(@[A-Za-z-]+)|(--[\w-]+|[a-z-]+(?=\s*:))|(#[0-9a-fA-F]{3,8}\b|-?\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|dvh|%|s|ms|deg)?\b)/g;
      return highlightWithRegex(text, rx, (m) => {
        if (m[1]) return 'comment';
        if (m[2]) return 'string';
        if (m[3]) return 'keyword';
        if (m[4]) return 'attr';
        if (m[5]) return 'number';
        return null;
      });
    }

    if (norm === 'yaml') {
      const rx = /(#[^\n]*)|(^[\t ]*[A-Za-z0-9_.-]+(?=\s*:))|("(?:\\.|[^"\\\n])*"|'[^']*')|\b(true|false|null|yes|no)\b|(-?\b\d+(?:\.\d+)?\b)/gm;
      return highlightWithRegex(text, rx, (m) => {
        if (m[1]) return 'comment';
        if (m[2]) return 'attr';
        if (m[3]) return 'string';
        if (m[4]) return 'literal';
        if (m[5]) return 'number';
        return null;
      });
    }

    if (norm === 'sql') {
      const rx = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:''|[^'])*')|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)\b/g;
      return highlightWithRegex(text, rx, (m) => {
        if (m[1]) return 'comment';
        if (m[2]) return 'string';
        if (m[3]) return 'number';
        if (m[4] && SQL_KEYWORDS.has(m[4].toLowerCase())) return 'keyword';
        return null;
      });
    }

    if (norm === 'markdown') {
      const rx = /(^#{1,6}\s[^\n]*)|(`+[^`\n]+`+)|(\*\*[^*\n]+\*\*|\[[^\]]+\]\([^)]+\))/gm;
      return highlightWithRegex(text, rx, (m) => {
        if (m[1]) return 'title';
        if (m[2]) return 'string';
        if (m[3]) return 'keyword';
        return null;
      });
    }

    if (norm === 'diff') {
      const rx = /^(?:\+[^\n]*|-[^\n]*|@@[^\n]*)/gm;
      return highlightWithRegex(text, rx, (m) => {
        if (m[0].startsWith('+')) return 'string';
        if (m[0].startsWith('-')) return 'Deletion';
        return 'keyword';
      });
    }

    // clike fallback
    const rx = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)\b/g;
    return highlightWithRegex(text, rx, (m) => {
      if (m[1]) return 'comment';
      if (m[2]) return 'string';
      if (m[3]) return 'number';
      if (m[4] && CLIKE_KEYWORDS.has(m[4])) return 'keyword';
      return null;
    });
  }

  // Safe inline HTML tags allowed directly when authored in Markdown (e.g. <kbd>, <br>, <sub>, <sup>)
  const SAFE_INLINE_HTML = /^<(\/?)(br|kbd|sub|sup|mark|details|summary)\s*\/?>$/i;

  function parseInline(rawText) {
    const text = String(rawText ?? '');
    if (!text) return '';

    // 1. Protect inline code spans and safe inline HTML tags with null-delimited tokens
    const slots = [];
    const stash = (html) => {
      const id = `\x00S${slots.length}E\x00`;
      slots.push(html);
      return id;
    };

    let working = text.replace(/(`+)([\s\S]*?)\1/g, (_match, _ticks, code) => {
      const cleaned = code.startsWith(' ') && code.endsWith(' ') && code.trim() ? code.slice(1, -1) : code;
      return stash(`<code>${escapeHtml(cleaned)}</code>`);
    });

    // Autolinks <https://...>
    working = working.replace(/<(https?:\/\/[^\s<>]+)>/gi, (_m, url) => {
      const safeUrl = escapeHtml(url);
      return stash(`<a href="${safeUrl}">${safeUrl}</a>`);
    });

    // Safe inline HTML tags like <br>, <kbd>Ctrl</kbd>
    working = working.replace(/<\/?[A-Za-z][A-Za-z0-9-]*\s*\/?>/g, (tag) => {
      const m = SAFE_INLINE_HTML.exec(tag);
      if (!m) return tag;
      const slash = m[1] ? '/' : '';
      const name = m[2].toLowerCase();
      return stash(name === 'br' ? '<br>' : `<${slash}${name}>`);
    });

    // Escape all remaining raw HTML characters (& < > " ')
    working = escapeHtml(working);

    // 2. Images: ![alt](src "optional title")
    working = working.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_m, alt, src, title) => {
      if (!isSafeImgSrc(src)) return escapeHtml(alt);
      const titleAttr = title ? ` title="${title}"` : '';
      return stash(`<img src="${src}" alt="${alt}"${titleAttr}>`);
    });

    // 3. Links: [label](href "optional title")
    working = working.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_m, label, href, title) => {
      const inner = parseInlineFormatting(label);
      if (!isSafeHref(href)) return stash(`<a>${inner}</a>`);
      const titleAttr = title ? ` title="${title}"` : '';
      return stash(`<a href="${href}"${titleAttr}>${inner}</a>`);
    });

    // 4. Bare http/https URLs
    working = working.replace(/(^|[\s(])(https?:\/\/[^\s<)"']+)/g, (_m, lead, url) => {
      let cleanUrl = url;
      let trailing = '';
      while (/[.,;:!?]$/.test(cleanUrl)) {
        trailing = cleanUrl.slice(-1) + trailing;
        cleanUrl = cleanUrl.slice(0, -1);
      }
      return `${lead}${stash(`<a href="${cleanUrl}">${cleanUrl}</a>`)}${trailing}`;
    });

    working = parseInlineFormatting(working);

    // Restore stashed HTML fragments (supports nested stashes inside link labels)
    let safety = 0;
    while (working.includes('\x00S') && safety++ < 6) {
      working = working.replace(/\x00S(\d+)E\x00/g, (_m, idx) => slots[Number(idx)] ?? '');
    }
    return working;
  }

  function parseInlineFormatting(input) {
    let s = input;
    s = s.replace(/\*\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w])__([^\s_](?:[\s\S]*?[^\s_])?)__(?=[^\w]|$)/g, '$1<strong>$2</strong>');
    s = s.replace(/~~([^\s~](?:[\s\S]*?[^\s~])?)~~/g, '<del>$1</del>');
    s = s.replace(/\*([^\s*](?:[^*\n]*?[^\s*])?)\*/g, '<em>$1</em>');
    s = s.replace(/(^|[^\w])_([^\s_](?:[^_\n]*?[^\s_])?)_(?=[^\w]|$)/g, '$1<em>$2</em>');
    return s;
  }

  function splitTableRow(line) {
    let trimmed = line.trim();
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
    if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1);
    const cells = [];
    let current = '';
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
        current += '|';
        i++;
      } else if (trimmed[i] === '|') {
        cells.push(current.trim());
        current = '';
      } else {
        current += trimmed[i];
      }
    }
    cells.push(current.trim());
    return cells;
  }

  function isTableDelimiter(line, expectedCols) {
    if (!line || !line.includes('|') && !line.includes('-')) return false;
    const cells = splitTableRow(line);
    if (cells.length !== expectedCols || !cells.length) return false;
    return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function isHr(line) {
    return /^ {0,3}(?:-\s*-\s*-[-\s]*|\*\s*\*\s*\*[\*\s]*|_\s*_\s*_[_\s]*)$/.test(line);
  }

  function matchFenceOpen(line) {
    const m = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
    if (!m) return null;
    if (m[1][0] === '`' && m[2].includes('`')) return null;
    return { fence: m[1], char: m[1][0], length: m[1].length, info: m[2].trim() };
  }

  function matchListStart(line) {
    const ul = /^( *)([-*+])\s+(.*)$/.exec(line);
    if (ul) return { ordered: false, indent: ul[1].length, start: 1, content: ul[3] };
    const ol = /^( *)(\d{1,9})[.)]\s+(.*)$/.exec(line);
    if (ol) return { ordered: true, indent: ol[1].length, start: Number(ol[2]), content: ol[3] };
    return null;
  }

  function defaultCodeBlockRenderer(code, lang) {
    const language = (lang || '').split(/\s+/)[0] || '';
    const highlighted = highlightCode(code, language);
    return `<div class="code-block"><div class="code-top"><span>${escapeHtml(language || 'plain text')}</span></div><pre><code class="hljs">${highlighted}</code></pre></div>`;
  }

  function parseBlocks(lines, options) {
    const out = [];
    const renderCode = options.renderCodeBlock || defaultCodeBlockRenderer;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Blank line
      if (!line.trim()) {
        i++;
        continue;
      }

      // Fenced code block
      const fence = matchFenceOpen(line);
      if (fence) {
        const lang = fence.info.split(/\s+/)[0] || '';
        const codeLines = [];
        i++;
        const closeRe = new RegExp(`^ {0,3}${fence.char}{${fence.length},}\\s*$`);
        while (i < lines.length && !closeRe.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        out.push(renderCode(codeLines.join('\n'), lang));
        continue;
      }

      // ATX Heading (# .. ######)
      const atx = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/.exec(line);
      if (atx) {
        const level = atx[1].length;
        out.push(`<h${level}>${parseInline(atx[2].trim())}</h${level}>`);
        i++;
        continue;
      }

      // Horizontal rule
      if (isHr(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // Blockquote
      if (/^ {0,3}>/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && (/^ {0,3}>/.test(lines[i]) || (lines[i].trim() && quoteLines.length && !matchFenceOpen(lines[i]) && !isHr(lines[i])))) {
          if (/^ {0,3}>/.test(lines[i])) {
            quoteLines.push(lines[i].replace(/^ {0,3}> ?/, ''));
            i++;
          } else {
            break;
          }
        }
        out.push(`<blockquote>${parseBlocks(quoteLines, options)}</blockquote>`);
        continue;
      }

      // GFM Table
      if (line.includes('|') && i + 1 < lines.length) {
        const headerCells = splitTableRow(line);
        if (headerCells.length >= 1 && isTableDelimiter(lines[i + 1], headerCells.length)) {
          i += 2;
          const bodyRows = [];
          while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !matchFenceOpen(lines[i])) {
            const cells = splitTableRow(lines[i]);
            const normalized = headerCells.map((_, col) => cells[col] ?? '');
            bodyRows.push(normalized);
            i++;
          }
          const thead = `<thead><tr>${headerCells.map((c) => `<th>${parseInline(c)}</th>`).join('')}</tr></thead>`;
          const tbody = bodyRows.length
            ? `<tbody>${bodyRows.map((row) => `<tr>${row.map((c) => `<td>${parseInline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
            : '';
          out.push(`<table>${thead}${tbody}</table>`);
          continue;
        }
      }

      // Ordered or Unordered List
      const listFirst = matchListStart(line);
      if (listFirst) {
        const ordered = listFirst.ordered;
        const baseIndent = listFirst.indent;
        const startAttr = ordered && listFirst.start !== 1 ? ` start="${listFirst.start}"` : '';
        const items = [];

        while (i < lines.length) {
          const cur = matchListStart(lines[i]);
          if (!cur || cur.indent < baseIndent || (cur.indent === baseIndent && cur.ordered !== ordered)) break;

          if (cur.indent > baseIndent && items.length) {
            // Continuation / nested list inside previous item
            items.at(-1).push(lines[i].slice(Math.min(lines[i].length, baseIndent + 2)));
            i++;
            continue;
          }

          const itemLines = [cur.content];
          i++;
          while (i < lines.length) {
            const nextLine = lines[i];
            if (!nextLine.trim()) {
              // Peek ahead to see if list continues
              if (i + 1 < lines.length && (matchListStart(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1]))) {
                itemLines.push('');
                i++;
                continue;
              }
              break;
            }
            const nextList = matchListStart(nextLine);
            if (nextList && nextList.indent <= baseIndent) break;
            if (matchFenceOpen(nextLine) && !/^\s{2,}/.test(nextLine)) break;
            if (/^ {0,3}#{1,6}\s+/.test(nextLine) || isHr(nextLine)) break;
            itemLines.push(nextLine.replace(new RegExp(`^ {1,${baseIndent + 2}}`), ''));
            i++;
          }
          items.push(itemLines);
        }

        const renderedItems = items.map((itemLines) => {
          const first = itemLines[0] || '';
          let taskPrefix = '';
          const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(first);
          if (taskMatch) {
            const checked = taskMatch[1].toLowerCase() === 'x';
            taskPrefix = `<span class="task-box${checked ? ' task-checked' : ''}">${checked ? '✓' : ''}</span> `;
            itemLines[0] = taskMatch[2];
          }
          const hasSubBlocks = itemLines.some((l, idx) => idx > 0 && (!l.trim() || matchListStart(l) || matchFenceOpen(l)));
          if (!hasSubBlocks) {
            return `<li>${taskPrefix}${parseInline(itemLines.join('\n').trim())}</li>`;
          }
          return `<li>${taskPrefix}${parseBlocks(itemLines, options)}</li>`;
        }).join('');

        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}${startAttr}>${renderedItems}</${tag}>`);
        continue;
      }

      // Setext Heading (=== or --- on following line)
      if (i + 1 < lines.length && /^ {0,3}(=+|-+)\s*$/.test(lines[i + 1]) && line.trim()) {
        const level = lines[i + 1].trim().startsWith('=') ? 1 : 2;
        out.push(`<h${level}>${parseInline(line.trim())}</h${level}>`);
        i += 2;
        continue;
      }

      // Paragraph
      const paraLines = [line];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (!next.trim()) break;
        if (matchFenceOpen(next) || /^ {0,3}#{1,6}\s+/.test(next) || isHr(next) || /^ {0,3}>/.test(next) || matchListStart(next)) break;
        if (next.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1], splitTableRow(next).length)) break;
        paraLines.push(next);
        i++;
      }
      out.push(`<p>${parseInline(paraLines.join('\n').trim())}</p>`);
    }

    return out.join('\n');
  }

  function parseMarkdown(text, options = {}) {
    const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
    if (!normalized.trim()) return '';
    return parseBlocks(normalized.split('\n'), options);
  }

  // Strict allowlist HTML sanitizer (replaces DOMPurify)
  const ALLOWED_TAGS = new Set([
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'del', 's', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'a', 'img', 'details', 'summary', 'kbd', 'sub', 'sup', 'mark', 'span', 'div'
  ]);
  const DROP_SUBTREE_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
    'form', 'button', 'input', 'textarea', 'select', 'video', 'audio', 'template', 'noscript'
  ]);
  const SAFE_CLASS_RE = /^(?:code-block|code-top|hljs|hljs-[A-Za-z_-]+|task-box|task-checked)(?:\s+(?:code-block|code-top|hljs|hljs-[A-Za-z_-]+|task-box|task-checked))*$/;

  function isSafeHref(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return false;
    const compact = trimmed.replace(/[\x00-\x20]+/g, '').toLowerCase();
    if (/^(?:javascript|vbscript|data):/.test(compact)) return false;
    return true;
  }

  function isSafeImgSrc(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return false;
    const compact = trimmed.replace(/[\x00-\x20]+/g, '');
    if (/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(compact)) return true;
    if (/^(?:javascript|vbscript|data):/i.test(compact)) return false;
    return true;
  }

  function sanitizeDomNode(node, doc) {
    if (node.nodeType === 3) return doc.createTextNode(node.nodeValue || '');
    if (node.nodeType !== 1) return null;

    const tag = node.tagName.toLowerCase();
    if (DROP_SUBTREE_TAGS.has(tag)) return null;

    if (!ALLOWED_TAGS.has(tag)) {
      const frag = doc.createDocumentFragment();
      for (const child of node.childNodes) {
        const cleanChild = sanitizeDomNode(child, doc);
        if (cleanChild) frag.append(cleanChild);
      }
      return frag;
    }

    const cleanEl = doc.createElement(tag);
    for (const attr of node.attributes) {
      const name = attr.name.toLowerCase();
      const val = attr.value;
      if (name.startsWith('on') || name === 'style' || name === 'srcset' || name.startsWith('data-')) continue;
      if (tag === 'a' && name === 'href' && isSafeHref(val)) cleanEl.setAttribute('href', val);
      else if ((tag === 'a' || tag === 'img') && name === 'title') cleanEl.setAttribute('title', val);
      else if (tag === 'img' && name === 'src' && isSafeImgSrc(val)) cleanEl.setAttribute('src', val);
      else if (tag === 'img' && name === 'alt') cleanEl.setAttribute('alt', val);
      else if ((tag === 'th' || tag === 'td') && (name === 'colspan' || name === 'rowspan') && /^\d{1,3}$/.test(val)) cleanEl.setAttribute(name, val);
      else if (tag === 'ol' && name === 'start' && /^\d{1,6}$/.test(val)) cleanEl.setAttribute('start', val);
      else if (tag === 'details' && name === 'open') cleanEl.setAttribute('open', '');
      else if (name === 'class' && SAFE_CLASS_RE.test(val.trim())) cleanEl.setAttribute('class', val.trim());
    }

    for (const child of node.childNodes) {
      const cleanChild = sanitizeDomNode(child, doc);
      if (cleanChild) cleanEl.append(cleanChild);
    }
    return cleanEl;
  }

  function sanitizeHtml(dirtyHtml) {
    const html = String(dirtyHtml ?? '');
    if (!html) return '';
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const parsed = parser.parseFromString(html, 'text/html');
      const outDoc = document.implementation.createHTMLDocument('');
      const container = outDoc.createElement('div');
      for (const child of parsed.body.childNodes) {
        const cleaned = sanitizeDomNode(child, outDoc);
        if (cleaned) container.append(cleaned);
      }
      return container.innerHTML;
    }
    // Pure string allowlist fallback for headless Node unit tests without DOMParser
    return html
      .replace(/<(script|style|iframe|object|embed|svg|math|form|button|input|textarea|select|video|audio|template|noscript)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<(script|style|iframe|object|embed|form|button|input|textarea|select|video|audio)\b[^>]*\/?>/gi, '')
      .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s+(?:style|srcset|data-[\w-]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\bhref\s*=\s*(?:"\s*(?:javascript|vbscript|data):[^"]*"|'\s*(?:javascript|vbscript|data):[^']*')/gi, '');
  }

  globalScope.chronicleMarkdown = {
    escapeHtml,
    supportsLanguage,
    highlightCode,
    parseMarkdown,
    sanitizeHtml
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
