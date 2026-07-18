// MyGrind blog — affiliate click tracking (2026-07-18).
// Fires the same GA4 event as /picks so all affiliate clicks report together.
// Include at the end of any page that renders .gear-card or .pick-card links.
(function () {
  document.querySelectorAll('.gear-card, .pick-card').forEach(function (card) {
    card.addEventListener('click', function () {
      try {
        if (typeof gtag === 'function') {
          gtag('event', 'affiliate_click', {
            item_name: card.getAttribute('data-pick') || '',
            item_category: card.getAttribute('data-cat') || '',
            placement: card.getAttribute('data-placement') || 'in_post'
          });
        }
      } catch (e) {}
    });
  });
})();
