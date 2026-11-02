(function () {
  'use strict';
  function mount(root) {
    var canvas = root.querySelector('[data-depth-canvas]');
    var image = root.querySelector('img[data-light-image]');
    if (!canvas || !image || !canvas.getContext) return;
    if (root.__depthController) root.__depthController.destroy();
    var ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    var texture, soft, middle, front, scene, reveal;
    var w = 0, h = 0, dpr = 1, pad = 8, mobile = false;
    var dirty = true, disposed = false, raf = 0, previous = 0, lastPaint = 0, elapsed = 0;
    var px = 0, py = 0, targetX = 0, targetY = 0;
    var wasComplete = root.classList.contains('is-complete');
    var media = window.matchMedia('(prefers-reduced-motion: reduce)');
    var reduced = media.matches, resizeObserver, observer;
    var remove = [];
    function on(el, name, fn, opts) {
      el.addEventListener(name, fn, opts);
      remove.push(function () { el.removeEventListener(name, fn, opts); });
    }
    function buffer(width, height) {
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(width)); c.height = Math.max(1, Math.round(height));
      return c;
    }
    function smooth(a, b, n) {
      var q = Math.max(0, Math.min(1, (n - a) / (b - a)));
      return q * q * (3 - 2 * q);
    }
    function allowed() {
      return !disposed && !reduced && !document.hidden && root.classList.contains('is-active')
        && !root.classList.contains('is-paused');
    }
    function stop() {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0; previous = 0; lastPaint = 0;
    }
    function prepare() {
      if (!image.complete || !image.naturalWidth || !image.naturalHeight) return false;
      var rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width); h = Math.max(1, rect.height);
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      mobile = window.innerWidth <= 650;
      var iw = image.naturalWidth, ih = image.naturalHeight;
      var cover = Math.max(w / iw, h / ih);
      var ox = (w - iw * cover) * (mobile ? .42 : .50);
      var oy = (h - ih * cover) * (mobile ? .48 : .52);
      var tw = Math.ceil((w + pad * 2) * dpr), th = Math.ceil((h + pad * 2) * dpr);
      texture = buffer(tw, th);
      var tc = texture.getContext('2d');
      tc.setTransform(dpr, 0, 0, dpr, 0, 0);
      tc.drawImage(image, ox + pad, oy + pad, iw * cover, ih * cover);
      // Replicated edge pixels provide movement room without changing the
      // accepted object-fit crop or introducing transparent seams.
      var p = Math.round(pad * dpr), bw = Math.round(w * dpr), bh = Math.round(h * dpr);
      tc.setTransform(1, 0, 0, 1, 0, 0);
      tc.drawImage(texture, p, p, 1, bh, 0, p, p, bh);
      tc.drawImage(texture, p + bw - 1, p, 1, bh, p + bw, p, tw - p - bw, bh);
      tc.drawImage(texture, 0, p, tw, 1, 0, 0, tw, p);
      tc.drawImage(texture, 0, p + bh - 1, tw, 1, 0, p + bh, tw, th - p - bh);
      soft = buffer(tw, th);
      var sc = soft.getContext('2d');
      sc.filter = 'blur(' + ((mobile ? .35 : .70) * dpr) + 'px) saturate(.92)';
      sc.drawImage(texture, 0, 0); sc.filter = 'none';
      function layer(contours, feather) {
        var mask = buffer(tw, th), mc = mask.getContext('2d');
        mc.setTransform(dpr, 0, 0, dpr, 0, 0);
        mc.filter = 'blur(' + (feather * dpr) + 'px)'; mc.fillStyle = '#fff';
        contours.forEach(function (points) {
          mc.beginPath();
          points.forEach(function (point, index) {
            var x = pad + ox + point[0] * iw * cover;
            var y = pad + oy + point[1] * ih * cover;
            if (index) mc.lineTo(x, y); else mc.moveTo(x, y);
          });
          mc.closePath(); mc.fill();
        });
        var out = buffer(tw, th), oc = out.getContext('2d');
        oc.drawImage(texture, 0, 0); oc.globalCompositeOperation = 'destination-in';
        oc.drawImage(mask, 0, 0); mask.width = mask.height = 1;
        return out;
      }
      // Source-photo contours: the layered cliff on the left and the low
      // terraces on the right; the near slab slopes down across the frame.
      middle = layer([[[0,.18],[.07,.20],[.13,.24],[.17,.30],[.24,.30],[.28,.34],
        [.34,.35],[.39,.46],[.47,.47],[.53,.56],[.60,.56],[.70,.52],[.82,.51],
        [.93,.50],[1,.46],[1,1.12],[-.02,1.12]]], mobile ? 5 : 9);
      front = layer([[[0,.535],[.05,.60],[.12,.65],[.21,.70],[.31,.77],[.43,.85],
        [.55,.93],[.65,1.03],[1,1.12],[-.02,1.12]],
        [[.65,.81],[.72,.75],[.80,.76],[.88,.72],[.95,.76],[1,.70],[1,1.12],[.65,1.12]]], mobile ? 6 : 11);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      scene = buffer(canvas.width, canvas.height); reveal = buffer(canvas.width, canvas.height);
      dirty = false;
      return true;
    }
    function place(c, photo, x, y, alpha) {
      c.globalAlpha = alpha === undefined ? 1 : alpha;
      c.drawImage(photo, x - pad, y - pad, photo.width / dpr, photo.height / dpr);
    }
    function draw() {
      if (!texture || disposed) return;
      var factor = mobile ? .5 : 1;
      var driftTime = elapsed * 1.65;
      var farX = (.32 * Math.sin(driftTime * .17) + px * .05) * factor;
      var farY = .13 * Math.sin(driftTime * .13) * factor;
      var midX = (1.0 * Math.sin(driftTime * .16 + .3) + px * .35) * factor;
      var midY = (.25 * Math.sin(driftTime * .11) + py * .15) * factor;
      var nearX = (2.15 * Math.sin(driftTime * .15 + .5) + px * .75) * factor;
      var nearY = (.45 * Math.sin(driftTime * .12) + py * .45) * factor;
      var cc = scene.getContext('2d');
      cc.setTransform(dpr, 0, 0, dpr, 0, 0);
      cc.clearRect(0, 0, w, h);
      place(cc, texture, farX, farY); place(cc, middle, midX, midY); place(cc, front, nearX, nearY);
      cc.globalAlpha = 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      place(ctx, soft, farX, farY);
      // Foreground rock remains sharp throughout. Only the distant light
      // briefly breathes out of focus before a broad feathered reveal passes.
      place(ctx, middle, midX, midY, .48); place(ctx, front, nearX, nearY);
      var cycle = elapsed % 10;
      var softness = smooth(0, .35, cycle) * (1 - smooth(2.3, 3.2, cycle));
      ctx.globalAlpha = 1 - softness;
      ctx.drawImage(scene, 0, 0, w, h); ctx.globalAlpha = 1;
      if (softness > .001) {
        var sweep = smooth(.10, 2.9, cycle);
        var focusX = (-.25 + sweep * 1.50) * w;
        var feather = Math.max(45, w * .22);
        var rc = reveal.getContext('2d');
        rc.setTransform(dpr, 0, 0, dpr, 0, 0);
        rc.clearRect(0, 0, w, h); rc.globalCompositeOperation = 'source-over';
        rc.drawImage(scene, 0, 0, w, h);
        rc.globalCompositeOperation = 'destination-in';
        var gradient = rc.createLinearGradient(focusX - feather, 0, focusX + feather, 0);
        gradient.addColorStop(0, '#fff'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
        rc.fillStyle = gradient; rc.fillRect(0, 0, w, h);
        ctx.globalAlpha = softness; ctx.drawImage(reveal, 0, 0, w, h); ctx.globalAlpha = 1;
        // The warm focus is intentionally low energy; the real sunset already
        // supplies the highlight. This never becomes a white scanner band.
        var warmth = Math.sin(Math.PI * sweep) * .027 * softness;
        ctx.save(); ctx.globalCompositeOperation = 'soft-light';
        ctx.translate(focusX, h * .57); ctx.scale(Math.max(40, w * .18), h * .85);
        var glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        glow.addColorStop(0, 'rgba(255,204,133,' + warmth + ')');
        glow.addColorStop(1, 'rgba(255,204,133,0)');
        ctx.fillStyle = glow; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
      }
      if (!root.classList.contains('has-depth')) root.classList.add('has-depth');
    }
    function tick(time) {
      raf = 0;
      if (!allowed()) { previous = 0; return; }
      if (previous) elapsed += Math.max(0, Math.min(.10, (time - previous) / 1000));
      previous = time;
      if (!lastPaint || time - lastPaint >= 1000 / 30 - .5) {
        var step = lastPaint ? Math.min(.10, (time - lastPaint) / 1000) : 1 / 30;
        var relax = 1 - Math.exp(-step * 6);
        px += (targetX - px) * relax; py += (targetY - py) * relax;
        if (dirty && !prepare()) return;
        draw(); lastPaint = time;
      }
      raf = window.requestAnimationFrame(tick);
    }
    function synchronize() {
      if (disposed) return;
      var complete = root.classList.contains('is-complete');
      if (wasComplete && root.classList.contains('is-running')) { elapsed = 0; previous = lastPaint = 0; }
      wasComplete = complete;
      if (reduced) { stop(); root.classList.remove('has-depth'); return; }
      if (!allowed()) { stop(); return; }
      if (dirty && !prepare()) return;
      if (!root.classList.contains('has-depth') || dirty) draw();
      if (!raf) raf = window.requestAnimationFrame(tick);
    }
    function resized() {
      dirty = true;
      if (disposed || reduced) return;
      if (allowed() || root.classList.contains('has-depth')) {
        if (prepare()) draw();
        if (allowed()) synchronize();
      }
    }
    function replay(event) {
      var button = event.target && event.target.closest ? event.target.closest('button[data-replay]') : null;
      if (!button || button.disabled) return;
      elapsed = 0; previous = lastPaint = 0; px = py = targetX = targetY = 0;
      if (allowed()) { if (dirty) prepare(); draw(); synchronize(); }
    }
    function pointer(event) {
      if (event.pointerType === 'touch' || !allowed()) return;
      var rect = root.getBoundingClientRect();
      targetX = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
      targetY = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
    }
    function leave() { targetX = targetY = 0; }
    function motion(event) { reduced = event.matches; synchronize(); }
    function destroy() {
      if (disposed) return; disposed = true; stop();
      if (observer) observer.disconnect(); if (resizeObserver) resizeObserver.disconnect();
      remove.forEach(function (fn) { fn(); });
      if (media.removeEventListener) media.removeEventListener('change', motion);
      else media.removeListener(motion);
      root.classList.remove('has-depth');
      [texture, soft, middle, front, scene, reveal].forEach(function (c) { if (c) c.width = c.height = 1; });
      if (root.__depthController === controller) delete root.__depthController;
    }
    on(image, 'load', synchronize); on(document, 'visibilitychange', synchronize);
    on(document, 'click', replay); on(root, 'pointermove', pointer); on(root, 'pointerleave', leave);
    on(window, 'resize', resized, { passive: true });
    on(window, 'pagehide', function (event) { if (event.persisted) stop(); else destroy(); });
    on(window, 'pageshow', synchronize);
    if (media.addEventListener) media.addEventListener('change', motion); else media.addListener(motion);
    observer = new window.MutationObserver(synchronize);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    if ('ResizeObserver' in window) { resizeObserver = new window.ResizeObserver(resized); resizeObserver.observe(canvas); }
    var controller = { destroy: destroy };
    root.__depthController = controller;
    synchronize();
  }
  function initialize() { document.querySelectorAll('[data-light-scroll]').forEach(mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
