# Katena AI Studio — Social Media Content Agent

An AI agent that turns job-site photos into a steady social posting rhythm
(LinkedIn, Instagram, Facebook), with a human approval gate and a 3D command
center for visibility.

## What it does

1. **Photo intake** — crew drops a job-site photo into the dashboard (drag &
   drop, works from a phone) with an optional one-line note.
2. **Drafting** — Claude (vision) reads the photo + `brand/voice.md` and drafts
   a LinkedIn post, an Instagram caption, hashtags, and alt text as structured
   JSON. No key yet? It produces clearly-marked demo copy so the pipeline is
   demoable immediately.
3. **Approval** — posts wait in the queue. Approve & schedule, edit inline,
   redraft, or reject. Nothing publishes without a human yes.
4. **Scheduling** — approved posts take the next free Mon/Wed/Fri 10:00 slot
   (3 posts/week per the pilot).
5. **Publishing** — at slot time, the scheduler posts to the LinkedIn company
   page (UGC + assets API) and Instagram Business (Meta Graph API). Without
   credentials, publishes are simulated and labelled as such.
6. **Command center** — a Three.js scene where the tower *is* the pipeline:
   lit floors = published posts, brass glass floors = scheduled, ghost frames =
   open slots, and drafts awaiting approval hang from the crane. Click any
   floor/pallet to jump to its post.

## Run it

```bash
cd ai-studio
npm install
cp .env.example .env   # fill in what you have; everything degrades gracefully
node server.js         # → http://localhost:8787
```

## Going live — what we need from Katena

| To activate | We need |
|---|---|
| Live captions (Claude) | `ANTHROPIC_API_KEY` |
| LinkedIn publishing | Admin access to the company page → LinkedIn app token (`w_organization_social`) + org URN |
| Instagram publishing | IG Business account linked to a Facebook Page, Meta app token, IG user id, and a public URL for this server (`PUBLIC_BASE_URL`) |
| Brand voice | 3–5 posts they like (tone reference) → fold into `brand/voice.md` |
| Approver | Who taps Approve (dashboard works on a phone) |

## Layout

```
server.js            Express app: intake, approval, scheduling, publishing
lib/generate.js      Claude vision call → structured post JSON (+ demo fallback)
lib/publishers.js    LinkedIn + Instagram publishers (simulate when keyless)
lib/scheduler.js     Mon/Wed/Fri slot assignment + 60s publish ticker
lib/store.js         JSON persistence (data/store.json)
brand/voice.md       The agent's voice profile — edit freely
public/              3D command center (Three.js, vendored — no CDN)
```
