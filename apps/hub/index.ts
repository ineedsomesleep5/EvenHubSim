import type { AppModule } from '../_shared/app-types'
import { createHubActions } from './hub'

export const app: AppModule = {
    id: 'hub',
    name: 'Even Hub',
    pageTitle: 'Even Hub Simulator',
    connectLabel: 'Connect to Glasses',
    actionLabel: 'Action',
    initialStatus: 'Ready — press Connect to start',
    createActions: createHubActions,
}

export default app
