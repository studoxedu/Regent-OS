RYSAN TECHNOLOGIES — WEBSITE (one domain, three pages)

FILES
  index.html      -> company home     (rysantech.com.ng/)
  regent-os.html  -> Regent OS product (rysantech.com.ng/regent-os)
  herald.html     -> Herald product    (rysantech.com.ng/herald)
  netlify.toml    -> clean-URL rules (Netlify only)

DEPLOY (any static host)
  * Netlify / Cloudflare Pages / Vercel: drag this whole folder in. Clean URLs
    (/regent-os, /herald) work automatically or via netlify.toml.
  * cPanel / Apache / Nginx: upload the 3 .html files to the web root. If
    /regent-os 404s, either enable extension-less URLs OR just link to
    /regent-os.html (edit the nav links).

BEFORE GOING LIVE — replace placeholders:
  * Email hello@rysantech.com.ng appears on every page -> use your real address.
  * Domain: if not rysantech.com.ng, update email + references. Herald can live at
    rysantech.com.ng/herald (herald.ng may be taken by newspapers).
  * Herald pricing is marked "indicative" -> confirm naira figures first.
  * Stats ("in the field", "2 products") -> soften if not yet deployed in
    real schools, before showing investors.
