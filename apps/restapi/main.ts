import {
    CreateStartUpPageContainer,
    ListContainerProperty,
    ListItemContainerProperty,
    OsEventTypeList,
    RebuildPageContainer,
    TextContainerProperty,
    waitForEvenAppBridge,
    type EvenAppBridge,
    type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import type { AppActions, SetStatus } from '../_shared/app-types'
import { appendEventLog } from '../_shared/log'
import { proxyFetch } from '../_shared/proxy'

const DEFAULT_URLS = [
    'https://jsonplaceholder.typicode.com/posts/1',
    'https://api.ipify.org?format=json',
    'https://httpbin.org/get',
] as const

type BridgeDisplay = {
    mode: 'bridge' | 'mock'
    show: (message: string) => Promise<void>
    renderList: (urls: string[], selectedIndex: number, statusMessage?: string) => Promise<void>
    onSelectAndRun: (runner: (index: number) => Promise<void>) => void
}

const bridgeState: {
    bridge: EvenAppBridge | null
    startupRendered: boolean
    eventLoopRegistered: boolean
    selectedIndex: number
    statusMessage: string
    onSelectAndRun: ((index: number) => Promise<void>) | null
} = {
    bridge: null,
    startupRendered: false,
    eventLoopRegistered: false,
    selectedIndex: 0,
    statusMessage: 'Select URL and click',
    onSelectAndRun: null,
}

let bridgeDisplay: BridgeDisplay | null = null
let urls: string[] = [...DEFAULT_URLS]

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(
            () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
            timeoutMs,
        )
        promise
            .then((value) => resolve(value))
            .catch((error) => reject(error))
            .finally(() => window.clearTimeout(timer))
    })
}

function getRawEventType(event: EvenHubEvent): unknown {
    const raw = (event.jsonData ?? {}) as Record<string, unknown>
    return (
        event.listEvent?.eventType ??
        event.textEvent?.eventType ??
        event.sysEvent?.eventType ??
        (event as Record<string, unknown>).eventType ??
        raw.eventType ??
        raw.event_type ??
        raw.Event_Type ??
        raw.type
    )
}

function normalizeEventType(rawEventType: unknown): OsEventTypeList | undefined {
    if (typeof rawEventType === 'number') {
        switch (rawEventType) {
            case 0: return OsEventTypeList.CLICK_EVENT
            case 1: return OsEventTypeList.SCROLL_TOP_EVENT
            case 2: return OsEventTypeList.SCROLL_BOTTOM_EVENT
            case 3: return OsEventTypeList.DOUBLE_CLICK_EVENT
            default: return undefined
        }
    }

    if (typeof rawEventType === 'string') {
        const value = rawEventType.toUpperCase()
        if (value.includes('DOUBLE')) return OsEventTypeList.DOUBLE_CLICK_EVENT
        if (value.includes('CLICK')) return OsEventTypeList.CLICK_EVENT
        if (value.includes('SCROLL_TOP') || value.includes('UP')) return OsEventTypeList.SCROLL_TOP_EVENT
        if (value.includes('SCROLL_BOTTOM') || value.includes('DOWN')) return OsEventTypeList.SCROLL_BOTTOM_EVENT
    }

    return undefined
}

function clampIndex(index: number, length: number): number {
    if (length <= 0) return 0
    return Math.max(0, Math.min(length - 1, index))
}

function toListLabel(url: string): string {
    if (url.length <= 62) return url
    return `${url.slice(0, 59)}...`
}

function getMockBridgeDisplay(): BridgeDisplay {
    return {
        mode: 'mock',
        async show() { },
        async renderList() { },
        onSelectAndRun() { },
    }
}

async function renderBridgePage(
    bridge: EvenAppBridge,
    urlsList: string[],
    selectedIndex: number,
    statusMessage: string,
): Promise<void> {
    const safeUrls = urlsList.length > 0 ? urlsList : ['No URL configured']
    const safeSelected = clampIndex(selectedIndex, safeUrls.length)

    const titleText = new TextContainerProperty({
        containerID: 1,
        containerName: 'restapi-title',
        content: 'REST API (Up/Down + Click)',
        xPosition: 8,
        yPosition: 0,
        width: 560,
        height: 32,
        isEventCapture: 0,
    })

    const statusText = new TextContainerProperty({
        containerID: 2,
        containerName: 'restapi-status',
        content: statusMessage,
        xPosition: 8,
        yPosition: 34,
        width: 560,
        height: 64,
        isEventCapture: 0,
    })

    const listContainer = new ListContainerProperty({
        containerID: 3,
        containerName: 'restapi-url-list',
        itemContainer: new ListItemContainerProperty({
            itemCount: safeUrls.length,
            itemWidth: 566,
            isItemSelectBorderEn: 1,
            itemName: safeUrls.map((value) => toListLabel(value)),
        }),
        isEventCapture: 1,
        xPosition: 4,
        yPosition: 102,
        width: 572,
        height: 186,
    })

    const config = {
        containerTotalNum: 3,
        textObject: [titleText, statusText],
        listObject: [listContainer],
        currentSelectedItem: safeSelected,
    }

    if (!bridgeState.startupRendered) {
        await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(config))
        bridgeState.startupRendered = true
        return
    }

    await bridge.rebuildPageContainer(new RebuildPageContainer(config))
}

