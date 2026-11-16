import { containsToken } from "./quotes";

/**
 * A code station is only offered when the resume itself shows coding.
 * This is a deliberate keyword check, done in code so the rule does not depend
 * on the model. SQL, Excel and HTML alone do not count.
 */
const CLEAR_TERMS = [
  "python", "javascript", "typescript", "c++", "c#", "golang", "kotlin", "php", "swiftui", "objective-c",
  "node.js", "nodejs", "django", "flask", "spring boot", "bash scripting", "shell scripting",
  "software engineer", "software developer", "web developer", "full stack", "full-stack",
  "backend developer", "frontend developer", "back-end developer", "front-end developer",
  "programmer", "programming", "wrote scripts", "automation scripts", "unit tests",
  "pull requests", "code review", "code reviews", "github", "gitlab", "leetcode",
];

/** Words that are also everyday words or names. One alone is not enough; two are. */
const AMBIGUOUS_TERMS = ["java", "rust", "ruby", "react", "angular", "vue", "scala", "perl", "coding", ".net"];

export function findCodingEvidence(resumeText: string): string[] {
  const clear = CLEAR_TERMS.filter((term) => containsToken(resumeText, term));
  const ambiguous = AMBIGUOUS_TERMS.filter((term) => containsToken(resumeText, term));
  return clear.length > 0 || ambiguous.length >= 2 ? [...clear, ...ambiguous] : [];
}

export function hasCodingEvidence(resumeText: string): boolean {
  return findCodingEvidence(resumeText).length > 0;
}
