import { defineConfig, envField } from "astro/config";
import storyblok from "@storyblok/astro";
import tailwind from "@astrojs/tailwind";
import node from "@astrojs/node";
import mkcertPlugin from "vite-plugin-mkcert";
import { debarrelPlugin } from "./vite-plugin-debarrel";
import { loadEnv } from "vite";

const env = loadEnv("", process.cwd(), "STORYBLOK");

export default defineConfig({
  env: {
    schema: {
      STORYBLOK_API_TOKEN: envField.string({
        context: "server",
        access: "secret",
      }),
      STORYBLOK_PREVIEW: envField.boolean({
        context: "server",
        access: "public",
        default: false,
      }),
    },
  },

  integrations: [
    storyblok({
      accessToken: env.STORYBLOK_API_TOKEN,
      apiOptions: {
        region: "eu",
      },
      livePreview: true,
      bridge: env.STORYBLOK_PREVIEW,
      // contentLayer: true,
      enableFallbackComponent: true,
      customFallbackComponent: "storyblok/Fallback",
      components: {
        page: "storyblok/Page",
        feature: "storyblok/Feature",
        grid: "storyblok/Grid",
        teaser: "storyblok/Teaser",
      },
    }),
    tailwind(),
  ],

  output: "server",
  adapter: node({
    mode: "standalone",
  }),

  vite: {
    plugins: [mkcertPlugin(), debarrelPlugin()],
  },
});
