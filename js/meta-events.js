// Meta Pixel event layer — full-funnel instrumentation loaded on every page.
// Browser pixel handles engagement signals; the two real conversions
// (Lead from the contact brief, Subscribe from the newsletter) ALSO mirror
// server-side via the Conversions API, wired inline in index.html and
// deduplicated by a shared eventID. This file adds the rest of the funnel:
//   ViewContent   — interest in a content vertical (fashion/luxury/wellness)
//                   and the media pack (high-intent brand signal, CAPI-mirrored)
//   ClickInstagram— north-star metric: a visitor heading to follow Aastha on IG
//   Contact       — email / WhatsApp outreach intent
(function () {
  function fbqReady(fn) { if (window.fbq) { fn(); } }
  function eventId() {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'e' + Date.now() + Math.random().toString(36).slice(2);
  }

  // ── ViewContent: tag the content vertical by page ────────────────────────
  var path = location.pathname.replace(/\/index\.html$/, '/');
  var VIEW = {
    '/fashion.html':    { content_name: 'Fashion World',  content_category: 'fashion' },
    '/luxury.html':     { content_name: 'Luxury World',   content_category: 'luxury' },
    '/wellness.html':   { content_name: 'Wellness World', content_category: 'wellness' },
    '/media-pack.html': { content_name: 'Media Pack',     content_category: 'brand' }
  };
  var vc = VIEW[path];
  if (vc) {
    fbqReady(function () {
      if (path === '/media-pack.html') {
        // Brands evaluating the media kit — mirror server-side (deduped).
        var id = eventId();
        fbq('track', 'ViewContent', vc, { eventID: id });
        fetch('/api/capi-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventName: 'ViewContent', eventId: id, customData: vc })
        }).catch(function () {});
      } else {
        fbq('track', 'ViewContent', vc);
      }
    });
  }

  // ── Click delegation: Instagram, email, WhatsApp ─────────────────────────
  // Capture phase + delegation so it also catches dynamically injected links
  // (e.g. the live Instagram feed tiles on the home page).
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';

    if (/instagram\.com/i.test(href)) {
      fbqReady(function () { fbq('trackCustom', 'ClickInstagram', { link_url: href }); });
    } else if (/^mailto:/i.test(href) || /wa\.me|whatsapp/i.test(href)) {
      var method = /^mailto:/i.test(href) ? 'email' : 'whatsapp';
      fbqReady(function () { fbq('track', 'Contact', { contact_method: method }); });
    }
  }, true);
})();
