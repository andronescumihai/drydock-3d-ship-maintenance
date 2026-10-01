import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Content Security Policy.
 *
 * DryDock is a static front end: no API, no accounts, no third-party scripts,
 * fonts or images (everything is self-hosted). So the policy can be tight —
 * the page may load code and assets only from its own origin, talk to nothing
 * else, and cannot be framed by another site.
 *
 * Two allowances are deliberate:
 *  - `script-src 'unsafe-inline'`: Next.js inlines its bootstrap and data
 *    scripts in the statically generated HTML. A nonce would need every page
 *    rendered per request, which gives up static hosting; with no user
 *    content ever written into the page there is nothing to inject into.
 *  - `style-src 'unsafe-inline'`: React `style` props and components that set
 *    inline styles (all of the HUD's motion) need it.
 * The development server additionally needs `eval` for fast refresh.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "worker-src 'self' blob:",
  "media-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // Clickjacking: no other site may put DryDock in a frame (legacy header too).
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The app needs none of these; say so, so no embedded content can ask.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],
  // Don't advertise the framework in every response.
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
