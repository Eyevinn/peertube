// Maps OSC service configuration to PeerTube environment variables.
//
// Prints `export KEY='value'` lines on stdout (evaluated by osc-entrypoint.sh)
// and logs to stderr. Any PEERTUBE_* variable that is already set wins over
// the derived value, so every upstream option can still be overridden.

import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'

const env = process.env
const out = {}

const log = (msg) => process.stderr.write(`[osc-setup] ${msg}\n`)
const fail = (msg) => {
  log(`ERROR: ${msg}`)
  process.exit(1)
}
const set = (key, value) => {
  if (value === undefined || value === null || value === '') return
  if (env[key] !== undefined && env[key] !== '') return
  out[key] = String(value)
}
const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

// --- Network ---------------------------------------------------------------

set('PEERTUBE_LISTEN_HOSTNAME', '0.0.0.0')
set('PEERTUBE_LISTEN_PORT', env.PORT || '8080')

const publicHostname = env.OSC_HOSTNAME || env.PEERTUBE_WEBSERVER_HOSTNAME
if (!publicHostname) fail('OSC_HOSTNAME (or PEERTUBE_WEBSERVER_HOSTNAME) must be set')
set('PEERTUBE_WEBSERVER_HOSTNAME', publicHostname)
set('PEERTUBE_WEBSERVER_PORT', '443')
set('PEERTUBE_WEBSERVER_HTTPS', 'true')
// OSC terminates TLS in front of the container
set('PEERTUBE_TRUST_PROXY', '["loopback", "linklocal", "uniquelocal"]')

// --- Database --------------------------------------------------------------

