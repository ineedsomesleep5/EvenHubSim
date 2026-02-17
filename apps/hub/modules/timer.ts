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
                        if (!minutes) return
                        await startTimer(minutes)
                        return
                    }

                    // Update list selection if needed (rendering handles it, but we track index)
                    // If user scrolls, 'idx' changes. We don't need to re-render list unless we want to force it
                    // But hub.ts re-renders list on menu, maybe we should too?
                    // Actually, G2 list is stateful on device?
                    // No, usually we need to update the display if we want to show selection change?
                    // The 'renderList' sends a static list with a selected index.
                    // If the user scrolls on the device, the device updates the highlight locally? 
                    // OR does it send an event and expect us to update?
                    // Usually it expects us to update.
                    // Let's re-render list on selection change (up/down)
                    if (eventType === 'up' || eventType === 'down') {
                        // eventType from hub is derived from main menu index, which is WRONG here.
                        // We must trust the `idx` from the event if valid.
                        if (typeof idx === 'number' && idx !== selectedIndex) {
                            selectedIndex = idx
                            await renderer.renderList('Select Duration', DURATION_LABELS, selectedIndex)
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
