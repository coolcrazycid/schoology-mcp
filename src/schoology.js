// Schoology through its website, with your own sign-in. You sign in once in a normal browser window
// (`schoology-mcp login`), the session is saved on your computer, and the server reads pages with a
// headless browser using it. Read-only: only pages and the site's own read endpoints are loaded.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

export const HOME = process.env.SCHOOLOGY_MCP_HOME || path.join(os.homedir(), '.schoology-mcp');
const SESSION = path.join(HOME, 'session.json');
const LOGIN_PROFILE = path.join(HOME, 'login-profile');

export function originOf(domain) {
  let d = String(domain || '').trim();
  if (!d) throw new Error('Set SCHOOLOGY_DOMAIN to your school’s Schoology address, e.g. yourschool.schoology.com');
  if (!/^https?:\/\//i.test(d)) d = 'https://' + d;
  const u = new URL(d);
  if (u.protocol !== 'https:') throw new Error('SCHOOLOGY_DOMAIN must use https');
  return u.origin;
}

/** Rough HTML → readable text (keeps line breaks between blocks). */
export function htmlText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(div|p|li|h\d|tr|section|article)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const saveSession = async (ctx) => {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const tmp = SESSION + '.tmp';
  await ctx.storageState({ path: tmp });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, SESSION);
};

// ------------------------------------------------------------ signing in (a normal browser window)

function findBrowser() {
  const c = process.env.SCHOOLOGY_BROWSER_PATH;
  if (c) return c;
  const candidates = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    win32: [
      `${process.env['PROGRAMFILES']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['LOCALAPPDATA']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
  }[process.platform] || [];
  return candidates.find((p) => p && fs.existsSync(p)) || chromium.executablePath();
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });

/**
 * Open a normal browser window (not an automated one, so Google sign-in works) at your Schoology
 * address. When you're signed in, the session is saved and the window closes.
 */
export async function login(domain, { log = console.log } = {}) {
  const origin = originOf(domain);
  const port = await freePort();
  fs.mkdirSync(LOGIN_PROFILE, { recursive: true, mode: 0o700 });
  const exe = findBrowser();
  const proc = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${LOGIN_PROFILE}`, '--no-first-run', '--no-default-browser-check', '--new-window', origin + '/home'], { stdio: 'ignore', detached: false });
  log(`A browser window opened. Sign in to Schoology there (${origin}).`);
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 500));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
  }
  if (!browser) {
    proc.kill();
    throw new Error(`Couldn't open a browser (${exe}). Set SCHOOLOGY_BROWSER_PATH to Chrome, Edge or Chromium.`);
  }
  const ctx = browser.contexts()[0];
  try {
    for (let i = 0; i < 600; i++) {
      // up to 20 minutes
      await new Promise((r) => setTimeout(r, 2000));
      if (proc.exitCode !== null) throw new Error('The browser was closed before you finished signing in.');
      const r = await ctx.request.get(origin + '/iapi/course/active', { headers: { accept: 'application/json' }, failOnStatusCode: false, maxRedirects: 0 }).catch(() => null);
      if (r && r.status() === 200 && /^\s*\{/.test(await r.text())) {
        await saveSession(ctx);
        log('✓ Signed in. Your Schoology session is saved in ' + SESSION);
        return true;
      }
    }
    throw new Error('Timed out waiting for you to sign in.');
  } finally {
    await browser.close().catch(() => {});
    proc.kill();
  }
}

// ------------------------------------------------------------ reading (headless)

export class Schoology {
  /** { domain, email, headless = true, browserChannel } */
  constructor(opts) {
    this.domain = opts.domain;
    this.email = opts.email || '';
    this.headless = opts.headless !== false;
    this.channel = opts.browserChannel || undefined;
    this.okAt = 0;
    this.sections = null;
  }

  get origin() {
    return originOf(this.domain);
  }

  async context() {
    if (this.ctx) return this.ctx;
    if (!fs.existsSync(SESSION)) throw new Error('Not signed in yet. Run: npx schoology-mcp login (or `npm run login`) with SCHOOLOGY_DOMAIN set.');
    this.browser = await chromium.launch({ headless: this.headless, channel: this.channel });
    this.ctx = await this.browser.newContext({ storageState: SESSION, viewport: { width: 1280, height: 900 } });
    return this.ctx;
  }

