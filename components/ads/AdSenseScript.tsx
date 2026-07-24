import Script from 'next/script';
export default function AdSenseScript() {
  const client = process.env.NEXT_PUBLIC_AD_CLIENT;
  if (!client) return null;
  return <Script async strategy="afterInteractive" crossOrigin="anonymous" src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`} />;
}
