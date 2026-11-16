"use client";

import { useState } from "react";
import { deleteAllData } from "@/lib/interview/storage";

export function DeleteData() {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState("");
  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      {confirming ? (
        <div className="notice warn stack" style={{ gap: "0.5rem" }}>
          <p>This removes your current interview, every saved debrief and your theme choice from this device. It cannot be undone.</p>
          <div className="row">
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                const removed = deleteAllData();
                document.documentElement.removeAttribute("data-theme");
                setConfirming(false);
                setDone(removed > 0 ? "Your data has been deleted from this device." : "There was nothing stored on this device.");
              }}
            >
              Yes, delete everything
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn danger" onClick={() => { setDone(""); setConfirming(true); }}>Delete my data</button>
      )}
      <p role="status" aria-live="polite" className="hint">{done}</p>
    </div>
  );
}
