import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(process.env.FABRIC_TEST_ISOLATED === '1' ? { devIndicators: false as const } : {}),
  distDir: process.env.FABRIC_TEST_ISOLATED === '1' ? (process.env.FABRIC_TEST_BUILD_DIR || '.next-isolated') : '.next',
};

export default nextConfig;
