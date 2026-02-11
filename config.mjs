// ── Site Configuration ──────────────────────────────────────────────
// Single source of truth for all site-wide values.
// The build script imports these and bakes them into static HTML.

export const SITE_URL = 'http://localhost:3000';           // ← your custom domain
export const SITE_TITLE = 'Hey Ameer';
export const SITE_DESCRIPTION = 'Personal writing on thinking, building, and learning in public.';
export const AUTHOR_NAME = 'ameer';
export const AUTHOR_URL = 'http://localhost:3000/about/';  // ← matches SITE_URL

// ── Analytics (Umami) ──────────────────────────────────────────────
// Leave empty strings to disable analytics entirely.
export const UMAMI_SRC = '';           // e.g. 'https://analytics.example.com/script.js'
export const UMAMI_WEBSITE_ID = '';    // e.g. 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'

// ── Feed ───────────────────────────────────────────────────────────
export const POSTS_PER_RSS = 20;
