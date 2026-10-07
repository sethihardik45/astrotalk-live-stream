import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy: tells the browser what this site is allowed to load or connect to. It is a second line of defence
 * (if a script ever got injected, it could not send data to arbitrary servers or load code from elsewhere).
 *
 * Notes:
 *  - 'unsafe-inline' scripts are needed by Next.js's own page bootstrap; 'unsafe-eval' only in development.
 *  - connect-src allows any TLS (wss:/https:) address because the LiveKit server address is configuration, not code. Plain
 *    http:/ws: are blocked in production.
 *  - It is NOT applied to /egress-layout: LiveKit's recorder gives that page its own server address, which we cannot predict,
 *    and a too-strict rule there would silently break the Instagram picture. That page holds no secrets and no login.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  `connect-src 'self' wss: https:${isDev ? " ws: http:" : ""}`,
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // Personal links are secrets: never send them to another site as a "referrer".
          { key: "Referrer-Policy", value: "no-referrer" },
          // Camera + microphone allowed for OUR OWN origin only; everything else switched off.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), display-capture=()" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
      { source: "/((?!egress-layout).*)", headers: [{ key: "Content-Security-Policy", value: csp }] },
    ];
  },
};

export default nextConfig;
