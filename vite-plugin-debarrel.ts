import fs from 'node:fs/promises';

import MagicString, {type SourceMap} from 'magic-string';
import pkg, { type ParseResult, type ExportSpecifier} from 'rs-module-lexer';
const  {parse}  = pkg;
import type {Plugin, TransformResult} from 'vite';
import type {PluginContext} from 'rollup';

interface DebarrelPluginOptions {
  include?: (RegExp | string)[];
  possibleBarrelFiles?: (RegExp | string)[];
}

type Modifications = [start: number, end: number, replace: string][];

interface SimpleParseResult {
  imports: ParseResult['imports'];
  exports: ParseResult['exports'];
  facade: boolean;
}

interface ImportName {
  imported: string;
  local?: string;
}

interface ResolvedSource {
  id: string;
  exportName?: string;
  aliasedImportName?: string;
  resolved?: boolean;
}

interface DebarrelContext {
  resolve: PluginContext['resolve'];

  /** Temporarily stores file contents to reduce/dedupe readFile calls */
  fileCache: Map<string, Promise<string>>;

  /**
   * Cached rs-module-lexer parse results for raw file contents keyed by id/filename.
   *
   * @note This cache *must not* contain parsed results of code given to the `transform()` hook, as
   * that code can be (and occasionally is) different from disk source due to `load()` interception.
   * It would also be unnecessary since `transform()` itself is cached.
   */
  parseCache: Map<string, SimpleParseResult>;
}

const IS_SOURCE_EXT = /\.tsx?(?:\?.*)?$/;

/**
 * Returns true if the given id is source code (eg: TypeScript).
 */
function isSourceFile(id: string) {
  return IS_SOURCE_EXT.test(id);
}

/**
 * Check if the given id is one that will never be treated as a Barrel File.
 */
function isIgnoredModule(id: string) {
  return (
    // pre-built / npm modules:
    id.includes('/build/cache/vite/') ||
    id.includes('/node_modules/')
  );
}

const POSSIBLE_BARREL_SPECIFIER = /(?:\.ts|\/index\.tsx)(?:\?.*)?$/;

/**
 * Check if the given id is a possible Barrel file and should be parsed
 */
function isPossibleBarrelSpecifier(id: string, options: DebarrelPluginOptions) {
  // we never debarrel npm/internal modules
  if (isIgnoredModule(id)) return false;

  // Only consider `*.ts` or `index.tsx` as potential Barrel Files:
  if (POSSIBLE_BARREL_SPECIFIER.test(id)) {
    return true;
  }

  if (options.possibleBarrelFiles) {
    return options.possibleBarrelFiles.some((pattern) => id.match(pattern));
  }

  return false;
}

const IS_EXPORT_PREFIXED = /^\s*export/;

/**
 * Determines whether the given source text is an import or export statement.
 */
function getDeclarationKind(specifiers: string) {
  return IS_EXPORT_PREFIXED.test(specifiers) ? 'export' : 'import';
}

/**
 * Parses the given code and returns the result.
 * This method is just a cached version of safeParse().
 *
 * This method *must not* be used to parsed code given to the `transform()` hook, as that
 * code can be (and occasionally is) different from disk source due to `load()` interception.
 */
function parsePotentialBarrelFile(
  context: DebarrelContext,
  id: string,
  code: string,
) {
  const cached = context.parseCache.get(id);
  if (cached != null) return cached;

  const parsed = safeParse(id, code);
  context.parseCache.set(id, parsed);

  return parsed;
}

const EMPTY_PARSE_RESULT = {
  imports: [],
  exports: [],
  facade: false,
};

/**
 * Parses the given code and returns the result.
 * If parsing fails, returns an empty result.
 *
 * This method can be used both for code obtained via transform() or raw file contents.
 */
function safeParse(id: string, code: string): SimpleParseResult {
  try {
    return parse({
      input: [
        {
          filename: id,
          code,
        },
      ],
    }).output[0];
  } catch (err) {
    console.warn(`[vite-debarrel] Failed to parse ${id}:\n  ${err.message}`);
    return EMPTY_PARSE_RESULT;
  }
}

