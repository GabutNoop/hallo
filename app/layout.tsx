import type { Metadata } from 'next'; import './globals.css'; import { AdSenseScript } from '@/components/ads';
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
export const metadata: Metadata = { metadataBase: new URL(siteUrl), title: { default: 'Hallo News', template: '%s | Hallo News' }, description: 'Berita dan konteks editorial yang dapat diverifikasi.', robots: { index: true, follow: true }, openGraph: { type: 'website', locale: 'id_ID', siteName: 'Hallo News' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="id"><body><AdSenseScript />{children}</body></html>; }
