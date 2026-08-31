# Security Policy

## Supported versions

The latest released version on the `main` branch is supported.

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub Security Advisories
("Report a vulnerability" on the repository's _Security_ tab) rather than opening
a public issue. You will receive an acknowledgement within a few days.

## Deployment notes

Beacon Search ships with **no authentication**. The write endpoints
(`POST/PUT/DELETE /api/documents`, `/api/crawl`, `/api/index/clear`) are open to
anyone who can reach the port. When exposing it beyond localhost:

- Put it behind a reverse proxy that enforces authentication / rate limiting, or
  restrict network access to trusted clients.
- Set `BEACON_CORS_ORIGIN` to the specific origins that need browser access.
- The built-in crawler performs outbound HTTP requests to user-supplied URLs.
  By default `POST /api/crawl` refuses loopback / private / link-local hosts
  (resolved via DNS, fail-closed) to limit SSRF. Set
  `BEACON_CRAWL_ALLOW_PRIVATE=true` only when the endpoint is trusted, e.g. for
  indexing an intranet. The `beacon crawl` CLI is operator-run and always allows
  private hosts.
