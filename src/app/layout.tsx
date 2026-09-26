import type { Metadata } from 'next'
import './globals.css'
import { Analytics } from '@/components/Analytics'
import { Analytics as VercelAnalytics } from '@vercel/analytics/next'

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
        <Analytics />
        <VercelAnalytics />
      </body>
    </html>
  )
}
