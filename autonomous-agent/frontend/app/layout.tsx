import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Autonomous AI Agent',
  description: 'Self-correcting AI agent with Docker sandbox execution',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
