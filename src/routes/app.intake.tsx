import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import { useStartIntake, useForgeState } from "@/lib/client";

export const Route = createFileRoute("/app/intake")({
  head: () => ({ meta: [{ title: "New project — ForgeCloud" }] }),
  component: IntakeScreen,
});

const STEPS = [
  { key: "projectName", label: "What are you building?", placeholder: "A simple CRM for my sales team" },
  { key: "userType", label: "Who will use it?", placeholder: "Sales team" },
  { key: "firstVersion", label: "What should v1 do first?", placeholder: "Track leads, notes, and follow-ups" },
  { key: "style", label: "What design style?", placeholder: "Clean, modern, like Notion" },
] as const;

function IntakeScreen() {
  const navigate = useNavigate();
  const { data } = useForgeState();
  const intake = useStartIntake();
  const [step, setStep] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [userType, setUserType] = useState("");
  const [firstVersion, setFirstVersion] = useState("");
  const [needsLogin, setNeedsLogin] = useState(true);
  const [style, setStyle] = useState("");
  const [reviewers, setReviewers] = useState<string[]>(["Animesh"]);

  const values: Record<string, string> = { projectName, userType, firstVersion, style };
  const setters: Record<string, (v: string) => void> = {
    projectName: setProjectName,
    userType: setUserType,
    firstVersion: setFirstVersion,
    style: setStyle,
  };
  const currentStep = STEPS[step];
  const currentValue = values[currentStep.key];
  const canAdvance = currentValue.trim().length > 1;

  const isLast = step === STEPS.length - 1;

  async function submit() {
    const rawPrompt = `Build a ${firstVersion} for ${userType}. Style: ${style}. Login: ${needsLogin ? "yes" : "no"}.`;
    await intake.mutateAsync({
      projectName: projectName.trim(),
      userType: userType.trim(),
      firstVersion: firstVersion.trim(),
      needsLogin,
      style: style.trim(),
      reviewers,
      rawPrompt,
    });
    navigate({ to: "/app/chat" });
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="mb-8 flex items-center justify-between">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-1 inline size-3" /> Back home
          </Link>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Step {step + 1} of {STEPS.length}</span>
            <div className="flex gap-1">
              {STEPS.map((_, i) => (
                <div key={i} className={`h-1 w-6 rounded-full ${i <= step ? "bg-brand" : "bg-muted"}`} />
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-8">
          <div className="mb-6 flex items-center gap-2 text-sm font-medium text-brand">
            <Sparkles className="size-4" />
            {isLast ? "Last detail" : `Tell us about the project`}
          </div>
          <h2 className="text-3xl font-bold">{currentStep.label}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            One short answer is fine. The Product Agent will turn this into a build plan.
          </p>
          <div className="mt-6">
            <textarea
              autoFocus
              value={currentValue}
              onChange={(e) => setters[currentStep.key](e.target.value)}
              placeholder={currentStep.placeholder}
              className="w-full rounded-2xl border border-border bg-background px-5 py-4 text-lg outline-none focus:border-brand"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && canAdvance) {
                  e.preventDefault();
                  if (isLast) submit();
                  else setStep(step + 1);
                }
              }}
            />
          </div>

          {currentStep.key === "firstVersion" && (
            <div className="mt-4">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={needsLogin}
                  onChange={(e) => setNeedsLogin(e.target.checked)}
                  className="size-4 rounded border-border"
                />
                Team needs to log in to use it
              </label>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="rounded-full border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-30"
            >
              Back
            </button>
            {isLast ? (
              <button
                onClick={submit}
                disabled={!canAdvance || intake.isPending}
                className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-2.5 font-medium text-brand-foreground hover:brightness-105 disabled:opacity-40"
              >
                {intake.isPending ? <><Loader2 className="size-4 animate-spin" /> Generating plan...</> : <>Generate workspace <ArrowRight className="size-4" /></>}
              </button>
            ) : (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!canAdvance}
                className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-2.5 font-medium text-background hover:opacity-90 disabled:opacity-30"
              >
                Continue <ArrowRight className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-muted-foreground">
          {data?.aiAvailable ? "AI agents ready" : "AI in fallback mode — you'll get a template plan"}
        </div>
      </div>
    </div>
  );
}
