/**
 * Unified Hub — Orchestrates the main menu and all sub-modules
 * on the Even G2 glasses display.
 *
 * Uses EvenBetterSdk (proven to render correctly on G2 glasses)
 * instead of the raw even_hub_sdk, which has tricky initialization
 * requirements (createStartUpPageContainer only once, etc.).
 */
import { EvenBetterSdk } from '@jappyjan/even-better-sdk'
import type { EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import type { AppActions, SetStatus } from '../_shared/app-types'
import { appendEventLog } from '../_shared/log'
import type { HubRenderer, SubModule } from './types'
import { createClockModule } from './modules/clock'
import { createTimerModule } from './modules/timer'
import { createRedditModule } from './modules/reddit'
import { createChessModule } from './modules/chess'
import { createRestApiModule } from './modules/restapi'

// ── SDK state ──────────────────────────────────────────────
let sdk: EvenBetterSdk | null = null
let connected = false

// ── Navigation state ───────────────────────────────────────
type View = 'menu' | string
let currentView: View = 'menu'
let menuIndex = 0
let modules: SubModule[] = []
let activeModule: SubModule | null = null

// ── Rendering via EvenBetterSdk ────────────────────────────

async function renderList(title: string, items: string[], selectedIndex: number): Promise<void> {
    if (!sdk) return
    const page = sdk.createPage('hub-page')

    // Title text element
    const titleEl = page.addTextElement(title)
    titleEl
        .setPosition(p => p.setX(8).setY(0))
        .setSize(s => s.setWidth(560).setHeight(32))

    // List element
    const listEl = page.addListElement(items)
    listEl
        .setPosition(p => p.setX(4).setY(36))
        .setSize(s => s.setWidth(568).setHeight(250))
    listEl.markAsEventCaptureElement()

    try {
        await page.render()
        appendEventLog(`[hub] rendered list: ${items.length} items, selected=${selectedIndex}`)
    } catch (err) {
        console.error('[hub] render list error', err)
        appendEventLog(`[hub] render error: ${err instanceof Error ? err.message : String(err)}`)
    }
}

async function renderText(title: string, body: string): Promise<void> {
    if (!sdk) return
    const page = sdk.createPage('hub-text')

    const titleEl = page.addTextElement(title)
    titleEl
        .setPosition(p => p.setX(8).setY(0))
        .setSize(s => s.setWidth(560).setHeight(32))

    const bodyEl = page.addTextElement(body)
    bodyEl
        .setPosition(p => p.setX(8).setY(36))
        .setSize(s => s.setWidth(560).setHeight(250))
    bodyEl.markAsEventCaptureElement()

    try {
        await page.render()
        appendEventLog(`[hub] rendered text: ${title}`)
    } catch (err) {
        console.error('[hub] render text error', err)
        appendEventLog(`[hub] render error: ${err instanceof Error ? err.message : String(err)}`)
    }
}

// ── HubRenderer for sub-modules ────────────────────────────

function createRenderer(): HubRenderer {
    return {
        async renderMenu(items, selectedIndex) {
            await renderList('── Even Hub ──', items, selectedIndex)
        },
        async renderText(title, body) {
            await renderText(title, body)
        },
        async renderList(title, items, selectedIndex) {
            await renderList(title, items, selectedIndex)
        },
    }
}

// ── Event handling ─────────────────────────────────────────

function detectEventType(event: EvenHubEvent): 'up' | 'down' | 'click' | 'double' | null {
    // Gather all possible eventType values
    const sources: unknown[] = []

    if (event.listEvent?.eventType !== undefined) sources.push(event.listEvent.eventType)
    if (event.textEvent?.eventType !== undefined) sources.push(event.textEvent.eventType)
    if (event.sysEvent?.eventType !== undefined) sources.push(event.sysEvent.eventType)

    // Also check jsonData for any eventType-like fields
    const raw = (event.jsonData ?? {}) as Record<string, unknown>
    for (const key of ['eventType', 'event_type', 'Event_Type', 'type']) {
        if (raw[key] !== undefined) sources.push(raw[key])
    }

    // Try each source
    for (const src of sources) {
        // Number check (enum values: 0=click, 1=scrollUp, 2=scrollDown, 3=doubleClick)
        const num = typeof src === 'number' ? src : (typeof src === 'string' && /^\d+$/.test(src) ? parseInt(src, 10) : null)
        if (num !== null) {
            switch (num) {
                case 0: return 'click'
                case 1: return 'up'
                case 2: return 'down'
                case 3: return 'double'
            }
        }

        // String check
        if (typeof src === 'string') {
            const v = src.toUpperCase()
            if (v.includes('DOUBLE')) return 'double'
            if (v.includes('CLICK')) return 'click'
            if (v.includes('SCROLL_TOP') || v === 'UP') return 'up'
            if (v.includes('SCROLL_BOTTOM') || v === 'DOWN') return 'down'
        }
    }

    // Infer from list selection index change
    if (event.listEvent && typeof event.listEvent.currentSelectItemIndex === 'number') {
        const idx = event.listEvent.currentSelectItemIndex
        if (idx > menuIndex) return 'down'
        if (idx < menuIndex) return 'up'
        return 'click'
    }

    return null
}

// Track last reported list index from the SDK
let lastListIndex = 0

async function handleEvent(event: EvenHubEvent): Promise<void> {
    // Log raw event for debugging
    const rawSummary = JSON.stringify({
        list: event.listEvent ? { et: event.listEvent.eventType, idx: event.listEvent.currentSelectItemIndex, name: event.listEvent.currentSelectItemName } : null,
        text: event.textEvent ? { et: event.textEvent.eventType } : null,
        sys: event.sysEvent ? { et: event.sysEvent.eventType } : null,
    })
    appendEventLog(`Raw: ${rawSummary}`)

    // Sync menuIndex from list selection (the SDK tracks the actual selection)
    if (currentView === 'menu' && event.listEvent && typeof event.listEvent.currentSelectItemIndex === 'number') {
        const sdkIdx = event.listEvent.currentSelectItemIndex
        if (sdkIdx >= 0 && sdkIdx < modules.length) {
            menuIndex = sdkIdx
        }
    }

    const eventType = detectEventType(event)
    if (!eventType) {
        appendEventLog(`Event: unrecognized`)
        return
    }

    appendEventLog(`Event: ${eventType} (view=${currentView}, menuIdx=${menuIndex})`)

    // Double-click always goes back to menu
    if (eventType === 'double' && currentView !== 'menu') {
        if (activeModule) activeModule.leave()
        activeModule = null
        currentView = 'menu'
        menuIndex = 0
        appendEventLog('Back to menu')
        await showMenu()
        return
    }

    if (currentView === 'menu') {
        await handleMenuEvent(eventType)
    } else if (activeModule) {
        await activeModule.handleEvent(eventType)
    }
}

async function handleMenuEvent(eventType: 'up' | 'down' | 'click' | 'double'): Promise<void> {
    if (eventType === 'up') {
        menuIndex = Math.max(0, menuIndex - 1)
        await showMenu()
    } else if (eventType === 'down') {
        menuIndex = Math.min(modules.length - 1, menuIndex + 1)
        await showMenu()
    } else if (eventType === 'click') {
        const mod = modules[menuIndex]
        if (mod) {
            activeModule = mod
            currentView = mod.id
            appendEventLog(`Entered: ${mod.label}`)
            await mod.enter()
        }
    }
}

async function showMenu(): Promise<void> {
    const items = modules.map((m) => m.label)
    await renderList('── Even Hub ──', items, menuIndex)
}

// ── Public API ─────────────────────────────────────────────

export function createHubActions(setStatus: SetStatus): AppActions {
    const renderer = createRenderer()

    // Create all sub-modules
    modules = [
        createClockModule(renderer, setStatus),
        createTimerModule(renderer, setStatus),
        createRedditModule(renderer, setStatus),
        createChessModule(renderer, setStatus),
        createRestApiModule(renderer, setStatus),
    ]

    // Eagerly initialize SDK
    sdk = new EvenBetterSdk()

    // Auto-connect: try immediately
    void (async () => {
        appendEventLog('Hub: auto-connecting...')
        try {
            const bridge = await EvenBetterSdk.getRawBridge()
            if (bridge) {
                connected = true
                sdk!.addEventListener((event) => void handleEvent(event))
                currentView = 'menu'
                menuIndex = 0
                await showMenu()
                setStatus('Connected — use glasses to navigate')
                appendEventLog('Hub: auto-connected')
            }
        } catch (err) {
            appendEventLog('Hub: auto-connect failed, press Connect')
            console.log('[hub] auto-connect failed:', err)
        }
    })()

    return {
        async connect() {
            if (connected) {
                // Reset to menu
                if (activeModule) { activeModule.leave(); activeModule = null }
                currentView = 'menu'
                menuIndex = 0
                await showMenu()
                setStatus('Connected — use glasses to navigate')
                return
            }

            setStatus('Connecting...')
            appendEventLog('Hub: manual connect')

            try {
                sdk = new EvenBetterSdk()
                const bridge = await EvenBetterSdk.getRawBridge()
                if (bridge) {
                    connected = true
                    sdk.addEventListener((event) => void handleEvent(event))
                    currentView = 'menu'
                    menuIndex = 0
                    await showMenu()
                    setStatus('Connected — use glasses to navigate')
                    appendEventLog('Hub: connected')
                } else {
                    setStatus('Bridge not available — mock mode')
                    appendEventLog('Hub: no bridge found')
                }
            } catch (err) {
                setStatus('Connection failed')
                appendEventLog(`Hub: error — ${err instanceof Error ? err.message : String(err)}`)
                console.error('[hub] connect error:', err)
            }
        },
        async action() {
            if (currentView === 'menu') {
                await handleMenuEvent('click')
            } else if (activeModule) {
                await activeModule.handleEvent('click')
            }
        },
    }
}
