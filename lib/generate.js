// Post generation — Claude reads the crew photo + Katena's voice profile and
// drafts platform-specific captions. Falls back to demo copy when no
// Anthropic credentials are configured, so the pipeline can be shown live
// before keys arrive.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

const POST_SCHEMA = {
  type: "object",
  properties: {
    photo_summary: {
      type: "string",
      description: "One sentence describing what the photo shows.",
    },
    linkedin: {
      type: "string",
      description:
        "LinkedIn post body, 60-140 words, professional but human. No hashtags inline.",
    },
    instagram: {
      type: "string",
      description: "Instagram caption, 20-60 words, more visual and punchy. No hashtags inline.",
    },
    facebook: {
      type: "string",
      description:
        "Facebook Page post, 40-100 words — warmer than LinkedIn, longer than Instagram, same GC/developer audience. No hashtags inline.",
    },
    hashtags: {
      type: "array",
      items: { type: "string" },
      description: "5-8 hashtags without the # symbol.",
    },
    alt_text: {
      type: "string",
      description: "Accessibility alt text for the image.",
    },
  },
  required: ["photo_summary", "linkedin", "instagram", "facebook", "hashtags", "alt_text"],
  additionalProperties: false,
};

function voiceProfile() {
  return readFileSync(join(ROOT, "brand", "voice.md"), "utf8");
}

export function hasClaudeKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function generatePost({ imagePath, mime, note }) {
  if (!hasClaudeKey()) return demoPost(note);

  const client = new Anthropic();
  const imageData = readFileSync(imagePath).toString("base64");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text:
          "You are the social media voice of Katena Railings, a high-rise railing " +
          "installation company. You turn crew photos into posts that win work from " +
          "general contractors, developers, and property managers — proof-of-work " +
          "marketing, never fluff. Follow the voice profile exactly.\n\n" +
          voiceProfile(),
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: POST_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mime, data: imageData },
          },
          {
            type: "text",
            text:
              "Draft a LinkedIn post and an Instagram caption for this job-site photo." +
              (note ? `\n\nCrew note about the photo: ${note}` : ""),
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to caption this image — try a different photo.");
  }

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("No text block in Claude response.");
  return { ...JSON.parse(text), demo: false, model: response.model };
}

function demoPost(note) {
  const flavor = note ? ` ${note.replace(/\.$/, "")}.` : "";
  return {
    photo_summary: "Crew photo awaiting live captioning (demo mode — no API key yet).",
    linkedin:
      "[DEMO CAPTION — connects to Claude once the API key is added]\n\n" +
      `Another install milestone for the Katena crew.${flavor} ` +
      "Glass and aluminum guardrail systems, engineered, fabricated and installed " +
      "to spec — floor by floor, tower by tower. If your project needs a railing " +
      "partner who hits schedule, let's talk.",
    instagram:
      `[DEMO] Railing day at height.${flavor} Precision work by the Katena crew.`,
    facebook:
      "[DEMO CAPTION — connects to Claude once the API key is added]\n\n" +
      `Another day, another floor of guardrail up.${flavor} ` +
      "Our crews engineer, fabricate and install glass and aluminum railing " +
      "systems for high-rise towers — on spec and on schedule. " +
      "Bidding a tower this year? Get in touch.",
    hashtags: ["KatenaRailings", "HighRiseConstruction", "GlassRailings", "GTAConstruction", "Guardrails", "ConstructionLife"],
    alt_text: "Job-site photo from a Katena Railings installation.",
    demo: true,
    model: "demo",
  };
}
