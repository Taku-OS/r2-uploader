import {describe, expect, test} from 'bun:test'
import source from '../src/index'
import bundle from '../dist/worker.js'
import {isPrivateMediaKey} from '../src/privateMedia'

const root = 'https://uploader.test'
const secret = 'test-only-uploader-key'
const protectedKey = 'private/media-inputs/v1/production/test-input'

const privateVariants = [
  protectedKey,
  'private/media-inputs/v1',
  'private/media-inputs/v1/',
  encodeURIComponent(protectedKey),
  encodeURIComponent(encodeURIComponent(protectedKey)),
  '%70rivate/media-inputs/v1/production/input',
  'private%252fmedia-inputs%252fv1%252fproduction%252finput',
  '%2570rivate/media-inputs/v1/production/input',
  'private%25%32%66media-inputs%25%32%66v1/input',
  'private%5cmedia-inputs%5cv1%5cproduction%5cinput',
  'private%255cmedia-inputs%255cv1%255cproduction%255cinput',
  'private//media-inputs///v1/production/input',
  '%2fprivate/media-inputs/v1/production/input',
  '%2e%2fprivate/media-inputs/v1/production/input',
  'public%2f..%2fprivate/media-inputs/v1/production/input',
  'private%2fplaceholder%2f..%2fmedia-inputs/v1/input',
  encodeURIComponent('private/media-inputs/v1/../../public-file'),
  'private/media-inputs/v1/production/%FF%broken',
  Array.from({length: 12}).reduce<string>(value => encodeURIComponent(value), protectedKey),
]

const publicKeys = [
  'uploads/existing.png',
  'private/other/existing.png',
  'private/media-inputs/v10/existing.png',
  'private/media-inputs/v1-public.png',
  'private/media-inputs/v2/existing.png',
  'public/private/media-inputs/v1/existing.png',
  'PRIVATE/media-inputs/v1/existing.png',
]

function fakeEnvironment() {
  const calls: Array<{operation: string; key?: string; options?: unknown}> = []
  const object = {
    key: 'uploads/existing.png',
    body: 'public bytes',
    httpEtag: '"public-etag"',
    writeHttpMetadata(headers: Headers) { headers.set('content-type', 'image/png') },
  }
  const env = {
    AUTH_KEY_SECRET: secret,
    R2_BUCKET: {
      async get(key: string) { calls.push({operation: 'get', key}); return object },
      async put(key: string) { calls.push({operation: 'put', key}) },
      async delete(key: string) { calls.push({operation: 'delete', key}) },
      async createMultipartUpload(key: string) {
        calls.push({operation: 'createMultipartUpload', key})
        return {key, uploadId: 'test-upload'}
      },
      resumeMultipartUpload(key: string, uploadId: string) {
        calls.push({operation: 'resumeMultipartUpload', key, options: {uploadId}})
        return {
          async uploadPart() { calls.push({operation: 'uploadPart', key}); return {partNumber: 1, etag: 'part'} },
          async complete() { calls.push({operation: 'complete', key}); return object },
          async abort() { calls.push({operation: 'abort', key}) },
        }
      },
      async list(options: unknown) {
        calls.push({operation: 'list', options})
        return {
          objects: [...publicKeys, ...privateVariants].map(key => ({key, size: 4})),
          delimitedPrefixes: ['uploads/', 'private/media-inputs/v1/', '%70rivate/media-inputs/v1/', 'private/other/'],
          truncated: true,
          cursor: 'opaque-next-page',
        }
      },
    },
  }
  return {env, calls}
}

const routes = [
  {name: 'GET', method: 'GET', path: (key: string) => `/${key}`, operation: 'get', status: 200},
  // Legacy HEAD auth returns a bodyless response without accessing R2.
  {name: 'HEAD', method: 'HEAD', path: (key: string) => `/${key}`, operation: null, status: 200},
  {name: 'PUT', method: 'PUT', path: (key: string) => `/${key}`, operation: 'put', status: 200},
  {name: 'DELETE', method: 'DELETE', path: (key: string) => `/${key}`, operation: 'delete', status: 204},
  {name: 'MPU create', method: 'POST', path: (key: string) => `/mpu/create/${key}`, operation: 'createMultipartUpload', status: 200},
  {name: 'MPU part', method: 'PUT', path: (key: string) => `/mpu/${key}?uploadId=test-upload&partNumber=1`, operation: 'uploadPart', status: 200},
  {name: 'MPU complete', method: 'POST', path: (key: string) => `/mpu/complete/${key}?uploadId=test-upload`, operation: 'complete', status: 200},
  {name: 'MPU abort', method: 'DELETE', path: (key: string) => `/mpu/${key}?uploadId=test-upload`, operation: 'abort', status: 204},
]

