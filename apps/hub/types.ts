import type { AppActions, SetStatus } from '../_shared/app-types'
import { appendEventLog } from '../_shared/log'

export type SubModule = {
    id: string
    label: string
    enter: () => Promise<void>
    leave: () => void
    handleEvent: (eventType: 'up' | 'down' | 'click' | 'double', rawEvent?: any) => Promise<void>
}

import { ImageRawDataUpdate } from '@evenrealities/even_hub_sdk'

export interface HubRenderer {
    renderMenu(items: string[], selectedIndex: number): Promise<void>
    renderText(title: string, body: string): Promise<void>
    renderList(title: string, items: string[], selectedIndex: number): Promise<void>
    renderImages?(updates: ImageRawDataUpdate[]): Promise<void>
    setupChessLayout?(): Promise<void>
}

export type SubModuleFactory = (renderer: HubRenderer, setStatus: SetStatus) => SubModule
