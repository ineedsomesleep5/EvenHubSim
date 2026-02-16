import { defineConfig } from 'vite'

export default defineConfig({
    plugins: [
        {
            name: 'cors-proxy-middleware',
            configureServer(server) {
                // ── Generic REST API proxy ──────────────────────────────
                // Usage: /__restapi_proxy?url=https://example.com/api/data
                server.middlewares.use('/__restapi_proxy', async (req, res) => {
                    if (req.method !== 'GET') {
                        res.statusCode = 405
                        res.setHeader('content-type', 'text/plain; charset=utf-8')
                        res.end('Method Not Allowed')
                        return
                    }

                    try {
                        const parsed = new URL(req.url ?? '', 'http://localhost')
                        const target = parsed.searchParams.get('url')?.trim() ?? ''
                        if (!target || (!target.startsWith('http://') && !target.startsWith('https://'))) {
                            res.statusCode = 400
                            res.setHeader('content-type', 'text/plain; charset=utf-8')
                            res.end('Missing or invalid "url" query parameter')
                            return
                        }

                        const upstream = await fetch(target, { method: 'GET' })
                        const body = await upstream.text()
                        const contentType =
                            upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8'

                        res.statusCode = upstream.status
                        res.setHeader('content-type', contentType)
                        res.setHeader('access-control-allow-origin', '*')
                        res.end(body)
                    } catch (error) {
                        res.statusCode = 502
                        res.setHeader('content-type', 'text/plain; charset=utf-8')
                        const message = error instanceof Error ? error.message : String(error)
                        res.end(`Proxy request failed: ${message}`)
                    }
                })

                // ── Reddit API proxy (query-param style) ────────────────
                // Usage: /__reddit_proxy?path=/r/popular/.json
                server.middlewares.use('/__reddit_proxy', async (req, res) => {
                    if (req.method !== 'GET') {
                        res.statusCode = 405
                        res.setHeader('content-type', 'text/plain; charset=utf-8')
                        res.end('Method Not Allowed')
                        return
                    }

                    try {
                        const parsed = new URL(req.url ?? '', 'http://localhost')
                        const path = parsed.searchParams.get('path')?.trim() ?? ''
                        if (!path.startsWith('/')) {
                            res.statusCode = 400
                            res.setHeader('content-type', 'text/plain; charset=utf-8')
                            res.end('Missing or invalid "path" query parameter')
                            return
                        }

                        const upstreamUrl = new URL(path, 'https://old.reddit.com')
                        const upstream = await fetch(upstreamUrl, {
                            headers: {
                                'User-Agent': 'even-hub-sim/1.0',
                                Accept: 'application/json',
                            },
                        })
                        const body = await upstream.text()
                        const contentType =
                            upstream.headers.get('content-type') ?? 'application/json; charset=utf-8'

                        res.statusCode = upstream.status
                        res.setHeader('content-type', contentType)
                        res.setHeader('access-control-allow-origin', '*')
                        res.end(body)
                    } catch (error) {
                        res.statusCode = 502
                        res.setHeader('content-type', 'text/plain; charset=utf-8')
                        const message = error instanceof Error ? error.message : String(error)
                        res.end(`Reddit proxy request failed: ${message}`)
                    }
                })

                // ── Reddit API proxy (path-based, submodule compat) ─────
                // Usage: /reddit-api/r/popular/.json
                server.middlewares.use('/reddit-api', async (req, res) => {
                    if (req.method !== 'GET') {
                        res.statusCode = 405
                        res.setHeader('content-type', 'text/plain; charset=utf-8')
                        res.end('Method Not Allowed')
                        return
                    }

                    try {
                        const upstreamUrl = `https://old.reddit.com${req.url ?? ''}`
                        const upstream = await fetch(upstreamUrl, {
                            headers: {
                                'User-Agent': 'even-hub-sim/1.0',
                                Accept: 'application/json',
                            },
                        })
                        const body = await upstream.text()
                        const contentType =
                            upstream.headers.get('content-type') ?? 'application/json; charset=utf-8'

                        res.statusCode = upstream.status
                        res.setHeader('content-type', contentType)
                        res.setHeader('access-control-allow-origin', '*')
                        res.end(body)
                    } catch (error) {
                        res.statusCode = 502
                        res.setHeader('content-type', 'text/plain; charset=utf-8')
                        const message = error instanceof Error ? error.message : String(error)
                        res.end(`Reddit proxy request failed: ${message}`)
                    }
                })
            },
        },
    ],
    server: {
        host: true,
        port: 5173,
    },
})
