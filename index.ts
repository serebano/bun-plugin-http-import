import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { type BunPlugin } from "bun";
import pkg from './package.json'

const params: {
    [k: string]: any;
} = Object.fromEntries(new URL(import.meta.url).searchParams.entries())
params.type = params.type || 'global'
//
const dev = process.env.NODE_ENV === 'development'
const dir = '.import'
const cwd = process.cwd()
const type: 'local' | 'global' = params.type
const localPath = join(cwd, dir)
const globalPath = join(process.env.HOME!, dir)
//
const cacheLocalPath = join(localPath, 'cache')
const cacheGlobalPath = join(globalPath, 'cache')
//
const metaLocalPath = join(localPath, 'meta')
const metaGlobalPath = join(globalPath, 'meta')
//
const rootPath = type === 'local' ? localPath : globalPath
const cachePath = type === 'local' ? cacheLocalPath : cacheGlobalPath
const metaPath = type === 'local' ? metaLocalPath : metaGlobalPath
//
const tsConfigFilePath = cwd + '/tsconfig.json'
const jsConfigFilePath = cwd + '/jsconfig.json'
const bunConfigFilePath = cwd + '/bunfig.toml'
const statusFilePath = join(rootPath, 'status.json')

//
const rx_any = /./;
const rx_http = /^https?:\/\//;
const rx_relative_path = /^\.\.?\//;
const rx_absolute_path = /^\//;


export const plugin: BunPlugin = {
    name: "http-import",
    setup(builder) {
        builder.onResolve({ filter: rx_relative_path }, (args) => {
            if (rx_http.test(args.importer)) {
                return {
                    path: new URL(args.path, args.importer).href
                };
            }
        });

        builder.onResolve({ filter: rx_absolute_path }, (args) => {
            if (rx_http.test(args.importer)) {
                return {
                    path: new URL(args.path, args.importer).href
                };
            }
        });

        builder.onLoad({ filter: rx_any, namespace: "http" }, (args) => load("http:" + args.path));
        builder.onLoad({ filter: rx_any, namespace: "https" }, (args) => load("https:" + args.path));
    },
} satisfies BunPlugin


try {
    console.log(`${pkg.name} v${pkg.version} ${process.env.NODE_ENV ?? ''} (${type})`)

    await import(statusFilePath)
        .then(console.log)
        .catch(init)
        .finally(() => Bun.plugin(plugin))
} catch (err) {
    throw new Error(`Failed to load status file: ${statusFilePath}`)
}

export async function init(): Promise<any> {
    console.log(`\n\n\tInitializing (${type}) ${pkg.name} v${pkg.version}...\n\n`)

    await ensureBunfigPreload(bunConfigFilePath)
    await ensureCompilerOptionsPaths(tsConfigFilePath, cachePath)
    await Bun.write(statusFilePath, Response.json({
        status: 'success',
        version: pkg.version,
        timestamp: Date.now(),
        date: new Date().toUTCString(),
        rootPath,
        cachePath,
        metaPath
    }))

    return import(statusFilePath)
}

async function ensureBunfigPreload(bunConfigFilePath: string) {
    try {
        const { default: bunfig } = await import(bunConfigFilePath)
        console.log('bunfig exists', bunConfigFilePath, bunfig, bunfig.preload.includes(import.meta.url))
    } catch (err) {
        try {
            const preloadModule = 'bun-plugin-http-import' //import.meta.url
            await Bun.write(bunConfigFilePath, `preload = ["${preloadModule}"]`)
        } catch (err) {
            console.log('ensureBunfigPreload', err)
        }
    }
}

