import { describe, expect, it } from "vitest";
import { TerminalConfigSchema, type TerminalConfig } from "@/lib/schemas/stations";
import { LIBRARY } from "@/lib/stations/library";
import { evaluateTerminalChecks, gradeTerminal, replayTerminalSolution, validateTerminalConfig } from "@/lib/stations/terminal/grade";
import { compilePattern, createTerminal, runCommand, writeFile, type TerminalState } from "@/lib/stations/terminal/sim";

const config = LIBRARY.terminal.config;

function run(state: TerminalState, ...lines: string[]): { state: TerminalState; output: string } {
  let output = "";
  for (const line of lines) {
    const outcome = runCommand(state, line);
    state = outcome.state;
    output = outcome.output;
  }
  return { state, output };
}

const fresh = () =>
  createTerminal({
    cwd: "/home/candidate",
    files: [
      { path: "/home/candidate/notes.txt", content: "alpha\nbeta\ngamma\nbeta\n" },
      { path: "/home/candidate/data/sales.csv", content: "region,amount\nnorth,30\nsouth,5\nnorth,12\n" },
      { path: "/home/candidate/data/app.log", content: "INFO start\nERROR disk full\nWARN slow\nERROR disk full\nINFO done\n" },
    ],
  });

describe("terminal simulator", () => {
  it("navigates: pwd, cd, ls", () => {
    expect(run(fresh(), "pwd").output).toBe("/home/candidate\n");
    expect(run(fresh(), "ls").output).toBe("data/\nnotes.txt\n");
    expect(run(fresh(), "cd data", "pwd").output).toBe("/home/candidate/data\n");
    expect(run(fresh(), "cd data", "cd ..", "pwd").output).toBe("/home/candidate\n");
    expect(run(fresh(), "cd /", "cd ~", "pwd").output).toBe("/home/candidate\n");
    expect(run(fresh(), "cd nowhere").output).toContain("No such file or directory");
    expect(run(fresh(), "cd notes.txt").output).toContain("Not a directory");
    expect(run(fresh(), "ls -l data").output).toContain("sales.csv");
    expect(run(fresh(), "ls data/*.csv").output).toBe("data/sales.csv\n");
  });

  it("reads files: cat, head, tail, wc", () => {
    expect(run(fresh(), "cat notes.txt").output).toBe("alpha\nbeta\ngamma\nbeta\n");
    expect(run(fresh(), "head -n 2 notes.txt").output).toBe("alpha\nbeta\n");
    expect(run(fresh(), "head -1 notes.txt").output).toBe("alpha\n");
    expect(run(fresh(), "tail -n 1 notes.txt").output).toBe("beta\n");
    expect(run(fresh(), "tail -n +2 data/sales.csv").output).toBe("north,30\nsouth,5\nnorth,12\n");
    expect(run(fresh(), "wc -l notes.txt").output).toBe("4 notes.txt\n");
    expect(run(fresh(), "cat missing.txt").output).toContain("No such file or directory");
    expect(run(fresh(), "cat data").output).toContain("Is a directory");
  });

  it("searches: grep with flags, find", () => {
    expect(run(fresh(), "grep ERROR data/app.log").output).toBe("ERROR disk full\nERROR disk full\n");
    expect(run(fresh(), "grep -c ERROR data/app.log").output).toBe("2\n");
    expect(run(fresh(), "grep -i error data/app.log").output).toContain("ERROR disk full");
    expect(run(fresh(), "grep -n WARN data/app.log").output).toBe("3:WARN slow\n");
    expect(run(fresh(), "grep -v INFO data/app.log").output).toBe("ERROR disk full\nWARN slow\nERROR disk full\n");
    expect(run(fresh(), "grep -r north .").output).toBe("data/sales.csv:north,30\ndata/sales.csv:north,12\n");
    expect(run(fresh(), "grep -l ERROR data/app.log data/sales.csv").output).toBe("data/app.log\n");
    expect(run(fresh(), "grep nothing notes.txt").output).toBe("");
    expect(run(fresh(), "find . -name '*.csv'").output).toBe("./data/sales.csv\n");
    expect(run(fresh(), "find data -type f").output).toBe("data/app.log\ndata/sales.csv\n");
  });

  it("supports pipes with sort, uniq, cut, awk and wc", () => {
    expect(run(fresh(), "sort notes.txt | uniq -c | sort -rn | head -n 1").output).toBe("      2 beta\n");
    expect(run(fresh(), "cat data/app.log | grep ERROR | wc -l").output).toBe("2\n");
    expect(run(fresh(), "cut -d, -f1 data/sales.csv | sort -u").output).toBe("north\nregion\nsouth\n");
    expect(run(fresh(), "awk -F, '{print $2}' data/sales.csv | tail -n 1").output).toBe("12\n");
    expect(run(fresh(), "awk '{print $1}' data/app.log | sort | uniq").output).toBe("ERROR\nINFO\nWARN\n");
    expect(run(fresh(), "sort -t, -k2 -n data/sales.csv | tail -n 1").output).toBe("north,30\n");
  });

  it("writes files: echo with redirects, touch, mkdir, cp, mv, rm, sed -i", () => {
    expect(run(fresh(), "echo hello > out.txt", "cat out.txt").output).toBe("hello\n");
    expect(run(fresh(), "echo one > out.txt", "echo two >> out.txt", "cat out.txt").output).toBe("one\ntwo\n");
    expect(run(fresh(), 'echo "a  b" > q.txt', "cat q.txt").output).toBe("a  b\n");
    expect(run(fresh(), "touch new.txt", "ls").output).toContain("new.txt");
    expect(run(fresh(), "mkdir tmp", "cp notes.txt tmp", "ls tmp").output).toBe("notes.txt\n");
    expect(run(fresh(), "mv notes.txt renamed.txt", "ls").output).toBe("data/\nrenamed.txt\n");
    expect(run(fresh(), "rm notes.txt", "ls").output).toBe("data/\n");
    expect(run(fresh(), "rm data").output).toContain("is a directory");
    expect(run(fresh(), "rm -r data", "ls").output).toBe("notes.txt\n");
    expect(run(fresh(), "sed -i 's/beta/delta/g' notes.txt", "cat notes.txt").output).toBe("alpha\ndelta\ngamma\ndelta\n");
    expect(run(fresh(), "sed 's/alpha/omega/' notes.txt | head -n 1").output).toBe("omega\n");
    expect(run(fresh(), "echo x > nodir/file.txt").output).toContain("No such file or directory");
  });

  it("handles sequencing, errors and unsupported input", () => {
    expect(run(fresh(), "cd data && pwd").output).toBe("/home/candidate/data\n");
    expect(run(fresh(), "cd nowhere && pwd").output).not.toContain("/home/candidate\n");
    expect(run(fresh(), "cd nowhere ; pwd").output).toContain("/home/candidate\n");
    expect(run(fresh(), "curl example.com").output).toContain("command not found");
    expect(run(fresh(), 'echo "unterminated').output).toContain("unterminated quote");
    expect(run(fresh(), "sleep 1 &").output).toContain("not supported");
    expect(run(fresh(), "awk 'BEGIN{x=1}'").output).toContain("only");
    expect(runCommand(fresh(), "clear").clear).toBe(true);
    expect(runCommand(fresh(), "edit notes.txt").editPath).toBe("/home/candidate/notes.txt");
    expect(run(fresh(), "help").output).toContain("grep");
  });

  it("records history, including editor saves, and does not mutate earlier states", () => {
    const start = fresh();
    const after = run(start, "ls", "pwd").state;
    expect(after.history).toEqual(["ls", "pwd"]);
    expect(start.history).toEqual([]);
    const edited = writeFile(after, "notes.txt", "changed\n");
    expect(edited.files["/home/candidate/notes.txt"]).toBe("changed\n");
    expect(after.files["/home/candidate/notes.txt"]).toContain("alpha");
    expect(edited.history.at(-1)).toBe("edit /home/candidate/notes.txt");
  });

  it("matches risky patterns as plain text instead of running them", () => {
    expect(compilePattern("(a+)+$", "").test("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!")).toBe(false);
    expect(compilePattern("(a+)+$", "").test("x(a+)+$y")).toBe(true);
    expect(compilePattern("[unclosed", "").test("a[unclosed")).toBe(true);
    expect(compilePattern("^ERR", "").test("ERROR")).toBe(true);
  });
});

