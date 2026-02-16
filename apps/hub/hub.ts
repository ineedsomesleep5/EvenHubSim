/**
 * Unified Hub — Orchestrates the main menu and all sub-modules
 * on the Even G2 glasses display.
 *
 * Auto-connects to the Even bridge on page load (no button click needed).
 * Scroll fix: every navigation event calls rebuildPageContainer
 * with the updated currentSelectedItem so the glasses display
 * scrolls to follow the selection.
 */
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
import type { HubRenderer, SubModule } from './types'
import { createClockModule } from './modules/clock'
import { createTimerModule } from './modules/timer'
import { createRedditModule } from './modules/reddit'
import { createChessModule } from './modules/chess'
import { createRestApiModule } from './modules/restapi'

// ── SDK display state ──────────────────────────────────────
let bridge: EvenAppBridge | null = null
let pageRendered = false
let eventsRegistered = false
let connected = false

// ── Navigation state ───────────────────────────────────────
type View = 'menu' | string
let currentView: View = 'menu'
let menuIndex = 0
let modules: SubModule[] = []
let activeModule: SubModule | null = null

// ── Bridge helpers ─────────────────────────────────────────

function getRawEventType(event: EvenHubEvent): unknown {
    const raw = (event.jsonData ?? {}) as Record<string, unknown>
    return (
        event.listEvent?.eventType ??
        event.textEvent?.eventType ??
        event.sysEvent?.eventType ??
        (event as Record<string, unknown>).eventType ??
        raw.eventType ?? raw.event_type ?? raw.Event_Type ?? raw.type
    )
}

function normalizeEventType(raw: unknown, event: EvenHubEvent, prevIndex: number): 'up' | 'down' | 'click' | 'double' {
    if (typeof raw === 'number') {
        switch (raw) {
            case 0: return 'click'
            case 1: return 'up'
            case 2: return 'down'
            case 3: return 'double'
        }
    }
    if (typeof raw === 'string') {
        const v = raw.toUpperCase()
        if (v.includes('DOUBLE')) return 'double'
        if (v.includes('CLICK')) return 'click'
        if (v.includes('SCROLL_TOP') || v.includes('UP')) return 'up'
        if (v.includes('SCROLL_BOTTOM') || v.includes('DOWN')) return 'down'
    }
    if (raw === OsEventTypeList.DOUBLE_CLICK_EVENT) return 'double'
    if (raw === OsEventTypeList.CLICK_EVENT) return 'click'
    if (raw === OsEventTypeList.SCROLL_TOP_EVENT) return 'up'
    if (raw === OsEventTypeList.SCROLL_BOTTOM_EVENT) return 'down'
    if (event.listEvent) {
        const idx = typeof event.listEvent.currentSelectItemIndex === 'number'
            ? event.listEvent.currentSelectItemIndex : -1
        if (idx >= 0 && idx > prevIndex) return 'down'
        if (idx >= 0 && idx < prevIndex) return 'up'
        return 'click'
    }
    return 'click'
}

// ── Page rendering (with scroll fix) ───────────────────────

async function renderPage(
    b: EvenAppBridge,
    title: string,
    body: string,
    listItems?: string[],
    selectedIndex?: number,
): Promise<void> {
    const textObjects: TextContainerProperty[] = []
    const listObjects: ListContainerProperty[] = []
    let containerCount = 0
    let currentSelected = 0

    // Title
    containerCount++
    textObjects.push(new TextContainerProperty({
        containerID: containerCount,
        containerName: 'hub-title',
        content: title,
        xPosition: 8,
        yPosition: 0,
        width: 560,
        height: 32,
        isEventCapture: 0,
    }))

    if (listItems && listItems.length > 0) {
        // Status line above list
        if (body) {
            containerCount++
            textObjects.push(new TextContainerProperty({
                containerID: containerCount,
                containerName: 'hub-status',
                content: body,
                xPosition: 8,
                yPosition: 34,
                width: 560,
                height: 28,
                isEventCapture: 0,
            }))
        }

        // Scrollable list — currentSelectedItem makes glasses scroll
        containerCount++
        const yStart = body ? 64 : 36
        const listHeight = 200 - yStart
        const safeIndex = Math.max(0, Math.min((selectedIndex ?? 0), listItems.length - 1))
        currentSelected = safeIndex

        listObjects.push(new ListContainerProperty({
            containerID: containerCount,
            containerName: 'hub-list',
            itemContainer: new ListItemContainerProperty({
                itemCount: listItems.length,
                itemWidth: 566,
                isItemSelectBorderEn: 1,
                itemName: listItems,
            }),
            isEventCapture: 1,
            xPosition: 4,
            yPosition: yStart,
            width: 572,
            height: listHeight,
        }))
    } else {
        // Text-only page
        containerCount++
        textObjects.push(new TextContainerProperty({
            containerID: containerCount,
            containerName: 'hub-body',
            content: body,
            xPosition: 8,
            yPosition: 36,
            width: 560,
            height: 160,
            isEventCapture: 1,
        }))
    }

    const config = {
        containerTotalNum: containerCount,
        textObject: textObjects,
        listObject: listObjects,
        currentSelectedItem: currentSelected,
    }

    try {
        if (!pageRendered) {
            await b.createStartUpPageContainer(new CreateStartUpPageContainer(config))
            pageRendered = true
        } else {
            await b.rebuildPageContainer(new RebuildPageContainer(config))
        }
    } catch (err) {
        console.error('[hub] render error', err)
        appendEventLog(`[hub] render error: ${err instanceof Error ? err.message : String(err)}`)
    }
}

