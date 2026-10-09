// The version shown in the sidebar is major.minor from package.json: bump the minor number (1.1, 1.2, ...) for a
// small update, and the major number (2.0, 3.0, ...) for a large one. Patch is not shown.
const [vMajor, vMinor] = require("./package.json").version.split(".");

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: `v${vMajor}.${vMinor}` },
  images: {
    remotePatterns: [],
  },
  experimental: {
    serverComponentsExternalPackages: ["xlsx"],
  },
  experimental: {
    serverComponentsExternalPackages: ["xlsx", "canvas"],
  },
};

module.exports = nextConfig;
