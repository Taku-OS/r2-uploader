import {Hono} from 'hono'
import {cors} from 'hono/cors'

import Get from './routes/get'
import Patch from './routes/patch'
import Put from './routes/put'
import Delete from "./routes/delete"

import MpuCreate from './routes/mpu/create'
import MpuParts from './routes/mpu/parts'
import MpuAbort from './routes/mpu/abort'
import MpuComplete from './routes/mpu/complete'
import MpuSupport from './routes/mpu/support'

import checkHeader from "./middleware/checkHeader"
import protectPrivateMedia from './middleware/protectPrivateMedia'

const app = new Hono<{
  Bindings: {
    R2_BUCKET: R2Bucket
  }
}>()

app.use(cors())
app.get('/support_mpu', MpuSupport)
app.get('/', (c) => c.text('Hello R2! v2025.01.13'))
// HEAD is rejected by legacy auth before GET fallback runs. Guard it here too,
// without changing ordinary HEAD/auth behavior or revealing private metadata.
app.on(['GET', 'HEAD'], '/:key{.*}', protectPrivateMedia)
app.use('*', checkHeader)

// multipart upload operations
app.post('/mpu/create/:key{.*}', protectPrivateMedia, MpuCreate)
app.put('/mpu/:key{.*}', protectPrivateMedia, MpuParts)
app.delete('/mpu/:key{.*}', protectPrivateMedia, MpuAbort)
app.post('/mpu/complete/:key{.*}', protectPrivateMedia, MpuComplete)

// normal r2 operations
app.get('/:key{.*}', Get)
app.patch('/', Patch)
app.put('/:key{.*}', protectPrivateMedia, Put)
app.delete('/:key{.*}', protectPrivateMedia, Delete)

app.all('*', c => {
  return c.text('404 Not Found')
})

export default app
