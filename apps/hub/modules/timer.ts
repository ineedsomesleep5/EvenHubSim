import type { SubModuleFactory } from '../types'
import { appendEventLog } from '../../_shared/log'

export const createTimerModule: SubModuleFactory = (renderer, setStatus) => {
    let intervalId: number | null = null
    let remaining = 60
    let running = false

    const pad = (n: number) => n.toString().padStart(2, '0')
    const fmtTime = (s: number) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`

    const tick = async () => {
        if (remaining <= 0) {
            stop()
            setStatus('Timer: done!')
            appendEventLog('Timer: finished')
            await renderer.renderText('Timer', 'DONE!')
            return
        }
        remaining--
        setStatus(`Timer: ${fmtTime(remaining)}`)
        await renderer.renderText('Timer', fmtTime(remaining))
    }

    const stop = () => {
        if (intervalId !== null) { window.clearInterval(intervalId); intervalId = null }
        running = false
    }

    return {
        id: 'timer',
        label: 'Timer',
        async enter() {
            remaining = 60
            running = false
            setStatus('Timer ready — click to start (60s)')
            appendEventLog('Timer: ready')
            await renderer.renderText('Timer', fmtTime(remaining))
        },
        leave() { stop(); remaining = 60 },
        async handleEvent(eventType) {
            if (eventType === 'double') return
            if (eventType === 'click') {
                if (running) {
                    stop()
                    setStatus(`Timer stopped at ${fmtTime(remaining)} — click to restart`)
                    appendEventLog(`Timer: stopped at ${fmtTime(remaining)}`)
                } else {
                    remaining = 60
                    running = true
                    setStatus(`Timer: ${fmtTime(remaining)}`)
                    appendEventLog('Timer: started')
                    intervalId = window.setInterval(() => void tick(), 1000)
                    await renderer.renderText('Timer', fmtTime(remaining))
                }
            }
        },
    }
}
