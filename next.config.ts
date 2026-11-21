import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Task 29 — security headers (แผน Modernization บทที่ 9.1 ฉบับปรับให้เหมาะกับ Next.js)
  // - Permissions-Policy เปิด microphone+camera เฉพาะ origin ตัวเอง (AI Voice + ถ่ายบัตรในสนาม)
  // - ไม่ใส่ CSP เต็มรูปใน dev (inline script ของ Next.js dev/HMR จะพัง)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), microphone=(self), camera=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
