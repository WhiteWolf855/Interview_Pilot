import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { DeleteData } from "@/components/DeleteData";
import { APP } from "@/lib/config";

export const metadata = { title: `Privacy: ${APP.name}` };

export default function PrivacyPage() {
  return (
    <AppShell>
      <div className="stack">
        <h1>Privacy and your data</h1>
        <p className="muted">A short, plain description of what {APP.name} does with what you give it.</p>

        <section className="card">
          <h2>What you give us</h2>
          <ul>
            <li>Your resume (a file or pasted text) and the job description.</li>
            <li>Optionally, the interviewer&apos;s title and a list of things you have not done.</li>
            <li>Your answers during the interview.</li>
          </ul>
        </section>

        <section className="card">
          <h2>What happens to it</h2>
          <ul>
            <li>Your resume is sent to our server, read in memory to build the interview, and then discarded. It is not saved to a disk or a database, and its contents are not written to our logs.</li>
            <li>To write questions and grade answers, our server sends your resume, the job description and your answers to Anthropic&apos;s Claude API. Anthropic processes them under its own terms and privacy policy.</li>
            <li>The interview plan, your answers and your debrief are stored only on this device, in this browser&apos;s or app&apos;s local storage. We have no copy and cannot recover them for you.</li>
            <li>There are no accounts, no advertising and no analytics trackers.</li>
          </ul>
        </section>

        <section className="card">
          <h2>What our server keeps</h2>
          <ul>
            <li>Usage counters, to limit how many interviews one connection can start per day. They are keyed by a scrambled form of your network address, not the address itself, and expire within a week.</li>
            <li>Technical logs with timings and error codes. They contain no resume text, job description text or answers.</li>
          </ul>
        </section>

        <section className="card stack">
          <h2>Delete my data</h2>
          <p>Because your interviews live only on this device, deleting them here removes them completely. There is nothing of yours on our server to delete.</p>
          <DeleteData />
        </section>

        <section className="card">
          <h2>Good to know</h2>
          <ul>
            <li>Scores and feedback are produced by an AI model. They are practice feedback, not a hiring decision, and can be wrong.</li>
            <li>Clearing your browser data or uninstalling the app also removes your interviews.</li>
            <li>Avoid putting things in your resume text that you would not send to a recruiter, such as ID numbers.</li>
          </ul>
        </section>

        <Link className="btn" href="/">Back to the start</Link>
      </div>
    </AppShell>
  );
}
