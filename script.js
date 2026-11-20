/* =========================================================
   FRENCHKISS DJ — interactions
   Nav · reveal · booth sound · booking · forms
   ========================================================= */
(function () {
  'use strict';


  /* bookings land on WhatsApp */
  const WHATSAPP = '233504343113';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── year ─────────────────────────────────────────────── */
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ── header + mobile nav ──────────────────────────────── */
  const header = $('#site-header');
  const menuBtn = $('#menu-btn');
  const nav = $('#main-nav');

  function closeMenu() {
    if (!nav || !menuBtn) return;
    nav.classList.remove('is-open');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-label', 'Open menu');
  }

  if (menuBtn && nav) {
    menuBtn.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    nav.addEventListener('click', (e) => {
      if (e.target.closest('a')) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 900) closeMenu();
    });
  }

  function onScroll() {
    if (!header) return;
    header.classList.toggle('is-stuck', window.scrollY > 24);
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ── reveal on scroll ─────────────────────────────────── */
  const revealTargets = $$(
    '.section-head, .platform, .release-card, .about-figure, .standfirst, .about-body > p, .stats, .booking-copy, .booking-form, .newsletter-inner > *'
  );

  if (!reduceMotion && 'IntersectionObserver' in window) {
    revealTargets.forEach((el, i) => {
      el.classList.add('reveal');
      el.style.setProperty('--d', (i % 4) * 60 + 'ms');
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealTargets.forEach((el) => io.observe(el));
  }


  /* ── form helpers ─────────────────────────────────────── */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function setStatus(el, message, ok) {
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('ok', Boolean(ok));
  }

  function focusField(form, name) {
    const field = form.elements.namedItem(name);
    if (field && typeof field.focus === 'function') field.focus();
  }

  async function postJSON(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  /* booking */
  const bookingForm = $('#booking-form');
  const bookingStatus = $('#booking-status');

  if (bookingForm) {
    bookingForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = $('.form-submit', bookingForm);
      const label = btn ? $('.btn-label', btn) : null;
      const data = Object.fromEntries(new FormData(bookingForm).entries());

      if (data.website) return; // honeypot
      const name = String(data.name || '').trim();
      const email = String(data.email || '').trim();
      const message = String(data.message || '').trim();

      if (name.length < 2) { setStatus(bookingStatus, 'Please add your name.'); focusField(bookingForm, 'name'); return; }
      if (!EMAIL_RE.test(email)) { setStatus(bookingStatus, 'Please add a valid email address.'); focusField(bookingForm, 'email'); return; }
      if (message.length < 10) { setStatus(bookingStatus, 'Tell us a little more about the event (10+ characters).'); focusField(bookingForm, 'message'); return; }

      const date = String(data.date || '').trim();
      const venue = String(data.venue || '').trim();
      const type = String(data.type || 'Club night');
      const budget = String(data.budget || '').trim();

      const lines = [
        'Booking request — FrenchKiss DJ',
        `Name: ${name}`,
        `Email: ${email}`,
        date ? `Date: ${date}` : null,
        venue ? `City / venue: ${venue}` : null,
        `Event type: ${type}`,
        budget ? `Budget: GHC ${budget}` : null,
        '',
        message
      ].filter((line) => line !== null);

      const url = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(lines.join('\n'))}`;
      window.open(url, '_blank', 'noopener');

      if (btn) btn.classList.add('is-done');
      if (label) label.textContent = 'Open WhatsApp again ↗';
      setStatus(
        bookingStatus,
        `Thanks ${name.split(' ')[0]} — WhatsApp is open with your request. Hit send there and you'll have a reply within 24 hours.`,
        true
      );
    });
  }

  /* ── booth sound (opt-in) ────────────────────────────── */
  const soundBtn = $('#sound-btn');
  const boothAudio = $('#booth-audio');

  if (soundBtn && boothAudio) {
    const soundLabel = $('.sb-text', soundBtn);
    boothAudio.volume = 0.55;

    const paint = (on) => {
      soundBtn.classList.toggle('is-on', on);
      soundBtn.setAttribute('aria-pressed', String(on));
      if (soundLabel) soundLabel.textContent = on ? 'Sound on' : 'Play booth sound';
    };

    soundBtn.addEventListener('click', async () => {
      if (boothAudio.paused) {
        try {
          await boothAudio.play();
          paint(true);
        } catch (_) {
          paint(false);
        }
      } else {
        boothAudio.pause();
        paint(false);
      }
    });

    boothAudio.addEventListener('play', () => paint(true));
    boothAudio.addEventListener('pause', () => paint(false));
    boothAudio.addEventListener('ended', () => paint(false));
  }

  /* newsletter */
  const newsForm = $('#news-form');
  const newsStatus = $('#news-status');

  if (newsForm) {
    newsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = $('input[name="email"]', newsForm);
      const email = String(emailInput ? emailInput.value : '').trim();
      const btn = $('button[type="submit"]', newsForm);
      const label = btn ? $('.btn-label', btn) : null;

      if (!EMAIL_RE.test(email)) {
        setStatus(newsStatus, 'Enter a valid email address.');
        focusField(newsForm, 'email');
        return;
      }

      setStatus(newsStatus, 'Adding you…', true);
      if (btn) btn.disabled = true;

      try {
        await postJSON('/api/newsletter', { email });
        newsForm.reset();
        if (label) label.textContent = 'You’re in ✓';
        setStatus(newsStatus, 'You’re on the list. Watch your inbox for the next drop.', true);
      } catch (err) {
        setStatus(newsStatus, err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }
})();
