// Katena Post Studio — simple front-of-house for the content agent.
// Designed to be readable and obvious for a non-technical owner:
// plain words, big buttons, one job per section. The tower is a picture
// of progress: lit floors = posted, glass = booked, crate = waiting on you.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const BRASS = 0xcfa050, BRASS_DEEP = 0xb88a3e, AMBER = 0xd08a4f;

let state = null;

/* ================= 3D tower (framed in its card) ================= */
const canvas = document.getElementById("scene");
const wrap = canvas.parentElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14110d);
scene.fog = new THREE.Fog(0x14110d, 60, 150);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
camera.position.set(30, 24, 36);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 11, 0);
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;
controls.enableDamping = true;
controls.enableZoom = false;   // keep it un-breakable — it just slowly turns
controls.enablePan = false;
controls.maxPolarAngle = Math.PI / 2.1;

scene.add(new THREE.HemisphereLight(0x8fa3b1, 0x14110d, 0.6));
const key = new THREE.DirectionalLight(0xffe3b0, 1.1);
key.position.set(30, 45, 20);
scene.add(key);
const fill = new THREE.DirectionalLight(0x8fa3b1, 0.5);
fill.position.set(-35, 30, -25);
scene.add(fill);
const rim = new THREE.PointLight(BRASS, 60, 90);
rim.position.set(-18, 22, -14);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(90, 48),
  new THREE.MeshStandardMaterial({ color: 0x191510, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(160, 64, 0x3a2f1e, 0x241d13);
grid.position.y = 0.02;
scene.add(grid);

const matSlab = new THREE.MeshStandardMaterial({ color: 0x2a241b, roughness: 0.6, metalness: 0.3 });
const matGlassLit = new THREE.MeshStandardMaterial({
  color: 0x2d2517, emissive: 0xffd489, emissiveIntensity: 0.55, transparent: true, opacity: 0.92,
});
const matGlassSched = new THREE.MeshStandardMaterial({
  color: 0x8fa3b1, transparent: true, opacity: 0.2, metalness: 0.6, roughness: 0.15,
});
const matBrass = new THREE.MeshStandardMaterial({ color: BRASS_DEEP, metalness: 0.85, roughness: 0.3 });
const matGhost = new THREE.LineBasicMaterial({ color: 0x4a4030, transparent: true, opacity: 0.5 });
const matPallet = new THREE.MeshStandardMaterial({
  color: AMBER, emissive: AMBER, emissiveIntensity: 0.4, metalness: 0.2, roughness: 0.5,
});

const FLOOR_W = 12, FLOOR_D = 9, FLOOR_H = 2.1;
const towerGroup = new THREE.Group();
scene.add(towerGroup);
const palletGroup = new THREE.Group();
scene.add(palletGroup);

function buildFloor(y, kind) {
  const g = new THREE.Group();
  g.position.y = y;

  if (kind === "ghost") {
    const box = new THREE.BoxGeometry(FLOOR_W, FLOOR_H, FLOOR_D);
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(box), matGhost);
    wire.position.y = FLOOR_H / 2;
    g.add(wire);
    return g;
  }

  const slab = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_W, 0.35, FLOOR_D), matSlab);
  slab.position.y = 0.18;
  g.add(slab);

  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(FLOOR_W - 0.9, FLOOR_H - 0.55, FLOOR_D - 0.9),
    kind === "published" ? matGlassLit : matGlassSched
  );
  glass.position.y = FLOOR_H / 2 + 0.1;
  g.add(glass);

  // Katena's signature: brass railing posts around every slab
  const postGeo = new THREE.BoxGeometry(0.14, 0.9, 0.14);
  const half = { x: FLOOR_W / 2 - 0.15, z: FLOOR_D / 2 - 0.15 };
  const positions = [];
  for (let i = -4; i <= 4; i++) positions.push([(i * half.x) / 4, half.z], [(i * half.x) / 4, -half.z]);
  for (let i = -3; i <= 3; i++) positions.push([half.x, (i * half.z) / 3], [-half.x, (i * half.z) / 3]);
  const inst = new THREE.InstancedMesh(postGeo, matBrass, positions.length);
  const m = new THREE.Matrix4();
  positions.forEach(([x, z], i) => inst.setMatrixAt(i, m.makeTranslation(x, 0.8, z)));
  g.add(inst);

  const rail = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(FLOOR_W - 0.3, 0.01, FLOOR_D - 0.3)),
    new THREE.LineBasicMaterial({ color: BRASS })
  );
  rail.position.y = 1.25;
  g.add(rail);
  return g;
}

