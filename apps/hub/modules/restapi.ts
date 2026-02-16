import type { SubModuleFactory } from '../types'
import { appendEventLog } from '../../_shared/log'
import { proxyFetch } from '../../_shared/proxy'

const DEFAULT_URLS = [
    'https://jsonplaceholder.typicode.com/posts/1',
    'https://api.ipify.org?format=json',
    'https://httpbin.org/get',
]

export const createRestApiModule: SubModuleFactory = (renderer, setStatus) => {
    let selected = 0
    const urls = [...DEFAULT_URLS]

    const showList = async () => {
        const items = urls.map((u) => u.length > 50 ? u.slice(0, 47) + '...' : u)
        await renderer.renderList('REST API', items, selected)
    }

    const runRequest = async () => {
        const url = urls[selected]
        if (!url) return
        setStatus(`Fetching: ${url}`)
        appendEventLog(`REST API: GET ${url}`)
        try {
            const res = await proxyFetch(url)
            const text = await res.text()
            const preview = text.length > 200 ? text.slice(0, 197) + '...' : text
            setStatus(`${res.status} OK`)
            appendEventLog(`REST API: ${res.status} — ${preview.slice(0, 80)}`)
            await renderer.renderText(`${res.status} Response`, preview.slice(0, 180))
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            setStatus(`Request failed: ${msg}`)
            appendEventLog(`REST API: error — ${msg}`)
            await renderer.renderText('Error', msg)
        }
    }

    return {
        id: 'restapi',
        label: 'REST API',
        async enter() {
            selected = 0
            setStatus('REST API — scroll and click to fetch')
            appendEventLog('REST API: ready')
            await showList()
        },
        leave() { selected = 0 },
        async handleEvent(eventType) {
            if (eventType === 'double') return
            if (eventType === 'up') {
                selected = Math.max(0, selected - 1)
                await showList()
            } else if (eventType === 'down') {
                selected = Math.min(urls.length - 1, selected + 1)
                await showList()
            } else if (eventType === 'click') {
                await runRequest()
            }
        },
    }
}
