import { EvenBetterSdk } from '@jappyjan/even-better-sdk'
import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { appendEventLog } from '../_shared/log'

type RuntimeMode = 'bridge' | 'mock'

export type EvenClient = {
    mode: RuntimeMode
    renderStartupScreen: () => Promise<void>
    sendDemoAction: () => Promise<void>
}

export type EvenInitOptions = {
    pageId?: string
    title?: string
    subtitle?: string
    inputPrompt?: string
    actionLabel?: string
}

const DEFAULT_OPTIONS: Required<EvenInitOptions> = {
    pageId: 'hub-simulator-demo',
    title: 'Even Hub Demo',
    subtitle: 'Running without a real device',
    inputPrompt: 'Select...',
    actionLabel: 'Action sent',
}

function normalizeOptions(options?: EvenInitOptions): Required<EvenInitOptions> {
    return {
        pageId: options?.pageId ?? DEFAULT_OPTIONS.pageId,
        title: options?.title ?? DEFAULT_OPTIONS.title,
        subtitle: options?.subtitle ?? DEFAULT_OPTIONS.subtitle,
        inputPrompt: options?.inputPrompt ?? DEFAULT_OPTIONS.inputPrompt,
        actionLabel: options?.actionLabel ?? DEFAULT_OPTIONS.actionLabel,
    }
}

const bridgeClients = new Map<string, EvenClient>()

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

function getMockClient(): EvenClient {
    return {
        mode: 'mock',
        async renderStartupScreen() {
            console.log('[mock] Startup screen render skipped (no Even bridge)')
        },
        async sendDemoAction() {
            console.log('[mock] Demo action invoked')
        },
    }
}

