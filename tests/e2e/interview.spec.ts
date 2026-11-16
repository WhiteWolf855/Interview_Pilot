import { expect, test, type Page } from "@playwright/test";
import { JOB_TEXT, NON_TECH_JOB, NON_TECH_RESUME, RESUME_TEXT, makePdf } from "../helpers/fixtures";

const ANSWER =
  "At Northwind I rewrote the triage runbook after noticing tickets bounced between queues. I mapped the top ticket types, wrote decision steps for each one, trained the team on it, and median resolution time fell from 9 hours to 5 hours.";

async function setup(page: Page, options: { mode?: "Timed" | "Untimed" | "Prep"; length?: string; resume?: string; job?: string } = {}) {
  await page.goto("/");
  await page.getByLabel("Paste the text").check();
  await page.getByLabel("Resume text").fill(options.resume ?? RESUME_TEXT);
  await page.getByLabel("Job description").fill(options.job ?? JOB_TEXT);
  await page.getByRole("radio", { name: new RegExp(`^${options.mode ?? "Untimed"}`) }).check();
  await page.getByLabel("Interview length").selectOption(options.length ?? "20");
  await page.getByRole("button", { name: "Build my interview" }).click();
}

async function answerConversation(page: Page, text = ANSWER) {
  for (let turn = 0; turn < 3; turn++) {
    await expect(page.getByLabel("Your answer")).toBeVisible();
    await page.getByLabel("Your answer").fill(text);
    await page.getByRole("button", { name: "Send answer" }).click();
  }
}

async function stageTitle(page: Page): Promise<string> {
  return (await page.getByTestId("stage-title").textContent()) ?? "";
}

/** Works through whatever stage is on screen. Returns its kind. */
async function completeStage(page: Page, solve: boolean): Promise<string> {
  const title = await stageTitle(page);
  if (await page.getByLabel("Your answer").isVisible().catch(() => false)) {
    await answerConversation(page);
    return "conversation";
  }
  if (title.includes("failing service")) {
    if (solve) {
      for (const command of ["grep ERROR logs/app.log", "grep -c 503 logs/app.log", "sed -i 's/MAX_CONNECTIONS=10/MAX_CONNECTIONS=50/' config/app.conf"]) {
        await page.getByLabel(/^Command/).fill(command);
        await page.getByRole("button", { name: "Run", exact: true }).click();
      }
      await expect(page.getByRole("log")).toContainText("pool exhausted");
      await page.getByLabel("How many checkout requests returned 503?").fill("4");
    }
  } else if (title.includes("through an API")) {
    if (solve) {
      await page.getByLabel("Headers, one per line").fill("Authorization: Bearer demo-token-41c7");
      await page.getByLabel("Path").fill("/customers?name=Dana Okafor");
      await page.getByRole("button", { name: "Send request" }).click();
      await expect(page.getByLabel("Response body")).toContainText("dana@example.test");
      await page.getByLabel("Path").fill("/orders?customerId=3&status=pending");
      await page.getByRole("button", { name: "Send request" }).click();
      await expect(page.getByLabel("Response body")).toContainText("249.5");
      await page.getByLabel("Method").selectOption("PATCH");
      await page.getByLabel("Path").fill("/orders/104");
      await page.getByLabel("JSON body").fill('{"status":"cancelled"}');
      await page.getByRole("button", { name: "Send request" }).click();
      await expect(page.getByText("200 OK")).toBeVisible();
      await page.getByLabel("What is the total of the order you cancelled?").fill("249.50");
    }
  } else if (title.includes("buggy function")) {
    await expect(page.getByLabel("Code (JavaScript)")).toBeVisible();
    await page.getByRole("button", { name: "Run tests" }).click();
    await expect(page.getByText("0 of 5 tests pass")).toBeVisible();
    if (solve) {
      await page.getByLabel("Code (JavaScript)").fill(
        "function totalsByCustomer(orders) {\n  const totals = {};\n  for (const order of orders) {\n    totals[order.customer] = (totals[order.customer] || 0) + order.amount;\n  }\n  return totals;\n}\n",
      );
      await page.getByRole("button", { name: "Run tests" }).click();
      await expect(page.getByText("5 of 5 tests pass")).toBeVisible();
    }
  } else if (title.includes("sales table")) {
    await page.getByRole("button", { name: /^Revenue/ }).click();
    await page.getByLabel("Filter rows").fill("East");
    await expect(page.getByText("Showing 3 of 12 rows")).toBeVisible();
    await page.getByLabel("Filter rows").fill("");
    await page.getByLabel("Number column").selectOption("Revenue");
    await page.getByLabel("Group by").selectOption("Region");
    await expect(page.getByRole("cell", { name: "96,500" })).toBeVisible();
    if (solve) {
      await page.getByLabel(/1\. What was total revenue/).fill("213500");
      await page.getByLabel(/2\. Which region/).fill("East");
      await page.getByLabel(/3\. How many deals closed in March/).fill("16");
      await page.getByLabel(/what would you tell your manager/).fill("East brought in almost half of revenue. West is weakest and worth a closer look.");
    }
  } else if (title.includes("customer update")) {
    if (solve) {
      await page.getByLabel(/Write the update/).fill(
        "This morning, between 09:12 and 09:59, you were unable to sign in to your account. That was 47 minutes without access, and we are sorry for the disruption. The problem followed a change we made, which has been rolled back, and sign-in has been restored. We are reviewing exactly what went wrong and will share what we found and what we are changing by Friday. If you still have trouble, reply to this email and we will help straight away.",
      );
      await expect(page.getByText(/^\d+ words$/)).toBeVisible();
    }
  } else {
    throw new Error(`Unrecognised stage: ${title}`);
  }
  await page.getByLabel("Explain your approach (optional)").fill("I read the task first, then checked my result before submitting.");
  await page.getByRole("button", { name: "Submit exercise" }).click();
  return "hands_on";
}

