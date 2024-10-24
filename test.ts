// import * as hono from 'https://esm.sh/hono';

// console.log(hono);

const importer = await import('bun-plugin-http-import')
const httpMod = await import('https://esm.sh/bun-plugin-http-import')

console.log(importer)
console.log(httpMod)