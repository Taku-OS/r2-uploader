import {Context} from "hono"
import {isPrivateMediaKey} from '../privateMedia'

export default async function (c: Context) {
  const cursor = c.req.query('cursor')
  const list = await c.env.R2_BUCKET.list({
    cursor: cursor || undefined
  })

  return c.json({
    ...list,
    objects: list.objects.filter((object: R2Object) => !isPrivateMediaKey(object.key)),
    delimitedPrefixes: (list.delimitedPrefixes ?? []).filter(
      (prefix: string) => !isPrivateMediaKey(prefix),
    ),
  })
}
