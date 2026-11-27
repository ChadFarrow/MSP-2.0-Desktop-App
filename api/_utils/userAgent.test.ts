import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, APP_VERSION, APP_URL, USER_AGENT } from './userAgent.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path, keep));
    else if (keep(entry.name)) out.push(path);
  }
  return out;
}

/** A User-Agent header written as a string literal, or a second UA constant. */
const UA_LITERAL = /['"]user-agent['"]\s*:\s*['"`]|USER_AGENT\s*=\s*['"`]/i;

describe('USER_AGENT', () => {
  it('has the form <AppName>/<version> (+<link>)', () => {
    expect(USER_AGENT).toBe(`${APP_NAME}/${APP_VERSION} (+${APP_URL})`);
    expect(USER_AGENT).toMatch(/^[A-Za-z][A-Za-z0-9.-]*\/\d+\.\d+ \(\+https:\/\/[^\s()]+\)$/);
  });

  it('names this app, with no email and no browser imitation', () => {
    expect(APP_NAME).toBe('MusicSideProjectStudio');
    expect(USER_AGENT).not.toContain('@');
    expect(USER_AGENT).not.toMatch(/mozilla|chrome|safari|applewebkit|gecko/i);
  });

  it('carries the major.minor of package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
    const [major, minor] = pkg.version.split('.');
    expect(APP_VERSION).toBe(`${Number(major)}.${Number(minor)}`);
  });

  it('links the public live site over https', () => {
    expect(APP_URL).toBe('https://musicsideproject.com');
    expect(new URL(APP_URL).protocol).toBe('https:');
  });

  it('is the only User-Agent written in api/ and tools/', () => {
    const files = [
      ...filesUnder(join(ROOT, 'api'), (n) => n.endsWith('.ts') && !n.endsWith('.test.ts')),
      ...filesUnder(join(ROOT, 'tools'), (n) => /\.(mjs|js|ts)$/.test(n))
    ];
    expect(files.length).toBeGreaterThan(10);
    const offenders = files
      .filter((f) => !f.endsWith(join('api', '_utils', 'userAgent.ts')))
      .filter((f) => UA_LITERAL.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('the scan catches a literal', () => {
    expect(UA_LITERAL.test(`headers: { 'User-Agent': 'Other/1.0' }`)).toBe(true);
    expect(UA_LITERAL.test(`const USER_AGENT = 'Other/1.0';`)).toBe(true);
    expect(UA_LITERAL.test(`headers: { 'User-Agent': USER_AGENT }`)).toBe(false);
  });
});
