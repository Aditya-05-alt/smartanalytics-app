import { Syne, DM_Sans } from 'next/font/google';
import './globals.css';
import { ThemeProvider, NO_FLASH_SCRIPT } from '@/components/ui/ThemeProvider';

const syne = Syne({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  display: 'swap',
  variable: '--font-syne',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  display: 'swap',
  variable: '--font-dm-sans',
});

export const metadata = {
  title: 'SmartAnalytics — Sign in',
  description: 'Dealer analytics dashboard for RV, Auto, Powersports & Marine.',
  icons: { icon: '/favicon.svg' },
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F6FB' },
    { media: '(prefers-color-scheme: dark)',  color: '#14171C' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${syne.variable} ${dmSans.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <div className="ambient-bg" aria-hidden="true" />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
