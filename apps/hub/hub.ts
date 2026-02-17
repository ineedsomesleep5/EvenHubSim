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
    TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'
import type { AppActions, SetStatus } from '../_shared/app-types'
import { appendEventLog } from '../_shared/log'
import type { HubRenderer, SubModule } from './types'
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

    // PRIORITY: If a module is active, forward the event!
    // The module might understand events that the Hub doesn't (e.g. raw clicks with index)
    if (activeModule) {
        // Log what we are sending
        appendEventLog(`Forwarding to ${activeModule.label}: ${eventType ?? 'raw'} (json=${JSON.stringify(event.jsonData)})`)
        await activeModule.handleEvent(eventType ?? 'click', event)
        return
    }

    if (!eventType) {
        appendEventLog(`Event: recognized (ignored/null)`)
        return
    }

    appendEventLog(`Event: ${eventType} (view=${currentView})`)

    if (eventType === 'double' && currentView !== 'menu') {
        // Double tap on Hub overrides module (Back to Menu)
        // BUT strict forwarding above might prevent this if module swallows it?
        // Actually, let's allow "Double" to always bubble up if we want a global back button.
        // But for now, let's assume the module handles "double" if it wants to exit, 
        // OR we should check for 'double' specifically before forwarding?
        // Let's stick to the requested fix: Forward everything. 
        // We can implement "Double Tap = Exit" INSIDE the module's handleEvent if needed, 
        // or the module can return "not handled".
        // For now, `activeModule.handleEvent` is void.
        // Let's keep the GLOBAL double-tap check *before* forwarding if it is clearly a double tap.
    }

    // ... wait, if I forward everything, I disable the global back button?
    // Let's check for 'double' first.
    if (eventType === 'double') {
        if (activeModule) {
            activeModule.leave()
            activeModule = null
            currentView = 'menu'
            menuIndex = 0
            appendEventLog('Back to menu')
            await showMenu()
            return
        }
    }

    // Now forward
    if (activeModule) {
        await activeModule.handleEvent(eventType ?? 'click', event)
        return
    }

    // Menu logic
    if (currentView === 'menu' && eventType) {
        await handleMenuEvent(eventType, hubSetStatus)
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
                // FORCE CLEAN SLATE: Shutdown existing page (Menu) before entering module
                // This prevents layout conflicts (e.g. List vs Image IDs)
                if (bridge) {
                    try {
                        await bridge.shutDownPageContainer(0)
                        // Longer delay for BLE — glasses need time to process shutdown
                        await new Promise(r => setTimeout(r, 300))
                    } catch (e) {
                        console.warn('Pre-module shutdown failed', e)
                    }
                }

                isFirstRender = true; // FORCE CREATE on new module entry
                await mod.enter()
                appendEventLog(`>>> ${mod.label} entered OK`)
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                appendEventLog(`>>> ${mod.label} FAILED: ${msg}`)
                // Fall back
                activeModule = null
                currentView = 'menu'
                isFirstRender = true;
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
    isTextViewActive = false // Reset text view state
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
        // Always Try Rebuild First (Smoother)
        let success = false
        if (!isFirstRender) {
            try {
                success = await bridge.rebuildPageContainer(container)
                if (success) appendEventLog('Rebuild List success')
            } catch (err) {
                console.warn('Rebuild failed, falling back to create', err)
            }
        }

        if (!success) {
            // Fallback to Create if Rebuild fails or is first render
            // Map Rebuild to Create
            const startup = new CreateStartUpPageContainer({
                containerTotalNum: 2,
                listObject: container.listObject,
                textObject: container.textObject,
                imageObject: []
            })

            let res = await bridge.createStartUpPageContainer(startup)
            if (res !== 0) {
                // Try shutdown and retry
                appendEventLog(`Create failed (${res}), retrying with shutdown...`)
                try { await bridge.shutDownPageContainer(0); await new Promise(r => setTimeout(r, 100)); } catch { }
                res = await bridge.createStartUpPageContainer(startup)
            }

            if (res !== 0) throw new Error(`createStartUp res=${res}`)
            isFirstRender = false
            appendEventLog('Page Created (List) success')
        }
        ignoreEventsUntil = Date.now() + 500
    } catch (err) {
        console.error('Render list failed:', err)
        appendEventLog(`Render list failed: ${err}`)
    }
}

let lastTextTitle = ''
let lastTextBody = ''
let isTextViewActive = false

