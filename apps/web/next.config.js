/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: "http://localhost:3005/api/v1/:path*",
      },
      {
        source: "/candles",
        destination: "http://localhost:3005/candles",
      },
    ];
  },
};

export default nextConfig;
