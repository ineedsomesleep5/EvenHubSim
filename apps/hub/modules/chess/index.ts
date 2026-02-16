import type { SubModule, SubModuleFactory } from '../../types'
import { createChessApp, type ChessApp } from './lib/app'
import { appendEventLog } from '../../../_shared/log'
import { EvenHubEvent } from '@evenrealities/even_hub_sdk'

export const createChessModule: SubModuleFactory = (renderer, setStatus) => {
    let app: ChessApp | null = null

    return {
        id: 'chess',
        label: 'Chess (Full)',
        async enter() {
            setStatus('Chess: Initializing full app...')
            try {
                // Initialize the full EvenChess app logic
                // This handles its own rendering and input mapping
                app = await createChessApp()
                setStatus('Chess: Ready')
            } catch (err) {
                console.error('Failed to init Chess App:', err)
                setStatus('Chess: Error loading')
            }
        },
        async leave() {
            if (app) {
                await app.shutdown()
                app = null
            }
        },
        async handleEvent(eventType, rawEvent) {
            // We need to pass the raw event down if available
            // The rawEvent here is typed as 'any' in types.ts but we know it's EvenHubEvent
            if (app && rawEvent) {
                app.hub.dispatch(rawEvent as EvenHubEvent)
            }
        }
    }
}
