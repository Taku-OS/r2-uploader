/** Only Workers' authenticated media-input routes may access this namespace. */
const PRIVATE_MEDIA_PREFIX = 'private/media-inputs/v1'

function hasPrivatePrefix(key: string): boolean {
  return key === PRIVATE_MEDIA_PREFIX || key.startsWith(`${PRIVATE_MEDIA_PREFIX}/`)
}

function isPrivatePath(key: string): boolean {
  const slashed = key.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '')
  // Check both the literal R2 key and its normalized path. R2 itself does not
  // normalize dot segments, but clients, routers and gateways can.
  if (hasPrivatePrefix(slashed)) return true
  const segments: string[] = []
  for (const segment of slashed.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return hasPrivatePrefix(segments.join('/'))
}

export function isPrivateMediaKey(key: string): boolean {
  let candidate = key
  for (let round = 0; round < 8; round++) {
    if (isPrivatePath(candidate)) return true
    // Decode ASCII escapes even when unrelated malformed/UTF-8 escapes exist.
    // Never decode into the storage key: this is a deny-only comparison.
    const decoded = candidate.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    if (decoded === candidate) return false
    candidate = decoded
  }
  // Refuse excessively nested encodings rather than allow a decoding bypass.
  return isPrivatePath(candidate) || /%[0-9a-f]{2}/i.test(candidate)
}
