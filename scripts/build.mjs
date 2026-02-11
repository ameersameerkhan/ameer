#!/usr/bin/env node

// ── Static-site build script ────────────────────────────────────────
// Zero external dependencies. Uses only Node built-ins.
// Run: node scripts/build.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  SITE_URL, SITE_TITLE, SITE_DESCRIPTION,
  AUTHOR_NAME, AUTHOR_URL,
  UMAMI_SRC, UMAMI_WEBSITE_ID,
  POSTS_PER_RSS,
} from '../config.mjs';

// ── Paths ─────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const DOCS      = join(ROOT, 'docs');
const CONTENT   = join(ROOT, 'content', 'posts');
const TEMPLATES = join(ROOT, 'templates');
const ASSETS    = join(ROOT, 'assets');

// ── Helpers ───────────────────────────────────────────────────────
function read(file) {
  return readFileSync(file, 'utf-8');
}

function write(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data, 'utf-8');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Front-matter parser ──────────────────────────────────────────
function parseFrontMatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('Missing front matter');
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    // arrays: [a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
    } else {
      // strip surrounding quotes
      val = val.replace(/^["']|["']$/g, '');
    }
    // booleans
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    meta[key] = val;
  }
  const body = raw.slice(match[0].length).trim();
  return { meta, body };
}

function validatePost(meta, file) {
  const required = ['title', 'date', 'description', 'tags', 'slug'];
  for (const field of required) {
    if (!meta[field]) throw new Error(`Missing "${field}" in ${file}`);
  }
  // [SECURITY] Enforce kebab-case slugs to prevent path traversal
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.slug)) {
    throw new Error(`Invalid slug "${meta.slug}" in ${file} — must be lowercase kebab-case (a-z, 0-9, hyphens)`);
  }
}

