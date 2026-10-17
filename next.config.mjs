/** @type {import('next').NextConfig} */
export default {
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ['@prisma/client', 'adm-zip', '@node-rs/argon2', 'pino'],
  },
};
