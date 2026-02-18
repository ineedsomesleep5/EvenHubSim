/**
 * Module Loader — Dynamically loads all sub-modules.
 * 
 * To add a new app:
 * 1. Create a folder in `apps/hub/modules/` (e.g., `my-app`)
 * 2. Export a `createModule` factory from its `index.ts`
 * 3. Add it to the list below (manual step required until we have a build-time macro)
 */

import { HubRenderer, SubModule, SubModuleFactory } from '../types';
import type { SetStatus } from '../../_shared/app-types';

// Static imports are still required by bundlers unless we use dynamic import() with glob patterns.
// Vite supports import.meta.glob for this exact "pluggable" use case!
import { createTimerModule } from './timer';
import { createRedditModule } from './reddit';
import { createChessModule } from './chess';
import { createRestApiModule } from './restapi';

const BUILTIN_MODULES: Record<string, SubModuleFactory> = {
    timer: createTimerModule,
    reddit: createRedditModule,
    chess: createChessModule,
    restapi: createRestApiModule,
};

export async function loadModules(renderer: HubRenderer, setStatus: SetStatus): Promise<SubModule[]> {
    const modules: SubModule[] = [];

    // 1. Load Built-ins
    for (const [key, factory] of Object.entries(BUILTIN_MODULES)) {
        try {
            const mod = factory(renderer, setStatus);
            modules.push(mod);
        } catch (err) {
            console.warn(`Failed to load module ${key}:`, err);
        }
    }

    // 2. Extensibility Point:
    // In a real "Pluggable" setup, we would use import.meta.glob to find others.
    // For now, the user wants "just give another repo and you add them".
    // This file acts as the registry.

    return modules;
}
