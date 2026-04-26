const CONFIG_KEY = 's3_config';

export function loadS3Config() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) ?? {}; }
  catch { return {}; }
}

export function saveS3Config(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function toHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return toHex(new Uint8Array(buf));
}

async function hmac(key, data) {
  const k = key instanceof Uint8Array ? key : new TextEncoder().encode(key);
  const ck = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', ck, new TextEncoder().encode(data)));
}

async function signingKey(secretKey, date, region, service) {
  const kDate    = await hmac('AWS4' + secretKey, date);
  const kRegion  = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function canonicalQS(params) {
  return Object.entries(params)
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function signedRequest({ endpoint, bucket, accessKey, secretKey, method, key, body }) {
  const region = 'auto';
  const service = 's3';
  const host = new URL(endpoint).hostname;
  const now = new Date();
  const datetime = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const date = datetime.slice(0, 8);

  const bodyHash = body
    ? toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', body)))
    : await sha256hex('');

  const path = `/${bucket}/${key}`;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${datetime}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, bodyHash].join('\n');

  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${datetime}\n${scope}\n${await sha256hex(canonicalRequest)}`;
  const sk = await signingKey(secretKey, date, region, service);
  const signature = toHex(await hmac(sk, stringToSign));

  const url = `${endpoint.replace(/\/$/, '')}${path}`;
  return fetch(url, {
    method,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-date': datetime,
      'x-amz-content-sha256': bodyHash,
      ...(body ? { 'Content-Type': 'application/octet-stream', 'Content-Length': body.byteLength } : {}),
    },
    ...(body ? { body } : {}),
  });
}

export async function getObject({ endpoint, bucket, accessKey, secretKey, key }) {
  const resp = await signedRequest({ endpoint, bucket, accessKey, secretKey, method: 'GET', key });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`S3 GET failed: HTTP ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

export async function putObject({ endpoint, bucket, accessKey, secretKey, key, body }) {
  const resp = await signedRequest({ endpoint, bucket, accessKey, secretKey, method: 'PUT', key, body });
  if (!resp.ok) throw new Error(`S3 PUT failed: HTTP ${resp.status}`);
}

export async function testS3Connection({ endpoint, bucket, accessKey, secretKey, fileKey }) {
  const key = fileKey?.trim() || 'names.db';
  try {
    const resp = await signedRequest({ endpoint, bucket, accessKey, secretKey, method: 'HEAD', key });
    // 200 = object exists, 404 = bucket reachable but no DB yet — both mean credentials work
    if (resp.ok || resp.status === 404) return { ok: true, message: 'Connected — bucket is reachable.' };
    const text = await resp.text();
    const code = text.match(/<Code>(.+?)<\/Code>/)?.[1];
    return { ok: false, message: code ? `${resp.status} ${code}` : `HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
