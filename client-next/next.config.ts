import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Socket.IO polling must keep its trailing slash without an HTTP redirect.
  skipTrailingSlashRedirect: true,
  // Browser sessions allow up to 300 seconds; leave time to return timeout diagnostics.
  experimental: { proxyTimeout: 360_000 },
  // API 代理到后端 NestJS
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
      {
        source: '/aihot-skill',
        destination: `${apiUrl}/aihot-skill`,
      },
      {
        source: '/socket.io',
        destination: `${apiUrl}/socket.io/`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${apiUrl}/socket.io/:path*`,
      },
    ];
  },

  // 输出配置（Docker 优化）
  output: 'standalone',

  // 图片配置
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
    unoptimized: process.env.NODE_ENV === 'development',
  },

  // 生产优化
  compress: true,
  poweredByHeader: false,

  // 完全禁用所有开发指示器
  devIndicators: false,
};

export default nextConfig;
