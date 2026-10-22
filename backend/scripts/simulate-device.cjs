// Hardware simulator for the isolated preview fixture only. Never use against campus inventory.
const { Client } = require('pg');
const delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const target = new URL(process.env.TEST_DATABASE_URL || '');
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/smartpick_test')
        throw new Error('Local disposable database required');
    const c = new Client({ connectionString: target.toString() });
    await c.connect();
    await c.query('SET search_path TO preview,public');
    const ids = new Set((await c.query('SELECT parcel_id FROM parcels')).rows.map(p => p.parcel_id));
    await c.end();
    console.log('Preview simulator ready. It only handles existing preview parcel IDs.');
    let running = true;
    process.on('SIGINT', () => {
        running = false;
    });
    while (running) {
        const request = async (path, body) => {
            const r = await fetch(`http://127.0.0.1:5050/api/device${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-device-key': 'preview-device-key' }, body: body ? JSON.stringify(body) : undefined });
            if (!r.ok)
                throw new Error(`Device request failed (${r.status})`);
            return r.json();
        };
        const { command } = await request('/commands/next');
        if (command && ids.has(command.parcel_id)) {
            await request(`/commands/${command.command_id}/result`, { result: 'EXECUTED' });
            console.log('Preview light activated. Removal in 12 seconds.');
            await delay(12000);
            await request('/events', { sourceEventKey: `preview-${command.command_id}`, parcelId: command.parcel_id, compartmentId: command.compartment_id, occurredAt: new Date().toISOString() });
            console.log('Preview removal confirmed.');
        }
        await delay(1000);
    }
})().catch(e => {
    console.error(e.message);
    process.exitCode = 1;
});
