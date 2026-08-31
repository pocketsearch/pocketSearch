import { describe, expect, it } from 'vitest';
import { escapeHtml, highlight, makeSnippet, normalizeWhitespace, tokenize } from './text.js';

describe('tokenize', () => {
  it('splits on non-word characters and lowercases', () => {
    expect(tokenize('Hello, WORLD! 123_foo')).toEqual(['hello', 'world', '123', 'foo']);
  });

  it('keeps intra-word apostrophes', () => {
    expect(tokenize("it's don't")).toEqual(["it's", "don't"]);
  });
});

describe('normalizeWhitespace', () => {
  it('collapses whitespace runs', () => {
    expect(normalizeWhitespace('  a\n\t b   c ')).toBe('a b c');
  });
});

describe('makeSnippet', () => {
  const body = 'The quick brown fox jumps over the lazy dog. '.repeat(20);

  it('centers on the first matching term', () => {
    const snippet = makeSnippet(body + 'BEACON marker here.', ['beacon'], 20);
    expect(snippet.toLowerCase()).toContain('beacon');
    expect(snippet.startsWith('… ')).toBe(true);
  });

  it('falls back to the head when nothing matches', () => {
    const snippet = makeSnippet(body, ['nonexistent'], 15);
    expect(snippet.startsWith('The quick')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('returns empty string for empty body', () => {
    expect(makeSnippet('', ['x'])).toBe('');
  });
});

describe('highlight', () => {
  it('escapes HTML then wraps terms in mark tags', () => {
    const out = highlight('<script>alert(injection)</script>', ['injection']);
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('<mark>injection</mark>');
    expect(out).not.toContain('<script>');
  });

  it('ignores very short terms', () => {
    expect(highlight('a bc', ['a'])).toBe(escapeHtml('a bc'));
  });

  it('is case-insensitive', () => {
    expect(highlight('Fox and FOX', ['fox'])).toBe('<mark>Fox</mark> and <mark>FOX</mark>');
  });
});
