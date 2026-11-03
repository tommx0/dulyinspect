// Preloaded into storage-api (node --require): its file backend stores Content-Type, Cache-Control and ETag as extended
// attributes (xattr). Some storage cannot do that (Docker Desktop on a Mac: virtiofs with no_xattr, SMB/NFS shares), and then
// every upload fails with ENOTSUP. If FILE_STORAGE_BACKEND_PATH has no xattr support, this module keeps the attributes as JSON
// in a parallel tree (/data/storage-xattr/<path>.json) and moves them along on rename/unlink/rmdir.
// XATTR_FALLBACK=force always uses the fallback (smoke test). With xattr support, metadata kept earlier in storage-xattr (data moved
// from storage without xattr) is still read for files that have no attribute of their own.
'use strict'
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const Module = require('node:module')

const ROOT = path.resolve(process.env.FILE_STORAGE_BACKEND_PATH || '/data/storage')
const STORE = path.resolve(process.env.XATTR_FALLBACK_PATH || `${ROOT}-xattr`)
const native = Module.createRequire(path.join(process.cwd(), 'package.json'))('fs-xattr')

function withoutXattr() {
  if (process.env.XATTR_FALLBACK === 'force') return true
  const probe = path.join(ROOT, `.xattr-probe-${process.pid}`)
  try {
    fs.writeFileSync(probe, '')
    native.setAttributeSync(probe, 'user.instance.probe', '1')
    return false
  } catch (e) {
    return e.code === 'ENOTSUP' || e.code === 'EOPNOTSUPP'
  } finally {
    try { fs.unlinkSync(probe) } catch { /* nothing created */ }
  }
}

if (withoutXattr()) {
  console.log(`Storage path ${ROOT} has no extended attributes: file metadata in ${STORE}`)

  // Store file for a file below ROOT; outside ROOT null (then fs-xattr behaves as usual)
  const storeFile = (file) => {
    const rel = path.relative(ROOT, path.resolve(String(file)))
    return !rel || rel.startsWith('..') || path.isAbsolute(rel) ? null : path.join(STORE, `${rel}.json`)
  }
  const read = (s) => { try { return JSON.parse(fs.readFileSync(s, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return {}; throw e } }
  const write = (s, values) => {
    if (!Object.keys(values).length) { try { fs.unlinkSync(s) } catch (e) { if (e.code !== 'ENOENT') throw e } return }
    fs.mkdirSync(path.dirname(s), { recursive: true })
    const tmp = `${s}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(values))
    fs.renameSync(tmp, s)
  }
  const missing = () => Object.assign(new Error('attribute not found'), { code: 'ENODATA' })
  const asBuffer = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(String(v)))

  const fallback = {
    getAttributeSync(file, attr) {
      const s = storeFile(file); if (!s) return native.getAttributeSync(file, attr)
      if (!fs.existsSync(file)) throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' })
      const v = read(s)[attr]; if (v === undefined) throw missing()
      return Buffer.from(v, 'base64')
    },
    setAttributeSync(file, attr, value) {
      const s = storeFile(file); if (!s) return native.setAttributeSync(file, attr, value)
      const values = read(s); values[attr] = asBuffer(value).toString('base64'); write(s, values)
    },
    removeAttributeSync(file, attr) {
      const s = storeFile(file); if (!s) return native.removeAttributeSync(file, attr)
      const values = read(s); if (!(attr in values)) throw missing()
      delete values[attr]; write(s, values)
    },
    listAttributesSync(file) {
      const s = storeFile(file); if (!s) return native.listAttributesSync(file)
      return Object.keys(read(s))
    },
  }
  for (const n of ['getAttribute', 'setAttribute', 'removeAttribute', 'listAttributes']) {
    fallback[n] = async (...args) => fallback[`${n}Sync`](...args)
  }

  const load = Module._load
  Module._load = function (request, ...rest) {
    return request === 'fs-xattr' ? fallback : load.call(this, request, ...rest)
  }

  // Attributes follow the file: rename (uploads go through a staging file), delete, remove empty folders
  const { rename, unlink, rmdir } = fsp
  fsp.rename = async (from, to) => {
    await rename(from, to)
    const sf = storeFile(from); const st = storeFile(to)
    if (!sf || !st) return
    try {
      await fsp.mkdir(path.dirname(st), { recursive: true })
      await rename(sf, st)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      await unlink(st).catch(() => {}) // target without attributes: drop stale data of an overwritten file
    }
  }
  fsp.unlink = async (file) => {
    await unlink(file)
    const s = storeFile(file); if (s) await unlink(s).catch(() => {})
  }
  fsp.rmdir = async (dir, ...rest) => {
    await rmdir(dir, ...rest)
    const rel = path.relative(ROOT, path.resolve(String(dir)))
    if (rel && !rel.startsWith('..')) await rmdir(path.join(STORE, rel)).catch(() => {})
  }
} else if (fs.existsSync(STORE) && fs.readdirSync(STORE).length) {
  const getNative = native.getAttributeSync
  const storeFile = (file) => {
    const rel = path.relative(ROOT, path.resolve(String(file)))
    return !rel || rel.startsWith('..') || path.isAbsolute(rel) ? null : path.join(STORE, `${rel}.json`)
  }
  const earlier = (file, attr) => {
    const s = storeFile(file); if (!s) return undefined
    try { return JSON.parse(fs.readFileSync(s, 'utf8'))[attr] } catch { return undefined }
  }
  const withEarlier = {
    ...native,
    getAttributeSync(file, attr) {
      try { return getNative(file, attr) } catch (e) {
        const v = (e.code === 'ENODATA' || e.code === 'ENOATTR') ? earlier(file, attr) : undefined
        if (v === undefined) throw e
        return Buffer.from(v, 'base64')
      }
    },
  }
  withEarlier.getAttribute = async (...args) => withEarlier.getAttributeSync(...args)
  const load = Module._load
  Module._load = function (request, ...rest) {
    return request === 'fs-xattr' ? withEarlier : load.call(this, request, ...rest)
  }
}
