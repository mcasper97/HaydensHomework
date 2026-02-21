import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Award,
  BookOpen,
  Calendar,
  Check,
  Crown,
  Flame,
  Gamepad2,
  Heart,
  Key,
  Palette,
  Package,
  Plus,
  Rocket,
  Settings,
  Shield,
  Sparkles,
  Star,
  Sword,
  Target,
  Trophy,
  Volume2,
  Wand2,
  X,
  Zap,
} from "lucide-react";

/* ============================== Local Storage ============================== */
const LS_KEY = "haydens_homework_app_v6";

/* ============================== Default Data ============================== */
const DEFAULT_SIGHT_DECK = [
  { word: "the", sentence: "The cat is happy." },
  { word: "and", sentence: "I like cats and dogs." },
  { word: "is", sentence: "This is my book." },
  { word: "you", sentence: "You are my friend." },
  { word: "to", sentence: "I go to school." },
];

const DEFAULT_WEEKLY_GAMES = {
  sightPerDay: 5,
  spellingPerDay: 5,
  vocabPerDay: 3,
  phonicsPerDay: 8,
  smartPhonicsMode: true,
  mathProblemsPerDay: 5,
  mathTopic: "addition-double",
  sequence: ["sight", "spelling", "vocab", "phonics", "math"],
};

const DEFAULT_PROGRESS = {
  sight: {},
  spelling: {},
  vocab: {},
  phonics: {},
};

/* ============================== Rewards Data ============================== */
const CHEST_TYPES = [
  { id: "bronze", name: "Bronze Chest", keysRequired: 1, color: "from-amber-600 to-amber-800" },
  { id: "silver", name: "Silver Chest", keysRequired: 2, color: "from-gray-400 to-gray-600" },
  { id: "gold", name: "Gold Chest", keysRequired: 3, color: "from-yellow-400 to-yellow-600" },
];

const REWARD_POOL = [
  { id: "badge-word-wizard", name: "Word Wizard Badge", type: "badge", rarity: "common", icon: "Wand2" },
  { id: "badge-phonics-pro", name: "Phonics Pro Badge", type: "badge", rarity: "common", icon: "Zap" },
  { id: "badge-streak-legend", name: "Streak Legend Badge", type: "badge", rarity: "rare", icon: "Flame" },
  { id: "badge-math-master", name: "Math Master Badge", type: "badge", rarity: "rare", icon: "Target" },
  { id: "badge-golden-reader", name: "Golden Reader Badge", type: "badge", rarity: "epic", icon: "BookOpen" },

  { id: "sticker-space-pack", name: "Space Sticker Pack", type: "sticker", rarity: "common", icon: "Rocket" },
  { id: "sticker-animal-pack", name: "Animal Sticker Pack", type: "sticker", rarity: "common", icon: "Heart" },
  { id: "sticker-sports-pack", name: "Sports Sticker Pack", type: "sticker", rarity: "common", icon: "Trophy" },
  { id: "sticker-rainbow-pack", name: "Rainbow Sticker Pack", type: "sticker", rarity: "rare", icon: "Palette" },

  { id: "avatar-ninja", name: "Ninja Avatar", type: "avatar", rarity: "rare", icon: "Shield" },
  { id: "avatar-robot", name: "Robot Avatar", type: "avatar", rarity: "rare", icon: "Gamepad2" },
  { id: "avatar-wizard", name: "Wizard Avatar", type: "avatar", rarity: "epic", icon: "Wand2" },

  { id: "trail-sparkle", name: "Sparkle Trail", type: "trail", rarity: "rare", icon: "Sparkles" },
  { id: "trail-confetti", name: "Confetti Trail", type: "trail", rarity: "rare", icon: "Star" },
  { id: "trail-stars", name: "Star Trail", type: "trail", rarity: "epic", icon: "Star" },

  { id: "room-trophy-shelf", name: "Trophy Shelf", type: "room", rarity: "common", icon: "Trophy" },
  { id: "room-bookshelf", name: "Bookshelf", type: "room", rarity: "common", icon: "BookOpen" },
  { id: "room-golden-desk", name: "Golden Desk", type: "room", rarity: "epic", icon: "Sparkles" },

  { id: "title-rookie-reader", name: "Rookie Reader", type: "title", rarity: "common", icon: "BookOpen" },
  { id: "title-word-warrior", name: "Word Warrior", type: "title", rarity: "rare", icon: "Sword" },
  { id: "title-legendary-learner", name: "Legendary Learner", type: "title", rarity: "epic", icon: "Crown" },
];

/* ============================== Icon Mapper ============================== */
const iconComponents = {
  Award,
  BookOpen,
  Crown,
  Flame,
  Gamepad2,
  Heart,
  Palette,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Sword,
  Target,
  Trophy,
  Wand2,
  Zap,
};

const RewardIcon = ({ iconName, size = 32, className = "" }) => {
  const IconComponent = iconComponents[iconName] || Star;
  return <IconComponent size={size} className={className} />;
};

/* ============================== Utilities ============================== */
const normalize = (s) => (s ?? "").toString().trim();

const clampInt = (n, min, max, fallback) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(v)));
};

const speak = (text) => {
  if (!text) return;
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.85;
    u.pitch = 1.1;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  }
};

const shuffle = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// Minimal CSV parser with quote support
const parseCSV = (text) => {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (c === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((c === "\n" || c === "\r") && !inQuotes) {
      if (c === "\r" && next === "\n") i++;
      row.push(cell);
      cell = "";
      const isEmpty = row.every((x) => normalize(x) === "");
      if (!isEmpty) rows.push(row);
      row = [];
      continue;
    }
    cell += c;
  }

  row.push(cell);
  const isEmpty = row.every((x) => normalize(x) === "");
  if (!isEmpty) rows.push(row);

  return rows;
};

