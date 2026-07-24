'use client';
import { useEffect, useRef } from 'react';
type Props = { className?: string; label?: string; slot?: string };
export default function DisplayAd({ className = '', label = 'Iklan', slot }: Props) {
  const ref = useRef<HTMLModElement>(null);
  const client = process.env.NEXT_PUBLIC_AD_CLIENT;
  const adSlot = slot ?? process.env.NEXT_PUBLIC_AD_SLOT_DISPLAY;
  useEffect(() => { if (client && adSlot && ref.current?.childElementCount === 0) { try { ((window as Window & { adsbygoogle?: unknown[] }).adsbygoogle ||= []).push({}); } catch { /* Ad blockers and repeated route transitions can reject this; content remains usable. */ } } }, [client, adSlot]);
  if (!client || !adSlot) return null;
  return <section className={`ad-container my-6 ${className}`} aria-label="Konten iklan"><p className="mb-1 text-center text-xs text-slate-400">{label}</p><ins ref={ref} className="adsbygoogle" style={{ display: 'block' }} data-ad-client={client} data-ad-slot={adSlot} data-ad-format="auto" data-full-width-responsive="true" /></section>;
}
