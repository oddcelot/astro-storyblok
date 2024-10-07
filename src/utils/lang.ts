import {
  languages,
  default_lang_name,
} from "../../languages.305914.json" assert { type: "json" };

export type Language = {
  code: string;
  name: string;
};

export const allLanguages = [
  ...languages,
  { code: "en", name: default_lang_name },
];

export function getLangFromSlug(slug: string): Language {
  const slugParts = slug.split("/");
  return (
    languages.find((lang) => lang.code === slugParts[0]) || {
      code: "en",
      name: default_lang_name,
    }
  );
}
