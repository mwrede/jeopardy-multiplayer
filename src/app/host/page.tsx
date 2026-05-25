import { redirect } from 'next/navigation'

/**
 * Legacy /host route → /find. The game picker now lives at /find since it
 * covers party AND multiplayer mode selection per result.
 */
export default function HostRedirect() {
  redirect('/find')
}
