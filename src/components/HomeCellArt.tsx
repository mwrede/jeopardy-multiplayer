/**
 * The picture in each of the three home cells, built from the art the game
 * already has — the three contestants and their podiums — plus the board and
 * buzzer the game itself draws. Nothing here is text; the cell says the words.
 */
export type HomeArt = 'friends' | 'strangers' | 'solo'

export function HomeCellArt({ kind }: { kind: HomeArt }) {
  if (kind === 'friends') return <Friends />
  if (kind === 'strangers') return <Strangers />
  return <Solo />
}

/** Three heads, no podiums, leaning in like a family photo. */
function Friends() {
  const heads = [
    { src: '/avatars/1.png', cls: 'left-0 top-[22%] h-[60%] -rotate-6 z-10 sm:left-[6%]' },
    { src: '/avatars/2.png', cls: 'left-1/2 top-[6%] h-[68%] -translate-x-1/2 z-20' },
    { src: '/avatars/3.png', cls: 'right-0 top-[22%] h-[60%] rotate-6 z-10 sm:right-[6%]' },
  ]
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#000b3a]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_110%,rgba(255,180,90,0.35),transparent_60%)]" />
      {heads.map((h) => (
        <span
          key={h.src}
          className={`absolute aspect-square overflow-hidden rounded-full border-[3px] border-jeopardy-gold/80 bg-black shadow-[0_6px_16px_rgba(0,0,0,0.6)] ${h.cls}`}
        >
          {/* The podium art crops to a head: the top half of the square, blown up. */}
          <img src={h.src} alt="" aria-hidden="true" className="absolute left-1/2 top-0 w-[150%] max-w-none -translate-x-1/2" />
        </span>
      ))}
    </div>
  )
}

/** The three podiums, and the buzzers in front of them — the game with strangers. */
function Strangers() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <img
        src="/contestants.png"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover object-[center_20%]"
      />
      <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-[#000b3a] via-[#000b3a]/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-1.5 flex items-end justify-center gap-5">
        <MiniBuzzer />
        <MiniBuzzer lit />
        <MiniBuzzer />
      </div>
    </div>
  )
}

/** One podium and the small 3×3 — one board, one shot. */
function Solo() {
  const rows = [200, 400, 600]
  return (
    <div className="relative flex h-full w-full items-center justify-center gap-2 overflow-hidden bg-black px-2 md:gap-3 md:px-3">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_80%,rgba(6,12,233,0.35),transparent_60%)]" />
      <div className="board-wrapper relative shrink-0 !rounded-md !p-[2px]">
        <div className="grid w-[84px] grid-cols-3 gap-[2px] sm:w-[104px] md:w-[120px]">
          {rows.flatMap((v) =>
            [0, 1, 2].map((c) => (
              <span
                key={`${v}:${c}`}
                className="board-cell h-5 !border !text-[8px] sm:h-6 sm:!text-[9px] md:h-7 md:!text-[10px]"
                style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}
              >
                ${v}
              </span>
            )),
          )}
        </div>
      </div>
      {/* The middle third of the podium art: one podium, one person. */}
      <div className="relative h-[92%] min-w-0 flex-1 overflow-hidden sm:max-w-[40%]">
        <img
          src="/contestants.png"
          alt=""
          aria-hidden="true"
          className="absolute left-1/2 top-0 h-full w-auto max-w-none -translate-x-1/2"
        />
      </div>
    </div>
  )
}

/** The game's buzzer, small: the black cylinder with the red button on top. */
function MiniBuzzer({ lit }: { lit?: boolean }) {
  return (
    <span
      className="relative block h-9 w-6 rounded-[5px] md:h-10 md:w-7"
      style={{
        background: 'linear-gradient(135deg, #3a3a3a 0%, #1a1a1a 30%, #0d0d0d 70%, #1a1a1a 100%)',
        boxShadow: 'inset 1px 1px 3px rgba(255,255,255,0.08), 2px 3px 8px rgba(0,0,0,0.7)',
      }}
    >
      <span
        className="absolute -top-2 left-1/2 h-5 w-5 -translate-x-1/2 rounded-full md:h-6 md:w-6"
        style={{
          background: 'radial-gradient(circle at 35% 35%, #ff4444 0%, #cc1111 60%, #661111 100%)',
          boxShadow: lit
            ? 'inset 0 1px 2px rgba(255,255,255,0.35), 0 0 14px #ff3333'
            : 'inset 0 1px 2px rgba(255,255,255,0.3), 0 2px 5px rgba(0,0,0,0.7)',
          border: '1.5px solid rgba(0,0,0,0.35)',
        }}
      />
    </span>
  )
}
