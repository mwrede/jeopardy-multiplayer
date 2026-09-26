import type { Metadata } from 'next'
import './globals.css'
import { Analytics } from '@vercel/analytics/next'
import { GoogleAnalytics } from '@/components/GoogleAnalytics'
import { Feedback } from '@/components/Feedback'

export const metadata: Metadata = {
  title: 'Jeopardy!',
  description: 'Multiplayer Jeopardy game',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {children}
        <Feedback />
        {/* Vercel Web Analytics — first-party, so ad blockers don't eat it,
            and no cookie banner because it sets no cookies. */}
        <Analytics />
        {/* Dormant unless NEXT_PUBLIC_GA_ID is set. */}
        <GoogleAnalytics />
      </body>
    </html>
  )
}
