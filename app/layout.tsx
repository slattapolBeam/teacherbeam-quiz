import type { Metadata } from 'next'
import { Prompt } from 'next/font/google'
import './globals.css'

const prompt = Prompt({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'Coding Quiz',
  description: 'ระบบข้อสอบ Coding',
}

const APP_VERSION = '1.5.0'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="th">
      <body className={prompt.className}>
        {children}
        <div className="fixed bottom-2 right-3 text-[10px] font-mono text-gray-300 pointer-events-none select-none z-[200]">
          v{APP_VERSION}
        </div>
      </body>
    </html>
  )
}