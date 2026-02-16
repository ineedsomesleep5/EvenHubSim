/**
 * Vercel Serverless CORS Proxy
 *
 * Handles two types of proxy requests:
 * 1. Generic: /api/proxy?url=https://example.com/api
 * 2. Reddit: /api/proxy?reddit_path=/r/popular/.json
 *
 * This function is the production equivalent of the Vite dev
 * middleware proxies defined in vite.config.ts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(
    req: VercelRequest,
    res: VercelResponse,
): Promise<void> {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    // Handle preflight
    if (req.method === 'OPTIONS') {
        res.status(204).end()
        return
    }

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method Not Allowed' })
        return
    }

    try {
        const { url, reddit_path } = req.query

        // ── Reddit proxy ──────────────────────────────────────
        if (typeof reddit_path === 'string' && reddit_path.startsWith('/')) {
            const upstreamUrl = `https://old.reddit.com${reddit_path}`
            const upstream = await fetch(upstreamUrl, {
                headers: {
                    'User-Agent': 'even-hub-sim/1.0',
                    Accept: 'application/json',
                },
            })
            const body = await upstream.text()
            const contentType =
                upstream.headers.get('content-type') ?? 'application/json; charset=utf-8'

            res.status(upstream.status).setHeader('Content-Type', contentType).send(body)
            return
        }

        // ── Generic URL proxy ─────────────────────────────────
        const target = typeof url === 'string' ? url.trim() : ''
        if (!target || (!target.startsWith('http://') && !target.startsWith('https://'))) {
            res.status(400).json({ error: 'Missing or invalid "url" query parameter' })
            return
        }

        const upstream = await fetch(target, { method: 'GET' })
        const body = await upstream.text()
        const contentType =
            upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8'

        res.status(upstream.status).setHeader('Content-Type', contentType).send(body)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        res.status(502).json({ error: `Proxy request failed: ${message}` })
    }
}
