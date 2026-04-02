// Claude Chat Saver - Popup Script
// Uses chrome.scripting.executeScript to inject the scraper on-demand.
// This means it works on already-open tabs WITHOUT needing a page refresh.

document.addEventListener('DOMContentLoaded', init);

async function init() {
  loadSavedConversations();
  loadStorageInfo();

  document.getElementById('btn-save-md').addEventListener('click', () => exportConversation('md'));
  document.getElementById('btn-save-json').addEventListener('click', () => exportConversation('json'));
  document.getElementById('btn-save-pdf').addEventListener('click', () => exportConversation('pdf'));
  document.getElementById('btn-save-storage').addEventListener('click', saveToStorage);
  document.getElementById('btn-copy').addEventListener('click', copyToClipboard);
  document.getElementById('btn-clear-all').addEventListener('click', clearAll);
}

// ═══════════════════════════════════════════════════════════════
// KEY FIX: Inject scraper into the active tab on-demand.
// chrome.scripting.executeScript does NOT need a pre-loaded
// content script, so it works on tabs opened before the
// extension was installed — no refresh needed.
// ═══════════════════════════════════════════════════════════════
async function scrapeActiveTab() {
  let tab;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  } catch (e) {
    throw new Error('Cannot access tabs: ' + e.message);
  }

  if (!tab) {
    throw new Error('No active tab found.');
  }

  // Check URL — tab.url may be undefined without "tabs" permission,
  // so also try tab.pendingUrl or just attempt injection anyway.
  const url = tab.url || tab.pendingUrl || '';
  if (url && !url.includes('claude.ai')) {
    throw new Error('Not on claude.ai (current: ' + url.substring(0, 40) + ')');
  }

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['js/scraper.js']
    });
  } catch (e) {
    throw new Error('Injection failed: ' + e.message);
  }

  console.log('executeScript results:', results);

  if (!results || results.length === 0) {
    throw new Error('Script execution returned no results.');
  }

  const data = results[0].result;
  if (!data) {
    throw new Error('Scraper returned null. The page may still be loading.');
  }

  return data;
}

// ── PDF export via print dialog ──
async function exportPDF(conversation) {
  const html = toHTML(conversation);
  // Store the HTML temporarily so print.html can read it
  const tempKey = '_print_temp';
  await chrome.storage.local.set({ [tempKey]: html });
  await chrome.tabs.create({ url: chrome.runtime.getURL('print.html') });
}

