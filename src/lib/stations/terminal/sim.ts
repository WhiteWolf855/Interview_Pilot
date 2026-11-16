/**
 * A small simulated shell over an in-memory file system. Nothing here touches
 * the real machine: commands are parsed and interpreted by this file only.
 */

export interface TerminalState {
  cwd: string;
  home: string;
  files: Record<string, string>;
  dirs: string[];
  history: string[];
}

export interface CommandOutcome {
  state: TerminalState;
  output: string;
  /** The UI should clear the screen. */
  clear?: boolean;
  /** The UI should open its file editor on this path. */
  editPath?: string;
}

export const SUPPORTED_COMMANDS = [
  "pwd", "cd", "ls", "cat", "head", "tail", "grep", "wc", "sort", "uniq", "cut", "awk", "sed",
  "find", "echo", "touch", "mkdir", "rm", "mv", "cp", "edit", "history", "whoami", "clear", "help",
] as const;

interface Token {
  value: string;
  quoted: boolean;
  op: boolean;
}

interface Result {
  out: string;
  err: string;
  code: number;
}

const ok = (out = ""): Result => ({ out, err: "", code: 0 });
const fail = (err: string, code = 1): Result => ({ out: "", err, code });

/* ---------- paths ---------- */

export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return "/" + parts.join("/");
}

export function resolvePath(state: TerminalState, path: string): string {
  if (path === "~") return state.home;
  if (path.startsWith("~/")) return normalizePath(state.home + "/" + path.slice(2));
  if (path.startsWith("/")) return normalizePath(path);
  return normalizePath(state.cwd + "/" + path);
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function isFile(state: TerminalState, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.files, path);
}

export function isDir(state: TerminalState, path: string): boolean {
  if (path === "/") return true;
  if (state.dirs.includes(path)) return true;
  const prefix = path + "/";
  return (
    Object.keys(state.files).some((f) => f.startsWith(prefix)) ||
    state.dirs.some((d) => d.startsWith(prefix))
  );
}

/** Names directly inside a directory. Directories end with "/". */
function listDir(state: TerminalState, dir: string): string[] {
  const prefix = dir === "/" ? "/" : dir + "/";
  const names = new Set<string>();
  for (const file of Object.keys(state.files)) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    const slash = rest.indexOf("/");
    names.add(slash === -1 ? rest : rest.slice(0, slash) + "/");
  }
  for (const d of state.dirs) {
    if (!d.startsWith(prefix)) continue;
    const rest = d.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    names.add((slash === -1 ? rest : rest.slice(0, slash)) + "/");
  }
  return Array.from(names).sort();
}

/* ---------- state ---------- */

export function createTerminal(input: {
  cwd: string;
  files: { path: string; content: string }[];
}): TerminalState {
  const files: Record<string, string> = {};
  for (const file of input.files) files[normalizePath(file.path)] = file.content;
  const cwd = normalizePath(input.cwd);
  return { cwd, home: cwd, files, dirs: [cwd], history: [] };
}

function cloneState(state: TerminalState): TerminalState {
  return { ...state, files: { ...state.files }, dirs: [...state.dirs], history: [...state.history] };
}

/** Used by the UI's file editor. Recorded in the history as an edit. */
export function writeFile(state: TerminalState, path: string, content: string): TerminalState {
  const next = cloneState(state);
  const full = resolvePath(next, path);
  next.files[full] = content;
  next.history.push(`edit ${full}`);
  return next;
}

/* ---------- parsing ---------- */

