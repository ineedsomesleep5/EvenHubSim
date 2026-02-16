/**
 * Unified Hub — Orchestrates the main menu and all sub-modules
 * on the Even G2 glasses display.
 *
 * Uses RAW even_hub_sdk directly for maximum control over rendering.
 * EvenBetterSdk wrapper was causing display update failures on page switching.
 */
import {
    waitForEvenAppBridge,
    EvenAppBridge,
    EvenHubEvent,
    OsEventTypeList,
    CreateStartUpPageContainer,
    RebuildPageContainer,
    ListContainerProperty,
    ListItemContainerProperty,
    TextContainerProperty,
} from '@evenrealities/even_hub_sdk'
import type { AppActions, SetStatus } from '../_shared/app-types'
import { appendEventLog } from '../_shared/log'
import type { HubRenderer, SubModule } from './types'
import { createClockModule } from './modules/clock'
import { createTimerModule } from './modules/timer'
import { createRedditModule } from './modules/reddit'
import { createChessModule } from './modules/chess'
import { createRestApiModule } from './modules/restapi'

// ── SDK State ──────────────────────────────────────────────
let bridge: EvenAppBridge | null = null
let connected = false
let ignoreEventsUntil = 0
let isFirstRender = true

// ── Navigation State ───────────────────────────────────────
type View = 'menu' | string
let currentView: View = 'menu'
let menuIndex = 0
let modules: SubModule[] = []
let activeModule: SubModule | null = null
let hubSetStatus: SetStatus = () => { }

// ── Event Handling Logic ───────────────────────────────────

function detectEventType(event: EvenHubEvent): 'up' | 'down' | 'click' | 'double' | null {
    if (Date.now() < ignoreEventsUntil) return null

    // 1. Explicit event types
    const sources: unknown[] = []
    if (event.listEvent?.eventType !== undefined) sources.push(event.listEvent.eventType)
    if (event.textEvent?.eventType !== undefined) sources.push(event.textEvent.eventType)
    if (event.sysEvent?.eventType !== undefined) sources.push(event.sysEvent.eventType)

    // Check jsonData fallback
    const raw = (event.jsonData ?? {}) as Record<string, unknown>
    for (const key of ['eventType', 'event_type', 'Event_Type', 'type']) {
        if (raw[key] !== undefined) sources.push(raw[key])
    }

    for (const src of sources) {
        const num = typeof src === 'number' ? src : (typeof src === 'string' && /^\d+$/.test(src) ? parseInt(src, 10) : null)
        if (num !== null) {
            switch (num) {
                case 0: return 'click'
                case 1: return 'up'
                case 2: return 'down'
                case 3: return 'double'
            }
        }
        if (typeof src === 'string') {
            const v = src.toUpperCase()
            if (v.includes('DOUBLE')) return 'double'
            if (v.includes('CLICK')) return 'click'
            if (v.includes('SCROLL_TOP') || v === 'UP') return 'up'
            if (v.includes('SCROLL_BOTTOM') || v === 'DOWN') return 'down'
        }
    }

    // 2. Fallback: List index change
    if (event.listEvent && typeof event.listEvent.currentSelectItemIndex === 'number') {
        const idx = event.listEvent.currentSelectItemIndex
        if (idx > menuIndex) return 'down'
        if (idx < menuIndex) return 'up'
        return 'click' // Unchanged index = click
    }

    // 3. Fallback: Text/Sys event presence
    if (event.textEvent || event.sysEvent) {
        return 'click'
    }

    return null
}

