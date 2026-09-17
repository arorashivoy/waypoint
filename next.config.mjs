/** @type {import('next').NextConfig} */
export default {
  experimental: { serverComponentsExternalPackages: ['@prisma/client', 'adm-zip'] },
};
