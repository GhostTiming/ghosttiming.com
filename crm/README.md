# Ghost Timing CRM

Separate Next.js application for race prospecting and operations. The first
slice includes Neon Auth with Google sign-in, eligible catalog prospects,
activity history, stage changes, and follow-up tasks.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Use the pooled `DATABASE_URL` for the Neon development branch.
3. Set `NEON_AUTH_BASE_URL` from that branch's Auth configuration.
4. Generate a unique `NEON_AUTH_COOKIE_SECRET` of at least 32 characters.
5. Put Michelle's email in `CRM_ADMIN_EMAILS`.
6. Put every permitted prospecting user's email in `CRM_ALLOWED_EMAILS`.
7. From the repository root, run `npm run dev:crm`.

Only listed Google accounts can enter the CRM. Admin emails are automatically
allowed and do not need to be repeated in `CRM_ALLOWED_EMAILS`.

## Database

The migration in `drizzle/` creates only the new `crm` schema and references the
existing `catalog` schema. Apply and test migrations on a Neon child branch
before promoting them to `main`.

## Race Roster sync

To pull timer-accessible Race Roster events into the shared catalog, see
[`docs/race-roster-sync.md`](./docs/race-roster-sync.md). You need the OAuth
client id/secret plus the timer account username/password (or a refresh token).

## Vercel deployment

Create a separate Vercel project from this repository with `crm` as its Root
Directory, then add the environment variables from `.env.example`. Assign
`crm.ghosttiming.com` after the deployment is healthy and add every preview or
production origin to the selected Neon Auth branch's trusted domains.
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
