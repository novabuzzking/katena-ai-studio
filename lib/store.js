// JSON-file persistence — one store for posts, activity log, and settings.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// DATA_DIR is overridable so a host like Render can point it at a mounted
// persistent disk — the repo-relative default keeps local runs unchanged.
const DATA_DIR =
  process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = join(DATA_DIR, "store.json");

const DEFAULTS = {
  posts: [],
  activity: [],
  settings: {
    postDays: [1, 3, 5], // Mon / Wed / Fri (0 = Sunday)
    postHour: 10,
    networks: ["linkedin", "instagram"],
  },
};

let state = load();

function load() {
  try {
    if (existsSync(FILE)) {
      return { ...structuredClone(DEFAULTS), ...JSON.parse(readFileSync(FILE, "utf8")) };
    }
  } catch (err) {
    console.error("store: failed to read, starting fresh:", err.message);
  }
  return structuredClone(DEFAULTS);
}

export function save() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export function getState() {
  return state;
}

export function addPost(post) {
  state.posts.push(post);
  save();
  return post;
}

export function findPost(id) {
  return state.posts.find((p) => p.id === id);
}

export function log(message, meta = {}) {
  state.activity.unshift({ at: new Date().toISOString(), message, ...meta });
  state.activity = state.activity.slice(0, 200);
  save();
  console.log(`[activity] ${message}`);
}
