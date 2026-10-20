// secondary probe: fetch the watch page HTML and look for commentCount + comment markers
const id = 'PYQZUDEGxto';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const res = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
const html = await res.text();
console.log('page status:', res.status, '| bytes:', html.length);
const m = /"commentCount":\{"simpleText":"([^"]+)"/.exec(html) ?? /"commentCount":"([^"]+)"/.exec(html);
console.log('commentCount:', m ? m[1] : '(not present)');
console.log('has "Comments are turned off":', /Comments are turned off/i.test(html));
console.log('has comment-item-section:', /comment-item-section/.test(html));
console.log('has "commentCount" key:', /"commentCount"/.test(html));
const t = /<title>([^<]+)<\/title>/.exec(html);
console.log('title:', t ? t[1] : '(none)');
// compare against the known-good short
const res2 = await fetch('https://www.youtube.com/watch?v=pYETG1LuuP8', { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
const html2 = await res2.text();
const m2 = /"commentCount":\{"simpleText":"([^"]+)"/.exec(html2) ?? /"commentCount":"([^"]+)"/.exec(html2);
console.log('\n[control] pYETG1LuuP8 commentCount:', m2 ? m2[1] : '(not present)');
console.log('[control] has "Comments are turned off":', /Comments are turned off/i.test(html2));
console.log('[control] has comment-item-section:', /comment-item-section/.test(html2));
