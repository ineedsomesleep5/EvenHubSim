/**
 * CORS Proxy utility — auto-detects dev vs production environment.
 *
 * In development (Vite): routes through Vite middleware proxies.
 * In production (Vercel): routes through the /api/proxy serverless function.
 */

function isDev(): boolean {
    try {
        return import.meta.env?.DEV === true
    } catch {
        return false
    }
}

/**
 * Proxy a generic HTTP GET request through the CORS proxy.
 * Use this for any external API call that would be blocked by CORS.
 */
export async function proxyFetch(url: string): Promise<Response> {
    const proxyBase = isDev() ? '/__restapi_proxy' : '/api/proxy'
    const proxyUrl = `${proxyBase}?url=${encodeURIComponent(url)}`
    return fetch(proxyUrl)
}

/**
 * Proxy a Reddit API request through the CORS proxy.
 * @param path - Reddit path, e.g. "/r/popular/.json"
 */
export async function redditFetch(path: string): Promise<Response> {
    if (isDev()) {
        // Use the query-param style proxy in dev
        return fetch(`/__reddit_proxy?path=${encodeURIComponent(path)}`)
    }
    // In production, use the same /api/proxy with a reddit flag
    return fetch(`/api/proxy?reddit_path=${encodeURIComponent(path)}`)
}
