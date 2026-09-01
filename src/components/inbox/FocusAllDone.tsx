import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import { Check } from "lucide-react";

interface FocusAllDoneProps {
  newArrivalCount: number;
  reducedMotion: boolean;
  onContinue: () => void;
}

export default function FocusAllDone({
  newArrivalCount,
  reducedMotion,
  onContinue,
}: FocusAllDoneProps) {
  const celebrationFired = useRef(false);
  useEffect(() => {
    if (reducedMotion || celebrationFired.current) return;
    celebrationFired.current = true;
    void confetti({
      particleCount: 70,
      spread: 68,
      startVelocity: 24,
      origin: { y: 0.58 },
      colors: ["#7c6df2", "#9d91ff", "#c7c0ff"],
      disableForReducedMotion: true,
    });
  }, [reducedMotion]);

  return (
    <div className="glass-focus flex h-[82vh] flex-col items-center justify-center rounded-[18px] px-8 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-brand/12 text-brand motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:fade-in motion-safe:duration-300">
        <Check className="size-8" strokeWidth={2.25} />
      </div>
      <h2 className="mt-6 text-2xl font-semibold text-ink-1">All done</h2>
      <p className="mt-2 max-w-sm text-sm text-ink-6">
        You reviewed every conversation in this Focus session.
      </p>
      {newArrivalCount > 0 && (
        <div className="mt-8 flex flex-col items-center gap-3">
          <p className="text-sm font-medium text-ink-3">
            {newArrivalCount} new{" "}
            {newArrivalCount === 1 ? "conversation" : "conversations"}
          </p>
          <button
            type="button"
            className="glass-button min-h-10 rounded-[10px] px-5 text-sm font-medium text-ink-2 motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.97]"
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
