import type { NextConfig } from 'next';
import { networkInterfaces } from 'node:os';

const configuredDevOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS || '100.83.173.93')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const interfaceDevOrigins = Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .flatMap(({ address, family }) =>
    address.includes('%')
      ? []
      : family === 'IPv6'
        ? [address, `[${address}]`]
        : [address],
  );
const allowedDevOrigins = [...new Set([...configuredDevOrigins, ...interfaceDevOrigins])];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    agentUpgrade: 'security',
  },
  // These are browser hostnames, not the server's 0.0.0.0 bind address.
  allowedDevOrigins,
  ...(process.env.FABRIC_TEST_ISOLATED === '1' ? { devIndicators: false as const } : {}),
  distDir: process.env.FABRIC_TEST_ISOLATED === '1' ? (process.env.FABRIC_TEST_BUILD_DIR || '.next-isolated') : '.next',
};

export default nextConfig;
