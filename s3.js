import { AwsClient } from './vendor/aws4fetch.js';

const CONFIG_KEY = 's3_config';

export function loadS3Config() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) ?? {}; }
  catch { return {}; }
}

export function saveS3Config(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function makeClient(cfg) {
  return new AwsClient({ accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey, service: 's3' });
}

function objectUrl(cfg, key) {
  return `${cfg.endpoint.replace(/\/$/, '')}/${cfg.bucket}/${key}`;
}

export async function getObject({ endpoint, bucket, accessKey, secretKey, key }) {
  const aws = makeClient({ accessKey, secretKey });
  const resp = await aws.fetch(objectUrl({ endpoint, bucket }, key), { cache: 'no-store' });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`S3 GET failed: HTTP ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

export async function putObject({ endpoint, bucket, accessKey, secretKey, key, body }) {
  const aws = makeClient({ accessKey, secretKey });
  const resp = await aws.fetch(objectUrl({ endpoint, bucket }, key), {
    method: 'PUT',
    body,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  if (!resp.ok) throw new Error(`S3 PUT failed: HTTP ${resp.status}`);
}

export async function testS3Connection({ endpoint, bucket, accessKey, secretKey }) {
  const aws = makeClient({ accessKey, secretKey });
  const url = objectUrl({ endpoint, bucket }, '?list-type=2&max-keys=1');
  try {
    const resp = await aws.fetch(url);
    if (resp.ok) return { ok: true, message: 'Connected — bucket is reachable.' };
    const text = await resp.text();
    const code = text.match(/<Code>(.+?)<\/Code>/)?.[1];
    return { ok: false, message: code ? `${resp.status} ${code}` : `HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
