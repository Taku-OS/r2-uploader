This is an example worker for the R2 Uploader, you can use the code in the `./dist` folder directly, or build the code yourself.

### Requirements

- Node.js installed (v16 +)

### How to use

1. Clone this repository
   ```shell
   git clone https://github.com/jw-12138/r2-uploader-example-worker.git
   ```
2. Install the dependencies
   ```shell
    npm install
   ```
   
3. Edit `wrangler.toml`, change `r2_buckets -> bucket_name` to your own bucket name

4. Deploy the code
   ```shell
   npm run deploy
   ```
5. Push your API key
   ```shell
   npx wrangler secret put AUTH_KEY_SECRET
   ```

   This command will prompt you input the value, press `Enter` to confirm.

And that's it, your worker is now ready to be used in R2 Uploader.

### Taku private media boundary

`private/media-inputs/v1/` in the shared `taku` bucket is reserved for the
authenticated Taku Workers image-input service. Every legacy object and multipart
route rejects this namespace, including when the caller has the uploader API key.
Object listings omit its objects and prefixes. Ordinary public files and other
namespaces retain their existing behavior. The check also rejects encoded,
backslash, duplicate-slash and dot-segment aliases; excessively nested encodings
fail closed. Keys used for ordinary storage operations are never rewritten.

Run `bun install --frozen-lockfile` followed by `bun run test`
(which rebuilds `dist/worker.js` first). The same request matrix checks the
TypeScript entry and the distributable Worker bundle using an in-memory R2 stub.
No tests read or mutate Cloudflare resources. `bun run build` updates the checked-in
bundle for consumers which use `dist/worker.js` directly. The deployed source entry
remains `src/index.ts` from `wrangler.toml`.

Taku production changes use the existing Git-connected Cloudflare Workers Builds
pipeline for `Taku-OS/r2-uploader` / `main`; do not run the example manual deploy
commands above for Taku production. After merging, verify the build's source
commit and deployed version. Before enabling media intake, verify both
`user-content.taku.ai` and `r2-uploader.takuos.workers.dev` reject private keys,
ordinary public files still work, and the bucket has no direct public-domain
bypass. This code does not configure bucket lifecycle, secrets or public domains.
