/**
 * Even Hub Simulator — Main Entry Point
 *
 * Loads the unified hub app which contains all sub-modules
 * (Clock, Timer, Reddit, Chess, REST API) in a single
 * in-glasses menu. No dropdown — everything navigated
 * from the glasses themselves.
 */
import './glasses-mock'
import './styles.css'
import type { AppActions } from '../apps/_shared/app-types'
import { appendEventLog } from '../apps/_shared/log'

// ── DOM Elements ────────────────────────────────────────────
const $ = <T extends HTMLElement>(id: string): T =>
    document.getElementById(id) as T

const statusEl = $<HTMLParagraphElement>('status')
const statusDot = $<HTMLDivElement>('status-dot')
const btnConnect = $<HTMLButtonElement>('btn-connect')
const btnAction = $<HTMLButtonElement>('btn-action')
const btnConnectLabel = $<HTMLSpanElement>('btn-connect-label')
const btnActionLabel = $<HTMLSpanElement>('btn-action-label')
const btnClearLog = $<HTMLButtonElement>('btn-clear-log')
const eventLogEl = $<HTMLDivElement>('event-log')

// ── State ───────────────────────────────────────────────────
let actions: AppActions | null = null

// ── Helpers ─────────────────────────────────────────────────
function setStatus(text: string): void {
    statusEl.textContent = text

    const lower = text.toLowerCase()
    statusDot.className = 'status-indicator'
    if (lower.includes('connected') || lower.includes('running') || lower.includes('done') || lower.includes('ticking')) {
        statusDot.classList.add('status-indicator--connected')
    } else if (lower.includes('failed') || lower.includes('error') || lower.includes('not found')) {
        statusDot.classList.add('status-indicator--error')
    } else if (lower.includes('connecting') || lower.includes('fetching') || lower.includes('thinking')) {
        statusDot.classList.add('status-indicator--connecting')
    }
}

// ── Load Hub ────────────────────────────────────────────────
async function loadHub(): Promise<void> {
    setStatus('Loading hub...')
    appendEventLog('Loading Even Hub')

    try {
        const module = await import('../apps/hub/index')
        const app = module.default

        document.title = app.pageTitle ?? 'Even Hub Simulator'
        btnConnectLabel.textContent = app.connectLabel ?? 'Connect'
        btnActionLabel.textContent = app.actionLabel ?? 'Action'
        setStatus(app.initialStatus ?? 'Ready')

        actions = await app.createActions(setStatus)
        btnConnect.disabled = false
        btnAction.disabled = false
        appendEventLog('Hub loaded — press Connect')
    } catch (err) {
        console.error('Failed to load hub:', err)
        setStatus('Failed to load hub')
        appendEventLog(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
}

// ── Event Handlers ──────────────────────────────────────────
btnConnect.addEventListener('click', async () => {
    if (!actions) return
    btnConnect.disabled = true
    try {
        await actions.connect()
    } catch (err) {
        console.error('Connect error:', err)
        setStatus('Connection failed')
    } finally {
        btnConnect.disabled = false
    }
})

btnAction.addEventListener('click', async () => {
    if (!actions) return
    btnAction.disabled = true
    try {
        await actions.action()
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
void loadHub()
appendEventLog('Even Hub Simulator initialized')
