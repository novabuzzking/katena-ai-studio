// Katena AI Studio — Social Media Content Agent + 3D command center.
// Run: node server.js   (config via .env — see .env.example)
import "dotenv/config";
import express from "express";
import multer from "multer";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { join, dirname, extname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getState, addPost, findPost, save, log } from "./lib/store.js";
import { generatePost, hasClaudeKey } from "./lib/generate.js";
import { networkStatus } from "./lib/publishers.js";
import { upcomingSlots, assignSlot, startScheduler, tick } from "./lib/scheduler.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
// Overridable so a host like Render can point uploads at a mounted persistent
// disk; without it a redeploy would wipe every photo. Defaults to ./uploads.
const UPLOADS_DIR = process.env.UPLOADS_DIR || join(ROOT, "uploads");
mkdirSync(UPLOADS_DIR, { recursive: true });
const app = express();

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${extname(file.originalname) || ".jpg"}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});

app.use(express.json());

// ---------- access control ----------
// Instagram and Facebook fetch post images over the public internet, so
// /uploads must stay open. Everything else — the dashboard and the approve /
// publish endpoints — is gated behind STUDIO_SECRET whenever it is set, so the
// studio can sit on a public tunnel without exposing a way to post as Katena.
// No secret set (plain localhost use) leaves everything open as before.
app.use("/uploads", express.static(UPLOADS_DIR));

const SECRET = () => process.env.STUDIO_SECRET;

app.use((req, res, next) => {
  if (!SECRET()) return next();

  const [scheme, encoded] = (req.headers.authorization || "").split(" ");
  if (scheme === "Basic" && encoded) {
    const [, pass] = Buffer.from(encoded, "base64").toString().split(":");
    // Compare full-length to avoid leaking the secret's length via timing.
    const a = Buffer.from(pass || "");
    const b = Buffer.from(SECRET());
    if (a.length === b.length && timingSafeEqual(a, b)) return next();
  }

  res.set("WWW-Authenticate", 'Basic realm="Katena AI Studio"');
  res.status(401).send("Katena AI Studio — sign in to continue.");
});

app.use(express.static(join(ROOT, "public")));

// ---------- state for the dashboard ----------
app.get("/api/state", (_req, res) => {
  const { posts, activity, settings } = getState();
  res.json({
    posts,
    activity: activity.slice(0, 40),
    settings,
    slots: upcomingSlots(12),
    live: { claude: hasClaudeKey(), ...networkStatus() },
  });
});

