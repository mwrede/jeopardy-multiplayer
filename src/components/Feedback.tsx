'use client'

import { usePathname } from 'next/navigation'

/**
 * One line at the foot of every page that isn't gameplay: a way to reach the
 * person who made this. Kept off /game/* on purpose — a TV screen and a
 * buzzer phone have no room for a footer, and DESIGN.md says as much.
 */
export function Feedback() {
  const path = usePathname()
  if (!path || path.startsWith('/game/')) return null
  return (
    <p className="pb-6 pt-2 text-center text-[10px] uppercase tracking-[0.2em] text-ink-stage-2/60">
      <a
        href="mailto:canyoureallywinj@gmail.com?subject=Jeopardy%20%E2%80%94%20a%20thought"
        className="transition-colors hover:text-copper"
      >
        Questions or thoughts? Send feedback
      </a>
    </p>
  )
}
