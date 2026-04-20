/**
 * Summary Overlay Injector
 * 
 * Injects a centered modal overlay into the active tab for reading summaries.
 * This script is executed via chrome.scripting.executeScript with the summary text as argument.
 * 
 * Usage: chrome.scripting.executeScript({
 *   target: { tabId },
 *   func: injectSummaryOverlay,
 *   args: [summaryText]
 * });
 */

(function() {
  'use strict';

  // Check if overlay already exists
  const existingOverlay = document.getElementById('tab-summarizer-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }

  // Get summary text from arguments (passed via executeScript)
  const summaryText = window.__tabSummarizerSummary || '';
  delete window.__tabSummarizerSummary;

  if (!summaryText) return;

  // Create overlay container
  const overlay = document.createElement('div');
  overlay.id = 'tab-summarizer-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(2px);
    animation: ts-fade-in 200ms ease-out;
  `;

  // Create dialog
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    position: relative;
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0, 0, 0, 0.05);
    width: 90%;
    max-width: 720px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: ts-slide-in 250ms cubic-bezier(0.4, 0, 0.2, 1);
  `;

  // Create header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid #e8eaed;
  `;

  const title = document.createElement('h2');
  title.style.cssText = `
    font-size: 16px;
    font-weight: 600;
    color: #1f1f1f;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  `;
  title.textContent = 'Summary';

  const closeBtn = document.createElement('button');
  closeBtn.id = 'tab-summarizer-close-btn';
  closeBtn.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: #444746;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    transition: all 150ms ease;
  `;
  closeBtn.innerHTML = '&#x2715;';
  closeBtn.title = 'Close';
  closeBtn.onmouseover = () => { closeBtn.style.background = '#f8f9fa'; closeBtn.style.color = '#1f1f1f'; };
  closeBtn.onmouseout = () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = '#444746'; };

  header.appendChild(title);
  header.appendChild(closeBtn);

  // Create body
  const body = document.createElement('div');
  body.style.cssText = `
    padding: 20px;
    overflow-y: auto;
    font-size: 14px;
    line-height: 1.7;
    color: #1f1f1f;
    white-space: pre-wrap;
    word-wrap: break-word;
  `;
  body.textContent = summaryText;

  dialog.appendChild(header);
  dialog.appendChild(body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Close handlers
  function closeOverlay() {
    overlay.style.animation = 'ts-fade-out 150ms ease-in forwards';
    setTimeout(() => overlay.remove(), 150);
  }

  closeBtn.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      closeOverlay();
      document.removeEventListener('keydown', escHandler);
    }
  });

  // Add animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ts-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ts-fade-out { from { opacity: 1; } to { opacity: 0; } }
    @keyframes ts-slide-in { from { opacity: 0; transform: translateY(-20px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
  `;
  document.head.appendChild(style);

  return { success: true };
})();
