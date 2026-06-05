# MyGrind QOTD — Elevated Quote Set (work in progress)

**Status (2026-06-04):** Voice locked with Coach. Themes 1-20 finalized below.
Tomorrow: batch 3 (sport-specific gems), then integrate the full set into the
`YBG_QOTD` array in `softball.html` and render the cards (Story / Feed / Square)
with `scripts/build_qotd.py`.

**Voice:** thoughtful, sport-rooted (baseball + softball), genuinely motivating,
friendly, human. No special characters, no banned words (elite/beast/etc.). Most
themes have a **baseball** and a **softball** version so the app serves the right
one by sport mode; a few are universal. Author renders as "The Grind" (no dash).

This file is the durable, GitHub-backed source for the new quotes so they can
never be lost again. Edit here, then transcribe into `YBG_QOTD`.

---

## Finalized themes (1-20)

**1. The Grind**
- baseball: "Nobody sees the 6am tee work or the grounders after everyone leaves. That quiet work is who you are when the lights come on."
- softball: "Nobody sees the early cage swings or the reps after practice ends. That quiet work is who you are when the lights come on."

**2. Run It Out**
- baseball: "Your bat will go cold and your glove will have rough days. The way you run out every grounder never has to. That effort is always yours."
- softball: "Your bat will go quiet and the rise ball will fool you. The way you run out every grounder never has to. That effort is always yours."

**3. Earning the Lineup**
- baseball: "Talent gets your name on the roster. The swings nobody sees get it into the lineup."
- softball: "Talent gets you on the team. The reps nobody sees put you in the circle when it counts."

**4. Bouncing Back**
- baseball: "An 0-for-4 is not the end of your story. It is four notes for your next at-bat. Learn one thing and get back up there."
- softball: "One rough game does not define you. It is a few lessons for your next at-bat. Take them and go get the next one."

**5. Confidence**
- baseball: "Confidence is built in the grind, never handed to you. Once you feel the work you put in, a cold swing cannot shake you. That belief keeps you playing long after others quit."
- softball: "Confidence is built in the grind, never handed to you. Once you feel the cage work you put in, a cold bat cannot shake you. That belief keeps you playing long after others quit."

**6. Be the Teammate**
- baseball: "When your pitcher is grinding, be the one who jogs in and picks him up. Great teammates are remembered longer than great stats."
- softball: "When your pitcher is laboring in the circle, be the one who picks her up. Great teammates are remembered longer than great stats."

**7a. A Thousand Swings**
- baseball: "A thousand swings in the cage for the one that wins the game. Nobody sees the thousand. Everybody sees the one."
- softball: "A thousand cuts in the cage for the one that wins the game. Nobody sees the thousand. Everybody sees the one."

**7b. Why You Grind** (universal)
- "The game is 80% mental. Practice is 90% physical. Grind the body now so your mind is free when it counts."

**8. Why You Journal**
- baseball: "The scoreboard tells you who won. Your notes tell you why, and turn a rough night into next week's adjustment."
- softball: "The scoreboard tells you who won. Your notes tell you why, and turn a rough weekend into next week's adjustment."

**9. Late Innings**
- baseball: "Games are not won in the first inning. They are won in the last, when your legs are heavy and your training takes over."
- softball: "Games are not won in the first inning. They are won in the last, when everyone is tired and your conditioning takes over."

**10. Classroom First** (universal)
- "Good grades keep you eligible and on the field. Take care of the classroom first. No coach can recruit a player who cannot suit up."

**11. Control What You Control**
- baseball: "You cannot control the umpire or the score. You can control your effort, your attitude, and how you lift your team. Own those and you are dangerous."
- softball: "You cannot control the strike zone or the score. You can control your effort, your attitude, and how you lift your team. Own those and you are dangerous."

**12. The Best Fail Too**
- baseball: "Even Hall of Famers failed more than 65% of the time. They never gave up, digging in to get a base hit 100% of the time."
- softball: "Even the best to ever play failed more than 65% of the time. They never gave up, stepping in to get a base hit 100% of the time."

**13. Win the Moment** (universal)
- "One pitch. One at-bat. One inning. Win the moment in front of you and the score takes care of itself."

**14. Built in the Offseason**
- baseball: "Your offseason is where the season is won. The work nobody sees in the winter is what shows up under the lights."
- softball: "Your offseason is where the season is won. The cold winter reps nobody sees are what show up when the game is on the line."

**15. Stay Ready**
- baseball: "This game is about opportunities. Stay ready so when your shot comes, you take it. Seize the moment and you never come off the field."
- softball: "This game is about opportunities. Stay ready so when your shot comes, you take it. Seize the moment and you never come off the field."

**16. Train on the Hard Days**
- baseball: "The grind is the work nobody sees. Tired, hungry, hands bleeding, you keep going. That is how you stay ready and never come off the field."
- softball: "The grind is the work nobody sees. Tired, sore, blisters and all, you keep going. That is how you stay ready and never come off the field."

**17. Practice Makes Permanent** (universal)
- "Practice does not make perfect. It makes permanent. A lazy rep teaches the wrong thing, so do it right or do it again."

**18. Your Worst Day**
- baseball: "You are only as good as your last game, they say. But coaches remember who kept believing and picked up the team. Be that player."
- softball: "You are only as good as your last game, they say. But coaches remember who kept her head up and picked up the team. Be that player."

**19. Take Care of the Engine**
- baseball: "All the work means nothing if you cannot answer the bell tomorrow. Sleep, food, and recovery are part of training too."
- softball: "All the cage work means nothing if your body breaks down. Sleep, food, and recovery are part of practice too."

**20. Run Your Own Race** (universal)
- "Someone will always be bigger or faster. Keep your grades up and keep grinding. Others fall off, doors open, and hard work beats talent when talent stops working."

---

## Remaining for tomorrow — batch 3 (sport-specific gems) + cleanup

Draft these in the same voice, then fold in the leftover original themes (dedupe):

- **Command over velocity** (BB): the pitcher who throws 3 for strikes beats the one who throws 5 hard
- **Breaking ball off the fastball** (BB): the fastball earns the breaking ball
- **Speed changes the room** (BB): the 60 time / run tool
- **The rise ball born in the bullpen** (SB)
- **Drop ball is physics, rise ball is faith** (SB): throw both with conviction
- **Know your role at DP/Flex** (SB)
- **Slap and bunt versatility** (SB): master both, coaches have no answer
- **The little things scouts see**: throw across the diamond + run to first, before the swing
- Dedupe remaining originals: visualization / mental reps, own your mistakes (say it out loud), bad calls happen, every drill is a story (identity), ask questions, the game is hard for everyone (keep going), stay coachable, train slow play fast, your weak spot needs reps.

Then: integrate full set into `YBG_QOTD`, choose card design ("cosmically good" look), render Story (1080x1920) + Feed (1080x1350) + Square (1080x1080).
