// Network publishers — LinkedIn company page, Instagram Business and the
// Facebook Page (both Meta surfaces go through the Graph API).
// Each returns { network, ok, simulated, detail }. When credentials are
// missing the publish is simulated so the full pipeline stays demoable.
import { readFileSync } from "node:fs";

const LI_TOKEN = () => process.env.LINKEDIN_ACCESS_TOKEN;
const LI_ORG = () => process.env.LINKEDIN_ORG_URN; // urn:li:organization:XXXX
const IG_USER = () => process.env.IG_USER_ID;
const META_TOKEN = () => process.env.META_ACCESS_TOKEN;
const FB_PAGE_ID = () => process.env.FB_PAGE_ID;
// Page posts need a Page token, not the user token. Falls back to the user
// token, which works once the Page is in the app's granted assets.
const FB_PAGE_TOKEN = () => process.env.FB_PAGE_ACCESS_TOKEN || META_TOKEN();
// Instagram and Facebook fetch images by URL, so this must be publicly
// reachable. Render injects RENDER_EXTERNAL_URL, so a deploy there needs no
// manual value; PUBLIC_BASE_URL still wins when set (custom domain, tunnel).
const PUBLIC_BASE = () =>
  (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");

function captionWithTags(text, hashtags) {
  const tags = (hashtags || []).map((t) => `#${t.replace(/^#/, "")}`).join(" ");
  return tags ? `${text}\n\n${tags}` : text;
}

export function networkStatus() {
  return {
    linkedin: Boolean(LI_TOKEN() && LI_ORG()),
    instagram: Boolean(IG_USER() && META_TOKEN() && PUBLIC_BASE()),
    facebook: Boolean(FB_PAGE_ID() && FB_PAGE_TOKEN() && PUBLIC_BASE()),
  };
}

export async function publishLinkedIn(post) {
  if (!LI_TOKEN() || !LI_ORG()) {
    return { network: "linkedin", ok: true, simulated: true, detail: "Simulated — add LINKEDIN_ACCESS_TOKEN + LINKEDIN_ORG_URN to go live." };
  }
  try {
    const headers = {
      Authorization: `Bearer ${LI_TOKEN()}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    };

    // 1. Register the image upload
    const reg = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
      method: "POST",
      headers,
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
          owner: LI_ORG(),
          serviceRelationships: [
            { relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" },
          ],
        },
      }),
    }).then((r) => r.json());

    const uploadUrl =
      reg.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl;
    const asset = reg.value.asset;

    // 2. Upload the binary
    await fetch(uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${LI_TOKEN()}` },
      body: readFileSync(post.photo.path),
    });

    // 3. Create the post
    const body = {
      author: LI_ORG(),
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: captionWithTags(post.caption.linkedin, post.caption.hashtags) },
          shareMediaCategory: "IMAGE",
          media: [{ status: "READY", media: asset, description: { text: post.caption.alt_text || "" } }],
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };
    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LinkedIn ${res.status}: ${await res.text()}`);
    const id = res.headers.get("x-restli-id");
    return { network: "linkedin", ok: true, simulated: false, detail: `Posted (${id})` };
  } catch (err) {
    return { network: "linkedin", ok: false, simulated: false, detail: err.message };
  }
}

export async function publishInstagram(post) {
  if (!IG_USER() || !META_TOKEN() || !PUBLIC_BASE()) {
    return { network: "instagram", ok: true, simulated: true, detail: "Simulated — add IG_USER_ID + META_ACCESS_TOKEN + PUBLIC_BASE_URL to go live." };
  }
  try {
    // Instagram's API fetches the image itself, so it must be publicly reachable.
    // Prefer the Instagram variant (aspect ratio clamped to 4:5…1.91:1, ≤1440 px,
    // JPEG) — the API rejects portrait phone photos outright otherwise.
    const imageUrl = `${PUBLIC_BASE()}/uploads/${encodeURIComponent(post.photo.instagram || post.photo.filename)}`;
    const caption = captionWithTags(post.caption.instagram, post.caption.hashtags);

    const create = await fetch(
      `https://graph.facebook.com/v21.0/${IG_USER()}/media?` +
        new URLSearchParams({ image_url: imageUrl, caption, access_token: META_TOKEN() }),
      { method: "POST" }
    ).then((r) => r.json());
    if (create.error) throw new Error(create.error.message);

    const publish = await fetch(
      `https://graph.facebook.com/v21.0/${IG_USER()}/media_publish?` +
        new URLSearchParams({ creation_id: create.id, access_token: META_TOKEN() }),
      { method: "POST" }
    ).then((r) => r.json());
    if (publish.error) throw new Error(publish.error.message);

    return { network: "instagram", ok: true, simulated: false, detail: `Posted (${publish.id})` };
  } catch (err) {
    return { network: "instagram", ok: false, simulated: false, detail: err.message };
  }
}

export async function publishFacebook(post) {
  if (!FB_PAGE_ID() || !FB_PAGE_TOKEN() || !PUBLIC_BASE()) {
    return { network: "facebook", ok: true, simulated: true, detail: "Simulated — add FB_PAGE_ID + FB_PAGE_ACCESS_TOKEN + PUBLIC_BASE_URL to go live." };
  }
  try {
    // /photos takes the image by URL and the caption in one call, so unlike
    // Instagram there's no create-then-publish two-step.
    const imageUrl = `${PUBLIC_BASE()}/uploads/${encodeURIComponent(post.photo.filename)}`;
    const message = captionWithTags(post.caption.facebook || post.caption.linkedin, post.caption.hashtags);

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${FB_PAGE_ID()}/photos?` +
        new URLSearchParams({ url: imageUrl, message, access_token: FB_PAGE_TOKEN() }),
      { method: "POST" }
    ).then((r) => r.json());
    if (res.error) throw new Error(res.error.message);

    return { network: "facebook", ok: true, simulated: false, detail: `Posted (${res.post_id || res.id})` };
  } catch (err) {
    return { network: "facebook", ok: false, simulated: false, detail: err.message };
  }
}

export async function publishAll(post) {
  return Promise.all([publishLinkedIn(post), publishInstagram(post), publishFacebook(post)]);
}