function getBridgeClient(options?: EvenInitOptions): EvenClient {
    const resolvedOptions = normalizeOptions(options)
    const sdk = new EvenBetterSdk()
    const page = sdk.createPage(resolvedOptions.pageId)

    const title = page.addTextElement(`${resolvedOptions.title} - ${resolvedOptions.subtitle}`)
    title
        .setPosition((position) => position.setX(8).setY(16))
        .setSize((size) => size.setWidth(572).setHeight(44))

    const lastInput = page.addTextElement('Last input: waiting...')
    lastInput
        .setPosition((position) => position.setX(8).setY(64))
        .setSize((size) => size.setWidth(572).setHeight(44))

    const inputItems = [
        resolvedOptions.inputPrompt,
        'Even', 'Hub', 'Simulator', 'Demo',
    ]

    const inputTarget = page.addListElement(inputItems)
    inputTarget
        .setPosition((position) => position.setX(4).setY(116))
        .setSize((size) => size.setWidth(572).setHeight(44))
        .markAsEventCaptureElement()
    inputTarget.setItemWidth(566)
    inputTarget.setIsItemSelectBorderEn(true)

    const selectedItemText = page.addTextElement('-')
    selectedItemText
        .setPosition((position) => position.setX(8).setY(168))
        .setSize((size) => size.setWidth(572).setHeight(44))

    const getRawEventType = (event: EvenHubEvent): unknown => {
        const raw = (event.jsonData ?? {}) as Record<string, unknown>

        return (
            event.listEvent?.eventType ??
            event.textEvent?.eventType ??
            event.sysEvent?.eventType ??
            (event as Record<string, unknown>).eventType ??
            raw.eventType ??
            raw.event_type ??
            raw.Event_Type ??
            raw.type
        )
    }

    const normalizeEventType = (rawEventType: unknown): OsEventTypeList | undefined => {
        if (typeof rawEventType === 'number') {
            switch (rawEventType) {
                case 0:
                    return OsEventTypeList.CLICK_EVENT
                case 1:
                    return OsEventTypeList.SCROLL_TOP_EVENT
                case 2:
                    return OsEventTypeList.SCROLL_BOTTOM_EVENT
                case 3:
                    return OsEventTypeList.DOUBLE_CLICK_EVENT
                default:
                    return undefined
            }
        }

        if (typeof rawEventType === 'string') {
            const value = rawEventType.toUpperCase()
            if (value.includes('DOUBLE')) return OsEventTypeList.DOUBLE_CLICK_EVENT
            if (value.includes('CLICK')) return OsEventTypeList.CLICK_EVENT
            if (value.includes('SCROLL_TOP') || value.includes('UP')) return OsEventTypeList.SCROLL_TOP_EVENT
            if (value.includes('SCROLL_BOTTOM') || value.includes('DOWN')) return OsEventTypeList.SCROLL_BOTTOM_EVENT
        }

        return undefined
    }

    const eventLabel = (eventType: OsEventTypeList | undefined): string => {
        switch (eventType) {
            case OsEventTypeList.SCROLL_TOP_EVENT:
                return 'Up'
            case OsEventTypeList.SCROLL_BOTTOM_EVENT:
                return 'Down'
            case OsEventTypeList.CLICK_EVENT:
                return 'Click (select)'
            case OsEventTypeList.DOUBLE_CLICK_EVENT:
                return 'DoubleClick (clean)'
            default:
                return 'Unknown'
        }
    }

    let lastListIndex: number | undefined

    const handleInputEvent = async (event: EvenHubEvent): Promise<void> => {
        const rawEventType = getRawEventType(event)
        const normalizedEventType = normalizeEventType(rawEventType)
        const selectedItemIndex = event.listEvent?.currentSelectItemIndex
        const selectedItemNameFromEvent = event.listEvent?.currentSelectItemName
        const prevListIndex = lastListIndex
        const selectedItemIndexResolved =
            typeof selectedItemIndex === 'number'
                ? selectedItemIndex
                : typeof selectedItemNameFromEvent === 'string'
                    ? inputItems.indexOf(selectedItemNameFromEvent)
                    : -1
        const selectedItemName = selectedItemNameFromEvent ??
            (typeof selectedItemIndex === 'number'
                ? inputItems[selectedItemIndex]
                : typeof lastListIndex === 'number'
                    ? inputItems[lastListIndex]
                    : undefined)

        let eventType: OsEventTypeList | undefined = normalizedEventType

        if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
            // Keep explicit double-click classification.
        } else if (event.listEvent) {
            const hasResolvedIndex = selectedItemIndexResolved >= 0
            const prevIndex = typeof prevListIndex === 'number' ? prevListIndex : selectedItemIndexResolved

            if (hasResolvedIndex && typeof prevIndex === 'number' && selectedItemIndexResolved > prevIndex) {
                eventType = OsEventTypeList.SCROLL_BOTTOM_EVENT
            } else if (hasResolvedIndex && typeof prevIndex === 'number' && selectedItemIndexResolved < prevIndex) {
                eventType = OsEventTypeList.SCROLL_TOP_EVENT
            } else {
                eventType = OsEventTypeList.CLICK_EVENT
            }
        }

        if (selectedItemIndexResolved >= 0) {
            lastListIndex = selectedItemIndexResolved
        }

        const label = eventLabel(eventType)

        console.log('[even] input event', {
            label,
            rawEventType,
            selectedItemName,
            event,
        })

        const selectedSuffix = selectedItemName ? ` (${selectedItemName})` : ''
        const unknownSuffix = label === 'Unknown' ? ` (${String(rawEventType ?? 'n/a')})` : ''
        appendEventLog(`Demo input: ${label}${selectedSuffix || unknownSuffix}`)

        lastInput.setContent(`Last input: ${label}${unknownSuffix}`)
        const isDoubleClick = eventType === OsEventTypeList.DOUBLE_CLICK_EVENT
        if (isDoubleClick) {
            selectedItemText.setContent('-')
        } else {
            selectedItemText.setContent(`${selectedItemName ?? '-'}`)
        }

        const inputUpdated = await lastInput.updateWithEvenHubSdk()
        const selectedUpdated = await selectedItemText.updateWithEvenHubSdk()
        if (!inputUpdated || !selectedUpdated) {
            await page.render()
        }
    }

    // Use SDK event listener for both simulator and device bridge events.
    sdk.addEventListener((event) => {
        void handleInputEvent(event)
    })

    return {
        mode: 'bridge',
        async renderStartupScreen() {
            await page.render()
        },
        async sendDemoAction() {
            appendEventLog(`Demo: ${resolvedOptions.actionLabel}`)
        },
    }
}

export async function initEven(
    timeoutMs = 4000,
    options?: EvenInitOptions,
): Promise<{ even: EvenClient }> {
    try {
        await withTimeout(EvenBetterSdk.getRawBridge(), timeoutMs)
        const clientKey = JSON.stringify(normalizeOptions(options))

        if (!bridgeClients.has(clientKey)) {
            bridgeClients.set(clientKey, getBridgeClient(options))
        }

        return { even: bridgeClients.get(clientKey)! }
    } catch {
        return { even: getMockClient() }
    }
}
