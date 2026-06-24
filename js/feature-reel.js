/**
 * Feature reel — inline full-play hero reel.
 * ---------------------------------------------------------------------------
 * Enhances any `.feature-reel-player` figure on a world page. The MP4 lives in
 * Supabase Storage (durable public URL, populated by scripts/sync-hero-reels.mjs);
 * the figure carries it in data-video, with the poster + Instagram permalink.
 *
 * Behaviour:
 *  - Muted autoplay + loop + playsinline, lazy-loaded only when scrolled into view.
 *  - A tap-to-unmute control so a brand can actually hear the spot.
 *  - prefers-reduced-motion: no autoplay — native controls so the user starts it.
 *  - If the video can't load (e.g. not yet synced), the poster stays and a
 *    "Watch on Instagram" fallback covers it. Nothing ever renders broken.
 */
(function () {
  var figs = document.querySelectorAll('.feature-reel-player');
  if (!figs.length) return;

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ICON_MUTED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
  var ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  var ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

  function playSafe(video) {
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }

  Array.prototype.forEach.call(figs, function (fig) {
    var video = fig.querySelector('.feature-reel-video');
    var src = fig.getAttribute('data-video');
    var permalink = fig.getAttribute('data-permalink') || '#';
    if (!video || !src) return;

    // Sound toggle
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'feature-reel-sound';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Unmute video');
    btn.innerHTML = '<span class="fr-icon-muted">' + ICON_MUTED + '</span>' +
                    '<span class="fr-icon-on">' + ICON_ON + '</span>';
    fig.appendChild(btn);

    // Fallback link (revealed only if the video errors)
    var fb = document.createElement('a');
    fb.className = 'feature-reel-fallback';
    fb.href = permalink;
    fb.target = '_blank';
    fb.rel = 'noopener';
    fb.innerHTML = '<span class="fr-play">' + ICON_PLAY + '</span><span>Watch on Instagram</span>';
    fig.appendChild(fb);

    var loaded = false;
    function load() {
      if (loaded) return;
      loaded = true;
      video.src = src;
    }

    video.addEventListener('error', function () { fig.classList.add('fr-failed'); });

    btn.addEventListener('click', function () {
      video.muted = !video.muted;
      var on = !video.muted;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', on ? 'Mute video' : 'Unmute video');
      fig.classList.toggle('fr-sound-on', on);
      if (on && video.paused) playSafe(video);
    });

    if (reduce) {
      // Honour reduced-motion: load the still, let the user start it manually.
      load();
      video.setAttribute('controls', '');
      fig.classList.add('fr-manual');
      return;
    }

    if (!('IntersectionObserver' in window)) { load(); playSafe(video); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          load();
          playSafe(video);
        } else if (!video.paused) {
          video.pause();
        }
      });
    }, { threshold: 0.35 });
    io.observe(fig);
  });
})();
