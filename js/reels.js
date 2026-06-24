/**
 * World pages — reels, featured player, lightbox, mobile nav.
 * ---------------------------------------------------------------------------
 * Reels play INLINE on the page via Instagram's official embed — no bounce to
 * the app. The featured reel swaps its poster for an inline embed on tap; grid
 * reels open an on-page lightbox that plays the embed over a dimmed backdrop.
 *
 * Posters are local images (reliable, on-brand, fast). Reel metadata (permalink,
 * caption, view count) comes from data/reels.json, ranked by views, filtered to
 * the page's verticals. Nothing here depends on a third-party media host, so a
 * frame never renders empty.
 */
(function () {
  'use strict';

  var CFG = window.WORLD || {};
  var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C5.6 5 2 12 2 12s3.6 7 10 7 10-7 10-7-3.6-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';

  /* ── Instagram embed loader ─────────────────────────────────────── */
  var embedScriptRequested = false;
  function ensureEmbedScript(cb) {
    if (window.instgrm && window.instgrm.Embeds) { cb(); return; }
    if (!embedScriptRequested) {
      embedScriptRequested = true;
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.instagram.com/embed.js';
      document.body.appendChild(s);
    }
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (window.instgrm && window.instgrm.Embeds) { clearInterval(t); cb(); }
      else if (tries > 70) { clearInterval(t); } // ~8s ceiling; fallback link stays
    }, 115);
  }
  function processEmbeds() {
    if (window.instgrm && window.instgrm.Embeds) window.instgrm.Embeds.process();
  }
  function blockquote(permalink) {
    return '<blockquote class="instagram-media" data-instgrm-version="14"' +
      ' data-instgrm-permalink="' + permalink + '"' +
      ' style="background:#fff;border:0;margin:0;width:100%;min-width:0;">' +
      '<a href="' + permalink + '" target="_blank" rel="noopener" ' +
      'style="display:block;padding:28px 18px;color:#262626;font:500 13px/1.4 -apple-system,sans-serif;text-align:center;">' +
      'Watch this reel on Instagram &rarr;</a></blockquote>';
  }

  /* ── Featured reel: poster → inline embed on tap ────────────────── */
  function wireFeatured() {
    var fig = document.querySelector('.reel-feature');
    if (!fig) return;
    var permalink = fig.getAttribute('data-permalink');
    var poster = fig.querySelector('.reel-feature-poster');
    if (!permalink || !poster) return;

    poster.addEventListener('click', function () {
      var slot = document.createElement('div');
      slot.className = 'reel-feature-embed';
      slot.innerHTML = blockquote(permalink);
      fig.appendChild(slot);
      poster.style.display = 'none';
      ensureEmbedScript(processEmbeds);
      track();
    });
  }

  /* ── Lightbox (grid reels) ──────────────────────────────────────── */
  var lb, lbBody, lastFocus;
  function buildLightbox() {
    lb = document.createElement('div');
    lb.className = 'reel-lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Reel player');
    lb.hidden = true;
    lb.innerHTML =
      '<div class="reel-lightbox-backdrop"></div>' +
      '<div class="reel-lightbox-inner">' +
        '<button class="reel-lightbox-close" type="button" aria-label="Close">&times;</button>' +
        '<div class="reel-lightbox-body"></div>' +
      '</div>';
    document.body.appendChild(lb);
    lbBody = lb.querySelector('.reel-lightbox-body');
    lb.querySelector('.reel-lightbox-close').addEventListener('click', closeLightbox);
    lb.querySelector('.reel-lightbox-backdrop').addEventListener('click', closeLightbox);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && lb.classList.contains('open')) closeLightbox();
    });
  }
  function openLightbox(permalink) {
    if (!lb) buildLightbox();
    lastFocus = document.activeElement;
    lbBody.innerHTML = '<div class="reel-lightbox-loading">Loading reel…</div>';
    lb.hidden = false;
    // force reflow so the transition runs
    void lb.offsetWidth;
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    lbBody.innerHTML = blockquote(permalink);
    ensureEmbedScript(processEmbeds);
    lb.querySelector('.reel-lightbox-close').focus();
    track();
  }
  function closeLightbox() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(function () { lb.hidden = true; lbBody.innerHTML = ''; }, 250);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ── Reels grid ─────────────────────────────────────────────────── */
  function num(n) {
    if (n >= 1000) return (Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  function esc(s) { return String(s || '').replace(/[<>"&]/g, function (c) {
    return ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' })[c];
  }); }

  function renderGrid(reels) {
    var grid = document.getElementById('reels-grid');
    if (!grid) return;
    var posters = CFG.posters || [];
    grid.innerHTML = '';
    reels.slice(0, 6).forEach(function (r, i) {
      var poster = posters[i % (posters.length || 1)] || posters[0];
      var cap = (r.caption || '').replace(/\s+/g, ' ').trim();
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reel-card';
      btn.setAttribute('aria-label', 'Play reel: ' + cap.slice(0, 60));
      btn.innerHTML =
        '<img src="' + poster + '" alt="" loading="lazy" />' +
        '<span class="reel-card-play">' + ICON_PLAY + '</span>' +
        '<span class="reel-card-cap">' +
          (r.views ? '<span class="reel-card-views">' + ICON_EYE + num(r.views) + ' views</span>' : '') +
          (cap ? '<span class="reel-card-caption">' + esc(cap) + '</span>' : '') +
        '</span>';
      btn.addEventListener('click', function () { openLightbox(r.permalink); });
      grid.appendChild(btn);
    });
  }

  function loadReels() {
    if (!document.getElementById('reels-grid')) return;
    if (CFG.fallback) renderGrid(CFG.fallback); // instant paint
    var wanted = {};
    (CFG.categories || []).forEach(function (c) { wanted[c] = 1; });
    fetch('data/reels.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.reels) return;
        var list = d.reels.filter(function (r) { return wanted[r.category]; });
        if (list.length) renderGrid(list);
      })
      .catch(function () {});
  }

  /* ── Analytics passthrough (reuses Meta Pixel if present) ───────── */
  function track() {
    try { if (window.fbq) window.fbq('trackCustom', 'ReelPlay'); } catch (e) {}
  }

  /* ── Mobile nav ─────────────────────────────────────────────────── */
  function wireNav() {
    var nav = document.querySelector('.world-nav');
    var toggle = nav && nav.querySelector('.world-nav-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('menu-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.querySelectorAll('.world-nav-links a').forEach(function (a) {
      a.addEventListener('click', function () { nav.classList.remove('menu-open'); });
    });
  }

  function init() {
    wireNav();
    wireFeatured();
    loadReels();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
