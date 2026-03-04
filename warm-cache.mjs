import { parseStringPromise } from 'xml2js';
import { JSDOM } from 'jsdom';

const SITEMAP_URL = 'https://tejasjog-blog.pages.dev/sitemap.xml';
const ALLOWED_DOMAINS = ['cloudflare.com', 'imagekit.io', 'tejasjog-blog.pages.dev'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg'];

async function warmUp() {
  console.log('🚀 Fetching sitemap...');
  try {
    const response = await fetch(SITEMAP_URL);
    const xml = await response.text();
    const sitemap = await parseStringPromise(xml);
    
    const urls = sitemap.urlset.url.map(u => u.loc[0]);
    console.log(`Found ${urls.length} pages to crawl.`);

    for (const url of urls) {
      console.log(`\n📄 Processing: ${url}`);
      const pageRes = await fetch(url);
      const html = await pageRes.text();
      
      const dom = new JSDOM(html, { url }); 
      const document = dom.window.document;

      const assets = new Set();

      // 1. Standard src and href
      document.querySelectorAll('img[src], a[href]').forEach(el => {
        const link = el.src || el.href;
        if (link) assets.add(link);
      });

      // 2. Handle srcset (found in <img> and <source> tags)
      document.querySelectorAll('[srcset]').forEach(el => {
        const srcset = el.getAttribute('srcset');
        if (srcset) {
          // srcset can have multiple URLs separated by commas
          srcset.split(',').forEach(entry => {
            // Each entry looks like "image.jpg 1000w" or "image.jpg 2x"
            const parts = entry.trim().split(/\s+/);
            const imageUrl = parts[0]; 
            if (imageUrl) {
              try {
                // Resolve relative URLs against the current page URL
                const resolvedUrl = new URL(imageUrl, url).href;
                assets.add(resolvedUrl);
              } catch (e) {
                /* Skip invalid URLs */
              }
            }
          });
        }
      });

      // 3. Filter for target domains and image extensions
      const targetUrls = Array.from(assets).filter(src => {
        const isTargetDomain = ALLOWED_DOMAINS.some(domain => src.includes(domain));
        const urlClean = src.split('?')[0].toLowerCase();
        const isImageFile = IMAGE_EXTENSIONS.some(ext => urlClean.endsWith(ext));
        return isTargetDomain && isImageFile;
      });

      if (targetUrls.length === 0) {
        console.log(`   ⚠️ No matching images found on this page.`);
        continue;
      }

      console.log(`   Found ${targetUrls.length} assets. Warming...`);

      // 4. Request each asset
      await Promise.all(targetUrls.map(async (assetUrl) => {
        try {
          const res = await fetch(assetUrl, { 
            method: 'HEAD',
            headers: { 'User-Agent': 'Github-Action-Cache-Warmer' }
          });
          // Printing the status and the full URL
          console.log(`   ✅ [${res.status}] ${assetUrl}`);
        } catch (e) {
          console.log(`   ❌ Failed: ${assetUrl}`);
        }
      }));
    }
  } catch (err) {
    console.error(`\n❌ FATAL ERROR:`, err.message);
  }
  console.log('\n✨ Cache warming process finished.');
}

warmUp();
