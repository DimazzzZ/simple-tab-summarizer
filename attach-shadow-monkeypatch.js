(function() {
  try {
    var script = document.createElement('script');
    script.src = chrome.runtime.getURL('shadow-monkeypatch-world.js');
    document.documentElement.appendChild(script);
    script.remove();
  } catch(e) {
    console.warn('[TabSummarizer] Failed to inject attachShadow monkeypatch:', e);
  }
})();