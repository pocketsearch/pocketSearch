import { describe, expect, it } from 'vitest';
import { classifyQuery } from '../classify.js';
import type { ProviderContext } from '../types.js';
import { DuckDuckGoProvider } from './duckduckgo.js';
import { GitHubProvider } from './github.js';
import { NominatimProvider } from './nominatim.js';
import { OpenAlexProvider } from './openalex.js';
import { NpmProvider, PyPiProvider } from './packages.js';
import { CisaKevProvider, NvdProvider, OsvProvider } from './security.js';
import { StackExchangeProvider } from './stackexchange.js';
import { WikidataProvider } from './wikidata.js';

function ctx(query: string, over: Partial<ProviderContext> = {}): ProviderContext {
  const classification = classifyQuery(query);
  return {
    classification,
    signal: new AbortController().signal,
    limit: 10,
    deep: false,
    tags: [],
    ...over,
  };
}

function jsonFetch(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

/** Strip `<mark>` highlight tags that makeResult adds to titles/snippets. */
const strip = (s: string | undefined) => (s ?? '').replace(/<\/?mark>/g, '');

describe('WikidataProvider', () => {
  it('maps entity search results', async () => {
    const p = new WikidataProvider({
      fetchImpl: jsonFetch({
        search: [{ id: 'Q42', label: 'Douglas Adams', description: 'English writer', concepturi: 'https://www.wikidata.org/wiki/Q42' }],
      }),
    });
    const [r] = await p.search('douglas adams', ctx('douglas adams'));
    expect(strip(r?.title)).toContain('Douglas Adams');
    expect(r?.source).toBe('wikidata.org');
  });
});

describe('DuckDuckGoProvider', () => {
  it('returns the abstract plus related topics', async () => {
    const p = new DuckDuckGoProvider({
      fetchImpl: jsonFetch({
        Heading: 'Fastify',
        AbstractText: 'Fast and low overhead web framework for Node.js.',
        AbstractURL: 'https://en.wikipedia.org/wiki/Fastify',
        AbstractSource: 'Wikipedia',
        RelatedTopics: [{ Text: 'Node.js', FirstURL: 'https://duckduckgo.com/Node.js' }],
      }),
    });
    const results = await p.search('fastify', ctx('fastify'));
    expect(strip(results[0]?.title)).toBe('Fastify');
    expect(results.some((r) => r.kind === 'related')).toBe(true);
  });

  it('never throws on an empty instant answer', async () => {
    const p = new DuckDuckGoProvider({ fetchImpl: jsonFetch({}) });
    await expect(p.search('xyzzy', ctx('xyzzy'))).resolves.toEqual([]);
  });
});

describe('StackExchangeProvider', () => {
  it('decodes entities and adds vote metadata', async () => {
    const p = new StackExchangeProvider({
      fetchImpl: jsonFetch({
        items: [
          { title: 'Why does &quot;this&quot; happen?', link: 'https://stackoverflow.com/q/1', score: 42, answer_count: 3, is_answered: true, tags: ['js'] },
        ],
      }),
    });
    const [r] = await p.search('why does this happen', ctx('why does this happen'));
    // &quot; is decoded from the API then re-escaped HTML-safe by makeResult
    expect(strip(r?.title)).toBe('Why does &quot;this&quot; happen?');
    expect(strip(r?.snippet)).toContain('42 votes');
  });
});

describe('GitHubProvider', () => {
  it('maps repository search results', async () => {
    const p = new GitHubProvider({
      fetchImpl: jsonFetch({
        items: [
          { full_name: 'fastify/fastify', html_url: 'https://github.com/fastify/fastify', description: 'web framework', language: 'JavaScript', stargazers_count: 30000, topics: ['nodejs'] },
        ],
      }),
    });
    const [r] = await p.search('fastify', ctx('fastify'));
    expect(strip(r?.title)).toBe('fastify/fastify');
    expect(r?.origin).toBe('code');
  });
});

describe('OpenAlexProvider', () => {
  it('reconstructs the abstract from the inverted index', async () => {
    const p = new OpenAlexProvider({
      fetchImpl: jsonFetch({
        results: [
          {
            id: 'https://openalex.org/W1',
            title: 'Attention Is All You Need',
            publication_year: 2017,
            cited_by_count: 100000,
            abstract_inverted_index: { The: [0], dominant: [1], models: [2] },
            primary_location: { landing_page_url: 'https://arxiv.org/abs/1706.03762' },
          },
        ],
      }),
    });
    const [r] = await p.search('attention is all you need', ctx('attention is all you need'));
    expect(strip(r?.snippet)).toContain('The dominant models');
    expect(r?.origin).toBe('academic');
  });
});

describe('NpmProvider / PyPiProvider', () => {
  it('npm maps the search objects', async () => {
    const p = new NpmProvider({
      fetchImpl: jsonFetch({
        objects: [{ package: { name: 'fastify', version: '4.0.0', description: 'framework', links: { npm: 'https://npmjs.com/package/fastify' } }, score: { final: 0.9 } }],
      }),
    });
    const [r] = await p.search('fastify', ctx('fastify'));
    expect(strip(r?.title)).toBe('fastify (npm)');
  });

  it('pypi resolves an exact project name', async () => {
    const p = new PyPiProvider({
      fetchImpl: jsonFetch({ info: { name: 'requests', version: '2.32.0', summary: 'HTTP for Humans' } }),
    });
    const [r] = await p.search('requests', ctx('requests'));
    expect(strip(r?.title)).toBe('requests (PyPI)');
  });

  it('pypi returns nothing when the name does not resolve', async () => {
    const notFound = (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch;
    const p = new PyPiProvider({ fetchImpl: notFound });
    expect(await p.search('how to make coffee at home', ctx('how to make coffee at home'))).toEqual([]);
  });
});

describe('NominatimProvider', () => {
  it('runs for place-like queries', async () => {
    const p = new NominatimProvider({
      fetchImpl: jsonFetch([
        { place_id: 1, display_name: 'Paris, Île-de-France, France', lat: '48.85', lon: '2.35', type: 'city', importance: 0.9, osm_type: 'relation', osm_id: 7444 },
      ]),
    });
    const [r] = await p.search('where is Paris located', ctx('where is Paris located'));
    expect(r?.source).toBe('openstreetmap.org');
  });

  it('stays quiet for a clearly non-place query', async () => {
    const p = new NominatimProvider({ fetchImpl: jsonFetch([]) });
    expect(await p.search('javascript promises', ctx('javascript promises'))).toEqual([]);
  });
});

describe('security providers', () => {
  it('OSV resolves a CVE id', async () => {
    const p = new OsvProvider({
      fetchImpl: jsonFetch({
        id: 'CVE-2021-44228',
        summary: 'Log4Shell',
        aliases: ['GHSA-jfh8-c2jp-5v3q'],
        severity: [{ type: 'CVSS_V3', score: '10.0' }],
        references: [{ type: 'ADVISORY', url: 'https://logging.apache.org/log4j/2.x/security.html' }],
      }),
    });
    const [r] = await p.search('CVE-2021-44228', ctx('CVE-2021-44228'));
    expect(strip(r?.title)).toContain('CVE-2021-44228');
    expect(r?.tags).toContain('vulnerability');
  });

  it('OSV stays quiet without a vuln id', async () => {
    const p = new OsvProvider({ fetchImpl: jsonFetch({}) });
    expect(await p.search('web frameworks', ctx('web frameworks'))).toEqual([]);
  });

  it('NVD handles a keyword security query', async () => {
    const p = new NvdProvider({
      fetchImpl: jsonFetch({
        vulnerabilities: [
          {
            cve: {
              id: 'CVE-2021-44228',
              published: '2021-12-10T00:00:00',
              descriptions: [{ lang: 'en', value: 'Apache Log4j2 JNDI features...' }],
              metrics: { cvssMetricV31: [{ cvssData: { baseScore: 10, baseSeverity: 'CRITICAL' } }] },
            },
          },
        ],
      }),
    });
    const [r] = await p.search('log4j vulnerability', ctx('log4j vulnerability'));
    expect(strip(r?.title)).toContain('CVE-2021-44228');
    expect(strip(r?.snippet)).toContain('CVSS 10');
  });

  it('CISA KEV filters the catalog by CVE', async () => {
    const p = new CisaKevProvider({
      fetchImpl: jsonFetch({
        vulnerabilities: [
          { cveID: 'CVE-2021-44228', vendorProject: 'Apache', product: 'Log4j', vulnerabilityName: 'Log4Shell', dateAdded: '2021-12-10', shortDescription: 'RCE via JNDI', knownRansomwareCampaignUse: 'Known' },
          { cveID: 'CVE-2020-0001', vendorProject: 'X', product: 'Y', vulnerabilityName: 'Z', dateAdded: '2020-01-01', shortDescription: 'other' },
        ],
      }),
    });
    const results = await p.search('CVE-2021-44228', ctx('CVE-2021-44228'));
    expect(results).toHaveLength(1);
    expect(results[0]?.tags).toContain('exploited-in-the-wild');
  });
});
