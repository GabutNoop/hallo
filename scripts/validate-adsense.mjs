import fs from 'node:fs'; import path from 'node:path';
const read = p => fs.readFileSync(p, 'utf8'); const files=['components/ads/AdSenseScript.tsx','components/ads/DisplayAd.tsx','components/ads/InArticleAd.tsx','app/artikel/[slug]/page.tsx','app/page.tsx'];
const required=[['components/ads/AdSenseScript.tsx','adsbygoogle.js'],['components/ads/DisplayAd.tsx','data-ad-slot'],['components/ads/InArticleAd.tsx','data-ad-layout'],['app/artikel/[slug]/page.tsx','InArticleAd'],['app/artikel/[slug]/page.tsx','body.slice(0,2)']]; let failed=0;
for(const [file,text] of required){if(!read(file).includes(text)){console.error(`FAIL ${file}: missing ${text}`);failed++}else console.log(`PASS ${file}: ${text}`)}
for(const f of files) if(!fs.existsSync(path.resolve(f))){console.error(`FAIL missing file ${f}`);failed++}
if(failed){console.error(`Ad placement validation failed: ${failed} issue(s)`);process.exit(1)} console.log('Ad placement validation passed. Runtime ad slots are supplied only via environment variables.');
