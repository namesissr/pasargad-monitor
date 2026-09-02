/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // خروجی سرور مستقل تا ایمیج داکر سبک بماند
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