// ── Export ──
async function exportConversation(format) {
  setStatus('Scraping...', 'saving');
  try {
    const conversation = await scrapeActiveTab();
    if (conversation.messages.length === 0) {
      setStatus('No messages found on page', 'error');
      return;
    }

    const slug = dateSlug(conversation.timestamp);

    if (format === 'pdf') {
      await exportPDF(conversation);
      setStatus(`Opened print dialog for ${conversation.messages.length} messages`, 'success');
      return;
    }

    let content, filename;
    switch (format) {
      case 'md':   content = toMarkdown(conversation); filename = `claude-${slug}.md`; break;
      case 'json': content = JSON.stringify(conversation, null, 2); filename = `claude-${slug}.json`; break;
    }

    downloadFile(content, filename, getMimeType(format));
    setStatus(`Exported ${conversation.messages.length} messages as ${format.toUpperCase()}!`, 'success');
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

// ── Save to extension storage ──
async function saveToStorage() {
  setStatus('Saving...', 'saving');
  try {
    const conversation = await scrapeActiveTab();
    if (conversation.messages.length === 0) {
      setStatus('No messages to save', 'error');
      return;
    }

    const key = `conv_${Date.now()}`;
    const summary = {
      key,
      timestamp: conversation.timestamp,
      messageCount: conversation.messages.length,
      fileCount: conversation.files.length,
      preview: conversation.messages[0]?.content?.substring(0, 120) || 'Empty',
      isIncognito: conversation.isIncognito
    };

    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: conversation, [`meta_${key}`]: summary }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });

    setStatus(`Saved! ${summary.messageCount} msgs, ${summary.fileCount} files`, 'success');
    loadSavedConversations();
    loadStorageInfo();
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

// ── Copy to clipboard ──
async function copyToClipboard() {
  setStatus('Copying...', 'saving');
  try {
    const conversation = await scrapeActiveTab();
    if (conversation.messages.length === 0) {
      setStatus('No messages to copy', 'error');
      return;
    }
    await navigator.clipboard.writeText(toMarkdown(conversation));
    setStatus(`Copied ${conversation.messages.length} messages!`, 'success');
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

// ── Saved conversations list ──
function loadSavedConversations() {
  chrome.storage.local.get(null, (items) => {
    const metas = [];
    for (const [key, value] of Object.entries(items)) {
      if (key.startsWith('meta_conv_')) metas.push(value);
    }
    metas.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const list = document.getElementById('saved-list');
    if (metas.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <p>No saved conversations yet.</p>
          <p class="hint">Click "Save Local" to store a conversation.</p>
        </div>`;
      return;
    }

    list.innerHTML = metas.map(meta => `
      <div class="conv-card" data-key="${meta.key}">
        <div class="conv-card-top">
          <div class="conv-preview">${escapeHtml(meta.preview)}</div>
        </div>
        <div class="conv-meta">
          <span>${formatDate(meta.timestamp)}</span>
          <span class="tag">${meta.messageCount} msgs</span>
          ${meta.fileCount > 0 ? `<span class="tag">${meta.fileCount} files</span>` : ''}
          ${meta.isIncognito ? '<span class="tag incognito">🕶️ incognito</span>' : ''}
        </div>
        <div class="conv-actions">
          <button class="btn btn-primary btn-sm" data-export-key="${meta.key}" data-export-fmt="md">📝 MD</button>
          <button class="btn btn-primary btn-sm" data-export-key="${meta.key}" data-export-fmt="json">📋 JSON</button>
          <button class="btn btn-primary btn-sm" data-export-key="${meta.key}" data-export-fmt="pdf">📄 PDF</button>
          <button class="btn btn-danger btn-sm" data-delete-key="${meta.key}">🗑️</button>
        </div>
      </div>
    `).join('');

    // Bind export buttons
    list.querySelectorAll('[data-export-key]').forEach(btn => {
      btn.addEventListener('click', () => exportSaved(btn.dataset.exportKey, btn.dataset.exportFmt));
    });
    // Bind delete buttons
    list.querySelectorAll('[data-delete-key]').forEach(btn => {
      btn.addEventListener('click', () => deleteSaved(btn.dataset.deleteKey));
    });
  });
}

// ── Export a previously saved conversation ──
async function exportSaved(key, format) {
  chrome.storage.local.get(key, async (items) => {
    const conv = items[key];
    if (!conv) { setStatus('Not found', 'error'); return; }

    if (format === 'pdf') {
      await exportPDF(conv);
      setStatus('Opened print dialog', 'success');
      return;
    }

    let content, filename;
    const slug = dateSlug(conv.timestamp);
    switch (format) {
      case 'md':   content = toMarkdown(conv); filename = `claude-${slug}.md`; break;
      case 'json': content = JSON.stringify(conv, null, 2); filename = `claude-${slug}.json`; break;
    }
    downloadFile(content, filename, getMimeType(format));
    setStatus(`Exported as ${format.toUpperCase()}`, 'success');
  });
}

function deleteSaved(key) {
  if (!confirm('Delete this conversation?')) return;
  chrome.storage.local.remove([key, `meta_${key}`], () => {
    loadSavedConversations(); loadStorageInfo(); setStatus('Deleted', 'success');
  });
}

function clearAll() {
  if (!confirm('Delete ALL saved conversations? Cannot undo.')) return;
  chrome.storage.local.clear(() => {
    loadSavedConversations(); loadStorageInfo(); setStatus('All cleared', 'success');
  });
}

function loadStorageInfo() {
  chrome.storage.local.getBytesInUse(null, (bytes) => {
    const usedMB = (bytes / 1024 / 1024).toFixed(2);
    const quotaMB = ((chrome.storage.local.QUOTA_BYTES || 10485760) / 1024 / 1024).toFixed(0);
    document.getElementById('storage-badge').textContent = `${usedMB} MB`;
    document.getElementById('storage-info').textContent = `${usedMB} / ${quotaMB} MB`;
  });
}

// ══════════════════════════════════
// Converters
// ══════════════════════════════════

function toMarkdown(conv) {
  let md = `# Claude Conversation${conv.isIncognito ? ' (Incognito)' : ''}\n\n`;
  md += `**Saved:** ${new Date(conv.timestamp).toLocaleString()}\n`;
  md += `**URL:** ${conv.url}\n\n`;
  if (conv.files?.length) {
    md += `## Attached Files\n\n`;
    conv.files.forEach(f => md += `- **${f.name}** (${f.type})\n`);
    md += '\n';
  }
  md += `---\n\n`;
  conv.messages.forEach(msg => {
    if (msg.role === 'user') {
      md += `## 🧑 User`;
      if (msg.timestamp) md += ` *(${msg.timestamp})*`;
      md += `\n\n${msg.content}\n`;
      if (msg.attachedFiles?.length)
        md += '\n📎 Attached: ' + msg.attachedFiles.map(f => f.name).join(', ') + '\n';
    } else {
      md += `## 🤖 Claude\n\n`;
      if (msg.thinkingSteps?.length) {
        md += `<details>\n<summary>💭 Thinking Steps</summary>\n\n`;
        msg.thinkingSteps.forEach(s => md += `- ${s}\n`);
        md += `\n</details>\n\n`;
      }
      md += msg.content + '\n';
      if (msg.codeBlocks?.length)
        msg.codeBlocks.forEach(cb => md += `\n\`\`\`${cb.language}\n${cb.code}\n\`\`\`\n`);
      if (msg.artifacts?.length)
        md += '\n📦 Artifacts: ' + msg.artifacts.map(a => `${a.name} (${a.type})`).join(', ') + '\n';
    }
    md += '\n---\n\n';
  });
  return md;
}

function toHTML(conv) {
  const e = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let h = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Claude Conversation</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Söhne',ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f1eb;color:#3d3929;line-height:1.6;min-height:100vh}
.container{max-width:780px;margin:0 auto;padding:0}

/* Header */
.header{background:#d4a27f;padding:18px 28px;text-align:center}
.header h1{font-size:16px;font-weight:600;color:#fff;letter-spacing:.01em}
.header .meta{font-size:12px;color:rgba(255,255,255,.75);margin-top:4px}

/* Files bar */
.file-bar{display:flex;flex-wrap:wrap;gap:6px;padding:12px 28px;background:#ece6dd;border-bottom:1px solid #ddd5c9}
.file-chip{display:inline-flex;align-items:center;gap:5px;background:#fff;border:1px solid #d4cdc2;border-radius:6px;padding:4px 10px;font-size:12px;color:#5d5548}
.file-chip::before{content:'';display:inline-block;width:14px;height:14px;background:#d4a27f;border-radius:3px;flex-shrink:0}

/* Messages */
.messages{padding:0}
.msg{padding:24px 28px}
.msg+.msg{border-top:1px solid #e5ded4}
.msg.user{background:#f5f1eb}
.msg.assistant{background:#faf8f5}

/* Role label */
.role-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.avatar{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0}
.user .avatar{background:#e8ddd0;color:#8b7355}
.assistant .avatar{background:#d4a27f;color:#fff}
.role-name{font-size:13px;font-weight:600;color:#3d3929}
.role-time{font-size:11px;color:#9b917f;margin-left:auto}

/* Content */
.content{font-size:14.5px;color:#3d3929;white-space:pre-wrap;word-wrap:break-word}
.msg.assistant .content{color:#2e2a20}

/* Thinking */
.thinking-block{margin-bottom:12px;padding:10px 14px;background:rgba(212,162,127,.08);border-radius:8px;border:1px solid rgba(212,162,127,.15)}
.thinking-label{font-size:11px;font-weight:600;color:#d4a27f;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.thinking-step{font-size:12.5px;color:#8b7355;font-style:italic;line-height:1.5}

/* Code */
pre{background:#2b2b2b;color:#e6e1d9;padding:14px 16px;border-radius:8px;overflow-x:auto;margin:10px 0;font-size:13px;line-height:1.5}
pre .lang{display:block;font-size:11px;color:#9b917f;margin-bottom:6px;font-family:inherit;font-style:normal}
code{font-family:'Fira Code','SF Mono','Cascadia Code','Consolas',monospace}

/* Attachments */
.attachments{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.attach-chip{display:inline-flex;align-items:center;gap:5px;background:#ece6dd;border:1px solid #ddd5c9;border-radius:6px;padding:4px 10px;font-size:12px;color:#5d5548}

/* Print */
@media print{
  body{background:#fff}
  .header{background:#d4a27f;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .msg{break-inside:avoid}
  .msg.user{background:#faf8f5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .msg.assistant{background:#fff}
  pre{background:#f5f3f0;color:#2b2b2b;border:1px solid #e5ded4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .avatar{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .thinking-block{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style></head><body>
<div class="container">
<div class="header">
  <h1>Claude Conversation${conv.isIncognito ? ' (Incognito)' : ''}</h1>
  <div class="meta">${e(new Date(conv.timestamp).toLocaleString())} &middot; ${conv.messages.length} messages</div>
</div>`;

  if (conv.files?.length) {
    h += `<div class="file-bar">`;
    conv.files.forEach(f => h += `<span class="file-chip">${e(f.name)}</span>`);
    h += `</div>`;
  }

  h += `<div class="messages">`;
  conv.messages.forEach(msg => {
    const isUser = msg.role === 'user';
    const cls = isUser ? 'user' : 'assistant';
    const initial = isUser ? 'Y' : 'C';
    const name = isUser ? 'You' : 'Claude';
    h += `<div class="msg ${cls}">`;
    h += `<div class="role-row"><div class="avatar">${initial}</div><span class="role-name">${name}</span>`;
    if (msg.timestamp) h += `<span class="role-time">${e(msg.timestamp)}</span>`;
    h += `</div>`;

    if (msg.thinkingSteps?.length) {
      h += `<div class="thinking-block"><div class="thinking-label">Thinking</div>`;
      msg.thinkingSteps.forEach(s => h += `<div class="thinking-step">${e(s)}</div>`);
      h += `</div>`;
    }

    h += `<div class="content">${e(msg.content)}</div>`;

    if (msg.codeBlocks?.length) {
      msg.codeBlocks.forEach(cb => {
        h += `<pre><code><span class="lang">${e(cb.language)}</span>${e(cb.code)}</code></pre>`;
      });
    }

    if (msg.attachedFiles?.length) {
      h += `<div class="attachments">`;
      msg.attachedFiles.forEach(f => h += `<span class="attach-chip">${e(f.name)}</span>`);
      h += `</div>`;
    }

    if (msg.artifacts?.length) {
      h += `<div class="attachments">`;
      msg.artifacts.forEach(a => h += `<span class="attach-chip">${e(a.name)} (${e(a.type)})</span>`);
      h += `</div>`;
    }

    h += `</div>\n`;
  });
  h += `</div></div></body></html>`;
  return h;
}

// ── Helpers ──
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function getMimeType(f) { return {md:'text/markdown',json:'application/json',html:'text/html'}[f]||'text/plain'; }
function dateSlug(iso) { return (iso||new Date().toISOString()).replace(/[:.]/g,'-').substring(0,19); }
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso), hrs = (Date.now()-d)/3600000;
  if (hrs<1) return `${Math.floor((Date.now()-d)/60000)}m ago`;
  if (hrs<24) return `${Math.floor(hrs)}h ago`;
  if (hrs<48) return 'Yesterday';
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function escapeHtml(s) { if(!s)return''; const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function setStatus(text, type='') {
  const el = document.getElementById('status-text');
  el.textContent = text; el.className = type ? `status-${type}` : '';
  if (type==='success'||type==='error') setTimeout(()=>{el.textContent='Ready';el.className='';},3000);
}
