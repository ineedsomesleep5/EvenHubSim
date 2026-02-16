/**
 * EvenHubBridge — SDK lifecycle and container operations.
 */

import {
  waitForEvenAppBridge,
  TextContainerUpgrade,
  type EvenAppBridge as EvenAppBridgeType,
  type CreateStartUpPageContainer,
  type RebuildPageContainer,
  type ImageRawDataUpdate,
  type EvenHubEvent,
  ImageRawDataUpdateResult,
} from '@evenrealities/even_hub_sdk';
import { appendEventLog } from '../../../../../_shared/log';

export type EvenHubEventHandler = (event: EvenHubEvent) => void;

export class EvenHubBridge {
  private bridge: EvenAppBridgeType | null = null;
  private imageQueue: ImageRawDataUpdate[] = [];
  private isSendingImage = false;
  private unsubscribeEvents: (() => void) | null = null;

  constructor(bridge?: EvenAppBridgeType) {
    if (bridge) {
      this.bridge = bridge;
    }
  }

  async init(): Promise<void> {
    if (this.bridge) {
      console.log('[EvenHubBridge] Using existing bridge.');
      return;
    }
    try {
      this.bridge = await waitForEvenAppBridge();
      console.log('[EvenHubBridge] Bridge ready.');
    } catch (err) {
      console.warn('[EvenHubBridge] Bridge init failed (running outside Even Hub?):', err);
      this.bridge = null;
    }
  }

  async setupPage(container: CreateStartUpPageContainer): Promise<boolean> {
    if (!this.bridge) {
      appendEventLog('Chess: No bridge for setupPage');
      return false;
    }

    try {
      // FORCE CreateStartUpPage (Skip Rebuild to avoid ID collisions/artifacts)
      // Reference: EvenChess layout (Images) conflicts with Hub layout (List, ID 2)
      // Rebuild might return true but leave old elements.
      appendEventLog('Chess: setupPage -> Force Create...');

      let result = await this.bridge.createStartUpPageContainer(container);
      if (result === 0) {
        appendEventLog('Chess: Create Success');
        return true;
      }
      appendEventLog(`Chess: Create Failed (${result}). Trying Shutdown+Create...`);

      // Force Shutdown and Retry Create (Nuke and Pave)
      // ID 0 is the default page allowed to be shutdown
      try {
        await this.bridge.shutDownPageContainer(0);
        // Brief delay to allow shutdown to propagate
        await new Promise(r => setTimeout(r, 100));
      } catch (shutdownErr) {
        console.warn('Shutdown failed (maybe no page?):', shutdownErr);
      }

      result = await this.bridge.createStartUpPageContainer(container);
      if (result === 0) {
        appendEventLog('Chess: Shutdown+Create Success');
        return true;
      }

      appendEventLog(`Chess: Final Create Failed (${result})`);
      console.error('[EvenHubBridge] All setup attempts failed:', result);
      return false;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendEventLog(`Chess: setupPage Error: ${msg}`);
      console.error('[EvenHubBridge] setupPage error:', err);
      return false;
    }
  }

  async updatePage(container: RebuildPageContainer): Promise<boolean> {
    if (!this.bridge) {
      console.log('[EvenHubBridge] No bridge — skipping updatePage.');
      return false;
    }

    try {
      const success = await this.bridge.rebuildPageContainer(container);
      if (!success) {
        console.warn('[EvenHubBridge] rebuildPageContainer returned false.');
      }
      return success;
    } catch (err) {
      console.error('[EvenHubBridge] rebuildPageContainer error:', err);
      return false;
    }
  }

  async updateText(containerID: number, containerName: string, content: string): Promise<boolean> {
    if (!this.bridge) return false;

    try {
      return await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID,
          containerName,
          content,
        }),
      );
    } catch (err) {
      console.error('[EvenHubBridge] textContainerUpgrade error:', err);
      return false;
    }
  }

  // SDK requires serial image sends
  async updateBoardImage(data: ImageRawDataUpdate): Promise<void> {
    this.imageQueue.push(data);
    await this.processImageQueue();
  }

  private async processImageQueue(): Promise<void> {
    if (this.isSendingImage || !this.bridge) return;
    this.isSendingImage = true;

    while (this.imageQueue.length > 0) {
      const data = this.imageQueue.shift()!;
      try {
        const result = await this.bridge.updateImageRawData(data);
        if (!ImageRawDataUpdateResult.isSuccess(result)) {
          console.warn('[EvenHubBridge] Image update not successful:', result);
        }
      } catch (err) {
        console.error('[EvenHubBridge] Image update error:', err);
      }
    }

    this.isSendingImage = false;
  }

  subscribeEvents(handler: EvenHubEventHandler): void {
    // Store handler for manual dispatch from Hub
    this.unsubscribeEvents = () => { /* no-op */ };
    // We expose a way to trigger this handler.
    // Since we can't easily modify the instance from outside without a reference,
    // we attach it to the instance.
    (this as any)._handleEvent = handler;
  }

  // Called by Hub module adapter
  dispatch(event: EvenHubEvent): void {
    const handler = (this as any)._handleEvent as EvenHubEventHandler | undefined;
    if (handler) {
      handler(event);
    }
  }

  async shutdown(): Promise<void> {
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    (this as any)._handleEvent = undefined;

    if (this.bridge) {
      try {
        // Don't shutdown the container! Let Hub manage it.
        // await this.bridge.shutDownPageContainer(0);
        console.log('[EvenHubBridge] Shutdown (virtual)');
      } catch (err) {
        console.error('[EvenHubBridge] shutDown error:', err);
      }
    }
  }
}
