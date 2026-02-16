/**
 * Glasses Display Mock — Intercepts Even Hub SDK calls
 *
 * This module MUST be imported before any SDK code runs.
 * It installs a mock `window.flutter_inappwebview` so the
 * SDK's `EvenAppBridge.postMessage()` routes rendering
 * calls here instead of silently dropping them.
 *
 * Renders text, lists, and images to the #glasses-preview panel.
 */

// ── Types ──────────────────────────────────────────────────
interface ContainerDef {
    containerID?: number
    containerName?: string
    xPosition?: number
    yPosition?: number
    width?: number
    height?: number
    content?: string           // text containers
    imageData?: number[] | Uint8Array | string  // image containers
    itemContainer?: {
        itemName?: string[]
        itemCount?: number
        itemWidth?: number
        isItemSelectBorderEn?: number
    }
    isEventCapture?: number
}

interface PagePayload {
    containerTotalNum?: number
    listObject?: ContainerDef[]
    textObject?: ContainerDef[]
    imageObject?: ContainerDef[]
}

interface ImageUpdatePayload {
    containerID?: number
    containerName?: string
    imageData?: number[] | Uint8Array | string
}

interface TextUpgradePayload {
    containerID?: number
    containerName?: string
    content?: string
    contentOffset?: number
    contentLength?: number
}

interface SdkMessage {
    type: string
    method: string
    data?: any
}

// ── State ──────────────────────────────────────────────────
const containers = new Map<number, HTMLDivElement>()
let screenEl: HTMLDivElement | null = null

// G2 display dimensions
const SCREEN_W = 576
const SCREEN_H = 200

// ── Helpers ────────────────────────────────────────────────
function getScreen(): HTMLDivElement {
    if (screenEl) return screenEl

    const preview = document.getElementById('glasses-preview')
    if (!preview) {
        // Create a minimal screen if the DOM isn't ready yet
        const el = document.createElement('div')
        el.id = 'glasses-preview-screen'
        el.className = 'glasses-preview__screen'
        document.body.appendChild(el)
        screenEl = el
        return el
    }

    // Look for existing screen element or create one
    let screen = preview.querySelector('.glasses-preview__screen') as HTMLDivElement
    if (!screen) {
        // Clear placeholder content
        preview.innerHTML = ''
        screen = document.createElement('div')
        screen.className = 'glasses-preview__screen'
        preview.appendChild(screen)
    } else {
        // Remove placeholder if still present
        const placeholder = screen.querySelector('.glasses-preview__placeholder')
        if (placeholder) placeholder.remove()
    }

    screenEl = screen
    return screen
}

function clearScreen(): void {
    containers.clear()
    const screen = getScreen()
    screen.innerHTML = ''
}

function createContainerEl(def: ContainerDef, type: 'text' | 'image' | 'list'): HTMLDivElement {
    const el = document.createElement('div')
    el.className = `glasses-container glasses-container--${type}`
    el.dataset.containerId = String(def.containerID ?? 0)
    el.dataset.containerName = def.containerName ?? ''

    // Position and size (SDK uses absolute pixel positions within 576×200)
    el.style.position = 'absolute'
    el.style.left = `${((def.xPosition ?? 0) / SCREEN_W) * 100}%`
    el.style.top = `${((def.yPosition ?? 0) / SCREEN_H) * 100}%`
    if (def.width != null) el.style.width = `${(def.width / SCREEN_W) * 100}%`
    if (def.height != null) el.style.height = `${(def.height / SCREEN_H) * 100}%`

    return el
}

// ── Image Decoding ─────────────────────────────────────────
function decodeImageToDataUrl(raw: number[] | Uint8Array | string): string | null {
    let bytes: Uint8Array

    if (typeof raw === 'string') {
        // base64 encoded
        try {
            const bin = atob(raw)
            bytes = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        } catch {
            return null
        }
    } else if (raw instanceof Uint8Array) {
        bytes = raw
    } else if (Array.isArray(raw)) {
        bytes = new Uint8Array(raw.map(b => Number(b) & 0xff))
    } else {
        return null
    }

    if (bytes.length < 4) return null

    // Check for PNG magic bytes
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
        return URL.createObjectURL(blob)
    }

    // Check for BMP magic bytes ("BM")
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
        const blob = new Blob([new Uint8Array(bytes)], { type: 'image/bmp' })
        return URL.createObjectURL(blob)
    }

    // Try to treat as raw 1-bit monochrome bitmap (no header)
    // The Chess app sends BMP encoded data via encodeBmpPixels
    // which includes headers, so this fallback handles raw pixel arrays
    return tryDecodeRaw1Bit(bytes)
}

function tryDecodeRaw1Bit(bytes: Uint8Array): string | null {
    // Common board image sizes for Even G2: 576×100 (half board)
    const candidates = [
        { w: 576, h: 100 },
        { w: 576, h: 200 },
        { w: 288, h: 100 },
        { w: 288, h: 200 },
    ]

    for (const { w, h } of candidates) {
        const rowBytes = Math.ceil(w / 8)
        const expectedSize = rowBytes * h
        if (bytes.length === expectedSize) {
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')!
            const imgData = ctx.createImageData(w, h)

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const byteIdx = y * rowBytes + Math.floor(x / 8)
                    const bitIdx = 7 - (x % 8)
                    const on = (bytes[byteIdx] >> bitIdx) & 1
                    const px = (y * w + x) * 4
                    const v = on ? 255 : 0
                    imgData.data[px] = v
                    imgData.data[px + 1] = v
                    imgData.data[px + 2] = v
                    imgData.data[px + 3] = 255
                }
            }

            ctx.putImageData(imgData, 0, 0)
            return canvas.toDataURL('image/png')
        }
    }

    return null
}