async function ensureCompilerOptionsPaths(tsConfigFilePath: string, cachePath: string, force: boolean = false) {
    // console.log(tsConfigFilePath)
    //@ts-ignore
    const getTsConfig = async (): Promise<any> => {
        try {
            return (await import(tsConfigFilePath)).default
        } catch (err) {
            await Bun.write(tsConfigFilePath, JSON.stringify({
                compilerOptions: {
                    module: "ESNext",
                    target: "ESNext",
                    moduleResolution: "Bundler",
                    allowImportingTsExtensions: true,
                    allowArbitraryExtensions: true,
                    noEmit: true,
                    strict: true,
                    //
                    "declaration": true,
                    "isolatedDeclarations": true,
                    "verbatimModuleSyntax": true,
                    "skipDefaultLibCheck": true,
                    "resolveJsonModule": true,
                    //
                    paths: {}
                }
            }, null, 4));
            return (await import(tsConfigFilePath)).default
        }
    }

    const tsconfig = await getTsConfig();
    const newTsconfig = { ...tsconfig }

    newTsconfig.compilerOptions.paths = newTsconfig.compilerOptions.paths || {} as any;
    const paths = newTsconfig.compilerOptions.paths;

    if (!paths["http://*"] || !paths["https://*"] || !paths['web:*'] || force) {
        paths["http://*"] = [cachePath.replace(cwd, '.') + '/http/*'];

        paths["https://*"] = [cachePath.replace(cwd, '.') + '/https/*'];

        paths["web:*"] = [...paths["http://*"], ...paths["https://*"]];

        await Bun.write(tsConfigFilePath, JSON.stringify(newTsconfig, null, 4));
    }

    // console.log(paths)
}

async function ensurePath(path: string) {
    try {
        await mkdir(path, { recursive: true });

        return path;
    } catch (err) {
        throw err;
    }
}

async function writeFile(path: string, contents: any) {
    try {
        const parentPath = path.split('/').slice(0, -1).join('/');
        await ensurePath(parentPath);

        return await Bun.file(path).text();
    } catch (error) {
        await Bun.write(path, contents, { createPath: true });
        return contents;
    }
}

async function createSymlink(a: string, b: string) {
    try {
        const { symlink } = await import('node:fs/promises');
        await symlink(a, b);
        console.log('Symlink created successfully!');
        console.log(`   from: ${a}`);
        console.log(`   to: ${b}`);
    } catch (err: any) {
        console.log(`Failed to create symlink: ${err.message}`);
        console.log(`   from: ${a}`);
        console.log(`   to: ${b}`);
    }
}

export async function linkGlobal() {
    await createSymlink(globalPath, localPath);
}


function urlToPath(input: string | URL, basePath: string): string {
    const url = new URL(input);
    const pathSegments = [basePath, url.protocol.slice(0, -1), url.hostname + (url.port ? `:${url.port}` : ''), ...url.pathname.split('/').filter(Boolean)];

    return pathSegments.join('/');
}

const typesCache = new Set<string>();

async function fetchTypes(typesUrl: string | URL) {
    if (typesCache.has(typesUrl.toString()))
        return;

    typesCache.add(typesUrl.toString());

    const typesFilePath = urlToPath(typesUrl, cachePath) //path.replace('.' + ext, '') + '.d.ts';
    const typesContents = await (await fetch(typesUrl)).text();

    // write
    await writeFile(typesFilePath, typesContents);

    // Handle imports
    const importRegex = /import\s+(type\s+)?(\{[^}]+\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(\{[^}]+\}|\w+))?\s+from\s+['"]([^'"]+)['"]/g
    const exportRegex = /export\s+(type\s+)?(\{[^}]+\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(\{[^}]+\}|\w+))?\s+from\s+['"]([^'"]+)['"]/g

    const importMatches = Array.from(typesContents.matchAll(importRegex))
    const exportMatches = Array.from(typesContents.matchAll(exportRegex))

    const files = new Set<string>();

    for (const [fullImport, isType, import1, import2, from] of importMatches) {
        if (from && from.startsWith('.')) {
            const url = new URL(from, typesUrl).toString()
            files.add(url)
        }
    }

    for (const [fullImport, isType, import1, import2, from] of exportMatches) {
        if (from && from.startsWith('.')) {
            const url = new URL(from, typesUrl).toString()
            files.add(url)
        }
    }

    for (const url of files) {
        await fetchTypes(url)
    }

}

function getPath(url: string | URL) {
    const path = urlToPath(url, cachePath);
    const ext = getExtension(String(url));

    return path.endsWith(ext) ? path : path + ext
}

function contentTypeToExt(contentType: string): Ext {
    const type = contentType.split(';')[0].trim().split('/').pop() as keyof typeof map;
    const map = {
        'json': '.json',
        'javascript': '.js',
        'typescript': '.ts',
        'text': '.txt',
        'html': '.html',
    } as const

    return map[type] || '.js';

}

