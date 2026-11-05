/* Sadaf & Hamid · RSVP client
 *
 * Design-agnostic: it relies only on the ids/classes shared by the D-family pages
 * (#rsvp, #rsvp-form, #party-set, #party, #guests-wrap, #guests, #note-wrap, #note,
 *  #thanks, #t-en, #t-fa, #edit, #greet, #greet-fa, #seats-en, #seats-fa, .opt, .party, .field, .lab, .err,
 *  .upd, .upd-fa, .submit). Extra UI it needs (children question, status line, code entry, reply summary)
 * is injected using those same classes, so it inherits the page's styling.
 *
 * Backend: the Google Apps Script web app in window.RSVP_CONFIG.apiUrl (see config.js and SETUP.md).
 * With no apiUrl configured, or with ?demo in the URL, it runs on sample data and saves nothing.
 *
 * URL flags: ?i=CODE (personal link), ?demo, ?static (freeze animation), ?state=thanks (demo only).
 */
(function () {
  'use strict';

  var CFG = window.RSVP_CONFIG || {};
  var params = new URLSearchParams(location.search);
  if (params.has('static')) document.documentElement.classList.add('static');
  var DEMO = params.has('demo') || !CFG.apiUrl || /PASTE/i.test(CFG.apiUrl);
  var DEADLINE = new Date(CFG.deadline || '2026-12-15T23:59:59-05:00');
  var DEADLINE_EN = 'December 15';
  var DEADLINE_FA = '۲۴ آذر';

  var $ = function (id) { return document.getElementById(id); };
  var faDigits = function (n) { return String(n).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); };
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var rsvp = $('rsvp'), form = $('rsvp-form');
  if (!rsvp || !form) return;
  var partySet = $('party-set'), party = $('party');
  var guestsWrap = $('guests-wrap'), guests = $('guests');
  // The note is only asked of guests who are coming (the couple removed the children, dietary and email questions).
  var noteWrap = $('note-wrap'), thanks = $('thanks'), editBtn = $('edit');
  var submitBtn = form.querySelector('.submit, button[type="submit"]');
  var submitHtml = submitBtn ? submitBtn.innerHTML : '';
  var seatsBox = $('seats-en') ? $('seats-en').parentNode : null;

  /* ---------- injected UI ---------- */

  function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  function bi(en, fa) { return '<span class="en">' + en + '</span><span class="fa" lang="fa" dir="rtl">' + fa + '</span>'; }

  // Neutral by default (loading); gets the page's .err look only for problems.
  var status = el('<p class="rsvp-status" id="rsvp-status" role="status" aria-live="polite" hidden></p>');
  rsvp.insertBefore(status, form);

  // Party size and names are REQUIRED when attending: one name per person (the guest included), for place cards.
  var partyErr = el('<p class="err" id="party-err" role="alert" hidden>Please choose how many people are coming.' +
    '<span class="fa" lang="fa" dir="rtl">لطفاً تعداد نفرات را انتخاب کنید.</span></p>');
  partySet.appendChild(partyErr);
  var namesHint = el('<p class="upd names-hint" id="names-hint">One name per person, exactly as it should appear on the place card.' +
    '<span class="fa" lang="fa" dir="rtl">نام هر نفر را همان‌طور که باید روی کارت نام نوشته شود وارد کنید.</span></p>');
  guests.parentNode.insertBefore(namesHint, guests);
  var namesErr = el('<p class="err" id="names-err" role="alert" hidden>Please write the name of each person coming.' +
    '<span class="fa" lang="fa" dir="rtl">لطفاً نام همه‌ی نفرات را بنویسید.</span></p>');
  guestsWrap.appendChild(namesErr);


  var tFa = $('t-fa');
  var sumEn = el('<p class="upd t-sum" id="t-sum"></p>');
  var sumFa = el('<p class="upd-fa t-sum-fa" lang="fa" dir="rtl" id="t-sum-fa"></p>');
  tFa.parentNode.insertBefore(sumFa, tFa.nextSibling);
  tFa.parentNode.insertBefore(sumEn, sumFa);
  var updEn = thanks.querySelector('.upd:not(.t-sum)'), updFa = thanks.querySelector('.upd-fa:not(.t-sum-fa)');

  var codeBox = el('<div class="code-entry" id="code-entry" hidden>' +
    '<p class="upd">Please open the personal link we sent you, or enter your invitation code.</p>' +
    '<p class="upd-fa" lang="fa" dir="rtl">لطفاً از لینک شخصی‌ای که برایتان فرستاده‌ایم استفاده کنید، یا کد دعوت‌تان را وارد کنید.</p>' +
    '<form id="code-form" novalidate><div class="field">' +
    '<label class="lab" for="code-input">' + bi('Invitation code', 'کد دعوت') + '</label>' +
    '<input id="code-input" name="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" dir="ltr" maxlength="12" style="text-transform:uppercase;letter-spacing:.12em">' +
    '</div><button type="submit" class="submit">Continue<span class="fa" lang="fa" dir="rtl">ادامه</span></button></form></div>');
  rsvp.insertBefore(codeBox, thanks);

  /* ---------- state ---------- */

  var code = '';
  var invite = null;     // { household, greetingFa, seats }
  var current = null;    // the saved reply, or null
  var closed = Date.now() > DEADLINE.getTime();
  var keep = [];         // typed guest names survive party-size changes

  function say(en, fa, kind) {
    if (!en) { status.hidden = true; status.innerHTML = ''; return; }
    status.innerHTML = en + '<span class="fa" lang="fa" dir="rtl">' + fa + '</span>';
    status.setAttribute('role', kind === 'alert' ? 'alert' : 'status');
    status.classList.toggle('err', kind === 'alert');
    status.hidden = false;
  }

  function show(which) { // 'form' | 'thanks' | 'code' | 'none'
    form.hidden = which !== 'form';
    thanks.hidden = which !== 'thanks';
    codeBox.hidden = which !== 'code';
  }

  /* ---------- personalisation ---------- */

  function personalise() {
    var g = $('greet'), gf = $('greet-fa');
    if (!invite) {
      if (g) g.hidden = true;
      if (gf) gf.hidden = true;
      if (seatsBox) seatsBox.hidden = true;
      return;
    }
    if (g) { g.textContent = 'Dear ' + invite.household; g.hidden = false; }
    if (gf) { gf.textContent = invite.greetingFa || ''; gf.hidden = !invite.greetingFa; }
    if (seatsBox) {
      $('seats-en').textContent = invite.seats === 1 ? 'We have reserved a seat for you.' : 'We have reserved ' + invite.seats + ' seats for you.';
      $('seats-fa').textContent = invite.seats === 1 ? 'برای شما یک جا در نظر گرفته‌ایم.' : 'برای شما ' + faDigits(invite.seats) + ' جا در نظر گرفته‌ایم.';
      seatsBox.hidden = false;
    }
    buildParty(invite.seats);
  }

  function pill(name, id, value, en, fa, checked) {
    return '<div class="opt"><input type="radio" name="' + name + '" id="' + id + '" value="' + value + '"' + (checked ? ' checked' : '') + '>' +
      '<label for="' + id + '"><span class="en"><bdi dir="ltr">' + en + '</bdi></span>' +
      '<span class="fa" lang="fa" dir="rtl"><bdi dir="ltr">' + fa + '</bdi></span></label></div>';
  }

  function buildParty(seats) {
    // 1..seats people, no default: the guest must choose. A one-seat invitation is fixed at 1 (the choice is hidden).
    var html = '';
    for (var i = 1; i <= seats; i++) {
      html += pill('party', 'party-' + i, i, String(i), faDigits(i), seats === 1);
    }
    party.innerHTML = html;
  }

  // 0 until the guest has chosen.
  function partySize() { return Number(form.elements.party && form.elements.party.value) || 0; }

  function renderGuests() {
    var n = partySize(); // a name field for EVERY person coming, the guest included
    guests.querySelectorAll('input').forEach(function (x, i) { keep[i] = x.value; });
    guests.innerHTML = '';
    for (var i = 1; i <= n; i++) {
      var id = 'guest' + i;
      var lab = document.createElement('label');
      lab.className = 'sr'; lab.htmlFor = id; lab.textContent = 'Name of person ' + i + ' (required)';
      var inp = document.createElement('input');
      inp.type = 'text'; inp.id = id; inp.name = id; inp.autocomplete = i === 1 ? 'name' : 'off'; inp.dir = 'auto';
      inp.maxLength = 80; inp.required = true; inp.setAttribute('aria-required', 'true');
      inp.placeholder = (i === 1 ? 'Your full name' : 'Full name ' + i) + '  ·  ⁧' + (i === 1 ? 'نام شما' : 'نام نفر ' + faDigits(i)) + '⁩';
      inp.value = keep[i - 1] || '';
      inp.addEventListener('input', function () { this.removeAttribute('aria-invalid'); });
      guests.append(lab, inp);
    }
    guestsWrap.hidden = n === 0;
    if (n) partyErr.hidden = true;
  }

  function sync() {
    var yes = form.elements.attending.value === 'yes';
    partySet.hidden = !yes || (invite && invite.seats === 1);
    if (noteWrap) noteWrap.hidden = !yes;
    if (yes) { renderGuests(); } else { guestsWrap.hidden = true; partyErr.hidden = true; namesErr.hidden = true; }
    // Inputs in hidden blocks are disabled so a decline never carries stale party data.
    [partySet, guestsWrap, noteWrap].filter(Boolean).forEach(function (box) {
      box.querySelectorAll('input,textarea,select').forEach(function (x) { x.disabled = box.hidden; });
    });
    if (form.elements.attending.value) { var e = $('att-err'); if (e) e.hidden = true; }
  }

  form.addEventListener('change', function (e) {
    var n = e.target.name;
    if (n === 'attending' || n === 'party') sync();
  });

  /* ---------- reply <-> form ---------- */

  function prefill(r) {
    if (!r) return;
    var att = r.attending === 'yes' ? $('att-yes') : $('att-no');
    if (att) att.checked = true;
    keep = (r.guests || []).slice();
    if (r.attending === 'yes') {
      var p = $('party-' + Math.min(Math.max(r.party || 1, 1), invite ? invite.seats : 8));
      if (p) p.checked = true;
    }
    sync();
    $('note').value = r.note || '';
  }

  function collect() {
    var yes = form.elements.attending.value === 'yes';
    var size = yes ? partySize() : 0;
    var names = [];
    if (yes) guests.querySelectorAll('input').forEach(function (x) { names.push(x.value.trim()); });
    return {
      code: code,
      attending: form.elements.attending.value,
      party: size,
      children: 0,
      guests: names,
      dietary: '',
      email: '',
      note: yes ? $('note').value.trim() : '',
    };
  }

  function summary(r) {
    if (r.attending !== 'yes') return ['Your reply: not able to come.', 'پاسخ شما: متأسفانه نمی‌توانید تشریف بیاورید.'];
    var names = (r.guests || []).filter(Boolean);
    if (r.party <= 1) return ['Your reply: coming, just you' + (names[0] ? ' (' + names[0] + ')' : '') + '.',
      'پاسخ شما: تشریف می‌آورید، فقط خودتان' + (names[0] ? ' (' + names[0] + ')' : '') + '.'];
    var adults = r.party - r.children;
    var en = 'Your reply: coming, ' + r.party + ' guests (' + adults + ' adult' + (adults === 1 ? '' : 's') +
      (r.children ? ', ' + r.children + ' child' + (r.children === 1 ? '' : 'ren') : '') + ')' +
      (names.length ? ': ' + names.join(', ') : '') + '.';
    var fa = 'پاسخ شما: تشریف می‌آورید، ' + faDigits(r.party) + ' نفر (' + faDigits(adults) + ' بزرگسال' +
      (r.children ? '، ' + faDigits(r.children) + ' کودک' : '') + ')' + (names.length ? ': ' + names.join('، ') : '') + '.';
    return [en, fa];
  }

  function showThanks(r, mode) { // mode: 'saved' | 'updated' | 'existing'
    var yes = r.attending === 'yes';
    var t = $('t-en');
    if (mode === 'updated') {
      t.textContent = 'Your reply has been updated. Thank you.';
      tFa.textContent = 'پاسخ شما به‌روز شد؛ سپاسگزاریم.';
    } else {
      t.textContent = yes ? "Thank you. We can't wait to celebrate with you." : "Thank you for letting us know. You'll be missed.";
      tFa.textContent = yes ? 'سپاسگزاریم؛ مشتاق دیدارتان هستیم.' : 'از اطلاع‌تان سپاسگزاریم؛ جایتان خالی خواهد بود.';
    }
    var s = summary(r);
    sumEn.textContent = s[0]; sumFa.textContent = s[1];
    if (closed) {
      updEn.textContent = 'Replies closed on ' + DEADLINE_EN + '. For any change, please contact us directly.';
      updFa.textContent = 'مهلت پاسخ‌دهی ' + DEADLINE_FA + ' به پایان رسید. برای هر تغییری لطفاً مستقیماً با ما تماس بگیرید.';
      editBtn.hidden = true;
    } else {
      updEn.textContent = 'Plans change? Open this same link any time until ' + DEADLINE_EN + ' to update your reply.';
      updFa.textContent = 'اگر برنامه‌تان تغییر کرد، تا ' + DEADLINE_FA + ' هر زمان با همین لینک می‌توانید پاسخ‌تان را ویرایش کنید.';
      editBtn.hidden = false;
    }
    say('');
    show('thanks');
  }

  function showClosedNoReply() {
    say('Replies closed on ' + DEADLINE_EN + '. If you still need to reach us, please contact us directly.',
      'مهلت پاسخ‌دهی ' + DEADLINE_FA + ' به پایان رسید. لطفاً مستقیماً با ما تماس بگیرید.');
    show('none');
  }

  /* ---------- API ---------- */

  var DEMO_INVITE = { household: 'Karimi Family', greetingFa: 'خانواده‌ی گرامی کریمی', seats: 4 };
  var demoSaved = null;

  function call(url, opts) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 25000) : null;
    if (ctl) opts.signal = ctl.signal;
    return fetch(url, opts).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  function apiGet(c) {
    if (DEMO) {
      return new Promise(function (ok) {
        setTimeout(function () {
          ok(c === 'NOPE' ? { ok: false, error: 'not_found' } : { ok: true, invite: DEMO_INVITE, response: demoSaved, closed: closed });
        }, 250);
      });
    }
    return call(CFG.apiUrl + '?code=' + encodeURIComponent(c), { method: 'GET', redirect: 'follow', cache: 'no-store' });
  }

  function apiPost(payload) {
    if (DEMO) {
      return new Promise(function (ok) {
        setTimeout(function () {
          var r = { attending: payload.attending, party: payload.party, children: payload.children,
            guests: payload.guests.filter(Boolean), dietary: payload.dietary, email: payload.email, note: payload.note };
          demoSaved = r;
          ok({ ok: true, response: r, changed: true });
        }, 400);
      });
    }
    return call(CFG.apiUrl, {
      method: 'POST', redirect: 'follow', cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
  }

  /* ---------- flows ---------- */

  function remember(c) {
    if (DEMO) return; // sample data must never be remembered as a real household
    try { localStorage.setItem('rsvp-code', c); } catch (_) { /* private mode */ }
    if (params.get('i') !== c) {
      params.set('i', c);
      try { history.replaceState(null, '', location.pathname + '?' + params.toString() + location.hash); } catch (_) { /* file:// */ }
    }
  }

  function load(c, fromEntry) {
    code = c;
    say('Loading your invitation…', 'در حال بارگذاری دعوت‌نامه…');
    show('none');
    return apiGet(c).then(function (res) {
      if (!res || !res.ok) {
        if (res && res.error === 'not_found') {
          // A remembered code that no longer exists must not greet the guest with an error on every visit.
          try { if (localStorage.getItem('rsvp-code') === c) localStorage.removeItem('rsvp-code'); } catch (_) { /* private mode */ }
          invite = null; personalise();
          say("We couldn't find that invitation code. Please check your personal link.",
            'این کد دعوت پیدا نشد. لطفاً لینک شخصی‌تان را بررسی کنید.', 'alert');
          show('code');
          if (fromEntry) $('code-input').focus();
          return;
        }
        throw new Error(res && res.error || 'bad response');
      }
      invite = res.invite;
      current = res.response;
      closed = closed || !!res.closed;
      personalise();
      remember(c);
      say('');
      if (current) { prefill(current); showThanks(current, 'existing'); }
      else if (closed) { showClosedNoReply(); }
      else { sync(); show('form'); }
    }).catch(function () {
      say("We couldn't load your invitation. Please check your connection and reload the page.",
        'بارگذاری دعوت‌نامه ممکن نشد. لطفاً اتصال اینترنت را بررسی و صفحه را دوباره باز کنید.', 'alert');
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!form.elements.attending.value) {
      var err = $('att-err'); if (err) err.hidden = false;
      $('att-yes').focus();
      return;
    }
    if (closed) { showClosedNoReply(); return; }
    if (form.elements.attending.value === 'yes') {
      if (!partySize()) { partyErr.hidden = false; var p1 = $('party-1'); if (p1) p1.focus(); return; }
      var empty = Array.prototype.filter.call(guests.querySelectorAll('input'), function (x) { return !x.value.trim(); });
      guests.querySelectorAll('input').forEach(function (x) { if (x.value.trim()) x.removeAttribute('aria-invalid'); else x.setAttribute('aria-invalid', 'true'); });
      if (empty.length) { namesErr.hidden = false; empty[0].focus(); return; }
      namesErr.hidden = true;
    }
    var payload = collect();
    var wasSaved = !!current;
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Sending…<span class="fa" lang="fa" dir="rtl">در حال ارسال…</span>';
    say('');
    apiPost(payload).then(function (res) {
      if (res && res.ok) {
        current = res.response;
        showThanks(current, wasSaved ? 'updated' : 'saved');
        thanks.focus({ preventScroll: true });
        rsvp.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        return;
      }
      var code = res && res.error;
      if (code === 'closed') { closed = true; if (current) showThanks(current, 'existing'); else showClosedNoReply(); return; }
      if (code === 'not_found') { say("We couldn't find your invitation code. Please use your personal link.", 'کد دعوت پیدا نشد. لطفاً از لینک شخصی‌تان استفاده کنید.', 'alert'); return; }
      if (code === 'bad_email') {
        say('That email address does not look right. Please check it, or leave it blank.',
          'نشانی ایمیل درست به نظر نمی‌رسد. لطفاً آن را بررسی کنید یا خالی بگذارید.', 'alert');
        var em = $('email'); if (em) em.focus();
        return;
      }
      if (code === 'missing_names') { namesErr.hidden = false; var f = guests.querySelector('input'); if (f) f.focus(); return; }
      if (code && code.indexOf('bad_') === 0) { say('Please check your answers and try again.', 'لطفاً پاسخ‌ها را بررسی و دوباره ارسال کنید.', 'alert'); return; }
      throw new Error(code || 'server');
    }).catch(function () {
      say('Something went wrong while sending. Please try again in a moment.',
        'در ارسال پاسخ مشکلی پیش آمد. لطفاً چند لحظه بعد دوباره تلاش کنید.', 'alert');
    }).finally(function () {
      submitBtn.disabled = false;
      submitBtn.innerHTML = submitHtml;
    });
  });

  editBtn.addEventListener('click', function () {
    if (closed) return;
    prefill(current);
    show('form');
    var att = form.elements.attending.value === 'no' ? $('att-no') : $('att-yes');
    if (att) att.focus();
  });

  $('code-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var c = String($('code-input').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length < 4) { $('code-input').focus(); return; }
    load(c, true);
  });

  /* ---------- start ---------- */

  var start = (params.get('i') || params.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!start) { try { start = localStorage.getItem('rsvp-code') || ''; } catch (_) { start = ''; } }
  if (!start && DEMO) start = 'DEMO';

  if (DEMO && params.get('state') === 'thanks') {
    demoSaved = { attending: 'yes', party: 3, children: 0, guests: ['Ali Karimi', 'Mina Karimi', 'Sara Karimi'], dietary: '', email: '', note: '' };
  }

  if (start) {
    load(start).then(function () {
      if (DEMO && params.get('state') === 'thanks') {
        var go = function () { rsvp.scrollIntoView({ block: 'start' }); };
        (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () { requestAnimationFrame(go); });
      }
    });
  } else {
    invite = null;
    personalise();
    show('code');
  }
})();