const crane = new THREE.Group();
{
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x9a7433, metalness: 0.7, roughness: 0.4 });
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.9, 40, 0.9), mastMat);
  mast.position.y = 20;
  crane.add(mast);
  const jib = new THREE.Mesh(new THREE.BoxGeometry(24, 0.7, 0.7), mastMat);
  jib.position.set(7.5, 39, 0);
  crane.add(jib);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.6), mastMat);
  counter.position.set(-5.4, 38.6, 0);
  crane.add(counter);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 12), mastMat);
  cable.position.set(15, 33, 0);
  crane.add(cable);
  crane.position.set(-14, 0, -6);
}
scene.add(crane);

function rebuildScene() {
  towerGroup.clear();
  palletGroup.clear();

  const posts = state?.posts || [];
  const published = posts.filter((p) => p.status === "published").length;
  const scheduled = posts.filter((p) => p.status === "scheduled").length;
  const awaiting = posts.filter((p) => ["awaiting_approval", "generating"].includes(p.status)).length;

  let level = 0;
  for (let i = 0; i < published; i++) towerGroup.add(buildFloor(level++ * FLOOR_H, "published"));
  for (let i = 0; i < scheduled; i++) towerGroup.add(buildFloor(level++ * FLOOR_H, "scheduled"));
  const ghosts = Math.max(3, 9 - level);
  for (let i = 0; i < ghosts; i++) towerGroup.add(buildFloor((level + i) * FLOOR_H, "ghost"));

  for (let i = 0; i < Math.min(awaiting, 5); i++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.5, 2), matPallet.clone());
    box.userData.pulse = true;
    if (i === 0) box.position.set(1, 26.2, -6);
    else box.position.set(-22 + i * 4.5, 0.75, 8);
    palletGroup.add(box);
  }

  controls.target.y = Math.max(8, level * FLOOR_H * 0.55);
}

function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  crane.rotation.y = Math.sin(t * 0.15) * 0.5;
  palletGroup.children.forEach((b, i) => {
    if (b.userData.pulse) b.material.emissiveIntensity = 0.35 + 0.3 * Math.sin(t * 3 + i);
  });
  controls.update();
  renderer.render(scene, camera);
});

/* ================= UI ================= */
const $ = (s) => document.querySelector(s);

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status}`);
  }
  return res.json();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function photoSrc(p) {
  return p.photo?.dataUri || (p.photo?.filename ? `/uploads/${p.photo.filename}` : "");
}

function niceDay(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
function niceTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

let lastSig = "";
async function refresh() {
  try {
    state = await api("/api/state");
    const sig = JSON.stringify(state.posts.map((p) => [p.id, p.status]));
    if (sig !== lastSig) {
      lastSig = sig;
      rebuildScene();
    }
    renderUI();
  } catch (err) {
    $("#ticker-text").textContent = `We couldn't reach the studio — check the internet connection. (${err.message})`;
  }
}

function friendlyActivity(msg) {
  return msg
    .replace(/Post [0-9a-f]+ /i, "A post ")
    .replace(/simulated publish/i, "practice run — not really posted")
    .replace(/Scheduler online.*$/i, "The studio is up and running.")
    .replace(/Demo pipeline seeded.*$/i, "Example posts loaded so you can look around.")
    .replace(/awaiting_approval/gi, "waiting for your OK");
}

