import type { NextConfig } from "next";

// Next.js injects inline bootstrap scripts, so script-src needs 'unsafe-inline'
// (nonce-based CSP would force dynamic rendering everywhere via proxy.ts).
// This still blocks foreign script origins, data exfiltration to unlisted
// hosts, framing, and plugin content. Dev mode needs 'unsafe-eval' for React's
// error-stack reconstruction; production does not.
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';
const posthogAssets = posthogHost.replace('//us.i.', '//us-assets.i.');
const isDev = process.env.NODE_ENV === 'development';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} ${posthogAssets}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://tiles.stadiamaps.com ${posthogHost}`,
  `connect-src 'self' ${posthogHost} ${posthogAssets}`,
  "font-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
