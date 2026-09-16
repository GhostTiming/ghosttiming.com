# Race Roster catalog sync

Pulls timer-accessible Race Roster events into the shared Neon catalog
(`catalog.race_listings`, `race_editions`, `race_offerings`) with
`source_provider = 'race_roster'`.

## Credentials

Create an OAuth client under Race Roster → API settings, then set:

| Variable | Required | Notes |
| --- | --- | --- |
| `RACE_ROSTER_CLIENT_ID` | yes | OAuth client id |
| `RACE_ROSTER_CLIENT_SECRET` | yes | OAuth client secret |
| `RACE_ROSTER_CLIENT_NAME` | no | Label only (logging / ops notes) |
| `RACE_ROSTER_USERNAME` | with password | Timer account email |
| `RACE_ROSTER_PASSWORD` | with username | Timer account password |
| `RACE_ROSTER_REFRESH_TOKEN` | or username/password | From a prior `grant_type=access_token` response (~25h TTL) |
| `DATABASE_URL` | yes | Neon catalog+crm pooled URL |

Race Roster’s timer OAuth grant needs the timer login (username/password) or a
fresh refresh token — client id/secret alone are not enough.

## Migration

Apply `crm/drizzle/0021_race_roster_catalog_provider.sql` on a Neon child branch
first. It switches catalog uniqueness to `(source_provider, source_race_id)`
(and matching offering/edition keys) so Race Roster ids cannot overwrite
RunSignUp rows.

## Sync

From `crm/`:

```bash
# Dry-run mapping against the live API (no DB writes)
RACE_ROSTER_DRY_RUN=1 npm run sync:race-roster

# Upsert every LIVE/PRIVATE future event the timer can see
npm run sync:race-roster

# Limit to specific Race Roster event ids
RACE_ROSTER_EVENT_IDS=761,802 npm run sync:race-roster
```

Mapped fields include name, description, logo, registration URL, location,
timezone, start time, and sub-events (distances). CRM “Refresh from GRV” then
works the same as for RunSignUp listings once a booking/prospect is linked.
