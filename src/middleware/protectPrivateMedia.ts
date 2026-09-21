import type {Context, Next} from 'hono'
import {isPrivateMediaKey} from '../privateMedia'

export default async function protectPrivateMedia(c: Context, next: Next) {
  if (isPrivateMediaKey(c.req.param('key') ?? '')) {
    return c.text('Object Not Found', 404)
  }
  await next()
}