async function runToDebrief(page: Page, solve: boolean) {
  await page.getByRole("button", { name: "Start the interview" }).click();
  for (let guard = 0; guard < 20; guard++) {
    await Promise.race([
      page.getByTestId("stage-title").waitFor(),
      page.getByRole("heading", { name: "Your debrief" }).waitFor(),
    ]);
    if (await page.getByRole("heading", { name: "Your debrief" }).isVisible()) return;
    const title = await stageTitle(page);
    await completeStage(page, solve);
    await expect(page.getByTestId("stage-title")).not.toHaveText(title, { timeout: 15_000 }).catch(() => undefined);
  }
  throw new Error("Interview did not finish");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
});

test("technical role: full interview with terminal, API and code stations, debrief, export, rerun", async ({ page }) => {
  await setup(page, { length: "45" });
  await expect(page.getByRole("heading", { name: "Building your interview" })).toBeVisible();
  await expect(page.getByText("Reading your resume")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start the interview" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("10 stages: 7 conversation and 3 hands-on")).toBeVisible();

  await page.getByRole("button", { name: "Start the interview" }).click();
  await expect(page.getByText("Stage 1 of 10")).toBeVisible();
  // The opening question quotes the candidate's own resume.
  await expect(page.getByTestId("question")).toContainText('Your resume says "Senior Support Engineer"');

  // Follow-ups quote the answer just given, and the interviewer shows a thinking state.
  await page.getByLabel("Your answer").fill(ANSWER);
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByText("The interviewer is thinking")).toBeAttached();
  await expect(page.getByTestId("question")).toContainText('You said "At Northwind I rewrote the triage"');
  await page.getByLabel("Your answer").fill("I wrote the decision steps myself and ran the training sessions.");
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByTestId("question")).toContainText("What was the result");
  await page.getByLabel("Your answer").fill("Median resolution time fell from 9 hours to 5 hours.");
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByText("Stage 2 of 10")).toBeVisible();

  const seen = new Set<string>();
  for (let guard = 0; guard < 12; guard++) {
    await Promise.race([page.getByTestId("stage-title").waitFor(), page.getByRole("heading", { name: "Your debrief" }).waitFor()]);
    if (await page.getByRole("heading", { name: "Your debrief" }).isVisible()) break;
    const title = await stageTitle(page);
    seen.add(title);
    await completeStage(page, true);
    await expect(page.getByTestId("stage-title")).not.toHaveText(title, { timeout: 15_000 }).catch(() => undefined);
  }
  expect([...seen].join(" | ")).toContain("failing service");
  expect([...seen].join(" | ")).toContain("through an API");
  expect([...seen].join(" | ")).toContain("buggy function");

  await expect(page.getByRole("heading", { name: "Your debrief" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("stage-grade")).toHaveCount(10);
  // All three hands-on stations were solved, so each scores 5 from its checks.
  for (const name of ["failing service", "through an API", "buggy function"]) {
    await expect(page.getByTestId("stage-grade").filter({ hasText: name }).getByLabel("Score 5 out of 5")).toBeVisible();
  }
  await expect(page.getByTestId("tighter")).toContainText("[add");
  await expect(page.getByTestId("average")).toContainText("out of 5");

  // Save, then export.
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(page.getByText("Saved on this device. You can open it again")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export as a file" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^interview-pilot-debrief-.*\.md$/);

  // Rerun the same interview.
  await page.getByRole("button", { name: "Rerun this interview" }).click();
  await expect(page.getByRole("button", { name: "Start the interview" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Saved debriefs" })).toBeVisible();
  await page.getByRole("link", { name: "Open" }).click();
  await expect(page.getByTestId("stage-grade")).toHaveCount(10);
});

test("non-technical role gets written and data stations only", async ({ page }) => {
  await setup(page, { resume: NON_TECH_RESUME, job: NON_TECH_JOB, length: "45" });
  await expect(page.getByRole("button", { name: "Start the interview" })).toBeVisible({ timeout: 30_000 });
  await runToDebrief(page, true);
  const grades = page.getByTestId("stage-grade");
  await expect(grades).toHaveCount(10);
  const handsOn = await grades.filter({ hasText: "Hands-on" }).allTextContents();
  expect(handsOn).toHaveLength(3);
  for (const text of handsOn) expect(text).toMatch(/customer update|sales table/);
  await expect(grades.filter({ hasText: "sales table" }).getByLabel("Score 5 out of 5")).toBeVisible();
});

test("uploading a PDF resume works", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Resume file").setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makePdf(RESUME_TEXT)) });
  await page.getByLabel("Job description").fill(JOB_TEXT);
  await page.getByLabel("Interview length").selectOption("20");
  await page.getByRole("button", { name: "Build my interview" }).click();
  await expect(page.getByRole("button", { name: "Start the interview" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Start the interview" }).click();
  await expect(page.getByTestId("question")).toContainText('Your resume says "Senior Support Engineer"');
});

test("timed mode: the clock counts down, survives a reload, and auto-advances with the draft kept", async ({ page }) => {
  await page.clock.install();
  await setup(page, { mode: "Timed" });
  await expect(page.getByRole("button", { name: "Start the interview" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Start the interview" }).click();
  const clock = page.getByTestId("clock");
  await expect(clock).toContainText(/^2:4\d/);
  await page.getByLabel("Your answer").fill("A half-finished answer about the runbook");
  await page.clock.fastForward(60_000);
  await expect(clock).toContainText(/^1:4\d/);

  // Reload: the same stage, the draft, and a clock that carried on rather than restarting.
  await page.reload();
  await expect(page.getByText("Stage 1 of 6")).toBeVisible();
  await expect(page.getByLabel("Your answer")).toHaveValue("A half-finished answer about the runbook");
  await expect(page.getByTestId("clock")).toContainText(/^1:[34]\d/);

  // Let the rest of the stage's time pass.
  await page.clock.fastForward(110_000);
  await expect(page.getByText("Stage 2 of 6")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("clock")).toContainText(/^2:4\d/);
  const record = await page.evaluate(() => JSON.parse(window.localStorage.getItem("intas.session.v1")!).records[0]);
  expect(record.timedOut).toBe(true);
  expect(record.turns[0].answer).toBe("A half-finished answer about the runbook");
  // There is no control that goes back to stage 1.
  await expect(page.getByRole("button", { name: /back|previous/i })).toHaveCount(0);
});

test("prep mode shows hints and gives feedback after each stage", async ({ page }) => {
  await setup(page, { mode: "Prep" });
  await expect(page.getByRole("button", { name: "Start the interview" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Start the interview" }).click();
  await expect(page.getByTestId("clock")).toHaveCount(0);
  await page.getByText("What the interviewer is looking for").click();
  await expect(page.getByText("Makes their own contribution clear")).toBeVisible();
  await answerConversation(page);
  await expect(page.getByRole("heading", { name: /^Feedback:/ })).toBeVisible();
  await expect(page.getByTestId("stage-feedback")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("stage-feedback")).toContainText("/5");
  await page.getByRole("button", { name: "Next stage" }).click();
  await expect(page.getByText("Stage 2 of 6")).toBeVisible();
});

test("form validation and server errors are shown clearly", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Build my interview" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Choose your resume file" })).toBeVisible();
  await page.getByLabel("Paste the text").check();
  await page.getByLabel("Resume text").fill(RESUME_TEXT);
  await page.getByLabel("Job description").fill("Too short.");
  await page.getByRole("button", { name: "Build my interview" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Paste the full job description" })).toBeVisible();

  // A server-side failure returns the user to the form with the server's message.
  await page.route("**/api/plan", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "daily_limit", message: "You have reached today's limit of 5 new interviews." } }) }));
  await page.getByLabel("Job description").fill(JOB_TEXT);
  await page.getByRole("button", { name: "Build my interview" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "today's limit of 5" })).toBeVisible();
  await expect(page.getByLabel("Job description")).toHaveValue(JOB_TEXT);
});

test("a failed follow-up can be retried or skipped", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("button", { name: "Start the interview" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Start the interview" }).click();
  let fail = true;
  await page.route("**/api/followup", (route) => (fail ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "ai_unavailable", message: "The interviewer is unavailable right now. Please try again shortly." } }) }) : route.continue()));
  await page.getByLabel("Your answer").fill(ANSWER);
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "unavailable right now" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("question")).toContainText("You said");
  fail = true;
  await page.getByLabel("Your answer").fill("I did the work myself.");
  await page.getByRole("button", { name: "Send answer" }).click();
  await page.getByRole("button", { name: "Move on to the next stage" }).click();
  await expect(page.getByText("Stage 2 of 6")).toBeVisible();
});

