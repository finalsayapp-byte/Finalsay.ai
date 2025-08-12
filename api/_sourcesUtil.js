import configJson from '../public/sources.config.json' assert { type: 'json' };

function substituteEnv(val){
  if (typeof val !== 'string') return val;
  if (val.startsWith('${') && val.endsWith('}')) {
    const key = val.slice(2, -1);
    return process.env[key] || '';
  }
  return val;
}

function buildUrl(api, q) {
  const hasQ = ['q','query','search_text'].some(k => api.params && k in api.params);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(api.params || {})) {
    const vv = substituteEnv(String(v));
    if (vv !== '') params.append(k, vv);
  }
  if (!hasQ && q) params.append('q', q);
  const sep = api.base.includes('?') ? '&' : '?';
  return api.base + (api.base.includes('?') ? '' : '?') + params.toString();
}

function pickPersonaPack(personaName = 'General') {
  const p = configJson.personas[personaName] || configJson.personas.General;
  const apis = (p.use || []).map(key => ({ key, ...configJson.apis[key] })).filter(Boolean);
  const whitelist = p.whitelist ? (configJson.whitelists[p.whitelist] || []) : [];
  const queryTpl = p.query || '${topic}';
  return { apis, whitelist, queryTpl };
}

function domainFrom(url) { try { return new URL(url).host; } catch { return ''; } }

function dedupe(items) {
  const seen = new Set();
  return items.filter(it => {
    const k = (it.url || '') + '|' + (it.title || '');
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}

async function normalize(apiKey, api, resp) {
  // Some endpoints return non-JSON; try JSON first.
  let data = null;
  try { data = await resp.json(); } catch { /* fall back to simple reference */ }

  // Per‑API mappers
  switch (apiKey) {
    case 'guardian':
      return (data?.response?.results || []).map(r => ({
        title: r.webTitle, url: r.webUrl, domain: domainFrom(r.webUrl)
      }));

    case 'nyt':
      return (data?.response?.docs || []).map(d => ({
        title: d?.headline?.main, url: d?.web_url, domain: domainFrom(d?.web_url)
      }));

    case 'congress':
      // surface the endpoint query itself as a reference
      return [{ title: 'Congress.gov: bills', url: resp.url, domain: domainFrom(resp.url) }];

    case 'govinfo':
      return [{ title: 'GovInfo: US Code', url: resp.url, domain: domainFrom(resp.url) }];

    case 'fred':
      return (data?.seriess || []).map(s => ({
        title: `${s.title} (${s.id})`, url: `https://fred.stlouisfed.org/series/${encodeURIComponent(s.id)}`,
        domain: 'fred.stlouisfed.org'
      }));

    case 'nasa':
      return (data?.collection?.items || []).slice(0, 6).map(it => {
        const link = (it.links || [])[0]?.href || '';
        return { title: (it.data?.[0]?.title || 'NASA media'), url: link || resp.url, domain: domainFrom(link || resp.url) };
      });

    case 'nps':
      return (data?.data || []).map(p => ({
        title: `${p.fullName} — ${p.states}`, url: p.url || `https://www.nps.gov/${p.parkCode}`, domain: domainFrom(p.url || `https://www.nps.gov/${p.parkCode}`)
      }));

    case 'openweather':
      return [{ title: 'OpenWeather result', url: resp.url, domain: domainFrom(resp.url) }];

    case 'pubmed': {
      const ids = data?.esearchresult?.idlist || [];
      return ids.slice(0, 8).map(id => ({
        title: `PubMed ID ${id}`, url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, domain: 'pubmed.ncbi.nlm.nih.gov'
      }));
    }

    case 'who':
      return [{ title: 'WHO GHO API result', url: resp.url, domain: domainFrom(resp.url) }];

    case 'medlineplus':
      return [{ title: 'MedlinePlus search', url: resp.url, domain: domainFrom(resp.url) }];

    case 'courtlistener': {
      // they require query via ?q=
      return [{ title: 'CourtListener search', url: resp.url, domain: domainFrom(resp.url) }];
    }

    case 'lii':
      return [{ title: 'Cornell LII search', url: resp.url, domain: domainFrom(resp.url) }];

    default:
      // Generic fallback
      return [{ title: `Result from ${apiKey}`, url: resp.url, domain: domainFrom(resp.url) }];
  }
}

export async function fetchSources({ persona = 'General', topic = '' }) {
  const { apis, whitelist, queryTpl } = pickPersonaPack(persona);
  const q = (queryTpl || '${topic}').replace('${topic}', topic).trim();
  const out = [];

  for (const api of apis) {
    // Skip APIs that need env keys but don’t have them
    const needsKey = Object.values(api.params || {}).some(v => typeof v === 'string' && v.startsWith('${'));
    if (needsKey) {
      const missing = Object.values(api.params).some(v => {
        if (typeof v !== 'string') return false;
        if (!v.startsWith('${')) return false;
        const key = v.slice(2, -1);
        return !process.env[key];
      });
      if (missing) continue;
    }

    try {
      const url = buildUrl(api, q);
      const r = await fetch(url);
      if (!r.ok) continue;
      const items = await normalize(api.key || api.name, api, r);
      for (const it of items) {
        if (whitelist.length && !whitelist.some(d => (it.domain || '').toLowerCase().endsWith(d))) continue;
        out.push(it);
      }
      if (out.length >= 8) break;
    } catch { /* ignore */ }
  }

  // dedupe & cap
  return dedupe(out).slice(0, 8);
}
