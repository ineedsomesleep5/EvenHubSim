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
            // appendEventLog(`Timer Event: ${eventType} mode=${mode}`);

            if (mode === 'setup') {
                // Determine direction/action
                let dir: 'up' | 'down' | 'click' | null = null;

                if (event && event.listEvent) {
                    const type = event.listEvent.eventType;
                    const idx = event.listEvent.currentSelectItemIndex;

                    // Force sync tracking index if provided
                    if (typeof idx === 'number') selectedIndex = idx;

                    if (type === 0) dir = 'click';
                    else if (type === 1) dir = 'up';
                    else if (type === 2) dir = 'down';
                }

                // Fallback / standard events
                const type = eventType as string;
                if (type === 'click') dir = 'click';
                if (type === 'up') dir = 'up';
                if (type === 'down') dir = 'down';
                if (type === 'select') dir = 'click';

                if (dir === 'up') {
                    selectedIndex = Math.max(0, selectedIndex - 1);
                    await showSetup();
                } else if (dir === 'down') {
                    selectedIndex = Math.min(DURATIONS.length - 1, selectedIndex + 1);
                    await showSetup();
                } else if (dir === 'click') {
                    const minutes = DURATIONS[selectedIndex] || 1;
                    await startTimer(minutes);
                }
            } else if (mode === 'running') {
                const type = eventType as string;
                if (type === 'click' || type === 'back') {
                    stop();
                    await showSetup();
                }
            } else if (mode === 'finished') {
                const type = eventType as string;
                if (type === 'click' || type === 'back') {
                    await showSetup();
                }
            }
        },
    }
}
