/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    const internalApi = process.env.EMAIL_PLATFORM_INTERNAL_API_URL ??
      `http://127.0.0.1:${process.env.NODE_ENV === "production" ? "4100" : "4000"}`;
    const publicApi = process.env.EMAIL_PLATFORM_PUBLIC_API_INTERNAL_URL ??
      `http://127.0.0.1:${process.env.NODE_ENV === "production" ? "4105" : "4001"}`;
    return {
      beforeFiles: [
        { source: "/api/:path*", destination: `${internalApi}/api/:path*` },
        { source: "/public/:path*", destination: `${publicApi}/public/:path*` },
        { source: "/unsubscribe", destination: `${publicApi}/unsubscribe` },
        { source: "/unsubscribe/:path*", destination: `${publicApi}/unsubscribe/:path*` },
        { source: "/t/:path*", destination: `${publicApi}/t/:path*` },
        { source: "/health", destination: `${publicApi}/health` },
        { source: "/health/:path*", destination: `${publicApi}/health/:path*` },
      ],
    };
  }
};
export default nextConfig;
