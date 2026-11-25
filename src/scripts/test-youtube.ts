/**
 * YouTube link regression suite.
 *   npx tsx src/scripts/test-youtube.ts
 *
 * One case per shape of link people actually paste. The two that matter most
 * are the share link with a timestamp (what the YouTube share sheet hands
 * you) and the bare `id?t=43` token this module writes into clue text — the
 * round trip between those two is what decides whether a saved board plays.
 */
import { youtubeId, youtubeStart, youtubeToken, hasYouTube } from '../lib/youtube'

let pass = 0
let fail = 0

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`,
  )
}

/* Every link shape YouTube itself produces. */
check('watch', youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
check('watch + extra params', youtubeId('https://m.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
check('share link', youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
check('short', youtubeId('https://www.youtube.com/shorts/abcDEF12345'), 'abcDEF12345')
check('embed', youtubeId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
check('live', youtubeId('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
check('bare id', youtubeId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ')

/* Not videos — these must stay as plain text rather than becoming a player. */
check('channel', youtubeId('https://www.youtube.com/@someChannel'), null)
check('other host', youtubeId('https://example.com/video.mp4'), null)
check('prose', youtubeId('not a link at all'), null)

/* Start offsets, in both the seconds and the clock spellings. */
check('t seconds', youtubeStart('https://youtu.be/dQw4w9WgXcQ?t=43'), 43)
check('t with s suffix', youtubeStart('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s'), 90)
check('t as clock', youtubeStart('https://youtu.be/dQw4w9WgXcQ?t=1m30s'), 90)
check('no offset', youtubeStart('https://youtu.be/dQw4w9WgXcQ'), 0)

/* The round trip: what the editor writes has to parse back. */
check('token from share link', youtubeToken('https://youtu.be/dQw4w9WgXcQ?t=43'), '[yt:dQw4w9WgXcQ?t=43]')
check('token id survives', youtubeId('dQw4w9WgXcQ?t=43'), 'dQw4w9WgXcQ')
check('token start survives', youtubeStart('dQw4w9WgXcQ?t=43'), 43)
check('token of a non-video', youtubeToken('https://www.youtube.com/@someChannel'), null)

/* The cheap check the layout code uses to give a video clue room. */
check('detects token', hasYouTube('Name this song [yt:dQw4w9WgXcQ]'), true)
check('detects bare link', hasYouTube('Watch https://youtu.be/dQw4w9WgXcQ'), true)
check('plain clue', hasYouTube('Name this song'), false)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
