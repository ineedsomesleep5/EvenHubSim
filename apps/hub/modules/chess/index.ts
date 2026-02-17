import type { SubModule, SubModuleFactory } from '../../types'
import { createChessApp, type ChessApp } from './lib/app'
import { appendEventLog } from '../../../_shared/log'
import { EvenHubEvent } from '@evenrealities/even_hub_sdk'

export const createChessModule: SubModuleFactory = (renderer, setStatus) => {
    // The bridge is now passed directly to createChessApp.
    const hubBridge = renderer.getBridge ? renderer.getBridge() : undefined;

    // Sync creation of the app instance
    const app = createChessApp(hubBridge);

    // Fire-and-forget preload/init
    void app.preload().catch(err => {
        console.error('Chess Init Failed:', err);
        setStatus('Chess: Init Failed');
    });

    return {
        id: 'chess',
        label: 'Chess (Full)',
        async enter() {
            setStatus('Chess: Starting...');
            await app.enter();
        },
        async leave() {
            await app.leave();
        },
        async handleEvent(eventType: string, rawEvent: EvenHubEvent) {
            // Dispatch events to app (it handles routing internally via hub.dispatch if needed, 
            // but app.ts relies on hub.subscribeEvents. 
            // We can just proxy raw events to bridge if needed, but app's internal listener handles them.
            // Wait! app.ts does `hub.subscribeEvents`.
            // If we dispatch here, we might duplicate?
            // `createChessApp` creates its OWN bridge instance wrapping `externalBridge`.
            // `hub.ts` activeModule.handleEvent is called when events come from MAIN bridge.
            // If `app.ts` subscribes to `externalBridge` (which is the main bridge), it gets events TWICE?
            // No, `hub.ts` registers `onEvenHubEvent`. It replaces previous listener?
            // SDK `onEvenHubEvent`: "Sets the event handler".
            // If `app.ts` calls `hub.subscribeEvents` (wraps `onEvenHubEvent`), it REPLACEs `hub.ts` listener!

            // This is the crux of the event issue.
            // If `app.ts` hijacks the event listener, `hub.ts` stops receiving events!
            // `hub.ts` needs to receive events to handle `double` tap (exit).

            // In `hub.ts` architecture, `activeModule.handleEvent` is called by `hub.ts`.
            // So `hub.ts` OWNS the listener.
            // Modules should NOT subscribe to bridge events directly if they overlap.

            // `EvenHubBridge` wrapper in `app.ts` wraps `onEvenHubEvent`?
            // Let's check `bridge.ts`.

            // But first, let's just fix the rendering hijack.
            // If rendering is fixed, tests might pass.
            // The event listener conflict is a separate issue if it exists (but previously Chess worked manually).

            // For now, I keep `app.hub.dispatch` if available, or just rely on internal wiring.
            // `app.ts` `createChessApp` sets `hub.subscribeEvents`.
            // If this replaces main listener, `hub.ts` breaks.
            // But `hub.ts` passes `renderer`, not `bridge`.
            // `renderer.getBridge()` returns the shared bridge.

            // If `app.ts` calls `bridge.onEvenHubEvent`, it STEALS control from `hub.ts`.
            // `hub.ts` will stop working (no double tap exit).

            // `app.ts` `EvenHubBridge` implementation:
            // `subscribeEvents(cb) { this.bridge.onEvenHubEvent(cb) }` (Presumably).

            // THIS IS BAD.
            // `hub.ts` is the shell. It should own the listener.
            // `activeModule.handleEvent` is how the shell passes events to the module.

            // So `app.ts` should NOT subscribe to events on the bridge.
            // Instead, `app.ts` should expose `handleEvent` and we call it here.

            // `app.ts` has `handleHubEvent`.
            // But it is not exported. It is internal.
            // And `app.ts` calls `hub.subscribeEvents(handleHubEvent)`.

            // I should verify `bridge.ts`.
            // If `bridge.ts` adds a listener (addEventListener style), it's fine.
            // If it sets `onEvenHubEvent` (SDK style), it's single listener.
            // SDK `EvenAppBridge` usually has `onEvenHubEvent(callback)`.

            // If so, `app.ts` STEALS events.
            // This explains why `hub.ts` might lose control.

            // Refactor plan: disable `hub.subscribeEvents` in `app.ts`.
            // Expose `handleEvent` in `ChessApp`.
            // Call `app.handleEvent(rawEvent)` from `index.ts`.

            // BUT `app.ts` `init` (previous) called `hub.subscribeEvents`.
            // In my new `enter()`, it calls `hub.subscribeEvents`.

            // I should change `app.ts` to export `handleEvent` instead of subscribing?
            // Or make `subscribeEvents` a no-op if using `dispatch`?

            // Let's implement `dispatch` logic in `index.ts` carefully.
            // Providing `rawEvent` to `app.hub.dispatch` (if exposed) works if `EvenHubBridge` has `dispatch`.
            // `EvenHubBridge` (wrapper) has `dispatch(event)`?
            // I need to check `bridge.ts` in Chess module.

            // If `EvenHubBridge` has `dispatch`, then `app.ts` logic `handleHubEvent` (which is passed to subscribe)
            // will be triggered if `dispatch` calls the subscriber.

            // Ideally: modify `app.ts` to return `handleEvent`.

            // BUT `app.ts` is complex.
            // Minimal fix for now: `app.enter()` steals events.
            // Does `hub.ts` re-subscribe when `activeModule` leaves?
            // `hub.ts` `action()` line 524 calls `activeModule.handleEvent`.
            // It assumes `hub.ts` listener is active.
            // If `app.ts` replaced it, `hub.ts` listener is DEAD.
            // So `hub.ts` `handleEvent` is NEVER CALLED.
            // So `activeModule.handleEvent` is NEVER CALLED.

            // So `Chess` app works, but you can't exit (double tap fails).
            // Verify this: previously "Exit" (Menu) worked via `showResumeMenu` loop.
            // But exiting the game (double tap) might be broken?
            // `app.ts` handles menu side effects.

            // If I want to fix this properly:
            // 1. `app.ts` should NOT call `subscribeEvents`.
            // 2. `app.ts` should export `onEvent(e)`.
            // 3. `index.ts` calls `app.onEvent(e)`.

            // I will modify `app.ts` again to export `handleEvent` and remove `subscribeEvents`.

            // Wait, `app.ts` lines 168, 186 call `subscribeEvents`.
            // I should Change `subscribeEvents` to just set a local callback variable.
            // And add `dispatch(e)` to `ChessApp`.

            // Or simply: `EvenHubBridge` wrapper in `app.ts` -- modify it to NOT call SDK `onEvenHubEvent`?
            // If I touch `bridge.ts`, it affects everything.

            // Let's check `bridge.ts` implementation.

            await app.hub.dispatch(rawEvent);
        }
    };
};