function renderUI() {
  if (!state) return;
  // Never wipe out words the owner is in the middle of changing.
  if (document.querySelector('[contenteditable="true"]')) return;

  // header mode line — one plain sentence
  const allLive =
    state.live.claude && state.live.linkedin && state.live.instagram && state.live.facebook;
  const mode = $("#mode-note");
  mode.classList.toggle("live", allLive);
  $("#mode-text").textContent = allLive
    ? "Connected — approved posts really go out."
    : "Practice mode — nothing goes out for real yet.";

  const posts = state.posts;
  const review = posts.filter((p) => ["awaiting_approval", "generating"].includes(p.status))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const booked = posts.filter((p) => p.status === "scheduled")
    .sort((a, b) => (a.scheduledFor || "").localeCompare(b.scheduledFor || ""));
  const posted = posts.filter((p) => p.status === "published")
    .sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));

  // ----- step 2: review queue -----
  $("#review-count").textContent = review.length
    ? `${review.length} waiting for you`
    : "";
  $("#review-empty").hidden = review.length > 0;
  $("#review-list").innerHTML = review.map((p) => {
    if (p.status === "generating") {
      return `<div class="review-post" data-id="${p.id}">
        ${photoSrc(p) ? `<img src="${photoSrc(p)}" alt="Job-site photo">` : "<div></div>"}
        <div class="body"><p class="caption writing">Writing the post for this photo… it takes a few seconds.</p></div>
      </div>`;
    }
    return `<div class="review-post" data-id="${p.id}">
      ${photoSrc(p) ? `<img src="${photoSrc(p)}" alt="Job-site photo">` : "<div></div>"}
      <div class="body">
        <p class="caption" data-role="caption">${escapeHtml(p.caption?.linkedin || "")}</p>
        <p class="tags">${escapeHtml((p.caption?.hashtags || []).map((h) => `#${h}`).join("  "))}</p>
        <div class="actions">
          <button class="yes" data-act="approve">Yes — post it</button>
          <button data-act="edit">Change the words</button>
          <button data-act="regenerate">Write it again</button>
          <button class="no" data-act="reject">No thanks</button>
        </div>
      </div>
    </div>`;
  }).join("");

  // ----- step 3: booked + posted -----
  $("#upcoming-list").innerHTML = booked.length
    ? booked.map((p) => `<div class="list-item" data-id="${p.id}">
        ${photoSrc(p) ? `<img src="${photoSrc(p)}" alt="">` : ""}
        <div class="txt">${escapeHtml(p.note || p.caption?.photo_summary || "Post")}
          <div class="when">Goes out ${niceDay(p.scheduledFor)} at ${niceTime(p.scheduledFor)}</div>
        </div>
        <span class="badge booked">Booked</span>
        <button data-act="publish-now" title="Don't wait — post it right now">Post now</button>
      </div>`).join("")
    : `<p class="mini-empty">Nothing booked yet — say yes to a post above and it lands here.</p>`;

  $("#posted-list").innerHTML = posted.length
    ? posted.slice(0, 6).map((p) => `<div class="list-item" data-id="${p.id}">
        ${photoSrc(p) ? `<img src="${photoSrc(p)}" alt="">` : ""}
        <div class="txt">${escapeHtml(p.note || p.caption?.photo_summary || "Post")}
          <div class="when">Posted ${niceDay(p.publishedAt)}${p.publishResults?.some((r) => r.simulated) ? " (practice run)" : ""}</div>
        </div>
        <span class="badge done">Done</span>
      </div>`).join("")
    : `<p class="mini-empty">Your posted work will show up here.</p>`;

  const a = state.activity[0];
  if (a) $("#ticker-text").textContent = friendlyActivity(a.message);
}

/* ----- actions ----- */
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const card = btn.closest("[data-id]");
  if (!card) return;
  const id = card.dataset.id;
  const act = btn.dataset.act;

  try {
    if (act === "approve") {
      btn.textContent = "Booking it…";
      await api(`/api/posts/${id}/approve`, { method: "POST" });
    }
    if (act === "reject") {
      await api(`/api/posts/${id}/reject`, { method: "POST" });
    }
    if (act === "regenerate") {
      btn.textContent = "Writing…";
      await api(`/api/posts/${id}/regenerate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    }
    if (act === "publish-now") {
      btn.textContent = "Posting…";
      await api(`/api/posts/${id}/publish-now`, { method: "POST" });
    }
    if (act === "edit") {
      const cap = card.querySelector('[data-role="caption"]');
      if (cap.isContentEditable) {
        cap.contentEditable = "false";
        btn.textContent = "Change the words";
        await api(`/api/posts/${id}/edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ linkedin: cap.innerText }),
        });
      } else {
        cap.contentEditable = "true";
        cap.focus();
        btn.textContent = "Save my changes";
        return;
      }
    }
    await refresh();
  } catch (err) {
    $("#ticker-text").textContent = `That didn't work — try once more. (${err.message})`;
  }
});

/* ----- upload ----- */
const fileInput = $("#file-input");
const dropzone = $("#dropzone");
fileInput.addEventListener("change", () => fileInput.files[0] && uploadPhoto(fileInput.files[0]));
["dragover", "dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.toggle("drag", ev === "dragover");
    if (ev === "drop" && e.dataTransfer.files[0]) uploadPhoto(e.dataTransfer.files[0]);
  })
);

async function uploadPhoto(file) {
  const fd = new FormData();
  fd.append("photo", file);
  fd.append("note", $("#note-input").value || "");
  $("#ticker-text").textContent = "Got the photo — writing your post now…";
  try {
    await api("/api/photos", { method: "POST", body: fd });
    $("#note-input").value = "";
    fileInput.value = "";
    await refresh();
    $("#review-section").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    $("#ticker-text").textContent = `The photo didn't go through — try again. (${err.message})`;
  }
}

refresh();
setInterval(refresh, 4000);