// ── HubRenderer for sub-modules ────────────────────────────

function createRenderer(): HubRenderer {
    return {
        async renderMenu(items, selectedIndex) {
            if (!bridge) return
            await renderPage(bridge, '── Even Hub ──', 'Scroll + Click', items, selectedIndex)
        },
        async renderText(title, body) {
            if (!bridge) return
            await renderPage(bridge, title, body)
        },
        async renderList(title, items, selectedIndex) {
            if (!bridge) return
            await renderPage(bridge, title, '', items, selectedIndex)
        },
    }
}

// ── Event handling ─────────────────────────────────────────

async function handleEvent(event: EvenHubEvent): Promise<void> {
    const rawType = getRawEventType(event)
    const eventType = normalizeEventType(rawType, event, menuIndex)

    appendEventLog(`Input: ${eventType}`)

    // Double-click always goes back to menu
    if (eventType === 'double' && currentView !== 'menu') {
        if (activeModule) activeModule.leave()
        activeModule = null
        currentView = 'menu'
        menuIndex = 0
        pageRendered = false
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
            pageRendered = false
            appendEventLog(`Entered: ${mod.label}`)
            await mod.enter()
        }
    }
}

async function showMenu(): Promise<void> {
    if (!bridge) return
    const items = modules.map((m) => m.label)
    await renderPage(bridge, '── Even Hub ──', 'Scroll + Click', items, menuIndex)
}

// ── Event registration ─────────────────────────────────────

function registerEvents(b: EvenAppBridge): void {
    if (eventsRegistered) return
    b.onEvenHubEvent((event) => void handleEvent(event))
    eventsRegistered = true
}

// ── Auto-connect logic ─────────────────────────────────────

async function tryConnect(setStatus: SetStatus): Promise<boolean> {
    try {
        appendEventLog('Hub: attempting bridge connection...')
        bridge = await waitForEvenAppBridge()
        registerEvents(bridge)
        currentView = 'menu'
        menuIndex = 0
        pageRendered = false
        await showMenu()
        connected = true
        setStatus('Connected — use glasses to navigate')
        appendEventLog('Hub: connected to bridge')
        return true
    } catch (err) {
        console.error('[hub] bridge connect failed', err)
        return false
    }
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

    // AUTO-CONNECT: Try to connect immediately on creation.
    // This is critical for the Even Hub WebView — the bridge
    // is available as soon as the page loads, no button needed.
    void tryConnect(setStatus).then((ok) => {
        if (!ok) {
            setStatus('Ready — press Connect to start')
            appendEventLog('Hub: auto-connect failed, press Connect manually')
        }
    })

    return {
        async connect() {
            if (connected) {
                // Already connected, re-render menu
                currentView = 'menu'
                menuIndex = 0
                pageRendered = false
                if (activeModule) { activeModule.leave(); activeModule = null }
                await showMenu()
                setStatus('Connected — use glasses to navigate')
                return
            }

            setStatus('Connecting to Even bridge...')
            appendEventLog('Hub: manual connect')

            const ok = await tryConnect(setStatus)
            if (!ok) {
                setStatus('Bridge not found — running in mock mode')
                appendEventLog('Hub: mock mode (no bridge)')
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
