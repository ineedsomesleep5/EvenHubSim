const sdk = require('./node_modules/@evenrealities/even_hub_sdk');
console.log('SDK loaded keys:', Object.keys(sdk));

try {
    const List_ItemEvent = sdk.List_ItemEvent;

    // 1. Test basic instantiation
    if (List_ItemEvent) {
        console.log('Testing List_ItemEvent instantiation...');
        const payload = { eventType: 0, currentSelectItemIndex: 2 };
        console.log('Result via constructor:', JSON.stringify(new List_ItemEvent(payload), null, 2));

        if (List_ItemEvent.fromJson) {
            console.log('Result via fromJson:', JSON.stringify(List_ItemEvent.fromJson(payload), null, 2));
        }
    }

    // 2. Test Enum
    if (sdk.EvenHubEventType) {
        console.log('EvenHubEventType:', JSON.stringify(sdk.EvenHubEventType, null, 2));
    }

    // 3. Test Proxy to trace access
    console.log('Testing with Proxy to trace access...');
    const createTracingProxy = (name) => new Proxy({}, {
        get: (target, prop) => {
            if (prop === 'toJSON') return () => ({});
            if (typeof prop === 'symbol') return Reflect.get(target, prop);
            console.log(`[${name}] Accessed property: ${String(prop)}`);
            return 0; // Return dummy number
        },
        has: (target, prop) => {
            console.log(`[${name}] Checked property existence: ${String(prop)}`);
            return true;
        }
    });

    const listEventProxy = createTracingProxy('listEventProxy');

    // We want to test what keys evenHubEventFromJson looks for in the `data` object.
    // We pass a proxy as the data object itself? No, evenHubEventFromJson takes `data`.
    // It probably looks for `type` first.

    const dataProxy = new Proxy({ type: 0 }, {
        get: (target, prop) => {
            if (prop === 'type') return 0;
            if (prop === 'toJSON') return () => ({});
            console.log(`[ROOT_DATA] Accessed property: ${String(prop)}`);
            // If it asks for listEvent, return the list proxy
            if (String(prop).toLowerCase().includes('list')) return listEventProxy;
            return listEventProxy; // Return proxy for everything else too
        }
    });

    console.log('--- Calling evenHubEventFromJson with Root Proxy ---');
    try {
        if (sdk.evenHubEventFromJson) {
            sdk.evenHubEventFromJson(dataProxy);
        }
    } catch (e) { console.log('Proxy error:', e.message); }
    console.log('--- Done Root Proxy Test ---');

    console.log('--- Calling evenHubEventFromJson with Nested Proxy ---');
    const nestedData = {
        type: 0,
        listEvent: listEventProxy,
        ListEvent: listEventProxy,
        list_event: listEventProxy,
        List_ItemEvent: listEventProxy
    };
    try {
        if (sdk.evenHubEventFromJson) {
            sdk.evenHubEventFromJson(nestedData);
        }
    } catch (e) { console.log('Proxy error:', e.message); }
    console.log('--- Done Nested Proxy Test ---');
    console.log('--- Calling evenHubEventFromJson with jsonData payload ---');
    const jsonDataPayload = {
        type: 0,
        jsonData: {
            eventType: 0,
            currentSelectItemIndex: 2,
            container_id: 123
        }
    };
    try {
        if (sdk.evenHubEventFromJson) {
            const res = sdk.evenHubEventFromJson(jsonDataPayload);
            console.log('Result evenHubEventFromJson (jsonDataPayload):', JSON.stringify(res, null, 2));
        }
    } catch (e) { console.log('Error:', e.message); }

} catch (e) {
    console.error('Global Error:', e);
}
