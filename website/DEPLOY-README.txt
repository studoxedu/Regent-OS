RYSAN TECHNOLOGIES — WEBSITE (one domain, three pages)

FILES
  index.html      -> company home      (rysantech.com.ng/)
  regent-os.html  -> Regent OS product  (rysantech.com.ng/regent-os)
  herald.html     -> Herald product     (rysantech.com.ng/herald)
  404.html        -> not-found page (Vercel serves this automatically)
  vercel.json     -> clean URLs (/regent-os, /herald) + cache/security headers
  robots.txt      -> allows all crawlers, points to the sitemap
  sitemap.xml     -> the three public URLs
  og-*.png        -> social share images (1200x630) per page

DEPLOY (Vercel)
  * Vercel project root directory = this "website" folder.
  * Framework preset: "Other" (static). No build command, no output dir.
  * vercel.json's "cleanUrls": true makes /regent-os and /herald resolve to the
    .html files and 301s the .html URLs to the clean ones. Do NOT add an
    SPA-style rewrite to /index.html — this is a static multi-page site, and
    that rule would serve the homepage for every path.
  * Domains: set rysantech.com.ng as the PRIMARY domain and
    www.rysantech.com.ng as a redirect to it (Vercel issues the 301).

ICONS (present, generated from the R-tile logo)
  * apple-touch-icon.png (180x180, full-bleed/opaque) — referenced by every page.
  * logo.png (512x512, transparent corners) — referenced by the homepage
    Organization JSON-LD and the blog BlogPosting schema.

BEFORE GOING LIVE — replace placeholders:
  * Email rysantechnologies@gmail.com appears on every page -> use your real address.
  * Herald pricing is marked "indicative" -> confirm naira figures first.
  * Stats ("K-12 & Tertiary", "in deployment") -> soften if not yet in real
    schools, before showing investors.
