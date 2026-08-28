(function() {
  'use strict';

  const originalAttachShadow = Element.prototype.attachShadow;
  if (originalAttachShadow.__tabSummarizerPatched) return;

  function attachShadowWithOpenReference(options) {
    const shadowRoot = originalAttachShadow.call(this, options);
    this.__shadowRootForSummarizer = shadowRoot;
    return shadowRoot;
  }

  Object.defineProperty(attachShadowWithOpenReference, '__tabSummarizerPatched', {
    value: true
  });
  Element.prototype.attachShadow = attachShadowWithOpenReference;
})();
