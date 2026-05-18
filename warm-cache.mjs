import { parseStringPromise } from 'xml2js';
import { JSDOM } from 'jsdom';

const SITEMAP_URL = 'https://blog.tejasjog.in/sitemap.xml';
const ALLOWED_DOMAINS = ['cloudflare.com', 'imagekit.io', 'blog.tejasjog.in'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg'];

// Helper function to pause execution (delay)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Robust fetch wrapper with automatic retries and exponential backoff
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch configuration options
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} initialDelay - Initial pause duration in milliseconds (default: 1000ms)
 */
async function fetchWithRetry(url, options = {}, maxRetries = 4, initialDelay = 1000) {
  let currentDelay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // Consider HTTP 4xx/5xx server errors as failures to trigger a retry
      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}`);
      }
      
      return response;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error; // Re-throw error if we've exhausted all attempts
      }
      
      console.log(`   ⚠️ [Attempt ${attempt}/${maxRetries} Failed]: ${error.message}. Retrying in ${currentDelay}ms...`);
      await delay(currentDelay);
      currentDelay *= 2; // Exponential backoff: double the pause duration for the next retry
    }
  }
}

async function warmUp() {
  console.log('🚀 Fetching sitemap...');
  try {
    // Sitemap fetch doesn't change often, but we use retry just in case of transient network issues
    const response = await fetchWithRetry(SITEMAP_URL, {}, 3, 1500);
    const xml = await response.text();
    const sitemap = await parseStringPromise(xml);
    
    const urls = sitemap.urlset.url.map(u => u.loc[0]);
    console.log(`Found ${urls.length} pages to crawl.`);

    for (const url of urls) {
      console.log(`\n📄 Processing: ${url}`);
      
      let html;
      try {
        // Fetch HTML page with up to 4 retries
        const pageRes = await fetchWithRetry(url, {}, 4, 1000);
        html = await pageRes.text();
      } catch (pageError) {
        console.log(`   ❌ [FATAL PAGE FAILURE] Skipping page. Could not fetch ${url} after multiple attempts.`);
        continue;
      }
      
      const dom = new JSDOM(html, { url }); 
      const document = dom.window.document;

      const assets = new Set();
      
      // 1. Standard src and href
      document.querySelectorAll('img[src], a[href]').forEach(el => {
        const link = el.src || el.href;
        if (link) assets.add(link);
      });
      
      // 2. Handle background-images in style attributes
      document.querySelectorAll('[style*="background-image"]').forEach(el => {
        const style = el.getAttribute('style');
        const match = style.match(/url\(['"]?([^'"]+)['"]?\)/);
        if (match && match[1]) {
          const imageUrl = match[1];
          try {
            const resolvedUrl = new URL(imageUrl, url).href;
            assets.add(resolvedUrl);
          } catch (e) { /* Skip invalid */ }
        }
      });
      
      // 3. Handle srcset (found in <img> and <source> tags)
      document.querySelectorAll('[srcset]').forEach(el => {
        const srcset = el.getAttribute('srcset');
        if (srcset) {
          srcset.split(',').forEach(entry => {
            const parts = entry.trim().split(/\s+/);
            const imageUrl = parts[0]; 
            if (imageUrl) {
              try {
                const resolvedUrl = new URL(imageUrl, url).href;
                assets.add(resolvedUrl);
              } catch (e) { /* Skip invalid */ }
            }
          });
        }
      });

      // Filter for target domains and image extensions
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

      // 4. Request each asset with retry mechanism
      // Using Promise.all here is fine, but fetchWithRetry will throttle individual failing assets
      await Promise.all(targetUrls.map(async (assetUrl) => {
        try {
          const res = await fetchWithRetry(assetUrl, { 
            method: 'HEAD',
            headers: { 'User-Agent': 'Github-Action-Cache-Warmer' }
          }, 4, 1000); // Retry assets up to 4 times starting with 1s delays
          
          console.log(`   ✅ [${res.status}] ${assetUrl}`);
        } catch (e) {
          console.log(`   ❌ [PERMANENT FAILURE]: ${assetUrl} after maximum retries.`);
        }
      }));
    }
  } catch (err) {
    console.error(`\n❌ FATAL SITEMAP ERROR:`, err.message);
  }
  console.log('\n✨ Cache warming process finished.');
}

warmUp();
