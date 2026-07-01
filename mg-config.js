// ═══════════════════════════════════════════════════════════════════
// MY GRIND — URL CONFIG OVERRIDE
// Upload this file to your GitHub repo alongside index.html
// Then add this line BEFORE the closing </body> tag in index.html:
//   <script src="mg-config.js"></script>
//
// This overrides the QR code and all share links to send new users
// through onboarding.html first, then into the app.
// ═══════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ── URLS ─────────────────────────────────────────────────────────
  // APP_URL = the live journal app on the production domain (Vercel).
  //   Repointed 2026-05-31 off the legacy youngsbaseball.github.io GitHub
  //   Pages copy when the repo moved to the mygrindapp org. window.APP_URL
  //   is currently unused (softball.html defines its own APP_URL const),
  //   kept correct in case anything reads it later.
  // ONBOARD_URL = parent signup funnel on the production domain.
  // 2026-05-02: was 'https://mygrindapp.com' but that's now the waitlist
  // landing — sharing the app from there dumped friends on a "be first
  // to know" page instead of letting them actually start. Pointing at
  // /signup.html so warm referrals enter the real funnel.
  var APP_URL     = 'https://mygrindapp.com/softball.html';
  var ONBOARD_URL = 'https://mygrindapp.com/signup.html';

  // Override the global constants the app uses for QR + sharing
  // New users → onboarding.html (journals story + paywall)
  // Returning users → onboarding.html auto-redirects them to the app
  window.APP_URL      = APP_URL;
  window.TRIAL_URL    = ONBOARD_URL;
  window.REFERRAL_URL = ONBOARD_URL;
  window.SHARE_URL    = ONBOARD_URL;
  window.ONBOARD_URL  = ONBOARD_URL;

  // ── SHARE CAPTIONS (updated with onboarding link) ─────────────────
  window.SHARE_CAPTIONS = {
    instagram: [
      'Bro this app is different ⚾️\n\n',
      'Been using MY GRIND to log my games and track my stats. ',
      'Not just a notes app — it auto-calculates AVG, OBP, SLG, ERA, ',
      'has a 12-month training plan, goals, arm care, everything.\n\n',
      'Actually changed how I approach every game. I log everything now.\n\n',
      '30 days free. Download and try it 👇\n',
      ONBOARD_URL,
      '\n\nWho needs this? Tag \'em 👇\n\n',
      '#MyGrind #BaseballLife #BaseballTraining #PlayerDevelopment ',
      '#BaseballJournal #YouthBaseball #BaseballPlayer #HighSchoolBaseball ',
      '#TravelBall #BaseballCoach #SCVBaseball #SantaClaritaBaseball ',
      '#BaseballMom #BaseballDad #BaseballFamily #BaseballGrind ',
      '#NeverStopGrinding #BaseballIsLife #FutureProBaseball'
    ].join(''),

    facebook: [
      'Parents — if your kid plays baseball, they need to see this. ⚾️\n\n',
      'My son started using MY GRIND this season and the difference is real. ',
      'He\'s more focused, more accountable, actually thinking about his game between practices. ',
      'Every game he logs what happened, tracks his stats, and reviews what he\'s working on.\n\n',
      'The app has everything a serious player needs — a daily journal, ',
      'automatic stat calculations (AVG, OBP, SLG, ERA), a 12-month training plan, ',
      'goal tracking, arm care, and more.\n\n',
      '30-day free trial. Just let them try it.\n\n',
      '👉 ', ONBOARD_URL, '\n\n',
      'Tag a baseball family who\'d use this 👇\n\n',
      '#MyGrind #BaseballParents #BaseballFamily #TravelBall #YouthBaseball ',
      '#HighSchoolBaseball #BaseballTraining #PlayerDevelopment #SCVBaseball'
    ].join(''),

    twitter: [
      '.300 hitters journal. .200 hitters guess. ⚾️\n\n',
      'MY GRIND — auto stats, daily journal, 12-month training plan. ',
      'Everything a serious player needs in one app.\n\n',
      '30 days free 👇\n',
      ONBOARD_URL,
      '\n\n#MyGrind #BaseballGrind'
    ].join(''),

    sms: [
      'Yo you gotta get this. MY GRIND — journal + stats + training plan in one app.\n\n',
      'Been logging every game with it. Download it and let\'s keep each other accountable this season 💯\n\n',
      '30 days free 👇\n',
      ONBOARD_URL
    ].join('')
  };

  // ── QR CODE OVERRIDE ──────────────────────────────────────────────
  // Re-generate the QR code pointing to onboarding URL
  // Runs after a short delay to ensure qrGenerated flag is set first
  var _qrPatched = false;
  function patchQR() {
    if (_qrPatched) return;
    var container = document.getElementById('qr-container');
    if (!container) return;
    // Clear existing QR
    container.innerHTML = '';
    try {
      if (typeof QRCode !== 'undefined') {
        new QRCode(container, {
          text:           ONBOARD_URL,
          width:          200,
          height:         200,
          colorDark:      '#0A0A0A',
          colorLight:     '#F4F4F4',
          correctLevel:   QRCode.CorrectLevel.H
        });
        _qrPatched = true;
      } else {
        // Fallback: Google Charts QR API
        var img = document.createElement('img');
        img.src    = 'https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=' + encodeURIComponent(ONBOARD_URL) + '&choe=UTF-8&chld=H|2';
        img.alt    = 'QR Code — Scan to Start Your MyGrind Journey';
        img.width  = 200;
        img.height = 200;
        container.appendChild(img);
        _qrPatched = true;
      }
    } catch(e) {
      console.warn('[MyGrind] QR patch failed:', e);
    }
  }

  // Patch QR whenever the Share tab opens (initQR is called then)
  var _origInitQR = window.initQR;
  window.initQR = function() {
    // Let original run first (it sets qrGenerated = true)
    if (typeof _origInitQR === 'function') {
      try { _origInitQR.apply(this, arguments); } catch(e) {}
    }
    // Then re-generate pointing to onboarding
    setTimeout(patchQR, 150);
  };

  // Also patch qrGenerated flag so initQR doesn't skip the re-render
  Object.defineProperty(window, 'qrGenerated', {
    get: function() { return false; },   // always allow re-render
    set: function() {},
    configurable: true
  });

  // ── COPY LINK BUTTON OVERRIDE ─────────────────────────────────────
  var _origCopyReferralLink = window.copyReferralLink;
  window.copyReferralLink = function() {
    var btn = document.getElementById('copy-btn') || document.getElementById('share-copy-btn');
    var url = ONBOARD_URL;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function() {
        if (btn) {
          var orig = btn.innerHTML;
          btn.innerHTML = '✅ Copied!';
          btn.style.color        = '#27AE60';
          btn.style.borderColor  = '#27AE60';
          setTimeout(function() {
            btn.innerHTML        = orig;
            btn.style.color      = '';
            btn.style.borderColor = '';
          }, 2500);
        }
        if (typeof showShareToast === 'function') showShareToast('✅ Link copied — send it to a teammate!');
      }).catch(function() { prompt('Copy this link:', url); });
    } else {
      prompt('Copy this link:', url);
    }
  };

  // ── SHARE PANEL TEXT OVERRIDE ─────────────────────────────────────
  // Update the URL display in the Share tab
  function updateSharePanelText() {
    // The share panel shows the raw URL in a <div> — find it and update
    var urlDivs = document.querySelectorAll('[data-share-url]');
    urlDivs.forEach(function(el) { el.textContent = ONBOARD_URL; });

    // Also update the visible URL line under the QR code
    var panels = document.querySelectorAll('#panel-share');
    panels.forEach(function(panel) {
      var spans = panel.querySelectorAll('div[style*="Bebas Neue"]');
      spans.forEach(function(s) {
        // Legacy scrubber (keep matching the OLD url): rewrites any stale
        // youngsbaseball.github.io string surviving in cached share panels
        // to the production domain. Do not "modernize" this match string.
        if (s.textContent && s.textContent.includes('youngsbaseball.github.io')) {
          s.textContent = 'mygrindapp.com';
        }
      });
    });
  }

  // ── NATIVE SHARE OVERRIDE ─────────────────────────────────────────
  var _origShareNative = window.shareNative;
  window.shareNative = function() {
    var shareData = {
      title: 'My Grind — Baseball Journal App',
      text:  '30-Day Free Trial. Baseball journal app for player development. Track stats, log games, and hold yourself accountable every day.',
      url:   ONBOARD_URL
    };
    if (navigator.share) {
      navigator.share(shareData).catch(function() {
        if (typeof window.copyReferralLink === 'function') window.copyReferralLink();
      });
    } else {
      if (typeof window.copyReferralLink === 'function') window.copyReferralLink();
    }
  };

  // ── SHARE TO SOCIAL OVERRIDE ──────────────────────────────────────
  // The modal's copy-link button should also use the onboarding URL
  var _origCopyModalLink = window.copyModalLink;
  window.copyModalLink = function() {
    navigator.clipboard && navigator.clipboard.writeText(ONBOARD_URL).then(function() {
      var btn = document.getElementById('modal-copy-btn');
      if (btn) {
        btn.textContent = '✅ Copied!';
        btn.style.color = '#27AE60';
        setTimeout(function() { btn.textContent = 'Copy Link'; btn.style.color = ''; }, 2000);
      }
    }).catch(function() { prompt('Copy:', ONBOARD_URL); });
  };

  // ── MILESTONE SHARE OVERRIDE ──────────────────────────────────────
  var _origFallbackShare = window.fallbackShare;
  window.fallbackShare = function(msg) {
    // Legacy scrubber (keep matching the OLD url): rewrite any stale
    // youngsbaseball.github.io app URL left in old cached share messages
    // to the onboarding URL. Do not "modernize" this match string.
    var updatedMsg = msg.replace(/https:\/\/youngsbaseball\.github\.io\/mybaseballgrind(?!\/onboarding)/g, ONBOARD_URL);
    if (typeof _origFallbackShare === 'function') {
      _origFallbackShare(updatedMsg);
    } else {
      var ua  = navigator.userAgent;
      var sep = /iPhone|iPad|iPod/i.test(ua) ? '&' : '?';
      var url = 'sms:' + sep + 'body=' + encodeURIComponent(updatedMsg);
      try {
        var a = document.createElement('a');
        a.href = url; a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(function() { try { document.body.removeChild(a); } catch(e) {} }, 200);
      } catch(err) { window.location.href = url; }
    }
  };

  // ── RUN UPDATES ON DOM READY ──────────────────────────────────────
  function onReady() {
    updateSharePanelText();
    // Patch QR if the Share panel is already visible
    if (document.getElementById('qr-container')) patchQR();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    setTimeout(onReady, 200);
  }

  console.log('[MyGrind Config] URLs updated → onboarding.html');

})();
