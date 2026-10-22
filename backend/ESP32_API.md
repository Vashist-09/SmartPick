# ESP32 HTTP API

Use outbound HTTPS requests with `x-device-key: <ESP32_API_KEY>`. Do not expose the key to either browser. The single-device prototype targets the first configured `hardware_devices` row.

## Poll and heartbeat

Poll `GET /api/device/commands/next` every 1–2 seconds, including while idle. Polls refresh `last_seen_at`; the API considers the device offline after 30 seconds without a poll. No configured device returns 503; an idle configured device returns `{"command":null}`.

A command is claimed atomically as ACKNOWLEDGED:

```json
{"command":{"command_id":"uuid","command_type":"LIGHT_COMPARTMENT","parcel_id":"uuid","compartment_id":"uuid","slot_no":1,"compartment_no":2}}
```

Map logical slot/compartment numbers to the actual LED pins. UUIDs are identifiers, not GPIO numbers. Dispatch rechecks stored parcel, active pickup, location occupancy, slot availability and payment eligibility.

Firmware must deduplicate command IDs, use a bounded light duration, and report the result within 30 seconds:

`POST /api/device/commands/{commandId}/result`

```json
{"result":"EXECUTED"}
```

Or `{"result":"FAILED"}`. Identical terminal-result retries return 200; conflicting, expired or cancelled results return 409. Executing a light never collects a parcel. This API does not unlock a door.

A lost poll response can leave work acknowledged without the device receiving it. The backend fails uncertain acknowledgements after 30 seconds and exposes failure to the user. It does not blindly replay them. A user/staff retry creates a new bounded attempt. Pending commands and pickup attempts expire after five minutes. Retire local pending work when the server rejects it; no local autonomous replay after reboot. Firmware should turn the light off after a short bounded interval even if connectivity is lost.

## Removal event

After the removal sensor confirms physical removal:

`POST /api/device/events`

```json
{"sourceEventKey":"stable-device-event-id","parcelId":"uuid","compartmentId":"uuid","occurredAt":"2026-10-22T10:20:30.000Z"}
```

`sourceEventKey` is 1–100 characters and must remain the same across retries of the same physical event. Reusing it with another parcel/compartment returns 409. Duplicate events return their previously recorded processing status. `occurredAt` is optional and defaults to server time; future timestamps over a minute ahead and events predating parcel storage are rejected.

Only the current matching ACTIVE/STORED parcel in the occupied compartment is processed. Stale/mismatched events return 409, with REJECTED records where identifiers exist. Unknown IDs return 409 without inserting invalid foreign keys.

A valid event changes the parcel to COLLECTED, frees occupancy, closes active pickup attempts and retires pending/acknowledged commands. If the event has no eligible active pickup, or COD is unpaid, physical removal is still recorded and an `UNEXPECTED_REMOVAL` audit exception is raised for staff. Sensor truth is not a payment receipt or proof of collector identity.

No firmware is supplied. Test LED timeout, duplicate suppression, sensor false positives, networking, HTTPS trust, driver wiring and actual pin mapping with the physical unit before rollout.
