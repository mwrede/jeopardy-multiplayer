/**
 * Wager-rule checks.
 *   npx tsx src/scripts/test-wager.ts
 */
import {
  clampDailyDoubleWager, clampFinalWager, maxDailyDoubleWager, maxFinalWager, topClueValue,
} from '../lib/wager'

let pass = 0, fail = 0
function eq(label: string, got: number, want: number) {
  const ok = got === want
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} got ${got}  want ${want}`)
}

// Board top values
eq('full round 1 top', topClueValue('full', 1), 1000)
eq('full round 2 top', topClueValue('full', 2), 2000)
eq('half round 1 top', topClueValue('half', 1), 600)
eq('rapid round 2 top', topClueValue('rapid', 2), 1200)

// Daily Double — cap is the greater of score and the board top
eq('DD: $200 player, round 1 full, bets 1000', clampDailyDoubleWager(1000, 200, 1000), 1000)
eq('DD: $200 player, round 1 full, bets 1001', clampDailyDoubleWager(1001, 200, 1000), 1000)
eq('DD: $5,000 player bets all of it', clampDailyDoubleWager(5000, 5000, 1000), 5000)
eq('DD: $5,000 player bets 9,000', clampDailyDoubleWager(9000, 5000, 1000), 5000)
eq('DD: minimum is $5', clampDailyDoubleWager(1, 5000, 1000), 5)
eq('DD: negative bet floors at $5', clampDailyDoubleWager(-400, 5000, 1000), 5)
eq('DD: NaN floors at $5', clampDailyDoubleWager(NaN, 5000, 1000), 5)
eq('DD: player in the red can still bet the board top', clampDailyDoubleWager(1000, -600, 1000), 1000)
eq('DD: half board caps at 600, not 1000', clampDailyDoubleWager(1000, 200, 600), 600)
eq('DD: max helper, rich player', maxDailyDoubleWager(8000, 2000), 8000)
eq('DD: max helper, broke player', maxDailyDoubleWager(0, 2000), 2000)

// Final Jeopardy — 0 up to your score, with the house floor
eq('FJ: $9,000 player bets 9,000', clampFinalWager(9000, 9000), 9000)
eq('FJ: $9,000 player bets 9,001', clampFinalWager(9001, 9000), 9000)
eq('FJ: $400 player bets 1,000 (floor)', clampFinalWager(1000, 400), 1000)
eq('FJ: $400 player bets 1,001', clampFinalWager(1001, 400), 1000)
eq('FJ: negative player can still bet 1,000', clampFinalWager(1000, -2000), 1000)
eq('FJ: bet nothing', clampFinalWager(0, 9000), 0)
eq('FJ: negative bet floors at 0', clampFinalWager(-500, 9000), 0)
eq('FJ: NaN floors at 0', clampFinalWager(NaN, 9000), 0)
eq('FJ: max helper respects the floor', maxFinalWager(-3000), 1000)

console.log(`\n${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