test("delete my data clears everything stored on the device", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("button", { name: "Start the interview" })).toBeVisible({ timeout: 30_000 });
  await page.goto("/");
  await expect(page.getByText("You have an interview in progress")).toBeVisible();
  await page.getByRole("button", { name: /^Theme/ }).click();
  await page.getByRole("link", { name: "Privacy and your data" }).click();
  await page.getByRole("button", { name: "Delete my data" }).click();
  await page.getByRole("button", { name: "Yes, delete everything" }).click();
  await expect(page.getByText("Your data has been deleted from this device.")).toBeVisible();
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith("intas.")))).toEqual([]);
  await page.goto("/");
  await expect(page.getByText("You have an interview in progress")).toHaveCount(0);
});

test("layout: no sideways scrolling at 360px, both themes, big enough touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.goto("/");
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.goto("/privacy");
  expect(await overflow()).toBeLessThanOrEqual(0);

  await setup(page, { length: "45" });
  await expect(page.getByRole("button", { name: "Start the interview" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Start the interview" }).click();
  for (let guard = 0; guard < 12; guard++) {
    await Promise.race([page.getByTestId("stage-title").waitFor(), page.getByRole("heading", { name: "Your debrief" }).waitFor()]);
    if (await page.getByRole("heading", { name: "Your debrief" }).isVisible()) break;
    expect(await overflow(), `sideways scroll on stage "${await stageTitle(page)}"`).toBeLessThanOrEqual(0);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main button, main select, main input:not([type=radio]), main textarea")]
        .filter((el) => el.offsetParent !== null && !el.closest("th") && el.getBoundingClientRect().height < 44)
        .map((el) => `${el.tagName} "${(el.textContent || el.id).slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`),
    );
    expect(small, "controls shorter than 44px").toEqual([]);
    const title = await stageTitle(page);
    await completeStage(page, false);
    await expect(page.getByTestId("stage-title")).not.toHaveText(title, { timeout: 15_000 }).catch(() => undefined);
  }
  await expect(page.getByRole("heading", { name: "Your debrief" })).toBeVisible({ timeout: 30_000 });
  expect(await overflow()).toBeLessThanOrEqual(0);

  // Theme toggle: system -> light -> dark, and the page background follows.
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByRole("button", { name: /^Theme/ }).click();
  expect(await background()).toBe("rgb(246, 246, 243)");
  await page.getByRole("button", { name: /^Theme/ }).click();
  expect(await background()).toBe("rgb(15, 17, 21)");
  await page.reload();
  expect(await background()).toBe("rgb(15, 17, 21)");
});

test("keyboard only: set up an interview and answer a question", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.getByLabel("Upload a file").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByLabel("Paste the text")).toBeChecked();
  await page.keyboard.press("Tab");
  await page.keyboard.insertText(RESUME_TEXT);
  await page.keyboard.press("Tab");
  await page.keyboard.insertText(JOB_TEXT);
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /^Untimed/ })).toBeChecked();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Home");
  await expect(page.getByLabel("Interview length")).toHaveValue("20");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Build my interview" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Start the interview" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Start the interview" }).focus();
  await page.keyboard.press("Enter");
  // Focus moves to the stage heading so it is announced; one Tab reaches the answer box. Ctrl+Enter sends.
  await expect(page.getByTestId("stage-title")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Your answer")).toBeFocused();
  await page.keyboard.insertText(ANSWER);
  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("question")).toContainText("You said");
  await expect(page.getByLabel("Your answer")).toBeFocused();
});
