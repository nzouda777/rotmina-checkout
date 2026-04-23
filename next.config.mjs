/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['*'],
  experimental: {
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      {
        source: '/pay/:sessionId',
        destination: '/checkout/:sessionId',
        permanent: true,
      },
    ]
  },
}

export default nextConfig
