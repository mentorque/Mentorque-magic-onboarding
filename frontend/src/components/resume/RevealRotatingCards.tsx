import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Briefcase, Target, Users } from "lucide-react";

type RevealCard = {
  id: string;
  title: string;
  body: string;
  Icon: typeof Bot;
};

const CARDS: RevealCard[] = [
  {
    id: "interviews",
    title: "Loved by candidates",
    body: "2000+ interviews landed using the same revamp + outreach strategy.",
    Icon: Target,
  },
  {
    id: "outreach",
    title: "AI-powered outreach",
    body: "Generate personalized outreach messages and improve reply rates.",
    Icon: Bot,
  },
  {
    id: "extension",
    title: "AI extension for job postings",
    body: "Get instant role-fit signals and tailored bullets from each JD.",
    Icon: Briefcase,
  },
  {
    id: "tracking",
    title: "Job tracking and mentorship",
    body: "Track every application and move faster with mentor feedback loops.",
    Icon: Users,
  },
];

const CARD_DURATION_MS = 20_000;

export function RevealRotatingCards() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % CARDS.length);
    }, CARD_DURATION_MS);

    return () => window.clearInterval(timer);
  }, []);

  const card = CARDS[index];
  const Icon = card.Icon;

  return (
    <div className="w-full max-w-2xl">
      <AnimatePresence mode="wait">
        <motion.div
          key={card.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="rounded-2xl border border-white/15 bg-black/35 px-6 py-6 backdrop-blur-md"
        >
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/20 bg-white/5">
            <Icon className="h-5 w-5 text-white/90" />
          </div>
          <h3 className="text-xl font-semibold text-white">{card.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/70">{card.body}</p>
          <p className="mt-4 text-xs uppercase tracking-wider text-white/40">
            Showing {index + 1} / {CARDS.length} (20s each)
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
