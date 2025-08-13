// /api/_sourcesUtil.js — FinalSay safe util (no JSON import assertions)

import fs from 'fs/promises';
import path from 'path';

// ---- helpers to respond JSON ----
export function ok(res, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).end(JSON.stringify(data));
}
export function bad(res, msg, code = 400) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).end(JSON.stringify({ error: msg }));
}

// ---- read JSON from /public safely ----
export async function readPublicJson(fileRelative) {
  try {
    const filePath = path.join(process.cwd(), 'public', fileRelative);
    const buf = await fs.readFile(filePath);
    return JSON.parse(buf.toString('utf-8'));
  } catch {
    return null; // missing or invalid
  }
}

// ---- substitute ${ENV:VAR_NAME} placeholders anywhere in an object ----
function substituteEnvValue(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/\$\{ENV:([A-Z0-9_]+)\}/g, (_, name) => {
    const v = process.env[name];
    return v == null ? '' : String(v);
  });
}
function deepMapEnv(obj) {
  if (Array.isArray(obj)) return obj.map(deepMapEnv);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = deepMapEnv(obj[k]);
    return out;
  }
  return substituteEnvValue(obj);
}

// ---- load sources.config.json and apply env substitutions ----
export async function getSourcesConfig() {
  const cfg = await readPublicJson('sources.config.json');
  if (!cfg) return { sources: [] };
  return deepMapEnv(cfg);
}
