// The version shown in the sidebar comes from package.json: the first number goes up for a large update, the second for a
// medium one, and a third number is added for a small one (3.2, then 3.2.1, 3.2.2, ...). A trailing ".0" is not shown.
const appVersion = require("./package.json").version.replace(/\.0$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: `v${appVersion}` },
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
