// Claude Chat Saver - Content Script
// Scrapes conversation data from the Claude UI DOM

(function () {
  'use strict';

  const SCRAPE_DEBOUNCE_MS = 500;
  let debounceTimer = null;
  let floatingBtn = null;
  let isIncognito = false;
  let lastMessageCount = 0;

  // ── Detect incognito mode ──
  function detectIncognito() {
    // Check for incognito indicators in the DOM
    const disclaimers = document.querySelectorAll('[data-disclaimer]');
    for (const d of disclaimers) {
      if (d.textContent.toLowerCase().includes('incognito')) return true;
    }
    // Check header area
    const headerTexts = document.querySelectorAll('.text-bg-000, [class*="incognito"]');
    for (const el of headerTexts) {
      if (el.textContent.toLowerCase().includes('incognito')) return true;
    }
    // Check for the incognito icon/text in the top bar
    const body = document.body.textContent || '';
    if (body.includes('Incognito chat') || body.includes("Incognito chats aren't saved")) return true;
    return false;
  }

  // ── Extract conversation data ──
  function scrapeConversation() {
    const conversation = {
      url: window.location.href,
      timestamp: new Date().toISOString(),
      isIncognito: detectIncognito(),
      messages: [],
      files: [],
      artifacts: []
    };

    // Get all message render containers
    const renderContainers = document.querySelectorAll('[data-test-render-count]');

    renderContainers.forEach((container, index) => {
      // Check if it's a user message
      const userMsg = container.querySelector('[data-testid="user-message"]');
      if (userMsg) {
        const message = {
          role: 'user',
          index: index,
          content: extractTextContent(userMsg),
          timestamp: extractTimestamp(container),
          attachedFiles: extractAttachedFiles(container)
        };
        conversation.messages.push(message);
        return;
      }

      // Check if it's an assistant message
      const assistantMsg = container.querySelector('.font-claude-response');
      if (assistantMsg) {
        const message = {
          role: 'assistant',
          index: index,
          content: extractAssistantContent(assistantMsg),
          thinkingSteps: extractThinkingSteps(container),
          codeBlocks: extractCodeBlocks(assistantMsg),
          artifacts: extractArtifacts(container)
        };
        conversation.messages.push(message);
      }
    });

    // Extract all file references
    conversation.files = extractAllFiles();

    return conversation;
  }

  // ── Text extraction helpers ──
  function extractTextContent(el) {
    if (!el) return '';
    // Get text preserving whitespace from <p> and <pre> tags
    const paragraphs = el.querySelectorAll('p, pre, li, h1, h2, h3, h4, h5, h6');
    if (paragraphs.length > 0) {
      return Array.from(paragraphs)
        .map(p => p.textContent.trim())
        .filter(t => t)
        .join('\n');
    }
    return el.textContent.trim();
  }

  function extractAssistantContent(el) {
    if (!el) return '';
    const parts = [];

    // Walk through the standard-markdown sections
    const markdownSections = el.querySelectorAll('.standard-markdown, .progressive-markdown');
    markdownSections.forEach(section => {
      const children = section.children;
      for (const child of children) {
        if (child.tagName === 'P') {
          parts.push(child.textContent.trim());
        } else if (child.tagName === 'HR') {
          parts.push('---');
        } else if (child.tagName === 'UL' || child.tagName === 'OL') {
          const items = child.querySelectorAll('li');
          items.forEach((li, i) => {
            const prefix = child.tagName === 'OL' ? `${i + 1}. ` : '- ';
            parts.push(prefix + li.textContent.trim());
          });
        } else if (child.classList.contains('overflow-x-auto')) {
          // Table
          parts.push(extractTableContent(child));
        } else if (child.querySelector('pre')) {
          // Code block handled separately
        } else {
          const text = child.textContent.trim();
          if (text) parts.push(text);
        }
      }
    });

    return parts.join('\n\n');
  }

  function extractTableContent(tableWrapper) {
    const table = tableWrapper.querySelector('table');
    if (!table) return '';
    const rows = [];
    const headerCells = table.querySelectorAll('thead th');
    if (headerCells.length) {
      rows.push(Array.from(headerCells).map(th => th.textContent.trim()).join(' | '));
      rows.push(Array.from(headerCells).map(() => '---').join(' | '));
    }
    const bodyRows = table.querySelectorAll('tbody tr');
    bodyRows.forEach(tr => {
      const cells = tr.querySelectorAll('td');
      rows.push(Array.from(cells).map(td => td.textContent.trim()).join(' | '));
    });
    return rows.join('\n');
  }

  function extractTimestamp(container) {
    const timeEl = container.querySelector('.text-text-500.text-xs');
    return timeEl ? timeEl.textContent.trim() : null;
  }

  function extractThinkingSteps(container) {
    const steps = [];
    const thinkingBtns = container.querySelectorAll('button .truncate.text-sm');
    thinkingBtns.forEach(btn => {
      steps.push(btn.textContent.trim());
    });
    return steps;
  }

  function extractCodeBlocks(el) {
    const blocks = [];
    const codeGroups = el.querySelectorAll('[role="group"][aria-label*="code"]');
    codeGroups.forEach(group => {
      const langLabel = group.querySelector('.text-text-500.font-small');
      const codeEl = group.querySelector('code');
      blocks.push({
        language: langLabel ? langLabel.textContent.trim() : 'unknown',
        code: codeEl ? codeEl.textContent : ''
      });
    });

    // Also capture standalone code blocks
    if (blocks.length === 0) {
      const allPre = el.querySelectorAll('pre code');
      allPre.forEach(code => {
        const lang = code.className.replace('language-', '') || 'unknown';
        blocks.push({
          language: lang,
          code: code.textContent
        });
      });
    }

    return blocks;
  }

  function extractArtifacts(container) {
    const artifacts = [];
    const artifactBlocks = container.querySelectorAll('.artifact-block-cell');
    artifactBlocks.forEach(block => {
      const nameEl = block.querySelector('.leading-tight');
      const typeEl = block.querySelector('.text-text-400');
      artifacts.push({
        name: nameEl ? nameEl.textContent.trim() : 'Unknown',
        type: typeEl ? typeEl.textContent.trim() : ''
      });
    });
    return artifacts;
  }

  function extractAttachedFiles(container) {
    const files = [];
    // Thumbnail file attachments
    const thumbnails = container.querySelectorAll('[data-testid="file-thumbnail"], [data-testid]');
    thumbnails.forEach(thumb => {
      const testId = thumb.getAttribute('data-testid');
      if (testId && testId !== 'user-message' && testId !== 'file-upload') {
        // Check if it's a file thumbnail (has an image or file name)
        const nameEl = thumb.querySelector('h3') || thumb.querySelector('[alt]');
        if (nameEl) {
          const name = nameEl.textContent?.trim() || nameEl.getAttribute('alt') || testId;
          const typeEl = thumb.querySelector('p.uppercase');
          files.push({
            name: name,
            type: typeEl ? typeEl.textContent.trim() : '',
            thumbnailSrc: thumb.querySelector('img')?.src || null
          });
        }
      }
    });
    return files;
  }

  function extractAllFiles() {
    const files = [];
    const seen = new Set();

    // All file thumbnails across the conversation
    document.querySelectorAll('[data-testid="file-thumbnail"] button, [data-testid$=".pdf"], [data-testid$=".png"], [data-testid$=".jpg"], [data-testid$=".md"], [data-testid$=".ipynb"], [data-testid$=".py"]').forEach(el => {
      const container = el.closest('[data-testid]') || el;
      const testId = container.getAttribute('data-testid');
      const nameEl = container.querySelector('h3') || container.querySelector('[alt]');
      const name = nameEl?.textContent?.trim() || nameEl?.getAttribute('alt') || testId || '';

      if (name && !seen.has(name)) {
        seen.add(name);
        const typeEl = container.querySelector('p.uppercase');
        const imgEl = container.querySelector('img');
        files.push({
          name: name,
          type: typeEl ? typeEl.textContent.trim().toLowerCase() : name.split('.').pop(),
          thumbnailSrc: imgEl?.src || null
        });
      }
    });

    return files;
  }

  // ── Convert to various export formats ──
  function toMarkdown(conversation) {
    let md = `# Claude Conversation${conversation.isIncognito ? ' (Incognito)' : ''}\n\n`;
    md += `**Saved:** ${new Date(conversation.timestamp).toLocaleString()}\n`;
    md += `**URL:** ${conversation.url}\n\n`;

    if (conversation.files.length > 0) {
      md += `## Attached Files\n\n`;
      conversation.files.forEach(f => {
        md += `- **${f.name}** (${f.type})\n`;
      });
      md += '\n';
    }

    md += `---\n\n`;

    conversation.messages.forEach(msg => {
      if (msg.role === 'user') {
        md += `## 🧑 User`;
        if (msg.timestamp) md += ` *(${msg.timestamp})*`;
        md += `\n\n`;
        md += msg.content + '\n';
        if (msg.attachedFiles && msg.attachedFiles.length > 0) {
          md += '\n📎 Attached: ' + msg.attachedFiles.map(f => f.name).join(', ') + '\n';
        }
        md += '\n';
      } else {
        md += `## 🤖 Claude\n\n`;
        if (msg.thinkingSteps && msg.thinkingSteps.length > 0) {
          md += `<details>\n<summary>💭 Thinking Steps</summary>\n\n`;
          msg.thinkingSteps.forEach(s => md += `- ${s}\n`);
          md += `\n</details>\n\n`;
        }
        md += msg.content + '\n';
        if (msg.codeBlocks && msg.codeBlocks.length > 0) {
          msg.codeBlocks.forEach(cb => {
            md += `\n\`\`\`${cb.language}\n${cb.code}\n\`\`\`\n`;
          });
        }
        if (msg.artifacts && msg.artifacts.length > 0) {
          md += '\n📦 Artifacts: ' + msg.artifacts.map(a => `${a.name} (${a.type})`).join(', ') + '\n';
        }
        md += '\n';
      }
      md += `---\n\n`;
    });

    return md;
  }

  function toJSON(conversation) {
    return JSON.stringify(conversation, null, 2);
  }

  function toHTML(conversation) {
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Conversation - ${new Date(conversation.timestamp).toLocaleDateString()}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #e0e0e0; line-height: 1.7; padding: 2rem; max-width: 900px; margin: 0 auto; }
  h1 { color: #e8a87c; margin-bottom: 0.5rem; font-size: 1.5rem; }
  .meta { color: #888; font-size: 0.85rem; margin-bottom: 2rem; }
  .msg { margin-bottom: 1.5rem; padding: 1.25rem; border-radius: 12px; }
  .msg.user { background: #16213e; border-left: 3px solid #e8a87c; }
  .msg.assistant { background: #0f3460; border-left: 3px solid #53a8b6; }
  .role { font-weight: 700; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
  .msg.user .role { color: #e8a87c; }
  .msg.assistant .role { color: #53a8b6; }
  .content { white-space: pre-wrap; }
  pre { background: #0d1117; padding: 1rem; border-radius: 8px; overflow-x: auto; margin: 0.5rem 0; font-size: 0.85rem; }
  code { font-family: 'Fira Code', 'Cascadia Code', monospace; }
  .thinking { color: #888; font-size: 0.8rem; margin-bottom: 0.5rem; font-style: italic; }
  .files { background: #1a1a2e; padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; }
  .files span { background: #16213e; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; margin-right: 4px; }
  .separator { border: none; border-top: 1px solid #222; margin: 1rem 0; }
</style>
</head>
<body>
<h1>Claude Conversation${conversation.isIncognito ? ' (Incognito)' : ''}</h1>
<div class="meta">Saved: ${new Date(conversation.timestamp).toLocaleString()} | ${conversation.messages.length} messages</div>
`;

    if (conversation.files.length > 0) {
      html += `<div class="files"><strong>Files:</strong> `;
      conversation.files.forEach(f => {
        html += `<span>${escapeHtml(f.name)}</span> `;
      });
      html += `</div>`;
    }

    conversation.messages.forEach(msg => {
      const cls = msg.role === 'user' ? 'user' : 'assistant';
      const label = msg.role === 'user' ? '🧑 You' : '🤖 Claude';
      html += `<div class="msg ${cls}">`;
      html += `<div class="role">${label}`;
      if (msg.timestamp) html += ` <span style="font-weight:normal;color:#666">${escapeHtml(msg.timestamp)}</span>`;
      html += `</div>`;

      if (msg.thinkingSteps && msg.thinkingSteps.length) {
        msg.thinkingSteps.forEach(s => {
          html += `<div class="thinking">💭 ${escapeHtml(s)}</div>`;
        });
      }

      html += `<div class="content">${escapeHtml(msg.content)}</div>`;

      if (msg.codeBlocks && msg.codeBlocks.length) {
        msg.codeBlocks.forEach(cb => {
          html += `<pre><code>// ${escapeHtml(cb.language)}\n${escapeHtml(cb.code)}</code></pre>`;
        });
      }

      if (msg.attachedFiles && msg.attachedFiles.length) {
        html += `<div class="files" style="margin-top:0.5rem"><strong>📎</strong> `;
        msg.attachedFiles.forEach(f => html += `<span>${escapeHtml(f.name)}</span> `);
        html += `</div>`;
      }

      if (msg.artifacts && msg.artifacts.length) {
        html += `<div class="files" style="margin-top:0.5rem"><strong>📦</strong> `;
        msg.artifacts.forEach(a => html += `<span>${escapeHtml(a.name)} (${escapeHtml(a.type)})</span> `);
        html += `</div>`;
      }

      html += `</div>\n`;
    });

    html += `</body></html>`;
    return html;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Storage ──
  function saveConversation(conversation) {
    return new Promise((resolve, reject) => {
      const key = `conv_${Date.now()}`;
      const summary = {
        key,
        timestamp: conversation.timestamp,
        messageCount: conversation.messages.length,
        fileCount: conversation.files.length,
        preview: conversation.messages[0]?.content?.substring(0, 100) || 'Empty conversation',
        isIncognito: conversation.isIncognito
      };

      chrome.storage.local.set({
        [key]: conversation,
        [`meta_${key}`]: summary
      }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(summary);
        }
      });
    });
  }

  // ── Floating save button ──
  function createFloatingButton() {
    if (floatingBtn) return;

    floatingBtn = document.createElement('div');
    floatingBtn.id = 'claude-saver-fab';
    floatingBtn.innerHTML = `
      <button id="cs-save-btn" title="Save this conversation">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
      </button>
      <div id="cs-menu" class="cs-hidden">
        <button data-format="md">📝 Save as Markdown</button>
        <button data-format="json">📋 Save as JSON</button>
        <button data-format="pdf">📄 Save as PDF</button>
        <button data-format="clipboard">📎 Copy to Clipboard</button>
        <hr>
        <button data-format="storage">💾 Save to Extension</button>
      </div>
      <div id="cs-toast" class="cs-hidden"></div>
    `;
    document.body.appendChild(floatingBtn);

    // Event listeners
    const saveBtn = floatingBtn.querySelector('#cs-save-btn');
    const menu = floatingBtn.querySelector('#cs-menu');

    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('cs-hidden');
    });

    document.addEventListener('click', () => {
      menu.classList.add('cs-hidden');
    });

    menu.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-format]');
      if (!btn) return;
      e.stopPropagation();
      menu.classList.add('cs-hidden');

      const format = btn.dataset.format;
      const conversation = scrapeConversation();

      if (conversation.messages.length === 0) {
        showToast('No messages found to save', 'warn');
        return;
      }

      try {
        switch (format) {
          case 'md': {
            const content = toMarkdown(conversation);
            downloadFile(content, `claude-conversation-${dateSlug()}.md`, 'text/markdown');
            showToast(`Saved ${conversation.messages.length} messages as Markdown`);
            break;
          }
          case 'json': {
            const content = toJSON(conversation);
            downloadFile(content, `claude-conversation-${dateSlug()}.json`, 'application/json');
            showToast(`Saved ${conversation.messages.length} messages as JSON`);
            break;
          }
          case 'pdf': {
            const content = toHTML(conversation);
            // Store HTML and open print page for PDF export
            chrome.storage.local.set({ _print_temp: content }, () => {
              chrome.runtime.sendMessage({ action: 'openPrintPage' });
            });
            showToast('Opening print dialog — save as PDF');
            break;
          }
          case 'clipboard': {
            const content = toMarkdown(conversation);
            await navigator.clipboard.writeText(content);
            showToast('Copied to clipboard!');
            break;
          }
          case 'storage': {
            const summary = await saveConversation(conversation);
            showToast(`Saved! (${summary.messageCount} messages, ${summary.fileCount} files)`);
            break;
          }
        }
      } catch (err) {
        console.error('Claude Saver error:', err);
        showToast('Error saving: ' + err.message, 'error');
      }
    });
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function dateSlug() {
    return new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  }

  function showToast(message, type = 'success') {
    const toast = document.getElementById('cs-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `cs-toast cs-toast-${type}`;
    setTimeout(() => {
      toast.className = 'cs-hidden';
    }, 3000);
  }

  // ── Auto-detect new messages for badge ──
  function checkForNewMessages() {
    const msgs = document.querySelectorAll('[data-test-render-count]');
    const count = msgs.length;
    if (count !== lastMessageCount) {
      lastMessageCount = count;
      updateBadge(count);
    }
  }

  function updateBadge(count) {
    const badge = floatingBtn?.querySelector('.cs-badge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  }

  // ── Initialize ──
  function init() {
    isIncognito = detectIncognito();
    createFloatingButton();

    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        isIncognito = detectIncognito();
        checkForNewMessages();
      }, SCRAPE_DEBOUNCE_MS);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
