import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";

export const RESUME_TEXT = `Jordan Okafor
Senior Support Engineer

Experience
Northwind Logistics, Support Engineer, 2021 to 2024
- Cut median ticket resolution time from 9 hours to 5 hours by rewriting the triage runbook.
- Wrote Python scripts to pull failed delivery events from the REST API and file them automatically.
- Ran the weekly incident review for a team of 6 engineers.

Brightside Retail, Customer Support Specialist, 2018 to 2021
- Handled about 40 tickets a day across email and chat.
- Built a spreadsheet tracker for refund disputes used by the whole team.

Skills
Python, SQL, Zendesk, Grafana, Linux command line, REST APIs
`;

export const NON_TECH_RESUME = `Maya Lindqvist
Marketing Manager

Experience
Fernhill Foods, Marketing Manager, 2020 to 2024
- Planned and ran the spring product launch across email, social and in-store displays.
- Managed an annual budget and reported campaign results to the leadership team each month.
- Worked with two agencies on creative and media buying.

Oakline Travel, Marketing Coordinator, 2017 to 2020
- Wrote the weekly customer newsletter and grew the subscriber list.
- Organised trade show stands and partner events.

Skills
Campaign planning, copywriting, Excel, Google Analytics, stakeholder reporting
`;

export const JOB_TEXT = `Senior Support Engineer at Harbor Systems

We are looking for a Senior Support Engineer to own escalations for our logistics platform.
You will investigate production issues using logs and our REST API, write clear incident updates
for customers, and work with engineering to fix root causes. You should be comfortable on the
Linux command line, able to read Python, and have experience with Kubernetes and Grafana.
You will mentor two junior engineers and improve our runbooks.
`;

export const NON_TECH_JOB = `Senior Marketing Manager at Calloway Home

We are hiring a Senior Marketing Manager to lead seasonal campaigns for our homeware brand.
You will own the campaign calendar, manage agency partners, report results to leadership and
write clear briefs. Experience with budget planning and Google Analytics is required.
You will manage one coordinator and present quarterly plans to the executive team.
`;

/** A real PDF with selectable text, built in memory. */
export async function makePdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = text.split("\n");
  let page = doc.addPage([595, 842]);
  let y = 800;
  for (const line of lines) {
    if (y < 40) {
      page = doc.addPage([595, 842]);
      y = 800;
    }
    page.drawText(line, { x: 40, y, size: 10, font });
    y -= 14;
  }
  return doc.save();
}

/** A PDF with a page but no text, like a scanned image. */
export async function makeEmptyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A minimal but valid .docx, built in memory. */
export async function makeDocx(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const paragraphs = text
    .split("\n")
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}