async function renderText(title: string, body: string) {
    if (!bridge) return

    // Optimization: If only body changed and we are in text view, update text directly
    if (isTextViewActive && lastTextTitle === title && lastTextBody !== body) {
        lastTextBody = body
        // ID_BODY_TEXT = 3
        try {
            await bridge.textContainerUpgrade(new TextContainerUpgrade({
                containerID: ID_BODY_TEXT,
                containerName: 'text_body',
                content: body
            }))
            return
        } catch (err) {
            console.warn('Fast text update failed, falling back to rebuild', err)
        }
    }

    appendEventLog(`Rendering Text: ${title}`)
    lastTextTitle = title
    lastTextBody = body

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
        // Always Try Rebuild First
        let success = false
        if (!isFirstRender) {
            try {
                success = await bridge.rebuildPageContainer(container)
                if (success) {
                    appendEventLog('Rebuild Text success')
                    isTextViewActive = true
                }
            } catch (err) {
                console.warn('Rebuild failed, falling back to create', err)
            }
        }

        if (!success) {
            const startup = new CreateStartUpPageContainer({
                containerTotalNum: 2,
                listObject: [],
                textObject: container.textObject,
                imageObject: []
            })

            let res = await bridge.createStartUpPageContainer(startup)
            if (res !== 0) {
                appendEventLog(`Create Text failed (${res}), retrying with shutdown...`)
                try { await bridge.shutDownPageContainer(0); await new Promise(r => setTimeout(r, 100)); } catch { }
                res = await bridge.createStartUpPageContainer(startup)
            }

            if (res !== 0) throw new Error(`createStartUp res=${res}`)
            isFirstRender = false
            isTextViewActive = true
            appendEventLog('Page Created (Text) success')
        }
        // Only ignore events on FULL rebuild/create, not partial updates
        ignoreEventsUntil = Date.now() + 500
    } catch (err) {
        console.error('Render text failed:', err)
        appendEventLog(`Render text failed: ${err}`)
        isTextViewActive = false
    }
}

async function showMenu() {
    const items = modules.map(m => m.label)
    await renderList('── Even Hub ──', items, menuIndex)
}

// ── Image Rendering ────────────────────────────────────────

import {
    ImageRawDataUpdate,
    ImageContainerProperty
} from '@evenrealities/even_hub_sdk'

// Constants for Chess Layout
const ID_CHESS_TEXT = 1
const ID_CHESS_IMG_TOP = 2
const ID_CHESS_IMG_BOT = 3

async function renderImages(updates: ImageRawDataUpdate[]) {
    if (!bridge) return
    isTextViewActive = false
    for (const update of updates) {
        try {
            await bridge.updateImageRawData(update)
        } catch (err) {
            console.error('Failed to update image:', err)
        }
    }
}

async function setupChessLayout() {
    if (!bridge) return
    appendEventLog('Setting up Chess Layout')

    // G2 display constants
    const DISPLAY_HEIGHT = 288
    const IMAGE_WIDTH = 200
    const IMAGE_HEIGHT = 100
    const RIGHT_X = 376
    const LEFT_WIDTH = 368
    const boardTopY = Math.floor((DISPLAY_HEIGHT - IMAGE_HEIGHT * 2) / 2)

    const container = new RebuildPageContainer({
        textObject: [
            new TextContainerProperty({
                containerID: ID_CHESS_TEXT,
                containerName: 'chess-hud',
                content: 'Chess\nLoading...',
                xPosition: 0,
                yPosition: 0,
                width: LEFT_WIDTH,
                height: DISPLAY_HEIGHT,
                isEventCapture: 1
            })
        ],
        imageObject: [
            new ImageContainerProperty({
                containerID: ID_CHESS_IMG_TOP,
                containerName: 'board-top',
                xPosition: RIGHT_X,
                yPosition: boardTopY,
                width: IMAGE_WIDTH,
                height: IMAGE_HEIGHT
            }),
            new ImageContainerProperty({
                containerID: ID_CHESS_IMG_BOT,
                containerName: 'board-bot',
                xPosition: RIGHT_X,
                yPosition: boardTopY + IMAGE_HEIGHT,
                width: IMAGE_WIDTH,
                height: IMAGE_HEIGHT
            })
        ],
        listObject: []
    })

    try {
        await bridge.rebuildPageContainer(container)
        ignoreEventsUntil = Date.now() + 500
    } catch (err) {
        console.error('Setup chess layout failed:', err)
    }
}

function createRenderer(): HubRenderer {
    return {
        async renderMenu(items, idx) { await renderList('── Even Hub ──', items, idx) },
        async renderText(t, b) { await renderText(t, b) },
        async renderList(t, i, idx) { await renderList(t, i, idx) },
        async renderImages(updates) { await renderImages(updates) },
        async setupChessLayout() { await setupChessLayout() },
        getBridge() { return bridge }
    }
}


// ── Public API ─────────────────────────────────────────────

export function createHubActions(setStatus: SetStatus): AppActions {
    hubSetStatus = setStatus
    const renderer = createRenderer()

    modules = [
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
