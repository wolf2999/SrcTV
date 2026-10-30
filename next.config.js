/**
 * Next.js 配置。
 * 之前缺失导致 Cloudflare Workers（OpenNext）构建报
 * "Missing required next.config file"，本地 electron 打包流程也引用了它。
 * 保持空配置：Workers 部署不需要 standalone（OpenNext 自己处理产物），
 * Docker/electron 路线由各自脚本接管，不在此干扰。
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  // 封面图走代理原图，项目不开图片优化（README 部署说明一致）
  images: { unoptimized: true },
};

module.exports = nextConfig;