async function handleEvent(event: EvenHubEvent): Promise<void> {
    const rawSummary = JSON.stringify({
        list: event.listEvent ? { et: event.listEvent.eventType, idx: event.listEvent.currentSelectItemIndex } : null,
        text: event.textEvent ? { et: event.textEvent.eventType } : null,
        sys: event.sysEvent ? { et: event.sysEvent.eventType } : null,
        json: event.jsonData
    })
    appendEventLog(`Raw: ${rawSummary}`)

    if (currentView === 'menu' && event.listEvent && typeof event.listEvent.currentSelectItemIndex === 'number') {
        const sdkIdx = event.listEvent.currentSelectItemIndex
        if (sdkIdx >= 0 && sdkIdx < modules.length) {
            menuIndex = sdkIdx
        }
    }

    const eventType = detectEventType(event)
    if (!eventType) {
        appendEventLog(`Event: recognized (ignored/null)`)
        return
    }

    appendEventLog(`Event: ${eventType} (view=${currentView})`)

    if (eventType === 'double' && currentView !== 'menu') {
        if (activeModule) activeModule.leave()
        activeModule = null
        currentView = 'menu'
        menuIndex = 0
        appendEventLog('Back to menu')
        await showMenu()
        return
    } else if (currentView === 'menu') {
        await handleMenuEvent(eventType, hubSetStatus)
    } else if (activeModule) {
        await activeModule.handleEvent(eventType)
    }
}

async function handleMenuEvent(eventType: string, setStatus?: SetStatus): Promise<void> {
    if (eventType === 'up') {
        menuIndex = Math.max(0, menuIndex - 1)
        await showMenu()
    } else if (eventType === 'down') {
        menuIndex = Math.min(modules.length - 1, menuIndex + 1)
        await showMenu()
    } else if (eventType === 'click') {
        const mod = modules[menuIndex]
        if (mod) {
            appendEventLog(`>>> ENTERING ${mod.label}`)
            if (setStatus) setStatus(`Entering ${mod.label}...`)
            activeModule = mod
            currentView = mod.id
            try {
                await mod.enter()
                appendEventLog(`>>> ${mod.label} entered OK`)
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                appendEventLog(`>>> ${mod.label} FAILED: ${msg}`)
                // Fall back
                activeModule = null
                currentView = 'menu'
                await showMenu()
            }
        }
    }
}

// ── Rendering Primitives (Raw SDK) ─────────────────────────

// Fixed IDs for reliable updates
const ID_TITLE = 1
const ID_BODY_LIST = 2
const ID_BODY_TEXT = 3

async function renderList(title: string, items: string[], selectedIndex: number) {
    if (!bridge) return
    appendEventLog(`Rendering List: ${title}`)

    // Construct payload
    const itemContainer = new ListItemContainerProperty({
        itemCount: items.length,
        itemWidth: 568,
        isItemSelectBorderEn: 1, // 1 = enabled
        itemName: items
    })

    const container = new RebuildPageContainer({
        listObject: [new ListContainerProperty({
            containerID: ID_BODY_LIST,
            containerName: 'list_main',
            itemContainer: itemContainer,
            xPosition: 4,
            yPosition: 36,
            width: 568,
            height: 250,
            isEventCapture: 1
        })],
        textObject: [new TextContainerProperty({
            containerID: ID_TITLE,
            containerName: 'title',
            content: title,
            xPosition: 8,
            yPosition: 0,
            width: 560,
            height: 32,
            isEventCapture: 0
        })],
        // Ensure image object is cleared
        imageObject: []
    })

    try {
        if (isFirstRender) {
            // Must use CreateStartUpPageContainer for first render
            // Map Rebuild to Create
            const startup = new CreateStartUpPageContainer({
                containerTotalNum: 2,
                listObject: container.listObject,
                textObject: container.textObject,
                imageObject: []
            })
            const res = await bridge.createStartUpPageContainer(startup)
            if (res !== 0) throw new Error(`createStartUp res=${res}`)
            isFirstRender = false
            appendEventLog('First render (Create) success')
        } else {
            const success = await bridge.rebuildPageContainer(container)
            if (!success) throw new Error('rebuild returned false')
            appendEventLog('Rebuild List success')
        }
        ignoreEventsUntil = Date.now() + 500
    } catch (err) {
        console.error('Render list failed:', err)
        appendEventLog(`Render list failed: ${err}`)
    }
}

