import { type NextRequest } from 'next/server';
import { proxyEbird } from '@/lib/ebird-proxy';

interface RawTaxonEntry {
  speciesCode?: string;
  comName?: string;
  sciName?: string;
  category?: string;
  bandingCodes?: string[];
}

export async function GET(request: NextRequest) {
  // Full eBird taxonomy (~11k species after filtering). Changes once a year —
  // cache a month. Stripped server-side from ~5.9 MB to ~1.3 MB.
  return proxyEbird(request, {
    upstreamPath: '/ref/taxonomy/ebird?fmt=json',
    sMaxAge: 2_592_000,
    staleWhileRevalidate: 2_592_000,
    transform: (data) => {
      if (!Array.isArray(data)) return [];
      return (data as RawTaxonEntry[])
        .filter(
          (e) =>
            e.category === 'species' &&
            typeof e.speciesCode === 'string' &&
            typeof e.comName === 'string' &&
            typeof e.sciName === 'string'
        )
        .map((e) => ({
          speciesCode: e.speciesCode,
          comName: e.comName,
          sciName: e.sciName,
          bandingCodes: e.bandingCodes ?? [],
        }));
    },
  });
}
