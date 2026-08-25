/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  serverRuntimeConfig: {
    apiUrl: process.env.API_URL || 'http://localhost:3000',
  },
  publicRuntimeConfig: {
    apiUrl: process.env.API_URL || 'http://localhost:3000',
  },
  // Allow multiple hosts for reverse proxy setups
  ...(process.env.NODE_ENV === 'production' && {
    async headers() {
      return [];
    },
  }),
};

module.exports = nextConfig;
