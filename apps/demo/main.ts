import { initEven } from './even'
import type { AppActions, SetStatus } from '../_shared/app-types'
import { appendEventLog } from '../_shared/log'

type EvenInstance = Awaited<ReturnType<typeof initEven>>['even']

export function createDemoActions(setStatus: SetStatus): AppActions {
    let evenInstance: EvenInstance | null = null

    return {
        async connect() {
            setStatus('Connecting to Even bridge...')
            appendEventLog('Demo: connect requested')

            try {
                const { even } = await initEven()
                evenInstance = even

                await even.renderStartupScreen()

                if (even.mode === 'bridge') {
                    setStatus('Connected. Demo page rendered in Even Hub Simulator.')
                    appendEventLog('Demo: connected to bridge and rendered startup screen')
                } else {
                    setStatus('Bridge not found. Running browser-only mock mode.')
                    appendEventLog('Demo: running in mock mode (bridge unavailable)')
                }
            } catch (err) {
                console.error(err)
                setStatus('Connection failed')
                appendEventLog('Demo: connection failed')
            }
        },
        async action() {
            if (!evenInstance) {
                setStatus('Not connected')
                appendEventLog('Demo: action blocked (not connected)')
                return
            }

            setStatus('Sending demo action...')
            appendEventLog('Demo: sending action')

            await evenInstance.sendDemoAction()

            setStatus('Done')
            appendEventLog('Demo: action sent')
        },
    }
}