/* ============================== Smart Phonics Mode ============================== */
const inferPhonicsPatterns = (word) => {
  const w = (word || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return [];

  const found = new Set();
  const rules = [
    { id: "sh", test: () => w.includes("sh") },
    { id: "ch", test: () => w.includes("ch") },
    { id: "th", test: () => w.includes("th") },
    { id: "wh", test: () => w.includes("wh") },
    { id: "ph", test: () => w.includes("ph") },
    { id: "ck", test: () => w.includes("ck") },
    { id: "ng", test: () => w.includes("ng") },
    { id: "nk", test: () => w.includes("nk") },
    { id: "qu", test: () => w.includes("qu") },

    { id: "bl", test: () => w.includes("bl") },
    { id: "cl", test: () => w.includes("cl") },
    { id: "fl", test: () => w.includes("fl") },
    { id: "gl", test: () => w.includes("gl") },
    { id: "pl", test: () => w.includes("pl") },
    { id: "sl", test: () => w.includes("sl") },
    { id: "br", test: () => w.includes("br") },
    { id: "cr", test: () => w.includes("cr") },
    { id: "dr", test: () => w.includes("dr") },
    { id: "fr", test: () => w.includes("fr") },
    { id: "gr", test: () => w.includes("gr") },
    { id: "pr", test: () => w.includes("pr") },
    { id: "tr", test: () => w.includes("tr") },
    { id: "sk", test: () => w.includes("sk") },
    { id: "sm", test: () => w.includes("sm") },
    { id: "sn", test: () => w.includes("sn") },
    { id: "sp", test: () => w.includes("sp") },
    { id: "st", test: () => w.includes("st") },
    { id: "sw", test: () => w.includes("sw") },
    { id: "tw", test: () => w.includes("tw") },
    { id: "scr", test: () => w.includes("scr") },
    { id: "spl", test: () => w.includes("spl") },
    { id: "spr", test: () => w.includes("spr") },
    { id: "str", test: () => w.includes("str") },

    { id: "ai", test: () => w.includes("ai") },
    { id: "ay", test: () => w.includes("ay") },
    { id: "ea", test: () => w.includes("ea") },
    { id: "ee", test: () => w.includes("ee") },
    { id: "ie", test: () => w.includes("ie") },
    { id: "oa", test: () => w.includes("oa") },
    { id: "oe", test: () => w.includes("oe") },
    { id: "oo", test: () => w.includes("oo") },
    { id: "ou", test: () => w.includes("ou") },
    { id: "ow", test: () => w.includes("ow") },
    { id: "oi", test: () => w.includes("oi") },
    { id: "oy", test: () => w.includes("oy") },
    { id: "au", test: () => w.includes("au") },
    { id: "aw", test: () => w.includes("aw") },

    { id: "ar", test: () => w.includes("ar") },
    { id: "er", test: () => w.includes("er") },
    { id: "ir", test: () => w.includes("ir") },
    { id: "or", test: () => w.includes("or") },
    { id: "ur", test: () => w.includes("ur") },
    { id: "ear", test: () => w.includes("ear") },
    { id: "air", test: () => w.includes("air") },
    { id: "ire", test: () => w.includes("ire") },

    {
      id: "silent-e",
      test: () => {
        if (!w.endsWith("e") || w.length < 3) return false;
        const v = "aeiou";
        const c = "bcdfghjklmnpqrstvwxyz";
        const a = w[w.length - 3];
        const b = w[w.length - 2];
        return v.includes(a) && c.includes(b);
      },
    },

    { id: "soft-c", test: () => /ce|ci|cy/.test(w) },
    { id: "soft-g", test: () => /ge|gi|gy/.test(w) },

    { id: "dge", test: () => w.includes("dge") },
    { id: "tch", test: () => w.includes("tch") },
  ];

  for (const r of rules) {
    if (r.test()) found.add(r.id);
  }

  if (found.size === 0) {
    if (/[aeiou]{2,}/.test(w)) found.add("vowel-team");
    else found.add("short-vowel");
  }

  return Array.from(found).slice(0, 4);
};

/* ============================== UI Helpers ============================== */
const BackButton = ({ onClick, label = "Back", className = "" }) => (
  <button
    onClick={onClick}
    className={`text-purple-800 hover:text-purple-900 font-semibold inline-flex items-center gap-2 ${className}`}
  >
    <ArrowLeft size={18} />
    <span>{label}</span>
  </button>
);

const IconPill = ({ icon: Icon, label, className = "" }) => (
  <div className={`inline-flex items-center gap-2 bg-white border border-gray-200 px-5 py-2 rounded-full shadow-sm ${className}`}>
    <Icon size={22} />
    <span className="font-extrabold text-gray-900">{label}</span>
  </div>
);

/* ============================== Sound Jumper Game ============================== */
const SoundJumperGame = ({
  phonicsWords,
  wordsPerSession = 8,
  smartMode = true,
  onBack,
  onComplete,
  setPoints,
  onEvent,
}) => {
  const [roundWords, setRoundWords] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [choices, setChoices] = useState([]);
  const [selected, setSelected] = useState(null);
  const [feedback, setFeedback] = useState(null); // "correct" | "wrong"
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);

  const splitPatterns = (raw) =>
    (raw || "")
      .split(";")
      .map((x) => normalize(x).toLowerCase())
      .filter(Boolean);

  const normalizePhonicsDeck = () => {
    const raw = Array.isArray(phonicsWords) ? phonicsWords : [];
    const expanded = [];

    for (const item of raw) {
      const w = normalize(item?.word);
      const pRaw = normalize(item?.pattern);
      if (!w) continue;

      const provided = splitPatterns(pRaw);
      const inferred = !provided.length && smartMode ? inferPhonicsPatterns(w) : [];
      const finalPatterns = provided.length ? provided : inferred.length ? inferred : ["unknown"];

      for (const pat of finalPatterns) expanded.push({ word: w, pattern: pat || "unknown" });
    }

    const key = (x) => `${(x.word || "").toLowerCase()}|${(x.pattern || "unknown").toLowerCase()}`;
    const map = new Map();
    for (const x of expanded) map.set(key(x), x);
    return Array.from(map.values());
  };

  const buildRound = () => {
    const deck = normalizePhonicsDeck();
    if (!deck.length) {
      setRoundWords([]);
      return;
    }

    const count = clampInt(wordsPerSession, 1, 50, 8);
    const picked = shuffle(deck).slice(0, Math.min(count, deck.length));
    setRoundWords(picked);
    setCurrentIndex(0);
    setSelected(null);
    setFeedback(null);
    setGameOver(false);
    setScore(0);
  };

  useEffect(() => {
    buildRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = roundWords[currentIndex];

  const uniquePatterns = useMemo(() => {
    const deck = normalizePhonicsDeck();
    return Array.from(new Set(deck.map((x) => (x.pattern || "unknown").toLowerCase()))).filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phonicsWords, smartMode]);

  const buildChoices = () => {
    if (!current) return [];
    const correct = (current.pattern || "unknown").toLowerCase();
    const pool = uniquePatterns.filter((p) => p !== correct);
    const distractors = shuffle(pool).slice(0, 2);
    return shuffle([correct, ...distractors]);
  };

  useEffect(() => {
    if (!current) return;
    setChoices(buildChoices());
    setSelected(null);
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, roundWords]);

  const next = () => {
    if (currentIndex < roundWords.length - 1) setCurrentIndex((i) => i + 1);
    else setGameOver(true);
  };

  const handlePick = (pattern) => {
    if (!current || feedback) return;

    onEvent?.({ type: "attempt", domain: "phonics" });

    const correct = (current.pattern || "unknown").toLowerCase();
    const picked = (pattern || "").toLowerCase();
    setSelected(picked);

    if (picked === correct) {
      setFeedback("correct");
      setScore((s) => s + 10);
      setPoints((p) => p + 5);
      onEvent?.({ type: "correct", domain: "phonics" });
      speak("Correct");
    } else {
      setFeedback("wrong");
      setPoints((p) => p + 1);
      speak("Try again");
    }

    setTimeout(() => {
      if (picked === correct) next();
      else {
        setFeedback(null);
        setSelected(null);
      }
    }, 900);
  };

  if (!roundWords.length) {
    return (
      <div className="max-w-4xl mx-auto">
        <BackButton onClick={onBack} className="mb-6" />

        <div className="bg-white rounded-3xl shadow-md p-8 border border-gray-200 text-center">
          <Zap className="mx-auto text-purple-800 mb-4" size={56} />
          <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Sound Jumper</h2>
          <p className="text-gray-700">No phonics words yet. Add items on the Parents Page or import a CSV.</p>
        </div>
      </div>
    );
  }

  if (gameOver) {
    return (
      <div className="max-w-4xl mx-auto text-center">
        <div className="bg-white rounded-3xl shadow-md p-10 border border-gray-200">
          <Trophy className="text-yellow-500 mx-auto mb-6" size={72} />
          <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Nice work</h2>
          <p className="text-xl text-gray-700 mb-6">
            Final Score: <span className="font-bold">{score}</span>
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button
              onClick={buildRound}
              className="bg-purple-700 hover:bg-purple-800 text-white font-bold py-3 px-6 rounded-2xl"
            >
              Play Again
            </button>
            <button
              onClick={onComplete}
              className="bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold py-3 px-6 rounded-2xl"
            >
              Back to Today's Games
            </button>
          </div>
        </div>
      </div>
    );
  }

  const correctPattern = (current?.pattern || "unknown").toLowerCase();

  return (
    <div className="max-w-4xl mx-auto">
      <BackButton onClick={onBack} className="mb-6" />

      <div className="bg-white rounded-3xl shadow-md p-6 border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <div className="text-xl font-extrabold text-gray-900">Score: {score}</div>
          <div className="text-sm text-gray-600">
            Jump {currentIndex + 1} of {roundWords.length}
          </div>
        </div>

        <div className="bg-gray-50 rounded-2xl p-8 border border-gray-200 text-center">
          <div className="text-sm font-extrabold text-gray-500 mb-2">Word</div>
          <div className="text-6xl font-extrabold text-purple-800 mb-4">{current.word}</div>

          <button
            onClick={() => speak(current.word)}
            className="inline-flex items-center gap-2 bg-purple-700 hover:bg-purple-800 text-white font-extrabold px-5 py-3 rounded-2xl"
          >
            <Volume2 size={20} /> Say it
          </button>
        </div>

        <div className="mt-5 grid md:grid-cols-3 gap-3">
          {choices.map((c) => {
            const active = selected === c;
            const isCorrect = feedback === "correct" && c === correctPattern;
            const isWrong = feedback === "wrong" && active && c !== correctPattern;

            return (
              <button
                key={c}
                onClick={() => handlePick(c)}
                className={`rounded-2xl p-4 font-extrabold border transition ${
                  isCorrect
                    ? "bg-green-50 border-green-200 text-green-800"
                    : isWrong
                    ? "bg-red-50 border-red-200 text-red-800"
                    : active
                    ? "bg-purple-50 border-purple-200 text-purple-900"
                    : "bg-white border-gray-200 text-gray-900 hover:bg-gray-50"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>

        <div className="mt-5 text-center text-sm text-gray-600">Pick the sound pattern that matches the word.</div>
      </div>
    </div>
  );
};

/* ============================== Math Race Game ============================== */
const MathRaceGame = ({
  onBack,
  onDone,
  setPoints,
  initialTopicId,
  numProblems = 10,
  autoStart = false,
  onEvent,
}) => {
  const [mathTopic, setMathTopic] = useState(null);
  const [currentProblem, setCurrentProblem] = useState(0);
  const [userAnswer, setUserAnswer] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [problems, setProblems] = useState([]);

  const mathTopics = [
    { id: "addition-double", name: "Addition (2-digit)", active: true },
    { id: "subtraction-double", name: "Subtraction (2-digit)", active: true },
    { id: "addition-triple", name: "Addition (3-digit)", active: true },
    { id: "subtraction-triple", name: "Subtraction (3-digit)", active: true },
    { id: "line-graphing", name: "Line Graphing", active: true },
    { id: "multiplication-single", name: "Multiplication (1-digit)", active: false },
    { id: "multiplication-double", name: "Multiplication (2-digit)", active: false },
    { id: "division-single", name: "Division (1-digit)", active: false },
  ];

  const generateProblems = (topicId, count = 10) => {
    const probs = [];
    for (let i = 0; i < count; i++) {
      if (topicId === "addition-double") {
        const a = Math.floor(Math.random() * 90) + 10;
        const b = Math.floor(Math.random() * 90) + 10;
        probs.push({ num1: a, num2: b, operator: "+", answer: a + b, type: "vertical" });
      } else if (topicId === "subtraction-double") {
        const a = Math.floor(Math.random() * 90) + 10;
        const b = Math.floor(Math.random() * a);
        probs.push({ num1: a, num2: b, operator: "-", answer: a - b, type: "vertical" });
      } else if (topicId === "addition-triple") {
        const a = Math.floor(Math.random() * 900) + 100;
        const b = Math.floor(Math.random() * 900) + 100;
        probs.push({ num1: a, num2: b, operator: "+", answer: a + b, type: "vertical" });
      } else if (topicId === "subtraction-triple") {
        const a = Math.floor(Math.random() * 900) + 100;
        const b = Math.floor(Math.random() * a);
        probs.push({ num1: a, num2: b, operator: "-", answer: a - b, type: "vertical" });
      } else if (topicId === "line-graphing") {
        const x = Math.floor(Math.random() * 10) - 5;
        const y = Math.floor(Math.random() * 10) - 5;
        probs.push({
          question: "What are the coordinates of this point?",
          x,
          y,
          answer: `${x},${y}`,
          type: "graph",
        });
      }
    }
    return probs;
  };

  const startGame = (topicId) => {
    setMathTopic(topicId);
    setProblems(generateProblems(topicId, clampInt(numProblems, 1, 50, 10)));
    setCurrentProblem(0);
    setUserAnswer("");
    setShowResult(false);
    setScore(0);
    setGameOver(false);
  };

  useEffect(() => {
    if (autoStart && initialTopicId) startGame(initialTopicId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, initialTopicId]);

  const handleSubmit = () => {
    if (!problems.length || !problems[currentProblem]) return;

    onEvent?.({ type: "attempt", domain: "math" });

    let correct = false;
    const p = problems[currentProblem];

    if (p.type === "graph") {
      const userCoords = userAnswer.replace(/\s/g, "").split(",");
      correct =
        userCoords.length === 2 &&
        parseInt(userCoords[0], 10) === p.x &&
        parseInt(userCoords[1], 10) === p.y;
    } else {
      correct = parseInt(userAnswer, 10) === p.answer;
    }

    setIsCorrect(correct);
    setShowResult(true);

    if (correct) {
      onEvent?.({ type: "correct", domain: "math" });
      setScore((s) => s + 10);
      setPoints((p2) => p2 + 10);
    }

    setTimeout(() => {
      if (currentProblem < problems.length - 1) {
        setCurrentProblem((n) => n + 1);
        setUserAnswer("");
        setShowResult(false);
      } else {
        setGameOver(true);
      }
    }, 1400);
  };

  const resetGame = () => {
    setMathTopic(null);
    setProblems([]);
    setCurrentProblem(0);
    setUserAnswer("");
    setShowResult(false);
    setScore(0);
    setGameOver(false);
  };

  if (!mathTopic) {
    return (
      <div className="max-w-4xl mx-auto">
        <BackButton onClick={() => (onDone ? onDone() : onBack())} className="mb-6" />

        <h1 className="text-4xl font-extrabold text-gray-900 mb-2 text-center">Choose Your Math Topic</h1>
        <p className="text-center text-gray-600 mb-8">Pick a mode. You have got this.</p>

        <div className="bg-white rounded-3xl shadow-md p-6 border border-gray-200">
          <div className="space-y-3">
            {mathTopics.map((topic) => (
              <button
                key={topic.id}
                onClick={() => topic.active && startGame(topic.id)}
                disabled={!topic.active}
                className={`w-full text-left px-6 py-4 rounded-2xl font-bold text-lg transition ${
                  topic.active
                    ? "bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:opacity-95 shadow-sm"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}
              >
                {topic.name} {!topic.active && "(Coming Soon)"}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (gameOver) {
    return (
      <div className="max-w-4xl mx-auto text-center">
        <div className="bg-white rounded-3xl shadow-md p-10 border border-gray-200">
          <Trophy className="text-yellow-500 mx-auto mb-6" size={72} />
          <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Nice work</h2>
          <p className="text-xl text-gray-700 mb-6">
            Final Score: <span className="font-bold">{score}</span>
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button
              onClick={resetGame}
              className="bg-purple-700 hover:bg-purple-800 text-white font-bold py-3 px-6 rounded-2xl"
            >
              Try Another Topic
            </button>
            <button
              onClick={() => (onDone ? onDone() : onBack())}
              className="bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold py-3 px-6 rounded-2xl"
            >
              Back to Today's Games
            </button>
          </div>
        </div>
      </div>
    );
  }

  const problem = problems[currentProblem];

  return (
    <div className="max-w-4xl mx-auto">
      <BackButton onClick={resetGame} label="Choose Different Topic" className="mb-6" />

      <div className="bg-white rounded-3xl shadow-md p-6 border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <div className="text-xl font-extrabold text-gray-900">Score: {score}</div>
          <div className="text-sm text-gray-600">
            Round {currentProblem + 1} of {problems.length}
          </div>
        </div>

        {problem.type === "graph" ? (
          <div className="bg-gray-50 rounded-2xl p-6 mb-5 border border-gray-200">
            <h2 className="text-xl font-extrabold text-gray-900 mb-4 text-center">{problem.question}</h2>

            <div className="bg-white p-4 rounded-2xl border border-gray-200 mb-4">
              <svg viewBox="-6 -6 12 12" className="w-full max-w-md mx-auto" style={{ transform: "scaleY(-1)" }}>
                <line x1="-6" y1="0" x2="6" y2="0" stroke="#888" strokeWidth="0.05" />
                <line x1="0" y1="-6" x2="0" y2="6" stroke="#888" strokeWidth="0.05" />
                {[-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].map((n) => (
                  <g key={`x${n}`}>
                    <line x1={n} y1="-0.1" x2={n} y2="0.1" stroke="#888" strokeWidth="0.03" />
                    <text x={n} y="-0.3" fontSize="0.4" textAnchor="middle" fill="#666" transform="scale(1,-1)">
                      {n}
                    </text>
                  </g>
                ))}
                {[-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].map((n) => (
                  <g key={`y${n}`}>
                    <line x1="-0.1" y1={n} x2="0.1" y2={n} stroke="#888" strokeWidth="0.03" />
                    <text x="-0.4" y={n} fontSize="0.4" textAnchor="middle" fill="#666" transform="scale(1,-1)">
                      {n}
                    </text>
                  </g>
                ))}
                <circle cx={problem.x} cy={problem.y} r="0.3" fill="#e91e63" stroke="#c2185b" strokeWidth="0.1" />
              </svg>
            </div>

            <div className="text-center">
              <p className="text-gray-700 font-semibold mb-2">Enter coordinates as x,y</p>
              <input
                type="text"
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !showResult && userAnswer && handleSubmit()}
                placeholder="Example: 3,4"
                disabled={showResult}
                className="w-48 px-4 py-3 text-xl text-center border border-gray-200 rounded-2xl focus:outline-none focus:border-purple-300 font-bold bg-white"
              />
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-2xl p-8 mb-5 border border-gray-200 flex flex-col items-center">
            <div className="bg-white rounded-2xl p-6 border border-gray-200 w-full max-w-sm">
              <div className="text-right font-mono">
                <div className="text-5xl font-extrabold text-gray-900 mb-2">{problem.num1}</div>
                <div className="flex items-center justify-end gap-4 text-5xl font-extrabold text-gray-900 mb-2">
                  <span>{problem.operator}</span>
                  <span>{problem.num2}</span>
                </div>
                <div className="border-t-2 border-gray-300 mb-3" />
                <input
                  type="number"
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !showResult && userAnswer && handleSubmit()}
                  placeholder="?"
                  disabled={showResult}
                  className="w-full text-5xl text-right font-extrabold border border-gray-200 rounded-2xl focus:outline-none focus:border-purple-300 px-3 py-2 bg-white"
                />
              </div>
            </div>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={showResult || !userAnswer}
          className="w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:opacity-95 disabled:bg-gray-200 disabled:text-gray-400 text-white font-extrabold py-4 px-6 rounded-2xl text-lg"
        >
          Check Answer
        </button>

        {showResult && (
          <div
            className={`mt-5 p-5 rounded-2xl border ${
              isCorrect ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
            }`}
          >
            <div className={`text-xl font-extrabold flex items-center gap-2 ${isCorrect ? "text-green-800" : "text-red-800"}`}>
              {isCorrect ? <Check size={22} /> : <X size={22} />}
              <span>{isCorrect ? "Correct. Nice job." : "Not this time. Try again."}</span>
            </div>

            {!isCorrect && (
              <p className="text-lg text-gray-700 mt-2">
                Answer:{" "}
                <strong>{problem.type === "graph" ? `(${problem.x}, ${problem.y})` : problem.answer}</strong>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================== Obby Game ============================== */
const ObbyGame = ({ onBack, onComplete, setPoints, onEvent }) => {
  const [gameState, setGameState] = useState("playing"); // playing | won | lost
  const [playerY, setPlayerY] = useState(400);
  const [playerX] = useState(100);
  const [platforms, setPlatforms] = useState([]);
  const [score, setScore] = useState(0);
  const [velocity, setVelocity] = useState(0);
  const [isJumping, setIsJumping] = useState(false);
  const [currentWord, setCurrentWord] = useState(null);
  const [wordPool, setWordPool] = useState([]);
  const [usedWords, setUsedWords] = useState([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [answerCorrect, setAnswerCorrect] = useState(null);

  const GRAVITY = 0.5;
  const JUMP_FORCE = -12;
  const PLAYER_SIZE = 40;
  const PLATFORM_WIDTH = 120;
  const PLATFORM_HEIGHT = 20;
  const GAME_WIDTH = 800;
  const GAME_HEIGHT = 600;
  const GROUND_Y = 500;

  useEffect(() => {
    const words = [
      { word: "the", definition: "used to refer to a specific thing" },
      { word: "and", definition: "used to connect words or phrases" },
      { word: "is", definition: "to be or exist" },
      { word: "you", definition: "the person being spoken to" },
      { word: "to", definition: "expressing direction or destination" },
      { word: "it", definition: "referring to a thing" },
      { word: "in", definition: "expressing location inside" },
      { word: "that", definition: "referring to a specific thing" },
      { word: "have", definition: "to possess or own" },
      { word: "for", definition: "indicating purpose" },
    ];
    setWordPool(words);
  }, []);

  useEffect(() => {
    const initialPlatforms = [
      { x: 0, y: GROUND_Y, width: GAME_WIDTH, height: 20, hasWord: false },
      { x: 150, y: 400, width: PLATFORM_WIDTH, height: PLATFORM_HEIGHT, hasWord: true, wordIndex: 0 },
      { x: 350, y: 350, width: PLATFORM_WIDTH, height: PLATFORM_HEIGHT, hasWord: true, wordIndex: 1 },
      { x: 550, y: 300, width: PLATFORM_WIDTH, height: PLATFORM_HEIGHT, hasWord: true, wordIndex: 2 },
      { x: 300, y: 200, width: PLATFORM_WIDTH, height: PLATFORM_HEIGHT, hasWord: true, wordIndex: 3 },
      { x: 100, y: 100, width: PLATFORM_WIDTH, height: PLATFORM_HEIGHT, hasWord: true, wordIndex: 4 },
      { x: 400, y: 50, width: 150, height: PLATFORM_HEIGHT, hasWord: false, isGoal: true },
    ];
    setPlatforms(initialPlatforms);
  }, []);

  useEffect(() => {
    if (gameState !== "playing") return;

    const gameLoop = setInterval(() => {
      setVelocity((v) => v + GRAVITY);
      setPlayerY((y) => {
        const newY = y + velocity;

        platforms.forEach((platform, idx) => {
          if (
            playerX + PLAYER_SIZE > platform.x &&
            playerX < platform.x + platform.width &&
            newY + PLAYER_SIZE >= platform.y &&
            newY + PLAYER_SIZE <= platform.y + PLATFORM_HEIGHT &&
            velocity >= 0
          ) {
            setVelocity(0);
            setIsJumping(false);

            if (platform.hasWord && !usedWords.includes(idx)) {
              const word = wordPool[platform.wordIndex];
              if (word) setCurrentWord(word);
            }

            if (platform.isGoal) {
              setGameState("won");
              setScore((s) => s + 100);
              setPoints((p) => p + 50);
              onEvent?.({ type: "complete", domain: "obby" });
            }

            return platform.y - PLAYER_SIZE;
          }
        });

        if (newY > GAME_HEIGHT) {
          setGameState("lost");
          return newY;
        }

        return newY;
      });
    }, 1000 / 60);

    return () => clearInterval(gameLoop);
  }, [gameState, velocity, platforms, playerX, usedWords, wordPool, setPoints, onEvent]);

  const jump = () => {
    if (!isJumping && gameState === "playing") {
      setVelocity(JUMP_FORCE);
      setIsJumping(true);
    }
  };

  const handleWordAnswer = (correct) => {
    onEvent?.({ type: "attempt", domain: "obby" });

    if (correct) {
      onEvent?.({ type: "correct", domain: "obby" });
      setAnswerCorrect(true);
      setScore((s) => s + 10);
      setPoints((p) => p + 5);

      const idx = platforms.findIndex(
        (p) => p.hasWord && wordPool[p.wordIndex]?.word === currentWord?.word
      );
      if (idx >= 0) setUsedWords((used) => (used.includes(idx) ? used : [...used, idx]));
    } else {
      setAnswerCorrect(false);
      setPoints((p) => p + 1);
    }

    setShowAnswer(true);
    setTimeout(() => {
      setCurrentWord(null);
      setShowAnswer(false);
      setAnswerCorrect(null);
    }, 1500);
  };

  const resetGame = () => {
    setGameState("playing");
    setPlayerY(400);
    setVelocity(0);
    setIsJumping(false);
    setScore(0);
    setUsedWords([]);
    setCurrentWord(null);
    setShowAnswer(false);
    setAnswerCorrect(null);
  };

  if (gameState === "won") {
    return (
      <div className="max-w-4xl mx-auto text-center">
        <div className="bg-white rounded-3xl shadow-md p-10 border border-gray-200">
          <Trophy className="text-yellow-500 mx-auto mb-6" size={72} />
          <h2 className="text-3xl font-extrabold text-gray-900 mb-2">You Won!</h2>
          <p className="text-xl text-gray-700 mb-6">
            Final Score: <span className="font-bold">{score}</span>
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button
              onClick={resetGame}
              className="bg-purple-700 hover:bg-purple-800 text-white font-bold py-3 px-6 rounded-2xl"
            >
              Play Again
            </button>
            <button
              onClick={onComplete}
              className="bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold py-3 px-6 rounded-2xl"
            >
              Back to Games
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gameState === "lost") {
    return (
      <div className="max-w-4xl mx-auto text-center">
        <div className="bg-white rounded-3xl shadow-md p-10 border border-gray-200">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Game Over</h2>
          <p className="text-xl text-gray-700 mb-6">
            Score: <span className="font-bold">{score}</span>
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button
              onClick={resetGame}
              className="bg-purple-700 hover:bg-purple-800 text-white font-bold py-3 px-6 rounded-2xl"
            >
              Try Again
            </button>
            <button
              onClick={onComplete}
              className="bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold py-3 px-6 rounded-2xl"
            >
              Back to Games
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <BackButton onClick={onBack} className="mb-6" />

      <div className="bg-white rounded-3xl shadow-md p-6 border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <div className="text-xl font-extrabold text-gray-900">Score: {score}</div>
          <div className="text-sm text-gray-600">Jump to the top!</div>
        </div>

        <div
          className="relative bg-gradient-to-b from-blue-200 to-blue-100 rounded-2xl border-2 border-gray-300"
          style={{ width: 800, height: 600, margin: "0 auto" }}
          onClick={jump}
        >
          {platforms.map((platform, idx) => (
            <div
              key={idx}
              className={`absolute ${
                platform.isGoal
                  ? "bg-gradient-to-r from-yellow-400 to-yellow-600"
                  : platform.hasWord
                  ? usedWords.includes(idx)
                    ? "bg-green-500"
                    : "bg-purple-500"
                  : "bg-gray-700"
              }`}
              style={{
                left: platform.x,
                top: platform.y,
                width: platform.width,
                height: platform.height,
                borderRadius: "8px",
              }}
            >
              {platform.isGoal && (
                <div className="text-center text-white font-extrabold text-sm pt-1">GOAL</div>
              )}
            </div>
          ))}

          <div
            className="absolute bg-red-500 rounded-full border-2 border-red-700"
            style={{ left: 100, top: playerY, width: 40, height: 40 }}
          />

          <div className="absolute top-4 left-0 right-0 text-center">
            <div className="inline-block bg-white bg-opacity-90 px-4 py-2 rounded-full text-sm font-bold text-gray-900">
              Click or tap to jump
            </div>
          </div>
        </div>

        {currentWord && !showAnswer && (
          <div className="mt-4 bg-purple-50 border-2 border-purple-200 rounded-2xl p-6">
            <h3 className="text-xl font-extrabold text-gray-900 mb-4 text-center">Quick! What does this word mean?</h3>
            <div className="text-3xl font-extrabold text-purple-800 mb-4 text-center">{currentWord.word}</div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleWordAnswer(true)}
                className="bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-2xl"
              >
                {currentWord.definition}
              </button>
              <button
                onClick={() => handleWordAnswer(false)}
                className="bg-gray-200 hover:bg-gray-300 text-gray-900 font-bold py-3 rounded-2xl"
              >
                Wrong answer
              </button>
            </div>
          </div>
        )}

        {showAnswer && (
          <div
            className={`mt-4 p-4 rounded-2xl border-2 ${
              answerCorrect ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"
            }`}
          >
            <div className="text-xl font-extrabold text-center inline-flex items-center gap-2 justify-center">
              {answerCorrect ? <Check size={22} /> : <X size={22} />}
              <span>{answerCorrect ? "Correct! +5 points" : "Keep trying!"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================== Chest Opening Modal ============================== */
const ChestOpeningModal = ({ chestType, onClose, onRewardReceived }) => {
  const [stage, setStage] = useState("opening"); // opening | revealed
  const [reward, setReward] = useState(null);

  useEffect(() => {
    const pickReward = () => {
      const rarityWeights = {
        bronze: { common: 0.7, rare: 0.25, epic: 0.05 },
        silver: { common: 0.4, rare: 0.5, epic: 0.1 },
        gold: { common: 0.2, rare: 0.5, epic: 0.3 },
      };

      const weights = rarityWeights[chestType.id] || rarityWeights.bronze;
      const roll = Math.random();

      let rarity;
      if (roll < weights.epic) rarity = "epic";
      else if (roll < weights.epic + weights.rare) rarity = "rare";
      else rarity = "common";

      const pool = REWARD_POOL.filter((r) => r.rarity === rarity);
      return pool[Math.floor(Math.random() * pool.length)];
    };

    const selectedReward = pickReward();
    setReward(selectedReward);

    const t = setTimeout(() => {
      setStage("revealed");
      onRewardReceived(selectedReward);
    }, 1500);

    return () => clearTimeout(t);
  }, [chestType, onRewardReceived]);

  const getRarityColor = (rarity) => {
    if (rarity === "epic") return "from-purple-500 to-pink-500";
    if (rarity === "rare") return "from-blue-500 to-cyan-500";
    return "from-gray-400 to-gray-600";
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center">
        {stage === "opening" ? (
          <div className="animate-pulse">
            <Package className="mx-auto text-gray-400 mb-4" size={80} />
            <h2 className="text-2xl font-extrabold text-gray-900">Opening {chestType.name}...</h2>
          </div>
        ) : (
          <div>
            <div className="mb-6">
              <div
                className={`mb-4 inline-block p-6 rounded-3xl bg-gradient-to-br ${getRarityColor(reward?.rarity)} shadow-lg`}
              >
                <RewardIcon iconName={reward?.icon} size={64} className="text-white" />
              </div>
            </div>

            <div
              className={`inline-block px-4 py-1 rounded-full text-xs font-extrabold mb-2 ${
                reward?.rarity === "epic"
                  ? "bg-purple-100 text-purple-800"
                  : reward?.rarity === "rare"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {(reward?.rarity || "").toUpperCase()}
            </div>

            <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Loot Unlocked!</h2>
            <p className="text-xl text-gray-700 mb-6">{reward?.name}</p>

            <button
              onClick={onClose}
              className="w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:opacity-95 text-white font-extrabold py-4 rounded-2xl"
            >
              Add to Collection
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================== Main App ============================== */
const HomeworkGamesApp = () => {
  const [currentView, setCurrentView] = useState("home"); // home | parents | flashcards | today | game | loot
  const [selectedGame, setSelectedGame] = useState(null);
  const [points, setPoints] = useState(0);
  const [keys, setKeys] = useState(0);
  const [inventory, setInventory] = useState([]);

  const [showChestModal, setShowChestModal] = useState(false);
  const [selectedChest, setSelectedChest] = useState(null);
  const [completedGamesThisSession, setCompletedGamesThisSession] = useState([]);

  const [flashcardMode, setFlashcardMode] = useState(null); // sight | spelling | vocab
  const [currentFlashcard, setCurrentFlashcard] = useState(0);
  const [showFlashcardAnswer, setShowFlashcardAnswer] = useState(false);

  const [customSightWords, setCustomSightWords] = useState([]);
  const [customSpellingWords, setCustomSpellingWords] = useState([]);
  const [customVocabWords, setCustomVocabWords] = useState([]); // {word, def}
  const [customPhonicsWords, setCustomPhonicsWords] = useState([]); // {word, pattern}

  const [newSightWord, setNewSightWord] = useState("");
  const [newSpellingWord, setNewSpellingWord] = useState("");
  const [newVocabWord, setNewVocabWord] = useState("");
  const [newVocabDef, setNewVocabDef] = useState("");
  const [newPhonicsWord, setNewPhonicsWord] = useState("");
  const [newPhonicsPattern, setNewPhonicsPattern] = useState("");

  const [upcomingTests, setUpcomingTests] = useState([]);
  const [newTestName, setNewTestName] = useState("");
  const [newTestSubject, setNewTestSubject] = useState("Math");
  const [newTestDate, setNewTestDate] = useState("");

  const [weeklyGames, setWeeklyGames] = useState(DEFAULT_WEEKLY_GAMES);
  const [teacherNotes, setTeacherNotes] = useState("");
  const [progress, setProgress] = useState(DEFAULT_PROGRESS);

  const [todayGameIndex, setTodayGameIndex] = useState(0);
  const [todayItems, setTodayItems] = useState({ sight: [], spelling: [], vocab: [], phonics: [] });
  const [todayCardIndex, setTodayCardIndex] = useState(0);

  const [lastImportSummary, setLastImportSummary] = useState(null);

  /* ----------------------------- Load / Save ----------------------------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);

      if (typeof data.points === "number") setPoints(data.points);
      if (typeof data.keys === "number") setKeys(data.keys);
      if (Array.isArray(data.inventory)) setInventory(data.inventory);

      if (Array.isArray(data.customSightWords)) setCustomSightWords(data.customSightWords);
      if (Array.isArray(data.customSpellingWords)) setCustomSpellingWords(data.customSpellingWords);
      if (Array.isArray(data.customVocabWords)) setCustomVocabWords(data.customVocabWords);
      if (Array.isArray(data.customPhonicsWords)) setCustomPhonicsWords(data.customPhonicsWords);

      if (Array.isArray(data.upcomingTests)) setUpcomingTests(data.upcomingTests);

      if (data.weeklyGames && typeof data.weeklyGames === "object") {
        setWeeklyGames({ ...DEFAULT_WEEKLY_GAMES, ...data.weeklyGames });
      }

      if (typeof data.teacherNotes === "string") setTeacherNotes(data.teacherNotes);
      if (data.progress && typeof data.progress === "object") setProgress({ ...DEFAULT_PROGRESS, ...data.progress });

      if (data.drafts && typeof data.drafts === "object") {
        const d = data.drafts;
        if (typeof d.newSightWord === "string") setNewSightWord(d.newSightWord);
        if (typeof d.newSpellingWord === "string") setNewSpellingWord(d.newSpellingWord);
        if (typeof d.newVocabWord === "string") setNewVocabWord(d.newVocabWord);
        if (typeof d.newVocabDef === "string") setNewVocabDef(d.newVocabDef);
        if (typeof d.newPhonicsWord === "string") setNewPhonicsWord(d.newPhonicsWord);
        if (typeof d.newPhonicsPattern === "string") setNewPhonicsPattern(d.newPhonicsPattern);
        if (typeof d.newTestName === "string") setNewTestName(d.newTestName);
        if (typeof d.newTestSubject === "string") setNewTestSubject(d.newTestSubject);
        if (typeof d.newTestDate === "string") setNewTestDate(d.newTestDate);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const payload = {
      points,
      keys,
      inventory,
      customSightWords,
      customSpellingWords,
      customVocabWords,
      customPhonicsWords,
      upcomingTests,
      weeklyGames,
      teacherNotes,
      progress,
      drafts: {
        newSightWord,
        newSpellingWord,
        newVocabWord,
        newVocabDef,
        newPhonicsWord,
        newPhonicsPattern,
        newTestName,
        newTestSubject,
        newTestDate,
      },
    };

    const t = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(payload));
      } catch {
        // ignore
      }
    }, 250);

    return () => clearTimeout(t);
  }, [
    points,
    keys,
    inventory,
    customSightWords,
    customSpellingWords,
    customVocabWords,
    customPhonicsWords,
    upcomingTests,
    weeklyGames,
    teacherNotes,
    progress,
    newSightWord,
    newSpellingWord,
    newVocabWord,
    newVocabDef,
    newPhonicsWord,
    newPhonicsPattern,
    newTestName,
    newTestSubject,
    newTestDate,
  ]);

  /* ---------------------- Tests helpers ---------------------- */
  const getUpcomingReminders = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);

    return upcomingTests
      .filter((test) => {
        const testDate = new Date(test.date);
        return testDate >= today && testDate <= weekFromNow;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  };

  const getDaysUntil = (dateStr) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const testDate = new Date(dateStr);
    testDate.setHours(0, 0, 0, 0);

    const diffTime = testDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    return `In ${diffDays} days`;
  };

  const addTest = () => {
    if (newTestName.trim() && newTestDate) {
      setUpcomingTests((prev) => [...prev, { name: newTestName.trim(), subject: newTestSubject, date: newTestDate }]);
      setNewTestName("");
      setNewTestSubject("Math");
      setNewTestDate("");
    }
  };

  const deleteTest = (index) => setUpcomingTests((prev) => prev.filter((_, i) => i !== index));

  /* ---------------------- Mastery + Adaptive Selection ---------------------- */
  const getProgressEntry = (type, key) => {
    const k = (key || "").toLowerCase();
    return progress?.[type]?.[k] || { attempts: 0, correct: 0, streak: 0, lastSeen: 0 };
  };

  const scoreItemForReview = (type, key) => {
    const p = getProgressEntry(type, key);
    const accuracy = p.attempts > 0 ? p.correct / p.attempts : 0;

    const recencyPenalty = p.lastSeen
      ? Math.min(1, (Date.now() - p.lastSeen) / (1000 * 60 * 60 * 24 * 7))
      : 1;

    return (1 - accuracy) * 0.7 + recencyPenalty * 0.3;
  };

  const pickAdaptive = (type, items, count) => {
    const deduped = Array.from(new Map(items.map((x) => [x.toLowerCase(), x])).values());
    if (deduped.length <= count) return deduped;

    return deduped
      .map((item) => ({ item, s: scoreItemForReview(type, item) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, count)
      .map((x) => x.item);
  };

  const recordAttempt = (type, key, wasCorrect) => {
    const k = (key || "").toLowerCase();
    setProgress((prev) => {
      const next = { ...prev, [type]: { ...(prev[type] || {}) } };
      const cur = next[type][k] || { attempts: 0, correct: 0, streak: 0, lastSeen: 0 };

      const attempts = cur.attempts + 1;
      const correct = cur.correct + (wasCorrect ? 1 : 0);
      const streak = wasCorrect ? cur.streak + 1 : 0;

      next[type][k] = { attempts, correct, streak, lastSeen: Date.now() };
      return next;
    });
  };

  /* ---------------------- Gamification helpers ---------------------- */
  const handleGameEvent = (event) => {
    if (event.type === "complete" && event.domain) {
      setCompletedGamesThisSession((prev) => {
        if (!prev.includes(event.domain)) {
          setKeys((k) => k + 1);
          return [...prev, event.domain];
        }
        return prev;
      });
    }
  };

  const openChest = (chestType) => {
    if (keys >= chestType.keysRequired) {
      setKeys((k) => k - chestType.keysRequired);
      setSelectedChest(chestType);
      setShowChestModal(true);
    }
  };

  const handleRewardReceived = (reward) => {
    setInventory((prev) => {
      const existing = prev.find((item) => item.id === reward.id);
      if (existing) {
        setPoints((p) => p + 50);
        return prev;
      }
      return [...prev, { ...reward, dateReceived: new Date().toISOString() }];
    });
  };

  /* -------------------------- CSV Import ------------------------- */
  const importStructuredCSV = async (file) => {
    const text = await file.text();
    const rows = parseCSV(text);

    if (rows.length < 2) return { ok: false, message: "CSV has no data rows." };

    const header = rows[0].map((h) => normalize(h).toLowerCase());
    const idxAny = (names) => {
      for (const n of names) {
        const i = header.indexOf(n);
        if (i !== -1) return i;
      }
      return -1;
    };
    const getCell = (row, colIndex) => (colIndex === -1 ? "" : row[colIndex] ?? "");

    const recordTypeIdx = idxAny(["record_type", "type", "recordtype"]);
    if (recordTypeIdx === -1) return { ok: false, message: "Missing required column: record_type" };

    const listTypeIdx = idxAny(["list_type", "list", "category"]);
    const termIdx = idxAny(["term", "word", "item"]);
    const defIdx = idxAny(["definition", "def", "meaning"]);
    const patternIdx = idxAny(["pattern", "phonics_pattern", "grapheme", "sound_pattern"]);

    const testNameIdx = idxAny(["test_name", "quiz_name", "assessment_name", "name"]);
    const testSubjectIdx = idxAny(["test_subject", "subject", "class"]);
    const testDateIdx = idxAny(["test_date", "date", "due_date"]);

    const settingKeyIdx = idxAny(["setting_key", "key"]);
    const settingValueIdx = idxAny(["setting_value", "value"]);

    const notesIdx = idxAny(["notes", "teacher_notes", "note"]);

    const splitPatterns = (raw) =>
      (raw || "")
        .split(";")
        .map((x) => normalize(x).toLowerCase())
        .filter(Boolean);

    let nextWeekly = { ...weeklyGames };
    let nextNotes = teacherNotes;

    const nextSight = [...customSightWords];
    const nextSpell = [...customSpellingWords];
    const nextVocab = [...customVocabWords];
    const nextPhonics = [...customPhonicsWords];
    const nextTests = [...upcomingTests];

    const sightSet = new Set(nextSight.map((x) => x.toLowerCase()));
    const spellSet = new Set(nextSpell.map((x) => x.toLowerCase()));
    const vocabSet = new Set(nextVocab.map((x) => (x.word || "").toLowerCase()));

    const phonicsKey = (w, p) => `${(w || "").trim().toLowerCase()}|${(p || "unknown").trim().toLowerCase()}`;
    const phonicsSet = new Set(nextPhonics.map((x) => phonicsKey(x.word, x.pattern)));

    const testKey = (t) =>
      `${(t.name || "").trim().toLowerCase()}|${(t.subject || "").trim().toLowerCase()}|${(t.date || "").trim()}`;
    const testSet = new Set(nextTests.map(testKey));

    const summary = {
      processedRows: 0,
      byType: { ITEM: 0, TEST: 0, SETTING: 0, NOTES: 0, UNKNOWN: 0 },
      added: { sight: 0, spelling: 0, vocab: 0, phonics: 0, tests: 0, settings: 0, notes: 0 },
      skipped: { itemDup: 0, testDup: 0, missingFields: 0, unknownType: 0 },
    };

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      summary.processedRows += 1;

      const recordType = normalize(getCell(row, recordTypeIdx)).toUpperCase();
      const listType = normalize(getCell(row, listTypeIdx)).toLowerCase();
      const term = normalize(getCell(row, termIdx));
      const def = normalize(getCell(row, defIdx));
      const patternRaw = normalize(getCell(row, patternIdx)) || def;

      const testName = normalize(getCell(row, testNameIdx));
      const testSubject = normalize(getCell(row, testSubjectIdx));
      const testDate = normalize(getCell(row, testDateIdx));

      const settingKey = normalize(getCell(row, settingKeyIdx)).toLowerCase();
      const settingValue = normalize(getCell(row, settingValueIdx));

      const notes = getCell(row, notesIdx) ?? "";

      if (!recordType) {
        summary.skipped.missingFields += 1;
        continue;
      }

      if (recordType === "NOTES") {
        summary.byType.NOTES += 1;
        if (normalize(notes)) {
          nextNotes = notes.toString();
          summary.added.notes += 1;
        } else summary.skipped.missingFields += 1;
        continue;
      }

      if (recordType === "SETTING") {
        summary.byType.SETTING += 1;
        if (!settingKey) {
          summary.skipped.missingFields += 1;
          continue;
        }

        const vNum = Number(settingValue);
        let applied = false;

        if (settingKey === "sight_per_day" && Number.isFinite(vNum)) {
          nextWeekly.sightPerDay = clampInt(vNum, 1, 50, 5);
          applied = true;
        }
        if (settingKey === "spelling_per_day" && Number.isFinite(vNum)) {
          nextWeekly.spellingPerDay = clampInt(vNum, 1, 50, 5);
          applied = true;
        }
        if (settingKey === "vocab_per_day" && Number.isFinite(vNum)) {
          nextWeekly.vocabPerDay = clampInt(vNum, 1, 50, 3);
          applied = true;
        }
        if (settingKey === "phonics_per_day" && Number.isFinite(vNum)) {
          nextWeekly.phonicsPerDay = clampInt(vNum, 1, 50, 8);
          applied = true;
        }
        if (settingKey === "smart_phonics_mode") {
          const v = (settingValue || "").toString().trim().toLowerCase();
          nextWeekly.smartPhonicsMode = v === "1" || v === "true" || v === "yes" || v === "on";
          applied = true;
        }
        if (settingKey === "math_problems_per_day" && Number.isFinite(vNum)) {
          nextWeekly.mathProblemsPerDay = clampInt(vNum, 1, 50, 5);
          applied = true;
        }
        if (settingKey === "math_topic" && settingValue) {
          nextWeekly.mathTopic = settingValue;
          applied = true;
        }

        if (applied) summary.added.settings += 1;
        else summary.skipped.missingFields += 1;

        continue;
      }

      if (recordType === "ITEM") {
        summary.byType.ITEM += 1;
        if (!term) {
          summary.skipped.missingFields += 1;
          continue;
        }

        if (listType === "sight") {
          const k = term.toLowerCase();
          if (!sightSet.has(k)) {
            nextSight.push(term);
            sightSet.add(k);
            summary.added.sight += 1;
          } else summary.skipped.itemDup += 1;
        } else if (listType === "spelling") {
          const k = term.toLowerCase();
          if (!spellSet.has(k)) {
            nextSpell.push(term);
            spellSet.add(k);
            summary.added.spelling += 1;
          } else summary.skipped.itemDup += 1;
        } else if (listType === "vocab") {
          const k = term.toLowerCase();
          if (!vocabSet.has(k)) {
            nextVocab.push({ word: term, def });
            vocabSet.add(k);
            summary.added.vocab += 1;
          } else summary.skipped.itemDup += 1;
        } else if (listType === "phonics") {
          const provided = splitPatterns(patternRaw);
          const inferred = !provided.length && nextWeekly.smartPhonicsMode ? inferPhonicsPatterns(term) : [];
          const finalPatterns = provided.length ? provided : inferred.length ? inferred : ["unknown"];

          for (const pat of finalPatterns) {
            const k = phonicsKey(term, pat);
            if (!phonicsSet.has(k)) {
              nextPhonics.push({ word: term, pattern: pat });
              phonicsSet.add(k);
              summary.added.phonics += 1;
            } else summary.skipped.itemDup += 1;
          }
        } else {
          summary.skipped.unknownType += 1;
        }
        continue;
      }

      if (recordType === "TEST") {
        summary.byType.TEST += 1;

        if (!testName || !testDate) {
          summary.skipped.missingFields += 1;
          continue;
        }

        const newTest = { name: testName, subject: testSubject || "Math", date: testDate };
        const k = testKey(newTest);

        if (!testSet.has(k)) {
          nextTests.push(newTest);
          testSet.add(k);
          summary.added.tests += 1;
        } else summary.skipped.testDup += 1;

        continue;
      }

      summary.byType.UNKNOWN += 1;
      summary.skipped.unknownType += 1;
    }

    setWeeklyGames(nextWeekly);
    setTeacherNotes(nextNotes);
    setCustomSightWords(nextSight);
    setCustomSpellingWords(nextSpell);
    setCustomVocabWords(nextVocab);
    setCustomPhonicsWords(nextPhonics);
    setUpcomingTests(nextTests);

    const message =
      "Import complete.\n\n" +
      `Rows processed: ${summary.processedRows}\n` +
      `Records: ITEM ${summary.byType.ITEM}, TEST ${summary.byType.TEST}, SETTING ${summary.byType.SETTING}, NOTES ${summary.byType.NOTES}\n\n` +
      "Added:\n" +
      `  Sight: ${summary.added.sight}\n` +
      `  Spelling: ${summary.added.spelling}\n` +
      `  Vocab: ${summary.added.vocab}\n` +
      `  Phonics: ${summary.added.phonics}\n` +
      `  Tests: ${summary.added.tests}\n` +
      `  Settings applied: ${summary.added.settings}\n` +
      `  Notes updated: ${summary.added.notes}\n\n` +
      "Skipped:\n" +
      `  Duplicate items: ${summary.skipped.itemDup}\n` +
      `  Duplicate tests: ${summary.skipped.testDup}\n` +
      `  Missing required fields: ${summary.skipped.missingFields}\n` +
      `  Unknown or invalid rows: ${summary.skipped.unknownType}`;

    return { ok: true, message, summary };
  };

  /* ------------------------- Parents: add items ------------------------- */
  const addSightWord = () => {
    const w = newSightWord.trim();
    if (!w) return;
    setCustomSightWords((prev) => {
      const set = new Set(prev.map((x) => x.toLowerCase()));
      if (set.has(w.toLowerCase())) return prev;
      return [...prev, w];
    });
    setNewSightWord("");
  };

  const addSpellingWord = () => {
    const w = newSpellingWord.trim();
    if (!w) return;
    setCustomSpellingWords((prev) => {
      const set = new Set(prev.map((x) => x.toLowerCase()));
      if (set.has(w.toLowerCase())) return prev;
      return [...prev, w];
    });
    setNewSpellingWord("");
  };

  const addVocabWord = () => {
    const w = newVocabWord.trim();
    if (!w) return;

    setCustomVocabWords((prev) => {
      const set = new Set(prev.map((x) => (x.word || "").toLowerCase()));
      if (set.has(w.toLowerCase())) return prev;
      return [...prev, { word: w, def: newVocabDef.trim() }];
    });

    setNewVocabWord("");
    setNewVocabDef("");
  };

  const addPhonicsWord = () => {
    const w = newPhonicsWord.trim();
    const raw = newPhonicsPattern.trim();
    if (!w) return;

    const provided = raw
      .split(";")
      .map((x) => normalize(x).toLowerCase())
      .filter(Boolean);

    const inferred = !provided.length && weeklyGames.smartPhonicsMode ? inferPhonicsPatterns(w) : [];
    const finalPatterns = provided.length ? provided : inferred.length ? inferred : ["unknown"];

    setCustomPhonicsWords((prev) => {
      const keyFn = (word, pat) => `${word.toLowerCase()}|${pat.toLowerCase()}`;
      const set = new Set(prev.map((x) => keyFn((x.word || "").trim(), (x.pattern || "unknown").trim())));

      const next = [...prev];
      for (const pat of finalPatterns) {
        const k = keyFn(w, pat);
        if (!set.has(k)) {
          next.push({ word: w, pattern: pat });
          set.add(k);
        }
      }
      return next;
    });

    setNewPhonicsWord("");
    setNewPhonicsPattern("");
  };

  const deleteFromList = (type, index) => {
    if (type === "sight") setCustomSightWords((prev) => prev.filter((_, i) => i !== index));
    if (type === "spelling") setCustomSpellingWords((prev) => prev.filter((_, i) => i !== index));
    if (type === "vocab") setCustomVocabWords((prev) => prev.filter((_, i) => i !== index));
    if (type === "phonics") setCustomPhonicsWords((prev) => prev.filter((_, i) => i !== index));
  };

  const groupByPattern = (words) =>
    (words || []).reduce((acc, item) => {
      const p = (item.pattern || "unknown").toLowerCase();
      if (!acc[p]) acc[p] = [];
      acc[p].push(item);
      return acc;
    }, {});

  /* ------------------------------ Today's Games ------------------------------ */
  const startTodaysGames = () => {
    const sightSource = customSightWords.length ? customSightWords : DEFAULT_SIGHT_DECK.map((x) => x.word);
    const spellingSource = customSpellingWords;
    const vocabSource = customVocabWords.map((x) => x.word);
    const phonicsSource = customPhonicsWords.map((x) => x.word);

    const pickedSight = pickAdaptive("sight", sightSource, clampInt(weeklyGames.sightPerDay, 1, 50, 5));
    const pickedSpell = pickAdaptive("spelling", spellingSource, clampInt(weeklyGames.spellingPerDay, 1, 50, 5));
    const pickedVocab = pickAdaptive("vocab", vocabSource, clampInt(weeklyGames.vocabPerDay, 1, 50, 3));
    const pickedPhonics = pickAdaptive("phonics", phonicsSource, clampInt(weeklyGames.phonicsPerDay, 1, 50, 8));

    setTodayItems({ sight: pickedSight, spelling: pickedSpell, vocab: pickedVocab, phonics: pickedPhonics });
    setTodayGameIndex(0);
    setTodayCardIndex(0);
    setShowFlashcardAnswer(false);
    setCompletedGamesThisSession([]);
    setCurrentView("today");
  };

  const gameTitle = (gameKey) => {
    if (gameKey === "sight") return "Sight Word Sprint";
    if (gameKey === "spelling") return "Spelling Challenge";
    if (gameKey === "vocab") return "Vocabulary Builder";
    if (gameKey === "phonics") return "Sound Jumper";
    if (gameKey === "math") return "Math Race";
    return "Game";
  };

  const renderTodaysGames = () => {
    const seq = weeklyGames.sequence || ["sight", "spelling", "vocab", "phonics", "math"];
    const gameKey = seq[todayGameIndex];
    const title = gameTitle(gameKey);

    const deck =
      gameKey === "sight"
        ? todayItems.sight.map((w) => ({ word: w }))
        : gameKey === "spelling"
        ? todayItems.spelling.map((w) => ({ word: w }))
        : gameKey === "vocab"
        ? todayItems.vocab.map((w) => {
            const found = customVocabWords.find((x) => (x.word || "").toLowerCase() === w.toLowerCase());
            return { word: w, def: found?.def || "" };
          })
        : [];

    const current = deck[todayCardIndex];

    const nextGame = () => {
      handleGameEvent({ type: "complete", domain: gameKey });

      if (todayGameIndex < seq.length - 1) {
        setTodayGameIndex((n) => n + 1);
        setTodayCardIndex(0);
        setShowFlashcardAnswer(false);
      } else {
        setCurrentView("home");
      }
    };

    const nextCardOrGame = () => {
      if (todayCardIndex < deck.length - 1) {
        setTodayCardIndex((n) => n + 1);
        setShowFlashcardAnswer(false);
      } else {
        nextGame();
      }
    };

    const progressLabel = () => {
      if (gameKey === "math" || gameKey === "phonics") return `Game ${todayGameIndex + 1} of ${seq.length}`;
      return `Card ${todayCardIndex + 1} of ${deck.length} | Game ${todayGameIndex + 1} of ${seq.length}`;
    };

    return (
      <div className="max-w-4xl mx-auto">
        <BackButton onClick={() => setCurrentView("home")} label="Back to Home" className="mb-6" />

        <div className="bg-white rounded-3xl shadow-md border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="text-3xl font-extrabold text-gray-900">Today's Games</h1>
              <p className="text-gray-600">
                Now playing: <strong>{title}</strong>
              </p>
              <p className="text-sm text-gray-500 mt-1">{progressLabel()}</p>

              {teacherNotes && (
                <div className="mt-3 bg-purple-50 border border-purple-100 rounded-2xl p-3 text-sm text-gray-800">
                  <span className="font-extrabold text-purple-800">Teacher note:</span> {teacherNotes}
                </div>
              )}
            </div>

            <div className="text-right">
              <div className="text-sm text-gray-600 font-semibold">Stars</div>
              <div className="text-2xl font-extrabold text-gray-900">{points}</div>
              <div className="text-sm text-gray-600 font-semibold mt-2">Keys</div>
              <div className="text-xl font-extrabold text-yellow-600">{keys}</div>
            </div>
          </div>

          {gameKey === "phonics" ? (
            <div className="mt-4">
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
                <p className="text-gray-800">
                  Mode: <strong>Sound Jumper</strong>
                </p>
                <p className="text-gray-700 mt-1">
                  Target: <strong>{weeklyGames.phonicsPerDay}</strong> jumps
                  {weeklyGames.smartPhonicsMode ? <span className="text-gray-500"> | Smart Mode ON</span> : null}
                </p>
              </div>

              <button
                onClick={() => {
                  setSelectedGame("Sound Jumper");
                  setCurrentView("game");
                }}
                className="w-full mt-4 bg-gradient-to-r from-pink-500 to-purple-500 hover:opacity-95 text-white font-extrabold py-4 rounded-2xl"
              >
                Start Sound Jumper
              </button>

              <button
                onClick={nextGame}
                className="w-full mt-3 bg-gray-100 hover:bg-gray-200 text-gray-900 font-extrabold py-3 rounded-2xl"
              >
                Skip Phonics for now
              </button>
            </div>
          ) : gameKey === "math" ? (
            <div className="mt-4">
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
                <p className="text-gray-800">
                  Mode: <strong>{weeklyGames.mathTopic}</strong>
                </p>
                <p className="text-gray-700 mt-1">
                  Target: <strong>{weeklyGames.mathProblemsPerDay}</strong> rounds
                </p>
              </div>

              <button
                onClick={() => {
                  setSelectedGame("Math Race");
                  setCurrentView("game");
                }}
                className="w-full mt-4 bg-gradient-to-r from-pink-500 to-purple-500 hover:opacity-95 text-white font-extrabold py-4 rounded-2xl"
              >
                Start Math Race
              </button>

              <button
                onClick={nextGame}
                className="w-full mt-3 bg-gray-100 hover:bg-gray-200 text-gray-900 font-extrabold py-3 rounded-2xl"
              >
                Skip Math for now
              </button>
            </div>
          ) : deck.length === 0 ? (
            <div className="mt-4 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-gray-700">
              No cards for this game yet. Add items on the Parents Page or import a CSV.
              <button
                onClick={nextGame}
                className="mt-4 w-full bg-gray-900 text-white font-extrabold py-3 rounded-2xl hover:opacity-95"
              >
                Next Game
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <div
                onClick={() => setShowFlashcardAnswer((s) => !s)}
                className="bg-white rounded-3xl border border-purple-200 p-10 cursor-pointer hover:bg-purple-50 transition min-h-[320px] flex flex-col items-center justify-center"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    speak(current.word);
                  }}
                  className="mb-6 bg-purple-700 text-white p-4 rounded-full hover:bg-purple-800 shadow-sm"
                  aria-label="Speak"
                >
                  <Volume2 size={32} />
                </button>

                <h2 className="text-6xl font-extrabold text-purple-800 mb-4 text-center">{current.word}</h2>

                {showFlashcardAnswer && gameKey === "vocab" && (
                  <p className="text-xl text-gray-700 italic text-center">
                    {current.def ? current.def : "No definition yet. Add one on Parents Page."}
                  </p>
                )}

                <p className="text-sm text-gray-500 mt-6">Tap to flip the card.</p>
              </div>

              <div className="grid md:grid-cols-2 gap-3 mt-4">
                <button
                  onClick={() => {
                    recordAttempt(gameKey, current.word, false);
                    setPoints((p) => p + 1);
                    nextCardOrGame();
                  }}
                  className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 font-extrabold py-3 rounded-2xl"
                >
                  Missed
                </button>

                <button
                  onClick={() => {
                    recordAttempt(gameKey, current.word, true);
                    setPoints((p) => p + 3);
                    nextCardOrGame();
                  }}
                  className="bg-green-50 hover:bg-green-100 border border-green-200 text-green-800 font-extrabold py-3 rounded-2xl"
                >
                  Got it
                </button>
              </div>

              <button
                onClick={nextCardOrGame}
                className="w-full mt-3 bg-gray-100 hover:bg-gray-200 text-gray-900 font-extrabold py-3 rounded-2xl"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ------------------------------- Flashcards ------------------------------ */
  const flashcardDeck = useMemo(() => {
    if (flashcardMode === "sight") {
      const list = customSightWords.length ? customSightWords : DEFAULT_SIGHT_DECK.map((x) => x.word);
      return list.map((w) => ({ word: w, sentence: "" }));
    }
    if (flashcardMode === "spelling") return customSpellingWords.map((w) => ({ word: w }));
    if (flashcardMode === "vocab") return customVocabWords.map((v) => ({ word: v.word, def: v.def }));
    return [];
  }, [flashcardMode, customSightWords, customSpellingWords, customVocabWords]);

  const renderFlashcards = () => {
    if (!flashcardMode) {
      return (
        <div className="max-w-4xl mx-auto">
          <BackButton onClick={() => setCurrentView("home")} label="Back to Home" className="mb-6" />

          <h1 className="text-3xl font-extrabold text-gray-900 mb-6 text-center">Choose Flashcards</h1>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              { key: "sight", title: "Sight Words", desc: "Quick, high-frequency practice." },
              { key: "spelling", title: "Spelling", desc: "Weekly list review." },
              { key: "vocab", title: "Vocabulary", desc: "Word plus definition." },
            ].map((c) => (
              <button
                key={c.key}
                onClick={() => {
                  setFlashcardMode(c.key);
                  setCurrentFlashcard(0);
                  setShowFlashcardAnswer(false);
                }}
                className="bg-white rounded-3xl border border-gray-200 shadow-md p-6 text-left hover:bg-purple-50"
              >
                <div className="flex items-center gap-3 mb-2">
                  <BookOpen className="text-purple-800" />
                  <div className="text-xl font-extrabold text-gray-900">{c.title}</div>
                </div>
                <div className="text-gray-600 text-sm">{c.desc}</div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    const deck = flashcardDeck;
    const card = deck[currentFlashcard];

    if (!deck.length) {
      return (
        <div className="max-w-2xl mx-auto">
          <BackButton
            onClick={() => {
              setFlashcardMode(null);
              setCurrentFlashcard(0);
              setShowFlashcardAnswer(false);
            }}
            className="mb-6"
          />

          <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-6 text-gray-800">
            No cards found. Add items on the Parents Page or import a CSV.
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-2xl mx-auto">
        <BackButton
          onClick={() => {
            setFlashcardMode(null);
            setCurrentFlashcard(0);
            setShowFlashcardAnswer(false);
          }}
          className="mb-6"
        />

        <div className="text-center mb-4 text-sm text-gray-600">
          Card {currentFlashcard + 1} of {deck.length}
        </div>

        <div
          onClick={() => setShowFlashcardAnswer((s) => !s)}
          className="bg-white rounded-3xl shadow-md border border-gray-200 p-10 cursor-pointer hover:bg-purple-50 transition min-h-[340px] flex flex-col items-center justify-center"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              speak(card.word);
            }}
            className="mb-6 bg-purple-700 text-white p-4 rounded-full hover:bg-purple-800 shadow-sm"
          >
            <Volume2 size={32} />
          </button>

          <h2 className="text-6xl font-extrabold text-purple-800 mb-4 text-center">{card.word}</h2>

          {showFlashcardAnswer && flashcardMode === "vocab" && (
            <p className="text-xl text-gray-700 italic text-center">{card.def || "No definition yet."}</p>
          )}
        </div>

        <div className="flex gap-3 mt-4">
          <button
            onClick={() => {
              setCurrentFlashcard((n) => Math.max(0, n - 1));
              setShowFlashcardAnswer(false);
            }}
            disabled={currentFlashcard === 0}
            className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-900 font-extrabold py-3 rounded-2xl"
          >
            Previous
          </button>

          <button
            onClick={() => {
              setCurrentFlashcard((n) => Math.min(deck.length - 1, n + 1));
              setShowFlashcardAnswer(false);
              setPoints((p) => p + 1);
            }}
            disabled={currentFlashcard === deck.length - 1}
            className="flex-1 bg-purple-700 hover:bg-purple-800 disabled:bg-purple-200 text-white font-extrabold py-3 rounded-2xl"
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  /* ------------------------------- My Loot ------------------------------ */
  const renderMyLoot = () => {
    const groupedByType = inventory.reduce((acc, item) => {
      if (!acc[item.type]) acc[item.type] = [];
      acc[item.type].push(item);
      return acc;
    }, {});

    return (
      <div className="max-w-6xl mx-auto">
        <BackButton onClick={() => setCurrentView("home")} label="Back to Home" className="mb-6" />

        <div className="flex items-center gap-3 mb-6">
          <Sparkles className="text-purple-800" size={32} />
          <h1 className="text-4xl font-extrabold text-gray-900">My Loot</h1>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {inventory.length === 0 ? (
            <div className="col-span-full bg-white rounded-3xl shadow-md p-8 border border-gray-200 text-center">
              <Package className="mx-auto text-gray-400 mb-4" size={64} />
              <p className="text-gray-600">No loot yet! Complete games and open chests to build your collection.</p>
            </div>
          ) : (
            Object.entries(groupedByType).map(([type, items]) => (
              <div key={type} className="bg-white rounded-3xl shadow-md p-6 border border-gray-200">
                <h3 className="text-xl font-extrabold text-gray-900 mb-4 capitalize">{type}s</h3>
                <div className="space-y-3">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-2xl border ${
                        item.rarity === "epic"
                          ? "bg-purple-50 border-purple-200"
                          : item.rarity === "rare"
                          ? "bg-blue-50 border-blue-200"
                          : "bg-gray-50 border-gray-200"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-white">
                          <RewardIcon iconName={item.icon} size={32} className="text-purple-700" />
                        </div>
                        <div className="flex-1">
                          <div className="font-extrabold text-gray-900">{item.name}</div>
                          <div className="text-xs text-gray-600 uppercase">{item.rarity}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  /* ------------------------------- Parents Page ------------------------------ */
  const renderParentsPage = () => {
    const grouped = groupByPattern(customPhonicsWords);
    const patterns = Object.keys(grouped).sort();

    return (
      <div className="max-w-6xl mx-auto">
        <BackButton onClick={() => setCurrentView("home")} label="Back to Home" className="mb-6" />

        <h1 className="text-4xl font-extrabold text-gray-900 mb-6 text-center">Parents Page</h1>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* CSV Import */}
          <div className="bg-white rounded-3xl shadow-md p-6 border border-gray-200">
            <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Import Teacher Plan (CSV)</h2>
            <p className="text-gray-600 mb-4">Import a structured CSV to update tests, lists, weekly games, and notes.</p>

            <input
              type="file"
              accept=".csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const res = await importStructuredCSV(file);
                setLastImportSummary(res.ok ? res.summary : null);
                alert(res.message);
                e.target.value = "";
              }}
              className="w-full px-4 py-3 border border-gray-200 rounded-2xl bg-white"
            />

            <div className="mt-4 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm text-gray-700">
              CSV record types:
              <ul className="list-disc ml-5 mt-2">
                <li>
                  <strong>ITEM</strong>: list_type = sight | spelling | vocab | phonics (term, definition for vocab;{" "}
                  <strong>pattern OR definition</strong> for phonics; patterns can be semicolon separated)
                </li>
                <li>
                  <strong>TEST</strong>: test_name (or name), test_subject (or subject), test_date (or date)
                </li>
                <li>
                  <strong>SETTING</strong>: setting_key, setting_value (supports phonics_per_day, smart_phonics_mode)
                </li>
                <li>
                  <strong>NOTES</strong>: notes
                </li>
              </ul>
            </div>

            {lastImportSummary && (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-2xl p-4 text-sm text-green-900">
                <div className="font-extrabold mb-2">Last import summary</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    Rows: <strong>{lastImportSummary.processedRows}</strong>
                  </div>
                  <div>
                    Added tests: <strong>{lastImportSummary.added.tests}</strong>
                  </div>
                  <div>
                    Added sight: <strong>{lastImportSummary.added.sight}</strong>
                  </div>
                  <div>
                    Added spelling: <strong>{lastImportSummary.added.spelling}</strong>
                  </div>
                  <div>
                    Added vocab: <strong>{lastImportSummary.added.vocab}</strong>
                  </div>
                  <div>
                    Added phonics: <strong>{lastImportSummary.added.phonics}</strong>
                  </div>
                  <div>
                    Settings applied: <strong>{lastImportSummary.added.settings}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Weekly Games */}
          <div className="bg-white rounded-3xl shadow-md p-6 border border-purple-200">
            <h2 className="text-2xl font-extrabold text-gray-900 mb-4">Weekly Games</h2>

            <div className="grid md:grid-cols-2 gap-4">
              <label className="text-sm font-semibold text-gray-700">
                Sight words per day
                <input
                  type="number"
                  value={weeklyGames.sightPerDay}
                  min={1}
                  max={50}
                  onChange={(e) => setWeeklyGames((p) => ({ ...p, sightPerDay: clampInt(e.target.value, 1, 50, 5) }))}
                  className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-2xl"
                />
              </label>

              <label className="text-sm font-semibold text-gray-700">
                Spelling words per day
                <input
                  type="number"
                  value={weeklyGames.spellingPerDay}
                  min={1}
                  max={50}
                  onChange={(e) =>
                    setWeeklyGames((p) => ({ ...p, spellingPerDay: clampInt(e.target.value, 1, 50, 5) }))
                  }
                  className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-2xl"
                />
              </label>

              <label className="text-sm font-semibold text-gray-700">
                Vocabulary per day
                <input
                  type="number"
                  value={weeklyGames.vocabPerDay}
                  min={1}
                  max={50}
                  onChange={(e) => setWeeklyGames((p) => ({ ...p, vocabPerDay: clampInt(e.target.value, 1, 50, 3) }))}
                  className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-2xl"
                />
              </label>

              <label className="text-sm font-semibold text-gray-700">
                Phonics jumps per day
                <input
                  type="number"
                  value={weeklyGames.phonicsPerDay}
                  min={1}
                  max={50}
                  onChange={(e) =>
                    setWeeklyGames((p) => ({ ...p, phonicsPerDay: clampInt(e.target.value, 1, 50, 8) }))
                  }
                  className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-2xl"
                />
              </label>

              <label className="text-sm font-semibold text-gray-700 md:col-span-2 flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={!!weeklyGames.smartPhonicsMode}
                  onChange={(e) => setWeeklyGames((p) => ({ ...p, smartPhonicsMode: e.target.checked }))}
                  className="h-4 w-4"
                />
                Smart Phonics Mode (auto-detect patterns when blank)
              </label>

              <label className="text-sm font-semibold text-gray-700">
                Math rounds per day
                <input
                  type="number"
                  value={weeklyGames.mathProblemsPerDay}
                  min={1}
                  max={50}
                  onChange={(e) =>
                    setWeeklyGames((p) => ({ ...p, mathProblemsPerDay: clampInt(e.target.value, 1, 50, 5) }))
                  }
                  className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-2xl"
                />
              </label>

              <label className="text-sm font-semibold text-gray-700 md:col-span-2">
                Math mode
                <select
                  value={weeklyGames.mathTopic}
                  onChange={(e) => setWeeklyGames((p) => ({ ...p, mathTopic: e.target.value }))}
                  className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-2xl"
                >
                  <option value="addition-double">Addition (2-digit)</option>
                  <option value="subtraction-double">Subtraction (2-digit)</option>
                  <option value="addition-triple">Addition (3-digit)</option>
                  <option value="subtraction-triple">Subtraction (3-digit)</option>
                  <option value="line-graphing">Line Graphing</option>
                </select>
              </label>

              <label className="text-sm font-semibold text-gray-700 md:col-span-2">
                Teacher notes
                <textarea
                  value={teacherNotes}
                  onChange={(e) => setTeacherNotes(e.target.value)}
                  rows={3}
                  placeholder="Notes from teacher for this week"
                  className="mt-1 w-full px-4 py-2 border border-gray-200 rounded-2xl"
                />
              </label>
            </div>
          </div>

          {/* Word Lists */}
          <div className="bg-white rounded-3xl shadow-md p-6 border border-gray-200">
            <h2 className="text-2xl font-extrabold text-gray-900 mb-4">Word Lists</h2>

            {/* Sight */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <div className="font-extrabold text-gray-900">Sight Words</div>
                <div className="text-sm text-gray-600">{customSightWords.length} items</div>
              </div>

              <div className="flex gap-2">
                <input
                  value={newSightWord}
                  onChange={(e) => setNewSightWord(e.target.value)}
                  placeholder="Add sight word"
                  className="flex-1 px-4 py-2 border border-gray-200 rounded-2xl"
                />
                <button
                  onClick={addSightWord}
                  className="px-4 py-2 rounded-2xl bg-purple-700 hover:bg-purple-800 text-white font-extrabold"
                  aria-label="Add"
                >
                  <Plus size={18} />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {customSightWords.map((w, i) => (
                  <span
                    key={`${w}-${i}`}
                    className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-full text-sm"
                  >
                    {w}
                    <button
                      onClick={() => deleteFromList("sight", i)}
                      className="text-gray-500 hover:text-gray-900"
                      aria-label="remove"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Spelling */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <div className="font-extrabold text-gray-900">Weekly Spelling Words</div>
                <div className="text-sm text-gray-600">{customSpellingWords.length} items</div>
              </div>

              <div className="flex gap-2">
                <input
                  value={newSpellingWord}
                  onChange={(e) => setNewSpellingWord(e.target.value)}
                  placeholder="Add spelling word"
                  className="flex-1 px-4 py-2 border border-gray-200 rounded-2xl"
                />
                <button
                  onClick={addSpellingWord}
                  className="px-4 py-2 rounded-2xl bg-purple-700 hover:bg-purple-800 text-white font-extrabold"
                  aria-label="Add"
                >
                  <Plus size={18} />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {customSpellingWords.map((w, i) => (
                  <span
                    key={`${w}-${i}`}
                    className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-full text-sm"
                  >
                    {w}
                    <button
                      onClick={() => deleteFromList("spelling", i)}
                      className="text-gray-500 hover:text-gray-900"
                      aria-label="remove"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Vocab */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <div className="font-extrabold text-gray-900">Vocabulary</div>
                <div className="text-sm text-gray-600">{customVocabWords.length} items</div>
              </div>

              <div className="grid md:grid-cols-2 gap-2">
                <input
                  value={newVocabWord}
                  onChange={(e) => setNewVocabWord(e.target.value)}
                  placeholder="Vocab word"
                  className="px-4 py-2 border border-gray-200 rounded-2xl"
                />
                <input
                  value={newVocabDef}
                  onChange={(e) => setNewVocabDef(e.target.value)}
                  placeholder="Definition"
                  className="px-4 py-2 border border-gray-200 rounded-2xl"
                />
              </div>

              <button
                onClick={addVocabWord}
                className="mt-2 w-full px-4 py-2 rounded-2xl bg-purple-700 hover:bg-purple-800 text-white font-extrabold"
              >
                Add Vocabulary
              </button>

              <div className="mt-3 space-y-2">
                {customVocabWords.map((v, i) => (
                  <div
                    key={`${v.word}-${i}`}
                    className="bg-gray-50 border border-gray-200 rounded-2xl p-3 flex items-start justify-between gap-3"
                  >
                    <div>
                      <div className="font-extrabold text-gray-900">{v.word}</div>
                      <div className="text-sm text-gray-700">{v.def || <span className="text-gray-400">No definition</span>}</div>
                    </div>
                    <button
                      onClick={() => deleteFromList("vocab", i)}
                      className="text-gray-500 hover:text-gray-900"
                      aria-label="remove"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Phonics */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-extrabold text-gray-900 flex items-center gap-2">
                  <Zap className="text-purple-800" size={18} /> Phonics (Sound Patterns)
                </div>
                <div className="text-sm text-gray-600">{customPhonicsWords.length} items</div>
              </div>

              <div className="grid md:grid-cols-2 gap-2">
                <input
                  value={newPhonicsWord}
                  onChange={(e) => setNewPhonicsWord(e.target.value)}
                  placeholder="Word (example: ship)"
                  className="px-4 py-2 border border-gray-200 rounded-2xl"
                />
                <input
                  value={newPhonicsPattern}
                  onChange={(e) => setNewPhonicsPattern(e.target.value)}
                  placeholder="Pattern (example: sh or th;sh)"
                  className="px-4 py-2 border border-gray-200 rounded-2xl"
                />
              </div>

              <div className="text-xs text-gray-500 mt-2">
                Tip: Use semicolon for multiple patterns. Leave pattern blank to auto-detect when Smart Mode is on.
              </div>

              <button
                onClick={addPhonicsWord}
                className="mt-2 w-full px-4 py-2 rounded-2xl bg-purple-700 hover:bg-purple-800 text-white font-extrabold"
              >
                Add Phonics Word
              </button>

              <div className="mt-3 space-y-3">
                {patterns.length === 0 ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-3 text-sm text-gray-700">
                    No phonics words yet.
                  </div>
                ) : (
                  patterns.map((p) => (
                    <div key={p} className="bg-gray-50 border border-gray-200 rounded-2xl p-3">
                      <div className="font-extrabold text-gray-900 mb-2">Pattern: {p}</div>
                      <div className="flex flex-wrap gap-2">
                        {grouped[p].map((item, idx) => {
                          const globalIndex = customPhonicsWords.findIndex(
                            (x) =>
                              (x.word || "").toLowerCase() === (item.word || "").toLowerCase() &&
                              (x.pattern || "unknown").toLowerCase() === (item.pattern || "unknown").toLowerCase()
                          );

                          return (
                            <span
                              key={`${item.word}-${idx}`}
                              className="inline-flex items-center gap-2 bg-white border border-gray-200 px-3 py-1.5 rounded-full text-sm"
                            >
                              {item.word}
                              <button
                                onClick={() => globalIndex >= 0 && deleteFromList("phonics", globalIndex)}
                                className="text-gray-500 hover:text-gray-900"
                                aria-label="remove"
                              >
                                <X size={14} />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Tests */}
          <div className="bg-white rounded-3xl shadow-md p-6 border border-gray-200">
            <h2 className="text-2xl font-extrabold text-gray-900 mb-4 flex items-center gap-2">
              <Calendar size={22} className="text-purple-800" />
              Tests and Quizzes
            </h2>

            <div className="space-y-2 mb-4">
              <input
                type="text"
                value={newTestName}
                onChange={(e) => setNewTestName(e.target.value)}
                placeholder="Test / Quiz name"
                className="w-full px-4 py-2 border border-gray-200 rounded-2xl"
              />

              <select
                value={newTestSubject}
                onChange={(e) => setNewTestSubject(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-2xl"
              >
                <option value="Math">Math</option>
                <option value="Language Arts - Spelling">Language Arts - Spelling</option>
                <option value="Language Arts - Reading/Comprehension">Language Arts - Reading/Comprehension</option>
                <option value="Science">Science</option>
                <option value="Social Studies">Social Studies</option>
              </select>

              <input
                type="date"
                value={newTestDate}
                onChange={(e) => setNewTestDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-2xl"
              />

              <button onClick={addTest} className="w-full bg-purple-700 hover:bg-purple-800 text-white font-extrabold py-2 rounded-2xl">
                Add Test/Quiz
              </button>
            </div>

            <div className="space-y-2">
              {upcomingTests
                .slice()
                .sort((a, b) => new Date(a.date) - new Date(b.date))
                .map((test, i) => (
                  <div key={i} className="bg-gray-50 border border-gray-200 rounded-2xl p-3 relative">
                    <button
                      onClick={() => deleteTest(i)}
                      className="absolute top-2 right-2 text-gray-400 hover:text-gray-900"
                      aria-label="delete"
                    >
                      <X size={16} />
                    </button>
                    <p className="font-extrabold text-gray-900">{test.name}</p>
                    <p className="text-sm text-gray-600">{test.subject}</p>
                    <p className="text-sm text-purple-800 font-semibold">
                      {new Date(test.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  /* ---------------------------------- Home --------------------------------- */
  const renderStudentPlanner = () => {
    const upcomingReminders = getUpcomingReminders();

    return (
      <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-5">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="text-purple-800" size={20} />
          <h3 className="text-lg font-extrabold text-gray-900">Student Planner</h3>
        </div>

        {upcomingReminders.length === 0 ? (
          <div className="text-sm text-gray-600">
            No tests or quizzes in the next 7 days.
            <div className="mt-3 text-xs text-gray-500">Add items on the Parents Page or import a CSV.</div>
          </div>
        ) : (
          <div className="space-y-2">
            {upcomingReminders.map((test, i) => {
              const daysUntil = getDaysUntil(test.date);
              const urgency =
                daysUntil === "Today"
                  ? "border-red-300 bg-red-50"
                  : daysUntil === "Tomorrow"
                  ? "border-orange-300 bg-orange-50"
                  : "border-gray-200 bg-gray-50";

              return (
                <div key={i} className={`rounded-2xl p-3 border ${urgency}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-extrabold text-gray-900">{test.name}</div>
                      <div className="text-sm text-gray-600">{test.subject}</div>
                    </div>
                    <div className="text-xs font-extrabold text-gray-900 bg-white border border-gray-200 rounded-full px-2.5 py-1">
                      {daysUntil}
                    </div>
                  </div>

                  <div className="text-xs text-gray-600 mt-2">
                    {new Date(test.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {teacherNotes && (
          <div className="mt-4 bg-purple-50 border border-purple-100 rounded-2xl p-3">
            <div className="text-xs font-extrabold text-purple-900">Teacher note</div>
            <div className="text-sm text-gray-800 mt-1">{teacherNotes}</div>
          </div>
        )}
      </div>
    );
  };

  const renderHome = () => (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900">Hayden's Homework</h1>
          <p className="text-gray-700 font-semibold mt-1">A simple routine that turns practice into progress.</p>
        </div>

        <button
          onClick={() => setCurrentView("parents")}
          className="text-sm text-purple-900 hover:text-purple-950 font-extrabold flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-gray-200"
        >
          <Settings size={16} /> Parents
        </button>
      </div>

      <div className="mb-6 flex gap-3 flex-wrap">
        <IconPill icon={Star} label={`${points} Stars`} className="text-yellow-700" />
        <IconPill icon={Key} label={`${keys} Keys`} className="text-yellow-700" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">{renderStudentPlanner()}</div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-6">
            <div className="flex items-center gap-3 mb-2">
              <Check className="text-purple-800" />
              <div className="text-2xl font-extrabold text-gray-900">Today's Games</div>
            </div>
            <p className="text-gray-600 mb-4">
              A guided set of mini-games based on your weekly settings. Earn keys for each game!
            </p>
            <button
              onClick={startTodaysGames}
              className="w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:opacity-95 text-white font-extrabold py-4 rounded-2xl"
            >
              Start Today's Games
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <Package className="text-purple-800" />
              <div className="text-2xl font-extrabold text-gray-900">Open Chests</div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              {CHEST_TYPES.map((chest) => (
                <button
                  key={chest.id}
                  onClick={() => openChest(chest)}
                  disabled={keys < chest.keysRequired}
                  className={`p-6 rounded-2xl border-2 transition ${
                    keys >= chest.keysRequired
                      ? `bg-gradient-to-br ${chest.color} text-white hover:opacity-90`
                      : "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  <Package className="mx-auto mb-2" size={40} />
                  <div className="font-extrabold text-sm">{chest.name}</div>
                  <div className="text-xs mt-1">{chest.keysRequired} key{chest.keysRequired > 1 ? "s" : ""}</div>
                </button>
              ))}
            </div>

            <button
              onClick={() => setCurrentView("loot")}
              className="w-full bg-purple-100 hover:bg-purple-200 text-purple-900 font-extrabold py-3 rounded-2xl"
            >
              View My Loot ({inventory.length} items)
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-6">
            <div className="flex items-center gap-3 mb-2">
              <BookOpen className="text-purple-800" />
              <div className="text-2xl font-extrabold text-gray-900">Flashcards</div>
            </div>
            <p className="text-gray-600 mb-4">Sight words, spelling, and vocabulary practice.</p>
            <button
              onClick={() => {
                setCurrentView("flashcards");
                setFlashcardMode(null);
                setCurrentFlashcard(0);
                setShowFlashcardAnswer(false);
              }}
              className="w-full bg-gray-900 hover:opacity-95 text-white font-extrabold py-4 rounded-2xl"
            >
              Open Flashcards
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <Gamepad2 className="text-purple-800" />
              <div className="text-2xl font-extrabold text-gray-900">Games</div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { name: "Math Race", icon: Trophy },
                { name: "Sound Jumper", icon: Zap },
                { name: "Obby", icon: Shield },
                { name: "Coming Soon", icon: Sparkles },
              ].map((game) => (
                <button
                  key={game.name}
                  onClick={() => {
                    setSelectedGame(game.name);
                    setCurrentView("game");
                  }}
                  className="bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl p-4 font-extrabold text-gray-900 text-left"
                >
                  <game.icon className="mb-2 text-purple-800" />
                  <div>{game.name}</div>
                </button>
              ))}
            </div>

            <div className="mt-4 text-sm text-gray-600">Tip: Start "Today's Games" for a guided flow with adaptive review.</div>
          </div>
        </div>
      </div>
    </div>
  );

  /* ---------------------------------- Game --------------------------------- */
  const renderGame = () => {
    if (selectedGame === "Sound Jumper") {
      return (
        <SoundJumperGame
          phonicsWords={customPhonicsWords}
          wordsPerSession={weeklyGames.phonicsPerDay}
          smartMode={!!weeklyGames.smartPhonicsMode}
          setPoints={setPoints}
          onBack={() => setCurrentView("today")}
          onComplete={() => setCurrentView("today")}
          onEvent={handleGameEvent}
        />
      );
    }

    if (selectedGame === "Math Race") {
      return (
        <MathRaceGame
          onBack={() => setCurrentView("home")}
          onDone={() => setCurrentView("today")}
          setPoints={setPoints}
          initialTopicId={weeklyGames.mathTopic}
          numProblems={weeklyGames.mathProblemsPerDay}
          autoStart={true}
          onEvent={handleGameEvent}
        />
      );
    }

    if (selectedGame === "Obby") {
      return (
        <ObbyGame
          onBack={() => setCurrentView("home")}
          onComplete={() => setCurrentView("home")}
          setPoints={setPoints}
          onEvent={handleGameEvent}
        />
      );
    }

    return (
      <div className="max-w-4xl mx-auto text-center">
        <BackButton onClick={() => setCurrentView("home")} label="Back to Home" className="mb-6" />

        <div className="bg-white rounded-3xl shadow-md p-10 border border-gray-200">
          <Trophy className="text-yellow-500 mx-auto mb-6" size={64} />
          <h2 className="text-3xl font-extrabold text-gray-900 mb-3">{selectedGame}</h2>
          <p className="text-gray-600 mb-6">Coming soon.</p>
          <p className="text-gray-600">Next step is to wire this to your custom lists and mastery data.</p>
        </div>
      </div>
    );
  };

  /* -------------------------------- Render -------------------------------- */
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-200 via-purple-200 to-pink-300 p-4 md:p-8">
      {currentView === "home" && renderHome()}
      {currentView === "parents" && renderParentsPage()}
      {currentView === "flashcards" && renderFlashcards()}
      {currentView === "today" && renderTodaysGames()}
      {currentView === "game" && renderGame()}
      {currentView === "loot" && renderMyLoot()}

      {showChestModal && selectedChest && (
        <ChestOpeningModal
          chestType={selectedChest}
          onClose={() => {
            setShowChestModal(false);
            setSelectedChest(null);
          }}
          onRewardReceived={handleRewardReceived}
        />
      )}
    </div>
  );
};

export default HomeworkGamesApp;
