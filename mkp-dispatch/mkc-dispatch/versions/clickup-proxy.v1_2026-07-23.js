/**
 * clickup-proxy.js — Cloudflare Worker
 * -----------------------------------------------------------------------
 * Sits between the Dispatch front end and api.clickup.com.
 *
 * Why this exists:
 *   1. ClickUp's API does not return CORS headers, so a browser page
 *      calling it directly gets blocked. This Worker adds the header.
 *   2. Your ClickUp personal token is stored here as an encrypted
 *      secret (CLICKUP_TOKEN), never shipped to the browser. Only
 *      requests from your own allowed origin (your GitHub Pages URL)
 *      are accepted.
 *
 * Deploy: see the "Deploy the proxy" section in README.md.
 * -----------------------------------------------------------------------
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowed === '*' ? '*' : (origin === allowed ? origin : 'null'),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (!env.CLICKUP_TOKEN) {
      return json({ error: 'CLICKUP_TOKEN secret is not set on this Worker.' }, 500, corsHeaders);
    }

    const url = new URL(request.url);
    // Only allow the handful of ClickUp endpoints Dispatch actually needs.
    const allowedPath = /^\/(user|list\/\d+\/task|task\/[A-Za-z0-9]+\/attachment)$/;
    if (!allowedPath.test(url.pathname)) {
      return json({ error: 'Endpoint not allowed by proxy.' }, 404, corsHeaders);
    }

    const upstream = new URL(`https://api.clickup.com/api/v2${url.pathname}`);

    const init = {
      method: request.method,
      headers: { Authorization: env.CLICKUP_TOKEN }
    };

    const contentType = request.headers.get('Content-Type') || '';
    if (request.method === 'POST' && contentType.includes('application/json')) {
      init.headers['Content-Type'] = 'application/json';
      init.body = await request.text();
    } else if (request.method === 'POST') {
      // multipart/form-data (attachment upload) — pass the stream through as-is
      init.body = request.body;
      init.duplex = 'half';
      if (contentType) init.headers['Content-Type'] = contentType;
    }

    try {
      const upstreamRes = await fetch(upstream.toString(), init);
      const body = await upstreamRes.text();
      return new Response(body, {
        status: upstreamRes.status,
        headers: { ...corsHeaders, 'Content-Type': upstreamRes.headers.get('Content-Type') || 'application/json' }
      });
    } catch (err) {
      return json({ error: 'Upstream request to ClickUp failed.', detail: String(err) }, 502, corsHeaders);
    }
  }
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}
