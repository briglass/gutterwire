import { Bebas_Neue } from 'next/font/google';
import './globals.css';

const titleFont = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-title',
});

export const metadata = {
  metadataBase: new URL('https://www.gutterwire.com'),
  title: 'GUTTERWIRE',
  description: 'Monitor the gutter without getting dirty. Clips from everywhere, stitched together.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={titleFont.variable}>
      <body>{children}</body>
    </html>
  );
}
