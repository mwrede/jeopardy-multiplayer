-- Migration: Tag clue_pool rows whose category is politics-flavored.
--
-- Equivalent to running `npx tsx src/scripts/tag-category-types.ts` for the
-- 'politics' theme only. Safe to run multiple times — the UPDATE is keyed
-- by pattern match, so re-running just no-ops on already-correct rows.
--
-- Note: this WILL re-tag categories that were previously classified as
-- something else (commonly 'history') if they match the politics rules —
-- by design, since presidents/elections should land in politics now.

UPDATE clue_pool
SET category_type = 'politics'
WHERE category IS NOT NULL
  AND (
    LOWER(category) LIKE '%politic%'
    OR LOWER(category) LIKE '%president%'
    OR LOWER(category) LIKE '%presidency%'
    OR LOWER(category) LIKE '%vice president%'
    OR LOWER(category) LIKE '%first lady%'
    OR LOWER(category) LIKE '%first ladies%'
    OR LOWER(category) LIKE '%potus%'
    OR LOWER(category) LIKE '%flotus%'
    OR LOWER(category) LIKE '%scotus%'
    OR LOWER(category) LIKE '%inaugur%'
    OR LOWER(category) LIKE '%senator%'
    OR LOWER(category) LIKE '%senate%'
    OR LOWER(category) LIKE '%congress%'
    OR LOWER(category) LIKE '%congressional%'
    OR LOWER(category) LIKE '%house of representatives%'
    OR LOWER(category) LIKE '%speaker of the house%'
    OR LOWER(category) LIKE '%governor%'
    OR LOWER(category) LIKE '%mayor%'
    OR LOWER(category) LIKE '%cabinet%'
    OR LOWER(category) LIKE '%secretary of%'
    OR LOWER(category) LIKE '%election%'
    OR LOWER(category) LIKE '%campaign trail%'
    OR LOWER(category) LIKE '%primaries%'
    OR LOWER(category) LIKE '%caucus%'
    OR LOWER(category) LIKE '%ballot%'
    OR LOWER(category) LIKE '%vote%'
    OR LOWER(category) LIKE '%voting%'
    OR LOWER(category) LIKE '%voter%'
    OR LOWER(category) LIKE '%electoral%'
    OR LOWER(category) LIKE '%democrat%'
    OR LOWER(category) LIKE '%democratic party%'
    OR LOWER(category) LIKE '%republican%'
    OR LOWER(category) LIKE '%gop%'
    OR LOWER(category) LIKE '%parliament%'
    OR LOWER(category) LIKE '%parliamentary%'
    OR LOWER(category) LIKE '%prime minister%'
    OR LOWER(category) LIKE '%world leaders%'
    OR LOWER(category) LIKE '%monarch%'
    OR LOWER(category) LIKE '%monarchy%'
    OR LOWER(category) LIKE '%kings & queens%'
    OR LOWER(category) LIKE '%queens & kings%'
    OR LOWER(category) LIKE '%white house%'
    OR LOWER(category) LIKE '%oval office%'
    OR LOWER(category) LIKE '%capitol hill%'
    OR LOWER(category) LIKE '%supreme court%'
    OR LOWER(category) LIKE '%amendment%'
    OR LOWER(category) LIKE '%constitution%'
    OR LOWER(category) LIKE '%declaration of independence%'
    OR LOWER(category) LIKE '%bill of rights%'
    OR LOWER(category) LIKE '%treaty%'
    OR LOWER(category) LIKE '%treaties%'
    OR LOWER(category) LIKE '%diplomat%'
    OR LOWER(category) LIKE '%diplomacy%'
    OR LOWER(category) LIKE '%ambassador%'
    OR LOWER(category) LIKE '%impeach%'
    OR LOWER(category) LIKE '%scandal%'
    OR LOWER(category) LIKE '%watergate%'
    OR LOWER(category) LIKE '%cold war%'
  )
  AND NOT (
    LOWER(category) LIKE '%law & order%'
    OR LOWER(category) LIKE '%in-law%'
    OR LOWER(category) LIKE '%mother-in-law%'
    OR LOWER(category) LIKE '%father-in-law%'
    OR LOWER(category) LIKE '%queen song%'
    OR LOWER(category) LIKE '%queen band%'
    OR LOWER(category) LIKE '%drag queen%'
    OR LOWER(category) LIKE '%beauty queen%'
    OR LOWER(category) LIKE '%king kong%'
    OR LOWER(category) LIKE '%king james bible%'
    OR LOWER(category) LIKE '%burger king%'
    OR LOWER(category) LIKE '%stephen king%'
    OR LOWER(category) LIKE '%larry king%'
    OR LOWER(category) LIKE '%president of the club%'
    OR LOWER(category) LIKE '%class president%'
    OR LOWER(category) LIKE '%political science fiction%'
  );

-- Optional: see what got tagged
-- SELECT category, COUNT(*) AS clues
-- FROM clue_pool WHERE category_type = 'politics'
-- GROUP BY category ORDER BY clues DESC LIMIT 50;