  async close() {
    await this.browser?.close().catch(() => {});
    this.browser = this.ctx = null;
  }

  /** Make sure the session works; if Schoology ended it, try picking your account in Google's chooser. */
  async ensure() {
    if (Date.now() - this.okAt < 10 * 60_000) return;
    const ctx = await this.context();
    const probe = await ctx.request.get(this.origin + '/iapi/course/active', { headers: { accept: 'application/json' }, failOnStatusCode: false }).catch(() => null);
    if (probe && probe.status() === 200 && /^\s*\{/.test(await probe.text()) && probe.url().startsWith(this.origin)) {
      this.okAt = Date.now();
      return;
    }
    const page = await ctx.newPage();
    try {
      await page.goto(this.origin + '/home', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(4000);
      if (/accounts\.google\.com/.test(page.url())) {
        const pick = page.getByText(this.email || '@', { exact: false }).first();
        if (await pick.count()) {
          await pick.click().catch(() => {});
          await page.waitForTimeout(8000);
        }
      }
      if (!page.url().startsWith(this.origin)) throw new Error('Schoology needs you to sign in again. Run: npx schoology-mcp login');
      await saveSession(ctx);
      this.okAt = Date.now();
    } finally {
      await page.close();
    }
  }

  async json(p) {
    await this.ensure();
    const r = await this.ctx.request.get(this.origin + p, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' }, failOnStatusCode: false });
    if (r.status() !== 200) throw new Error(`Schoology answered ${r.status()}.`);
    return r.json();
  }

  async pageText(p, script) {
    await this.ensure();
    const page = await this.ctx.newPage();
    try {
      await page.goto(this.origin + p, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      return script ? await page.evaluate(script) : await page.locator('body').innerText();
    } finally {
      await page.close();
    }
  }

  /** Upcoming and overdue assignments, and upcoming events, from the home page's feeds. */
  async upcoming() {
    const [up, over, events] = await Promise.all([this.json('/home/upcoming_submissions_ajax'), this.json('/home/overdue_submissions_ajax'), this.json('/home/upcoming_ajax')]);
    return {
      upcoming_assignments: htmlText(up.html).replace(/^UPCOMING\n/, ''),
      overdue_assignments: htmlText(over.html).replace(/^OVERDUE\n/, ''),
      upcoming_events: htmlText(events.html).replace(/^Calendar\nUpcoming Events\n/, ''),
    };
  }

  async courses() {
    const j = await this.json('/iapi/course/active');
    return (j.body?.courses?.courses || []).map((c) => ({ course: c.course_title, section: c.section_title || undefined }));
  }

  /** Your course sections (the ids course pages use), from the Grades page. */
  async sectionList() {
    if (this.sections && Date.now() - this.sections.at < 3600_000) return this.sections.list;
    const rows = await this.pageText('/grades/grades', () =>
      [...document.querySelectorAll('[id^="s-js-gradebook-course-"]')]
        .map((el) => ({ id: el.id.replace('s-js-gradebook-course-', ''), text: (el.querySelector('.gradebook-course-title')?.innerText || '').replace(/Course$/, '').trim() }))
        .filter((x) => x.text),
    );
    const seen = new Map();
    for (const r of rows || []) if (/^\d+$/.test(r.id) && !seen.has(r.id)) seen.set(r.id, { id: r.id, course: r.text.split(':')[0].trim(), section: r.text });
    this.sections = { at: Date.now(), list: [...seen.values()] };
    return this.sections.list;
  }

  /** A course's materials page (folders, assignments, files) as text. */
  async course(name) {
    const list = await this.sectionList();
    const want = String(name || '').toLowerCase();
    const c = list.find((x) => x.section.toLowerCase().includes(want));
    if (!c) throw new Error(`No course matches "${name}". Courses: ${list.map((x) => x.course).join(', ')}`);
    const text = await this.pageText(`/course/${c.id}/materials`);
    return { course: c.course, page: String(text).split('\n').filter((l) => l.trim()).slice(0, 400).join('\n').slice(0, 20_000) };
  }
}
