/**
 * OpenNext Cloudflare 适配器配置（必需文件，缺失会报
 * "No open-next.config.ts file was found in the project root"）。
 * defineCloudflareConfig 生成默认适配：路由静态化 + worker 入口。
 * 可选参数：
 *  - R2 incremental cache：需先创建 R2 bucket 并在 wrangler.jsonc 里绑定，
 *    再传入 { incrementalCache: r2IncrementalCacheBinding }；
 *  - KV tag cache：同理。本项目页面基本是动态代理路由，暂不需要。
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
