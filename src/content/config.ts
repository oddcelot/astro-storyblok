import { defineCollection } from "astro:content";
import { storyblokLoader } from "@storyblok/astro";

import { STORYBLOK_API_TOKEN } from "astro:env/server";

const storyblokCollection = defineCollection({
  loader: storyblokLoader({
    accessToken: STORYBLOK_API_TOKEN,
    apiOptions: {
      region: "eu",
    },
    version: "published",
  }),
});

export const collections = {
  storyblok: storyblokCollection,
};