async function renderText(title: string, body: string) {
    if (!bridge) return
    appendEventLog(`Rendering Text: ${title}`)

    const container = new RebuildPageContainer({
        textObject: [
            new TextContainerProperty({
                containerID: ID_TITLE,
                containerName: 'title',
                content: title,
                xPosition: 8,
                yPosition: 0,
                width: 560,
                height: 32,
                isEventCapture: 0
            }),
            new TextContainerProperty({
                containerID: ID_BODY_TEXT, // Different ID from list
                containerName: 'text_body',
                content: body,
                xPosition: 8,
                yPosition: 36,
                width: 560,
                height: 250,
                isEventCapture: 1
            })
        ],
        // Send empty listObject to hide list
        listObject: [],
        imageObject: []
    })

    try {
        if (isFirstRender) {
            const startup = new CreateStartUpPageContainer({
                containerTotalNum: 2,
                listObject: [],
                textObject: container.textObject,
                imageObject: []
            })
            const res = await bridge.createStartUpPageContainer(startup)
            if (res !== 0) throw new Error(`createStartUp res=${res}`)
            isFirstRender = false
            appendEventLog('First render (Create) success')
        } else {
            const success = await bridge.rebuildPageContainer(container)
            if (!success) throw new Error('rebuild returned false')
            appendEventLog('Rebuild Text success')
        }
        ignoreEventsUntil = Date.now() + 500
    } catch (err) {
        console.error('Render text failed:', err)
        appendEventLog(`Render text failed: ${err}`)
    }
}

async function showMenu() {
    const items = modules.map(m => m.label)
    await renderList('── Even Hub ──', items, menuIndex)
}

function createRenderer(): HubRenderer {
    return {
        async renderMenu(items, idx) { await renderList('── Even Hub ──', items, idx) },
        async renderText(t, b) { await renderText(t, b) },
        async renderList(t, i, idx) { await renderList(t, i, idx) }
    }
}


// ── Public API ─────────────────────────────────────────────

export function createHubActions(setStatus: SetStatus): AppActions {
    hubSetStatus = setStatus
    const renderer = createRenderer()

    modules = [
        createClockModule(renderer, setStatus),
        createTimerModule(renderer, setStatus),
        createRedditModule(renderer, setStatus),
        createChessModule(renderer, setStatus),
        createRestApiModule(renderer, setStatus),
    ]

    // Initialize Bridge
    void (async () => {
        appendEventLog('Hub: waiting for bridge...')
        try {
            bridge = await waitForEvenAppBridge()
            if (bridge) {
                connected = true
                isFirstRender = true // Reset on new bridge connection
                bridge.onEvenHubEvent(handleEvent)
                currentView = 'menu'
                menuIndex = 0
                await showMenu()
                setStatus('Connected — use glasses to navigate')
                appendEventLog('Hub: Bridge connected')
            }
        } catch (err) {
            appendEventLog('Hub: Bridge init failed')
            console.error(err)
        }
    })()

    return {
        async connect() {
            if (connected && bridge) {
                // Reset to menu
                if (activeModule) { activeModule.leave(); activeModule = null }
                currentView = 'menu'
                menuIndex = 0
                await showMenu()
                return
            }
            // If not connected, the auto-connect above effectively handles it via reload
            // But we can try to re-init
            setStatus('Reconnecting...')
            try {
                bridge = await waitForEvenAppBridge()
                connected = true
                isFirstRender = true
                bridge.onEvenHubEvent(handleEvent)
                await showMenu()
                setStatus('Connected')
            } catch (err) {
                setStatus('Connection failed')
            }
        },
        async action() {
            if (currentView === 'menu') {
                await handleMenuEvent('click', setStatus)
            } else if (activeModule) {
                await activeModule.handleEvent('click')
            }
        },
    }
}
