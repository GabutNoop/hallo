'use client';
import { useEffect, useRef } from 'react';
export default function InArticleAd() {
 const ref = useRef<HTMLModElement>(null); const client = process.env.NEXT_PUBLIC_AD_CLIENT; const slot = process.env.NEXT_PUBLIC_AD_SLOT_ARTICLE;
 useEffect(() => { if (client && slot && ref.current?.childElementCount === 0) { try { ((window as Window & { adsbygoogle?: unknown[] }).adsbygoogle ||= []).push({}); } catch {} } }, [client, slot]);
 if (!client || !slot) return null;
 return <section className="my-8" aria-label="Konten iklan"><p className="mb-1 text-center text-xs text-slate-400">Iklan</p><ins ref={ref} className="adsbygoogle" style={{ display: 'block', textAlign: 'center' }} data-ad-layout="in-article" data-ad-format="fluid" data-ad-client={client} data-ad-slot={slot} /></section>;
}
