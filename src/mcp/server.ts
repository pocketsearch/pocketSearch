import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Config } from '../core/config.js';
import { decodeAge } from '../core/plate/age.js';
import { classifyPlate, formatPlate, normalizePlate } from '../core/plate/format.js';
import { createPlateChecker } from '../core/plate/index.js';
import { lookupMemoryTag } from '../core/plate/regions.js';
import { createReconRunner } from '../core/recon/index.js';
import { geolocateIp } from '../core/recon/ipgeo.js';
import { BeaconClient } from './beacon-client.js';

export interface BuildMcpServerOptions {
  config: Config;
  beaconApiUrl: string;
  version: string;
  fetchImpl?: typeof fetch;
}

type ToolText = {
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(data: unknown): ToolText {
  const structured =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { result: data };
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: structured,
  };
}

function fail(message: string): ToolText {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/**
 * Build the Beacon MCP server: number-plate tools (in-process) plus search-index
 * tools that proxy to a running Beacon Search HTTP API.
 */
export function buildMcpServer(options: BuildMcpServerOptions): McpServer {
  const { config, beaconApiUrl, version, fetchImpl } = options;
  const checker = createPlateChecker(config, fetchImpl);
  // Reuse the checker's provider instances (one MOT OAuth token cache, etc.).
  const { vehicle: vesProvider, mot: motProvider } = checker.providers;
  const reconRunner = createReconRunner(config, { fetchImpl });
  const beacon = new BeaconClient(beaconApiUrl, fetchImpl);

  const server = new McpServer(
    { name: 'beacon-search', version },
    {
      instructions:
        'Tools for UK number-plate analysis (offline format/age/region plus optional ' +
        'DVLA and DVSA lookups), passive reconnaissance on a domain / IP / URL (DNS, ' +
        'RDAP/WHOIS, TLS, security headers, tech fingerprint, robots, crt.sh subdomains, ' +
        'IP geolocation), and searching / adding documents in a running Beacon Search instance.',
    },
  );

  const plateArg = z
    .string()
    .min(1)
    .max(16)
    .describe('A UK vehicle registration mark, e.g. "AB12 CDE"');

  server.registerTool(
    'check_number_plate',
    {
      title: 'Check a UK number plate',
      description:
        'Run all automatic checks on a registration mark: format validation, age identifier, ' +
        'region of registration, and (when API credentials are configured) DVLA tax/MOT status ' +
        'and DVSA MOT history. Returns a structured report with per-check pass/warn/fail status.',
      inputSchema: {
        plate: plateArg,
        includeVehicleData: z
          .boolean()
          .optional()
          .describe('Query the DVLA Vehicle Enquiry Service (default true)'),
        includeMotHistory: z
          .boolean()
          .optional()
          .describe('Query the DVSA MOT History API (default true)'),
        referenceDate: z
          .string()
          .datetime()
          .optional()
          .describe('Evaluate as if checked on this ISO date/time'),
      },
    },
    async (args) => {
      try {
        const check = await checker.check(args.plate, {
          includeVehicleData: args.includeVehicleData,
          includeMotHistory: args.includeMotHistory,
          referenceDate: args.referenceDate,
        });
        return ok(check);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'validate_plate_format',
    {
      title: 'Validate plate format',
      description:
        'Offline check of whether a string is a structurally valid UK registration mark.',
      inputSchema: { plate: plateArg },
    },
    async (args) => {
      const normalized = normalizePlate(args.plate);
      const classification = classifyPlate(normalized);
      return ok({
        input: args.plate,
        normalized,
        formatted: formatPlate(normalized, classification.format),
        ...classification,
      });
    },
  );

  server.registerTool(
    'decode_plate',
    {
      title: 'Decode plate age and region',
      description:
        'Offline decode of a plate: the registration date range from the age identifier and the ' +
        'DVLA office / region from the memory tag. No external calls.',
      inputSchema: { plate: plateArg },
    },
    async (args) => {
      const normalized = normalizePlate(args.plate);
      const { format, valid } = classifyPlate(normalized);
      const age = decodeAge(normalized, format, new Date());
      const region = format === 'current' ? lookupMemoryTag(normalized.slice(0, 2)) : null;
      return ok({ normalized, format, valid, age, region });
    },
  );

  server.registerTool(
    'dvla_vehicle_enquiry',
    {
      title: 'DVLA Vehicle Enquiry Service lookup',
      description:
        'Fetch make, colour, year, fuel type, tax status and MOT status for a registration from ' +
        'the DVLA VES API. Requires DVLA_VES_API_KEY.',
      inputSchema: { plate: plateArg },
    },
    async (args) => {
      if (!vesProvider?.configured) return fail('DVLA_VES_API_KEY is not configured');
      const result = await vesProvider.lookup(normalizePlate(args.plate));
      return result.ok ? ok(result.data) : fail(result.message ?? result.reason ?? 'lookup failed');
    },
  );

  server.registerTool(
    'mot_history',
    {
      title: 'DVSA MOT history lookup',
      description:
        'Fetch the full MOT test history (results, mileage, defects) for a registration from the ' +
        'DVSA MOT History API. Requires MOT_CLIENT_ID / MOT_CLIENT_SECRET / MOT_API_KEY / MOT_TOKEN_URL.',
      inputSchema: { plate: plateArg },
    },
    async (args) => {
      if (!motProvider?.configured)
        return fail('DVSA MOT History API credentials are not configured');
      const result = await motProvider.lookup(normalizePlate(args.plate));
      return result.ok ? ok(result.data) : fail(result.message ?? result.reason ?? 'lookup failed');
    },
  );

  server.registerTool(
    'recon_target',
    {
      title: 'Passive recon on a domain, IP, or URL',
      description:
        'Run every passive-recon check for a target: DNS (A/AAAA/MX/NS/TXT + SPF/DMARC), ' +
        'RDAP/WHOIS registration, the served TLS certificate, HTTP security-header grade and ' +
        'technology fingerprint, robots.txt / sitemap.xml, crt.sh subdomains, and IP ' +
        'geolocation. Public sources only — no port scanning or probing. Returns a structured ' +
        'report with per-check pass/warn/fail findings.',
      inputSchema: {
        target: z.string().min(1).max(2048).describe('A domain, IP address, or full URL'),
        includeRegistration: z.boolean().optional().describe('RDAP/WHOIS lookup (default true)'),
        includeTls: z.boolean().optional().describe('TLS certificate inspection (default true)'),
        includeHttp: z.boolean().optional().describe('HTTP header grade + fingerprint (default true)'),
        includeRobots: z.boolean().optional().describe('robots.txt / sitemap.xml (default true)'),
        includeSubdomains: z.boolean().optional().describe('crt.sh subdomains (default true)'),
        includeIpGeo: z.boolean().optional().describe('IP geolocation (default true)'),
      },
    },
    async (args) => {
      try {
        const report = await reconRunner.run(args.target, {
          includeRegistration: args.includeRegistration,
          includeTls: args.includeTls,
          includeHttp: args.includeHttp,
          includeRobots: args.includeRobots,
          includeSubdomains: args.includeSubdomains,
          includeIpGeo: args.includeIpGeo,
        });
        return ok(report);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'geolocate_ip',
    {
      title: 'Geolocate a public IP address',
      description:
        'Resolve country / region / city / ASN / ISP for a public IP address using no-key ' +
        'providers (ipwho.is, ipapi.co). Private and reserved addresses are refused.',
      inputSchema: { ip: z.string().min(1).max(64).describe('A public IPv4 or IPv6 address') },
    },
    async (args) => {
      try {
        return ok(await geolocateIp(args.ip.trim(), { timeoutMs: config.recon.timeoutMs, fetchImpl }));
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'beacon_search',
    {
      title: 'Search the Beacon index',
      description: 'Full-text search against a running Beacon Search instance.',
      inputSchema: {
        query: z.string().describe('Search query (blank returns the newest documents)'),
        limit: z.number().int().min(1).max(50).optional(),
        tags: z.array(z.string()).optional().describe('Only return documents with all these tags'),
        source: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return ok(
          await beacon.search({
            q: args.query,
            limit: args.limit,
            tags: args.tags,
            source: args.source,
          }),
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'beacon_index_document',
    {
      title: 'Add a document to the Beacon index',
      description: 'Create or replace a document in a running Beacon Search instance.',
      inputSchema: {
        title: z.string().min(1),
        body: z.string().default(''),
        url: z.string().url().optional(),
        tags: z.array(z.string()).optional(),
        source: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return ok(await beacon.addDocument(args));
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'beacon_stats',
    {
      title: 'Beacon index statistics',
      description: 'Document counts, top tags and sources from a running Beacon Search instance.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await beacon.stats());
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );

  return server;
}