// ── SDK Method Handlers ────────────────────────────────────
function handleCreateStartUpPage(data: PagePayload): number {
    clearScreen()
    buildPage(data)
    return 0 // StartUpPageCreateResult.success
}

function handleRebuildPage(data: PagePayload): boolean {
    clearScreen()
    buildPage(data)
    return true
}

function buildPage(data: PagePayload): void {
    const screen = getScreen()

    // Create list containers
    if (data.listObject) {
        for (const def of data.listObject) {
            const el = createContainerEl(def, 'list')
            const items = def.itemContainer?.itemName ?? []
            const ul = document.createElement('ul')
            ul.className = 'glasses-list'
            for (const item of items) {
                const li = document.createElement('li')
                li.textContent = item
                ul.appendChild(li)
            }
            el.appendChild(ul)
            screen.appendChild(el)
            containers.set(def.containerID ?? 0, el)
        }
    }

    // Create text containers
    if (data.textObject) {
        for (const def of data.textObject) {
            const el = createContainerEl(def, 'text')
            const span = document.createElement('span')
            span.className = 'glasses-text'
            span.textContent = def.content ?? ''
            el.appendChild(span)
            screen.appendChild(el)
            containers.set(def.containerID ?? 0, el)
        }
    }

    // Create image containers
    if (data.imageObject) {
        for (const def of data.imageObject) {
            const el = createContainerEl(def, 'image')
            const img = document.createElement('img')
            img.className = 'glasses-image'
            img.alt = def.containerName ?? 'image'
            el.appendChild(img)
            screen.appendChild(el)
            containers.set(def.containerID ?? 0, el)
        }
    }

    console.log('[GlassesMock] Page built with', containers.size, 'containers')
}

function handleUpdateImageRawData(data: ImageUpdatePayload): string {
    const id = data.containerID ?? 0
    const el = containers.get(id)

    if (!el) {
        console.warn('[GlassesMock] Image update for unknown container', id)
        return 'success' // Don't block the app
    }

    let img = el.querySelector('img') as HTMLImageElement
    if (!img) {
        img = document.createElement('img')
        img.className = 'glasses-image'
        el.appendChild(img)
    }

    if (data.imageData) {
        const dataUrl = decodeImageToDataUrl(data.imageData)
        if (dataUrl) {
            // Revoke previous blob URL if any
            if (img.src && img.src.startsWith('blob:')) {
                URL.revokeObjectURL(img.src)
            }
            img.src = dataUrl
        } else {
            console.warn('[GlassesMock] Failed to decode image for container', id, 'size:',
                Array.isArray(data.imageData) ? data.imageData.length :
                    data.imageData instanceof Uint8Array ? data.imageData.length :
                        typeof data.imageData)
        }
    }

    return 'success' // ImageRawDataUpdateResult.success
}

function handleTextContainerUpgrade(data: TextUpgradePayload): boolean {
    const id = data.containerID ?? 0
    const el = containers.get(id)

    if (!el) {
        console.warn('[GlassesMock] Text update for unknown container', id)
        return true
    }

    let span = el.querySelector('span') as HTMLSpanElement
    if (!span) {
        span = document.createElement('span')
        span.className = 'glasses-text'
        el.appendChild(span)
    }

    if (data.content != null) {
        // Handle partial updates via offset
        if (data.contentOffset != null && data.contentOffset > 0) {
            const existing = span.textContent ?? ''
            const before = existing.substring(0, data.contentOffset)
            span.textContent = before + data.content
        } else {
            span.textContent = data.content
        }
    }

    return true
}

function handleShutDown(_data: any): boolean {
    clearScreen()
    return true
}

// ── Message Router ─────────────────────────────────────────
function handleSdkMessage(jsonStr: string): any {
    let msg: SdkMessage
    try {
        msg = JSON.parse(jsonStr)
    } catch {
        console.warn('[GlassesMock] Failed to parse SDK message')
        return undefined
    }

    if (msg.type !== 'call_even_app_method') {
        // Not a rendering call — pass through
        return undefined
    }

    const data = msg.data ?? {}

    switch (msg.method) {
        case 'createStartUpPageContainer':
            return handleCreateStartUpPage(data)

        case 'rebuildPageContainer':
            return handleRebuildPage(data)

        case 'updateImageRawData':
            return handleUpdateImageRawData(data)

        case 'textContainerUpgrade':
            return handleTextContainerUpgrade(data)

        case 'shutDownPageContainer':
            return handleShutDown(data)

        case 'getUserInfo':
            return { uid: 1, name: 'Simulator User', avatar: '', country: 'US' }

        case 'getGlassesInfo':
        case 'getDeviceInfo':
            return { model: 'g2', sn: 'SIM001', status: { connectType: 'connected', isWearing: true, batteryLevel: 100, isCharging: false, isInCase: false } }

        case 'setLocalStorage':
            return true

        case 'getLocalStorage':
            return ''

        default:
            console.log('[GlassesMock] Unhandled method:', msg.method)
            return undefined
    }
}

// ── Install Mock ───────────────────────────────────────────
; (function installMock() {
    if (typeof window === 'undefined') return

        // Install the mock flutter_inappwebview BEFORE the SDK reads it
        ; (window as any).flutter_inappwebview = {
            callHandler(name: string, jsonPayload: string): Promise<any> {
                if (name === 'evenAppMessage') {
                    const result = handleSdkMessage(jsonPayload)
                    return Promise.resolve(result)
                }
                console.warn('[GlassesMock] Unknown callHandler name:', name)
                return Promise.resolve(undefined)
            }
        }

    console.log('[GlassesMock] Mock flutter_inappwebview installed')
})()
