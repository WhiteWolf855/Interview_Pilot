import "server-only";
import { STAGE_COUNTS, type InterviewLength, type StationType } from "@/lib/config";
import type { StageRecord } from "@/lib/schemas/debrief";
import type { Outline, OutlineStage, Plan, Stage } from "@/lib/schemas/plan";
import { LIBRARY } from "@/lib/stations/library";
import type { AiProvider, StructuredRequest } from "./provider";

/**
 * Canned, schema-valid responses for tests and for working on the UI without
 * an API key. It proves the plumbing only. It does not judge anything: its
 * "scores" come from answer length.
 */

const rubric = (topic: string) => ({
  criteria: [`Gives a specific example about ${topic}`, "Makes their own contribution clear", "States the outcome"],
  strongAnswer: `A specific, structured account of ${topic} with the candidate's own actions and the result.`,
  redFlags: ["Stays generic", "Only says 'we'"],
});

function conversation(category: OutlineStage["category"], title: string, question: string, from: OutlineStage["sourceFrom"], quote: string): OutlineStage {
  return { kind: "conversation", title, category, station: "none", openingQuestion: question, intent: `Whether the candidate has real depth on: ${title.toLowerCase()}.`, rubric: rubric(title.toLowerCase()), sourceFrom: from, sourceQuote: quote };
}