// ---------- photo intake → draft ----------
app.post("/api/photos", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image received (jpeg/png/webp/gif)." });
    const post = addPost({
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      status: "generating",
      photo: { filename: req.file.filename, path: req.file.path, mime: req.file.mimetype },
      note: req.body.note || "",
      caption: null,
    });
    log(`Photo received — drafting post ${post.id}…`, { postId: post.id });

    const draft = await generatePost({
      imagePath: post.photo.path,
      mime: post.photo.mime,
      note: post.note,
    });
    post.caption = draft;
    post.status = "awaiting_approval";
    save();
    log(`Draft ready for approval (${draft.demo ? "demo copy" : draft.model})`, { postId: post.id });
    res.json(post);
  } catch (err) {
    log(`Generation failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---------- approval workflow ----------
app.post("/api/posts/:id/approve", (req, res) => {
  const post = findPost(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  const slot = assignSlot(post);
  log(`Post ${post.id} approved — scheduled for ${new Date(slot).toLocaleString()}`, { postId: post.id });
  res.json(post);
});

app.post("/api/posts/:id/reject", (req, res) => {
  const post = findPost(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  post.status = "rejected";
  post.scheduledFor = null;
  save();
  log(`Post ${post.id} rejected`, { postId: post.id });
  res.json(post);
});

app.post("/api/posts/:id/edit", (req, res) => {
  const post = findPost(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  const { linkedin, instagram, hashtags } = req.body || {};
  if (linkedin != null) post.caption.linkedin = linkedin;
  if (instagram != null) post.caption.instagram = instagram;
  if (hashtags != null) post.caption.hashtags = hashtags;
  save();
  log(`Post ${post.id} edited by approver`, { postId: post.id });
  res.json(post);
});

app.post("/api/posts/:id/regenerate", async (req, res) => {
  const post = findPost(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  try {
    post.status = "generating";
    save();
    post.caption = await generatePost({
      imagePath: post.photo.path,
      mime: post.photo.mime,
      note: req.body?.note ?? post.note,
    });
    post.status = "awaiting_approval";
    save();
    log(`Post ${post.id} regenerated`, { postId: post.id });
    res.json(post);
  } catch (err) {
    post.status = "awaiting_approval";
    save();
    res.status(500).json({ error: err.message });
  }
});

// Publish everything that's due right now (skips the 60s wait).
app.post("/api/publish-due", async (_req, res) => {
  await tick();
  res.json({ ok: true });
});

// Publish one scheduled post immediately.
app.post("/api/posts/:id/publish-now", async (req, res) => {
  const post = findPost(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  if (post.status !== "scheduled") return res.status(400).json({ error: "Post is not scheduled." });
  post.scheduledFor = new Date().toISOString();
  save();
  await tick();
  res.json(findPost(req.params.id));
});

// ---------- demo seed (used until real photos/keys exist) ----------
app.post("/api/demo/seed", (_req, res) => {
  seedDemo(true);
  res.json({ ok: true });
});

function seedDemo(force = false) {
  const { posts } = getState();
  if (posts.length && !force) return;
  const demos = [
    { note: "Level 34 glass panels going in on the downtown tower", status: "published", offsetDays: -4 },
    { note: "Crew topped out the north stairwell guardrails", status: "published", offsetDays: -2 },
    { note: "Aluminum pickets, balcony run, west elevation", status: "scheduled", offsetDays: 0 },
    { note: "Morning fog from the 41st floor before install", status: "awaiting_approval", offsetDays: 0 },
    { note: "New shop jig cut fabrication time on curved sections", status: "awaiting_approval", offsetDays: 0 },
  ];
  const slots = upcomingSlots(24).filter((s) => !s.taken);
  let slotIdx = 0;
  for (const d of demos) {
    const svg = placeholderSvg(d.note);
    const post = {
      id: randomUUID().slice(0, 8),
      createdAt: new Date(Date.now() + d.offsetDays * 864e5).toISOString(),
      status: d.status,
      demoSeed: true,
      photo: { filename: null, path: null, mime: "image/svg+xml", dataUri: svg },
      note: d.note,
      caption: {
        photo_summary: d.note,
        linkedin: `[DEMO] ${d.note}. Engineered, fabricated and installed by the Katena crew — on schedule, floor by floor. Bidding a tower this year? Talk to us.`,
        instagram: `[DEMO] ${d.note} — precision work at height.`,
        hashtags: ["KatenaRailings", "HighRise", "GlassRailings", "Guardrails", "GTAConstruction"],
        alt_text: d.note,
        demo: true,
      },
    };
    if (d.status === "published") {
      post.publishedAt = new Date(Date.now() + d.offsetDays * 864e5).toISOString();
      post.publishResults = [
        { network: "linkedin", ok: true, simulated: true, detail: "Demo history" },
        { network: "instagram", ok: true, simulated: true, detail: "Demo history" },
      ];
    }
    if (d.status === "scheduled") {
      post.scheduledFor = slots[slotIdx++]?.at || null;
    }
    addPost(post);
  }
  log("Demo pipeline seeded — replace with real crew photos any time.");
}

function placeholderSvg(label) {
  const short = label.length > 44 ? label.slice(0, 42) + "…" : label;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='400'>` +
    `<rect width='640' height='400' fill='%231b1815'/>` +
    `<g stroke='%23b88a3e' stroke-width='2'>` +
    [...Array(7)].map((_, i) => `<line x1='${80 + i * 80}' y1='60' x2='${80 + i * 80}' y2='340'/>`).join("") +
    `<line x1='60' y1='70' x2='580' y2='70'/><line x1='60' y1='330' x2='580' y2='330'/></g>` +
    `<text x='320' y='378' fill='%238FA3B1' font-family='sans-serif' font-size='18' text-anchor='middle'>${short.replace(/&/g, "and")}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${svg}`;
}

seedDemo();
startScheduler();
app.listen(PORT, () => {
  console.log(`Katena AI Studio → http://localhost:${PORT}`);
  console.log(`  Claude: ${hasClaudeKey() ? "LIVE" : "demo mode (set ANTHROPIC_API_KEY)"}`);
  const nets = networkStatus();
  console.log(
    `  LinkedIn: ${nets.linkedin ? "LIVE" : "simulated"} · ` +
      `Instagram: ${nets.instagram ? "LIVE" : "simulated"} · ` +
      `Facebook: ${nets.facebook ? "LIVE" : "simulated"}`
  );
});
