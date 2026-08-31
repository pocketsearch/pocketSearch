import { describe, expect, it } from 'vitest';
import { RobotsRules } from './robots.js';

describe('RobotsRules', () => {
  it('allows everything when the file is empty', () => {
    const rules = new RobotsRules('', 'BeaconSearchBot');
    expect(rules.isAllowed('/anything')).toBe(true);
  });

  it('blocks disallowed paths for the wildcard group', () => {
    const rules = new RobotsRules('User-agent: *\nDisallow: /private\nAllow: /private/ok', 'Bot');
    expect(rules.isAllowed('/private/secret')).toBe(false);
    expect(rules.isAllowed('/private/ok/page')).toBe(true);
    expect(rules.isAllowed('/public')).toBe(true);
  });

  it('prefers a group that names the bot', () => {
    const body = [
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: BeaconSearchBot',
      'Disallow: /admin',
    ].join('\n');
    const rules = new RobotsRules(body, 'BeaconSearchBot/1.0');
    expect(rules.isAllowed('/admin')).toBe(false);
    expect(rules.isAllowed('/docs')).toBe(true);
  });

  it('ignores comments and blank lines', () => {
    const rules = new RobotsRules('# comment\nUser-agent: *\n\nDisallow: /x # inline', 'Bot');
    expect(rules.isAllowed('/x')).toBe(false);
  });
});
