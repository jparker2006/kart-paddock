# Sharing preview

September 9, 2026. Homepage, prompt, and all five play wrappers include static Open Graph and large-image Twitter/X card metadata, unique page titles and descriptions, absolute production URLs, canonical links, dimensions, MIME type, and descriptive image alt text. No model identities are revealed by the preview.

The shared 1200×630 JPEG is 96,350 bytes and uses the existing site palette and five actual game screenshots. Source: `scripts/build-share-image.mjs`. It can be regenerated with an installed Sharp module path supplied as the first argument; Sharp is artwork tooling, not a website runtime dependency. The existing HyperKart `.png` screenshot contains JPEG bytes, so the artwork script detects the actual format before embedding it; original assets are untouched.

Verified: inspected final image, parsed metadata on all seven pages with no duplicate required tags, fetched all seven published pages and the JPEG with a Twitterbot user agent, matched their bytes against local output, checked the JPEG content type, and confirmed every page body and all 340 frozen game files are unchanged. This verifies publicly accessible metadata and artwork, not actual rendering or cache refresh inside every social platform. Existing search-engine noindex settings remain unchanged. No podcast episode link or analytics was added.

References: https://ogp.me/
