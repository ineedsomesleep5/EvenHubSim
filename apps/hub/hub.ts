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

function normalizeEventType(event: EvenHubEvent): 'up' | 'down' | 'click' | 'double' | null {
    // Extract event type from all possible locations
    const rawType =
        event.listEvent?.eventType ??
        event.textEvent?.eventType ??
        event.sysEvent?.eventType

    if (rawType === OsEventTypeList.CLICK_EVENT) return 'click'
    if (rawType === OsEventTypeList.SCROLL_TOP_EVENT) return 'up'
    if (rawType === OsEventTypeList.SCROLL_BOTTOM_EVENT) return 'down'
    if (rawType === OsEventTypeList.DOUBLE_CLICK_EVENT) return 'double'

    // Try jsonData fallback
    const raw = event.jsonData as Record<string, unknown> | undefined
    if (raw) {
        const et = raw.eventType ?? raw.event_type ?? raw.Event_Type ?? raw.type
        if (typeof et === 'number') {
            switch (et) { case 0: return 'click'; case 1: return 'up'; case 2: return 'down'; case 3: return 'double' }
        }
        if (typeof et === 'string') {
            const v = et.toUpperCase()
            if (v.includes('DOUBLE')) return 'double'
            if (v.includes('CLICK')) return 'click'
            if (v.includes('SCROLL_TOP') || v.includes('UP')) return 'up'
            if (v.includes('SCROLL_BOTTOM') || v.includes('DOWN')) return 'down'
        }
    }

    // Infer from listEvent index change
    if (event.listEvent && typeof event.listEvent.currentSelectItemIndex === 'number') {
        const idx = event.listEvent.currentSelectItemIndex
        if (idx > menuIndex) return 'down'
        if (idx < menuIndex) return 'up'
        return 'click'
    }

    return null
}

async function handleEvent(event: EvenHubEvent): Promise<void> {
    const eventType = normalizeEventType(event)
    if (!eventType) {
        appendEventLog(`Input: unknown event ${JSON.stringify(event.jsonData ?? {}).slice(0, 80)}`)
        return
    }

    appendEventLog(`Input: ${eventType}`)

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
