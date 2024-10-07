import { useStoryblokApi } from "@storyblok/astro";
import { languages } from "./langs";
import isPreview from "./isPreview";

export default async function generateStaticPaths() {
  const storyblokApi = useStoryblokApi();
  const links = await storyblokApi.getAll("cdn/links", {
    version: isPreview() ? "draft" : "published",
  });
  let paths = [];
  links
    .filter((link) => !link.is_folder)
    .forEach((link: { slug: string }) => {
      languages.forEach((language) => {
        //This slug will be used for fetching data from storyblok
        let slug = link.slug === "home" ? undefined : link.slug;
        //This will be used for generating all the urls for astro
        let full_url = language === "en" ? slug : `${language}/${slug ?? ""}`;
        //This will let us change the url for diffrent versions
        let langSwitch = {};
        languages.forEach((lang) => {
          langSwitch = {
            ...langSwitch,
            [lang]: lang === "en" ? `/${slug ?? ""}` : `/${lang}/${slug ?? ""}`,
          };
        });
        paths.push({
          props: { language, slug, langSwitch },
          params: {
            slug: full_url,
          },
        });
      });
    });
  return paths;
}