describe("terminal grading", () => {
  it("the built-in scenario is valid: unsolved fails, the solution passes every check", () => {
    expect(TerminalConfigSchema.safeParse(config).success).toBe(true);
    expect(validateTerminalConfig(config)).toEqual([]);
    const untouched = evaluateTerminalChecks(config, createTerminal(config), "");
    expect(untouched.some((c) => !c.passed)).toBe(true);
    const { state } = replayTerminalSolution(config);
    expect(evaluateTerminalChecks(config, state, config.solution.answer).every((c) => c.passed)).toBe(true);
  });

  it("scores 0 for no attempt, 5 for a full solution, and in between for partial work", () => {
    expect(gradeTerminal(config, createTerminal(config), "", "").baseScore).toBe(0);
    expect(gradeTerminal(config, createTerminal(config), "", "").attempted).toBe(false);

    const { state } = replayTerminalSolution(config);
    const full = gradeTerminal(config, state, "4", "I grepped the log first.");
    expect(full.baseScore).toBe(5);
    expect(full.summary).toContain("$ grep ERROR logs/app.log");
    expect(full.notes).toBe("I grepped the log first.");

    const lookedOnly = run(createTerminal(config), "cat logs/app.log").state;
    const partial = gradeTerminal(config, lookedOnly, "", "");
    expect(partial.baseScore).toBeGreaterThan(0);
    expect(partial.baseScore).toBeLessThan(5);
  });

  it("checks the typed answer as a whole token", () => {
    const { state } = replayTerminalSolution(config);
    const check = (answer: string) => evaluateTerminalChecks(config, state, answer).find((c) => c.label.includes("count"))!.passed;
    expect(check("4")).toBe(true);
    expect(check("There were 4 failures")).toBe(true);
    expect(check("four")).toBe(true);
    expect(check("14")).toBe(false);
    expect(check("")).toBe(false);
  });

  it("fails a check when the wrong setting is changed", () => {
    const state = run(createTerminal(config), "cat logs/app.log", "sed -i 's/TIMEOUT_SECONDS=30/TIMEOUT_SECONDS=60/' config/app.conf").state;
    const checks = evaluateTerminalChecks(config, state, "4");
    expect(checks.find((c) => c.label.includes("MAX_CONNECTIONS"))!.passed).toBe(false);
    expect(checks.find((c) => c.label.includes("Other settings"))!.passed).toBe(false);
  });

  it("rejects generated scenarios that cannot be solved or are already solved", () => {
    const broken: TerminalConfig = { ...config, solution: { commands: ["cat logs/app.log"], answer: "4" } };
    expect(validateTerminalConfig(broken).join(" ")).toContain("does not satisfy check");

    const unsupported: TerminalConfig = { ...config, solution: { commands: [...config.solution.commands, "kubectl get pods"], answer: "4" } };
    expect(validateTerminalConfig(unsupported).join(" ")).toContain("does not support");

    const trivial: TerminalConfig = { ...config, checks: [config.checks[2]!, { label: "readme exists", type: "file_exists", path: "/home/candidate/README.txt", values: [] }] };
    expect(validateTerminalConfig(trivial).join(" ")).toContain("already passes");

    const noPrompt: TerminalConfig = { ...config, answerPrompt: "" };
    expect(validateTerminalConfig(noPrompt).join(" ")).toContain("answerPrompt is empty");

    const relative: TerminalConfig = { ...config, files: [{ path: "logs/app.log", content: "x" }] };
    expect(validateTerminalConfig(relative).join(" ")).toContain("must be absolute");
  });
});
