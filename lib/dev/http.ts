/**
 * Shared response shape for every `/api/dev/*` handler.
 *
 * Spec §2 requires `/dev` and `/api/dev/*` to be `noindex`. `app/robots.ts`
 * disallows the paths, which stops a well-behaved crawler fetching them; this
 * header covers the crawler that fetched anyway, and the two fail in opposite
 * directions. A shared constant rather than five hand-copied header objects,
 * because five copies is exactly how one of them ends up missing the header —
 * the same drift argument `lib/marker-style.ts` and `lib/theme.ts`'s role layer
 * were introduced to settle.
 *
 * `no-store` on all of them is not a caching preference either. These responses
 * are per-session by definition; a shared cache holding one would hand a
 * developer's session state to the next visitor.
 */
export const DEV_ROUTE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

export function devJson(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return Response.json(body, {
    status,
    headers: { ...DEV_ROUTE_HEADERS, ...extra },
  });
}

/**
 * Read a JSON body without letting a malformed one throw into the handler.
 * Returns `undefined` rather than raising, so every caller decides what a
 * missing body means for itself.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
