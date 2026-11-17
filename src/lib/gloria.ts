// Gloria backend client.
//
// The token travels in the Authorization header, never in the URL. A URL can
// end up in error text, logs and proxies; a header does not.
//
// Callers of this agent never see upstream error bodies or exception text.
// The agent framework returns `err.message` to the caller, so every error
// thrown from here carries a generic message only. The detail goes to the
// server log, redacted.

export class UpstreamError extends Error {
  constructor(readonly status: number | null) {
    super(
      status == null
        ? "Upstream request failed"
        : `Upstream request failed (status ${status})`
    );
    this.name = "UpstreamError";
  }
}

const REDACTIONS: Array<[RegExp, string]> = [
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@"],
  [
    /([?&](?:token|api_key|apikey|key|access_token|secret|password|auth)=)[^&\s"']+/gi,
    "$1[REDACTED]",
  ],
  [/(\bbearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]"],
];

export function redact(input: unknown): string {
  let s = String(input ?? "");
  for (const [re, rep] of REDACTIONS) s = s.replace(re, rep);
  return s;
}

export type GloriaConfig = {
  apiUrl: string | undefined;
  apiToken: string | undefined;
  fetchImpl?: typeof fetch;
};

export async function gloriaFetch(
  cfg: GloriaConfig,
  path: string,
  params: Record<string, string>
): Promise<unknown> {
  if (!cfg.apiUrl || !cfg.apiToken) {
    console.error(
      "[gloria] GLORIA_API_URL and GLORIA_API_TOKEN_DEV must be set in .env"
    );
    throw new UpstreamError(null);
  }

  const url = new URL(path, cfg.apiUrl);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }

  const doFetch = cfg.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${cfg.apiToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err: any) {
    console.error(
      `[gloria] GET ${path} failed: ${redact(err?.message ?? err).slice(0, 300)}`
    );
    throw new UpstreamError(null);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      `[gloria] GET ${path} status ${res.status}: ${redact(body).slice(0, 300)}`
    );
    throw new UpstreamError(res.status);
  }

  try {
    return await res.json();
  } catch {
    console.error(`[gloria] GET ${path} returned a body that is not JSON`);
    throw new UpstreamError(res.status);
  }
}

/**
 * Wrap an entrypoint handler so an unexpected exception reaches the caller
 * as "Internal error". UpstreamError messages are already generic.
 */
export function safeHandler<C, R>(
  name: string,
  handler: (ctx: C) => Promise<R>
): (ctx: C) => Promise<R> {
  return async (ctx: C) => {
    try {
      return await handler(ctx);
    } catch (err: any) {
      if (err instanceof UpstreamError) throw err;
      console.error(
        `[gloria] entrypoint ${name} failed: ${redact(err?.message ?? err).slice(0, 300)}`
      );
      throw new Error("Internal error");
    }
  };
}
