# Claude / AI CRM API

This server-only API gives an approved AI process the same shared CRM state used
by human users. Every AI write is labeled with `actor_type: "ai"` and the
configured `CRM_AI_ACTOR_NAME`.

## Authentication

Set a random secret of at least 32 characters:

```ini
CRM_AI_API_KEY=
CRM_AI_ACTOR_NAME=Claude
```

Send it only from a trusted server:

```http
Authorization: Bearer <CRM_AI_API_KEY>
```

Never expose this key in browser code or a `NEXT_PUBLIC_` variable. Missing,
short, or incorrect credentials receive `401 Unauthorized`.

## Endpoints

### List prospects

`GET /api/ai/prospects`

Optional query parameters:

- `stage`: `cold` / `contacting`, `scoping`, `confirmed`, `closed_lost`, `disqualified`, or `unqualified`
- `untouched`: `true` or `false`
- `include_closed`: defaults to `false`
- `limit`: 1–100, defaults to 50
- `after`: the `next_cursor` UUID returned by the previous page

The response includes contacts, stage, owner, touch count, Last Step, Next Step,
Do Not Contact state, and conversion state.

### Read one prospect

`GET /api/ai/prospects/{lead_id}`

Returns the structured prospect plus all active contact methods, activity
history, and tasks.

### List valid owners

`GET /api/ai/users`

Returns active CRM users and the IDs accepted by owner and follow-up writes.

### Change stage or owner

`PATCH /api/ai/prospects/{lead_id}`

```json
{
  "stage": "contacting",
  "assigned_owner_id": "00000000-0000-0000-0000-000000000000"
}
```

Either field may be omitted. Send `assigned_owner_id: null` to unassign. Stage
and owner changes are written to the shared activity timeline.

### Record activity and optional follow-up

`POST /api/ai/prospects/{lead_id}/activities`

```json
{
  "type": "email",
  "body": "Sent an introduction and requested a call.",
  "disposition": "Interested",
  "occurred_at": "2026-09-15T17:30:00Z",
  "follow_up": {
    "title": "Call the race director",
    "due_at": "2026-09-17T14:00:00Z",
    "assigned_user_id": "00000000-0000-0000-0000-000000000000"
  }
}
```

Allowed activity types are `phone_call`, `email`, `meeting`, and `note`.
`assigned_user_id` defaults to the prospect owner. A follow-up is rejected if
neither is assigned.

Allowed dispositions:

`No Answer`, `Left Voicemail`, `No Voicemail`, `Interested`, `Meeting Set`,
`Event Canceled`, `Already Booked`, `Timing Company`, `Not Interested`,
`Do Not Contact`, `Bad Timing / Try Again`, `Bad Contact Information`, `Other`.

Terminal dispositions close the prospect. `Do Not Contact` also sets the
Do Not Contact flag. These are the same rules used by human activity logging.

## Local verification

With the CRM dev server running:

```powershell
npm run test:ai-api -w ghosttiming-crm
```

The verification creates an isolated temporary prospect, exercises AI activity,
follow-up, stage, detail, and audit behavior, then removes its test data.
