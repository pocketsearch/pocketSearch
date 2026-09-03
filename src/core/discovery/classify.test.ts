import { describe, expect, it } from 'vitest';
import { classifyQuery } from './classify.js';
import { expandQuery } from './expand.js';

describe('classifyQuery', () => {
  it('recognises a bare domain and derives its root', () => {
    const c = classifyQuery('docs.example.co.uk');
    expect(c.type).toBe('domain');
    expect(c.entities.rootDomain).toBe('example.co.uk');
    expect(c.entities.hostname).toBe('docs.example.co.uk');
  });

  it('recognises a full URL and pulls path terms', () => {
    const c = classifyQuery('https://example.com/blog/getting-started');
    expect(c.type).toBe('url');
    expect(c.entities.hostname).toBe('example.com');
    expect(c.entities.pathTerms).toContain('getting');
  });

  it('recognises an email and splits it', () => {
    const c = classifyQuery('Ada.Lovelace@example.org');
    expect(c.type).toBe('email');
    expect(c.entities.localPart).toBe('Ada.Lovelace');
    expect(c.entities.domain).toBe('example.org');
  });

  it('recognises IP, DOI and CVE', () => {
    expect(classifyQuery('8.8.8.8').type).toBe('ip');
    expect(classifyQuery('10.1145/3292500.3330701').type).toBe('doi');
    expect(classifyQuery('CVE-2021-44228').type).toBe('cve');
  });

  it('recognises a handle-like token as a username', () => {
    expect(classifyQuery('@torvalds').type).toBe('username');
    expect(classifyQuery('some_dev_handle').type).toBe('username');
  });

  it('treats a quoted string as a phrase and plain words as text', () => {
    expect(classifyQuery('"the exact words"').type).toBe('phrase');
    expect(classifyQuery('how does full text search work').type).toBe('text');
  });
});

describe('expandQuery', () => {
  it('produces punctuation-free, singular/plural and reordered variants', () => {
    const v = expandQuery('best  search-engines', classifyQuery('best search-engines'));
    expect(v.some((x) => x === 'best search engines')).toBe(true);
    expect(v.some((x) => x.includes('search-engine'))).toBe(true);
  });

  it('adds entity-derived variants for a URL', () => {
    const q = 'https://example.com/docs/api';
    const v = expandQuery(q, classifyQuery(q));
    expect(v).toContain('example.com');
  });

  it('never returns the original query and caps the list', () => {
    const v = expandQuery('typescript', classifyQuery('typescript'));
    expect(v).not.toContain('typescript');
    expect(v.length).toBeLessThanOrEqual(8);
  });
});