async function load(url: string) {
    const meta = await getMeta(url);
    const now = Date.now();

    let redirectedFromUrl: string | null = null;
    const res = await fetch(url);

    if (!res.ok)
        throw new Error("Failed to load module '" + url + "': " + res.status + '  ' + res.statusText)

    if (res.redirected) {
        redirectedFromUrl = url;
        url = res.url;

    }

    const contentType = res.headers.get('Content-Type');
    const extension = getExtension(url);

    console.log({ url, contentType })

    if (contentType?.startsWith('application/json')) {
        const json = await res.json();
        const filePath = getPath(redirectedFromUrl || url);
        const contents = `export default ${JSON.stringify(json, null, 4)}`

        await writeFile(filePath, JSON.stringify(json, null, 4));

        return {
            // @ts-ignore
            contents,
            loader: 'js' as any,
            // exports: { ...contents, default: contents },
            // loader: 'object' as any
        }
    }

    if (redirectedFromUrl) {
        const redirectedFromPath = getPath(redirectedFromUrl);
        const contents = `export * from '${url}'`;
        await writeFile(redirectedFromPath, contents);

        return {
            contents,
            loader: 'tsx' as any
        }
    }

    const filePath = getPath(url);
    const xTypescriptTypes = res.headers.get('X-TypeScript-Types');

    console.log(url) // { url, filePath, redirectedFromUrl, xTypescriptTypes }

    if (xTypescriptTypes) {
        const typesIndexUrl = new URL(xTypescriptTypes, url)
        await fetchTypes(typesIndexUrl)

        const typesExt = getExtension(String(typesIndexUrl))
        const typesIndexPath = replaceExtension(filePath, typesExt)

        await writeFile(typesIndexPath, `export * from '${getPath(typesIndexUrl)}'`);

        console.log('\t(dts)', typesIndexPath.replace(cwd, ''))
    }


    // @ts-ignore
    const contents = await res.bytes() as Uint8Array
    await writeFile(filePath, contents);

    console.log('\t(mod)', filePath.replace(cwd, ''))

    return {
        contents,
        loader: 'tsx' as any
    }
}


type Meta = {
    url: string,
    extension: string,
    imports: string[],
    types: string,
    path: string,
    time: number
    ttl: number
}

function getMetaPath(url: string | URL): string {
    const urlHash = createHash("sha256").update(String(url)).digest("hex");

    return join(metaPath, urlHash + ".json");
}

async function getMeta(url: string | URL): Promise<Meta | null> {
    try {
        return await Bun.file(getMetaPath(url)).json();
    } catch {
        return null;
    }
}

async function setMeta(url: string | URL, meta: Meta): Promise<void> {
    await Bun.write(getMetaPath(url), JSON.stringify(meta), {
        createPath: true
    });
}

type Ext = ".d.ts" | ".ts" | ".d.mts" | ".mts" | ".d.cts" | ".cts" | ".tsx" | ".js" | ".mjs" | ".cjs" | ".jsx" | ".json" | ".txt" | ".html";
function getExtension(pathname: string, defaultExt: Ext = '.js'): Ext {
    const basename = pathname.substring(pathname.lastIndexOf("/") + 1);
    const dotIndex = basename.lastIndexOf(".");
    if (dotIndex === -1) {
        return defaultExt;
    }
    const ext = basename.substring(dotIndex + 1);
    switch (ext) {
        case "ts":
            return basename.endsWith(".d.ts") ? ".d.ts" : ".ts";
        case "mts":
            return basename.endsWith(".d.mts") ? ".d.mts" : ".mts";
        case "cts":
            return basename.endsWith(".d.cts") ? ".d.cts" : ".cts";
        case "tsx":
            return ".tsx";
        case "js":
            return ".js";
        case "mjs":
            return ".mjs";
        case "cjs":
            return ".cjs";
        case "jsx":
            return ".jsx";
        case "json":
            return ".json";
        default:
            return ".js";
    }
}

function replaceExtension(pathname: string, ext: string): string {
    const basename = pathname.substring(pathname.lastIndexOf("/") + 1);
    const dotIndex = basename.lastIndexOf(".");
    if (dotIndex === -1) {
        return pathname + ext;
    }
    return pathname.substring(0, pathname.length - basename.length) + basename.substring(0, dotIndex) + ext;
}