function request(path: string, method = 'GET', authenticated = true) {
  return new Request(root + path, {
    method,
    headers: {
      ...(authenticated ? {'x-api-key': secret} : {}),
      'content-type': 'application/json',
    },
    ...(['POST', 'PUT'].includes(method) ? {body: JSON.stringify({parts: [{partNumber: 1, etag: 'part'}]})} : {}),
  })
}

const applications = [['source', source], ['dist bundle', bundle]] as const
// Optional: validate the actual Wrangler/esbuild dry-run artifact with exactly
// the same cases, without contacting Cloudflare or creating a remote version.
const wranglerBundle = process.env.UPLOADER_TEST_WRANGLER_BUNDLE
const targets = wranglerBundle
  ? [...applications, ['Wrangler bundle', (await import(wranglerBundle)).default] as const]
  : applications

for (const [name, app] of targets) {
  describe(name, () => {
    for (const route of routes) {
      test(`${route.name} cannot access private inputs even with the uploader key`, async () => {
        for (const key of privateVariants) {
          const {env, calls} = fakeEnvironment()
          const response = await app.fetch(request(route.path(key), route.method), env)
          expect({status: response.status, calls, key}).toEqual({status: 404, calls: [], key})
        }
      })

      test(`${route.name} preserves ordinary keys and neighboring namespaces`, async () => {
        for (const key of publicKeys) {
          const {env, calls} = fakeEnvironment()
          const response = await app.fetch(request(route.path(key), route.method), env)
          expect(response.status).toBe(route.status)
          if (route.operation) expect(calls).toContainEqual({operation: route.operation, key})
          else expect(calls).toEqual([])
        }
      })
    }

    test('listing hides only private objects and prefixes without losing the cursor', async () => {
      const {env, calls} = fakeEnvironment()
      const response = await app.fetch(request('/?cursor=previous-page', 'PATCH'), env)
      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result.objects.map((object: {key: string}) => object.key)).toEqual(publicKeys)
      expect(result.delimitedPrefixes).toEqual(['uploads/', 'private/other/'])
      expect(result.truncated).toBe(true)
      expect(result.cursor).toBe('opaque-next-page')
      expect(calls).toEqual([{operation: 'list', options: {cursor: 'previous-page'}}])
    })

    test('an entirely private page remains empty but retains the continuation cursor', async () => {
      const {env} = fakeEnvironment()
      env.R2_BUCKET.list = async () => ({objects: [{key: protectedKey, size: 4}], delimitedPrefixes: [], truncated: true, cursor: 'next'})
      const response = await app.fetch(request('/', 'PATCH'), env)
      expect(await response.json()).toEqual({objects: [], delimitedPrefixes: [], truncated: true, cursor: 'next'})
    })

    test('anonymous private GET/HEAD do not read the bucket; public GET still works', async () => {
      const {env, calls} = fakeEnvironment()
      for (const method of ['GET', 'HEAD']) {
        expect((await app.fetch(request(`/${protectedKey}`, method, false), env)).status).toBe(404)
      }
      expect(calls).toEqual([])
      const response = await app.fetch(request('/uploads/existing.png', 'GET', false), env)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('public bytes')
      expect(calls).toEqual([{operation: 'get', key: 'uploads/existing.png'}])
    })

    test('unauthorized writes/listing keep the existing authorization behavior', async () => {
      const {env, calls} = fakeEnvironment()
      for (const method of ['PUT', 'DELETE', 'PATCH', 'POST']) {
        const response = await app.fetch(request(method === 'PATCH' ? '/' : '/uploads/existing.png', method, false), env)
        expect((await response.json()).message).toBe('Unauthorized')
      }
      expect(calls).toEqual([])
    })

    test('health and multipart capability discovery still work', async () => {
      const {env, calls} = fakeEnvironment()
      expect(await (await app.fetch(request('/', 'GET', false), env)).text()).toBe('Hello R2! v2025.01.13')
      expect(await (await app.fetch(request('/support_mpu', 'GET', false), env)).text()).toBe('yes')
      expect(calls).toEqual([])
    })
  })
}

test('literal R2 keys, malformed escapes and nested encodings fail closed only as needed', () => {
  for (const key of privateVariants) expect(isPrivateMediaKey(key)).toBe(true)
  for (const key of [...publicKeys, 'uploads/%FF%broken.png', 'uploads/a%20b.png']) {
    expect(isPrivateMediaKey(key)).toBe(false)
  }
})
