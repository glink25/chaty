import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// 库构建：导出核心（createSession 等）与 provider 层，供 web 项目直接 import，
// 无需经由 iframe。HTML/iframe 产物仍由默认的 vite.config.ts 负责。
export default defineConfig({
    plugins: [
        dts({
            tsconfigPath: "./tsconfig.app.json",
            entryRoot: "src",
            outDir: "dist",
            include: [
                "src/vite-env.d.ts",
                "src/assistant/**/*.ts",
                "src/providers/**/*.ts",
            ],
            // 产出与 JS 同名结构的 .d.ts（dist/assistant/index.d.ts 等）。
            rollupTypes: false,
        }),
    ],
    resolve: {
        alias: {
            "@": resolve("./src"),
        },
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        // 库构建不需要 public/（favicon 等仅属 HTML app）。
        copyPublicDir: false,
        lib: {
            entry: {
                // 入口名与 dts 输出路径（entryRoot=src）保持一致，
                // 让 dist/<dir>/index.js 与 dist/<dir>/index.d.ts 同名对应。
                "assistant/index": resolve("./src/assistant/index.ts"),
                "providers/index": resolve("./src/providers/index.ts"),
            },
            formats: ["es"],
        },
        rollupOptions: {
            // 运行时依赖由消费方提供（peerDependencies），不打进库。
            external: ["zod", "jsonrepair"],
        },
    },
});
