import { parseStringPromise } from 'xml2js';
import { JSDOM } from 'jsdom';

const SITEMAP_URL = 'https://blog.tejasjog.in/sitemap.xml';
const ALLOWED_DOMAINS = ['cloudflare.com', 'imagekit.io', 'blog.tejasjog.in'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg'];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, options = {}, maxRetries = 4, initialDelay = 1000) {
  let currentDelay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return response;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      console.log(`   ⚠️ [Attempt ${attempt}/${maxRetries} Failed]: ${error.message}. Retrying in ${currentDelay}ms...`);
      await delay(currentDelay);
      currentDelay *= 2;
    }
  }
}

/**
 * Safely resolves and extracts image URLs regardless of query parameters or relative paths
 */
function extractAndNormalizeUrl(rawUrl, baseUrl) {
  if (!rawUrl) return null;
  try {
    const resolved = new URL(rawUrl, baseUrl).href;
    const cleanPath = resolved.split('?')[0].toLowerCase();

    const isImage = IMAGE_EXTENSIONS.some((ext) => cleanPath.endsWith(ext));
    const isAllowedDomain = ALLOWED_DOMAINS.some((domain) => resolved.includes(domain));

    if (isImage && isAllowedDomain) {
      return resolved;
    }
  } catch (e) {
    // Ignore malformed URLs
  }
  return null;
}

async function warmUp() {
  console.log('🚀 Fetching sitemap...');
  try {
    const response = await fetchWithRetry(SITEMAP_URL, {}, 3, 1500);
    const xml = await response.text();
    const sitemap = await parseStringPromise(xml);

    const urls = sitemap.urlset.url.map((u) => u.loc[0]);
    console.log(`Found ${urls.length} pages to crawl.`);

    for (const url of urls) {
      console.log(`\n📄 Processing: ${url}`);

      let html;
      try {
        const pageRes = await fetchWithRetry(url, {}, 4, 1000);
        html = await pageRes.text();
      } catch (pageError) {
        console.log(`   ❌ [FATAL PAGE FAILURE] Skipping page. Could not fetch ${url}`);
        continue;
      }

      const dom = new JSDOM(html, { url });
      const document = dom.window.document;
      const assets = new Set();

      // 1. Check img src and a href (for photo gallery lightboxes)
      document.querySelectorAll('img[src], a[href]').forEach((el) => {
        const raw = el.tagName.toLowerCase() === 'img' ? el.getAttribute('src') : el.getAttribute('href');
        const normalized = extractAndNormalizeUrl(raw, url);
        if (normalized) assets.add(normalized);
      });

      // 2. Check srcset attributes (responsive Hugo / ImageKit variants)
      document.querySelectorAll('[srcset]').forEach((el) => {
        const srcset = el.getAttribute('srcset');
        if (srcset) {
          srcset.split(',').forEach((entry) => {
            const parts = entry.trim().split(/\s+/);
            const normalized = extractAndNormalizeUrl(parts[0], url);
            if (normalized) assets.add(normalized);
          });
        }
      });

      // 3. Handle inline background images in styles
      document.querySelectorAll('[style*="background-image"]').forEach((el) => {
        const style = el.getAttribute('style');
        const match = style.match(/url\(['"]?([^'"]+)['"]?\)/);
        if (match && match[1]) {
          const normalized = extractAndNormalizeUrl(match[1], url);
          if (normalized) assets.add(normalized);
        }
      });

      const targetUrls = Array.from(assets);

      if (targetUrls.length === 0) {
        console.log(`   ⚠️ No matching images found on this page.`);
        continue;
      }

      console.log(`   Found ${targetUrls.length} unique image assets. Warming...`);

      await Promise.all(
        targetUrls.map(async (assetUrl) => {
          try {
            const res = await fetchWithRetry(
              assetUrl,
              {
                method: 'HEAD',
                headers: { 'User-Agent': 'Github-Action-Cache-Warmer' },
              },
              4,
              1000
            );

            console.log(`   ✅ [${res.status}] ${assetUrl}`);
          } catch (e) {
            console.log(`   ❌ [PERMANENT FAILURE]: ${assetUrl}`);
          }
        })
      );
    }
  } catch (err) {
    console.error(`\n❌ FATAL SITEMAP ERROR:`, err.message);
  }
  console.log('\n✨ Cache warming process finished.');
}

warmUp();
