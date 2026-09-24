/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    const internalApi = process.env.EMAIL_PLATFORM_INTERNAL_API_URL ??
      `http://127.0.0.1:${process.env.NODE_ENV === "production" ? "4100" : "4000"}`;
    return [{ source: "/api/:path*", destination: `${internalApi}/api/:path*` }];
  }
};
export default nextConfig;
