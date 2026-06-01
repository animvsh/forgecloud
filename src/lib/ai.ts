import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

function client(): Anthropic | null {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _client = new Anthropic({ apiKey });
  return _client;
}

export const AI_MODEL_PRIMARY = "claude-sonnet-4-6";
export const AI_MODEL_FALLBACK = "claude-haiku-4-5-20251001";

export type PlanFeature = {
  title: string;
  description: string;
  ownerAgent: string;
  riskLevel: "low" | "med" | "high";
  estimatedFiles: number;
};

export type BuildPlan = {
  summary: string;
  features: PlanFeature[];
  suggestedProjectName: string;
  suggestedStyle: string;
};

const PLAN_SYSTEM = `You are the Product Agent for ForgeCloud, a cloud-based AI software team for non-technical builders.

When a user describes what they want to build, you return a structured build plan as JSON. The plan is shown to the user in plain English BEFORE any code is written. The user reviews and approves it.

Output ONLY valid JSON matching this exact shape:
{
  "summary": "one-sentence plain-English summary of what we'll build",
  "suggestedProjectName": "short project name (2-4 words)",
  "suggestedStyle": "one design style adjective like 'Notion-clean' or 'Stripe-modern'",
  "features": [
    {
      "title": "short feature name (2-4 words)",
      "description": "what the feature does in plain English, no jargon",
      "ownerAgent": "Product Agent" | "Design Agent" | "Frontend Agent" | "Backend Agent" | "QA Agent" | "DevOps Agent" | "Auth Agent" | "Ops Agent",
      "riskLevel": "low" | "med" | "high",
      "estimatedFiles": number
    }
  ]
}

Rules:
- Generate 4-8 features that cover a complete v1 of what the user asked for
- For a CRM: lead dashboard, add lead form, lead detail, notes, follow-up status, login
- For a waitlist: landing page, signup form, dashboard, email confirmation
- For an internal tool: list view, detail view, edit form, search, login
- riskLevel: "low" = new file/component, "med" = changes existing behavior, "high" = modifies database schema or production deploy
- estimatedFiles: rough count of files this feature would touch (1-15)
- Each feature should be a discrete, shippable unit
- Use plain English. No code, no jargon, no SQL.`;

export async function generateBuildPlan(
  userPrompt: string,
): Promise<BuildPlan> {
  const c = client();
  if (!c) {
    return fallbackPlan(userPrompt);
  }
  try {
    const response = await c.messages.create({
      model: AI_MODEL_PRIMARY,
      max_tokens: 2048,
      system: PLAN_SYSTEM,
      messages: [
        {
          role: "user",
          content: `User request: "${userPrompt}"\n\nGenerate the build plan JSON.`,
        },
      ],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
    return parsePlanJson(text, userPrompt);
  } catch (err) {
    console.error("AI plan generation failed, using fallback:", err);
    return fallbackPlan(userPrompt);
  }
}

function parsePlanJson(text: string, originalPrompt: string): BuildPlan {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return fallbackPlan(originalPrompt);
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.features || !Array.isArray(parsed.features)) {
      return fallbackPlan(originalPrompt);
    }
    return {
      summary: parsed.summary || `Build plan for: ${originalPrompt}`,
      suggestedProjectName: parsed.suggestedProjectName || "New Project",
      suggestedStyle: parsed.suggestedStyle || "Notion-clean",
      features: parsed.features.slice(0, 10).map((f: PlanFeature) => ({
        title: f.title || "Untitled feature",
        description: f.description || "",
        ownerAgent: f.ownerAgent || "Frontend Agent",
        riskLevel: f.riskLevel || "low",
        estimatedFiles: f.estimatedFiles || 3,
      })),
    };
  } catch {
    return fallbackPlan(originalPrompt);
  }
}

