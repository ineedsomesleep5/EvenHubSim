/**
 * Even Hub Simulator — Main App Loader & Page Controller
 *
 * Discovers registered apps, populates the app switcher, and wires
 * the Connect / Action buttons to the active app's createActions.
 */
import './styles.css'
import type { AppModule, AppActions } from '../apps/_shared/app-types'
import { appendEventLog } from '../apps/_shared/log'

// ── App Registry ────────────────────────────────────────────
// Maps app IDs to lazy dynamic imports. Add new apps here.
const APP_REGISTRY: Record<string, () => Promise<{ default: AppModule }>> = {
    demo: () => import('../apps/demo/index'),
    clock: () => import('../apps/clock/index'),
    timer: () => import('../apps/timer/index'),
    restapi: () => import('../apps/restapi/index'),
}

// ── DOM Elements ────────────────────────────────────────────
const $ = <T extends HTMLElement>(id: string): T =>
    document.getElementById(id) as T

const appSelect = $<HTMLSelectElement>('app-select')
const pageTitle = $<HTMLHeadingElement>('page-title')
const statusEl = $<HTMLParagraphElement>('status')
const statusDot = $<HTMLDivElement>('status-dot')
const btnConnect = $<HTMLButtonElement>('btn-connect')
const btnAction = $<HTMLButtonElement>('btn-action')
const btnConnectLabel = $<HTMLSpanElement>('btn-connect-label')
const btnActionLabel = $<HTMLSpanElement>('btn-action-label')
const btnClearLog = $<HTMLButtonElement>('btn-clear-log')
const eventLogEl = $<HTMLDivElement>('event-log')

// ── State ───────────────────────────────────────────────────
let activeApp: AppModule | null = null
let activeActions: AppActions | null = null

// ── Helpers ─────────────────────────────────────────────────
function setStatus(text: string): void {
    statusEl.textContent = text

    // Auto-detect status indicator state from text
    const lower = text.toLowerCase()
    statusDot.className = 'status-indicator'
    if (lower.includes('connected') || lower.includes('running') || lower.includes('done') || lower.includes('ticking')) {
        statusDot.classList.add('status-indicator--connected')
    } else if (lower.includes('failed') || lower.includes('error') || lower.includes('not connected')) {
        statusDot.classList.add('status-indicator--error')
    } else if (lower.includes('connecting') || lower.includes('toggling') || lower.includes('sending')) {
        statusDot.classList.add('status-indicator--connecting')
    }
}

function setButtonsEnabled(enabled: boolean): void {
    btnConnect.disabled = !enabled
    btnAction.disabled = !enabled
}

// ── App Loading ─────────────────────────────────────────────
async function loadApp(appId: string): Promise<void> {
    const loader = APP_REGISTRY[appId]
    if (!loader) {
        setStatus(`Unknown app: ${appId}`)
        return
    }

    setButtonsEnabled(false)
    setStatus('Loading app…')
    appendEventLog(`Loading app: ${appId}`)

    try {
        const module = await loader()
        const app = module.default
        activeApp = app
        activeActions = null

        // Update UI with app metadata
        pageTitle.textContent = app.pageTitle ?? `Even Hub ${app.name}`
        document.title = app.pageTitle ?? `Even Hub ${app.name}`
        btnConnectLabel.textContent = app.connectLabel ?? 'Connect'
        btnActionLabel.textContent = app.actionLabel ?? 'Action'
        setStatus(app.initialStatus ?? `${app.name} ready`)

        // Pre-create actions
        activeActions = await app.createActions(setStatus)
        setButtonsEnabled(true)
        appendEventLog(`App loaded: ${app.name}`)
    } catch (err) {
        console.error(`Failed to load app "${appId}":`, err)
        setStatus(`Failed to load ${appId}`)
        appendEventLog(`Error loading ${appId}: ${err instanceof Error ? err.message : String(err)}`)
    }
}

// ── Populate App Selector ───────────────────────────────────
function populateAppSelector(): void {
    appSelect.innerHTML = ''
    const appIds = Object.keys(APP_REGISTRY)

    for (const id of appIds) {
        const option = document.createElement('option')
        option.value = id
        // Capitalize first letter
        option.textContent = id.charAt(0).toUpperCase() + id.slice(1)
        appSelect.appendChild(option)
    }
}

// ── Event Handlers ──────────────────────────────────────────
appSelect.addEventListener('change', () => {
    const appId = appSelect.value
    if (appId) {
        // Update URL param
        const url = new URL(window.location.href)
        url.searchParams.set('app', appId)
        window.history.replaceState(null, '', url.toString())
        void loadApp(appId)
    }
})

btnConnect.addEventListener('click', async () => {
    if (!activeActions) return
    btnConnect.disabled = true
    try {
        await activeActions.connect()
    } catch (err) {
        console.error('Connect error:', err)
        setStatus('Connection failed')
    } finally {
        btnConnect.disabled = false
    }
})

btnAction.addEventListener('click', async () => {
    if (!activeActions) return
    btnAction.disabled = true
    try {
        await activeActions.action()
    } catch (err) {
        console.error('Action error:', err)
        setStatus('Action failed')
    } finally {
        btnAction.disabled = false
    }
})

btnClearLog.addEventListener('click', () => {
    eventLogEl.innerHTML = '<p class="event-log__empty">No events yet</p>'
})

// ── Initialize ──────────────────────────────────────────────
function init(): void {
    populateAppSelector()

    // Check URL param for app selection
    const params = new URLSearchParams(window.location.search)
    const requestedApp = params.get('app')
    const defaultApp = requestedApp && APP_REGISTRY[requestedApp] ? requestedApp : 'demo'

    appSelect.value = defaultApp
    void loadApp(defaultApp)

    appendEventLog('Even Hub Simulator initialized')
}

init()
