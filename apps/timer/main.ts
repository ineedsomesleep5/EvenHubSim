import { EvenBetterSdk } from '@jappyjan/even-better-sdk'
import type { AppActions, SetStatus } from '../_shared/app-types'
import { appendEventLog } from '../_shared/log'

type TimerClient = {
    mode: 'bridge' | 'mock'
    start: (durationSec: number) => Promise<void>
    stop: () => Promise<void>
}

let timerClient: TimerClient | null = null

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            reject(new Error(`Even bridge not detected within ${timeoutMs}ms`))
        }, timeoutMs)

        promise
            .then((value) => resolve(value))
            .catch((error) => reject(error))
            .finally(() => window.clearTimeout(timer))
    })
}

function formatTimer(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function getMockTimerClient(): TimerClient {
    return {
        mode: 'mock',
        async start() {
            console.log('[timer] mock start')
        },
        async stop() {
            console.log('[timer] mock stop')
        },
    }
}

function getBridgeTimerClient(setStatus: SetStatus): TimerClient {
    const sdk = new EvenBetterSdk()
    const page = sdk.createPage('hub-timer-page')

    const titleEl = page.addTextElement('Timer')
    titleEl
        .setPosition((position) => position.setX(8).setY(16))
        .setSize((size) => size.setWidth(280).setHeight(44))

    const timerText = page.addTextElement('00:00')
    timerText
        .setPosition((position) => position.setX(8).setY(76))
        .setSize((size) => size.setWidth(280).setHeight(56))

    const stateText = page.addTextElement('State: idle')
    stateText
        .setPosition((position) => position.setX(8).setY(140))
        .setSize((size) => size.setWidth(280).setHeight(40))

    let intervalId: number | null = null
    let remaining = 0
    let renderInFlight = false

    const renderTick = async () => {
        if (renderInFlight) return
        renderInFlight = true
        timerText.setContent(formatTimer(remaining))

        try {
            const updated = await timerText.updateWithEvenHubSdk()
            if (!updated) {
                await page.render()
            }
        } catch (error) {
            console.error('[timer] render error', error)
        } finally {
            renderInFlight = false
        }
    }

    const stopInterval = () => {
        if (intervalId !== null) {
            window.clearInterval(intervalId)
            intervalId = null
        }
    }

    return {
        mode: 'bridge',
        async start(durationSec: number) {
            stopInterval()
            remaining = durationSec
            stateText.setContent('State: running')
            await page.render()
            await renderTick()

            intervalId = window.setInterval(async () => {
                if (remaining <= 0) {
                    stopInterval()
                    stateText.setContent('State: done!')
                    timerText.setContent('00:00')
                    setStatus('Timer: finished!')
                    appendEventLog('Timer: finished')
                    await page.render()
                    return
                }
                remaining--
                setStatus(`Timer: ${formatTimer(remaining)} remaining`)
                await renderTick()
            }, 1000)
        },
        async stop() {
            stopInterval()
            stateText.setContent('State: stopped')
            setStatus(`Timer: stopped at ${formatTimer(remaining)}`)
            appendEventLog(`Timer: stopped at ${formatTimer(remaining)}`)
            await page.render()
        },
    }
}

async function initTimer(
    setStatus: SetStatus,
    timeoutMs = 4000,
): Promise<{ timer: TimerClient }> {
    try {
        await withTimeout(EvenBetterSdk.getRawBridge(), timeoutMs)

        if (!timerClient || timerClient.mode !== 'bridge') {
            timerClient = getBridgeTimerClient(setStatus)
        }

        return { timer: timerClient }
    } catch {
        return { timer: getMockTimerClient() }
    }
}

const DEFAULT_DURATION = 60 // 1 minute

export function createTimerActions(setStatus: SetStatus): AppActions {
    let isRunning = false

    return {
        async connect() {
            setStatus('Timer: connecting to Even bridge...')
            appendEventLog('Timer: connect requested')

            try {
                const { timer } = await initTimer(setStatus)
                timerClient = timer

                if (timer.mode === 'bridge') {
                    setStatus('Timer: connected. Press Start Timer to begin.')
                    appendEventLog('Timer: connected to bridge')
                } else {
                    setStatus('Timer: bridge not found. Running mock mode.')
                    appendEventLog('Timer: running in mock mode')
                }
            } catch (err) {
                console.error(err)
                setStatus('Timer: connection failed')
                appendEventLog('Timer: connection failed')
            }
        },
        async action() {
            if (!timerClient) {
                setStatus('Timer: not connected')
                appendEventLog('Timer: action blocked (not connected)')
                return
            }

            if (isRunning) {
                await timerClient.stop()
                isRunning = false
                appendEventLog('Timer: stopped')
            } else {
                isRunning = true
                setStatus(`Timer: starting ${DEFAULT_DURATION}s countdown...`)
                appendEventLog(`Timer: starting ${DEFAULT_DURATION}s countdown`)
                await timerClient.start(DEFAULT_DURATION)
            }
        },
    }
}
