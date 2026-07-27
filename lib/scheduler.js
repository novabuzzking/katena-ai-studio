// Scheduling — approved posts get the next free Mon/Wed/Fri slot; a ticker
// publishes anything whose slot time has arrived.
import { getState, save, log } from "./store.js";
import { publishAll } from "./publishers.js";

// Next posting slots (postDays at postHour local), skipping taken ones.
export function upcomingSlots(count = 12) {
  const { settings, posts } = getState();
  const taken = new Set(
    posts.filter((p) => p.scheduledFor && p.status !== "rejected").map((p) => p.scheduledFor)
  );
  const slots = [];
  const cursor = new Date();
  cursor.setMinutes(0, 0, 0);
  for (let day = 0; slots.length < count && day < 120; day++) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() + day);
    d.setHours(settings.postHour);
    if (!settings.postDays.includes(d.getDay())) continue;
    if (d <= new Date()) continue;
    const iso = d.toISOString();
    slots.push({ at: iso, taken: taken.has(iso) });
  }
  return slots;
}

export function assignSlot(post) {
  const free = upcomingSlots(24).find((s) => !s.taken);
  post.scheduledFor = free ? free.at : null;
  post.status = "scheduled";
  save();
  return post.scheduledFor;
}

async function tick() {
  const { posts } = getState();
  const due = posts.filter(
    (p) => p.status === "scheduled" && p.scheduledFor && new Date(p.scheduledFor) <= new Date()
  );
  for (const post of due) {
    log(`Publishing post ${post.id}…`, { postId: post.id });
    const results = await publishAll(post);
    post.publishResults = results;
    post.publishedAt = new Date().toISOString();
    post.status = results.every((r) => r.ok) ? "published" : "failed";
    save();
    for (const r of results) {
      log(
        `${r.network}: ${r.ok ? (r.simulated ? "simulated publish" : "published") : "FAILED"} — ${r.detail}`,
        { postId: post.id }
      );
    }
  }
}

export function startScheduler() {
  setInterval(() => tick().catch((e) => log(`Scheduler error: ${e.message}`)), 60_000);
  log("Scheduler online — checking for due posts every 60s.");
}

// Exposed for the dashboard's "publish now" button and for testing.
export { tick };
