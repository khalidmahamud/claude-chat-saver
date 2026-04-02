// Claude Chat Saver - Background Service Worker

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSavedConversations') {
    chrome.storage.local.get(null, (items) => {
      const metas = [];
      for (const [key, value] of Object.entries(items)) {
        if (key.startsWith('meta_conv_')) {
          metas.push(value);
        }
      }
      // Sort by timestamp descending
      metas.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      sendResponse(metas);
    });
    return true;
  }

  if (request.action === 'getConversation') {
    chrome.storage.local.get(request.key, (items) => {
      sendResponse(items[request.key] || null);
    });
    return true;
  }

  if (request.action === 'deleteConversation') {
    chrome.storage.local.remove([request.key, `meta_${request.key}`], () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'deleteAll') {
    chrome.storage.local.clear(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'openPrintPage') {
    chrome.tabs.create({ url: chrome.runtime.getURL('print.html') });
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'getStorageUsage') {
    chrome.storage.local.getBytesInUse(null, (bytes) => {
      sendResponse({
        used: bytes,
        quota: chrome.storage.local.QUOTA_BYTES || 10485760,
        usedMB: (bytes / 1024 / 1024).toFixed(2),
        quotaMB: ((chrome.storage.local.QUOTA_BYTES || 10485760) / 1024 / 1024).toFixed(0)
      });
    });
    return true;
  }
});

// Badge update when on claude.ai
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes('claude.ai')) {
    chrome.action.setBadgeBackgroundColor({ color: '#e8a87c' });
  }
});
