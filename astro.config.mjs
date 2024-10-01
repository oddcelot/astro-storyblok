import { defineConfig, envField } from "astro/config"
import storyblok from '@storyblok/astro'
// import { loadEnv } from 'vite'
import tailwind from '@astrojs/tailwind'
import node from '@astrojs/node';
import mkcert from 'vite-plugin-mkcert'

// const env = loadEnv('', process.cwd(), 'STORYBLOK')



export default defineConfig({
  env: {
    schema: {
      // CLIENT_API_URL: envField.string({ context: "client", access: "public" }),
      // SERVER_API_URL: envField.string({ context: "server", access: "public" }),
      STORYBLOK_API_TOKEN: envField.string({ context: "server", access: "secret" }),
    }
  },
  integrations: [
    storyblok({
      //accessToken: env.STORYBLOK_TOKEN,
      accessToken: process.env.STORYBLOK_API_TOKEN,
      apiOptions: {
        region: 'eu',
      },
      livePreview: true,
      bridge: {
        customParent: 'https://app.storyblok.com',
      },
      components: {
        page: 'storyblok/Page',
        feature: 'storyblok/Feature',
        grid: 'storyblok/Grid',
        teaser: 'storyblok/Teaser',
      },
    }),
    tailwind(),
  ],

  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),

  vite: {
    plugins: [mkcert()],
  },
})
