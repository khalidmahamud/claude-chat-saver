// Claude Chat Saver - Injectable Scraper
// MUST be an IIFE that returns the result — chrome.scripting.executeScript
// captures the value of the last evaluated expression.
(() => {
  function detectIncognito() {
    const body = document.body.textContent || '';
    return body.includes('Incognito chat') || body.includes("Incognito chats aren't saved");
  }

  function extractTextContent(el) {
    if (!el) return '';
    const parts = el.querySelectorAll('p, pre, li, h1, h2, h3, h4, h5, h6');
    if (parts.length > 0) {
      return Array.from(parts).map(p => p.textContent.trim()).filter(Boolean).join('\n');
    }
    return el.textContent.trim();
  }

  function extractAssistantContent(el) {
    if (!el) return '';
    const parts = [];
    const sections = el.querySelectorAll('.standard-markdown, .progressive-markdown');
    sections.forEach(section => {
      for (const child of section.children) {
        if (child.tagName === 'P') {
          parts.push(child.textContent.trim());
        } else if (child.tagName === 'HR') {
          parts.push('---');
        } else if (child.tagName === 'UL' || child.tagName === 'OL') {
          child.querySelectorAll('li').forEach((li, i) => {
            parts.push((child.tagName === 'OL' ? `${i + 1}. ` : '- ') + li.textContent.trim());
          });
        } else if (child.querySelector && child.querySelector('table')) {
          const table = child.querySelector('table');
          const rows = [];
          const ths = table.querySelectorAll('thead th');
          if (ths.length) {
            rows.push(Array.from(ths).map(th => th.textContent.trim()).join(' | '));
            rows.push(Array.from(ths).map(() => '---').join(' | '));
          }
          table.querySelectorAll('tbody tr').forEach(tr => {
            rows.push(Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()).join(' | '));
          });
          parts.push(rows.join('\n'));
        } else {
          const t = child.textContent.trim();
          if (t) parts.push(t);
        }
      }
    });
    return parts.join('\n\n');
  }

  function extractTimestamp(container) {
    const el = container.querySelector('.text-text-500.text-xs');
    return el ? el.textContent.trim() : null;
  }

  function extractThinkingSteps(container) {
    return Array.from(container.querySelectorAll('button .truncate.text-sm'))
      .map(el => el.textContent.trim());
  }

  function extractCodeBlocks(el) {
    const blocks = [];
    el.querySelectorAll('[role="group"][aria-label*="code"]').forEach(group => {
      const lang = group.querySelector('.text-text-500.font-small');
      const code = group.querySelector('code');
      blocks.push({
        language: lang ? lang.textContent.trim() : 'unknown',
        code: code ? code.textContent : ''
      });
    });
    if (blocks.length === 0) {
      el.querySelectorAll('pre code').forEach(code => {
        blocks.push({
          language: (code.className || '').replace('language-', '') || 'unknown',
          code: code.textContent
        });
      });
    }
    return blocks;
  }

  function extractArtifacts(container) {
    return Array.from(container.querySelectorAll('.artifact-block-cell')).map(block => ({
      name: block.querySelector('.leading-tight')?.textContent?.trim() || 'Unknown',
      type: block.querySelector('.text-text-400')?.textContent?.trim() || ''
    }));
  }

  function extractAttachedFiles(container) {
    const files = [];
    container.querySelectorAll('[data-testid]').forEach(el => {
      const tid = el.getAttribute('data-testid');
      if (!tid || tid === 'user-message' || tid === 'file-upload') return;
      const nameEl = el.querySelector('h3') || el.querySelector('[alt]');
      if (nameEl) {
        files.push({
          name: nameEl.textContent?.trim() || nameEl.getAttribute('alt') || tid,
          type: el.querySelector('p.uppercase')?.textContent?.trim() || '',
          thumbnailSrc: el.querySelector('img')?.src || null
        });
      }
    });
    return files;
  }

  function extractAllFiles() {
    const files = [];
    const seen = new Set();
    document.querySelectorAll(
      '[data-testid="file-thumbnail"] button, ' +
      '[data-testid$=".pdf"], [data-testid$=".png"], [data-testid$=".jpg"], ' +
      '[data-testid$=".md"], [data-testid$=".ipynb"], [data-testid$=".py"], ' +
      '[data-testid$=".txt"], [data-testid$=".csv"], [data-testid$=".xlsx"]'
    ).forEach(el => {
      const container = el.closest('[data-testid]') || el;
      const nameEl = container.querySelector('h3') || container.querySelector('[alt]');
      const name = nameEl?.textContent?.trim() || nameEl?.getAttribute('alt') || container.getAttribute('data-testid') || '';
      if (name && !seen.has(name)) {
        seen.add(name);
        files.push({
          name,
          type: container.querySelector('p.uppercase')?.textContent?.trim()?.toLowerCase() || name.split('.').pop(),
          thumbnailSrc: container.querySelector('img')?.src || null
        });
      }
    });
    return files;
  }

  // ── Main scrape ──
  const conversation = {
    url: window.location.href,
    timestamp: new Date().toISOString(),
    isIncognito: detectIncognito(),
    messages: [],
    files: []
  };

  document.querySelectorAll('[data-test-render-count]').forEach((container, index) => {
    const userMsg = container.querySelector('[data-testid="user-message"]');
    if (userMsg) {
      conversation.messages.push({
        role: 'user',
        index,
        content: extractTextContent(userMsg),
        timestamp: extractTimestamp(container),
        attachedFiles: extractAttachedFiles(container)
      });
      return;
    }
    const assistantMsg = container.querySelector('.font-claude-response');
    if (assistantMsg) {
      conversation.messages.push({
        role: 'assistant',
        index,
        content: extractAssistantContent(assistantMsg),
        thinkingSteps: extractThinkingSteps(container),
        codeBlocks: extractCodeBlocks(assistantMsg),
        artifacts: extractArtifacts(container)
      });
    }
  });

  conversation.files = extractAllFiles();

  // Return plain object — this is what executeScript captures
  return conversation;
})();
