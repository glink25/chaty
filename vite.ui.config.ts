import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// UI 库构建：把可复用的对话 UI 组件 + 自包含 CSS 一起产出，供 web 项目直接 import。
// 产物：dist/ui/index.js + dist/ui/index.css + dist/ui/index.d.ts。
// 必须在 vite.lib.config.ts（核心/provider，emptyOutDir 会清空 dist）之后运行。
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        // 逐文件产出 .d.ts（不做 bundle，避免 api-extractor 误判入口）。
        // 入口类型落在 dist/ui/ui/index.d.ts，整棵树在 dist/ui 内自包含、相对引用可解析。
        dts({
            tsconfigPath: "./tsconfig.app.json",
        }),
    ],
    resolve: {
        alias: {
            "@": resolve("./src"),
        },
    },
    build: {
        outDir: "dist/ui",
        // 只清空 dist/ui，不影响 dist/assistant 与 dist/providers。
        emptyOutDir: true,
        copyPublicDir: false,
        lib: {
            entry: resolve("./src/ui/index.ts"),
            formats: ["es"],
            fileName: "index",
        },
        rollupOptions: {
            // 运行时框架与 peerDependencies 由消费方提供，不打进库。
            // 核心（createSession 等）与 provider 适配器随 UI 一并打包（v1）。
            external: [
                "react",
                "react-dom",
                "react/jsx-runtime",
                "zod",
                "jsonrepair",
            ],
        },
    },
});
