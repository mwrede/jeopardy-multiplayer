# Design contract — Jeopardy Multiplayer

House rules for anyone (human or agent) changing how this app looks.
The `design-reviewer` agent reads this first; these rules override generic best practice.

---

## 1. The two zones

This app deliberately runs **two visual systems**. Do not merge them.

### Zone A — The Stage (app chrome)
Routes: `/`, `/find`, `/create`, `/login`, plus preview modals and the profile menu.

Deep royal-blue stage backdrop, walnut picture frame with copper LED strips, chrome
wordmark, Impact-condensed uppercase headings. It's the set of a game show, seen from
the audience. Tokens: `stage*`, `wood*`, `copper*`, `chrome*`, `ink-stage*`.
Utilities: `.stage-page`, `.frame`, `.frame-inner`, `.plate`, `.plate-surface`,
`.led-strip`, `.btn-stage` (+ `-sm`/`-lg`, `.btn-copper`, `.btn-chrome`, `.btn-stage-ghost`),
`.field-stage`, `.field-code-stage`, `.chip-stage`, `.eyebrow-copper`, `.display-chrome`.

### Zone B — Gameplay
Routes: `/game/[roomCode]`, `/display`, `/play`, `/present`.

Authentic Jeopardy! board: `#060CE9` blue, gold clue values, black gridlines, inset
bevels. This is **brand-locked and intentionally saturated**. Do not desaturate it, do
not soften the blue, do not modernize the board. Tokens: `jeopardy-*`.
Utilities: `.board-cell`, `.board-category`, `.board-wrapper`, `.btn-primary`, `.btn-secondary`, `.input-base`.

**Rule:** a review may not propose moving a screen from one zone to the other, or
importing Zone A ornament into the board. Improvements must work *within* the zone.

---

## 2. Device contexts (this is what makes the app unusual)

| Route | Runs on | Viewing distance | Design implication |
|---|---|---|---|
| `/game/[roomCode]/display` | TV / laptop projected to a room | 6–10 feet | Type must be huge, contrast maximal, no small controls, no hover-only affordances |
| `/game/[roomCode]/play` | Player's phone | Arm's length, one-handed | Thumb-zone layout, buzzer is the single dominant target, everything else subordinate |
| `/game/[roomCode]` | Host/party controller | Arm's length | Dense controls acceptable; must never leak clue answers to a shared screen |
| `/game/[roomCode]/present` | Presenter running teams manually | Arm's length + projected | Two audiences at once; keep operator controls visually separate from what the room sees |
| `/`, `/find`, `/create`, `/login` | Desktop and phone | Normal | Standard responsive web rules apply |

A finding that's correct for a phone can be wrong for the TV view. Always state which
context a finding applies to.

---

## 3. Non-negotiables

1. **The buzzer is the loudest thing on the player's phone.** Nothing competes with it.
2. **Clue text on `/display` must be legible from across the room.** Never trade its size for layout tidiness.
3. **Answers never appear on a screen the room can see** until the game state says so.
4. **Timing feedback is instant.** Buzz, lockout, and score changes must render inside ~150ms; the game is unfair otherwise. (Doherty threshold applies harder here than in normal apps.)
5. **Correct/incorrect is never signaled by color alone** — green/red must be paired with a mark, icon, or word.
6. **Impact/Arial Black is the display face; system sans is the body face.** Two families, no more.
7. Keep the LED strips, wood frame, and copper glow. They're the product's personality, not chartjunk.

---

## 4. Known debt (seed the review here)

- **Two parallel button systems coexist.** `btn-stage` (40 uses, Zone A) and
  `btn-primary`/`btn-secondary` (40 uses, Zone B + leftovers). Some files use both.
  Confirm each usage is in the right zone; flag cross-zone leakage.
- **`/multiplayer` is not on the stage system** (zero `stage-page`/`frame` usage) while
  `/`, `/find`, `/create`, `/login` are. Determine whether it's still reachable, and if so
  whether it should be brought onto the stage or removed.
- **Inline `style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}` is repeated
  throughout `page.tsx` and others.** That's a missing utility class or Tailwind
  `fontFamily` token.
- `tailwind.config.ts` declares `fontFamily.display` (`var(--font-display)`), but no font
  variable appears to be set in `layout.tsx`. Verify whether `font-display` resolves.
- No spacing/type/radius scale is documented; sizes are chosen per-site. Check whether
  values in use collapse to a scale, and propose one if they nearly do.
- Focus states: `.field-stage:focus` has a copper ring, but `.btn-stage` and `.board-cell`
  define hover and active only. Keyboard focus visibility needs a pass.
- Contrast candidates to measure: `text-ink-stage-2` (#A9B4D8) and `text-ink-stage-3`
  (#6C77A0) on the stage gradient; `.btn-secondary` text (#aab on #1a1a3a); copper glow
  text on blue.

---

## 5. Scales to hold to (once verified/adopted)

Spacing `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96`.
Radius `4 / 6 / 8 / 12 / 14 / full` (already roughly in use — 6 for inner plates, 8 for buttons, 12–14 for frames).
Type: body ≥16px on phones (iOS zooms inputs below 16). TV view has its own much larger scale — document it separately rather than forcing it onto the app scale.
Motion 100–200ms micro, 200–300ms transitions; transform/opacity only; honor `prefers-reduced-motion`.
Contrast AA: 4.5:1 body, 3:1 large text and UI components. The board's gold-on-blue and the TV view should clear AA comfortably given viewing distance.

---

## 6. How to run a review

```bash
cd /Users/michaelwrede/teams/jeopardy-multiplayer && npm run dev
```

Then ask the `design-reviewer` agent, naming the routes and contexts. A game room is
needed to see gameplay screens; create one from `/` or `/find` first, then open
`/game/<CODE>/display` on desktop and `/game/<CODE>/play` at 375×812.
