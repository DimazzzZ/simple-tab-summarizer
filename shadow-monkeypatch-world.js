(function() {
  var orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(o) {
    var sr = orig.call(this, o);
    this.__shadowRootForSummarizer = sr;
    return sr;
  };
})();