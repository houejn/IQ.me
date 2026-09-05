# IQ.me

A lightweight, offline-capable IQ-drills web app. Plain typographic design
(serif body, hairline borders, no card/shadow chrome), synthesized sound
cues, no per-question right/wrong feedback — just a final score, the way
a real IQ test works.

## Files (v2 — pure client-side, no build step)

```
index.html    — shell + settings panel markup
style.css     — all styling (design tokens at the top of the file)
visual.js     — Visual Engine: SVG-based non-verbal reasoning items
questions.js  — Generation Engine: text-based item generators
engine.js     — Score Engine + storage (rating math, per-level stats, sound)
app.js        — Core Engine: screen controller, drill lifecycle, timer
```

Open `index.html` directly, or serve the folder with any static server.
Everything works fully offline; there is no backend yet.

## The five engines

**Level Engine** (`app.js` / `questions.js`) — five levels, no gating and
no requirement to "unlock" one. Each level just sets a target item
difficulty, 10 points apart on an IQ-like scale: 85 / 95 / 105 / 115 / 125
(mean 100 is the theoretical population average). You can drill any level
at any time — higher levels are simply harder, not locked behind a score.

**Score Engine** (`engine.js`) — two distinct numbers:
- *IQ.me score* — your persistent profile number, nudged a little after
  every single answer using the same logistic expected-outcome idea as
  chess Elo, but compressed about 10x (`D=40` instead of 400) so it moves
  in increments that make sense on a 10-point-per-level scale instead of
  a hundred-plus-point-per-tier one.
- *Per-level IQ score* — computed once per finished drill. Your percent
  correct is converted to a z-score against the running mean/SD of **your
  own** past drills at that level (Welford's online algorithm — no need
  to store your whole history to compute this), then mapped onto the
  familiar 100 + z×15 IQ scale. It starts from a neutral assumed prior
  (mean 50% correct, SD 15%) and gets more personally calibrated the more
  you drill a given level.

**Generation Engine** (`questions.js`) — seven item types (five text,
two visual) that generate a fresh item every time rather than drawing
from a fixed bank. Each (level, type) pair keeps a small saved state:
which sub-variant it used last, a "nudge" that ticks up on a correct
answer and down on a miss (subtly widening or narrowing that type's
numeric ranges next time), and — for word-based types — the last
category used, so it's not immediately repeated. This is what makes
each type feel continuous rather than independently random every time.

**Visual Engine** (`visual.js`) — renders non-verbal reasoning items as
plain SVG built from structured rules (rotation, scale, opacity) instead
of requesting images from an LLM. This isn't only a workaround for not
having image-generation access: a rule-based SVG item has one provably
unambiguous correct answer, computed directly from the rule, which is
exactly what a reasoning-test item needs — an LLM image generator can't
easily guarantee that. Currently two visual types: a Raven's-matrix-style
3×3 grid (`generateMatrix`) and a rotating-shape sequence
(`generateRotationSeq`). Both scale in complexity with level (more
attributes varying at once, finer rotation steps).

**Core Engine** (`app.js`) — orchestrates the drill lifecycle: draw a
type → fetch its saved generation state → generate the item → render
(text or SVG) → grade on selection → update the IQ.me score → save the
new generation state for that type → advance or finish. It also owns the
timer (optional per-question back-timer, shown as a depleting bar) and
settings.

## Where an LLM still fits

Verbal item types (analogies, syllogisms, odd-one-out) are the natural
place to add an LLM later, since they're just structured text — no image
model required. A Vercel serverless function (e.g. `/api/generate-item.js`)
could call the Anthropic API and return JSON shaped exactly like the
existing generators' output (`{type, prompt, options, correctIndex,
difficulty}`), and `startDrill()` in `app.js` is the one place that would
call it, alongside or instead of `QGen.generateDrill()`. Keep an
`ANTHROPIC_API_KEY` as a Vercel environment variable, never in client code.

## Deployment plan (as discussed)

1. **GitHub first** — push this folder as-is; it's already a deployable
   static site, nothing to build.
2. **Vercel** — connect the repo, framework preset "Other" (static).
   Zero config for what exists today.
3. **LLM-generated verbal items (later)** — see above.
4. **Accounts / cross-device profile (later)** — the profile (IQ.me score,
   per-level stats, generation state) lives in `localStorage` only right
   now. If you want it to follow a person across devices, that's when
   Firebase Auth + Firestore (or Cloudflare D1/KV) earns its place — not
   needed before that.

## Extending

- New text item type: add a generator in `questions.js` following the
  existing shape (`generateX(level, prior) -> item` with `_kind`/
  `_category`/`_priorState` set as relevant), then add it to
  `GENERATOR_DEFS`.
- New visual item type: add a generator in `visual.js` returning
  `{visual:true, promptSvg, options: [svgString...], correctIndex,
  difficulty}`, then register it the same way in `questions.js`.
- Nothing else needs to change — `app.js` and the score engine are
  type-agnostic.
