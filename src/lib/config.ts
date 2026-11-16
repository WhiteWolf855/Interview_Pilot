/** App identity and limits shared by the client and the server. No secrets here. */
export const APP = {
  name: "Interview Pilot",
  tagline: "AI interview simulator",
  packageId: "com.brojekt.intas",
} as const;

export const LIMITS = {
  resumeMaxBytes: 5 * 1024 * 1024,
  resumeMinChars: 200,
  resumeMaxChars: 40_000,
  jobMinChars: 100,
  jobMaxChars: 20_000,
  shortFieldMaxChars: 120,
  doNotClaimMaxChars: 1_500,
  answerMaxChars: 6_000,
  notesMaxChars: 2_000,
  stationSummaryMaxChars: 8_000,
  followUpsPerStage: 2,
} as const;

export const INTERVIEW_LENGTHS = [20, 30, 45, 60] as const;
export type InterviewLength = (typeof INTERVIEW_LENGTHS)[number];

/** Stage counts scale with the interview length. 45 minutes is the default. */
export const STAGE_COUNTS: Record<InterviewLength, { conversation: number; handsOn: number }> = {
  20: { conversation: 4, handsOn: 2 },
  30: { conversation: 5, handsOn: 2 },
  45: { conversation: 7, handsOn: 3 },
  60: { conversation: 8, handsOn: 3 },
};

export const MODES = ["timed", "untimed", "prep"] as const;
export type InterviewMode = (typeof MODES)[number];

export const STATION_TYPES = ["terminal", "code", "api", "data", "written"] as const;
export type StationType = (typeof STATION_TYPES)[number];

/** Stations a non-technical role may be given. */
export const NON_TECHNICAL_STATIONS: readonly StationType[] = ["written", "data"];
