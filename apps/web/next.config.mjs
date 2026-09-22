/** @type {import('next').NextConfig} */

// Where the Next server forwards /api/* requests. Inside Docker Compose this is
// the backend service; for local dev it defaults to localhost.
const API_PROXY_URL = process.env.API_PROXY_URL || 'http://localhost:5050';

const nextConfig = {
  reactStrictMode: true,
  // 'standalone' builds the Docker server bundle. Netlify's Next runtime does
  // not support it and falls back to broken static hosting, so it is skipped
  // there (Netlify sets NETLIFY=true in its build environment).
  ...(process.env.NETLIFY === 'true' ? {} : { output: 'standalone' }),
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_PROXY_URL}/api/:path*` }];
  },
};

export default nextConfig;
