/* JK Logistics — nav + hero interactions
   Vanilla JS, no dependencies. Everything degrades gracefully without it. */
(function () {
  'use strict';

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ── Dismissible announcement banner ───────────────────────────────── */
  $$('[data-dismiss]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = $(btn.getAttribute('data-dismiss'));
      if (!target) return;
      target.style.transition = 'opacity .25s ease';
      target.style.opacity = '0';
      setTimeout(function () { target.remove(); }, 250);
    });
  });

  /* ── Mobile menu ───────────────────────────────────────────────────── */
  var menuBtn   = $('#menu-btn');
  var mobileNav = $('#mobile-menu');
  var iconOpen  = $('#icon-open');
  var iconClose = $('#icon-close');

  function setMenu(open) {
    if (!menuBtn || !mobileNav) return;
    mobileNav.classList.toggle('hidden', !open);
    menuBtn.setAttribute('aria-expanded', String(open));
    if (iconOpen)  iconOpen.classList.toggle('hidden', open);
    if (iconClose) iconClose.classList.toggle('hidden', !open);
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      setMenu(mobileNav.classList.contains('hidden'));
    });
    $$('#mobile-menu a').forEach(function (a) {
      a.addEventListener('click', function () { setMenu(false); });
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setMenu(false);
  });

  /* ── Header shadow on scroll ───────────────────────────────────────── */
  var header = $('#site-header');
  var ticking = false;

  function onScroll() {
    if (!header) return;
    header.classList.toggle('shadow-nav', window.scrollY > 8);
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { window.requestAnimationFrame(onScroll); ticking = true; }
  }, { passive: true });
  onScroll();

  /* ── Hero stat counters ────────────────────────────────────────────── */
  var stats = $$('[data-count]');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function renderStat(el, value) {
    var dp = parseInt(el.getAttribute('data-decimals') || '0', 10);
    el.textContent = value.toFixed(dp) + (el.getAttribute('data-suffix') || '');
  }

  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    if (isNaN(target)) return;
    if (reduceMotion) { renderStat(el, target); return; }

    var duration = 1400;
    var start = null;

    function step(now) {
      if (start === null) start = now;
      var p = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);          // easeOutCubic
      renderStat(el, target * eased);
      if (p < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  if ('IntersectionObserver' in window) {
    var statObserver = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        countUp(entry.target);
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.4 });
    stats.forEach(function (el) { statObserver.observe(el); });
  } else {
    stats.forEach(countUp);
  }

  /* ── Contact enquiry form ──────────────────────────────────────────── */
  var enquiry = $('#enquiry');

  /* The one line to change if the site moves host. Each host maps this path to its
     own handler — netlify.toml does it now, an .htaccess rewrite would do it on PHP. */
  var ENQUIRY_ENDPOINT = '/api/enquiry';

  /* Shown when the send itself fails, so the visitor still has a way to reach us. */
  var SEND_FAILED = 'Something went wrong sending that. Please call +44 7587 543669 ' +
                    'or email r.singh@jksmartlogistics.co.uk and we will pick it up straight away.';

  if (enquiry) {
    var RULES = {
      name:    { test: function (v) { return v.length >= 2; },
                 msg: 'Please tell us your name.' },
      email:   { test: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); },
                 msg: 'Enter a valid email address, e.g. jane@company.co.uk' },
      phone:   { test: function (v) { return /^(\+44\s?|0)[\d\s-]{9,14}$/.test(v); },
                 msg: 'Enter a UK phone number, e.g. 07700 900123.' },
      message: { test: function (v) { return v.length >= 10; },
                 msg: 'A sentence or two about the load helps us price it.' }
    };

    function setError(field, text) {
      var slot = field.parentElement.querySelector('.err');
      var bad = !!text;
      if (slot) {
        slot.textContent = text || '';
        slot.classList.toggle('hidden', !bad);
      }
      field.setAttribute('aria-invalid', String(bad));
      field.classList.toggle('border-red-500', bad);
      field.classList.toggle('border-line', !bad);
      return !bad;
    }

    /* Clear a field's error as soon as it is corrected. */
    Object.keys(RULES).forEach(function (id) {
      var field = document.getElementById(id);
      if (!field) return;
      field.addEventListener('input', function () {
        if (field.getAttribute('aria-invalid') === 'true' && RULES[id].test(field.value.trim())) {
          setError(field, '');
        }
      });
    });

    enquiry.addEventListener('submit', function (e) {
      e.preventDefault();
      var firstBad = null;

      Object.keys(RULES).forEach(function (id) {
        var field = document.getElementById(id);
        if (!field) return;
        var ok = RULES[id].test(field.value.trim());
        setError(field, ok ? '' : RULES[id].msg);
        if (!ok && !firstBad) firstBad = field;
      });

      var consent = $('#consent');
      if (consent) {
        var agreed = consent.checked;
        var slot = consent.closest('div').querySelector('.err');
        if (slot) {
          slot.textContent = agreed ? '' : 'Please tick the box so we can reply to you.';
          slot.classList.toggle('hidden', agreed);
        }
        if (!agreed && !firstBad) firstBad = consent;
      }

      if (firstBad) {
        firstBad.focus();
        firstBad.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        return;
      }

      send();
    });

    function send() {
      var button = $('button[type="submit"]', enquiry);
      var label  = button && $('[data-label]', button);
      var errBox = $('#enquiry-error');
      var done   = $('#enquiry-done');

      if (errBox) errBox.classList.add('hidden');
      if (button) button.disabled = true;
      if (label)  label.textContent = 'Sending…';

      function failed(text) {
        if (button) button.disabled = false;
        if (label)  label.textContent = 'Send enquiry';
        if (!errBox) return;
        errBox.textContent = text;
        errBox.classList.remove('hidden');
        errBox.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      }

      var payload = {
        name:    $('#name').value.trim(),
        company: $('#company') ? $('#company').value.trim() : '',
        email:   $('#email').value.trim(),
        phone:   $('#phone').value.trim(),
        service: $('#service') ? $('#service').value : '',
        from:    $('#from') ? $('#from').value.trim() : '',
        to:      $('#to') ? $('#to').value.trim() : '',
        message: $('#message').value.trim(),
        website: $('#website') ? $('#website').value : '',
        consent: $('#consent') ? $('#consent').checked : false
      };

      fetch(ENQUIRY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; })
            .then(function (body) {
              return { ok: res.ok && body.ok !== false, status: res.status, body: body };
            });
        })
        .then(function (result) {
          /* Only swap in the success panel once the mail is actually away — a failed
             send must never look like a delivered one. Everything typed stays put. */
          if (!result.ok) {
            /* A 400 names the field to fix, which is worth repeating. Anything else is
               our fault, so hand over the phone number rather than a server message. */
            var actionable = result.status >= 400 && result.status < 500 && result.body.error;
            failed(actionable ? result.body.error : SEND_FAILED);
            return;
          }
          enquiry.classList.add('hidden');
          if (done) {
            done.classList.remove('hidden');
            done.setAttribute('tabindex', '-1');
            done.focus();
          }
        })
        .catch(function () { failed(SEND_FAILED); });
    }
  }


  /* ── Newsletter sign-up (front-end validation only) ────────────────── */
  var news = $('#newsletter');
  var newsMsg = $('#news-msg');

  if (news && newsMsg) {
    news.addEventListener('submit', function (e) {
      e.preventDefault();
      var field = $('#news-email');
      var value = (field.value || '').trim();
      var valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

      newsMsg.textContent = valid
        ? 'Thanks — check your inbox to confirm your subscription.'
        : 'Please enter a valid email address.';
      newsMsg.className = 'mt-3 text-[14px] font-medium ' + (valid ? 'text-lime' : 'text-red-300');

      if (valid) { field.value = ''; } else { field.focus(); }
    });
  }

  /* ── Service card reveal (tap support; hover/focus is pure CSS) ────── */
  $$('[data-reveal]').forEach(function (btn) {
    var card = btn.closest('.group');
    if (!card) return;

    btn.addEventListener('click', function () {
      var open = card.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(open));

      /* Only one open at a time keeps the grid readable on a phone. */
      if (open) {
        $$('.group.is-open').forEach(function (other) {
          if (other === card) return;
          other.classList.remove('is-open');
          var b = $('[data-reveal]', other);
          if (b) b.setAttribute('aria-expanded', 'false');
        });
      }
    });
  });

  /* ── Fleet carousel ──────────────────────────────────────
     A scroll-snap rail, so neighbouring vehicles stay in view. The browser owns
     the scrolling and the swipe; we only drive it from the arrows, dots and
     arrow keys, and read the position back to light the right dot. */
  var track = $('#fleet-track');

  if (track) {
    var cards    = $$('.fleet-card', track);
    var dots     = $$('[data-dot]');
    var prevBtns = $$('[data-slide="prev"]');
    var nextBtns = $$('[data-slide="next"]');

    /* Cards share an offsetParent that is not the track, so measure each one
       against the first rather than trusting offsetLeft on its own. */
    function offsetOf(i) { return cards[i].offsetLeft - cards[0].offsetLeft; }

    function current() {
      var best = 0, min = Infinity;
      cards.forEach(function (card, i) {
        var d = Math.abs(offsetOf(i) - track.scrollLeft);
        if (d < min) { min = d; best = i; }
      });
      return best;
    }

    function goTo(i) {
      if (!cards.length) return;
      i = Math.max(0, Math.min(cards.length - 1, i));
      track.scrollTo({ left: offsetOf(i), behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    function sync() {
      if (!cards.length) return;
      var i = current();

      dots.forEach(function (dot, d) {
        var on = d === i;
        dot.className = 'rounded-full transition ' +
          (on ? 'h-2.5 w-6 bg-lime' : 'h-2.5 w-2.5 bg-ink/20 hover:bg-ink/40');
        dot.setAttribute('aria-current', on ? 'true' : 'false');
      });

      var atStart = track.scrollLeft <= 2;
      var atEnd   = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
      prevBtns.forEach(function (b) { b.disabled = atStart; });
      nextBtns.forEach(function (b) { b.disabled = atEnd; });
    }

    prevBtns.forEach(function (b) {
      b.addEventListener('click', function () { goTo(current() - 1); });
    });
    nextBtns.forEach(function (b) {
      b.addEventListener('click', function () { goTo(current() + 1); });
    });

    dots.forEach(function (dot) {
      dot.addEventListener('click', function () {
        goTo(parseInt(dot.getAttribute('data-dot'), 10));
      });
    });

    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight')     { e.preventDefault(); goTo(current() + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current() - 1); }
    });

    var tick;
    track.addEventListener('scroll', function () {
      clearTimeout(tick);
      tick = setTimeout(sync, 80);
    }, { passive: true });

    window.addEventListener('resize', sync);
    sync();
  }

})();
