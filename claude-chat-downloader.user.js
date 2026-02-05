// ==UserScript==
// @name         Claude Chat Downloader
// @namespace    https://claude.ai
// @version      1.0
// @description  Download Claude conversations as self-contained HTML files
// @match        https://claude.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // SECTION 1: Markdown Parser
  // ============================================================

  function parseMarkdown(text) {
    if (!text) return '';
    let html = text;

    // Escape HTML
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Code blocks (``` ... ```)
    html = html.replace(/```([^\n`]*?)\n([\s\S]*?)```/g, (_, lang, code) => {
      const l = lang.trim();
      return `<pre class="code-block" data-lang="${escapeHtml(l)}"><code class="language-${escapeHtml(l || 'text')}">${highlightSyntax(code.trim(), l)}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

    // Block-level elements (process line by line)
    const lines = html.split('\n');
    let result = [];
    let inList = false;
    let inOrderedList = false;
    let inBlockquote = false;
    let inTable = false;
    let tableRows = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Skip lines inside code blocks (already handled)
      if (line.includes('<pre class="code-block"')) {
        // Collect until </pre>
        let block = line;
        while (!block.includes('</pre>') && i < lines.length - 1) {
          i++;
          block += '\n' + lines[i];
        }
        if (inList) { result.push('</ul>'); inList = false; }
        if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
        if (inBlockquote) { result.push('</blockquote>'); inBlockquote = false; }
        result.push(block);
        continue;
      }

      // Table detection
      if (line.match(/^\|.*\|$/)) {
        if (!inTable) {
          if (inList) { result.push('</ul>'); inList = false; }
          if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
          inTable = true;
          tableRows = [];
        }
        // Skip separator rows
        if (line.match(/^\|[\s\-:|]+\|$/)) continue;
        const cells = line.split('|').slice(1, -1).map(c => inlineFormat(c.trim()));
        tableRows.push(cells);
        continue;
      } else if (inTable) {
        inTable = false;
        let tableHtml = '<table><thead><tr>';
        if (tableRows.length > 0) {
          tableRows[0].forEach(c => tableHtml += `<th>${c}</th>`);
          tableHtml += '</tr></thead><tbody>';
          for (let r = 1; r < tableRows.length; r++) {
            tableHtml += '<tr>';
            tableRows[r].forEach(c => tableHtml += `<td>${c}</td>`);
            tableHtml += '</tr>';
          }
          tableHtml += '</tbody></table>';
        }
        result.push(tableHtml);
      }

      // Headings
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        if (inList) { result.push('</ul>'); inList = false; }
        if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
        const level = headingMatch[1].length;
        result.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
        continue;
      }

      // Horizontal rule
      if (line.match(/^(\-{3,}|\*{3,}|_{3,})$/)) {
        result.push('<hr>');
        continue;
      }

      // Blockquote
      if (line.match(/^&gt;\s?/)) {
        if (!inBlockquote) {
          if (inList) { result.push('</ul>'); inList = false; }
          if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
          result.push('<blockquote>');
          inBlockquote = true;
        }
        result.push(`<p>${inlineFormat(line.replace(/^&gt;\s?/, ''))}</p>`);
        continue;
      } else if (inBlockquote) {
        result.push('</blockquote>');
        inBlockquote = false;
      }

      // Unordered list
      if (line.match(/^[\s]*[-*+]\s+/)) {
        if (!inList) {
          if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
          result.push('<ul>');
          inList = true;
        }
        result.push(`<li>${inlineFormat(line.replace(/^[\s]*[-*+]\s+/, ''))}</li>`);
        continue;
      } else if (inList && line.trim() === '') {
        // Empty line could end list or be between items
        continue;
      } else if (inList) {
        result.push('</ul>');
        inList = false;
      }

      // Ordered list
      if (line.match(/^[\s]*\d+\.\s+/)) {
        if (!inOrderedList) {
          if (inList) { result.push('</ul>'); inList = false; }
          result.push('<ol>');
          inOrderedList = true;
        }
        result.push(`<li>${inlineFormat(line.replace(/^[\s]*\d+\.\s+/, ''))}</li>`);
        continue;
      } else if (inOrderedList && line.trim() === '') {
        continue;
      } else if (inOrderedList) {
        result.push('</ol>');
        inOrderedList = false;
      }

      // Empty line
      if (line.trim() === '') {
        continue;
      }

      // Paragraph
      result.push(`<p>${inlineFormat(line)}</p>`);
    }

    // Close open tags
    if (inList) result.push('</ul>');
    if (inOrderedList) result.push('</ol>');
    if (inBlockquote) result.push('</blockquote>');
    if (inTable && tableRows.length > 0) {
      let tableHtml = '<table><thead><tr>';
      tableRows[0].forEach(c => tableHtml += `<th>${c}</th>`);
      tableHtml += '</tr></thead><tbody>';
      for (let r = 1; r < tableRows.length; r++) {
        tableHtml += '<tr>';
        tableRows[r].forEach(c => tableHtml += `<td>${c}</td>`);
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table>';
      result.push(tableHtml);
    }

    return result.join('\n');
  }

  function inlineFormat(text) {
    // Bold + italic
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/_(.+?)_/g, '<em>$1</em>');
    // Strikethrough
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
    // Links (sanitize URLs to prevent javascript: XSS)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
      if (/^\s*javascript:/i.test(url)) return linkText;
      return `<a href="${url.replace(/"/g, '&quot;')}" target="_blank" rel="noopener">${linkText}</a>`;
    });
    return text;
  }

  // ============================================================
  // SECTION 2: Syntax Highlighter
  // ============================================================

  const KEYWORDS = {
    js: /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|default|async|await|new|try|catch|throw|typeof|instanceof|in|of|switch|case|break|continue|do|this|super|extends|yield|delete|void|null|undefined|true|false)\b/g,
    python: /\b(def|class|if|elif|else|for|while|import|from|return|try|except|raise|with|as|in|not|and|or|is|None|True|False|self|lambda|yield|pass|break|continue|global|nonlocal|async|await|print)\b/g,
    bash: /\b(if|then|else|fi|for|do|done|while|case|esac|function|return|echo|exit|export|source|local|readonly|declare|set|unset|cd|ls|grep|awk|sed|cat|mkdir|rm|cp|mv|chmod|chown)\b/g,
    default: /\b(function|return|if|else|for|while|class|import|export|const|let|var|new|try|catch|throw|true|false|null|void|this|async|await|def|self|None|print)\b/g,
  };

  function highlightSyntax(code, lang) {
    if (!lang || lang === 'text' || lang === 'plaintext') return code;

    const langMap = { javascript: 'js', typescript: 'js', jsx: 'js', tsx: 'js', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash' };
    const normalizedLang = langMap[lang] || lang;

    // Tokenize to avoid highlighting inside strings/comments
    let tokens = [];
    let remaining = code;

    while (remaining.length > 0) {
      // Single-line comment
      let commentMatch = remaining.match(/^(\/\/.*|#(?!!\/)[^\n]*)/);
      if (commentMatch) {
        tokens.push(`<span class="hl-comment">${commentMatch[0]}</span>`);
        remaining = remaining.slice(commentMatch[0].length);
        continue;
      }

      // Multi-line comment
      let blockComment = remaining.match(/^\/\*[\s\S]*?\*\//);
      if (blockComment) {
        tokens.push(`<span class="hl-comment">${blockComment[0]}</span>`);
        remaining = remaining.slice(blockComment[0].length);
        continue;
      }

      // Strings (double, single, backtick)
      let strMatch = remaining.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/);
      if (strMatch) {
        tokens.push(`<span class="hl-string">${strMatch[0]}</span>`);
        remaining = remaining.slice(strMatch[0].length);
        continue;
      }

      // Numbers
      let numMatch = remaining.match(/^\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/);
      if (numMatch) {
        tokens.push(`<span class="hl-number">${numMatch[0]}</span>`);
        remaining = remaining.slice(numMatch[0].length);
        continue;
      }

      // Keywords
      const kw = KEYWORDS[normalizedLang] || KEYWORDS.default;
      kw.lastIndex = 0;
      let kwMatch = remaining.match(new RegExp(`^${kw.source}`));
      if (kwMatch) {
        tokens.push(`<span class="hl-keyword">${kwMatch[0]}</span>`);
        remaining = remaining.slice(kwMatch[0].length);
        continue;
      }

      // Default: consume one character
      tokens.push(remaining[0]);
      remaining = remaining.slice(1);
    }

    return tokens.join('');
  }

  // ============================================================
  // SECTION 3: API Fetching
  // ============================================================

  async function fetchOrganizationId() {
    const resp = await fetch('https://claude.ai/api/organizations', { credentials: 'include' });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) throw new Error('Not authenticated - please log in to Claude.ai first');
      throw new Error(`Failed to fetch organizations: ${resp.status}`);
    }
    const orgs = await resp.json();
    if (!Array.isArray(orgs) || orgs.length === 0 || !orgs[0].uuid) throw new Error('No organizations found');
    return orgs[0].uuid;
  }

  function getConversationId() {
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
    if (!match) throw new Error('Not on a Claude conversation page');
    return match[1];
  }

  async function fetchConversation(orgId, convId) {
    // Try tree_structured rendering which includes full thinking/tool data
    const resp = await fetch(
      `https://claude.ai/api/organizations/${orgId}/chat_conversations/${convId}?rendering_mode=messages&render_all_tools=true`,
      { credentials: 'include' }
    );
    if (!resp.ok) throw new Error(`Failed to fetch conversation: ${resp.status}`);
    const data = await resp.json();
    return data;
  }

  // ============================================================
  // SECTION 4: Content Block Renderers
  // ============================================================

  function renderContentBlocks(blocks, allBlocks) {
    if (!blocks || !Array.isArray(blocks)) return '';
    // Filter out "not supported" fallback text blocks
    const filtered = blocks.filter(block => {
      if (block.type === 'text' && block.text &&
          block.text.includes('This block is not supported')) return false;
      return true;
    });
    return filtered.map(block => renderBlock(block, allBlocks || blocks)).join('\n');
  }

  function renderBlock(block, allBlocks) {
    switch (block.type) {
      case 'text': return renderTextBlock(block);
      case 'thinking': return renderThinkingBlock(block);
      case 'redacted_thinking': return renderRedactedThinking();
      case 'tool_use': return renderToolUse(block);
      case 'server_tool_use': return renderToolUse(block);
      case 'tool_result': return renderToolResult(block, allBlocks);
      case 'web_search_tool_result': return renderWebSearchResult(block);
      case 'code_execution_tool_result': return renderCodeExecutionResult(block);
      case 'image': return renderImage(block);
      case 'knowledge': return renderKnowledgeBlock(block);
      default:
        return `<div class="unknown-block">[${escapeHtml(block.type)}]</div>`;
    }
  }

  function renderTextBlock(block) {
    return `<div class="text-block">${parseMarkdown(block.text)}</div>`;
  }

  function renderThinkingBlock(block) {
    const content = block.thinking || block.text || '';
    return `
      <details class="thinking-block">
        <summary>
          <svg class="thinking-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.5V20a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.5c2.9-1.2 5-4.1 5-7.5a8 8 0 0 0-8-8z"/><line x1="10" y1="22" x2="14" y2="22"/></svg>
          Thinking
        </summary>
        <div class="thinking-content">${parseMarkdown(content)}</div>
      </details>`;
  }

  function renderRedactedThinking() {
    return `
      <div class="redacted-thinking">
        <svg class="thinking-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.5V20a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.5c2.9-1.2 5-4.1 5-7.5a8 8 0 0 0-8-8z"/><line x1="10" y1="22" x2="14" y2="22"/></svg>
        Thinking (redacted)
      </div>`;
  }

  function renderToolUse(block) {
    const name = block.name || 'unknown';
    const input = block.input || {};
    const message = block.message || '';

    // Artifact creation/update
    if (name === 'create_artifact' || name === 'update_artifact' || name === 'rewrite_artifact') {
      return renderArtifact(block);
    }

    // Web search
    if (name === 'web_search' || name === 'brave_search') {
      const query = input.query || input.q || JSON.stringify(input);
      return `
        <div class="tool-block search-query-block">
          <div class="tool-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Searching: "${escapeHtml(query)}"
          </div>
        </div>`;
    }

    // Web fetch
    if (name === 'web_fetch') {
      const url = input.url || '';
      return `
        <div class="tool-block search-query-block">
          <div class="tool-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            ${escapeHtml(message || 'Fetching: ' + url)}
          </div>
        </div>`;
    }

    // Code execution
    if (name === 'code_execution' || name === 'execute_code') {
      const code = input.code || input.source || JSON.stringify(input, null, 2);
      const lang = input.language || 'python';
      return `
        <div class="tool-block code-exec-block">
          <div class="tool-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            Code Execution
          </div>
          <pre class="code-block" data-lang="${lang}"><code class="language-${lang}">${highlightSyntax(escapeHtml(code), lang)}</code></pre>
        </div>`;
    }

    // Generic tool use
    return `
      <div class="tool-block">
        <div class="tool-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          ${escapeHtml(name)}
        </div>
        <details class="tool-input-details">
          <summary>Input</summary>
          <pre class="tool-input"><code>${escapeHtml(JSON.stringify(input, null, 2))}</code></pre>
        </details>
      </div>`;
  }

  function renderArtifact(block) {
    const input = block.input || {};
    const title = input.title || 'Artifact';
    const content = input.content || '';
    const lang = input.language || input.type || 'text';
    const isHtml = lang === 'html' || (input.type && input.type.includes('html'));

    let tabs = '';
    if (isHtml) {
      tabs = `
        <div class="artifact-tabs">
          <button class="artifact-tab active" data-tab="code">Code</button>
          <button class="artifact-tab" data-tab="preview">Preview</button>
        </div>`;
    }

    return `
      <div class="artifact-block" data-artifact-type="${escapeHtml(lang)}">
        <div class="artifact-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          <span class="artifact-title">${escapeHtml(title)}</span>
          <span class="artifact-lang">${escapeHtml(lang)}</span>
        </div>
        ${tabs}
        <div class="artifact-content artifact-code-view">
          <pre class="code-block" data-lang="${escapeHtml(lang)}"><code class="language-${escapeHtml(lang)}">${highlightSyntax(escapeHtml(content), lang)}</code></pre>
        </div>
        ${isHtml ? `<div class="artifact-content artifact-preview-view" style="display:none"><iframe sandbox="allow-scripts" srcdoc="${escapeAttr(content)}"></iframe></div>` : ''}
      </div>`;
  }

  function renderToolResult(block, allBlocks) {
    const content = block.content;
    const isError = block.is_error;
    const errorClass = isError ? ' tool-error' : '';
    const name = block.name || '';

    // If this is a web_search tool_result with knowledge blocks, render as search results
    if (Array.isArray(content)) {
      const knowledgeBlocks = content.filter(c => c.type === 'knowledge');
      if (knowledgeBlocks.length > 0) {
        return `
          <details class="search-results-block">
            <summary class="search-results-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              ${knowledgeBlocks.length} source${knowledgeBlocks.length !== 1 ? 's' : ''} found
            </summary>
            <div class="search-results-list">
              ${knowledgeBlocks.map(k => renderKnowledgeBlock(k)).join('\n')}
            </div>
          </details>`;
      }

      return content.map(c => {
        if (c.type === 'text') return `<div class="tool-result${errorClass}">${parseMarkdown(c.text)}</div>`;
        if (c.type === 'image') return renderImage(c);
        if (c.type === 'web_search_result') return renderSearchResultCard(c);
        if (c.type === 'knowledge') return renderKnowledgeBlock(c);
        return `<div class="tool-result">[${escapeHtml(c.type)}]</div>`;
      }).join('\n');
    }

    if (!content) {
      // Use display_content or message as fallback
      if (block.display_content) {
        const dc = block.display_content;
        if (dc.type === 'rich_link' && dc.link) {
          return renderKnowledgeBlock({ type: 'knowledge', title: dc.link.title, url: dc.link.url, metadata: { favicon_url: dc.link.icon_url, site_name: dc.link.source } });
        }
      }
      if (block.message) return `<div class="tool-result">${parseMarkdown(block.message)}</div>`;
      return '';
    }

    if (typeof content === 'string') {
      return `<div class="tool-result${errorClass}">${parseMarkdown(content)}</div>`;
    }

    return '';
  }

  function renderWebSearchResult(block) {
    const content = block.content;
    if (!content || !Array.isArray(content)) {
      // Could be an error
      if (content && content.type === 'web_search_error') {
        return `<div class="tool-result tool-error">Search error: ${escapeHtml(content.error_message || 'Unknown error')}</div>`;
      }
      return '';
    }

    const results = content.filter(c => c.type === 'web_search_result');
    if (results.length === 0) return '';

    return `
      <div class="search-results-block">
        <div class="search-results-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          ${results.length} source${results.length !== 1 ? 's' : ''} found
        </div>
        <div class="search-results-list">
          ${results.map(r => renderSearchResultCard(r)).join('\n')}
        </div>
      </div>`;
  }

  function renderSearchResultCard(result) {
    const url = result.url || '#';
    const title = result.title || url;
    const age = result.page_age ? `<span class="result-age">${escapeHtml(result.page_age)}</span>` : '';
    let domain = '';
    try { domain = new URL(url).hostname; } catch (e) { domain = url; }

    return `
      <a class="search-result-card" href="${escapeAttr(url)}" target="_blank" rel="noopener">
        <div class="result-title">${escapeHtml(title)}</div>
        <div class="result-url">${escapeHtml(domain)} ${age}</div>
      </a>`;
  }

  function renderKnowledgeBlock(block) {
    // Knowledge blocks from web search/fetch results
    // Structure: { type, title, url, metadata: { site_domain, favicon_url, site_name }, is_missing }
    const title = block.title || block.name || 'Source';
    const url = block.url || '';
    const meta = block.metadata || {};
    const siteName = meta.site_name || meta.site_domain || '';
    const favicon = meta.favicon_url || '';
    let domain = meta.site_domain || '';
    if (!domain && url) {
      try { domain = new URL(url).hostname; } catch (e) { domain = ''; }
    }

    const faviconHtml = favicon
      ? `<img class="result-favicon" src="${escapeAttr(favicon)}" width="14" height="14" alt="">`
      : '';

    if (url) {
      return `
        <a class="search-result-card" href="${escapeAttr(url)}" target="_blank" rel="noopener">
          <div class="result-title">${faviconHtml} ${escapeHtml(title)}</div>
          <div class="result-url">${escapeHtml(siteName || domain)}</div>
        </a>`;
    }

    return `
      <div class="knowledge-ref">
        ${faviconHtml}
        ${escapeHtml(title)}
      </div>`;
  }

  function renderCodeExecutionResult(block) {
    const output = block.output || '';
    const returnVal = block.return_value || '';
    const error = block.error || '';

    let html = '<div class="code-exec-result">';
    if (output) {
      html += `<div class="exec-output"><div class="exec-label">Output</div><pre><code>${escapeHtml(output)}</code></pre></div>`;
    }
    if (returnVal) {
      html += `<div class="exec-return"><div class="exec-label">Return</div><pre><code>${escapeHtml(returnVal)}</code></pre></div>`;
    }
    if (error) {
      html += `<div class="exec-error"><div class="exec-label">Error</div><pre><code>${escapeHtml(error)}</code></pre></div>`;
    }
    html += '</div>';
    return html;
  }

  function renderImage(block) {
    if (block.source && block.source.type === 'base64') {
      return `<img class="message-image" src="data:${block.source.media_type};base64,${block.source.data}" alt="Image">`;
    }
    if (block.source && block.source.url) {
      return `<img class="message-image" src="${escapeAttr(block.source.url)}" alt="Image">`;
    }
    return '<div class="unknown-block">[Image]</div>';
  }

  // ============================================================
  // SECTION 5: HTML Template Builder
  // ============================================================

  function buildHTML(conversation, fileMap) {
    fileMap = fileMap || {};
    const title = conversation.name || 'Claude Conversation';
    const model = conversation.model || 'claude';
    const createdAt = conversation.created_at ? new Date(conversation.created_at).toLocaleString() : '';
    const messages = conversation.chat_messages || [];

    // Sort messages by index
    messages.sort((a, b) => (a.index || 0) - (b.index || 0));

    let messagesHtml = '';
    for (const msg of messages) {
      const sender = msg.sender || 'unknown';
      const isHuman = sender === 'human';
      const avatarLabel = isHuman ? 'H' : 'C';
      const senderLabel = isHuman ? 'You' : 'Claude';

      let contentHtml = '';
      if (msg.content && Array.isArray(msg.content) && msg.content.length > 0) {
        contentHtml = renderContentBlocks(msg.content);
      } else if (msg.text) {
        contentHtml = parseMarkdown(msg.text);
      }

      // Handle uploaded files (images, documents)
      let filesHtml = '';
      const files = msg.files_v2 || msg.files || [];
      if (files.length > 0) {
        filesHtml = '<div class="uploaded-files-grid">' + files.map(file => {
          const name = file.file_name || 'file';
          const uuid = file.file_uuid;
          const dataUri = fileMap[uuid];

          if (file.file_kind === 'image' && dataUri) {
            return `<div class="uploaded-file uploaded-image">
              <img src="${dataUri}" alt="${escapeAttr(name)}" loading="lazy">
              <div class="uploaded-file-name">${escapeHtml(name)}</div>
            </div>`;
          }

          if (file.file_kind === 'document') {
            const pageCount = file.document_asset?.page_count;
            const pageLabel = pageCount ? ` (${pageCount} page${pageCount !== 1 ? 's' : ''})` : '';
            const thumbHtml = dataUri
              ? `<img class="doc-thumbnail" src="${dataUri}" alt="${escapeAttr(name)}">`
              : '';
            return `<div class="uploaded-file uploaded-doc">
              ${thumbHtml}
              <div class="uploaded-file-info">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                <span>${escapeHtml(name)}${pageLabel}</span>
              </div>
            </div>`;
          }

          // Fallback for other file types
          return `<div class="uploaded-file">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
            <span class="uploaded-file-name">${escapeHtml(name)}</span>
          </div>`;
        }).join('\n') + '</div>';
      }

      // Handle text attachments (pasted files with extracted_content)
      let attachmentsHtml = '';
      if (msg.attachments && msg.attachments.length > 0) {
        attachmentsHtml = msg.attachments.map(att => {
          const name = att.file_name || att.filename || 'attachment';
          const content = att.extracted_content || '';
          const size = att.file_size ? `(${formatFileSize(att.file_size)})` : '';

          if (content) {
            return `<details class="text-attachment">
              <summary>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                ${escapeHtml(name)} <span class="att-size">${escapeHtml(size)}</span>
              </summary>
              <div class="text-attachment-content"><pre>${escapeHtml(content)}</pre></div>
            </details>`;
          }

          return `<div class="attachment">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            ${escapeHtml(name)} <span class="att-size">${escapeHtml(size)}</span>
          </div>`;
        }).join('');
      }

      messagesHtml += `
        <div class="message message-${sender}">
          <div class="message-avatar ${sender}-avatar">${isHuman ? avatarLabel : claudeLogo()}</div>
          <div class="message-body">
            <div class="message-sender">${senderLabel}</div>
            ${filesHtml}
            ${attachmentsHtml}
            <div class="message-content">${contentHtml}</div>
          </div>
        </div>`;
    }

    return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
${getCSS()}
</style>
</head>
<body>
<header class="page-header">
  <div class="header-left">
    <div class="claude-logo-header">${claudeLogo()}</div>
    <div class="header-title">
      <h1>${escapeHtml(title)}</h1>
      <div class="header-meta">${escapeHtml(model)} &middot; ${escapeHtml(createdAt)}</div>
    </div>
  </div>
  <div class="header-actions">
    <button id="expand-all-btn" title="Expand/Collapse all thinking">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.5V20a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.5c2.9-1.2 5-4.1 5-7.5a8 8 0 0 0-8-8z"/></svg>
    </button>
    <button id="minimap-toggle" title="Toggle minimap">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>
    </button>
    <button id="theme-toggle" title="Toggle dark/light mode">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    </button>
  </div>
</header>
<div id="minimap" class="minimap">
  <div class="minimap-header">
    <span>Map</span>
    <button id="minimap-close" title="Close minimap">&times;</button>
  </div>
  <div class="minimap-track" id="minimap-track">
    <div class="minimap-viewport" id="minimap-viewport"></div>
  </div>
</div>
<main class="conversation">
${messagesHtml}
</main>
<script>
${getViewerJS()}
</script>
</body>
</html>`;
  }

  function claudeLogo() {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.1 2.96l-4.6 8-1.86-3.22L12.96 2.2a.78.78 0 0 1 1.36 0l1.78 .76zM17.9 17.04l-4.6-8 1.86-3.22 5.32 9.22a.78.78 0 0 1-.68 1.17l-1.9-.17zM6.1 17.04l4.6-8-1.86 3.22-5.32-9.22a.78.78 0 0 1 .68-1.17l1.9 .17zM12 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>';
  }

  // ============================================================
  // SECTION 6: CSS Styles
  // ============================================================

  function getCSS() {
    return `
:root {
  --bg-primary: #f5f4ef;
  --bg-secondary: #eae8e1;
  --bg-message-human: #e8e5db;
  --bg-message-assistant: transparent;
  --text-primary: #1a1a1a;
  --text-secondary: #6b6560;
  --text-muted: #9a948e;
  --accent: #c96442;
  --accent-light: rgba(201,100,66,0.1);
  --border: #d8d4cc;
  --code-bg: #2b2926;
  --code-text: #e8e4da;
  --thinking-bg: #edeadf;
  --thinking-border: #d4d0c5;
  --tool-bg: #f0ede4;
  --tool-border: #d8d4cc;
  --artifact-bg: #faf9f5;
  --artifact-border: #c9c4ba;
  --search-card-bg: #fff;
  --search-card-border: #e0ddd5;
  --header-bg: #f5f4ef;
  --shadow: 0 1px 3px rgba(0,0,0,0.06);
  --radius: 8px;
  --radius-sm: 4px;
}
[data-theme="dark"] {
  --bg-primary: #1a1916;
  --bg-secondary: #232220;
  --bg-message-human: #2a2824;
  --bg-message-assistant: transparent;
  --text-primary: #e8e4da;
  --text-secondary: #a09890;
  --text-muted: #706860;
  --accent: #d4805e;
  --accent-light: rgba(212,128,94,0.1);
  --border: #3a3632;
  --code-bg: #111110;
  --code-text: #d4d0c5;
  --thinking-bg: #222120;
  --thinking-border: #3a3632;
  --tool-bg: #252320;
  --tool-border: #3a3632;
  --artifact-bg: #1e1d1a;
  --artifact-border: #3a3632;
  --search-card-bg: #252320;
  --search-card-border: #3a3632;
  --header-bg: #1a1916;
  --shadow: 0 1px 3px rgba(0,0,0,0.2);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  font-size: 15px;
}
.page-header {
  position: sticky; top: 0; z-index: 100;
  background: var(--header-bg);
  border-bottom: 1px solid var(--border);
  padding: 12px 24px;
  display: flex; align-items: center; justify-content: space-between;
  backdrop-filter: blur(8px);
}
.header-left { display: flex; align-items: center; gap: 12px; }
.claude-logo-header { color: var(--accent); display: flex; align-items: center; }
.header-title h1 { font-size: 16px; font-weight: 600; }
.header-meta { font-size: 12px; color: var(--text-muted); }
.header-actions { display: flex; gap: 8px; }
.header-actions button {
  background: none; border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 6px 8px; cursor: pointer; color: var(--text-secondary);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.header-actions button:hover { background: var(--bg-secondary); color: var(--text-primary); }
.conversation { max-width: 48rem; margin: 0 auto; padding: 24px 16px 80px; }
.message { display: flex; gap: 16px; padding: 24px 0; }
.message + .message { border-top: 1px solid var(--border); }
.message-avatar {
  width: 28px; height: 28px; min-width: 28px;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600; margin-top: 2px;
}
.human-avatar { background: var(--bg-message-human); color: var(--text-primary); border: 1px solid var(--border); }
.assistant-avatar { background: var(--accent-light); color: var(--accent); }
.message-body { flex: 1; min-width: 0; }
.message-sender { font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text-secondary); }
.message-content { overflow-wrap: break-word; }
.message-content p { margin-bottom: 0.75em; }
.message-content p:last-child { margin-bottom: 0; }
.message-content h1 { font-size: 1.5em; font-weight: 700; margin: 1em 0 0.5em; }
.message-content h2 { font-size: 1.3em; font-weight: 700; margin: 1em 0 0.5em; }
.message-content h3 { font-size: 1.1em; font-weight: 600; margin: 0.8em 0 0.4em; }
.message-content h4, .message-content h5, .message-content h6 { font-size: 1em; font-weight: 600; margin: 0.6em 0 0.3em; }
.message-content ul, .message-content ol { padding-left: 1.5em; margin-bottom: 0.75em; }
.message-content li { margin-bottom: 0.25em; }
.message-content blockquote {
  border-left: 3px solid var(--accent);
  padding: 0.5em 1em; margin: 0.75em 0;
  color: var(--text-secondary); background: var(--thinking-bg); border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.message-content table { border-collapse: collapse; margin: 0.75em 0; width: 100%; }
.message-content th, .message-content td {
  border: 1px solid var(--border); padding: 8px 12px; text-align: left;
}
.message-content th { background: var(--bg-secondary); font-weight: 600; }
.message-content hr { border: none; border-top: 1px solid var(--border); margin: 1em 0; }
.message-content a { color: var(--accent); text-decoration: none; }
.message-content a:hover { text-decoration: underline; }
.inline-code {
  background: var(--bg-secondary); padding: 2px 6px; border-radius: 3px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 0.9em;
}
.code-block {
  background: var(--code-bg); color: var(--code-text);
  border-radius: var(--radius); padding: 16px; margin: 0.75em 0;
  overflow-x: auto; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 13px; line-height: 1.5; position: relative;
}
.code-block code { background: none; padding: 0; }
.code-block .copy-btn {
  position: absolute; top: 8px; right: 8px;
  background: rgba(255,255,255,0.1); border: none; border-radius: var(--radius-sm);
  padding: 4px 8px; cursor: pointer; color: var(--code-text); font-size: 11px;
  opacity: 0; transition: opacity 0.15s;
}
.code-block:hover .copy-btn { opacity: 1; }
.code-block .copy-btn:hover { background: rgba(255,255,255,0.2); }
.hl-keyword { color: #c678dd; }
.hl-string { color: #98c379; }
.hl-comment { color: #5c6370; font-style: italic; }
.hl-number { color: #d19a66; }
.thinking-block {
  background: var(--thinking-bg); border: 1px solid var(--thinking-border);
  border-radius: var(--radius); margin: 0.75em 0; overflow: hidden;
}
.thinking-block summary {
  padding: 10px 16px; cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; color: var(--text-secondary); font-weight: 500;
}
.thinking-block summary:hover { background: var(--bg-secondary); }
.thinking-icon { display: flex; align-items: center; color: var(--accent); }
.thinking-content { padding: 0 16px 16px; font-size: 14px; color: var(--text-secondary); }
.thinking-content p { margin-bottom: 0.5em; }
.redacted-thinking {
  background: var(--thinking-bg); border: 1px solid var(--thinking-border);
  border-radius: var(--radius); padding: 10px 16px; margin: 0.75em 0;
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; color: var(--text-muted);
}
.tool-block {
  border: 1px solid var(--tool-border); border-radius: var(--radius);
  margin: 0.75em 0; overflow: hidden;
}
.tool-header {
  padding: 10px 16px; background: var(--tool-bg);
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 500; color: var(--text-secondary);
}
.tool-input-details summary { padding: 8px 16px; cursor: pointer; font-size: 13px; color: var(--text-muted); }
.tool-input { margin: 0; padding: 12px 16px; background: var(--code-bg); color: var(--code-text); font-size: 12px; overflow-x: auto; }
.tool-result { padding: 12px 16px; font-size: 14px; border-top: 1px solid var(--tool-border); }
.tool-error { color: #e05252; background: rgba(224,82,82,0.05); }
.search-results-block {
  margin: 0.75em 0; border: 1px solid var(--border);
  border-radius: var(--radius); overflow: hidden;
}
.search-results-header {
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  font-size: 13px; color: var(--text-muted); padding: 8px 12px;
  background: var(--bg-secondary); user-select: none; list-style: none;
}
.search-results-header::-webkit-details-marker { display: none; }
.search-results-header::after {
  content: ''; margin-left: auto;
  border: 5px solid transparent; border-left: 6px solid var(--text-muted);
  transition: transform 0.15s;
}
.search-results-block[open] > .search-results-header::after {
  transform: rotate(90deg);
}
.search-results-header:hover { background: var(--tool-bg); }
.search-results-list { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.search-result-card {
  display: block; padding: 10px 14px;
  background: var(--search-card-bg); border: 1px solid var(--search-card-border);
  border-radius: var(--radius-sm); text-decoration: none; transition: all 0.15s;
}
.search-result-card:hover { border-color: var(--accent); box-shadow: var(--shadow); }
.result-title { font-size: 14px; font-weight: 500; color: var(--text-primary); margin-bottom: 2px; display: flex; align-items: center; gap: 6px; }
.result-favicon { border-radius: 2px; flex-shrink: 0; }
.result-url { font-size: 12px; color: var(--text-muted); }
.result-age { margin-left: 8px; }
.artifact-block {
  border: 1px solid var(--artifact-border); border-radius: var(--radius);
  margin: 0.75em 0; overflow: hidden;
}
.artifact-header {
  padding: 10px 16px; background: var(--tool-bg);
  display: flex; align-items: center; gap: 8px; font-size: 14px;
}
.artifact-title { font-weight: 600; }
.artifact-lang { font-size: 12px; color: var(--text-muted); margin-left: auto; }
.artifact-tabs {
  display: flex; border-bottom: 1px solid var(--border); background: var(--tool-bg);
}
.artifact-tab {
  padding: 6px 16px; border: none; background: none; cursor: pointer;
  font-size: 13px; color: var(--text-secondary); border-bottom: 2px solid transparent;
}
.artifact-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.artifact-content .code-block { margin: 0; border-radius: 0; }
.artifact-preview-view iframe {
  width: 100%; min-height: 300px; border: none; background: #fff;
}
.code-exec-result { margin: 0.5em 0; }
.exec-label { font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; }
.exec-output pre, .exec-return pre {
  background: var(--code-bg); color: var(--code-text);
  padding: 10px; border-radius: var(--radius-sm); font-size: 13px; overflow-x: auto;
}
.exec-error pre {
  background: rgba(224,82,82,0.08); color: #e05252;
  padding: 10px; border-radius: var(--radius-sm); font-size: 13px; overflow-x: auto;
}
.attachment {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 4px 10px; margin-bottom: 8px;
  font-size: 13px; color: var(--text-secondary);
}
.message-image { max-width: 100%; border-radius: var(--radius); margin: 0.5em 0; }
.unknown-block { color: var(--text-muted); font-style: italic; padding: 8px 0; }
.uploaded-files-grid {
  display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;
}
.uploaded-file { flex-shrink: 0; }
.uploaded-image { width: 120px; }
.uploaded-image img {
  width: 120px; height: 90px; object-fit: cover;
  border-radius: var(--radius-sm); border: 1px solid var(--border); cursor: pointer;
  transition: transform 0.15s;
}
.uploaded-image img:hover { transform: scale(1.05); }
.uploaded-image img.expanded {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: auto; height: auto; max-width: 90vw; max-height: 90vh;
  object-fit: contain; z-index: 10001; border-radius: var(--radius);
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}
.image-overlay {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0,0,0,0.6); z-index: 10000; cursor: pointer;
}
.uploaded-file-name { font-size: 11px; color: var(--text-muted); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uploaded-doc {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: var(--radius-sm); max-width: 200px;
}
.doc-thumbnail { width: 32px; border-radius: 2px; border: 1px solid var(--border); }
.uploaded-file-info { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.text-attachment {
  border: 1px solid var(--border); border-radius: var(--radius);
  margin-bottom: 10px; overflow: hidden; max-width: 100%;
}
.text-attachment summary {
  padding: 8px 12px; cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 500; color: var(--text-secondary);
  background: var(--bg-secondary);
}
.text-attachment summary:hover { background: var(--tool-bg); }
.att-size { font-weight: 400; color: var(--text-muted); }
.text-attachment-content {
  max-height: 400px; overflow-y: auto;
  padding: 12px; font-size: 13px;
}
.text-attachment-content pre {
  white-space: pre-wrap; word-wrap: break-word;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 12px; line-height: 1.5; margin: 0;
}
.knowledge-block {
  background: var(--search-card-bg); border: 1px solid var(--search-card-border);
  border-radius: var(--radius-sm); margin: 4px 0; overflow: hidden;
}
.knowledge-summary {
  padding: 8px 12px; cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--text-secondary);
}
.knowledge-summary:hover { background: var(--bg-secondary); }
.knowledge-content { padding: 0 12px 12px; font-size: 13px; color: var(--text-secondary); }
.knowledge-ref {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; margin: 4px 0;
  background: var(--search-card-bg); border: 1px solid var(--search-card-border);
  border-radius: var(--radius-sm); font-size: 13px; color: var(--text-secondary);
}
.search-query-block { background: var(--tool-bg); }
.code-exec-block .code-block { margin: 0; border-radius: 0; }
.minimap {
  position: fixed; top: 80px; right: 16px; z-index: 99;
  width: 140px; max-height: calc(100vh - 96px);
  background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow);
  display: none; flex-direction: column; overflow: hidden;
}
.minimap.visible { display: flex; }
.minimap-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; font-size: 11px; font-weight: 600; color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}
.minimap-header button {
  background: none; border: none; cursor: pointer; color: var(--text-muted);
  font-size: 16px; line-height: 1; padding: 0;
}
.minimap-header button:hover { color: var(--text-primary); }
.minimap-track {
  flex: 1; overflow: hidden; position: relative; cursor: pointer;
  padding: 4px 8px;
}
.minimap-block {
  width: 100%; margin: 2px 0; border-radius: 2px; min-height: 2px;
  cursor: pointer; transition: opacity 0.1s;
}
.minimap-block:hover { opacity: 0.7; }
.minimap-block.mm-human { background: var(--accent); height: 3px; }
.minimap-block.mm-assistant { background: var(--text-muted); }
.minimap-block.mm-thinking { background: #d4a84b; height: 2px; }
.minimap-block.mm-tool { background: #6b9fd4; height: 2px; }
.minimap-block.mm-search { background: #6bd49f; height: 2px; }
.minimap-viewport {
  position: absolute; left: 0; right: 0;
  background: rgba(201,100,66,0.25); border: 2px solid var(--accent);
  border-radius: 2px; pointer-events: none;
  min-height: 24px; box-shadow: 0 0 0 1px rgba(0,0,0,0.15);
}
[data-theme="dark"] .minimap-viewport {
  background: rgba(212,128,94,0.3); border-color: #e8915a;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.1);
}
@media (max-width: 640px) {
  .conversation { padding: 16px 12px 60px; }
  .message { gap: 12px; padding: 16px 0; }
  .page-header { padding: 10px 12px; }
}
`;
  }

  // ============================================================
  // SECTION 7: Viewer JavaScript (embedded in output HTML)
  // ============================================================

  function getViewerJS() {
    return `
(function() {
  // Theme toggle
  const toggle = document.getElementById('theme-toggle');
  const html = document.documentElement;
  const savedTheme = localStorage.getItem('claude-dl-theme');
  if (savedTheme) html.setAttribute('data-theme', savedTheme);

  toggle.addEventListener('click', () => {
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('claude-dl-theme', next);
  });

  // Expand/collapse all thinking
  const expandBtn = document.getElementById('expand-all-btn');
  let allExpanded = false;
  expandBtn.addEventListener('click', () => {
    allExpanded = !allExpanded;
    document.querySelectorAll('.thinking-block').forEach(d => {
      d.open = allExpanded;
    });
  });

  // Copy buttons on code blocks
  document.querySelectorAll('.code-block').forEach(block => {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      const code = block.querySelector('code');
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 1500);
      });
    });
    block.appendChild(btn);
  });

  // Minimap
  (function initMinimap() {
    const minimap = document.getElementById('minimap');
    const track = document.getElementById('minimap-track');
    const viewport = document.getElementById('minimap-viewport');
    const toggleBtn = document.getElementById('minimap-toggle');
    const closeBtn = document.getElementById('minimap-close');

    // Build minimap blocks from messages
    const messages = document.querySelectorAll('.message');
    messages.forEach((msg, i) => {
      const isHuman = msg.classList.contains('message-human');
      // Create a block for the message
      const block = document.createElement('div');
      block.className = 'minimap-block ' + (isHuman ? 'mm-human' : 'mm-assistant');

      // Estimate height based on content
      const contentEl = msg.querySelector('.message-content');
      const textLen = contentEl ? contentEl.textContent.length : 50;
      const h = Math.max(2, Math.min(20, Math.round(textLen / 80)));
      block.style.height = h + 'px';

      block.addEventListener('click', (e) => {
        e.stopPropagation();
        scrollToMessage(msg);
      });
      track.appendChild(block);

      // Add sub-blocks for thinking/tools inside assistant messages
      if (!isHuman) {
        msg.querySelectorAll('.thinking-block').forEach(() => {
          const tb = document.createElement('div');
          tb.className = 'minimap-block mm-thinking';
          tb.addEventListener('click', (e) => { e.stopPropagation(); scrollToMessage(msg); });
          track.appendChild(tb);
        });
        msg.querySelectorAll('.search-query-block, .search-results-block').forEach(() => {
          const sb = document.createElement('div');
          sb.className = 'minimap-block mm-search';
          sb.addEventListener('click', (e) => { e.stopPropagation(); scrollToMessage(msg); });
          track.appendChild(sb);
        });
        msg.querySelectorAll('.tool-block:not(.search-query-block)').forEach(() => {
          const tb = document.createElement('div');
          tb.className = 'minimap-block mm-tool';
          tb.addEventListener('click', (e) => { e.stopPropagation(); scrollToMessage(msg); });
          track.appendChild(tb);
        });
      }
    });

    function scrollToMessage(el) {
      const headerH = 56;
      const y = el.getBoundingClientRect().top + window.scrollY - headerH - 10;
      window.scrollTo({ top: y, behavior: 'instant' });
      requestAnimationFrame(updateViewport);
    }

    // Update viewport indicator on scroll
    function updateViewport() {
      const docH = document.documentElement.scrollHeight;
      const winH = window.innerHeight;
      const scrollY = window.scrollY;
      const trackClientH = track.clientHeight;

      const ratio = trackClientH / docH;
      const vpH = Math.max(8, winH * ratio);
      const vpTop = scrollY * ratio;

      viewport.style.top = vpTop + 'px';
      viewport.style.height = vpH + 'px';
    }

    window.addEventListener('scroll', updateViewport, { passive: true });
    window.addEventListener('resize', updateViewport);
    updateViewport();

    // Click and drag on minimap track to scroll
    let dragging = false;
    let dragOffset = 0;

    function scrollFromTrackY(clientY) {
      const rect = track.getBoundingClientRect();
      const ratio = (clientY - rect.top - dragOffset) / rect.height;
      const targetScroll = ratio * document.documentElement.scrollHeight;
      window.scrollTo({ top: Math.max(0, targetScroll), behavior: 'instant' });
      requestAnimationFrame(updateViewport);
    }

    track.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const vpRect = viewport.getBoundingClientRect();
      if (e.clientY >= vpRect.top && e.clientY <= vpRect.bottom) {
        // Clicked inside viewport - drag relative to click position
        dragOffset = e.clientY - vpRect.top;
      } else {
        // Clicked outside viewport - jump and center viewport
        dragOffset = viewport.offsetHeight / 2;
        scrollFromTrackY(e.clientY);
      }
      dragging = true;
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      scrollFromTrackY(e.clientY);
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });

    // Toggle minimap
    toggleBtn.addEventListener('click', () => {
      minimap.classList.toggle('visible');
      updateViewport();
    });
    closeBtn.addEventListener('click', () => {
      minimap.classList.remove('visible');
    });
  })();

  // Image lightbox (click thumbnail to expand)
  document.querySelectorAll('.uploaded-image img').forEach(img => {
    img.addEventListener('click', () => {
      if (img.classList.contains('expanded')) {
        img.classList.remove('expanded');
        const overlay = document.querySelector('.image-overlay');
        if (overlay) overlay.remove();
        return;
      }
      const overlay = document.createElement('div');
      overlay.className = 'image-overlay';
      overlay.addEventListener('click', () => {
        img.classList.remove('expanded');
        overlay.remove();
      });
      document.body.appendChild(overlay);
      img.classList.add('expanded');
    });
  });

  // Artifact tab switching
  document.querySelectorAll('.artifact-tabs').forEach(tabs => {
    const artifact = tabs.closest('.artifact-block');
    tabs.querySelectorAll('.artifact-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.querySelectorAll('.artifact-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        if (target === 'code') {
          artifact.querySelector('.artifact-code-view').style.display = '';
          const preview = artifact.querySelector('.artifact-preview-view');
          if (preview) preview.style.display = 'none';
        } else {
          artifact.querySelector('.artifact-code-view').style.display = 'none';
          const preview = artifact.querySelector('.artifact-preview-view');
          if (preview) preview.style.display = '';
        }
      });
    });
  });
})();
`;
  }

  // ============================================================
  // SECTION 8: Utility functions
  // ============================================================

  function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escapeAttr(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '-').substring(0, 80) || 'claude-chat';
  }

  // ============================================================
  // SECTION 9: Download trigger
  // ============================================================

  function downloadFile(html, filename) {
    const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ============================================================
  // SECTION 10: UI Button Injection
  // ============================================================

  function createDownloadButton() {
    const btn = document.createElement('button');
    btn.id = 'claude-dl-btn';
    btn.title = 'Download this conversation as HTML';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>`;
    btn.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 10000;
      width: 48px; height: 48px; border-radius: 50%;
      background: #c96442; color: white; border: none;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2); transition: all 0.2s;
    `;
    btn.onmouseenter = () => btn.style.transform = 'scale(1.1)';
    btn.onmouseleave = () => btn.style.transform = 'scale(1)';
    btn.onclick = handleDownload;
    document.body.appendChild(btn);
  }

  function setButtonState(state) {
    const btn = document.getElementById('claude-dl-btn');
    if (!btn) return;
    if (state === 'loading') {
      btn.style.opacity = '0.7';
      btn.style.pointerEvents = 'none';
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="30 70" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg>`;
    } else if (state === 'done') {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      btn.style.background = '#4a9e6a';
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
      setTimeout(() => {
        btn.style.background = '#c96442';
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
      }, 2000);
    } else if (state === 'error') {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      btn.style.background = '#e05252';
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      setTimeout(() => {
        btn.style.background = '#c96442';
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
      }, 3000);
    }
  }

  async function fetchFileAsDataUri(url) {
    try {
      const resp = await fetch('https://claude.ai' + url, { credentials: 'include' });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('[Claude DL] Failed to fetch file:', url, e);
      return null;
    }
  }

  async function embedFiles(conversation) {
    // Collect all files from all messages and fetch images as base64
    const fileMap = {}; // uuid -> data URI
    const messages = conversation.chat_messages || [];
    const fetches = [];

    for (const msg of messages) {
      const files = msg.files_v2 || msg.files || [];
      for (const file of files) {
        if (file.file_kind === 'image' && file.file_uuid && !fileMap[file.file_uuid]) {
          const url = file.preview_url || file.preview_asset?.url || file.thumbnail_url || file.thumbnail_asset?.url;
          if (url) {
            fileMap[file.file_uuid] = null; // mark as pending
            fetches.push(
              fetchFileAsDataUri(url).then(dataUri => {
                fileMap[file.file_uuid] = dataUri;
              })
            );
          }
        }
        if (file.file_kind === 'document' && file.file_uuid && file.thumbnail_asset?.url) {
          fileMap[file.file_uuid] = null;
          fetches.push(
            fetchFileAsDataUri(file.thumbnail_asset.url).then(dataUri => {
              fileMap[file.file_uuid] = dataUri;
            })
          );
        }
      }
    }

    // Fetch in parallel, batches of 5 to avoid overwhelming
    for (let i = 0; i < fetches.length; i += 5) {
      await Promise.all(fetches.slice(i, i + 5));
    }

    return fileMap;
  }

  async function handleDownload() {
    setButtonState('loading');
    try {
      const orgId = await fetchOrganizationId();
      const convId = getConversationId();
      const conversation = await fetchConversation(orgId, convId);
      const fileMap = await embedFiles(conversation);
      const html = buildHTML(conversation, fileMap);
      const filename = sanitizeFilename(conversation.name || 'claude-chat') + '.html';
      downloadFile(html, filename);
      setButtonState('done');
    } catch (err) {
      console.error('Claude Chat Downloader error:', err);
      setButtonState('error');
      alert('Failed to download: ' + err.message);
    }
  }

  // ============================================================
  // SECTION 11: Initialize
  // ============================================================

  function isOnChatPage() {
    return /\/chat\/[a-f0-9-]+/.test(location.pathname);
  }

  function ensureButton() {
    if (isOnChatPage()) {
      if (!document.getElementById('claude-dl-btn')) createDownloadButton();
    } else {
      const btn = document.getElementById('claude-dl-btn');
      if (btn) btn.remove();
    }
  }

  // Initial injection (with retries since Claude's SPA may still be loading)
  function init() {
    ensureButton();
    // Retry a few times in case the page isn't fully rendered yet
    setTimeout(ensureButton, 1000);
    setTimeout(ensureButton, 3000);
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }

  // Re-inject button on SPA navigation (Claude uses client-side routing)
  let lastPath = location.pathname;
  const checkNavigation = () => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      ensureButton();
    }
  };
  const observer = new MutationObserver(checkNavigation);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', checkNavigation);

})();
