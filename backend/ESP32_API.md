# ESP32 HTTP API

Use outbound HTTPS JSON requests to the backend. Send `x-device-key: <ESP32_API_KEY>` on device routes. Keep the key on the device and never expose `DATABASE_URL`. Poll `GET /api/device/commands/next` every 1–2 seconds while idle.

## Poll

`GET /api/device/commands/next` claims one pending command by changing it to `ACKNOWLEDGED`.

```json
{"command":{"command_id":"uuid","command_type":"LIGHT_COMPARTMENT","parcel_id":"uuid","compartment_id":"uuid","slot_no":1,"compartment_no":2}}
```

No work: `{"command":null}`. Map slot and compartment numbers to pins in firmware; UUIDs are identifiers only. The ESP32 reports completion with `POST /api/device/commands/{commandId}/result`, JSON `{"result":"EXECUTED"}` or `{"result":"FAILED"}`. LED activation does not collect the parcel.

## Removal event

After the sensor confirms removal, post `POST /api/device/events`:

```json
{"sourceEventKey":"stable-device-event-id","parcelId":"uuid","compartmentId":"uuid","occurredAt":"2026-10-19T10:20:30.000Z"}
```

`occurredAt` is optional. `sourceEventKey` must be 1–100 characters, matching the database column. Retrying the same physical event must reuse `sourceEventKey`; the database uniqueness constraint deduplicates retries. Only a matching stored parcel and occupied compartment are processed. Mismatched or stale events return HTTP 409 and are recorded as rejected when possible.

## Delivery limits

Polling atomically claims pending commands as acknowledged. A lost response after claim can leave a command acknowledged without firmware receiving it; this small prototype has no lease, redelivery, or guaranteed exactly-once hardware execution. Duplicate retrieval requests while a command is pending or acknowledged return the existing command. Failed or executed commands are terminal in this API. Configure device identity, HTTPS trust, LED driver, sensor wiring, and physical pin mapping when the exact hardware is known.
