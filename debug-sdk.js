const sdk = require('./node_modules/@evenrealities/even_hub_sdk');
console.log('SDK loaded keys:', Object.keys(sdk));

try {
    const List_ItemEvent = sdk.List_ItemEvent;
    if (!List_ItemEvent) {
        console.log('List_ItemEvent not exported directly');
    } else {
        console.log('Testing List_ItemEvent instantiation...');
        const payload = {
            eventType: 0,
            currentSelectItemIndex: 2
        };
        const evt = new List_ItemEvent(payload);
        console.log('Result via constructor:', JSON.stringify(evt, null, 2));

        console.log('Testing fromJson...');
        if (List_ItemEvent.fromJson) {
            const evt2 = List_ItemEvent.fromJson(payload);
            console.log('Result via fromJson:', JSON.stringify(evt2, null, 2));
        } else {
            console.log('fromJson not available');
        }

        console.log('Testing with snake_case keys...');
        const payloadSnake = {
            event_type: 0,
            Event_Type: 0,
            current_select_item_index: 2,
            CurrentSelect_ItemIndex: 2
        };
        const evt3 = new List_ItemEvent(payloadSnake);
        console.log('Result via constructor (snake):', JSON.stringify(evt3, null, 2));

        if (List_ItemEvent.fromJson) {
            const evt4 = List_ItemEvent.fromJson(payloadSnake);
            console.log('Result via fromJson (snake):', JSON.stringify(evt4, null, 2));
        }
    }
} catch (e) {
    console.error('Error:', e);
}
