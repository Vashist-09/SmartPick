# ESP32 HTTP API

Use outbound HTTPS JSON requests to the backend. Send `x-device-key: <ESP32_API_KEY>` on device routes. Keep the key on the device and never expose `DATABASE_URL`. Poll `GET /api/device/commands/next` every 1–2 seconds while idle.

## Poll

`GET /api/device/commands/next` claims one pending command by changing it to `ACKNOWLEDGED`.

```json
{"command":{"command_id":"uuid","command_type":"LIGHT_COMPARTMENT","parcel_id":"uuid","compartment_id":"uuid","slot_no":1,"compartment_no":2}}
```

No work: `{"command":null}`. Map slot and compartment numbers to pins in firmware; UUIDs are identifiers only. The ESP32 reports completion with `POST /api/device/commands/{commandId}/result`, JSON `{"result":"EXECUTED"}` or `{"result":"FAILED"}`. LED activation does not collect the parcel.

## Removal event

After the IR sensor has been debounced and confirms an occupied compartment became empty, post `POST /api/device/events`. The simplest firmware payload uses the physical location, so it does not need database UUIDs:

```json
{"sourceEventKey":"unit-1-s1-c2-000042","slotNo":1,"compartmentNo":2,"occurredAt":"2026-10-19T10:20:30.000Z"}
```

The backend resolves that location to the currently stored parcel, then in one database transaction marks the parcel `COLLECTED`, sets the compartment to `EMPTY`, records the hardware event, and adds an activity log. A successful response is `{"processed":true}`. If there is no matching stored parcel, the API returns HTTP 409; check the slot and compartment records and the parcel's stored state.

Firmware that already has the database IDs can instead post:

```json
{"sourceEventKey":"stable-device-event-id","parcelId":"uuid","compartmentId":"uuid","occurredAt":"2026-10-19T10:20:30.000Z"}
```

`occurredAt` is optional. `sourceEventKey` must be 1–100 characters, matching the database column. Retrying the same physical event must reuse `sourceEventKey`; generate a new key for each later removal. The database uniqueness constraint deduplicates retries. Only a matching stored parcel and occupied compartment are processed. Mismatched or stale UUID-based events return HTTP 409 and are recorded as rejected when possible.

Posting `EXECUTED` to the command result endpoint only confirms that the light command ran; it does not mean the parcel was collected. The firmware must separately post the removal event after the IR sensor detects removal. Check the HTTP response from this event call on the ESP32 when debugging database updates.

## Delivery limits

Polling atomically claims pending commands as acknowledged. A lost response after claim can leave a command acknowledged without firmware receiving it; this small prototype has no lease, redelivery, or guaranteed exactly-once hardware execution. Duplicate retrieval requests while a command is pending or acknowledged return the existing command. Failed or executed commands are terminal in this API. Configure device identity, HTTPS trust, LED driver, sensor wiring, and physical pin mapping when the exact hardware is known.
