/**
 * World pages — reels grid + featured reel, native player (matches the homepage).
 * ---------------------------------------------------------------------------
 * Reels play inline in OUR OWN player: a native <video> sourced from the durable
 * Supabase Storage MP4 (`media_url`), postered by the real Instagram cover frame
 * (`thumbnail`) — no artificial/local posters, no overlays on top of the cover.
 * Tap toggles play/pause (one reel at a time); a small control toggles sound.
 *
 * Data: data/reels.json (ranked by views, filtered to the page's verticals).
 * A reel that doesn't yet have a hosted MP4 falls back to its real thumbnail with
 * an Instagram-embed lightbox, so a frame is never empty and never fabricated.
 */
(function () {
  'use strict';

  var CFG = window.WORLD || {};
  var ICON_PLAY  = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';
  var ICON_EYE   = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C5.6 5 2 12 2 12s3.6 7 10 7 10-7 10-7-3.6-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';

  function num(n) {
    if (n >= 1000) return (Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  function esc(s) { return String(s || '').replace(/[<>"&]/g, function (c) {
    return ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' })[c];
  }); }

  /* ── Instagram embed (fallback only — reels without a hosted MP4) ──── */
  var embedScriptRequested = false;
  function ensureEmbedScript(cb) {
    if (window.instgrm && window.instgrm.Embeds) { cb(); return; }
    if (!embedScriptRequested) {
      embedScriptRequested = true;
      var s = document.createElement('script');
      s.async = true; s.src = 'https://www.instagram.com/embed.js';
      document.body.appendChild(s);
    }
    var tries = 0;
    var t = setInterval(function () {
      if (window.instgrm && window.instgrm.Embeds) { clearInterval(t); cb(); }
      else if (++tries > 70) clearInterval(t);
    }, 115);
  }
  function processEmbeds() { if (window.instgrm && window.instgrm.Embeds) window.instgrm.Embeds.process(); }
  function blockquote(permalink) {
    return '<blockquote class="instagram-media" data-instgrm-version="14"' +
      ' data-instgrm-permalink="' + permalink + '"' +
      ' style="background:#000;border:0;margin:0;width:100%;min-width:0;">' +
      '<a href="' + permalink + '" target="_blank" rel="noopener" ' +
      'style="display:block;padding:40px 18px;color:#f2e8d0;font:500 13px/1.5 sans-serif;text-align:center;">' +
      'Watch this reel on Instagram &rarr;</a></blockquote>';
  }
  var lb, lbBody, lastFocus;
  function buildLightbox() {
    lb = document.createElement('div');
    lb.className = 'reel-lightbox';
    lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Reel player'); lb.hidden = true;
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
    lb.hidden = false; void lb.offsetWidth; lb.classList.add('open');
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

  /* ── Native player: pause every other reel when one starts ─────────── */
  function pauseOthers(except) {
    document.querySelectorAll('.world-reels video, .reel-feature video').forEach(function (v) {
      if (v !== except && !v.paused) { v.pause(); }
    });
  }
  function setBtn(btn, playing) {
    if (!btn) return;
    btn.classList.toggle('playing', playing);
    btn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  }

  /* ── Reels grid ─────────────────────────────────────────────────────── */
  function renderGrid(reels) {
    var grid = document.getElementById('reels-grid');
    if (!grid) return;
    grid.innerHTML = '';
    reels.slice(0, 6).forEach(function (r) {
      var cap = (r.caption || '').replace(/\s+/g, ' ').trim();
      var thumb = r.thumbnail || '';
      var meta =
        '<span class="reel-card-cap">' +
          (r.views ? '<span class="reel-card-views">' + ICON_EYE + num(r.views) + ' views</span>' : '') +
          (cap ? '<span class="reel-card-caption">' + esc(cap) + '</span>' : '') +
        '</span>';

      if (r.media_url) {
        // Native player — real IG thumbnail as poster, no artificial overlay.
        var card = document.createElement('div');
        card.className = 'reel-card reel-card-video';
        card.innerHTML =
          '<video src="' + esc(r.media_url) + '"' + (thumb ? ' poster="' + esc(thumb) + '"' : '') +
            ' loop playsinline preload="none"></video>' +
          '<button class="reel-card-play" type="button" aria-label="Play reel">' + ICON_PLAY + '</button>' +
          '<button class="reel-card-mute" type="button" aria-label="Toggle sound">🔊</button>' +
          meta;
        var video = card.querySelector('video');
        var play = card.querySelector('.reel-card-play');
        var mute = card.querySelector('.reel-card-mute');
        function toggle() {
          if (video.paused) { pauseOthers(video); video.play(); track(); }
          else video.pause();
        }
        play.addEventListener('click', toggle);
        video.addEventListener('click', toggle);
        video.addEventListener('play',  function () { setBtn(play, true); });
        video.addEventListener('pause', function () { setBtn(play, false); });
        video.addEventListener('ended', function () { setBtn(play, false); });
        mute.addEventListener('click', function (e) {
          e.stopPropagation();
          video.muted = !video.muted;
          mute.textContent = video.muted ? '🔇' : '🔊';
        });
        grid.appendChild(card);
      } else {
        // No hosted MP4 yet — real thumbnail + Instagram-embed lightbox.
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'reel-card';
        btn.setAttribute('aria-label', 'Play reel: ' + cap.slice(0, 60));
        btn.innerHTML =
          (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" />' : '') +
          '<span class="reel-card-play">' + ICON_PLAY + '</span>' + meta;
        btn.addEventListener('click', function () { openLightbox(r.permalink); });
        grid.appendChild(btn);
      }
    });
  }

  /* ── Featured reel — native player from the page's data-video URL ───── */
  function wireFeatured(byPermalink) {
    var fig = document.querySelector('.reel-feature');
    if (!fig) return;
    var permalink = fig.getAttribute('data-permalink');
    var dataVideo = fig.getAttribute('data-video');
    var match = permalink && byPermalink[permalink];
    var mediaUrl = dataVideo || (match && match.media_url);
    var poster = (match && match.thumbnail) || '';

    if (mediaUrl) {
      // Replace the poster button with our native player. No artificial poster:
      // if there's a real IG thumbnail use it, else the video's own first frame.
      fig.innerHTML =
        '<video class="reel-feature-video" src="' + esc(mediaUrl) + '"' +
          (poster ? ' poster="' + esc(poster) + '"' : '') +
          ' loop playsinline preload="metadata"></video>' +
        '<button class="reel-feature-play" type="button" aria-label="Play reel">' + ICON_PLAY + '</button>' +
        '<button class="reel-feature-mute" type="button" aria-label="Toggle sound">🔊</button>';
      var video = fig.querySelector('video');
      var play = fig.querySelector('.reel-feature-play');
      var mute = fig.querySelector('.reel-feature-mute');
      function toggle() {
        if (video.paused) { pauseOthers(video); video.play(); track(); }
        else video.pause();
      }
      play.addEventListener('click', toggle);
      video.addEventListener('click', toggle);
      video.addEventListener('play',  function () { setBtn(play, true); });
      video.addEventListener('pause', function () { setBtn(play, false); });
      video.addEventListener('ended', function () { setBtn(play, false); });
      mute.addEventListener('click', function (e) {
        e.stopPropagation();
        video.muted = !video.muted;
        mute.textContent = video.muted ? '🔇' : '🔊';
      });
      return;
    }

    // Fallback: no hosted MP4 — keep poster, but swap to the real cover if we
    // have it, and play via the Instagram embed on tap.
    var posterBtn = fig.querySelector('.reel-feature-poster');
    if (!posterBtn || !permalink) return;
    if (poster) { var img = posterBtn.querySelector('img'); if (img) img.src = poster; }
    posterBtn.addEventListener('click', function () {
      var slot = document.createElement('div');
      slot.className = 'reel-feature-embed';
      slot.innerHTML = blockquote(permalink);
      fig.appendChild(slot);
      posterBtn.style.display = 'none';
      ensureEmbedScript(processEmbeds);
      track();
    });
  }

  /* ── Load + wire ────────────────────────────────────────────────────── */
  function loadReels() {
    var hasGrid = !!document.getElementById('reels-grid');
    var hasFeature = !!document.querySelector('.reel-feature');
    if (!hasGrid && !hasFeature) return;
    var wanted = {};
    (CFG.categories || []).forEach(function (c) { wanted[c] = 1; });

    // Live from Supabase first so newly posted reels show without a rebuild;
    // the committed data/reels.json is the fallback when the API is unavailable.
    function fromFile() {
      return fetch('data/reels.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; });
    }

    fetch('/api/reels', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        return (d && d.reels && d.reels.length) ? d : fromFile();
      })
      .catch(fromFile)
      .then(function (d) {
        var all = (d && d.reels) || [];
        var byPermalink = {};
        all.forEach(function (r) { if (r.permalink) byPermalink[r.permalink] = r; });
        if (hasGrid) {
          var list = all.filter(function (r) { return wanted[r.category]; });
          if (list.length) renderGrid(list);
        }
        if (hasFeature) wireFeatured(byPermalink);
      })
      .catch(function () { if (hasFeature) wireFeatured({}); });
  }

  function track() { try { if (window.fbq) window.fbq('trackCustom', 'ReelPlay'); } catch (e) {} }

  /* ── Mobile nav ─────────────────────────────────────────────────────── */
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

  function init() { wireNav(); loadReels(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