function fallbackPlan(prompt: string): BuildPlan {
  const lower = prompt.toLowerCase();
  if (lower.includes("crm") || lower.includes("sales") || lower.includes("lead")) {
    return {
      summary: "A complete CRM for tracking leads, notes, and follow-ups.",
      suggestedProjectName: "Sales CRM",
      suggestedStyle: "Notion-clean",
      features: [
        { title: "Lead dashboard", description: "View all leads in a sortable table", ownerAgent: "Frontend Agent", riskLevel: "low", estimatedFiles: 4 },
        { title: "Add lead form", description: "Form to create a new lead with name, email, company", ownerAgent: "Frontend Agent", riskLevel: "low", estimatedFiles: 3 },
        { title: "Lead notes", description: "Add and view notes attached to each lead", ownerAgent: "Backend Agent", riskLevel: "low", estimatedFiles: 2 },
        { title: "Follow-up status", description: "Mark leads as New, Contacted, Won, or Lost", ownerAgent: "Backend Agent", riskLevel: "med", estimatedFiles: 2 },
        { title: "Login page", description: "Only team members can access the CRM", ownerAgent: "Auth Agent", riskLevel: "med", estimatedFiles: 4 },
        { title: "Preview deploy", description: "Live preview URL for the team to test", ownerAgent: "DevOps Agent", riskLevel: "low", estimatedFiles: 1 },
      ],
    };
  }
  if (lower.includes("waitlist") || lower.includes("landing")) {
    return {
      summary: "A landing page and waitlist signup for early access.",
      suggestedProjectName: "Waitlist",
      suggestedStyle: "Stripe-modern",
      features: [
        { title: "Landing page", description: "Hero, features, and call-to-action", ownerAgent: "Design Agent", riskLevel: "low", estimatedFiles: 3 },
        { title: "Waitlist form", description: "Email signup with confirmation", ownerAgent: "Frontend Agent", riskLevel: "low", estimatedFiles: 2 },
        { title: "Admin dashboard", description: "View signups and export to CSV", ownerAgent: "Frontend Agent", riskLevel: "low", estimatedFiles: 3 },
        { title: "Email confirmation", description: "Send welcome email on signup", ownerAgent: "Backend Agent", riskLevel: "med", estimatedFiles: 2 },
        { title: "Preview deploy", description: "Live preview URL", ownerAgent: "DevOps Agent", riskLevel: "low", estimatedFiles: 1 },
      ],
    };
  }
  return {
    summary: `A custom app: ${prompt.slice(0, 80)}`,
    suggestedProjectName: "New App",
    suggestedStyle: "Modern clean",
    features: [
      { title: "Main view", description: "Primary screen of the app", ownerAgent: "Frontend Agent", riskLevel: "low", estimatedFiles: 3 },
      { title: "Detail view", description: "Drill-down on each item", ownerAgent: "Frontend Agent", riskLevel: "low", estimatedFiles: 2 },
      { title: "Form for new items", description: "Create new entries with validation", ownerAgent: "Frontend Agent", riskLevel: "low", estimatedFiles: 2 },
      { title: "Data persistence", description: "Save and load from database", ownerAgent: "Backend Agent", riskLevel: "med", estimatedFiles: 3 },
      { title: "Login", description: "Team access only", ownerAgent: "Auth Agent", riskLevel: "med", estimatedFiles: 4 },
      { title: "Preview deploy", description: "Live preview URL", ownerAgent: "DevOps Agent", riskLevel: "low", estimatedFiles: 1 },
    ],
  };
}

const PR_SUMMARY_SYSTEM = `You are the Frontend or Backend Agent for ForgeCloud.

Given a feature being built, write a plain-English PR summary in 2-3 short sentences. The user is a non-technical founder. They should understand what changed, why, and what they can see in the preview.

Output ONLY the summary text, no JSON, no preamble.`;

export async function generatePrSummary(
  featureTitle: string,
  featureDescription: string,
  ownerAgent: string,
): Promise<string> {
  const c = client();
  if (!c) {
    return `${ownerAgent} shipped "${featureTitle}". ${featureDescription} The team can preview the change and approve, request edits, or roll back.`;
  }
  try {
    const response = await c.messages.create({
      model: AI_MODEL_PRIMARY,
      max_tokens: 256,
      system: PR_SUMMARY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Feature: ${featureTitle}\nWhat it does: ${featureDescription}\nAgent: ${ownerAgent}\n\nWrite the PR summary.`,
        },
      ],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();
    return text || `${ownerAgent} shipped "${featureTitle}".`;
  } catch {
    return `${ownerAgent} shipped "${featureTitle}". ${featureDescription}`;
  }
}

const RISK_SYSTEM = `You classify the risk level of a code change for a non-technical team's review queue.

Risk levels:
- "low" = new isolated feature, no schema change, no production impact
- "med" = modifies existing data, affects how the app works for users, touches production
- "high" = changes database schema, modifies auth, deploys to production, touches billing

Given a feature and what was changed, output ONLY the risk level as one word: "low", "med", or "high".`;

export async function classifyRisk(
  featureTitle: string,
  featureDescription: string,
  modifiesDatabase: boolean,
  modifiesAuth: boolean,
  isProduction: boolean,
): Promise<"low" | "med" | "high"> {
  if (isProduction || modifiesAuth) return "high";
  if (modifiesDatabase) return "med";
  const c = client();
  if (!c) return "low";
  try {
    const response = await c.messages.create({
      model: AI_MODEL_PRIMARY,
      max_tokens: 16,
      system: RISK_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Feature: ${featureTitle}\nDescription: ${featureDescription}`,
        },
      ],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim()
      .toLowerCase();
    if (text.includes("high")) return "high";
    if (text.includes("med")) return "med";
    return "low";
  } catch {
    return "low";
  }
}

const RECOVERY_SYSTEM = `You are the Recovery Agent for ForgeCloud. When something fails, you explain in one short, calm sentence what happened and what was done about it. The user is non-technical.

Output ONLY a single sentence. No JSON, no preamble.`;

export async function narrateRecovery(
  failureType: string,
  failureMessage: string,
  recoveryAction: string,
): Promise<string> {
  const c = client();
  if (!c) {
    return `${failureMessage} ${recoveryAction}.`;
  }
  try {
    const response = await c.messages.create({
      model: AI_MODEL_PRIMARY,
      max_tokens: 100,
      system: RECOVERY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Failure: ${failureType} — ${failureMessage}\nRecovery: ${recoveryAction}\n\nNarrate it.`,
        },
      ],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();
    return text || `${recoveryAction}.`;
  } catch {
    return `${failureMessage} ${recoveryAction}.`;
  }
}

export function isAiAvailable(): boolean {
  return client() !== null;
}
