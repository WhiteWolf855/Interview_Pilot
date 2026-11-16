"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface WebRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

function webRecognition(): (new () => WebRecognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => WebRecognition; webkitSpeechRecognition?: new () => WebRecognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Speech to text for answers. In a browser it uses the Web Speech API where
 * the browser has one. Inside the Android app it uses the device's speech
 * recogniser through a Capacitor plugin. Where neither exists, `supported`
 * stays false and the button is not shown.
 */
export function useDictation(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const native = useRef(false);
  const recognition = useRef<WebRecognition | null>(null);
  const handler = useRef(onText);
  handler.current = onText;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.isNativePlatform()) {
        const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
        const { available } = await SpeechRecognition.available().catch(() => ({ available: false }));
        if (!cancelled) {
          native.current = true;
          setSupported(available);
        }
        return;
      }
      if (!cancelled) setSupported(webRecognition() !== null);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      recognition.current?.stop();
    };
  }, []);

  const stop = useCallback(async () => {
    if (native.current) {
      const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
      await SpeechRecognition.stop().catch(() => undefined);
    } else {
      recognition.current?.stop();
    }
    setListening(false);
  }, []);

  const start = useCallback(async () => {
    setError("");
    if (native.current) {
      try {
        const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
        const permission = await SpeechRecognition.requestPermissions();
        if (permission.speechRecognition !== "granted") {
          setError("Microphone permission was not granted. You can type your answer instead.");
          return;
        }
        setListening(true);
        const result = await SpeechRecognition.start({ language: "en-US", maxResults: 1, partialResults: false, popup: false });
        const text = result.matches?.[0];
        if (text) handler.current(text);
      } catch {
        setError("Dictation stopped. You can try again or type your answer.");
      } finally {
        setListening(false);
      }
      return;
    }
    const Recognition = webRecognition();
    if (!Recognition) return;
    const instance = new Recognition();
    instance.lang = navigator.language || "en-US";
    instance.continuous = true;
    instance.interimResults = false;
    instance.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) text += result[0]!.transcript;
      }
      if (text.trim()) handler.current(text.trim());
    };
    instance.onerror = (event) => {
      setError(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Microphone permission was not granted. You can type your answer instead."
          : "Dictation stopped. You can try again or type your answer.",
      );
    };
    instance.onend = () => setListening(false);
    recognition.current = instance;
    try {
      instance.start();
      setListening(true);
    } catch {
      setError("Dictation could not start. You can type your answer instead.");
    }
  }, []);

  return { supported, listening, error, start, stop };
}
