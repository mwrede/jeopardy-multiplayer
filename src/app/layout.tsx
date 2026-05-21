import type { Metadata } from 'next'
import './globals.css'
import { ProfileMenu } from '@/components/ProfileMenu'

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
        <ProfileMenu />
        {children}
      </body>
    </html>
  )
}
