import type { SubModuleFactory } from '../types'
import { appendEventLog } from '../../_shared/log'

export const createClockModule: SubModuleFactory = (renderer, setStatus) => {
    let intervalId: number | null = null
    let paused = false

    const fmt = new Intl.DateTimeFormat([], {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })

    const tick = async () => {
        if (paused) return
        const now = fmt.format(new Date())
        await renderer.renderText('Clock', now)
    }

    return {
        id: 'clock',
        label: 'Clock',
        async enter() {
            paused = false
            setStatus('Clock running — click to pause')
            appendEventLog('Clock: started')
            await tick()
            intervalId = window.setInterval(() => void tick(), 1000)
        },
        leave() {
            if (intervalId !== null) { window.clearInterval(intervalId); intervalId = null }
            paused = false
        },
        async handleEvent(eventType) {
            if (eventType === 'double') return // handled by hub (back to menu)
            if (eventType === 'click') {
                paused = !paused
                setStatus(paused ? 'Clock paused — click to resume' : 'Clock running — click to pause')
                appendEventLog(`Clock: ${paused ? 'paused' : 'resumed'}`)
                if (!paused) await tick()
            }
        },
    }
}
