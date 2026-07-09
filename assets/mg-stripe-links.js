// MyGrind — single source of truth for Stripe Payment Link URLs (audit 7/8).
// These were hand-copied in signup.html AND softball.html; the 2026-06-19
// annual-link drift broke annual signups once already. Edit HERE only.
// LIVE mode links. Each is pre-configured in Stripe with product, price,
// and success/cancel URLs. FOUNDERMYGRIND is auto-accepted on all four
// subscription links.
window.MG_STRIPE_LINKS = {
  single_annual:  'https://buy.stripe.com/fZucN78Q20Nncd4brb4gg0a', // $99.99/yr  (price_1TgoAB)
  single_monthly: 'https://buy.stripe.com/4gM7sN2rE9jT5OG3YJ4gg06', // $9.99/mo
  family_annual:  'https://buy.stripe.com/bJeeVf4zM1Rr6SK0Mx4gg07', // $149.99/yr
  family_monthly: 'https://buy.stripe.com/8x26oJeam1Rr2Cu7aV4gg08', // $14.99/mo
  team_sponsor:   'https://buy.stripe.com/fZu14peamcw56SK0Mx4gg09'  // $300 one-time
};
