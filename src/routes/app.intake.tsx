import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, ArrowLeft, Sparkles, Loader2, Zap } from "lucide-react";
import { useStartIntake, useForgeState, useSkipToDemo } from "@/lib/client";

export const Route = createFileRoute("/app/intake")({
  head: () => ({ meta: [{ title: "New project — ForgeCloud" }] }),
  component: IntakeScreen,
});

const STEPS = [
  { key: "projectName", label: "What are you building?", placeholder: "A simple CRM for my sales team", defaultValue: "Pielot Waitlist" },
  { key: "userType", label: "Who will use it?", placeholder: "Sales team", defaultValue: "Early adopters and the general public" },
  { key: "firstVersion", label: "What should v1 do first?", placeholder: "Track leads, notes, and follow-ups", defaultValue: "Collect email signups, show position in line, and let me see signups in a simple admin view" },
  { key: "style", label: "What design style?", placeholder: "Clean, modern, like Notion", defaultValue: "Clean, modern, like Linear — warm accent color" },
] as const;

function IntakeScreen() {
  const navigate = useNavigate();
  const { data } = useForgeState();
  const intake = useStartIntake();
  const skip = useSkipToDemo();
  const [step, setStep] = useState(0);
  const [projectName, setProjectName] = useState(STEPS[0].defaultValue);
  const [userType, setUserType] = useState(STEPS[1].defaultValue);
  const [firstVersion, setFirstVersion] = useState(STEPS[2].defaultValue);
  const [needsLogin, setNeedsLogin] = useState(true);
  const [style, setStyle] = useState(STEPS[3].defaultValue);
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
    navigate({ to: "/app" });
  }

  async function handleSkipToDemo() {
    await skip.mutateAsync();
    navigate({ to: "/app" });
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
            {currentValue === currentStep.defaultValue && (
              <p className="mt-2 text-xs text-muted-foreground">
                Example pre-filled. Press Continue or edit it.
              </p>
            )}
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

        <div className="mt-6 flex flex-col items-center gap-3">
          <button
            onClick={handleSkipToDemo}
            disabled={skip.isPending}
            className="inline-flex items-center gap-2 rounded-full border-2 border-dashed border-border bg-card px-5 py-2.5 text-sm font-medium text-muted-foreground hover:border-brand hover:text-foreground disabled:opacity-40"
          >
            {skip.isPending ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
            Skip to demo — load Pielot Waitlist
          </button>
          <div className="text-xs text-muted-foreground">
            {data?.aiAvailable ? "AI agents ready" : "AI in fallback mode — you'll get a template plan"}
          </div>
        </div>
      </div>
    </div>
  );
}
