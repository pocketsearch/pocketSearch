import tls from 'node:tls';
import type { PeerCertificate } from 'node:tls';
import type { TlsInfo } from './types.js';

function formatDn(dn: Record<string, string | string[]> | undefined): string | undefined {
  if (!dn) return undefined;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(dn)) {
    for (const value of Array.isArray(v) ? v : [v]) parts.push(`${k}=${value}`);
  }
  return parts.join(', ') || undefined;
}

function keyType(cert: PeerCertificate): string | undefined {
  if (cert.pubkey && cert.bits) {
    // `asn1Curve` / `nistCurve` are present for EC keys on modern Node.
    const curve = (cert as unknown as { nistCurve?: string }).nistCurve;
    return curve ? `EC ${curve}` : `RSA ${cert.bits}`;
  }
  return cert.bits ? `RSA ${cert.bits}` : undefined;
}

export interface TlsLookupOptions {
  timeoutMs: number;
  port?: number;
}

/**
 * Connect to `host:443`, complete the TLS handshake, and summarise the leaf
 * certificate the server presents. This is the same certificate any browser
 * receives — no probing beyond a standard connection.
 */
export function inspectTls(host: string, opts: TlsLookupOptions): Promise<TlsInfo> {
  const port = opts.port ?? 443;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (info: TlsInfo) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* already closed */
      }
      resolve(info);
    };

    const timer = setTimeout(
      () => finish({ available: false, error: `timed out after ${opts.timeoutMs}ms`, altNames: [] }),
      opts.timeoutMs,
    );

    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, ALPNProtocols: ['h2', 'http/1.1'] },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || Object.keys(cert).length === 0) {
          finish({ available: false, error: 'no certificate presented', altNames: [] });
          return;
        }
        const validTo = cert.valid_to ? new Date(cert.valid_to) : undefined;
        const daysUntilExpiry = validTo
          ? Math.round((validTo.getTime() - Date.now()) / 86_400_000)
          : undefined;
        finish({
          available: true,
          subject: formatDn(cert.subject as unknown as Record<string, string | string[]>),
          issuer: formatDn(cert.issuer as unknown as Record<string, string | string[]>),
          altNames: (cert.subjectaltname ?? '')
            .split(',')
            .map((s) => s.trim().replace(/^DNS:/, ''))
            .filter(Boolean),
          validFrom: cert.valid_from ? new Date(cert.valid_from).toISOString() : undefined,
          validTo: validTo?.toISOString(),
          daysUntilExpiry,
          protocol: socket.getProtocol() ?? undefined,
          keyType: keyType(cert),
          serialNumber: cert.serialNumber,
        });
      },
    );

    socket.on('error', (err: Error) => finish({ available: false, error: err.message, altNames: [] }));
  });
}
