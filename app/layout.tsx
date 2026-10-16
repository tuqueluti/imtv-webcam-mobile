import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'IMTV webcam mobile',
  description: 'Conecte a câmera do Android ou iPhone ao seu estúdio. Controle de qualidade, pareamento privado e monitor de vídeo para OBS e vMix.',
  manifest: '/manifest.webmanifest',
  applicationName: 'IMTV webcam mobile',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'IMTV webcam mobile' },
  icons: { icon: '/favicon.svg', apple: '/imtv-logo.png' },
  referrer: 'no-referrer',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#000000' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><head><link rel="preload" href="/fonts/mont-regular.woff" as="font" type="font/woff" crossOrigin="anonymous"/></head><body>{children}</body></html>;
}
