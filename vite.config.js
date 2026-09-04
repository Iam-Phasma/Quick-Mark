import { defineConfig } from "vite";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1] || "Quick-Mark";
const isCi = Boolean(process.env.GITHUB_ACTIONS);

export default defineConfig({
  base: isCi ? `/${repoName}/` : "/",
  build: {
    outDir: "dist",
  },
});
