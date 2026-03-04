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
    
    // Support both <urlset><url><loc> and nested sitemaps
    const urls = sitemap.urlset.url.map(u => u.loc[0]);
    console.log(`Found ${urls.length} pages to crawl.`);

    for (const url of urls) {
      console.log(`\n📄 Processing: ${url}`);
      const pageRes = await fetch(url);
      const html = await pageRes.text();
      
      // Pass the current URL as the 'url' option so JSDOM resolves relative links
      const dom = new JSDOM(html, { url }); 
      const document = dom.window.document;

      const imgElements = Array.from(document.querySelectorAll('img')).map(i => i.src);
      const linkElements = Array.from(document.querySelectorAll('a')).map(a => a.href);

      const allPossibleAssets = [...imgElements, ...linkElements];

      const targetUrls = allPossibleAssets.filter(src => {
        if (!src) return false;
        
        // Check if it's one of our target domains
        const isTargetDomain = ALLOWED_DOMAINS.some(domain => src.includes(domain));
        
        // Check if it looks like an image file
        const urlClean = src.split('?')[0].toLowerCase();
        const isImageFile = IMAGE_EXTENSIONS.some(ext => urlClean.endsWith(ext));
        
        return isTargetDomain && isImageFile;
      });

      const uniqueAssets = [...new Set(targetUrls)];
      
      if (uniqueAssets.length === 0) {
        console.log(`   ⚠️ No matching images found on this page.`);
        continue;
      }

      console.log(`   Found ${uniqueAssets.length} assets. Warming...`);

      await Promise.all(uniqueAssets.map(async (assetUrl) => {
        try {
          const res = await fetch(assetUrl, { 
            method: 'HEAD',
            headers: { 'User-Agent': 'Github-Action-Cache-Warmer' }
          });
          console.log(`   ✅ [${res.status}] ${assetUrl.split('/').pop()}`);
        } catch (e) {
          console.log(`   ❌ Failed: ${assetUrl.substring(0, 50)}...`);
        }
      }));
    }
  } catch (err) {
    console.error(`\n❌ FATAL ERROR:`, err.message);
  }
  console.log('\n✨ Cache warming process finished.');
}

warmUp();
