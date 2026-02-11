// ── Site Configuration ──────────────────────────────────────────────
// Single source of truth for all site-wide values.
// The build script imports these and bakes them into static HTML.

export const SITE_URL = process.env.SITE_URL || 'https://heyameer.com';
export const SITE_TITLE = 'Hey Ameer';
export const SITE_DESCRIPTION = 'Personal writing on thinking, building, and learning in public.';
export const AUTHOR_NAME = 'ameer';
export const AUTHOR_URL = `${SITE_URL}/about/`;

// ── Analytics (Umami) ──────────────────────────────────────────────
// Leave empty strings to disable analytics entirely.
export const UMAMI_SRC = 'https://cloud.umami.is/script.js';           // e.g. 'https://analytics.example.com/script.js'
export const UMAMI_WEBSITE_ID = '8eeb0370-e8fb-40cf-8df8-197ef141ad64';    // e.g. 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'

// ── Feed ───────────────────────────────────────────────────────────
export const POSTS_PER_RSS = 20;
