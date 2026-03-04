
import { parseStringPromise } from 'xml2js';
import { JSDOM } from 'jsdom';

const SITEMAP_URL = 'https://tejasjog-blog.pages.dev/sitemap.xml';
const ALLOWED_DOMAINS = ['cloudflare.com', 'imagekit.io'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'];

async function warmUp() {
  console.log('🚀 Fetching sitemap...');
  const response = await fetch(SITEMAP_URL);
  const xml = await response.text();
  const sitemap = await parseStringPromise(xml);
  
  const urls = sitemap.urlset.url.map(u => u.loc[0]);
  console.log(`Found ${urls.length} pages to crawl.`);

  for (const url of urls) {
    try {
      console.log(`\n📄 Processing: ${url}`);
      const pageRes = await fetch(url);
      const html = await pageRes.text();
      const dom = new JSDOM(html);
      const document = dom.window.document;

      // Select both <img> src and <a> href
      const imgElements = Array.from(document.querySelectorAll('img')).map(i => i.src);
      const linkElements = Array.from(document.querySelectorAll('a')).map(a => a.href);

      const allPossibleAssets = [...imgElements, ...linkElements];

      // Filter for your specific CDN domains and image extensions
      const targetUrls = allPossibleAssets.filter(src => {
        const isTargetDomain = ALLOWED_DOMAINS.some(domain => src.includes(domain));
        const isImageFile = IMAGE_EXTENSIONS.some(ext => src.toLowerCase().endsWith(ext));
        return isTargetDomain && isImageFile;
      });

      const uniqueAssets = [...new Set(targetUrls)];
      console.log(`   Found ${uniqueAssets.length} assets to warm.`);

      // Hit assets in parallel for this page
      await Promise.all(uniqueAssets.map(async (assetUrl) => {
        try {
          // Using HEAD is faster as it only requests headers, triggering the CDN cache
          await fetch(assetUrl, { 
            method: 'HEAD',
            headers: { 'User-Agent': 'Github-Action-Cache-Warmer' }
          });
          console.log(`   ✅ Warmed: ${assetUrl.split('/').pop()}`);
        } catch (e) {
          console.log(`   ❌ Failed: ${assetUrl}`);
        }
      }));
    } catch (err) {
      console.error(`   ⚠️ Error processing page ${url}:`, err.message);
    }
  }
  console.log('\n✨ All done! Your Edge Cache is nice and toasty.');
}

warmUp();
