# Passive recon

Beacon Search can profile a domain, IP address, or URL from information the host
publishes to anyone. It is **passive**: DNS lookups, one TLS handshake, RDAP /
`whois`, `crt.sh` certificate-transparency logs, and ordinary GET requests for
`robots.txt` / the page. No port scanning, no authentication, no vulnerability
probing.

## What it checks

| Check          | Source                                             | Notes                                                              |
| -------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| DNS            | DNS-over-HTTPS (Cloudflare `1.1.1.1`)             | A/AAAA/MX/NS/TXT/CNAME/SOA, plus SPF and DMARC (`_dmarc.<domain>`) |
| Registration   | RDAP (`rdap.org` bootstrap) → registry RDAP; `whois` fallback | Registrar, dates, statuses, nameservers, DNSSEC          |
| TLS            | The certificate the server serves on :443         | Issuer, validity window, SANs, protocol, key type                 |
| HTTP           | One browser-style GET                              | Security-header grade (A–F), `Server` / `X-Powered-By`, tech fingerprint |
| robots/sitemap | `/robots.txt`, first `sitemap.xml`                | `Disallow` list (sensitive paths flagged), sitemap URL count      |
| Subdomains     | `crt.sh`                                           | Hostnames seen in certificate-transparency logs                   |
| IP geolocation | `ipwho.is`, `ipapi.co` fallback                    | Country/region/city/ASN/ISP for the target or its resolved IPs    |

Every check runs in parallel with its own timeout and full error isolation — a
failing check is recorded in `errors[]` and the rest of the report is still
returned. Targets that resolve to a private / loopback / reserved address are
refused unless `BEACON_RECON_ALLOW_PRIVATE=1` (the CLI always allows them, since a
local operator runs it).

## Use it

**REST**

```
GET /api/recon?target=example.com
GET /api/recon?target=8.8.8.8&subdomains=0&tls=0
GET /api/recon?target=https://site.tld&index=1      # also store the report
```

**CLI**

```bash
beacon recon example.com
beacon recon 1.1.1.1 --json
beacon recon example.com --no-subdomains --index
```

**Web UI** — the *Recon* tab.

**MCP** — the `recon_target` and `geolocate_ip` tools (see [mcp.md](mcp.md)).

## Configuration

| Variable                           | Default | Purpose                                              |
| ---------------------------------- | ------- | --------------------------------------------------- |
| `BEACON_RECON_ENABLED`             | `true`  | Master switch for the toolset and `/api/recon`      |
| `BEACON_RECON_TIMEOUT_MS`          | `8000`  | Per-check base timeout (slow sources get a buffer)  |
| `BEACON_RECON_ALLOW_PRIVATE`       | `false` | Allow targets on private / loopback addresses       |
| `BEACON_RECON_WHOIS`               | `true`  | Permit the system `whois` binary as an RDAP fallback |
| `BEACON_RECON_MAX_GEO_IPS`         | `3`     | How many resolved IPs to geolocate for a domain     |
| `BEACON_RECON_INDEX_RESULTS`       | `false` | Index every completed report as a document          |