function tokenize(line: string): Token[] | string {
  const tokens: Token[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  let i = 0;
  const push = () => {
    if (started) tokens.push({ value: current, quoted, op: false });
    current = "";
    quoted = false;
    started = false;
  };
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === "'" || ch === '"') {
      const end = (() => {
        for (let j = i + 1; j < line.length; j++) {
          if (line[j] === "\\" && ch === '"') {
            j++;
            continue;
          }
          if (line[j] === ch) return j;
        }
        return -1;
      })();
      if (end === -1) return "syntax error: unterminated quote";
      let inner = line.slice(i + 1, end);
      if (ch === '"') inner = inner.replace(/\\(["\\$`])/g, "$1");
      current += inner;
      quoted = true;
      started = true;
      i = end + 1;
    } else if (ch === "\\" && i + 1 < line.length) {
      current += line[i + 1];
      started = true;
      i += 2;
    } else if (ch === " " || ch === "\t") {
      push();
      i++;
    } else if (ch === "|" || ch === ";" || ch === ">" || ch === "&") {
      push();
      let op = ch;
      if ((ch === ">" && line[i + 1] === ">") || (ch === "&" && line[i + 1] === "&")) {
        op = ch + ch;
        i++;
      } else if (ch === "|" && line[i + 1] === "|") {
        return "syntax error: || is not supported in this terminal";
      } else if (ch === "&") {
        return "syntax error: background jobs are not supported in this terminal";
      }
      tokens.push({ value: op, quoted: false, op: true });
      i++;
    } else {
      current += ch;
      started = true;
      i++;
    }
  }
  push();
  return tokens;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function expandGlobs(state: TerminalState, tokens: Token[]): string[] {
  const args: string[] = [];
  for (const token of tokens) {
    if (token.quoted || !/[*?]/.test(token.value)) {
      args.push(token.value);
      continue;
    }
    const slash = token.value.lastIndexOf("/");
    const dirPart = slash === -1 ? "" : token.value.slice(0, slash + 1);
    const pattern = globToRegExp(token.value.slice(slash + 1));
    const dir = resolvePath(state, dirPart || ".");
    const matches = listDir(state, dir)
      .map((name) => name.replace(/\/$/, ""))
      .filter((name) => pattern.test(name) && !name.startsWith("."))
      .map((name) => dirPart + name);
    if (matches.length) args.push(...matches);
    else args.push(token.value);
  }
  return args;
}

/**
 * Compiles a user or model supplied pattern. Patterns that could backtrack
 * badly (a quantified group, or very long) are matched as plain text instead.
 */
export function compilePattern(pattern: string, flags: string): RegExp {
  const literal = () => new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  if (pattern.length > 120 || /\)[+*{?]/.test(pattern)) return literal();
  try {
    return new RegExp(pattern, flags);
  } catch {
    return literal();
  }
}

/* ---------- helpers ---------- */

function splitLines(textValue: string): string[] {
  if (textValue === "") return [];
  const lines = textValue.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function joinLines(lines: string[]): string {
  return lines.length ? lines.join("\n") + "\n" : "";
}

function splitFlags(args: string[], withValue: string[] = []): { flags: Record<string, string>; rest: string[] } {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("-") && arg.length > 1 && !/^-\d/.test(arg) && rest.length === 0) {
      const names = arg.slice(1);
      if (withValue.includes(names[0]!)) {
        // -n 5, -n5, -F, or -F ,
        const inline = names.slice(1);
        if (inline) flags[names[0]!] = inline;
        else {
          flags[names[0]!] = args[i + 1] ?? "";
          i++;
        }
      } else {
        for (const name of names) flags[name] = "true";
      }
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

/** Reads the named files, or stdin when no file is given. */
function readInputs(
  state: TerminalState,
  command: string,
  paths: string[],
  stdin: string | null,
): { inputs: { name: string; content: string }[]; err: string } {
  if (paths.length === 0) return { inputs: [{ name: "", content: stdin ?? "" }], err: "" };
  const inputs: { name: string; content: string }[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    const full = resolvePath(state, path);
    if (isFile(state, full)) inputs.push({ name: path, content: state.files[full]! });
    else if (isDir(state, full)) errors.push(`${command}: ${path}: Is a directory`);
    else errors.push(`${command}: ${path}: No such file or directory`);
  }
  return { inputs, err: errors.join("\n") };
}

function filesUnder(state: TerminalState, dir: string): string[] {
  const prefix = dir === "/" ? "/" : dir + "/";
  return Object.keys(state.files)
    .filter((f) => f.startsWith(prefix))
    .sort();
}

/* ---------- commands ---------- */

type Handler = (state: TerminalState, args: string[], stdin: string | null) => Result;

const commands: Record<string, Handler> = {
  pwd: (state) => ok(state.cwd + "\n"),

  whoami: () => ok("candidate\n"),

  help: () =>
    ok(
      `Simulated terminal. Available commands:\n  ${SUPPORTED_COMMANDS.join(" ")}\n` +
        "Pipes (|), redirects (> and >>), && and ; work. Use the Edit file button, or `edit <file>`, to change a file.\n",
    ),

  history: (state) => ok(joinLines(state.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`))),

  echo: (_state, args) => ok(args.join(" ") + "\n"),

  cd: (state, args) => {
    const target = resolvePath(state, args[0] ?? "~");
    if (isFile(state, target)) return fail(`cd: ${args[0]}: Not a directory`);
    if (!isDir(state, target)) return fail(`cd: ${args[0]}: No such file or directory`);
    state.cwd = target;
    return ok();
  },

  ls: (state, args) => {
    const { flags, rest } = splitFlags(args);
    const targets = rest.length ? rest : ["."];
    const blocks: string[] = [];
    const errors: string[] = [];
    for (const target of targets) {
      const full = resolvePath(state, target);
      if (isFile(state, full)) {
        blocks.push(flags.l ? `-rw-r--r-- 1 candidate staff ${String(state.files[full]!.length).padStart(6)} ${target}` : target);
        continue;
      }
      if (!isDir(state, full)) {
        errors.push(`ls: ${target}: No such file or directory`);
        continue;
      }
      const names = listDir(state, full).filter((n) => flags.a || !n.startsWith("."));
      const lines = flags.l
        ? names.map((name) => {
            const isDirectory = name.endsWith("/");
            const size = isDirectory ? 0 : state.files[normalizePath(full + "/" + name)]?.length ?? 0;
            return `${isDirectory ? "drwxr-xr-x" : "-rw-r--r--"} 1 candidate staff ${String(size).padStart(6)} ${name}`;
          })
        : names;
      blocks.push((targets.length > 1 ? `${target}:\n` : "") + lines.join("\n"));
    }
    const out = blocks.filter((b) => b !== "").join(targets.length > 1 ? "\n\n" : "\n");
    return { out: out ? out + "\n" : "", err: errors.join("\n"), code: errors.length ? 1 : 0 };
  },

  cat: (state, args, stdin) => {
    const { inputs, err } = readInputs(state, "cat", args, stdin);
    return { out: inputs.map((i) => i.content).join(""), err, code: err ? 1 : 0 };
  },

  head: (state, args, stdin) => {
    const short = args.find((a) => /^-\d+$/.test(a));
    const { flags, rest } = splitFlags(args.filter((a) => a !== short), ["n"]);
    const count = Math.max(0, parseInt(short ? short.slice(1) : flags.n ?? "10", 10) || 0);
    const { inputs, err } = readInputs(state, "head", rest, stdin);
    return { out: inputs.map((i) => joinLines(splitLines(i.content).slice(0, count))).join(""), err, code: err ? 1 : 0 };
  },

  tail: (state, args, stdin) => {
    const short = args.find((a) => /^-\d+$/.test(a));
    const { flags, rest } = splitFlags(args.filter((a) => a !== short), ["n"]);
    const raw = short ? short.slice(1) : flags.n ?? "10";
    const { inputs, err } = readInputs(state, "tail", rest, stdin);
    const out = inputs
      .map((i) => {
        const lines = splitLines(i.content);
        if (raw.startsWith("+")) return joinLines(lines.slice(Math.max(0, (parseInt(raw.slice(1), 10) || 1) - 1)));
        const count = Math.max(0, parseInt(raw, 10) || 0);
        return joinLines(count === 0 ? [] : lines.slice(-count));
      })
      .join("");
    return { out, err, code: err ? 1 : 0 };
  },

  grep: (state, args, stdin) => {
    const { flags, rest } = splitFlags(args, ["e"]);
    const pattern = flags.e ?? rest.shift();
    if (pattern === undefined) return fail("usage: grep [-i -n -c -v -r -l] pattern [file ...]", 2);
    const regex = compilePattern(pattern, flags.i ? "i" : "");
    let paths = rest;
    if (flags.r || flags.R) {
      const roots = rest.length ? rest : ["."];
      paths = roots.flatMap((root) => {
        const full = resolvePath(state, root);
        if (isFile(state, full)) return [root];
        return filesUnder(state, full).map((f) => (root === "." ? f.slice(state.cwd === "/" ? 1 : state.cwd.length + 1) : root.replace(/\/$/, "") + f.slice(full.length)));
      });
      if (paths.length === 0) return fail("", 1);
    }
    const { inputs, err } = readInputs(state, "grep", paths, stdin);
    const showName = inputs.length > 1 || Boolean(flags.r || flags.R);
    const out: string[] = [];
    let matched = 0;
    for (const input of inputs) {
      const lines = splitLines(input.content);
      let count = 0;
      lines.forEach((line, index) => {
        const hit = regex.test(line) !== Boolean(flags.v);
        if (!hit) return;
        count++;
        if (flags.c || flags.l) return;
        const prefix = (showName ? `${input.name}:` : "") + (flags.n ? `${index + 1}:` : "");
        out.push(prefix + line);
      });
      matched += count;
      if (flags.c) out.push((showName ? `${input.name}:` : "") + count);
      else if (flags.l && count > 0) out.push(input.name);
    }
    return { out: joinLines(out), err, code: matched > 0 ? 0 : 1 };
  },

  wc: (state, args, stdin) => {
    const { flags, rest } = splitFlags(args);
    const { inputs, err } = readInputs(state, "wc", rest, stdin);
    const all = !flags.l && !flags.w && !flags.c;
    const out = inputs.map((input) => {
      const parts: number[] = [];
      if (all || flags.l) parts.push(splitLines(input.content).length);
      if (all || flags.w) parts.push(input.content.split(/\s+/).filter(Boolean).length);
      if (all || flags.c) parts.push(input.content.length);
      return (parts.map((p) => String(p).padStart(parts.length > 1 ? 8 : 0)).join("") + (input.name ? ` ${input.name}` : "")).trimStart();
    });
    return { out: joinLines(out), err, code: err ? 1 : 0 };
  },

  sort: (state, args, stdin) => {
    const { flags, rest } = splitFlags(args, ["k", "t"]);
    const { inputs, err } = readInputs(state, "sort", rest, stdin);
    let lines = inputs.flatMap((i) => splitLines(i.content));
    const field = flags.k ? Math.max(1, parseInt(flags.k, 10) || 1) : 0;
    const keyOf = (line: string) => {
      if (!field) return line;
      const parts = flags.t ? line.split(flags.t) : line.trim().split(/\s+/);
      return parts[field - 1] ?? "";
    };
    lines.sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      if (flags.n) {
        const diff = (parseFloat(ka) || 0) - (parseFloat(kb) || 0);
        if (diff !== 0) return diff;
      }
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    if (flags.r) lines.reverse();
    if (flags.u) lines = lines.filter((line, i) => i === 0 || line !== lines[i - 1]);
    return { out: joinLines(lines), err, code: err ? 1 : 0 };
  },

  uniq: (state, args, stdin) => {
    const { flags, rest } = splitFlags(args);
    const { inputs, err } = readInputs(state, "uniq", rest, stdin);
    const groups: { line: string; count: number }[] = [];
    for (const line of inputs.flatMap((i) => splitLines(i.content))) {
      const last = groups[groups.length - 1];
      if (last && last.line === line) last.count++;
      else groups.push({ line, count: 1 });
    }
    return {
      out: joinLines(groups.map((g) => (flags.c ? `${String(g.count).padStart(7)} ${g.line}` : g.line))),
      err,
      code: err ? 1 : 0,
    };
  },

  cut: (state, args, stdin) => {
    const { flags, rest } = splitFlags(args, ["d", "f"]);
    if (!flags.f) return fail("usage: cut -d DELIM -f LIST [file ...]", 2);
    const delimiter = flags.d ?? "\t";
    const fields = flags.f.split(",").map((f) => parseInt(f, 10)).filter((n) => n > 0);
    const { inputs, err } = readInputs(state, "cut", rest, stdin);
    const out = inputs
      .flatMap((i) => splitLines(i.content))
      .map((line) => {
        const parts = line.split(delimiter);
        return fields.map((f) => parts[f - 1] ?? "").join(delimiter);
      });
    return { out: joinLines(out), err, code: err ? 1 : 0 };
  },

  awk: (state, args, stdin) => {
    const { flags, rest } = splitFlags(args, ["F"]);
    const program = rest.shift() ?? "";
    const match = /^\s*\{\s*print\s*([^}]*)\}\s*$/.exec(program);
    if (!match) return fail("awk: only '{print $1, $2}' style programs are supported in this terminal", 2);
    const refs = match[1]!.split(",").map((part) => part.trim()).filter(Boolean);
    if (refs.some((ref) => !/^\$\d+$/.test(ref))) return fail("awk: only field references like $1 are supported in this terminal", 2);
    const { inputs, err } = readInputs(state, "awk", rest, stdin);
    const out = inputs
      .flatMap((i) => splitLines(i.content))
      .map((line) => {
        const parts = flags.F ? line.split(flags.F) : line.trim().split(/\s+/);
        if (refs.length === 0) return line;
        return refs.map((ref) => (ref === "$0" ? line : parts[parseInt(ref.slice(1), 10) - 1] ?? "")).join(" ");
      });
    return { out: joinLines(out), err, code: err ? 1 : 0 };
  },

  sed: (state, args, stdin) => {
    const { flags, rest } = splitFlags(args, ["e"]);
    const script = flags.e ?? rest.shift() ?? "";
    const delimiter = script[1];
    if (script[0] !== "s" || !delimiter) return fail("sed: only s/old/new/[g] is supported in this terminal", 2);
    const parts = script.slice(2).split(delimiter);
    if (parts.length < 2) return fail("sed: unterminated s command", 2);
    const [pattern, replacement, modifiers = ""] = parts as [string, string, string?];
    const regex = compilePattern(pattern, (modifiers.includes("g") ? "g" : "") + (modifiers.includes("i") ? "i" : ""));
    const apply = (content: string) =>
      joinLines(splitLines(content).map((line) => line.replace(regex, replacement.replace(/\\(\d)/g, "$$$1").replace(/&/g, "$$&"))));
    if (flags.i) {
      if (rest.length === 0) return fail("sed: -i needs a file", 2);
      for (const path of rest) {
        const full = resolvePath(state, path);
        if (!isFile(state, full)) return fail(`sed: ${path}: No such file or directory`);
        state.files[full] = apply(state.files[full]!);
      }
      return ok();
    }
    const { inputs, err } = readInputs(state, "sed", rest, stdin);
    return { out: inputs.map((i) => apply(i.content)).join(""), err, code: err ? 1 : 0 };
  },

  find: (state, args) => {
    let root = ".";
    let name: RegExp | null = null;
    let type = "";
    const rest = [...args];
    if (rest[0] && !rest[0].startsWith("-")) root = rest.shift()!;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "-name" || rest[i] === "-iname") name = new RegExp(globToRegExp(rest[++i] ?? "*").source, rest[i - 1] === "-iname" ? "i" : "");
      else if (rest[i] === "-type") type = rest[++i] ?? "";
      else return fail(`find: unsupported option ${rest[i]} (use -name or -type)`, 2);
    }
    const full = resolvePath(state, root);
    if (!isDir(state, full) && !isFile(state, full)) return fail(`find: ${root}: No such file or directory`);
    const prefix = full === "/" ? "/" : full + "/";
    const entries = new Set<string>();
    if (isDir(state, full)) entries.add(full + "\u0000d");
    for (const file of Object.keys(state.files)) {
      if (file !== full && !file.startsWith(prefix)) continue;
      entries.add(file + "\u0000f");
      let dir = parentOf(file);
      while (dir.length > full.length) {
        entries.add(dir + "\u0000d");
        dir = parentOf(dir);
      }
    }
    for (const dir of state.dirs) if (dir.startsWith(prefix)) entries.add(dir + "\u0000d");
    const display = (path: string) => (path === full ? root : root.replace(/\/$/, "") + path.slice(full.length));
    const out = Array.from(entries)
      .map((entry) => entry.split("\u0000") as [string, string])
      .filter(([path, kind]) => (!type || type === kind) && (!name || name.test(baseName(path))))
      .map(([path]) => display(path))
      .sort();
    return ok(joinLines(out));
  },

  touch: (state, args) => {
    for (const path of args) {
      const full = resolvePath(state, path);
      if (!isDir(state, parentOf(full))) return fail(`touch: ${path}: No such file or directory`);
      if (!isFile(state, full)) state.files[full] = "";
    }
    return ok();
  },

  mkdir: (state, args) => {
    const { flags, rest } = splitFlags(args);
    for (const path of rest) {
      const full = resolvePath(state, path);
      if (isFile(state, full) || (isDir(state, full) && !flags.p)) return fail(`mkdir: ${path}: File exists`);
      if (!flags.p && !isDir(state, parentOf(full))) return fail(`mkdir: ${path}: No such file or directory`);
      if (!state.dirs.includes(full)) state.dirs.push(full);
    }
    return ok();
  },

  rm: (state, args) => {
    const { flags, rest } = splitFlags(args);
    for (const path of rest) {
      const full = resolvePath(state, path);
      if (isFile(state, full)) delete state.files[full];
      else if (isDir(state, full)) {
        if (!flags.r && !flags.R) return fail(`rm: ${path}: is a directory`);
        for (const file of filesUnder(state, full)) delete state.files[file];
        state.dirs = state.dirs.filter((d) => d !== full && !d.startsWith(full + "/"));
      } else if (!flags.f) return fail(`rm: ${path}: No such file or directory`);
    }
    return ok();
  },

  cp: (state, args) => transfer(state, args, false),
  mv: (state, args) => transfer(state, args, true),
};

function transfer(state: TerminalState, args: string[], move: boolean): Result {
  const name = move ? "mv" : "cp";
  const { rest } = splitFlags(args);
  if (rest.length < 2) return fail(`usage: ${name} source target`, 2);
  const targetArg = rest[rest.length - 1]!;
  const target = resolvePath(state, targetArg);
  for (const sourceArg of rest.slice(0, -1)) {
    const source = resolvePath(state, sourceArg);
    if (!isFile(state, source)) {
      return fail(isDir(state, source) ? `${name}: ${sourceArg}: directories are not supported in this terminal` : `${name}: ${sourceArg}: No such file or directory`);
    }
    const destination = isDir(state, target) ? normalizePath(target + "/" + baseName(source)) : target;
    if (!isDir(state, parentOf(destination))) return fail(`${name}: ${targetArg}: No such file or directory`);
    state.files[destination] = state.files[source]!;
    if (move && destination !== source) delete state.files[source];
  }
  return ok();
}

/* ---------- execution ---------- */

interface Stage {
  tokens: Token[];
  redirect?: { path: string; append: boolean };
}

function runPipeline(state: TerminalState, stages: Stage[], signals: { clear: boolean; editPath?: string }): Result {
  let stdin: string | null = null;
  const errors: string[] = [];
  let last: Result = ok();
  for (const stage of stages) {
    const args = expandGlobs(state, stage.tokens);
    const name = args.shift();
    if (!name) return fail("syntax error near unexpected token");
    if (name === "clear") {
      signals.clear = true;
      last = ok();
    } else if (["edit", "nano", "vi", "vim"].includes(name)) {
      if (!args[0]) last = fail("usage: edit <file>", 2);
      else {
        signals.editPath = resolvePath(state, args[0]);
        last = ok();
      }
    } else {
      const handler = commands[name];
      last = handler
        ? handler(state, args, stdin)
        : fail(`${name}: command not found. Type 'help' to see what this terminal supports.`, 127);
    }
    if (last.err) errors.push(last.err);
    if (stage.redirect) {
      const full = resolvePath(state, stage.redirect.path);
      if (isDir(state, full)) errors.push(`${stage.redirect.path}: Is a directory`);
      else if (!isDir(state, parentOf(full))) errors.push(`${stage.redirect.path}: No such file or directory`);
      else state.files[full] = (stage.redirect.append ? state.files[full] ?? "" : "") + last.out;
      last = { ...last, out: "" };
    }
    stdin = last.out;
  }
  return { out: last.out, err: errors.join("\n"), code: last.code };
}

export function runCommand(previous: TerminalState, line: string): CommandOutcome {
  const state = cloneState(previous);
  const trimmed = line.trim();
  if (!trimmed) return { state, output: "" };
  state.history.push(trimmed);

  const tokens = tokenize(trimmed);
  if (typeof tokens === "string") return { state, output: tokens + "\n" };

  // Split into pipelines joined by ; or &&.
  const sequences: { stages: Stage[]; joiner: string }[] = [];
  let stages: Stage[] = [];
  let current: Token[] = [];
  const closeStage = (): string | null => {
    if (current.length === 0) return "syntax error near unexpected token";
    const stage: Stage = { tokens: current };
    const redirectIndex = current.findIndex((t) => t.op && (t.value === ">" || t.value === ">>"));
    if (redirectIndex !== -1) {
      const target = current[redirectIndex + 1];
      if (!target || target.op || redirectIndex + 2 !== current.length) return "syntax error near redirect";
      stage.redirect = { path: target.value, append: current[redirectIndex]!.value === ">>" };
      stage.tokens = current.slice(0, redirectIndex);
    }
    stages.push(stage);
    current = [];
    return null;
  };
  for (const token of tokens) {
    if (token.op && (token.value === "|" || token.value === ";" || token.value === "&&")) {
      const error = closeStage();
      if (error) return { state, output: error + "\n" };
      if (token.value !== "|") {
        sequences.push({ stages, joiner: token.value });
        stages = [];
      }
    } else {
      current.push(token);
    }
  }
  if (current.length > 0 || stages.length > 0 || sequences.length === 0) {
    const error = closeStage();
    if (error) return { state, output: error + "\n" };
    sequences.push({ stages, joiner: ";" });
  }

  const signals: { clear: boolean; editPath?: string } = { clear: false };
  let output = "";
  for (const sequence of sequences) {
    const result = runPipeline(state, sequence.stages, signals);
    output += result.out;
    if (result.err) output += (output && !output.endsWith("\n") ? "\n" : "") + result.err + "\n";
    if (sequence.joiner === "&&" && result.code !== 0) break;
  }
  return { state, output, clear: signals.clear || undefined, editPath: signals.editPath };
}