function mockOutline(context: Record<string, unknown>): Outline {
  const length = (context.lengthMinutes as InterviewLength) ?? 45;
  const technical = Boolean(context.technical);
  const coding = Boolean(context.codingEvidence);
  const resumeQuote = String(context.resumeQuote ?? "");
  const jobQuote = String(context.jobQuote ?? "");
  const counts = STAGE_COUNTS[length];
  const pool: OutlineStage[] = [
    conversation("opener", "Your background", `Your resume says "${resumeQuote}". Walk me through that and what your part in it was.`, "resume", resumeQuote),
    conversation("role_tool", "Fit for this role", `The posting asks for "${jobQuote}". What is the closest thing you have done to that?`, "job_description", jobQuote),
    conversation("failure", "Something that went wrong", "Tell me about a piece of work from your resume that went wrong. What happened and what did you do about it?", "resume", resumeQuote),
    conversation("proactive", "Acting without being asked", "Tell me about a time you fixed or improved something nobody had asked you to. How did you spot it?", "resume", resumeQuote),
    conversation("resume_deep_dive", "A decision you made", "Pick one decision from your most recent role that you would defend to a sceptic. Why was it right?", "resume", resumeQuote),
    conversation("scenario", "First month in the role", "Suppose you start here next month. What would you do first to get on top of this job?", "job_description", jobQuote),
    conversation("behavioural", "Disagreement", "Tell me about a disagreement with a colleague about how to do the work. How was it settled?", "none", ""),
    conversation("motivation", "Why this role", "What about this posting made you apply, and what would you want to learn in it?", "job_description", jobQuote),
  ];
  const stations: StationType[] = technical ? ["terminal", "api", coding ? "code" : "data"] : ["written", "data", "written"];
  const stages: OutlineStage[] = pool.slice(0, counts.conversation);
  stations.slice(0, counts.handsOn).forEach((station, index) => {
    const item = LIBRARY[station];
    const handsOn: OutlineStage = { kind: "hands_on", title: item.title, category: "opener", station, openingQuestion: item.brief, intent: item.intent, rubric: item.rubric, sourceFrom: "none", sourceQuote: "" };
    // Spread the hands-on stages through the second half of the interview.
    stages.splice(Math.min(stages.length, 2 + index * 2), 0, handsOn);
  });
  return { role: { title: String(context.roleTitle ?? "Candidate role"), company: "", seniority: "Mid-level", technical }, stages };
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function mockFollowUp(context: Record<string, unknown>) {
  const answer = String(context.lastAnswer ?? "");
  const opening = words(answer).slice(0, 6).join(" ");
  if (!opening) return { probing: "no answer given", question: "I did not catch an answer there. Can you give me one specific example?" };
  return Number(context.followUpNumber) === 1
    ? { probing: "their own contribution", question: `You said "${opening}". What exactly did you do yourself there, as opposed to the team?` }
    : { probing: "the result", question: "What was the result of that, and how did you know it had worked?" };
}

function scoreByLength(text: string): number {
  const count = words(text).length;
  if (count === 0) return 0;
  if (count < 15) return 1;
  if (count < 40) return 2;
  if (count < 90) return 3;
  return 4;
}

function mockStageGrade(stage: Stage, record: StageRecord | undefined) {
  if (stage.kind === "hands_on") {
    const station = record?.station;
    const passed = station?.checks.filter((c) => c.passed).length ?? 0;
    return {
      stageId: stage.id,
      score: station?.baseScore ?? 0,
      verdict: station?.attempted ? `You passed ${passed} of ${station.checks.length} checks.` : "You did not attempt this exercise.",
      strong: passed > 0 ? ["You completed part of the exercise correctly."] : [],
      missing: station && passed < station.checks.length ? ["Some checks did not pass. Review what the task asked for."] : [],
      honestGapWithSoundApproach: false,
    };
  }
  const said = (record?.turns ?? []).map((t) => t.answer).join(" ");
  const honest = /\b(haven't|have not|never)\b/i.test(said) && /\b(would|approach)\b/i.test(said) && words(said).length >= 25;
  const score = scoreByLength(said);
  return {
    stageId: stage.id,
    score,
    verdict: score === 0 ? "You did not answer this question." : `Sample feedback from the mock provider (score based on length only).`,
    strong: score >= 3 ? ["You gave a reasonably detailed answer."] : [],
    missing: score < 4 ? ["Add a specific example with your own actions and the result."] : [],
    honestGapWithSoundApproach: honest,
  };
}

function mockGrade(context: Record<string, unknown>) {
  const plan = context.plan as Plan;
  const records = context.records as StageRecord[];
  const byId = new Map(records.map((r) => [r.stageId, r]));
  const stages = plan.stages.map((stage) => mockStageGrade(stage, byId.get(stage.id)));
  const answered = plan.stages
    .filter((s) => s.kind === "conversation" && (byId.get(s.id)?.turns ?? []).some((t) => t.answer.trim()))
    .map((s) => {
      const grade = stages.find((g) => g.stageId === s.id)!;
      return { id: s.id, score: Math.max(grade.score, grade.honestGapWithSoundApproach ? 3 : 0) };
    });
  let tighterAnswer = { stageId: "", answer: "", factsUsed: [] as string[] };
  if (answered.length) {
    const lowest = answered.reduce((a, b) => (b.score < a.score ? b : a));
    const firstAnswer = byId.get(lowest.id)!.turns.find((t) => t.answer.trim())!.answer.trim();
    const fact = words(firstAnswer).slice(0, 5).join(" ");
    const core = firstAnswer.replace(/\d+/g, "").slice(0, 300);
    tighterAnswer = {
      stageId: lowest.id,
      answer: `Here is the situation: ${core} [add what you did yourself, step by step] [add the result: what changed, with a number if you have one] [add what you took from it]`,
      factsUsed: [fact],
    };
  }
  const average = stages.reduce((sum, s) => sum + s.score, 0) / Math.max(1, stages.length);
  return {
    stages,
    overallSummary: "This debrief was produced by the mock provider, which scores on answer length only. Connect a real API key for real grading.",
    hireSignal: average >= 3.5 ? "lean_yes" : average >= 2.5 ? "lean_no" : "no",
    tighterAnswer,
  };
}

function stationWire(station: StationType): unknown {
  const config = LIBRARY[station].config as Record<string, unknown>;
  const { language: _language, ...rest } = config;
  return rest;
}

export const mockProvider: AiProvider = {
  async generate(request: StructuredRequest) {
    const context = request.mock ?? {};
    let data: unknown;
    switch (request.purpose) {
      case "outline":
        data = mockOutline(context);
        break;
      case "station":
        data = stationWire(context.station as StationType);
        break;
      case "followup":
        data = mockFollowUp(context);
        break;
      case "grade":
        data = mockGrade(context);
        break;
      case "stage_feedback":
        data = mockStageGrade(context.stage as Stage, context.record as StageRecord);
        break;
    }
    const delay = Number(process.env.MOCK_AI_DELAY_MS ?? "0");
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return { data, model: "mock", inputTokens: 0, outputTokens: 0 };
  },
};
