import { Bebas_Neue } from 'next/font/google';
import Script from 'next/script';
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
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-3D5C2X0LEQ"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());

            gtag('config', 'G-3D5C2X0LEQ');
          `}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