// ── Markdown → HTML ──────────────────────────────────────────────
function markdownToHtml(md, allowHtml = false) {
  // Optionally escape raw HTML
  if (!allowHtml) {
    // We'll escape HTML after processing code fences to protect fence content
  }

  let html = '';
  const lines = md.split(/\r?\n/);

  // First pass: extract code fences to protect their contents
  const codeFences = [];
  const FENCE_PH = '\x00FENCE';
  let inFence = false;
  let fenceLang = '';
  let fenceLines = [];
  const processed = [];

  for (const line of lines) {
    if (!inFence && /^```(\w*)/.test(line)) {
      inFence = true;
      fenceLang = line.match(/^```(\w*)/)[1];
      fenceLines = [];
    } else if (inFence && /^```\s*$/.test(line)) {
      inFence = false;
      const code = escapeHtml(fenceLines.join('\n'));
      const langAttr = fenceLang ? ` class="language-${fenceLang}"` : '';
      codeFences.push(`<pre><code${langAttr}>${code}</code></pre>`);
      processed.push(FENCE_PH + (codeFences.length - 1));
    } else if (inFence) {
      fenceLines.push(line);
    } else {
      processed.push(line);
    }
  }

  // If allowHtml is false, escape HTML in non-fence lines
  const escaped = processed.map(line => {
    if (line.startsWith(FENCE_PH)) return line;
    return allowHtml ? line : escapeHtml(line);
  });

  // Block-level parsing
  const blocks = [];
  let i = 0;
  const ll = escaped.length;

  while (i < ll) {
    const line = escaped[i];

    // Code fence placeholder
    if (line.startsWith(FENCE_PH)) {
      const idx = parseInt(line.slice(FENCE_PH.length), 10);
      blocks.push(codeFences[idx]);
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push('<hr>');
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('&gt; ') || line === '&gt;') {
      const bqLines = [];
      while (i < ll && (escaped[i].startsWith('&gt; ') || escaped[i] === '&gt;')) {
        bqLines.push(escaped[i].replace(/^&gt;\s?/, ''));
        i++;
      }
      blocks.push('<blockquote>' + parseInlineBlocks(bqLines) + '</blockquote>');
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (i < ll && /^[-*+]\s+/.test(escaped[i])) {
        items.push(inlineFormat(escaped[i].replace(/^[-*+]\s+/, '')));
        i++;
      }
      blocks.push('<ul>' + items.map(it => `<li>${it}</li>`).join('\n') + '</ul>');
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < ll && /^\d+\.\s+/.test(escaped[i])) {
        items.push(inlineFormat(escaped[i].replace(/^\d+\.\s+/, '')));
        i++;
      }
      blocks.push('<ol>' + items.map(it => `<li>${it}</li>`).join('\n') + '</ol>');
      continue;
    }

    // Paragraph – collect consecutive non-empty, non-special lines
    const pLines = [];
    while (
      i < ll &&
      escaped[i].trim() !== '' &&
      !escaped[i].startsWith(FENCE_PH) &&
      !/^#{1,3}\s/.test(escaped[i]) &&
      !/^(\*{3,}|-{3,}|_{3,})\s*$/.test(escaped[i].trim()) &&
      !/^[-*+]\s+/.test(escaped[i]) &&
      !/^\d+\.\s+/.test(escaped[i]) &&
      !escaped[i].startsWith('&gt; ')
    ) {
      pLines.push(escaped[i]);
      i++;
    }
    if (pLines.length) {
      blocks.push('<p>' + inlineFormat(pLines.join('\n')) + '</p>');
    }
  }

  return blocks.join('\n');
}

function parseInlineBlocks(lines) {
  // Simple paragraph grouping inside blockquotes
  const groups = [];
  let current = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length) groups.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) groups.push(current);
  return groups.map(g => '<p>' + inlineFormat(g.join(' ')) + '</p>').join('\n');
}

function isSafeUrl(url) {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('/')
  );
}

function inlineFormat(text) {
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Images – ![alt](url) — must come before link replacement
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, url) {
    if (isSafeUrl(url)) {
      return '<img src="' + url + '" alt="' + alt + '" loading="lazy">';
    }
    return alt; // strip the image, keep the alt text
  });
  // Links – [SECURITY] only allow safe URL protocols
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, url) {
    if (isSafeUrl(url)) {
      return '<a href="' + url + '">' + label + '</a>';
    }
    return label; // strip the link, keep the text
  });
  return text;
}

// ── Reading time ─────────────────────────────────────────────────
function readingTime(text) {
  const words = text.trim().split(/\s+/).length;
  return Math.ceil(words / 200);
}

// ── Date formatting ──────────────────────────────────────────────
function displayDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function rfc822Date(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toUTCString();
}

function isoDate(dateStr) {
  return dateStr; // already YYYY-MM-DD
}

// ── Template engine ──────────────────────────────────────────────
function render(template, vars) {
  let out = template;
  for (const [key, val] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, val ?? '');
  }
  return out;
}

// ── JSON-LD generators ───────────────────────────────────────────
function websiteJsonLd() {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_TITLE,
    url: SITE_URL,
  });
}

function personJsonLd() {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: AUTHOR_NAME,
    url: AUTHOR_URL,
  });
}

function blogPostingJsonLd(post) {
  const obj = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.meta.title,
    datePublished: post.meta.date,
    author: { '@type': 'Person', name: AUTHOR_NAME, url: AUTHOR_URL },
    mainEntityOfPage: `${SITE_URL}/posts/${post.meta.slug}/`,
  };
  if (post.meta.updated) obj.dateModified = post.meta.updated;
  return JSON.stringify(obj);
}

function wrapJsonLd(json) {
  // [SECURITY] Prevent </script> breakout inside ld+json blocks
  const safe = json.replace(/<\//g, '<\\/');
  return `<script type="application/ld+json">${safe}</script>`;
}

// ── Umami snippet ────────────────────────────────────────────────
function umamiSnippet() {
  if (!UMAMI_SRC || !UMAMI_WEBSITE_ID) return '';
  // [SECURITY] Escape config values before embedding in HTML attributes
  return `<script defer src="${escapeHtml(UMAMI_SRC)}" data-website-id="${escapeHtml(UMAMI_WEBSITE_ID)}"></script>`;
}

function umamiCspOrigin() {
  // Extract the origin from UMAMI_SRC for the CSP script-src directive
  if (!UMAMI_SRC) return '';
  try { return new URL(UMAMI_SRC).origin; } catch { return ''; }
}

// ── Build post list item HTML ────────────────────────────────────
function postListItemHtml(post) {
  const tagsHtml = Array.isArray(post.meta.tags)
    ? '<ul class="tags">' + post.meta.tags.map(t => `<li class="tag">${escapeHtml(t)}</li>`).join('') + '</ul>'
    : '';
  return `<li class="post-list-item">
  <h2><a href="/posts/${post.meta.slug}/">${escapeHtml(post.meta.title)}</a></h2>
  <div class="post-meta">
    <time datetime="${post.meta.date}">${displayDate(post.meta.date)}</time>
  </div>
  <p class="description">${escapeHtml(post.meta.description)}</p>
  ${tagsHtml}
</li>`;
}

// ── Page renderer ────────────────────────────────────────────────
function renderPage(baseTemplate, contentHtml, vars) {
  const depthToRoot = vars._depth || 0;
  const root = depthToRoot === 0 ? '/' : '../'.repeat(depthToRoot);
  const cssPath = depthToRoot === 0 ? '/assets/css/styles.css' : '../'.repeat(depthToRoot) + 'assets/css/styles.css';
  const jsPath  = depthToRoot === 0 ? '/assets/js/main.js' : '../'.repeat(depthToRoot) + 'assets/js/main.js';

  const jsonLdParts = [wrapJsonLd(websiteJsonLd())];
  if (vars._jsonLdExtra) jsonLdParts.push(wrapJsonLd(vars._jsonLdExtra));

  // [SECURITY] Escape values that land in HTML tags / attributes
  const safeTitle       = escapeHtml(vars.title || '');
  const safeDescription = escapeHtml(vars.description || '');
  const safeOgTitle     = escapeHtml(vars.og_title || '');
  const safeOgDesc      = escapeHtml(vars.og_description || '');

  const allVars = {
    site_title: escapeHtml(SITE_TITLE),
    site_url: SITE_URL,
    author_name: escapeHtml(AUTHOR_NAME),
    year: new Date().getFullYear().toString(),
    root,
    css_path: cssPath,
    js_path: jsPath,
    json_ld: jsonLdParts.join('\n  '),
    umami_script: umamiSnippet(),
    umami_csp: umamiCspOrigin(),
    content: contentHtml,
    og_type: vars.og_type || 'website',
    ...vars,
    // Override with escaped versions
    title: safeTitle,
    description: safeDescription,
    og_title: safeOgTitle,
    og_description: safeOgDesc,
  };
  delete allVars._depth;
  delete allVars._jsonLdExtra;

  return render(baseTemplate, allVars);
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN BUILD
// ═══════════════════════════════════════════════════════════════════
console.log('Building site...');

// 1. Clean docs
if (existsSync(DOCS)) rmSync(DOCS, { recursive: true, force: true });
mkdirSync(DOCS, { recursive: true });

// 2. Read posts
const postFiles = existsSync(CONTENT)
  ? readdirSync(CONTENT).filter(f => f.endsWith('.md'))
  : [];

const posts = [];
for (const file of postFiles) {
  const raw = read(join(CONTENT, file));
  const { meta, body } = parseFrontMatter(raw);
  validatePost(meta, file);
  if (meta.draft === true) continue;
  const html = markdownToHtml(body, meta.allow_html === true);
  const rt = readingTime(body);
  posts.push({ meta, body, html, readingTime: rt, file });
}

// 3. Sort by date desc
posts.sort((a, b) => (a.meta.date > b.meta.date ? -1 : 1));

// 4. Load templates
const baseTemplate    = read(join(TEMPLATES, 'base.html'));
const postTemplate    = read(join(TEMPLATES, 'post.html'));
const writingTemplate = read(join(TEMPLATES, 'writing.html'));
const homeTemplate    = read(join(TEMPLATES, 'home.html'));
const aboutTemplate   = read(join(TEMPLATES, 'about.html'));
const nowTemplate     = read(join(TEMPLATES, 'now.html'));
const notFoundTemplate = read(join(TEMPLATES, '404.html'));

// 5. Render post pages
for (const post of posts) {
  const tagsHtml = Array.isArray(post.meta.tags)
    ? '<ul class="tags">' + post.meta.tags.map(t => `<li class="tag">${escapeHtml(t)}</li>`).join('') + '</ul>'
    : '';

  const updatedHtml = post.meta.updated
    ? `<span>Updated <time datetime="${post.meta.updated}">${displayDate(post.meta.updated)}</time></span>`
    : '';

  const contentHtml = render(postTemplate, {
    post_title: escapeHtml(post.meta.title),
    date: post.meta.date,
    date_display: displayDate(post.meta.date),
    updated_display: updatedHtml,
    reading_time: post.readingTime.toString(),
    tags_html: tagsHtml,
    post_body: post.html,
  });

  const page = renderPage(baseTemplate, contentHtml, {
    title: `${post.meta.title} — ${SITE_TITLE}`,
    description: post.meta.description,
    canonical: `${SITE_URL}/posts/${post.meta.slug}/`,
    og_title: post.meta.title,
    og_description: post.meta.description,
    og_type: 'article',
    _depth: 2,
    _jsonLdExtra: blogPostingJsonLd(post),
  });

  write(join(DOCS, 'posts', post.meta.slug, 'index.html'), page);
}

// 6. Render Writing page
const postListHtml = posts.map(postListItemHtml).join('\n');
const writingContent = render(writingTemplate, { post_list: postListHtml });
const writingPage = renderPage(baseTemplate, writingContent, {
  title: `Writing — ${SITE_TITLE}`,
  description: `All posts by ${AUTHOR_NAME}.`,
  canonical: `${SITE_URL}/writing/`,
  og_title: `Writing — ${SITE_TITLE}`,
  og_description: `All posts by ${AUTHOR_NAME}.`,
  _depth: 1,
});
write(join(DOCS, 'writing', 'index.html'), writingPage);

// 7. Render Home page
const recentHtml = posts.slice(0, 5).map(postListItemHtml).join('\n');
const homeContent = render(homeTemplate, { recent_posts: recentHtml });
const homePage = renderPage(baseTemplate, homeContent, {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  canonical: `${SITE_URL}/`,
  og_title: SITE_TITLE,
  og_description: SITE_DESCRIPTION,
  _depth: 0,
});
write(join(DOCS, 'index.html'), homePage);

// 8. Render About page
const aboutContent = render(aboutTemplate, {});
const aboutPage = renderPage(baseTemplate, aboutContent, {
  title: `About — ${SITE_TITLE}`,
  description: `About ${AUTHOR_NAME}.`,
  canonical: `${SITE_URL}/about/`,
  og_title: `About — ${SITE_TITLE}`,
  og_description: `About ${AUTHOR_NAME}.`,
  _depth: 1,
  _jsonLdExtra: personJsonLd(),
});
write(join(DOCS, 'about', 'index.html'), aboutPage);

// 9. Render Now page
const nowContent = render(nowTemplate, {});
const nowPage = renderPage(baseTemplate, nowContent, {
  title: `Now — ${SITE_TITLE}`,
  description: `What ${AUTHOR_NAME} is doing now.`,
  canonical: `${SITE_URL}/now/`,
  og_title: `Now — ${SITE_TITLE}`,
  og_description: `What ${AUTHOR_NAME} is doing now.`,
  _depth: 1,
});
write(join(DOCS, 'now', 'index.html'), nowPage);

// 10. Render 404 page
const notFoundContent = render(notFoundTemplate, { root: '/' });
const notFoundPage = renderPage(baseTemplate, notFoundContent, {
  title: `Page not found — ${SITE_TITLE}`,
  description: 'The page you are looking for does not exist.',
  canonical: `${SITE_URL}/404.html`,
  og_title: 'Page not found',
  og_description: 'The page you are looking for does not exist.',
  _depth: 0,
});
write(join(DOCS, '404.html'), notFoundPage);

// 11. Generate RSS
const rssItems = posts.slice(0, POSTS_PER_RSS).map(post => `    <item>
      <title>${escapeXml(post.meta.title)}</title>
      <link>${SITE_URL}/posts/${post.meta.slug}/</link>
      <guid isPermaLink="true">${SITE_URL}/posts/${post.meta.slug}/</guid>
      <pubDate>${rfc822Date(post.meta.date)}</pubDate>
      <description>${escapeXml(post.meta.description)}</description>
    </item>`).join('\n');

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_TITLE)}</title>
    <link>${SITE_URL}/</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>en</language>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml"/>
${rssItems}
  </channel>
</rss>`;
write(join(DOCS, 'rss.xml'), rss);

// 12. Generate sitemap
const staticPages = ['', 'about/', 'writing/', 'now/'];
const today = new Date().toISOString().slice(0, 10);
const sitemapUrls = [
  ...staticPages.map(p => `  <url>
    <loc>${SITE_URL}/${p}</loc>
    <lastmod>${today}</lastmod>
  </url>`),
  ...posts.map(post => `  <url>
    <loc>${SITE_URL}/posts/${post.meta.slug}/</loc>
    <lastmod>${post.meta.updated || post.meta.date}</lastmod>
  </url>`),
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.join('\n')}
</urlset>`;
write(join(DOCS, 'sitemap.xml'), sitemap);

// 13. Generate robots.txt
const robots = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
write(join(DOCS, 'robots.txt'), robots);

// 14. Copy assets
mkdirSync(join(DOCS, 'assets', 'css'), { recursive: true });
mkdirSync(join(DOCS, 'assets', 'js'), { recursive: true });
cpSync(join(ASSETS, 'css', 'styles.css'), join(DOCS, 'assets', 'css', 'styles.css'));
cpSync(join(ASSETS, 'js', 'main.js'), join(DOCS, 'assets', 'js', 'main.js'));
// Copy images folder if it exists
if (existsSync(join(ASSETS, 'images'))) {
  cpSync(join(ASSETS, 'images'), join(DOCS, 'assets', 'images'), { recursive: true });
}

// 15. CNAME — derive domain from SITE_URL (strips protocol)
const cnameDomain = SITE_URL.replace(/^https?:\/\//, '');
write(join(DOCS, 'CNAME'), cnameDomain + '\n');

console.log(`Done. ${posts.length} post(s) built → /docs`);
