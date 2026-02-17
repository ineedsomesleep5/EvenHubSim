import type { SubModuleFactory } from '../types'
import { appendEventLog } from '../../_shared/log'
import { ImageRawDataUpdate } from '@evenrealities/even_hub_sdk'

const DURATIONS = [1, 3, 5, 10, 15, 30, 45, 60]
const DURATION_LABELS = DURATIONS.map(m => `${m} min`)

export const createTimerModule: SubModuleFactory = (renderer, setStatus) => {
    let intervalId: number | null = null
    let remaining = 60
    let running = false
    let mode: 'setup' | 'running' | 'finished' = 'setup'
    let selectedIndex = 0

    const pad = (n: number) => n.toString().padStart(2, '0')
    const fmtTime = (s: number) => {
        const m = Math.floor(s / 60)
        const sec = s % 60
        return `${pad(m)}:${pad(sec)}`
    }

    const startTimer = async (minutes: number) => {
        mode = 'running'
        remaining = minutes * 60
        running = true
        setStatus(`Timer: ${fmtTime(remaining)}`)
        appendEventLog(`Timer: started (${minutes}m)`)

        // Render initial state
        await renderer.renderText('Timer', fmtTime(remaining))

        // Start loop
        if (intervalId !== null) window.clearInterval(intervalId)
        intervalId = window.setInterval(() => void tick(), 1000)
    }

    const tick = async () => {
        if (remaining <= 0) {
            stop()
            mode = 'finished'
            setStatus('Timer: DONE!')
            appendEventLog('Timer: finished')
            await renderer.renderText('Timer', 'DONE!')
            return
        }
        remaining--
        setStatus(`Timer: ${fmtTime(remaining)}`)
        // Optimize: update display every second
        await renderer.renderText('Timer', fmtTime(remaining))
    }

    const stop = () => {
        if (intervalId !== null) { window.clearInterval(intervalId); intervalId = null }
        running = false
    }

    const showSetup = async () => {
        mode = 'setup'
        stop()
        setStatus('Select Duration')
        appendEventLog('Timer: setup screen')
        await renderer.renderList('Select Duration', DURATION_LABELS, selectedIndex)
    }

    return {
        id: 'timer',
        label: 'Timer',
        async enter() {
            // optimized: don't auto-start. Show list.
            await showSetup()
        },
        leave() {
            stop()
        },
        async handleEvent(eventType, event) {
            if (eventType === 'double') return

            if (mode === 'setup') {
                // In setup mode, we rely on the List events
                if (event && event.listEvent) {
                    const idx = event.listEvent.currentSelectItemIndex
                    const type = event.listEvent.eventType // 0 = click, 1 = up, 2 = down

                    if (typeof idx === 'number') {
                        selectedIndex = idx
                    }

                    // Check for click (Selection confirmed)
                    // SDK: 0=click (tap). Hub detectEventType returns 'click'
                    const isClick = type === 0 || eventType === 'click'

                    if (isClick) {
                        const minutes = DURATIONS[selectedIndex] || 1
                        await startTimer(minutes)
                        return
                    }

                    // Update list selection if needed (rendering handles it, but we track index)
                    if (eventType === 'up' || eventType === 'down') {
                        if (typeof idx === 'number') {
                            // Re-render to start fresh? No, Hub lists are native.
                            // But we might want to log it
                        }
                    }
                }
            } else if (mode === 'running') {
                if (eventType === 'click') {
                    // Click while running = Pause/Resume? Or Stop?
                    // User asked to "set timer".
                    // Let's make click = Stop/Reset to setup
                    stop()
                    await showSetup()
                }
            } else if (mode === 'finished') {
                if (eventType === 'click') {
                    await showSetup()
                }
            }
        },
    }
}
