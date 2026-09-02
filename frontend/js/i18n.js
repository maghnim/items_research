// PricePilot i18n engine — no build step, plain script.
// Language resolution order: explicit saved choice > IP-geolocation (France, Belgium,
// French-speaking Africa) > browser language > English default.

(function () {
  var STORAGE_KEY = 'pp_lang';
  var CURRENCY_KEY = 'pp_currency';
  var FRENCH_COUNTRIES = [
    'FR', 'BE', // France, Belgium
    'MA', 'DZ', 'TN', // Morocco, Algeria, Tunisia
    'SN', 'CI', 'ML', 'NE', 'BF', 'GN', 'TD', 'TG', 'BJ', 'MR', // West/Sahel Africa
    'CM', 'GA', 'CG', 'CD', 'CF', // Central Africa
    'MG', 'RW', 'BI', 'DJ', 'KM', // East/Indian Ocean Africa
  ];
  // English-speaking markets shown USD instead of the EUR base price (display only —
  // billing itself always runs in EUR, see backend/src/routes/billing.js).
  var USD_COUNTRIES = ['US', 'GB', 'CA', 'AU', 'NZ', 'IE'];

  function getCurrency() {
    return localStorage.getItem(CURRENCY_KEY) || 'EUR';
  }

  function notifyLocaleReady() {
    window.dispatchEvent(new CustomEvent('pp:locale-ready', {
      detail: { lang: document.documentElement.getAttribute('lang'), currency: getCurrency() },
    }));
  }

  function getDict(lang) {
    return (window.TRANSLATIONS && window.TRANSLATIONS[lang]) || {};
  }

  function t(key) {
    var lang = document.documentElement.getAttribute('lang') || 'en';
    var dict = getDict(lang);
    return (key in dict) ? dict[key] : ((key in getDict('en')) ? getDict('en')[key] : key);
  }

  function applyTranslations(lang) {
    var dict = getDict(lang);
    var fallback = getDict('en');

    document.documentElement.setAttribute('lang', lang);

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var value = (key in dict) ? dict[key] : fallback[key];
      if (value === undefined) return;
      if (el.hasAttribute('data-i18n-html')) {
        el.innerHTML = value;
      } else {
        el.textContent = value;
      }
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      var spec = el.getAttribute('data-i18n-attr'); // format: "attr:key"
      var parts = spec.split(':');
      var attr = parts[0];
      var key = parts[1];
      var value = (key in dict) ? dict[key] : fallback[key];
      if (value !== undefined) el.setAttribute(attr, value);
    });

    document.querySelectorAll('[data-lang-switch]').forEach(function (el) {
      var isActive = el.getAttribute('data-lang-switch') === lang;
      el.classList.toggle('lang-active', isActive);
    });
  }

  function setLanguage(lang) {
    if (lang !== 'en' && lang !== 'fr') return;
    localStorage.setItem(STORAGE_KEY, lang);
    applyTranslations(lang);
  }

  function quickInitialGuess() {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'fr') return saved;
    var nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    return nav.indexOf('fr') === 0 ? 'fr' : 'en';
  }

  function maybeUpgradeFromGeo() {
    // Language and currency cache independently, but share a single geo lookup.
    var langResolved = !!localStorage.getItem(STORAGE_KEY);
    var currencyResolved = !!localStorage.getItem(CURRENCY_KEY);
    if (langResolved && currencyResolved) return;

    fetch('https://ipwho.is/', { signal: AbortSignal ? AbortSignal.timeout(3000) : undefined })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || data.success === false) throw new Error('geo lookup failed');

        if (!langResolved) {
          var lang = FRENCH_COUNTRIES.indexOf(data.country_code) !== -1 ? 'fr' : 'en';
          localStorage.setItem(STORAGE_KEY, lang);
          applyTranslations(lang);
        }
        if (!currencyResolved) {
          var currency = USD_COUNTRIES.indexOf(data.country_code) !== -1 ? 'USD' : 'EUR';
          localStorage.setItem(CURRENCY_KEY, currency);
        }
        notifyLocaleReady();
      })
      .catch(function () {
        // Network/geo lookup failed — keep the browser-language guess already applied,
        // and cache defaults so we don't retry the lookup on every page.
        if (!langResolved) localStorage.setItem(STORAGE_KEY, quickInitialGuess());
        if (!currencyResolved) localStorage.setItem(CURRENCY_KEY, 'EUR');
        notifyLocaleReady();
      });
  }

  // Apply immediately with best-available guess so there's no blank/hidden page.
  applyTranslations(quickInitialGuess());
  maybeUpgradeFromGeo();

  document.addEventListener('click', function (e) {
    var target = e.target.closest && e.target.closest('[data-lang-switch]');
    if (target) setLanguage(target.getAttribute('data-lang-switch'));
  });

  window.t = t;
  window.setLanguage = setLanguage;
  window.getCurrency = getCurrency;
})();
