// =============================================================
// MyGrind - assets/qotd.js (shared Quote of the Day, 2026-06-10)
// -------------------------------------------------------------
// SINGLE SOURCE for "Today's Grind" across surfaces. Loaded by:
//   - signin.html  (the daily-quote card above the sign-in form)
//   - (softball.html still carries its own inline copy of YBG_QOTD;
//      this file was generated verbatim from it on 2026-06-10.
//      WHEN ADDING QUOTES: update softball.html's YBG_QOTD AND this
//      file together, or regenerate this file from softball.html.)
//
// mgPickTodaysQuote() reproduces softball.html showQotd() exactly:
// same day-of-year math, same sport-aware stepping, same mg_sport
// fallback - so the sign-in card and the in-app QOTD overlay show
// the IDENTICAL quote all day. The quote is live from the start of
// the day; the 6:00am push is just the knock on the door.
// =============================================================

var YBG_QOTD = [
  // == Elevated set (themes 1-28), integrated 2026-06-08 from docs/QOTD_NEW_QUOTES.md.
  //    Inspirational/mindset direction (see qotd_quote_voice_inspirational memory).
  //    Theme 11 dropped for the proven "two things you control" original below; theme 15 dropped for the short classic. ==
  { q: "Nobody sees the 6am tee work or the grounders after everyone leaves. That quiet work is who you are when the lights come on.", a: "MyGrind", sport: "baseball" },
  { q: "Nobody sees the early cage swings or the reps after practice ends. That quiet work is who you are when the lights come on.", a: "MyGrind", sport: "softball" },
  { q: "Your bat will go cold and your glove will have rough days. The way you run out every grounder never has to. That effort is always yours.", a: "MyGrind", sport: "baseball" },
  { q: "The rise ball will fool you and your bat will go quiet. The way you run out every grounder never has to. That effort is always yours.", a: "MyGrind", sport: "softball" },
  { q: "Talent gets your name on the roster. The swings nobody sees get it into the lineup.", a: "MyGrind", sport: "baseball" },
  { q: "Talent gets you on the team. The reps nobody sees put you in the circle when it counts.", a: "MyGrind", sport: "softball" },
  { q: "An 0-for-4 is not the end of your story. It is four notes for your next at-bat. Learn one thing and get back up there.", a: "MyGrind", sport: "baseball" },
  { q: "One rough game does not define you. It is a few lessons for your next at-bat. Take them and go get the next one.", a: "MyGrind", sport: "softball" },
  { q: "Confidence is built in the grind, never handed to you. Once you feel the work you put in, a cold swing cannot shake you. That belief keeps you playing long after others quit.", a: "MyGrind", sport: "baseball" },
  { q: "Confidence is built in the grind, never handed to you. Once you feel the cage work you put in, a cold bat cannot shake you. That belief keeps you playing long after others quit.", a: "MyGrind", sport: "softball" },
  { q: "When your pitcher is grinding, be the one who jogs in and picks him up. Great teammates are remembered longer than great stats.", a: "MyGrind", sport: "baseball" },
  { q: "When your pitcher is laboring in the circle, be the one who picks her up. Great teammates are remembered longer than great stats.", a: "MyGrind", sport: "softball" },
  { q: "A thousand swings in the cage for the one that wins the game. Nobody sees the thousand. Everybody sees the one.", a: "MyGrind", sport: "baseball" },
  { q: "A thousand cuts in the cage for the one that wins the game. Nobody sees the thousand. Everybody sees the one.", a: "MyGrind", sport: "softball" },
  { q: "The game is 80% mental. Practice is 90% physical. Grind the body now so your mind is free when it counts.", a: "MyGrind" },
  { q: "The scoreboard tells you who won. Your notes tell you why and turn a rough night into next week's adjustment.", a: "MyGrind", sport: "baseball" },
  { q: "The scoreboard tells you who won. Your notes tell you why and turn a rough weekend into next week's adjustment.", a: "MyGrind", sport: "softball" },
  { q: "Games are not won in the first inning. They are won in the last, when your legs are heavy and your training takes over.", a: "MyGrind", sport: "baseball" },
  { q: "Games are not won in the first inning. They are won in the last, when everyone is tired and your conditioning takes over.", a: "MyGrind", sport: "softball" },
  { q: "Good grades keep you eligible and on the field. Take care of the classroom first. No coach can recruit a player who cannot suit up.", a: "MyGrind" },
  { q: "Even Hall of Famers failed more than 65% of the time. They never gave up. They dug in expecting a hit every single time.", a: "MyGrind", sport: "baseball" },
  { q: "Even the best to ever play failed more than 65% of the time. They never gave up. They stepped in expecting a hit every single time.", a: "MyGrind", sport: "softball" },
  { q: "One pitch. One at-bat. One inning. Win the moment in front of you, and the score takes care of itself.", a: "MyGrind" },
  { q: "Your offseason is where the season is won. The work nobody sees in the winter is what shows up under the lights.", a: "MyGrind", sport: "baseball" },
  { q: "Your offseason is where the season is won. The cold winter reps nobody sees are what show up when the game is on the line.", a: "MyGrind", sport: "softball" },
  { q: "The grind is the work nobody sees. Tired, hungry, hands bleeding, you keep going. That is how you stay ready and never come off the field.", a: "MyGrind", sport: "baseball" },
  { q: "The grind is the work nobody sees. Tired, sore, blisters and all, you keep going. That is how you stay ready and never come off the field.", a: "MyGrind", sport: "softball" },
  { q: "Practice does not make perfect. It makes permanent. A lazy rep teaches the wrong thing, so do it right or do it again.", a: "MyGrind" },
  { q: "You are only as good as your last game, they say. But coaches remember who kept believing and picked up the team. Be that player.", a: "MyGrind", sport: "baseball" },
  { q: "You are only as good as your last game, they say. But coaches remember who kept her head up and picked up the team. Be that player.", a: "MyGrind", sport: "softball" },
  { q: "All the work means nothing if you cannot answer the bell tomorrow. Sleep, food, and recovery are part of training too.", a: "MyGrind", sport: "baseball" },
  { q: "All the cage work means nothing if your body breaks down. Sleep, food, and recovery are part of practice too.", a: "MyGrind", sport: "softball" },
  { q: "Someone will always be bigger or faster. Keep your grades up and keep grinding. Others fall off, doors open, and hard work beats talent when talent stops working.", a: "MyGrind" },
  { q: "Velocity turns heads. Command keeps you pitching, and you build it one bullpen at a time.", a: "MyGrind", sport: "baseball" },
  { q: "You cannot control how fast you improve. You can control showing up and putting in the work. Stack enough days, and the progress shows up whether you felt it coming or not.", a: "MyGrind" },
  { q: "You will have days that feel like you are going nowhere. That feeling lies. Progress is too slow to feel day to day, so trust the work and keep showing up. It is adding up even when you cannot feel it.", a: "MyGrind" },
  { q: "The rise nobody can catch up to was built on a thousand quiet bullpen reps. What looks like magic in the circle on Saturday is just Tuesday's work showing up.", a: "MyGrind", sport: "softball" },
  { q: "Nothing in this game works halfway. Commit all the way to the swing, the throw, the next rep. You will still miss sometimes, but never because you held back.", a: "MyGrind" },
  { q: "You will not always be the star. You can always be the player your team counts on. Own whatever role you are handed, and be ready the second your name is called. That player always finds the field.", a: "MyGrind" },
  { q: "There are five tools in this game, and not one takes care of itself. Work your weaknesses until they get sharp, and work your strengths so they never go dull. The complete player grinds on both.", a: "MyGrind" },
  { q: "Long before anyone notices your swing, they notice how you run to first and hustle on and off the field. The little things you do when you think no one is watching are exactly the ones that get remembered.", a: "MyGrind" },
  // == Kept originals (curated gems + the proven "two things you control" winner) ==
  { q: "Two things you control: your effort and your attitude. Own them both.", a: "MyGrind" },
  { q: "Stay ready so you don't have to get ready.", a: "MyGrind" },
  { q: "Play for the name on the front. Your name on the back takes care of itself.", a: "MyGrind" },
  { q: "You don't rise to the occasion. You fall to your level of preparation.", a: "MyGrind" },
  { q: "Talent opens the door. Discipline keeps you in the room.", a: "MyGrind" },
  { q: "Respect the game. Respect your opponent. Respect yourself.", a: "MyGrind" },
  { q: "Pressure is what you make it. Train hard enough that pressure feels like Tuesday.", a: "MyGrind" },
  { q: "Failure is data. Use it.", a: "MyGrind" },
  { q: "Hustle is the only stat that never slumps.", a: "MyGrind" },
  { q: "Stats follow effort. Effort doesn't follow stats.", a: "MyGrind" },
  { q: "Mental reps count. Visualize before every at-bat, every pitch, every play.", a: "MyGrind" },
  { q: "Mistakes shrink when you say them out loud. Tell your coach. Tell your parent. Then move.", a: "MyGrind" },
  { q: "Bad calls happen. So does winning anyway.", a: "MyGrind" },
  { q: "Every drill is a story you tell yourself about who you are.", a: "MyGrind" },
  { q: "Coaching is fixing what your eyes don't see. Stay coachable.", a: "MyGrind" },
  { q: "The player who asks the most questions improves the fastest.", a: "MyGrind" },
  { q: "Be a great loser before you become a great winner. Both lessons stick.", a: "MyGrind" },
  { q: "Your worst position is the one you avoid. Get reps there too.", a: "MyGrind" },
  { q: "The game is hard for everyone. The ones who keep going win it.", a: "MyGrind" },
  { q: "Hydrate like you mean it. Water is performance gear.", a: "MyGrind" },
  { q: "Everybody talks a big game. Be the one who quietly puts in the work and backs it up when it counts.", a: "MyGrind" }
];

// Same selection logic as softball.html showQotd() - keep in lockstep.
function mgPickTodaysQuote(forcedSport) {
  var now   = new Date();
  var start = new Date(now.getFullYear(), 0, 0);
  var day   = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  var len   = YBG_QOTD.length;

  var activeSport = forcedSport || (function () {
    try { return window.mgSport || localStorage.getItem('mg_sport') || 'baseball'; }
    catch (e) { return 'baseball'; }
  })();

  var q = null;
  for (var step = 0; step < len; step++) {
    var candidate = YBG_QOTD[(day + step) % len];
    if (!candidate || !candidate.sport || candidate.sport === activeSport) {
      q = candidate;
      break;
    }
  }
  if (!q) q = YBG_QOTD[day % len];
  return q;
}

// Expose for pages that load this file.
if (typeof window !== 'undefined') {
  window.YBG_QOTD = YBG_QOTD;
  window.mgPickTodaysQuote = mgPickTodaysQuote;
}
