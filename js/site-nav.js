/* ============================================================
   Universal site navigation behaviour.
   - scrolled state (frosted bar)
   - mobile hamburger drawer
   - "Worlds" dropdown (hover on desktop, tap/click everywhere)
   - active-link highlighting from the current URL
   Self-initialising; safe to load with defer on every page.
   ============================================================ */
(function () {
  'use strict';

  function init() {
    var nav = document.querySelector('nav.site-nav');
    if (!nav) return;

    var toggle = nav.querySelector('.site-nav__toggle');
    var menu = nav.querySelector('.site-nav__menu');
    var dropdowns = nav.querySelectorAll('.site-nav__has-dropdown');

    /* ── Scrolled state ──────────────────────────────────── */
    function onScroll() {
      nav.classList.toggle('is-scrolled', window.scrollY > 40);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    /* ── Mobile drawer ───────────────────────────────────── */
    function closeMenu() {
      nav.classList.remove('is-open');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      dropdowns.forEach(function (d) {
        d.classList.remove('is-open');
        var t = d.querySelector('.site-nav__dropdown-toggle');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
    }

    if (toggle && menu) {
      toggle.addEventListener('click', function () {
        var open = nav.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (!open) closeMenu();
      });
    }

    /* ── Worlds dropdown ─────────────────────────────────── */
    dropdowns.forEach(function (d) {
      var t = d.querySelector('.site-nav__dropdown-toggle');
      if (!t) return;
      t.addEventListener('click', function (e) {
        e.preventDefault();
        var willOpen = !d.classList.contains('is-open');
        // close siblings
        dropdowns.forEach(function (o) {
          if (o !== d) {
            o.classList.remove('is-open');
            var ot = o.querySelector('.site-nav__dropdown-toggle');
            if (ot) ot.setAttribute('aria-expanded', 'false');
          }
        });
        d.classList.toggle('is-open', willOpen);
        t.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      });
    });

    /* Close the drawer when any real link is followed */
    nav.querySelectorAll('.site-nav__menu a').forEach(function (a) {
      a.addEventListener('click', closeMenu);
    });

    /* Close on outside click / Escape */
    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });

    /* ── Active link highlighting ────────────────────────── */
    var path = (location.pathname || '/').replace(/\/index\.html$/, '/');
    var hash = location.hash;
    nav.querySelectorAll('.site-nav__menu a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      var isPage = false;

      if (/^\/?(fashion|luxury|wellness|media-pack|privacy)\.html$/.test(href)) {
        var file = href.replace(/^\//, '');
        isPage = path.indexOf(file) !== -1;
      } else if (href === '/blog' || href === '/blog/') {
        isPage = path.indexOf('/blog') === 0;
      } else if (href.indexOf('/#') === 0 || href === '/') {
        // homepage anchors: only mark when actually on the homepage
        var onHome = path === '/' || /\/index\.html$/.test(location.pathname);
        var anchor = href.indexOf('#') !== -1 ? href.slice(href.indexOf('#')) : '';
        isPage = onHome && anchor && anchor === hash;
      }

      if (isPage) {
        a.setAttribute('aria-current', 'page');
        // open the parent dropdown's relationship visually if it's a world page
        var dd = a.closest('.site-nav__has-dropdown');
        if (dd) {
          var ddToggle = dd.querySelector('.site-nav__dropdown-toggle');
          if (ddToggle) ddToggle.setAttribute('aria-current', 'true');
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