function registerBridgeEvents(bridge: EvenAppBridge): void {
    if (bridgeState.eventLoopRegistered) return

    bridge.onEvenHubEvent(async (event) => {
        if (urls.length === 0) return
        const labels = urls.map((url) => toListLabel(url))

        const rawEventType = getRawEventType(event)
        let eventType = normalizeEventType(rawEventType)

        const incomingIndexRaw = event.listEvent?.currentSelectItemIndex
        const incomingName = event.listEvent?.currentSelectItemName
        const incomingIndexByName = typeof incomingName === 'string'
            ? labels.indexOf(incomingName)
            : -1
        const parsedIncomingIndex = typeof incomingIndexRaw === 'number'
            ? incomingIndexRaw
            : typeof incomingIndexRaw === 'string'
                ? Number.parseInt(incomingIndexRaw, 10)
                : incomingIndexByName
        const incomingIndex = event.listEvent && (Number.isNaN(parsedIncomingIndex) || parsedIncomingIndex < 0)
            ? 0
            : parsedIncomingIndex
        const hasIncomingIndex = incomingIndex >= 0 && incomingIndex < urls.length

        if (eventType === undefined && event.listEvent) {
            if (hasIncomingIndex && incomingIndex > bridgeState.selectedIndex) {
                eventType = OsEventTypeList.SCROLL_BOTTOM_EVENT
            } else if (hasIncomingIndex && incomingIndex < bridgeState.selectedIndex) {
                eventType = OsEventTypeList.SCROLL_TOP_EVENT
            } else {
                eventType = OsEventTypeList.CLICK_EVENT
            }
        }

        if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
            bridgeState.selectedIndex = clampIndex(
                hasIncomingIndex ? incomingIndex : bridgeState.selectedIndex + 1,
                urls.length,
            )
            await renderBridgePage(bridge, urls, bridgeState.selectedIndex, bridgeState.statusMessage)
            appendEventLog(`REST API glass: down -> ${urls[bridgeState.selectedIndex]}`)
            return
        }

        if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
            bridgeState.selectedIndex = clampIndex(
                hasIncomingIndex ? incomingIndex : bridgeState.selectedIndex - 1,
                urls.length,
            )
            await renderBridgePage(bridge, urls, bridgeState.selectedIndex, bridgeState.statusMessage)
            appendEventLog(`REST API glass: up -> ${urls[bridgeState.selectedIndex]}`)
            return
        }

        if (eventType === OsEventTypeList.CLICK_EVENT || (eventType === undefined && event.listEvent)) {
            const selected = hasIncomingIndex ? clampIndex(incomingIndex, urls.length) : bridgeState.selectedIndex
            bridgeState.selectedIndex = selected
            appendEventLog(`REST API glass: click -> run ${urls[bridgeState.selectedIndex]}`)
            const run = bridgeState.onSelectAndRun
            if (run) {
                await run(bridgeState.selectedIndex)
            }
        }
    })

    bridgeState.eventLoopRegistered = true
}

function getBridgeDisplay(): BridgeDisplay {
    if (!bridgeState.bridge) throw new Error('Bridge unavailable')

    return {
        mode: 'bridge',
        async show(message: string) {
            bridgeState.statusMessage = message
            await renderBridgePage(bridgeState.bridge!, urls, bridgeState.selectedIndex, message)
        },
        async renderList(urlsList: string[], selectedIndex: number, statusMessage?: string) {
            bridgeState.selectedIndex = selectedIndex
            if (statusMessage) bridgeState.statusMessage = statusMessage
            await renderBridgePage(bridgeState.bridge!, urlsList, selectedIndex, bridgeState.statusMessage)
        },
        onSelectAndRun(runner) {
            bridgeState.onSelectAndRun = runner
        },
    }
}

async function runRequest(index: number, setStatus: SetStatus): Promise<void> {
    const url = urls[index]
    if (!url) return

    setStatus(`Fetching: ${url}`)
    appendEventLog(`REST API: GET ${url}`)

    try {
        const response = await proxyFetch(url)
        const text = await response.text()
        const preview = text.length > 200 ? text.slice(0, 200) + '…' : text

        setStatus(`${response.status} OK — ${preview}`)
        appendEventLog(`REST API: ${response.status} — ${preview.slice(0, 80)}`)

        if (bridgeDisplay && bridgeDisplay.mode === 'bridge') {
            await bridgeDisplay.show(`${response.status}: ${preview.slice(0, 120)}`)
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setStatus(`Request failed: ${msg}`)
        appendEventLog(`REST API: error — ${msg}`)
    }
}

export function createRestApiActions(setStatus: SetStatus): AppActions {
    return {
        async connect() {
            setStatus('REST API: connecting to Even bridge...')
            appendEventLog('REST API: connect requested')

            try {
                const bridge = await withTimeout(waitForEvenAppBridge(), 4000)
                bridgeState.bridge = bridge
                bridgeDisplay = getBridgeDisplay()

                registerBridgeEvents(bridge)
                await bridgeDisplay.renderList(urls, 0, 'Select URL and click')

                bridgeDisplay.onSelectAndRun(async (index) => {
                    await runRequest(index, setStatus)
                })

                setStatus('REST API: connected. Select a URL and click Run.')
                appendEventLog('REST API: connected to bridge')
            } catch {
                bridgeDisplay = getMockBridgeDisplay()
                setStatus('REST API: bridge not found. Running in browser-only mode.')
                appendEventLog('REST API: running in mock mode')
            }
        },
        async action() {
            await runRequest(bridgeState.selectedIndex, setStatus)
        },
    }
}