/** Cached readFile */
function readFile(context: DebarrelContext, id: string) {
  const cached = context.fileCache.get(id);
  if (cached != null) return cached;

  const promise = fs.readFile(id, 'utf8');
  context.fileCache.set(id, promise);
  return promise;
}

/**
 * Given the source text of an import statement, returns a list of its {local,imported} names.
 */
function getImportNames(specifiers: string): ImportName[] {
  const defaultImportRegex = /^(?:import|export)\s+([a-zA-Z0-9_$]+)/;
  const leadingTrailingDefaultRegex =
    /(?:([a-z0-9_$]+)\s*,\s*\{|\}\s*,\s*([a-z0-9_$]+))/i;
  const importNamesTokenizer =
    /[{,]\s*(type\s+)?([a-z0-9_$]+)(?:\s+as\s+([a-z0-9_$]+))?/gi;
  importNamesTokenizer.lastIndex = 0;

  const names: ImportName[] = [];
  if (specifiers.includes('*')) return names;

  // Default export/import (e.g. `import x from './x'`)
  if (!specifiers.includes('{')) {
    const defaultMatch = specifiers.match(defaultImportRegex);
    if (defaultMatch) {
      names.push({imported: 'default', local: defaultMatch[1]});
    }
    return names;
  }

  // Default export/import mixed with named imports (e.g. `import x, {y} from './x'`)
  const defaultMatch = specifiers.match(leadingTrailingDefaultRegex);
  if (defaultMatch) {
    names.push({
      imported: 'default',
      local: defaultMatch[1] || defaultMatch[2],
    });
  }

  // Named imports (e.g. `import {x} from './x'`) and handles aliased imports (e.g. `import {x as y} from './x'`)
  let token: RegExpExecArray | null;
  while ((token = importNamesTokenizer.exec(specifiers))) {
    // ignore types
    if (token[1]) continue;
    names.push({
      imported: token[2],
      local: token[3],
    });
  }
  return names;
}

/**
 * Finds the import matching import associated with the given export specifier.
 */
function findMatchingImport(
  exp: ExportSpecifier,
  imports: ParseResult['imports'],
  code: string,
) {
  let localExportName = exp.ln;

  // find the import that wraps this exported name
  //   e.g.: `export {x} from './x'`
  let imp = imports.find(
    (imp) => imp.ss < exp.s && imp.se > exp.e && imp.d === -1,
  );

  // exportName not found in imports, so search elsewhere
  if (!imp || !imp.n) {
    // localExportName takes precedence
    // if no localExportName, search for default export
    //   e.g.: `import {x} from 'y';export default x`
    const ln =
      localExportName ||
      code
        .slice(exp.s)
        .match(/default\s+([a-zA-Z_$][a-zA-Z0-9_$]*)(?:;|\n|$)/)?.[1];

    if (ln) {
      imp = imports.find((imp) => {
        const names = getImportNames(code.slice(imp.ss, imp.s));
        const spec = names.find((spec) => spec.local === ln);
        if (spec) localExportName = spec.imported;
        return spec;
      });
    }
  }

  // Handle case: `export {default as foo} from 'bar'`
  // (es-module-lexer returns `ln:undefined` for this case)
  if (imp && !localExportName) {
    const slice = code.slice(imp.ss, exp.s);
    // Unoptimizable: `export * as x from 'x'`
    if (!slice.includes('*')) {
      const ln = slice.match(/([a-zA-Z0-9$_]+)\s*as\s*$/)?.[1];
      if (ln) localExportName = ln;
    }
  }

  // imp !== undefined and localExportName !== undefined
  //    exported from module (e.g. export {x} from 'y')
  // imp === undefined and localExportName !== undefined
  //    exported directly from module (e.g. function, const, etc.)
  // imp === undefined and localExportName === undefined
  //    no matching import found
  return {imp, localExportName};
}

/**
 * Crawl through barrel files to find source export.
 * Returns the deepest exported source found.
 */
async function resolveThroughBarrel(
  context: DebarrelContext,
  id: string,
  exportName: string,
  options: DebarrelPluginOptions,
): Promise<ResolvedSource> {
  const {resolve} = context;
  const code = await readFile(context, id);
  const {imports, exports} = parsePotentialBarrelFile(context, id, code);

  // Limiting debarrelling to only pure facades means not resolving through modules with types or async components.
  // While this is the fundamentally correct approach, reduces the benefits of debarrelling in our app.
  // if (!facade) {
  //   return {exportName, id, resolved: false};
  // }

  for (const exp of exports) {
    const exported = exp.n;

    // we're looking for a specific export
    if (exported !== exportName) continue;

    const matchingImport = findMatchingImport(exp, imports, code);
    const {imp, localExportName} = matchingImport;

    // no matching import found for this export
    if (!imp || !imp.n) return {exportName, id, resolved: true};

    // dynamic import: terminate resolution at this module
    if (imp.d > -1) return {exportName, id, resolved: true};

    let aliasedImportName: string | undefined;
    const specifiers = code.slice(imp.ss, exp.s);

    // source import is aliased
    if (
      getDeclarationKind(specifiers) === 'import' &&
      /\bas\b/.test(specifiers)
    ) {
      const regex = new RegExp(`(\\w+)\\s+as\\s+${exportName}`);
      aliasedImportName = specifiers.match(regex)?.[0];
    }

    const resolvedId = (await resolve(imp.n, id))?.id;
    if (!resolvedId)
      return {
        exportName: localExportName,
        id,
        aliasedImportName,
        resolved: false,
      };

    if (isPossibleBarrelSpecifier(resolvedId, options)) {
      return resolveThroughBarrel(
        context,
        resolvedId,
        localExportName || exported,
        options,
      );
    }

    return {
      exportName: localExportName || exportName,
      id: resolvedId,
      aliasedImportName,
      resolved: false,
    };
  }

  // Attempt to resolve through wildcards.
  const wildcards = imports.filter((imp) =>
    /^export\s+\*(?!\s+as)/.test(code.slice(imp.ss, imp.s)),
  );
  if (wildcards.length === 1) {
    const resolveId = (await resolve(wildcards[0].n!, id))?.id;
    if (!resolveId) return {exportName, id, resolved: false};

    // attempt to resolve via the barrel, otherwise fall back to _this_ module.
    // this avoids incorrect resolution of `x` from `export*from'y';export const x=1;`
    const inner = await resolveThroughBarrel(
      context,
      resolveId,
      exportName,
      options,
    );
    if (inner.resolved) return inner;
  } else if (wildcards.length > 1) {
    // note: multiple wildcard re-exports require complete traversal and may not be worthwhile (YMMV).
    const ret = await Promise.all(
      wildcards.map(async (wc) => {
        const resolveId = (await resolve(wc.n!, id))?.id;
        if (!resolveId) return;

        return resolveThroughBarrel(context, resolveId, exportName, options);
      }),
    );

    const selected = ret.find((wc) => wc?.resolved);
    if (selected) return selected;
  }

  // if we got here, there was no export with the requested name
  return {exportName, id, resolved: false};
}

/**
 * Returns the declaration clause for the given import name.
 */
function getDeclarationClause(
  resolvedSource: ResolvedSource,
  importName: ImportName,
  declarationKind: 'import' | 'export',
) {
  const {exportName, aliasedImportName} = resolvedSource;
  const local = importName.local || importName.imported;

  if (aliasedImportName) {
    return `{${aliasedImportName}}`;
  }

  if (exportName === 'default' && declarationKind !== 'export') {
    return local;
  }

  const isLocallyAliased = exportName !== local;
  return `{${isLocallyAliased ? `${exportName} as ${local}` : exportName}}`;
}

/**
 * Returns resolved "barrel" file modifications for the given id.
 */
async function getDebarrelModifications(
  context: DebarrelContext,
  id: string,
  code: string,
  options: DebarrelPluginOptions,
) {
  const modifications: Modifications = [];

  const {resolve} = context;
  const {imports} = safeParse(id, code);

  await Promise.all(
    imports.map(async (imp) => {
      if (!imp.n || imp.d !== -1) return;

      const specifiers = code.slice(imp.ss, imp.s);

      const importNames = getImportNames(specifiers);
      if (importNames.length === 0) return;

      const resolvedId = (await resolve(imp.n, id))?.id;
      if (!resolvedId) return;
      if (!isSourceFile(resolvedId)) return;
      if (isIgnoredModule(resolvedId)) return;

      const declarationKind = getDeclarationKind(specifiers);

      try {
        const replacements = await Promise.all(
          importNames.map(async (importName) => {
            const debarrelled = await resolveThroughBarrel(
              context,
              resolvedId,
              importName.imported,
              options,
            );

            if (!debarrelled) return;

            const declarationClause = getDeclarationClause(
              debarrelled,
              importName,
              declarationKind,
            );
            const moduleSpecifier = JSON.stringify(debarrelled.id);

            return `${declarationKind} ${declarationClause} from ${moduleSpecifier}`;
          }),
        );

        // if any of the imported names could not be resolved, leave the import untouched:
        if (replacements.includes(undefined)) return;

        modifications.push([imp.ss, imp.se, replacements.join(';')]);
      } catch (error) {
        console.warn(error);
      }
    }),
  );

  return modifications;
}

/**
 * Transforms the given code by applying a list of [start, end, code] replacements.
 * Replacements must be sorted in order of source position.
 */
function applyModifications(
  id: string,
  code: string,
  modifications: Modifications,
  sourceMap: boolean,
): TransformResult | undefined {
  if (modifications.length === 0) return;

  const out = new MagicString(code, {filename: id});

  for (const mod of modifications) {
    out.update(mod[0], mod[1], mod[2]);
  }

  return {
    code: out.toString(),
    map: sourceMap
      ? (out.generateMap({
          file: id,
        }) as SourceMap & {sourcesContent: string[]})
      : null,
  };
}

/**
 * Pre-resolve imports through "barrel" files.
 */
export function debarrelPlugin(options: DebarrelPluginOptions = {}): Plugin {
  let sourceMap = true;

  const fileCache: DebarrelContext['fileCache'] = new Map();
  const parseCache: DebarrelContext['parseCache'] = new Map();

  function purgeCaches() {
    fileCache.clear();
    parseCache.clear();
  }

  return {
    name: 'debarrel',

    // note: we enable this in prod too, where it nets ~15% size savings
    // apply: 'serve',

    // if source maps are explicitly disabled, don't generate them
    async configResolved(config) {
      if (config.build?.sourcemap === false) sourceMap = false;
    },

    // @note this is just watchChange(), but that plugin hook was only implemented in Vite 5.
    configureServer(server) {
      server.watcher.on('change', (filename) => {
        fileCache.delete(filename);
        parseCache.delete(filename);
      });
    },

    // Any time the build starts/ends or any file changes, wipe the cache.
    // This is acceptable because we only care about caching during the first graph load.
    buildStart: purgeCaches,
    buildEnd: purgeCaches,

    // if we already read in a file, give it to Vite to avoid reading it again
    load(id) {
      if (fileCache.has(id)) return fileCache.get(id);
    },

    async transform(code, id) {
      // only process TypeScript files
      if (!isSourceFile(id)) return;

      if (options.include) {
        if (!options.include.some((pattern) => id.match(pattern))) return;
      }

      const context = {
        resolve: this.resolve.bind(this),
        fileCache,
        parseCache,
      };
      const modifications = await getDebarrelModifications(
        context,
        id,
        code,
        options,
      );

      return applyModifications(id, code, modifications, sourceMap);
    },
  };
}
