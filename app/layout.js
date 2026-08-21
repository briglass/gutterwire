import './globals.css';

export const metadata = {
  title: 'GUTTERWIRE',
  description: 'The wire from the gutter. Clips from everywhere, stitched together.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