if (!env.DATABASE_URL) fail('DATABASE_URL must be set (postgresql://user:password@host:port/db)')
const db = new URL(env.DATABASE_URL)
set('PEERTUBE_DB_HOSTNAME', db.hostname)
set('PEERTUBE_DB_PORT', db.port || '5432')
set('PEERTUBE_DB_USERNAME', decodeURIComponent(db.username))
set('PEERTUBE_DB_PASSWORD', decodeURIComponent(db.password))
set('PEERTUBE_DB_NAME', decodeURIComponent(db.pathname.replace(/^\//, '')) || 'peertube')
set('PEERTUBE_DB_SSL', ['require', 'verify-ca', 'verify-full'].includes(db.searchParams.get('sslmode')) ? 'true' : 'false')

// --- Redis / Valkey --------------------------------------------------------

if (!env.REDIS_URL) fail('REDIS_URL must be set (redis://[:password@]host:port[/db])')
const redis = new URL(env.REDIS_URL)
set('PEERTUBE_REDIS_HOSTNAME', redis.hostname)
set('PEERTUBE_REDIS_PORT', redis.port || '6379')
set('PEERTUBE_REDIS_AUTH', decodeURIComponent(redis.password))
set('PEERTUBE_REDIS_DB', redis.pathname.replace(/^\//, '') || undefined)
if (redis.protocol === 'rediss:') set('PEERTUBE_REDIS_ENABLE_TLS', 'true')

// --- Admin & instance ------------------------------------------------------

if (!env.ADMIN_EMAIL) fail('ADMIN_EMAIL must be set')
set('PEERTUBE_ADMIN_EMAIL', env.ADMIN_EMAIL)
set('PT_INITIAL_ROOT_PASSWORD', env.ADMIN_PASSWORD)
set('PEERTUBE_INSTANCE_NAME', env.INSTANCE_NAME)
set('PEERTUBE_SIGNUP_ENABLED', env.SIGNUP_ENABLED ? String(bool(env.SIGNUP_ENABLED, false)) : undefined)

if (env.PEERTUBE_SECRET) {
  // Already set, nothing to derive
} else if (env.SECRET) {
  set('PEERTUBE_SECRET', env.SECRET)
} else if (db.password) {
  // Keyed by the database password so it is not guessable from public data.
  // Stable across restarts, but changes if the database password is rotated.
  log('WARNING: SECRET not set, deriving one from the database credentials')
  const key = decodeURIComponent(db.password)
  set('PEERTUBE_SECRET', createHmac('sha256', key).update(`peertube-osc:${publicHostname}`).digest('hex'))
} else {
  fail('SECRET must be set (generate one with: openssl rand -hex 32)')
}

// --- SMTP ------------------------------------------------------------------

if (env.SMTP_HOST) {
  const port = env.SMTP_PORT || '587'
  set('PEERTUBE_SMTP_HOSTNAME', env.SMTP_HOST)
  set('PEERTUBE_SMTP_PORT', port)
  set('PEERTUBE_SMTP_USERNAME', env.SMTP_USER)
  set('PEERTUBE_SMTP_PASSWORD', env.SMTP_PASSWORD)
  set('PEERTUBE_SMTP_FROM', env.SMTP_FROM || `noreply@${publicHostname}`)
  set('PEERTUBE_SMTP_TLS', String(bool(env.SMTP_TLS, port === '465')))
  set('PEERTUBE_SMTP_DISABLE_STARTTLS', 'false')
} else {
  log('SMTP_HOST not set, email delivery is disabled')
}

// --- Object storage --------------------------------------------------------

const PUBLIC_PREFIXES = [ 'streaming-playlists/', 'web-videos/', 'captions/' ]
const STORAGE_KINDS = {
  STREAMING_PLAYLISTS: 'streaming-playlists/',
  WEB_VIDEOS: 'web-videos/',
  USER_EXPORTS: 'user-exports/',
  ORIGINAL_VIDEO_FILES: 'original-video-files/',
  CAPTIONS: 'captions/'
}

if (env.S3_ENDPOINT) {
  for (const key of [ 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY' ]) {
    if (!env[key]) fail(`${key} must be set when S3_ENDPOINT is set`)
  }
  const endpoint = env.S3_ENDPOINT.replace(/\/+$/, '')
  const bucket = env.S3_BUCKET || 'peertube'
  const region = env.S3_REGION || 'us-east-1'
  const publicUrl = env.S3_PUBLIC_URL ? env.S3_PUBLIC_URL.replace(/\/+$/, '') : undefined

  set('PEERTUBE_OBJECT_STORAGE_ENABLED', 'true')
  set('PEERTUBE_OBJECT_STORAGE_ENDPOINT', endpoint)
  set('PEERTUBE_OBJECT_STORAGE_REGION', region)
  set('PEERTUBE_OBJECT_STORAGE_FORCE_PATH_STYLE', 'true')
  set('PEERTUBE_OBJECT_STORAGE_CREDENTIALS_ACCESS_KEY_ID', env.S3_ACCESS_KEY_ID)
  set('PEERTUBE_OBJECT_STORAGE_CREDENTIALS_SECRET_ACCESS_KEY', env.S3_SECRET_ACCESS_KEY)
  for (const [ kind, prefix ] of Object.entries(STORAGE_KINDS)) {
    set(`PEERTUBE_OBJECT_STORAGE_${kind}_BUCKET_NAME`, bucket)
    set(`PEERTUBE_OBJECT_STORAGE_${kind}_PREFIX`, prefix)
    if (publicUrl) set(`PEERTUBE_OBJECT_STORAGE_${kind}_BASE_URL`, publicUrl)
  }

  if (bool(env.S3_CREATE_BUCKET, true)) {
    await ensureBucket({ endpoint, region, bucket })
  }
} else {
  log('WARNING: S3_ENDPOINT not set, videos are stored on the container filesystem')
}

async function ensureBucket ({ endpoint, region, bucket }) {
  const require = createRequire('/app/package.json')
  const {
    S3Client, HeadBucketCommand, CreateBucketCommand, PutBucketPolicyCommand
  } = require('@aws-sdk/client-s3')

  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
  })

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
    log(`Bucket ${bucket} exists`)
  } catch (err) {
    if (err?.$metadata?.httpStatusCode !== 404) fail(`Cannot access bucket ${bucket}: ${err.message}`)
    log(`Creating bucket ${bucket}`)
    await client.send(new CreateBucketCommand({ Bucket: bucket }))
  }

  // Video players fetch public files straight from the bucket
  const policy = {
    Version: '2012-10-17',
    Statement: [ {
      Effect: 'Allow',
      Principal: { AWS: [ '*' ] },
      Action: [ 's3:GetObject' ],
      Resource: PUBLIC_PREFIXES.map(prefix => `arn:aws:s3:::${bucket}/${prefix}*`)
    } ]
  }
  try {
    await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) }))
    log(`Public read policy applied to ${PUBLIC_PREFIXES.join(', ')}`)
  } catch (err) {
    log(`WARNING: could not set bucket policy (${err.message}), make public prefixes readable manually`)
  }
}

// --- Emit ------------------------------------------------------------------

const quote = (value) => `'${value.replace(/'/g, `'\\''`)}'`
for (const [ key, value ] of Object.entries(out)) {
  process.stdout.write(`export ${key}=${quote(value)}\n`)
}
