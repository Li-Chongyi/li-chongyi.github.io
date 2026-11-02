(function () {
  'use strict';

  function mountLightScroll(root) {
    if (root.__lightScrollController) root.__lightScrollController.destroy();
    var image = root.querySelector('img[data-light-image]');
    if (!image) return;
    var duration = Number(root.getAttribute('data-intro-duration')) || 7000;
    var timer = 0, timerStarted = 0, remaining = duration;
    var started = false, complete = false, ready = false, decoding = false;
    var disposed = false, failed = false, inCache = false, userPaused = false;
    var hidden = document.hidden, visible = false;
    var observer = null;
    var listeners = [];
    var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduced = !!(motion && motion.matches);

    function now() {
      return window.performance && window.performance.now ? window.performance.now() : Date.now();
    }
    function listen(element, event, callback, options) {
      element.addEventListener(event, callback, options);
      listeners.push(function () { element.removeEventListener(event, callback, options); });
    }
    function eligible() { return visible && !hidden && !inCache && !disposed; }
    function active() { return ready && eligible() && !reduced && !failed && !userPaused; }
    function ownsControl(button) {
      var owner = button.closest('[data-light-scroll]');
      return owner ? owner === root : document.querySelector('[data-light-scroll]') === root;
    }
    function updateClasses() {
      var playing = active();
      root.classList.toggle('is-active', playing);
      root.classList.toggle('is-paused', !playing);
      root.classList.toggle('is-running', started && !complete);
      root.classList.toggle('is-complete', complete);
      document.querySelectorAll('button[data-toggle-motion]').forEach(function (button) {
        if (!ownsControl(button)) return;
        var pausedByChoice = userPaused || reduced;
        var label = pausedByChoice ? 'Play animation' : 'Pause animation';
        var text = button.querySelector('[data-toggle-motion-label]');
        if (text) text.textContent = label;
        else button.textContent = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', pausedByChoice ? 'true' : 'false');
        button.disabled = reduced || failed;
      });
    }
    function stopClock() {
      if (!timer) return;
      window.clearTimeout(timer);
      timer = 0;
      remaining = Math.max(0, remaining - Math.max(0, now() - timerStarted));
    }
    function finish() {
      if (disposed) return;
      stopClock();
      complete = true;
      remaining = 0;
      updateClasses();
    }
    function decoded() {
      decoding = false;
      if (disposed) return;
      ready = true;
      failed = false;
      synchronize();
    }
    function ensureDecoded() {
      // Native loading="lazy" owns fetching. No decoding or fetch work is
      // initiated by this controller while the section is outside the view.
      if (ready || decoding || failed || !eligible() || reduced) return;
      if (typeof image.decode === 'function') {
        decoding = true;
        try {
          Promise.resolve(image.decode()).then(decoded, function () {
            decoding = false;
            if (disposed) return;
            // Some engines reject decode around a source/load transition.
            // A successfully loaded photo is still safe to display; otherwise
            // the native load/error listeners remain responsible for retry.
            if (image.complete && image.naturalWidth > 0) decoded();
          });
        } catch (_) {
          decoding = false;
          if (image.complete && image.naturalWidth > 0) decoded();
        }
      } else if (image.complete && image.naturalWidth > 0) decoded();
    }
    function synchronize() {
      if (disposed) return;
      if (reduced || failed) { finish(); return; }
      if (!ready) {
        stopClock();
        updateClasses();
        ensureDecoded();
        return;
      }
      if (!active()) {
        stopClock();
        updateClasses();
        return;
      }
      if (!started && !complete) started = true;
      updateClasses();
      // The intro has one visible-time deadline. Afterwards only ambience remains;
      // visibility and user pause still update its state without any RAF/timer.
      if (complete) { stopClock(); return; }
      if (remaining <= 0) { finish(); return; }
      if (!timer) {
        timerStarted = now();
        timer = window.setTimeout(function () {
          timer = 0;
          remaining = 0;
          if (disposed) return;
          if (active()) finish();
          else synchronize();
        }, Math.max(16, remaining));
      }
    }
    function imageLoaded() {
      if (disposed) return;
      failed = false;
      ensureDecoded();
    }
    function imageFailed() {
      if (disposed) return;
      decoding = false;
      failed = true;
      finish();
    }
    function visibilityChanged() { hidden = document.hidden; synchronize(); }
    function checkViewport() {
      if (disposed) return;
      var rect = root.getBoundingClientRect();
      var w = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      var h = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      visible = rect.width > 0 && rect.height > 0 && w * h / (rect.width * rect.height) >= .25;
      synchronize();
    }
    function motionChanged(event) {
      reduced = !!event.matches;
      // Enabling reduced motion completes this presentation. Disabling it
      // later does not replay a scene the visitor has already seen.
      synchronize();
    }
    function pageHidden(event) {
      if (!event.persisted) { destroy(); return; }
      inCache = true;
      synchronize();
    }
    function pageShown(event) {
      if (!event.persisted || disposed) return;
      inCache = false;
      hidden = document.hidden;
      checkViewport();
    }
    function replay() {
      if (disposed) return;
      stopClock();
      remaining = duration;
      started = false;
      complete = false;
      userPaused = false;
      root.classList.remove('is-running', 'is-complete', 'is-active');
      root.classList.add('is-paused');
      if (!reduced) void root.offsetWidth;
      try {
        root.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'center' });
      } catch (_) { root.scrollIntoView({ behavior: 'auto', block: 'center' }); }
      synchronize();
    }
    function globalReplay(event) {
      var button = event.target && event.target.closest ? event.target.closest('button[data-replay]') : null;
      if (!button || button.disabled) return;
      if (!ownsControl(button)) return;
      replay();
    }
    function toggleMotion() {
      if (disposed || reduced || failed) return;
      userPaused = !userPaused;
      synchronize();
    }
    function globalToggle(event) {
      var button = event.target && event.target.closest ? event.target.closest('button[data-toggle-motion]') : null;
      if (!button || button.disabled || !ownsControl(button)) return;
      toggleMotion();
    }
    function destroy() {
      if (disposed) return;
      stopClock();
      disposed = true;
      if (observer) observer.disconnect();
      listeners.forEach(function (remove) { remove(); });
      listeners.length = 0;
      if (motion) {
        if (motion.removeEventListener) motion.removeEventListener('change', motionChanged);
        else if (motion.removeListener) motion.removeListener(motionChanged);
      }
      root.classList.remove('is-active');
      root.classList.add('is-paused');
      if (root.__lightScrollController === controller) delete root.__lightScrollController;
    }

    listen(image, 'load', imageLoaded);
    listen(image, 'error', imageFailed);
    listen(document, 'click', globalReplay);
    listen(document, 'click', globalToggle);
    listen(document, 'visibilitychange', visibilityChanged);
    listen(window, 'pagehide', pageHidden);
    listen(window, 'pageshow', pageShown);
    if (motion) {
      if (motion.addEventListener) motion.addEventListener('change', motionChanged);
      else if (motion.addListener) motion.addListener(motionChanged);
    }
    if ('IntersectionObserver' in window) {
      observer = new window.IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.target !== root || disposed) return;
          visible = entry.isIntersecting && entry.intersectionRatio >= .25;
          synchronize();
        });
      }, { threshold: [0, .25] });
      observer.observe(root);
    } else {
      listen(window, 'scroll', checkViewport, { passive: true });
      listen(window, 'resize', checkViewport, { passive: true });
    }
    var controller = { replay: replay, toggle: toggleMotion, destroy: destroy };
    root.__lightScrollController = controller;
    if (observer) synchronize();
    else checkViewport();
  }

  function initialize() {
    document.querySelectorAll('[data-light-scroll]').forEach(mountLightScroll);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
