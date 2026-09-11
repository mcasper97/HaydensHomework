import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auth } from "./Firebase.js";
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
const DEFAULT_LS_KEY = "haydens_homework_app_v6";

const DEVICE_ID = (() => {
  const key = "haydens_homework_device_id";
  let id = localStorage.getItem(key);
  if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem(key, id); }
  return id;
})();

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
  console.log("=== SPEAK FUNCTION CALLED ===");
  console.log("Text to speak:", text);
  
  if (!("speechSynthesis" in window)) {
    console.error("Speech synthesis not supported");
    return;
  }
  
  // For macOS Chrome, we need to ensure voices are loaded
  let voices = window.speechSynthesis.getVoices();
  
  const speakNow = () => {
    console.log("Creating utterance...");
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Get voices again (they might have loaded)
    voices = window.speechSynthesis.getVoices();
    console.log("Available voices:", voices.length);
    
    // For macOS, explicitly select a Google voice (more reliable than system voices in Chrome)
    if (voices.length > 0) {
      // Try to find Google US English voice first (most reliable in Chrome)
      let voice = voices.find(v => v.name.includes('Google') && v.lang === 'en-US');
      
      // Fallback to any Google voice
      if (!voice) voice = voices.find(v => v.name.includes('Google'));
      
      // Fallback to any en-US voice
      if (!voice) voice = voices.find(v => v.lang === 'en-US');
      
      // Last resort - first voice
      if (!voice) voice = voices[0];
      
      if (voice) {
        utterance.voice = voice;
        console.log("Selected voice:", voice.name, voice.lang);
      }
    }
    
    // Settings that work better on macOS Chrome
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';
    
    utterance.onstart = () => {
      console.log("✅✅✅ SPEECH STARTED! ✅✅✅");
    };
    
    utterance.onend = () => {
      console.log("✅ Speech ended");
    };
    
    utterance.onerror = (e) => {
      console.error("❌ ERROR:", e.error);
    };
    
    console.log("About to call speak()...");
    window.speechSynthesis.speak(utterance);
    console.log("Speak() called. Speaking?", window.speechSynthesis.speaking);
  };
  
  // If voices aren't loaded yet, wait for them
  if (voices.length === 0) {
    console.log("Waiting for voices to load...");
    window.speechSynthesis.onvoiceschanged = () => {
      console.log("Voices loaded!");
      speakNow();
    };
    // Also try after a short delay as fallback
    setTimeout(speakNow, 100);
  } else {
    speakNow();
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

/* ============================== Adventure Sentence Generator ============================== */
const FALLBACK_WORDS = ["cat","dog","run","big","happy","jump","fast","blue","sun","play"];
const SENTENCE_TEMPLATES = [
  w => `The ${w} is so cool!`,
  w => `CG3 can ${w} very fast.`,
  w => `I see a big ${w} here.`,
  w => `Look at the ${w} over there!`,
  w => `A ${w} was waiting for us.`,
  w => `The brave hero found a ${w}.`,
  w => `Can you find the ${w}?`,
];

const generateAdventureSentence = (spellingWords = [], sightWords = [], vocabWords = []) => {
  const pool = [
    ...spellingWords,
    ...sightWords,
    ...vocabWords.map(v => v?.word),
  ].filter(w => w && w.length > 1);
  const targetWord = shuffle(pool.length ? pool : [...FALLBACK_WORDS])[0];
  const sentence = shuffle([...SENTENCE_TEMPLATES])[0](targetWord);
  return { sentence, targetWord };
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
    className={`text-crestly-purple hover:opacity-80 font-semibold inline-flex items-center gap-2 ${className}`}
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

/* ============================== Spelling Swamp Game (Frogger — bottom to top) ============================== */
const SpellingSwampGame = ({
  spellingWords = [],
  wordsPerSession = 5,
  setPoints,
  onBack,
  onComplete,
  onEvent,
  recordAttempt,
}) => {
  // Layout (bottom → top):
  //   START (playerRow 0)
  //   Letter row 0 (playerRow 1)  ← rowData[0]
  //   Obstacle row 0 (playerRow 2) ← rowData[1]
  //   Letter row 1 (playerRow 3)  ← rowData[2]
  //   Obstacle row 1 (playerRow 4) ← rowData[3]
  //   ...
  //   Letter row N-1 (playerRow 2N-1) ← rowData[2N-2]
  //   FINISH (playerRow 2N)
  //
  // Collision ONLY in obstacle rows (even playerRow, 2..2*(N-1)).
  // Tile check ONLY when hopping into a letter row (odd playerRow).
  // resetToStart() has no blockRef guard — called from within hop setTimeout.
  // doHit() guards on blockRef/invRef — called from game loop.

  const GW = 500, GH = 600;
  const PW = 28, PH = 44;
  const TILE_W = 52, TILE_H = 46;

  const hatColor = useRef(["#FF4757","#2ED573","#1E90FF","#FFA502","#FF6B81"][Math.floor(Math.random()*5)]).current;

  const [roundWords, setRoundWords] = useState([]);
  const [wordIdx, setWordIdx] = useState(0);
  const [letterIdx, setLetterIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [lives, setLives] = useState(3);
  const [phase, setPhase] = useState("playing");
  const [feedback, setFeedback] = useState(null);
  const [playerRow, setPlayerRow] = useState(0);
  const [playerX, setPlayerX] = useState(GW / 2 - PW / 2);
  const [isInvincible, setIsInvincible] = useState(false);
  const [walkFrame, setWalkFrame] = useState(0);
  const [hopAnim, setHopAnim] = useState(false);
  // rowData[i]: even i → { type:"letter", tiles:[{letter,isCorrect,x}] }
  //             odd  i → { type:"obstacle", obstacles:[{id,x,speed,type,emoji,w}] }
  const [rowData, setRowData] = useState([]);

  const livesRef = useRef(3);
  const invRef = useRef(false);
  const blockRef = useRef(false);
  const playerRowRef = useRef(0);
  const playerXRef = useRef(GW / 2 - PW / 2);
  const letterIdxRef = useRef(0);
  const phaseRef = useRef("playing");
  const wordIdxRef = useRef(0);
  const roundWordsRef = useRef([]);
  const rowDataRef = useRef([]);
  const numRowsRef = useRef(0); // N = word length
  const rowHRef = useRef(70);
  const frameRef = useRef(0);
  const keysRef = useRef({});

  const OBS_TYPES = [
    { type:"tornado",   emoji:"🌪️", w:38 },
    { type:"fireball",  emoji:"🔥", w:34 },
    { type:"boulder",   emoji:"🪨", w:38 },
    { type:"lightning", emoji:"⚡", w:30 },
    { type:"ghost",     emoji:"👻", w:36 },
    { type:"skull",     emoji:"💀", w:34 },
  ];

  const makeRows = (word) => {
    const W = word.toUpperCase();
    const N = W.length;
    // totalDisplayRows = 2*N + 1 (START + 2N-1 swamp rows + FINISH)
    const rowH = Math.max(44, Math.floor(GH / (2 * N + 1)));
    rowHRef.current = rowH;
    numRowsRef.current = N;
    const rows = [];
    for (let k = 0; k < N; k++) {
      // Letter row k → rowData[2k]
      const correctLetter = W[k];
      const numTiles = Math.min(4, Math.max(3, Math.floor(GW / 115)));
      const wrongPool = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter(l => l !== correctLetter);
      const tileLetters = shuffle([correctLetter, ...shuffle(wrongPool).slice(0, numTiles - 1)]);
      const spacing = GW / numTiles;
      const tiles = tileLetters.map((letter, idx) => ({
        letter, isCorrect: letter === correctLetter,
        x: spacing * idx + (spacing - TILE_W) / 2,
      }));
      rows.push({ type: "letter", tiles });

      if (k < N - 1) {
        // Obstacle row k → rowData[2k+1]
        const dir = k % 2 === 0 ? 1 : -1;
        const baseSpeed = 1.2 + k * 0.18;
        const numObs = 2 + Math.floor(Math.random() * 2);
        const obstacles = Array.from({ length: numObs }, (_, i) => {
          const ot = OBS_TYPES[Math.floor(Math.random() * OBS_TYPES.length)];
          const gap = GW / numObs;
          const startX = dir > 0
            ? -(ot.w + gap * i + Math.random() * 80)
            : GW + gap * i + Math.random() * 80;
          return { id:`o${k}-${i}-${Date.now()}`, x:startX, speed:(baseSpeed + Math.random()*0.5)*dir, ...ot };
        });
        rows.push({ type: "obstacle", obstacles });
      }
    }
    return rows; // length = 2N - 1
  };

  const startWord = (word) => {
    const rows = makeRows(word);
    rowDataRef.current = rows;
    setRowData(rows);
    const initX = GW / 2 - PW / 2;
    setPlayerRow(0); playerRowRef.current = 0;
    setPlayerX(initX); playerXRef.current = initX;
    setLetterIdx(0); letterIdxRef.current = 0;
    blockRef.current = false;
    phaseRef.current = "playing"; setPhase("playing");
    setFeedback(null);
    setTimeout(() => speak(word), 300);
  };

  const buildRound = () => {
    const words = spellingWords.filter(w => w?.trim());
    const count = Math.min(wordsPerSession || 5, words.length);
    const picked = shuffle(words).slice(0, count);
    roundWordsRef.current = picked;
    setRoundWords(picked);
    wordIdxRef.current = 0; setWordIdx(0);
    setScore(0); setCorrectCount(0);
    setLives(3); livesRef.current = 3;
    invRef.current = false; setIsInvincible(false);
    if (picked.length > 0) startWord(picked[0]);
  };

  useEffect(() => { buildRound(); }, []);

  useEffect(() => {
    const id = "swamp4-styles";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
      @keyframes sw4Flash{0%,100%{opacity:1}50%{opacity:0.1}}
      @keyframes sw4HopUp{0%,100%{transform:translateY(0)}40%{transform:translateY(-18px)}}
      @keyframes sw4Spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
      @keyframes sw4Pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.25)}}
      @keyframes sw4Shake{0%,100%{transform:translateX(0)}30%{transform:translateX(-3px)}70%{transform:translateX(3px)}}
    `;
    document.head.appendChild(s);
    return () => { document.getElementById(id)?.remove(); };
  }, []);

  // Called from within hop setTimeout (blockRef already true) — no guard needed
  const resetToStart = (msg) => {
    invRef.current = true; setIsInvincible(true);
    const nl = livesRef.current - 1;
    livesRef.current = nl; setLives(nl);
    speak("Oops!");
    if (nl <= 0) {
      phaseRef.current = "gameOver"; setPhase("gameOver");
      blockRef.current = false;
      return;
    }
    setFeedback({ msg });
    setPlayerRow(0); playerRowRef.current = 0;
    setPlayerX(GW / 2 - PW / 2); playerXRef.current = GW / 2 - PW / 2;
    setLetterIdx(0); letterIdxRef.current = 0;
    setTimeout(() => { setFeedback(null); invRef.current = false; blockRef.current = false; setIsInvincible(false); }, 1400);
  };

  // Called from game loop — guards on blockRef/invRef
  const doHit = (msg) => {
    if (invRef.current || blockRef.current) return;
    blockRef.current = true;
    resetToStart(msg);
  };

  // Game loop
  useEffect(() => {
    if (phase !== "playing") return;
    const loop = setInterval(() => {
      frameRef.current++;
      if (frameRef.current % 10 === 0) setWalkFrame(f => f === 0 ? 1 : 0);

      // Move obstacles — only in obstacle rows
      setRowData(prev => {
        const next = prev.map(row => {
          if (row.type !== "obstacle") return row;
          return {
            ...row,
            obstacles: row.obstacles.map(o => {
              let nx = o.x + o.speed;
              if (o.speed > 0 && nx > GW + 10) nx = -(o.w + Math.random() * 200 + 80);
              if (o.speed < 0 && nx < -(o.w + 10)) nx = GW + Math.random() * 200 + 80;
              return { ...o, x: nx };
            }),
          };
        });
        rowDataRef.current = next;
        return next;
      });

      // Smooth L/R movement from held keys
      if (!blockRef.current) {
        const k = keysRef.current;
        if (k["ArrowLeft"] || k["a"]) {
          const nx = Math.max(0, playerXRef.current - 3.5);
          setPlayerX(nx); playerXRef.current = nx;
        }
        if (k["ArrowRight"] || k["d"]) {
          const nx = Math.min(GW - PW, playerXRef.current + 3.5);
          setPlayerX(nx); playerXRef.current = nx;
        }
      }

      // Collision — ONLY in obstacle rows (even playerRow, 2..2*(N-1))
      if (!invRef.current && !blockRef.current) {
        const pr = playerRowRef.current;
        const N = numRowsRef.current;
        if (pr % 2 === 0 && pr >= 2 && pr <= 2 * (N - 1)) {
          const row = rowDataRef.current[pr - 1]; // rowData index = pr-1 (odd = obstacle)
          if (row && row.type === "obstacle") {
            const px = playerXRef.current;
            for (const obs of row.obstacles) {
              if (px + PW - 4 > obs.x + 4 && px + 4 < obs.x + obs.w - 4) {
                doHit(`${obs.emoji} Watch out!`); break;
              }
            }
          }
        }
      }
    }, 1000 / 60);
    return () => clearInterval(loop);
  }, [phase]);

  const doHopUp = () => {
    if (blockRef.current || phaseRef.current !== "playing") return;
    const pr = playerRowRef.current;
    const N = numRowsRef.current;
    const finishRow = 2 * N;
    if (pr >= finishRow) return;
    const nextRow = pr + 1;
    blockRef.current = true;
    setHopAnim(true);

    if (nextRow === finishRow) {
      // Word complete!
      setTimeout(() => {
        setHopAnim(false);
        setPlayerRow(nextRow); playerRowRef.current = nextRow;
        blockRef.current = false;
        phaseRef.current = "wordWin"; setPhase("wordWin");
        setScore(s => s + 20); setPoints(p => p + 10); setCorrectCount(c => c + 1);
        if (recordAttempt) recordAttempt("spelling", roundWordsRef.current[wordIdxRef.current], true);
        if (onEvent) onEvent({ type:"correct", domain:"spelling" });
        speak("Amazing!");
      }, 220);
      return;
    }

    // Even nextRow = obstacle row → just hop in, unblock immediately
    if (nextRow % 2 === 0) {
      setTimeout(() => {
        setHopAnim(false);
        setPlayerRow(nextRow); playerRowRef.current = nextRow;
        blockRef.current = false;
      }, 220);
      return;
    }

    // Odd nextRow = letter row → check tile alignment
    const rowInfo = rowDataRef.current[nextRow - 1];
    const px = playerXRef.current;
    const hitTile = rowInfo?.tiles.find(t => px + PW / 2 > t.x && px + PW / 2 < t.x + TILE_W);

    setTimeout(() => {
      setHopAnim(false);
      if (!hitTile) { resetToStart("🌊 Missed!"); return; }
      const snapX = hitTile.x + TILE_W / 2 - PW / 2;
      setPlayerRow(nextRow); playerRowRef.current = nextRow;
      setPlayerX(snapX); playerXRef.current = snapX;
      if (hitTile.isCorrect) {
        const w = (roundWordsRef.current[wordIdxRef.current] || "").toUpperCase();
        speak(w[letterIdxRef.current]);
        letterIdxRef.current++; setLetterIdx(l => l + 1);
        setTimeout(() => { blockRef.current = false; }, 180);
      } else {
        resetToStart("❌ Wrong letter!");
      }
    }, 220);
  };

  const doHopDown = () => {
    if (blockRef.current || playerRowRef.current <= 0) return;
    const nr = playerRowRef.current - 1;
    setPlayerRow(nr); playerRowRef.current = nr;
    if (nr === 0) { setPlayerX(GW / 2 - PW / 2); playerXRef.current = GW / 2 - PW / 2; }
  };

  useEffect(() => {
    const onDown = (e) => {
      keysRef.current[e.key] = true;
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
      if (e.key === "ArrowUp" || e.key === " " || e.key === "w") doHopUp();
      if (e.key === "ArrowDown" || e.key === "s") doHopDown();
    };
    const onUp = (e) => { keysRef.current[e.key] = false; };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, []);

  const nextWord = () => {
    const ni = wordIdxRef.current + 1;
    if (ni >= roundWordsRef.current.length) {
      phaseRef.current = "complete"; setPhase("complete");
      if (onEvent) onEvent({ type:"complete", domain:"spelling" });
    } else {
      wordIdxRef.current = ni; setWordIdx(ni);
      startWord(roundWordsRef.current[ni]);
    }
  };

  // Layout
  const word = (roundWords[wordIdx] || "").toUpperCase();
  const N = word.length;
  const totalDisplayRows = 2 * N + 1;
  const rowH = N > 0 ? Math.max(44, Math.floor(GH / totalDisplayRows)) : 70;
  const getRowTopY = r => GH - (r + 1) * rowH;
  const playerTopY = getRowTopY(playerRow) + (rowH - PH) / 2;

  const obsAnim = (type) => ({
    tornado:   "sw4Spin 0.5s linear infinite",
    fireball:  "sw4Pulse 0.35s ease-in-out infinite",
    lightning: "sw4Shake 0.3s linear infinite",
    ghost:     "sw4Pulse 0.8s ease-in-out infinite",
    skull:     "sw4Shake 0.5s linear infinite",
    boulder:   "none",
  })[type] || "none";

  const renderHero = (x, y) => (
    <div style={{ position:"absolute", left:x, top:y, width:PW, height:PH, zIndex:20, pointerEvents:"none",
      animation: isInvincible ? "sw4Flash 0.15s linear infinite" : hopAnim ? "sw4HopUp 0.28s ease-out" : "none" }}>
      <div style={{ position:"absolute", left:2, top:-6, width:24, height:7, background:hatColor, borderRadius:"3px 3px 0 0" }}/>
      <div style={{ position:"absolute", left:2, top:0, width:24, height:22, background:"linear-gradient(135deg,#FFDE7A,#F0C040)", borderRadius:4, border:"2px solid #C8971E" }}>
        <div style={{ position:"absolute", left:3, top:3, width:5, height:5, borderRadius:"50%", background:"rgba(255,255,255,0.55)" }}/>
        <div style={{ position:"absolute", left:4, top:8, width:4, height:4, borderRadius:"50%", background:"#111" }}/>
        <div style={{ position:"absolute", left:13, top:8, width:4, height:4, borderRadius:"50%", background:"#111" }}/>
        <div style={{ position:"absolute", left:6, top:16, width:9, height:2, background:"#111", borderRadius:"0 0 4px 4px" }}/>
      </div>
      <div style={{ position:"absolute", left:4, top:22, width:20, height:14, background:"linear-gradient(to bottom,#3B7AFF,#1E4FCC)", border:"2px solid #1230A0", borderRadius:2 }}/>
      <div style={{ position:"absolute", left:0, top:23, width:4, height:13, background:"linear-gradient(to bottom,#FFDE7A,#F0C040)", border:"2px solid #C8971E", borderRadius:2, transform:walkFrame===1?"rotate(-15deg)":"rotate(15deg)", transformOrigin:"top center" }}/>
      <div style={{ position:"absolute", left:24, top:23, width:4, height:13, background:"linear-gradient(to bottom,#FFDE7A,#F0C040)", border:"2px solid #C8971E", borderRadius:2, transform:walkFrame===1?"rotate(15deg)":"rotate(-15deg)", transformOrigin:"top center" }}/>
      <div style={{ position:"absolute", left:5, top:30, width:7, height:12, background:"linear-gradient(to bottom,#3A7A3A,#1E5A1E)", border:"2px solid #0E3A0E", borderRadius:2, transform:walkFrame===0?"rotate(-10deg)":"rotate(10deg)", transformOrigin:"top center" }}/>
      <div style={{ position:"absolute", left:16, top:30, width:7, height:12, background:"linear-gradient(to bottom,#3A7A3A,#1E5A1E)", border:"2px solid #0E3A0E", borderRadius:2, transform:walkFrame===0?"rotate(10deg)":"rotate(-10deg)", transformOrigin:"top center" }}/>
    </div>
  );

  const btn = { background:"rgba(255,255,255,0.18)", color:"white", border:"2px solid rgba(255,255,255,0.3)", borderRadius:12, padding:"12px 18px", fontWeight:900, fontSize:18, cursor:"pointer", minWidth:52, touchAction:"none" };

  if (spellingWords.length === 0) return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0a3d0a,#1a5c2a)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:"white", borderRadius:24, padding:32, maxWidth:360, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:60, marginBottom:12 }}>🐸</div>
        <h2 style={{ fontWeight:900, fontSize:24, marginBottom:12 }}>Spelling Swamp</h2>
        <p style={{ color:"#666", marginBottom:24 }}>Ask a parent to add spelling words!</p>
        <button onClick={onBack} style={{ width:"100%", background:"#1a1a1a", color:"white", fontWeight:900, padding:16, borderRadius:16, border:"none", cursor:"pointer" }}>Back</button>
      </div>
    </div>
  );

  if (phase === "complete") return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0a3d0a,#1a5c2a)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:"white", borderRadius:24, padding:32, maxWidth:360, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:60, marginBottom:12 }}>🏆</div>
        <h2 style={{ fontWeight:900, fontSize:28, marginBottom:8 }}>Swamp Cleared!</h2>
        <p style={{ fontSize:18, color:"#555", marginBottom:4 }}>{correctCount} / {roundWords.length} words</p>
        <p style={{ fontSize:24, fontWeight:900, color:"#16a34a", marginBottom:24 }}>+{score} points</p>
        <div style={{ display:"flex", gap:12 }}>
          <button onClick={buildRound} style={{ flex:1, background:"#16a34a", color:"white", fontWeight:900, padding:16, borderRadius:16, border:"none", cursor:"pointer" }}>Play Again</button>
          <button onClick={onComplete} style={{ flex:1, background:"linear-gradient(to right,#FF5F1F,#5B2D8E)", color:"white", fontWeight:900, padding:16, borderRadius:16, border:"none", cursor:"pointer" }}>Done!</button>
        </div>
      </div>
    </div>
  );

  if (phase === "gameOver") return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0a3d0a,#1a5c2a)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:"white", borderRadius:24, padding:32, maxWidth:360, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:60, marginBottom:12 }}>💀</div>
        <h2 style={{ fontWeight:900, fontSize:28, marginBottom:8 }}>Game Over!</h2>
        <p style={{ color:"#555", marginBottom:24 }}>Score: {score} pts</p>
        <div style={{ display:"flex", gap:12 }}>
          <button onClick={buildRound} style={{ flex:1, background:"#7C3AED", color:"white", fontWeight:900, padding:16, borderRadius:16, border:"none", cursor:"pointer" }}>Try Again</button>
          <button onClick={onComplete} style={{ flex:1, background:"#f3f4f6", color:"#111", fontWeight:900, padding:16, borderRadius:16, border:"none", cursor:"pointer" }}>Exit</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0a3d0a,#1a5c2a)", display:"flex", flexDirection:"column", alignItems:"center", padding:"10px 8px" }}>
      {/* HUD */}
      <div style={{ width:"100%", maxWidth:GW, display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", color:"white", border:"none", borderRadius:10, padding:"7px 14px", fontWeight:700, cursor:"pointer", fontSize:14 }}>← Back</button>
        <div style={{ display:"flex", gap:4, fontSize:20 }}>{[1,2,3].map(i=><span key={i} style={{ opacity:i<=lives?1:0.2, transition:"opacity 0.3s" }}>❤️</span>)}</div>
        <div style={{ background:"rgba(255,255,255,0.15)", color:"white", borderRadius:10, padding:"7px 14px", fontWeight:900, fontSize:14 }}>⭐ {score}</div>
      </div>

      {/* Word progress */}
      <div style={{ marginBottom:8, textAlign:"center" }}>
        <div style={{ display:"flex", gap:5, justifyContent:"center", marginBottom:5 }}>
          {word.split("").map((letter, i) => (
            <div key={i} style={{ width:36, height:40, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:8, fontWeight:900, fontSize:20,
              background: i < letterIdx ? "#22c55e" : i === letterIdx ? "#fbbf24" : "rgba(255,255,255,0.15)",
              color: i < letterIdx ? "white" : i === letterIdx ? "#1a1a1a" : "rgba(255,255,255,0.45)",
              border: i === letterIdx ? "2px solid #f59e0b" : "2px solid transparent",
              boxShadow: i === letterIdx ? "0 0 12px rgba(251,191,36,0.7)" : "none",
              transition:"all 0.3s" }}>
              {i < letterIdx ? "✓" : letter}
            </div>
          ))}
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", alignItems:"center" }}>
          <button onClick={() => speak(roundWords[wordIdx])} style={{ background:"rgba(255,255,255,0.15)", color:"white", border:"none", borderRadius:20, padding:"4px 14px", fontSize:12, cursor:"pointer", fontWeight:600 }}>🔊 Hear</button>
          <span style={{ color:"rgba(255,255,255,0.55)", fontSize:12 }}>Word {wordIdx+1}/{roundWords.length}</span>
        </div>
      </div>

      {/* Game area */}
      <div style={{ position:"relative", width:GW, height:GH, borderRadius:16, overflow:"hidden",
        border:"3px solid rgba(255,255,255,0.15)", boxShadow:"0 20px 60px rgba(0,0,0,0.5)", background:"#071f0e" }}>

        {/* FINISH zone */}
        <div style={{ position:"absolute", left:0, right:0, top:0, height:rowH,
          background:"linear-gradient(to bottom,#FFD700,#FFA500)",
          display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
          <span style={{ fontSize:18 }}>🏁</span>
          <span style={{ fontWeight:900, color:"#7A3D00", fontSize:14 }}>FINISH — HOP HERE!</span>
        </div>

        {/* Swamp rows — rowData[i] = playerRow i+1 */}
        {rowData.map((row, ri) => {
          const rowNum = ri + 1;
          const rowTopY = getRowTopY(rowNum);
          const isLetterRow = row.type === "letter";
          // Letter row k = rowData[2k], so k = ri/2. Past when letterIdx > k.
          const isPastLetter = isLetterRow && (ri / 2) < letterIdx;
          return (
            <div key={ri} style={{ position:"absolute", left:0, right:0, top:rowTopY, height:rowH,
              background: isLetterRow ? "rgba(0,65,22,0.92)" : "rgba(110,35,0,0.78)",
              borderTop:"1px solid rgba(255,255,255,0.06)", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>

              {isLetterRow ? (
                <>
                  <div style={{ position:"absolute", left:6, top:"50%", transform:"translateY(-50%)",
                    color:"rgba(255,255,255,0.22)", fontSize:11, fontWeight:700 }}>
                    {`#${Math.floor(ri/2)+1}`}
                  </div>
                  {row.tiles.map((tile, ti) => (
                    <div key={ti} style={{ position:"absolute", left:tile.x, top:(rowH-TILE_H)/2,
                      width:TILE_W, height:TILE_H, borderRadius:10, zIndex:5,
                      background: isPastLetter && tile.isCorrect ? "#22c55e" : "linear-gradient(135deg,#8B5E3C,#5c3a18)",
                      border:`2px solid ${isPastLetter && tile.isCorrect ? "#15803d" : "rgba(255,255,255,0.2)"}`,
                      boxShadow:"0 3px 12px rgba(0,0,0,0.5)",
                      display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <span style={{ fontSize:22, fontWeight:900, color:"white", textShadow:"1px 1px 0 rgba(0,0,0,0.6)" }}>
                        {isPastLetter && tile.isCorrect ? "✓" : tile.letter}
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <div style={{ position:"absolute", right:6, top:"50%", transform:"translateY(-50%)",
                    color:"rgba(255,160,0,0.45)", fontSize:13, fontWeight:900 }}>
                    {row.obstacles[0]?.speed > 0 ? "→" : "←"}
                  </div>
                  {row.obstacles.map(obs => (
                    <div key={obs.id} style={{ position:"absolute", left:obs.x, top:(rowH-obs.w)/2,
                      width:obs.w, height:obs.w, zIndex:6,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize: obs.w * 0.72,
                      filter:"drop-shadow(0 2px 10px rgba(255,80,0,0.85))",
                      animation: obsAnim(obs.type) }}>
                      {obs.emoji}
                    </div>
                  ))}
                </>
              )}
            </div>
          );
        })}

        {/* START zone */}
        <div style={{ position:"absolute", left:0, right:0, bottom:0, height:rowH,
          background:"linear-gradient(to top,#2d7a40,#1a5c2a)", borderTop:"3px solid #3a8a2a",
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          <span style={{ color:"rgba(255,255,255,0.5)", fontSize:11, fontWeight:700 }}>START — ALIGN WITH CORRECT LETTER THEN HOP ▲</span>
        </div>

        {/* Player */}
        {renderHero(playerX, playerTopY)}

        {/* Feedback overlay */}
        {feedback && (
          <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
            background:"rgba(180,20,20,0.96)", color:"white", fontWeight:900, fontSize:17,
            padding:"12px 22px", borderRadius:14, boxShadow:"0 4px 20px rgba(0,0,0,0.6)", zIndex:30, whiteSpace:"nowrap" }}>
            {feedback.msg}
          </div>
        )}

        {/* Word win overlay */}
        {phase === "wordWin" && (
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, zIndex:40 }}>
            <div style={{ fontSize:52 }}>🎉</div>
            <div style={{ color:"#FFD700", fontWeight:900, fontSize:26, textShadow:"2px 2px 0 rgba(0,0,0,0.5)" }}>"{roundWords[wordIdx]}" Spelled!</div>
            <div style={{ color:"rgba(255,255,255,0.8)", fontWeight:700, fontSize:15 }}>+20 pts ⭐</div>
            <button onClick={nextWord} style={{ background:"linear-gradient(to right,#FF5F1F,#5B2D8E)", color:"white", fontWeight:900, fontSize:17, padding:"12px 32px", borderRadius:16, border:"none", cursor:"pointer", marginTop:8 }}>
              {wordIdx+1 < roundWords.length ? "Next Word →" : "Finish! 🏆"}
            </button>
          </div>
        )}
      </div>

      {/* Touch controls */}
      <div style={{ marginTop:10, display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
        <button onPointerDown={doHopUp} style={{ ...btn, background:"#16a34a", padding:"12px 48px", fontSize:16 }}>▲ HOP UP</button>
        <div style={{ display:"flex", gap:8 }}>
          <button onPointerDown={() => { keysRef.current["ArrowLeft"]=true; }} onPointerUp={() => { keysRef.current["ArrowLeft"]=false; }} onPointerLeave={() => { keysRef.current["ArrowLeft"]=false; }} style={btn}>◀</button>
          <button onPointerDown={doHopDown} style={{ ...btn, fontSize:13, padding:"10px 18px" }}>▼ Back</button>
          <button onPointerDown={() => { keysRef.current["ArrowRight"]=true; }} onPointerUp={() => { keysRef.current["ArrowRight"]=false; }} onPointerLeave={() => { keysRef.current["ArrowRight"]=false; }} style={btn}>▶</button>
        </div>
      </div>
    </div>
  );
};

/* ============================== Phonics is Falling ============================== */
const PhonicsIsFallingGame = ({
  customPhonicsWords = [],
  wordsPerSession = 5,
  setPoints,
  onBack,
  onComplete,
  onEvent,
  recordAttempt,
}) => {
  const buildQueue = () => {
    const items = customPhonicsWords
      .filter(entry => entry && (typeof entry === "object" ? entry.word : entry))
      .map(entry => {
        if (typeof entry === "object") {
          return { word: (entry.word || "").trim().toLowerCase(), pattern: (entry.pattern || "").trim() };
        }
        const parts = (entry || "").split(";");
        return { word: parts[0].trim().toLowerCase(), pattern: parts[1]?.trim() || "" };
      })
      .filter(e => e.word.length > 0);
    return shuffle(items).slice(0, wordsPerSession);
  };

  const [phase, setPhase] = useState("playing");
  const [wordQueue] = useState(() => buildQueue());
  const [wordIndex, setWordIndex] = useState(0);
  const [slots, setSlots] = useState([]);
  const [tiles, setTiles] = useState([]);
  const [lives, setLives] = useState(3);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [shakeSlots, setShakeSlots] = useState(false);
  const [wordFeedback, setWordFeedback] = useState(null);
  const [wordsCorrect, setWordsCorrect] = useState(0);
  const [flashTile, setFlashTile] = useState(null);

  const nextSlotRef = useRef(0);
  const wordRef = useRef("");
  const spawnRef = useRef(null);
  const timerRef = useRef(null);
  const tileIdRef = useRef(0);
  const wordStartRef = useRef(Date.now());
  const streakRef = useRef(0);

  // CSS keyframe injection
  useEffect(() => {
    const styleId = "phonics-falling-styles";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes tilefall {
        from { top: -60px; }
        to   { top: 110%;  }
      }
      @keyframes slotshake {
        0%,100% { transform: translateX(0); }
        20% { transform: translateX(-6px); }
        40% { transform: translateX(6px); }
        60% { transform: translateX(-4px); }
        80% { transform: translateX(4px); }
      }
      @keyframes correctpop {
        0%   { transform: scale(1);   }
        50%  { transform: scale(1.2); }
        100% { transform: scale(1);   }
      }
    `;
    document.head.appendChild(style);
    return () => document.getElementById("phonics-falling-styles")?.remove();
  }, []);

  const initWord = useCallback((entry) => {
    wordRef.current = entry.word.toLowerCase();
    nextSlotRef.current = 0;
    setSlots(entry.word.split("").map(l => ({ letter: l, filled: false })));
    setTiles([]);
    setTimeLeft(30);
    wordStartRef.current = Date.now();
    setWordFeedback(null);
    setFlashTile(null);
    window.speechSynthesis?.cancel();
    setTimeout(() => speak(entry.word), 500);
  }, []);

  useEffect(() => {
    if (wordQueue[wordIndex]) initWord(wordQueue[wordIndex]);
  }, [wordIndex, wordQueue, initWord]);

  const advanceWord = useCallback((wasCorrect) => {
    clearInterval(spawnRef.current);
    clearInterval(timerRef.current);
    setTiles([]);
    if (wasCorrect) {
      const elapsed = (Date.now() - wordStartRef.current) / 1000;
      const speedBonus = Math.max(0, Math.floor((30 - elapsed) * 2));
      const newStreak = streakRef.current + 1;
      streakRef.current = newStreak;
      const streakBonus = newStreak % 5 === 0 ? 50 : 0;
      const pts = 20 + speedBonus + streakBonus;
      setScore(s => s + pts);
      setPoints(p => p + Math.floor(pts / 5));
      setWordsCorrect(c => c + 1);
      setStreak(newStreak);
      setWordFeedback("correct");
    } else {
      streakRef.current = 0;
      setStreak(0);
      setWordFeedback("timeout");
    }
    setTimeout(() => {
      setWordIndex(i => {
        if (i + 1 >= wordQueue.length) { setPhase("done"); return i; }
        return i + 1;
      });
    }, 1400);
  }, [wordQueue, setPoints]);

  const handleTileClick = useCallback((tileId, letter) => {
    if (wordFeedback) return;
    const word = wordRef.current;
    const nextIdx = nextSlotRef.current;
    if (nextIdx >= word.length) return;
    if (letter === word[nextIdx]) {
      const newNextIdx = nextIdx + 1;
      nextSlotRef.current = newNextIdx;
      setSlots(prev => prev.map((s, i) => i === nextIdx ? { ...s, filled: true } : s));
      setTiles(prev => prev.filter(t => t.id !== tileId));
      if (newNextIdx >= word.length) advanceWord(true);
    } else {
      setFlashTile(tileId);
      setTimeout(() => setFlashTile(null), 500);
      setShakeSlots(true);
      setTimeout(() => setShakeSlots(false), 500);
      setLives(l => {
        if (l <= 1) { advanceWord(false); return 0; }
        return l - 1;
      });
    }
  }, [wordFeedback, advanceWord]);

  const spawnTile = useCallback(() => {
    const word = wordRef.current;
    if (!word || nextSlotRef.current >= word.length) return;
    let letter;
    if (Math.random() < 0.55) {
      letter = word[Math.floor(Math.random() * word.length)];
    } else {
      const alpha = "abcdefghijklmnopqrstuvwxyz";
      do { letter = alpha[Math.floor(Math.random() * 26)]; } while (word.includes(letter));
    }
    const x = 5 + Math.random() * 80;
    const duration = 2.5 + Math.random() * 2;
    const id = ++tileIdRef.current;
    setTiles(prev => [...prev.slice(-20), { id, letter, x, duration }]);
    setTimeout(() => setTiles(prev => prev.filter(t => t.id !== id)), (duration + 0.3) * 1000);
  }, []);

  useEffect(() => {
    if (phase !== "playing") return;
    spawnRef.current = setInterval(spawnTile, 700);
    return () => clearInterval(spawnRef.current);
  }, [phase, wordIndex, spawnTile]);

  useEffect(() => {
    if (phase !== "playing") return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); advanceWord(false); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase, wordIndex, advanceWord]);

  const currentEntry = wordQueue[wordIndex];
  const hint = currentEntry?.pattern;
  const currentWordDisplay = currentEntry?.word || "";

  if (phase === "done") {
    return (
      <div className="max-w-md mx-auto text-center">
        <BackButton onClick={onBack} label="Back" className="mb-6" />
        <div className="bg-white rounded-3xl shadow-lg p-8 border border-green-200">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Nice Work!</h2>
          <p className="text-gray-600 mb-4">{wordsCorrect} / {wordQueue.length} words built</p>
          <div className="text-4xl font-extrabold text-green-600 mb-6">{score} pts</div>
          <button
            onClick={onComplete}
            className="w-full bg-green-500 hover:bg-green-600 text-white font-extrabold py-3 rounded-2xl text-lg transition"
          >
            Continue →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <BackButton onClick={onBack} label="Back" className="mb-4" />

      {/* Header */}
      <div className="flex justify-between items-center mb-3">
        <div className="flex gap-1">
          {[0, 1, 2].map(i => (
            <span key={i} className={`text-2xl ${i < lives ? "" : "opacity-20"}`}>❤️</span>
          ))}
        </div>
        <div className={`text-2xl font-extrabold ${timeLeft <= 10 ? "text-red-600" : "text-gray-700"}`}>
          ⏱ {timeLeft}s
        </div>
        <div className="text-xl font-extrabold text-purple-700">{score} pts</div>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1 mb-4">
        {wordQueue.map((_, i) => (
          <div key={i} className={`h-2 flex-1 rounded-full ${i < wordIndex ? "bg-green-400" : i === wordIndex ? "bg-purple-500" : "bg-gray-200"}`} />
        ))}
      </div>

      {/* Hint */}
      <div className="text-center mb-3">
        {hint && (
          <div className="bg-indigo-100 text-indigo-800 font-extrabold text-2xl px-6 py-2 rounded-2xl inline-block mb-1">
            Pattern: {hint}
          </div>
        )}
        <div className="flex items-center justify-center gap-3 mt-2 mb-1">
          <button
            onClick={() => currentEntry && speak(currentEntry.word)}
            className="inline-flex items-center gap-2 bg-purple-100 hover:bg-purple-200 text-purple-800 font-extrabold px-4 py-2 rounded-2xl text-sm"
          >
            <Volume2 size={16} /> Hear Word
          </button>
        </div>
        <p className="text-gray-500 text-sm">Click the falling letters to spell the word!</p>
      </div>

      {/* Word slots */}
      <div
        className="flex justify-center gap-2 mb-3"
        style={shakeSlots ? { animation: "slotshake 0.5s ease-in-out" } : {}}
      >
        {slots.map((slot, i) => (
          <div
            key={i}
            className={`w-12 h-14 rounded-xl border-4 flex items-center justify-center text-2xl font-extrabold transition-all duration-200
              ${slot.filled
                ? "bg-green-100 border-green-400 text-green-800"
                : "bg-white border-gray-300 text-gray-300"}`}
            style={slot.filled ? { animation: "correctpop 0.3s ease" } : {}}
          >
            {slot.filled ? slot.letter.toUpperCase() : "_"}
          </div>
        ))}
      </div>

      {/* Word feedback */}
      {wordFeedback && (
        <div className={`text-center text-2xl font-extrabold mb-2 ${wordFeedback === "correct" ? "text-green-600" : "text-red-500"}`}>
          {wordFeedback === "correct" ? "🌟 Correct!" : `Time's up! It was: ${currentWordDisplay.toUpperCase()}`}
        </div>
      )}

      {/* Falling sky area */}
      <div
        className="relative bg-gradient-to-b from-sky-300 to-sky-100 rounded-3xl overflow-hidden border-2 border-sky-300"
        style={{ height: 260 }}
      >
        <div className="absolute top-2 left-4 text-3xl opacity-30 select-none">☁️</div>
        <div className="absolute top-4 right-8 text-3xl opacity-20 select-none">☁️</div>
        <div className="absolute top-10 left-1/3 text-2xl opacity-15 select-none">☁️</div>

        {tiles.map(tile => (
          <button
            key={tile.id}
            onClick={() => handleTileClick(tile.id, tile.letter)}
            className={`absolute w-12 h-12 rounded-xl shadow-lg font-extrabold text-2xl flex items-center justify-center border-4 select-none
              ${flashTile === tile.id
                ? "bg-red-400 border-red-600 text-white"
                : "bg-yellow-300 border-yellow-500 text-gray-900 hover:bg-yellow-200 active:scale-95"}`}
            style={{
              left: `${tile.x}%`,
              top: "-60px",
              animation: `tilefall ${tile.duration}s linear forwards`,
              cursor: "pointer",
            }}
          >
            {tile.letter.toUpperCase()}
          </button>
        ))}

        <div className="absolute bottom-0 left-0 right-0 h-5 bg-green-500/50 rounded-b-3xl" />
      </div>

      {/* Streak badge */}
      {streak >= 3 && (
        <div className="text-center mt-2 text-orange-500 font-extrabold text-lg">
          🔥 {streak} in a row!
        </div>
      )}
    </div>
  );
};

/* ============================== World Map Screen ============================== */
const WorldMapScreen = ({
  onBack,
  onLaunchZone,
  worldProgress = {},
  customSightWords = [],
  customSpellingWords = [],
  customVocabWords = [],
  customPhonicsWords = [],
  weeklyGames = {},
}) => {
  const [phase, setPhase] = useState("pipe"); // "pipe" | "map"

  useEffect(() => {
    const styleId = "worldmap-anim-styles";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        @keyframes speedRush {
          0%   { transform: translateY(-120%); opacity: 0; }
          20%  { opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translateY(120%); opacity: 0; }
        }
        @keyframes pipePulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 80px #4ade8066, inset -20px -20px 40px #052e1688; }
          50%      { transform: scale(1.08); box-shadow: 0 0 120px #4ade8099, inset -20px -20px 40px #052e1688; }
        }
        @keyframes dotPulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50%      { transform: scale(1.5); opacity: 1; }
        }
        @keyframes mapReveal {
          0%   { opacity: 0; transform: scale(1.08); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes stopBounce {
          0%   { opacity: 0; transform: scale(0) translateY(-24px); }
          70%  { transform: scale(1.15) translateY(0); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes floatCloud {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(12px); }
        }
      `;
      document.head.appendChild(style);
    }
    return () => document.getElementById("worldmap-anim-styles")?.remove();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setPhase("map"), 2400);
    return () => clearTimeout(t);
  }, []);

  // Build dynamic stops from populated data
  const contentStops = [
    customSightWords?.length > 0 && {
      id: "sight", name: "Sight City", emoji: "👁️",
      color: "#2563EB", bg: "#EFF6FF",
      desc: `${customSightWords.length} words`,
    },
    customSpellingWords?.length > 0 && {
      id: "spelling", name: "Spell Swamp", emoji: "🐸",
      color: "#16A34A", bg: "#F0FDF4",
      desc: `${customSpellingWords.length} words`,
    },
    customVocabWords?.length > 0 && {
      id: "vocab", name: "Vocab Vale", emoji: "📚",
      color: "#7C3AED", bg: "#F5F3FF",
      desc: `${customVocabWords.length} words`,
    },
    customPhonicsWords?.length > 0 && {
      id: "phonics", name: "Phonics Falls", emoji: "🎵",
      color: "#D97706", bg: "#FFFBEB",
      desc: `${customPhonicsWords.length} words`,
    },
    (weeklyGames?.mathProblemsPerDay || 0) > 0 && {
      id: "math", name: "Math Peak", emoji: "⚡",
      color: "#DC2626", bg: "#FFF1F2",
      desc: `${weeklyGames.mathProblemsPerDay} problems`,
    },
  ].filter(Boolean);

  const allStops = [
    { id: "start",  name: "Base Camp", emoji: "🏕️", color: "#6B7280", bg: "#F9FAFB", desc: "" },
    ...contentStops,
    { id: "finish", name: "Victory!",  emoji: "🏆", color: "#F59E0B", bg: "#FFFBEB", desc: "" },
  ];

  // 7 fixed positions along the winding path (SVG viewBox 0 0 400 590)
  const PATH_POSITIONS = [
    { x: 78,  y: 530 },
    { x: 200, y: 455 },
    { x: 310, y: 385 },
    { x: 248, y: 298 },
    { x: 128, y: 212 },
    { x: 298, y: 142 },
    { x: 348, y: 52  },
  ];

  const SVG_PATH =
    "M 78,530 C 78,504 148,478 200,455 " +
    "C 256,430 296,410 310,385 " +
    "C 328,356 304,326 248,298 " +
    "C 192,270 146,252 128,212 " +
    "C 108,170 138,153 200,145 " +
    "C 248,138 280,142 298,142 " +
    "C 326,142 346,78 348,52";

  const n = allStops.length;
  const stopsWithPos = allStops.map((stop, i) => {
    const posIdx = n > 1 ? Math.round(i * 6 / (n - 1)) : 0;
    return { ...stop, ...PATH_POSITIONS[Math.min(posIdx, 6)] };
  });

  const totalStars = Object.values(worldProgress).reduce((s, v) => s + (v || 0), 0);

  /* ── Pipe transition ── */
  if (phase === "pipe") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#080c10", overflow: "hidden" }}>
        {/* Speed lines */}
        {[...Array(22)].map((_, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${(i * 4.6 + 1) % 98}%`,
            top: 0, bottom: 0,
            width: i % 4 === 0 ? 3 : 1,
            background: i % 5 === 0 ? "#A8FF3E" : i % 3 === 0 ? "#5B2D8E" : "#ffffff",
            opacity: 0.15 + (i % 4) * 0.12,
            animation: `speedRush ${0.28 + (i % 6) * 0.07}s ${(i * 0.04) % 0.5}s linear infinite`,
          }} />
        ))}

        {/* Central pipe portal */}
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {/* Outer ring */}
          <div style={{
            width: 200, height: 200, borderRadius: "50%",
            border: "8px solid #2d6a4f",
            boxShadow: "0 0 40px #4ade8044",
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: -100,
          }} />
          {/* Pipe circle */}
          <div style={{
            width: 160, height: 160, borderRadius: "50%",
            background: "radial-gradient(circle at 32% 32%, #4ade80, #16a34a 55%, #052e16)",
            boxShadow: "0 0 80px #4ade8077, inset -18px -18px 36px #052e1699",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 60,
            animation: "pipePulse 0.9s ease-in-out infinite",
            zIndex: 1,
          }}>
            🌀
          </div>

          <p style={{
            marginTop: 32, color: "#A8FF3E",
            fontFamily: "'Fredoka One', cursive", fontSize: 26,
            letterSpacing: 1,
          }}>
            Entering Adventure...
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 11, height: 11, borderRadius: "50%", background: "#A8FF3E",
                animation: `dotPulse 0.7s ${i * 0.22}s ease-in-out infinite`,
              }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Adventure Map ── */
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50, overflowY: "auto",
      background: "linear-gradient(180deg, #87CEEB 0%, #b0e0ff 22%, #3a9e3a 22%, #2d8a2d 100%)",
      animation: "mapReveal 0.7s cubic-bezier(0.34,1.56,0.64,1)",
    }}>

      {/* Sky / clouds */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "22%", pointerEvents: "none", overflow: "hidden" }}>
        {[
          { l: "8%",  t: "18%", w: 90,  h: 32 },
          { l: "5%",  t: "10%", w: 55,  h: 26 },
          { l: "55%", t: "25%", w: 110, h: 38 },
          { l: "52%", t: "14%", w: 65,  h: 28 },
          { l: "75%", t: "30%", w: 70,  h: 26 },
        ].map((c, i) => (
          <div key={i} style={{
            position: "absolute", left: c.l, top: c.t,
            width: c.w, height: c.h,
            borderRadius: c.h,
            background: "rgba(255,255,255,0.85)",
            animation: `floatCloud ${5 + i * 1.4}s ${i * 0.7}s ease-in-out infinite`,
          }} />
        ))}
      </div>

      {/* Header bar */}
      <div style={{
        position: "relative", zIndex: 10,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px",
      }}>
        <button onClick={onBack} style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "rgba(0,0,0,0.45)", color: "white",
          border: "none", borderRadius: 999,
          padding: "8px 16px", fontWeight: 800, fontSize: 14, cursor: "pointer",
        }}>
          ← Back
        </button>
        <div style={{
          background: "rgba(0,0,0,0.45)", color: "#A8FF3E",
          borderRadius: 999, padding: "8px 18px",
          fontFamily: "'Fredoka One', cursive", fontSize: 17,
        }}>
          🗺️ This Week's Adventures!
        </div>
        <div style={{
          background: "#FEF3C7", color: "#92400E",
          borderRadius: 999, padding: "8px 14px",
          fontWeight: 800, fontSize: 14,
        }}>
          ⭐ {totalStars}
        </div>
      </div>

      {/* SVG Map */}
      <div style={{ display: "flex", justifyContent: "center", padding: "0 12px 48px" }}>
        <svg
          viewBox="0 0 400 590"
          style={{ width: "100%", maxWidth: 480, maxHeight: "calc(100vh - 72px)" }}
        >
          {/* Grass texture patches */}
          {[...Array(28)].map((_, i) => (
            <ellipse key={`g${i}`}
              cx={(i * 131 + 20) % 378}
              cy={(i * 97 + 30) % 558}
              rx={7 + (i % 5) * 4} ry={4 + (i % 4) * 2}
              fill="#1a7a2e" opacity="0.25"
            />
          ))}

          {/* Trees scattered around path */}
          {[
            [22, 498], [358, 472], [38, 358], [372, 316], [18, 198],
            [372, 178], [155, 76], [378, 62], [96, 436], [282, 502],
            [340, 250], [50, 270], [200, 80], [310, 500],
          ].map(([tx, ty], i) => (
            <g key={`t${i}`} transform={`translate(${tx},${ty})`}>
              <rect x={-3} y={0}  width={6}  height={16} fill="#6B3F1F" rx={2} />
              <circle cx={0}  cy={-14} r={20} fill="#1e5c3a" />
              <circle cx={-7} cy={-8}  r={13} fill="#2d7a4f" />
              <circle cx={7}  cy={-9}  r={14} fill="#155c30" />
              <circle cx={0}  cy={-22} r={12} fill="#3a9e5f" />
            </g>
          ))}

          {/* Flower decorations */}
          {[[60,420],[340,340],[170,160],[80,110],[310,470]].map(([fx,fy],i)=>(
            <g key={`f${i}`} transform={`translate(${fx},${fy})`}>
              <circle cx={0} cy={0} r={5} fill={["#FF6B6B","#FFD93D","#FF6B9D","#C77DFF","#4ECDC4"][i]} />
              <circle cx={0} cy={-7} r={3} fill={["#FF6B6B","#FFD93D","#FF6B9D","#C77DFF","#4ECDC4"][i]} opacity="0.7" />
              <circle cx={6}  cy={3}  r={3} fill={["#FF6B6B","#FFD93D","#FF6B9D","#C77DFF","#4ECDC4"][i]} opacity="0.7" />
              <circle cx={-6} cy={3}  r={3} fill={["#FF6B6B","#FFD93D","#FF6B9D","#C77DFF","#4ECDC4"][i]} opacity="0.7" />
            </g>
          ))}

          {/* Trail shadow */}
          <path d={SVG_PATH} fill="none" stroke="rgba(0,0,0,0.18)"
            strokeWidth={24} strokeLinecap="round" strokeLinejoin="round"
            transform="translate(5,6)" />
          {/* Trail base (dark edge) */}
          <path d={SVG_PATH} fill="none" stroke="#a0713a"
            strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" />
          {/* Trail main fill */}
          <path d={SVG_PATH} fill="none" stroke="#D4A574"
            strokeWidth={18} strokeLinecap="round" strokeLinejoin="round" />
          {/* Trail highlight */}
          <path d={SVG_PATH} fill="none" stroke="#e8c99a"
            strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
          {/* Trail center dashes */}
          <path d={SVG_PATH} fill="none" stroke="#b8895a"
            strokeWidth={2.5} strokeLinecap="round" strokeDasharray="10 18" opacity="0.6" />

          {/* Stops */}
          {stopsWithPos.map((stop, i) => {
            const stars = worldProgress[stop.id] || 0;
            const clickable = stop.id !== "start" && stop.id !== "finish";
            return (
              <g key={stop.id}
                onClick={() => clickable && onLaunchZone(stop.id)}
                style={{
                  cursor: clickable ? "pointer" : "default",
                  animation: `stopBounce 0.55s ${0.35 + i * 0.14}s cubic-bezier(0.34,1.56,0.64,1) both`,
                }}
              >
                {/* Pole */}
                <rect x={stop.x - 2.5} y={stop.y - 34} width={5} height={62}
                  fill="#7B5E2A" rx={2.5} opacity="0.9" />

                {/* Drop shadow */}
                <ellipse cx={stop.x + 3} cy={stop.y + 34} rx={26} ry={8}
                  fill="rgba(0,0,0,0.18)" />

                {/* Outer ring (glow for clickable) */}
                {clickable && (
                  <circle cx={stop.x} cy={stop.y} r={37}
                    fill="none" stroke={stop.color} strokeWidth={2} opacity="0.3" />
                )}

                {/* Main circle shadow */}
                <circle cx={stop.x + 3} cy={stop.y + 4} r={32} fill="rgba(0,0,0,0.2)" />
                {/* Main circle */}
                <circle cx={stop.x} cy={stop.y} r={32} fill={stop.bg}
                  stroke={stop.color} strokeWidth={4} />
                <circle cx={stop.x} cy={stop.y} r={27} fill={stop.bg} />

                {/* Inner gradient overlay */}
                <circle cx={stop.x - 8} cy={stop.y - 8} r={10}
                  fill="white" opacity="0.3" />

                {/* Emoji */}
                <text x={stop.x} y={stop.y + 9}
                  textAnchor="middle" fontSize={26} dominantBaseline="middle"
                  style={{ userSelect: "none" }}>
                  {stop.emoji}
                </text>

                {/* Stars */}
                {[0, 1, 2].map(si => (
                  <text key={si}
                    x={stop.x - 16 + si * 16} y={stop.y - 42}
                    textAnchor="middle" fontSize={11}>
                    {si < stars ? "⭐" : "☆"}
                  </text>
                ))}

                {/* Name label */}
                <rect x={stop.x - 46} y={stop.y + 36}
                  width={92} height={21} rx={10.5}
                  fill={stop.color} opacity="0.93" />
                <text x={stop.x} y={stop.y + 51}
                  textAnchor="middle" fontSize={9.5} fill="white" fontWeight="800"
                  style={{ fontFamily: "'Baloo 2', cursive" }}>
                  {stop.name}
                </text>

                {/* Desc / count */}
                {stop.desc ? (
                  <text x={stop.x} y={stop.y + 67}
                    textAnchor="middle" fontSize={8.5} fill={stop.color} fontWeight="700">
                    {stop.desc}
                  </text>
                ) : null}

                {/* Tap hint */}
                {clickable && (
                  <text x={stop.x} y={stop.y + 79}
                    textAnchor="middle" fontSize={7.5} fill="rgba(0,0,0,0.45)">
                    tap to play
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

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
              Back to Today's Quest
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
              Back to Today's Quest
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

/* ============================== Sight Word Obby Game ============================== */
const SightWordObbyGame = ({ onBack, onComplete, setPoints, onEvent, customSightWords }) => {
  const [gameState, setGameState] = useState("playing"); // playing | won | lost
  const [playerY, setPlayerY] = useState(400);
  const [playerX, setPlayerX] = useState(100);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [velocity, setVelocity] = useState(0);
  const [isJumping, setIsJumping] = useState(false);
  const [isOnGround, setIsOnGround] = useState(true);
  const [score, setScore] = useState(0);
  
  const [platforms, setPlatforms] = useState([]);
  const [obstacles, setObstacles] = useState([]);
  const [coins, setCoins] = useState([]);
  const [collectedCoins, setCollectedCoins] = useState([]);
  const [currentWord, setCurrentWord] = useState(null);
  const [userSpelling, setUserSpelling] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackCorrect, setFeedbackCorrect] = useState(false);

  // Lives & visual upgrade state
  const [lives, setLives] = useState(3);
  const [isInvincible, setIsInvincible] = useState(false);
  const [walkFrame, setWalkFrame] = useState(0);
  const [collectEffect, setCollectEffect] = useState(null); // coin.id of just-collected coin

  // Refs for game-loop stale-closure avoidance
  const livesRef = useRef(3);
  const isInvincibleRef = useRef(false);
  const frameCounterRef = useRef(0);
  const hatColor = useRef(["#FF4757", "#2ED573", "#1E90FF", "#FFA502", "#FF6B81"][Math.floor(Math.random() * 5)]).current;

  const GRAVITY = 0.7;
  const JUMP_FORCE = -14;
  const PLAYER_WIDTH = 32;
  const PLAYER_HEIGHT = 48;
  const MOVE_SPEED = 2.5; // Slowed down from 3.5
  const GAME_WIDTH = 800;
  const GAME_HEIGHT = 500;
  const GROUND_Y = 430;
  const PLATFORM_HEIGHT = 15;
  const COIN_SIZE = 36;
  const OBSTACLE_WIDTH = 30;
  const OBSTACLE_HEIGHT = 35;
  const LEVEL_LENGTH = 7000; // Extended level length

  const PLATFORM_COLORS = [
    { main: "#E74C3C", light: "#FF6B6B", dark: "#C0392B" },
    { main: "#3498DB", light: "#5DADE2", dark: "#2471A3" },
    { main: "#27AE60", light: "#52BE80", dark: "#1E8449" },
    { main: "#F39C12", light: "#F7DC6F", dark: "#D68910" },
  ];

  // Inject CSS keyframes for game animations
  useEffect(() => {
    const styleId = "obby-game-styles";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes coinBob {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-6px); }
      }
      @keyframes hitFlash {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.25; }
      }
      @keyframes burstFade {
        0% { opacity: 0; transform: scale(0); }
        35% { opacity: 1; transform: scale(1.3); }
        100% { opacity: 0; transform: scale(0.6) translateY(-8px); }
      }
    `;
    document.head.appendChild(style);
    return () => { const el = document.getElementById(styleId); if (el) el.remove(); };
  }, []);

  // Initialize speech synthesis voices
  useEffect(() => {
    if ('speechSynthesis' in window) {
      // Load voices
      const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        console.log(`Loaded ${voices.length} voices`);
      };

      // Some browsers load voices async
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }

      loadVoices();
    }
  }, []);

  // Generate level with platforms, obstacles, and coins
  useEffect(() => {
    const sightWords = customSightWords && customSightWords.length > 0 
      ? customSightWords 
      : ["the", "and", "is", "you", "to", "it", "in", "that", "have", "for"];
    
    const wordList = sightWords.slice(0, 8).map(w => typeof w === "string" ? w : w.word || "word");
    
    const newPlatforms = [];
    const newObstacles = [];
    const newCoins = [];
    
    let currentX = 500; // Start obstacles even further ahead of player
    
    wordList.forEach((word, wordIndex) => {
      // Decide if coin will be on ground (0) or platform (1)
      const coinOnGround = wordIndex % 2 === 0;
      
      // Reduced to 2-4 obstacles before each coin (was 3-5)
      const numObstacles = 2 + Math.floor(Math.random() * 3);
      
      for (let i = 0; i < numObstacles; i++) {
        // All obstacles on ground level - easier for kids
        const obstacleY = GROUND_Y + PLAYER_HEIGHT - OBSTACLE_HEIGHT;
        
        const obstacleType = Math.random() > 0.5 ? "spike" : "block";
        newObstacles.push({
          id: `obs-${wordIndex}-${i}`,
          x: currentX,
          y: obstacleY,
          width: OBSTACLE_WIDTH,
          height: OBSTACLE_HEIGHT,
          type: obstacleType,
        });
        
        // Much more spacing - much easier to navigate
        currentX += 180 + Math.random() * 120; // Increased from 120-200 to 180-300
      }
      
      // Add a blocking obstacle that forces player to take the coin path
      if (coinOnGround) {
        // Coin on ground, so block the platform path
        const blockingPlatform = {
          x: currentX - 50,
          y: GROUND_Y + PLAYER_HEIGHT - 80,
          width: 150,
          height: PLATFORM_HEIGHT,
          level: 1,
        };
        newPlatforms.push(blockingPlatform);
        
        // Add obstacle ON the platform to block it
        newObstacles.push({
          id: `blocker-${wordIndex}`,
          x: currentX + 20,
          y: blockingPlatform.y - OBSTACLE_HEIGHT,
          width: OBSTACLE_WIDTH,
          height: OBSTACLE_HEIGHT,
          type: "block",
        });
        
        // Coin on ground - player must stay low to get it
        newCoins.push({
          id: wordIndex,
          word: word,
          x: currentX + 40,
          y: GROUND_Y + PLAYER_HEIGHT - COIN_SIZE - 10,
          level: 0,
        });
        
        currentX += 250; // Increased from 200
      } else {
        // Coin on platform, so block the ground path
        const platformForCoin = {
          x: currentX - 50,
          y: GROUND_Y + PLAYER_HEIGHT - 80,
          width: 200,
          height: PLATFORM_HEIGHT,
          level: 1,
        };
        newPlatforms.push(platformForCoin);
        
        // Add obstacle on GROUND to force jump to platform
        newObstacles.push({
          id: `blocker-${wordIndex}`,
          x: currentX + 20,
          y: GROUND_Y + PLAYER_HEIGHT - OBSTACLE_HEIGHT,
          width: OBSTACLE_WIDTH,
          height: OBSTACLE_HEIGHT,
          type: "spike",
        });
        
        // Coin on platform - player must jump up to get it
        newCoins.push({
          id: wordIndex,
          word: word,
          x: currentX + 60,
          y: platformForCoin.y - COIN_SIZE - 10,
          level: 1,
        });
        
        currentX += 270; // Increased from 220
      }
      
      // Add more empty space before next word section
      currentX += 200; // Increased from 100
    });
    
    setPlatforms(newPlatforms);
    setObstacles(newObstacles);
    setCoins(newCoins);
  }, [customSightWords]);

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (gameState !== "playing" || currentWord) return;
      
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        jump();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gameState, isOnGround, currentWord]);

  // Game loop
  useEffect(() => {
    if (gameState !== "playing" || currentWord) return;

    const gameLoop = setInterval(() => {
      // Walking animation — toggle every ~6 frames (100ms at 60fps)
      frameCounterRef.current += 1;
      if (frameCounterRef.current % 6 === 0) {
        setWalkFrame((f) => (f + 1) % 2);
      }

      // Apply gravity
      setVelocity((v) => v + GRAVITY);
      
      setPlayerY((y) => {
        const newY = y + velocity;
        let landed = false;
        let platformLandY = null;

        // Ground collision
        if (newY >= GROUND_Y) {
          setVelocity(0);
          setIsJumping(false);
          setIsOnGround(true);
          return GROUND_Y;
        }

        // Platform collisions
        platforms.forEach((platform) => {
          const platformScreenX = platform.x - scrollOffset;

          // Only check platforms near player
          if (platformScreenX > -platform.width && platformScreenX < GAME_WIDTH) {
            const playerBottom = newY + PLAYER_HEIGHT;
            const playerLeft = 200;
            const playerRight = 200 + PLAYER_WIDTH;

            // Check if landing on platform from above
            if (
              velocity >= 0 &&
              playerBottom >= platform.y &&
              playerBottom <= platform.y + PLATFORM_HEIGHT + 5 &&
              playerRight > platform.x - scrollOffset &&
              playerLeft < platform.x - scrollOffset + platform.width
            ) {
              landed = true;
              platformLandY = platform.y - PLAYER_HEIGHT;
              setVelocity(0);
              setIsJumping(false);
              setIsOnGround(true);
            }
          }
        });

        if (platformLandY !== null) return platformLandY;

        if (!landed && newY < GROUND_Y) {
          setIsOnGround(false);
        }

        // Fall off screen — lose a life instead of instant death
        if (newY > GAME_HEIGHT + 100) {
          if (!isInvincibleRef.current) {
            if (livesRef.current <= 1) {
              setGameState("lost");
            } else {
              livesRef.current -= 1;
              setLives(livesRef.current);
              isInvincibleRef.current = true;
              setIsInvincible(true);
              setTimeout(() => { isInvincibleRef.current = false; setIsInvincible(false); }, 1500);
            }
          }
          setVelocity(0);
          setIsOnGround(true);
          return GROUND_Y;
        }

        return newY;
      });

      // Move player forward
      setPlayerX((x) => {
        const newX = x + MOVE_SPEED;
        setScrollOffset(Math.max(0, newX - 200));
        
        // Check win condition
        if (newX > LEVEL_LENGTH) {
          setGameState("won");
          setScore((s) => s + 100);
          setPoints((p) => p + 50);
          onEvent?.({ type: "complete", domain: "sight-word-obby" });
        }
        
        return newX;
      });

      // Check obstacle collisions
      obstacles.forEach((obstacle) => {
        const obsLeft = obstacle.x - scrollOffset;
        const obsRight = obsLeft + obstacle.width;
        const obsTop = obstacle.y;
        const obsBottom = obstacle.y + obstacle.height;
        
        const playerLeft = 200;
        const playerRight = 200 + PLAYER_WIDTH;
        const playerTop = playerY;
        const playerBottom = playerY + PLAYER_HEIGHT;
        
        if (
          playerRight > obsLeft &&
          playerLeft < obsRight &&
          playerBottom > obsTop &&
          playerTop < obsBottom
        ) {
          if (!isInvincibleRef.current) {
            if (livesRef.current <= 1) {
              setGameState("lost");
            } else {
              livesRef.current -= 1;
              setLives(livesRef.current);
              isInvincibleRef.current = true;
              setIsInvincible(true);
              setTimeout(() => { isInvincibleRef.current = false; setIsInvincible(false); }, 1500);
            }
          }
        }
      });

      // Check coin collisions
      coins.forEach((coin) => {
        if (collectedCoins.includes(coin.id)) return;
        
        const coinLeft = coin.x - scrollOffset;
        const coinRight = coinLeft + COIN_SIZE;
        const coinTop = coin.y;
        const coinBottom = coin.y + COIN_SIZE;
        
        const playerLeft = 200;
        const playerRight = 200 + PLAYER_WIDTH;
        const playerTop = playerY;
        const playerBottom = playerY + PLAYER_HEIGHT;
        
        if (
          playerRight > coinLeft &&
          playerLeft < coinRight &&
          playerBottom > coinTop &&
          playerTop < coinBottom
        ) {
          setCollectedCoins((prev) => [...prev, coin.id]);
          setCollectEffect(coin.id);
          setTimeout(() => setCollectEffect((c) => (c === coin.id ? null : c)), 800);
          setCurrentWord(coin.word);
          speak(coin.word); // Auto-play TTS so CG3 hears the word immediately
          setUserSpelling("");
          setShowFeedback(false);
        }
      });
    }, 1000 / 60);

    return () => clearInterval(gameLoop);
  }, [gameState, velocity, playerX, playerY, isOnGround, currentWord, collectedCoins, platforms, obstacles, coins, scrollOffset, setPoints, onEvent]);

  const jump = () => {
    if (isOnGround && gameState === "playing" && !currentWord) {
      setVelocity(JUMP_FORCE);
      setIsJumping(true);
      setIsOnGround(false);
    }
  };

  const handleSpellingSubmit = (e) => {
    e?.preventDefault();
    if (!userSpelling.trim() || !currentWord) return;

    onEvent?.({ type: "attempt", domain: "sight-word-obby" });

    const correct = userSpelling.trim().toLowerCase() === currentWord.toLowerCase();
    
    setFeedbackCorrect(correct);
    setShowFeedback(true);

    if (correct) {
      onEvent?.({ type: "correct", domain: "sight-word-obby" });
      setScore((s) => s + 10);
      setPoints((p) => p + 5);
      speak("Correct!");
    } else {
      setPoints((p) => p + 1);
      speak("Try again");
    }

    setTimeout(() => {
      if (correct) {
        setCurrentWord(null);
        setUserSpelling("");
        setShowFeedback(false);
      } else {
        setShowFeedback(false);
        setUserSpelling("");
      }
    }, correct ? 1000 : 1500);
  };

  const resetGame = () => {
    setGameState("playing");
    setPlayerY(400);
    setPlayerX(100);
    setScrollOffset(0);
    setVelocity(0);
    setIsJumping(false);
    setIsOnGround(true);
    setScore(0);
    setCollectedCoins([]);
    setCurrentWord(null);
    setUserSpelling("");
    setShowFeedback(false);
    // Reset lives & visual state
    setLives(3);
    livesRef.current = 3;
    setIsInvincible(false);
    isInvincibleRef.current = false;
    setWalkFrame(0);
    frameCounterRef.current = 0;
    setCollectEffect(null);
  };

  if (gameState === "won") {
    return (
      <div className="max-w-4xl mx-auto text-center">
        <div style={{ background: "linear-gradient(135deg, #FFD700, #FF6B35, #FF1493)", borderRadius: "24px", padding: "40px", color: "white" }}>
          <div style={{ fontSize: "64px", marginBottom: "16px" }}>⭐ 🏆 ⭐</div>
          <h2 style={{ fontSize: "52px", fontWeight: "900", textShadow: "3px 3px 0 rgba(0,0,0,0.3)", marginBottom: "8px" }}>
            YOU WIN!
          </h2>
          <p style={{ fontSize: "24px", marginBottom: "8px" }}>
            Score: <strong>{score}</strong>
          </p>
          <p style={{ fontSize: "20px", marginBottom: "24px" }}>
            {[1, 2, 3].map((i) => (i <= lives ? "❤️" : "🖤")).join("")} &nbsp;·&nbsp; Words: {collectedCoins.length} / {coins.length}
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={resetGame} style={{ background: "white", color: "#FF6B35", fontWeight: "900", padding: "12px 28px", borderRadius: "16px", border: "none", cursor: "pointer", fontSize: "18px" }}>
              Play Again
            </button>
            <button onClick={onComplete} style={{ background: "rgba(255,255,255,0.25)", color: "white", fontWeight: "900", padding: "12px 28px", borderRadius: "16px", border: "2px solid white", cursor: "pointer", fontSize: "18px" }}>
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
          <div style={{ fontSize: "52px", marginBottom: "12px" }}>💀</div>
          <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Game Over</h2>
          <p className="text-xl text-gray-700 mb-2">Score: <span className="font-bold">{score}</span></p>
          <p className="text-lg text-gray-600 mb-2">Words collected: {collectedCoins.length} / {coins.length}</p>
          {collectedCoins.length > 0 && (
            <p className="text-md font-bold text-green-700 mb-2">
              Great job on: {coins.filter((c) => collectedCoins.includes(c.id)).map((c) => c.word).join(", ")}
            </p>
          )}
          <p className="text-gray-500 mb-6">Keep practicing — you'll get it! 💪</p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button onClick={resetGame} className="bg-purple-700 hover:bg-purple-800 text-white font-bold py-3 px-6 rounded-2xl">
              Try Again
            </button>
            <button onClick={onComplete} className="bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold py-3 px-6 rounded-2xl">
              Back to Games
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Cloud definitions — screen-space positions with parallax depth
  const cloudDefs = [
    { id: 1, baseX: 120, y: 55, w: 130, h: 45, depth: 0.08 },
    { id: 2, baseX: 400, y: 30, w: 100, h: 34, depth: 0.13 },
    { id: 3, baseX: 640, y: 70, w: 150, h: 50, depth: 0.06 },
    { id: 4, baseX: 260, y: 105, w: 80, h: 28, depth: 0.10 },
  ];

  // Burst star positions around coin center
  const burstPositions = [
    { left: "-22px", top: "-22px" },
    { left: "44px", top: "-22px" },
    { left: "-22px", top: "44px" },
    { left: "44px", top: "44px" },
    { left: "11px", top: "-38px" },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <BackButton onClick={onBack} className="mb-6" />

      <div className="bg-white rounded-3xl shadow-md p-6 border border-gray-200">

        {/* ── HUD ── */}
        <div className="mb-4">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
            {/* Hearts (lives) */}
            <div style={{ display: "flex", gap: "4px", fontSize: "24px" }}>
              {[1, 2, 3].map((i) => (
                <span key={i} style={{ opacity: i <= lives ? 1 : 0.2, transition: "opacity 0.3s" }}>❤️</span>
              ))}
            </div>
            {/* Score badge */}
            <div style={{ background: "#7C3AED", color: "white", fontWeight: "900", padding: "4px 18px", borderRadius: "20px", fontSize: "16px" }}>
              ⭐ {score}
            </div>
            {/* Word counter */}
            <div style={{ fontSize: "16px", color: "#555", fontWeight: "bold" }}>
              🪙 {collectedCoins.length} / {coins.length}
            </div>
          </div>
          {/* Progress bar */}
          <div style={{ width: "100%", height: "8px", background: "#E5E7EB", borderRadius: "4px", overflow: "hidden" }}>
            <div style={{
              width: `${Math.min(100, (playerX / LEVEL_LENGTH) * 100)}%`,
              height: "100%",
              background: "linear-gradient(to right, #7C3AED, #EC4899)",
              transition: "width 0.15s",
            }} />
          </div>
        </div>

        {/* ── Game Canvas ── */}
        <div
          className="relative rounded-2xl border-2 border-gray-300 overflow-hidden"
          style={{
            width: GAME_WIDTH,
            height: GAME_HEIGHT,
            margin: "0 auto",
            background: "linear-gradient(to bottom, #87CEEB 0%, #b8e4f9 60%, #d4f0ff 100%)",
            cursor: currentWord ? "default" : "pointer",
          }}
          onClick={currentWord ? undefined : jump}
        >

          {/* Sun */}
          <div style={{
            position: "absolute", top: 20, right: 50, width: 58, height: 58,
            borderRadius: "50%",
            background: "radial-gradient(circle at 40% 40%, #FFE566, #FFB700)",
            boxShadow: "0 0 28px rgba(255,210,0,0.7), 0 0 56px rgba(255,200,0,0.3)",
            pointerEvents: "none",
          }} />

          {/* Clouds (parallax) */}
          {cloudDefs.map((cloud) => {
            const rawX = cloud.baseX - scrollOffset * cloud.depth;
            const wrapRange = GAME_WIDTH + 200;
            const wrappedX = ((rawX % wrapRange) + wrapRange) % wrapRange - 100;
            return (
              <div key={cloud.id} style={{
                position: "absolute", left: wrappedX, top: cloud.y,
                width: cloud.w, height: cloud.h,
                background: "rgba(255,255,255,0.93)", borderRadius: "50px",
                pointerEvents: "none",
              }}>
                <div style={{ position: "absolute", left: "15%", top: "-45%", width: "50%", height: "80%", borderRadius: "50%", background: "rgba(255,255,255,0.93)" }} />
                <div style={{ position: "absolute", left: "46%", top: "-35%", width: "40%", height: "70%", borderRadius: "50%", background: "rgba(255,255,255,0.93)" }} />
              </div>
            );
          })}

          {/* Ground — dirt layer */}
          <div style={{
            position: "absolute", left: -scrollOffset,
            top: GROUND_Y + PLAYER_HEIGHT + 20,
            width: LEVEL_LENGTH + 1000, height: 80,
            background: "#8B5E3C",
          }} />

          {/* Ground — grass layer */}
          <div style={{
            position: "absolute", left: -scrollOffset,
            top: GROUND_Y + PLAYER_HEIGHT,
            width: LEVEL_LENGTH + 1000, height: 20,
            background: "#5DBB3F",
          }} />

          {/* Platforms — Roblox brick look */}
          {platforms.map((platform, idx) => {
            const col = PLATFORM_COLORS[idx % PLATFORM_COLORS.length];
            return (
              <div key={idx} style={{
                position: "absolute",
                left: platform.x - scrollOffset, top: platform.y,
                width: platform.width, height: platform.height,
                background: col.main,
                borderTop: `4px solid ${col.light}`,
                borderBottom: `3px solid ${col.dark}`,
                borderRadius: "2px",
              }} />
            );
          })}

          {/* Obstacles */}
          {obstacles.map((obstacle) => {
            const screenX = obstacle.x - scrollOffset;
            if (screenX < -100 || screenX > GAME_WIDTH + 100) return null;
            if (obstacle.type === "spike") {
              return (
                <div key={obstacle.id} style={{
                  position: "absolute", left: screenX, top: obstacle.y,
                  width: obstacle.width, height: obstacle.height,
                  background: "linear-gradient(to top, #CC2200, #FF5533)",
                  clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
                  filter: "drop-shadow(0 0 6px rgba(255,50,50,0.7))",
                }} />
              );
            } else {
              return (
                <div key={obstacle.id} style={{
                  position: "absolute", left: screenX, top: obstacle.y,
                  width: obstacle.width, height: obstacle.height,
                  background: "#5A5A6A",
                  borderTop: "3px solid #8A8A9A",
                  borderLeft: "3px solid #7A7A8A",
                  borderRight: "3px solid #3A3A4A",
                  borderBottom: "3px solid #2A2A3A",
                  borderRadius: "3px",
                }} />
              );
            }
          })}

          {/* Coins → Word Tokens */}
          {coins.map((coin) => {
            if (collectedCoins.includes(coin.id)) return null;
            const screenX = coin.x - scrollOffset;
            if (screenX < -100 || screenX > GAME_WIDTH + 100) return null;
            const word = coin.word;
            const fontSize = word.length > 5 ? "7px" : word.length > 3 ? "8px" : "9px";
            const isCollecting = collectEffect === coin.id;
            return (
              <div key={coin.id} style={{ position: "absolute", left: screenX, top: coin.y }}>
                {/* Floating word label above coin */}
                <div style={{
                  position: "absolute", bottom: COIN_SIZE + 5, left: "50%",
                  transform: "translateX(-50%)",
                  background: "rgba(255,255,255,0.96)", color: "#333",
                  fontSize: "10px", fontWeight: "900",
                  padding: "2px 7px", borderRadius: "8px",
                  whiteSpace: "nowrap", border: "1px solid #ccc",
                  pointerEvents: "none",
                }}>
                  {word}
                </div>
                {/* Coin */}
                <div style={{
                  width: COIN_SIZE, height: COIN_SIZE, borderRadius: "50%",
                  background: "radial-gradient(circle at 35% 35%, #FFE566, #FFB700, #CC8800)",
                  border: "3px solid #AA6600",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize, fontWeight: "900", color: "#7A3D00",
                  boxShadow: "0 4px 12px rgba(255,170,0,0.5)",
                  animation: "coinBob 1.2s ease-in-out infinite",
                }}>
                  {word}
                </div>
                {/* Burst stars on collection */}
                {isCollecting && burstPositions.map((pos, si) => (
                  <div key={si} style={{
                    position: "absolute", left: pos.left, top: pos.top,
                    fontSize: "15px", pointerEvents: "none",
                    animation: "burstFade 0.7s ease-out forwards",
                  }}>⭐</div>
                ))}
              </div>
            );
          })}

          {/* ── Player Character ── */}
          <div style={{
            position: "absolute", left: 200, top: playerY,
            width: PLAYER_WIDTH, height: PLAYER_HEIGHT,
            animation: isInvincible ? "hitFlash 0.15s linear infinite" : "none",
          }}>
            {/* Hat */}
            <div style={{
              position: "absolute", left: 3, top: -7,
              width: 26, height: 9,
              background: hatColor,
              borderRadius: "3px 3px 0 0",
            }} />
            {/* Head */}
            <div style={{
              position: "absolute", left: 4, top: 0,
              width: 24, height: 24,
              background: "linear-gradient(135deg, #FFDE7A, #F0C040)",
              borderRadius: "4px", border: "2px solid #C8971E",
            }}>
              {/* Highlight dot */}
              <div style={{ position: "absolute", left: 3, top: 3, width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.55)" }} />
              {/* Eyes — wide open while jumping */}
              <div style={{ position: "absolute", left: 5, top: isJumping ? 6 : 8, width: isJumping ? 5 : 4, height: isJumping ? 6 : 4, borderRadius: "50%", background: "#111" }} />
              <div style={{ position: "absolute", left: 14, top: isJumping ? 6 : 8, width: isJumping ? 5 : 4, height: isJumping ? 6 : 4, borderRadius: "50%", background: "#111" }} />
              {/* Mouth */}
              <div style={{ position: "absolute", left: 7, top: 17, width: 10, height: 2, background: "#111", borderRadius: "0 0 4px 4px" }} />
            </div>
            {/* Body */}
            <div style={{
              position: "absolute", left: 6, top: 24, width: 20, height: 18,
              background: "linear-gradient(to bottom, #3B7AFF, #1E4FCC)",
              border: "2px solid #1230A0", borderRadius: "2px",
            }}>
              <div style={{ position: "absolute", left: 0, top: 7, width: "100%", height: 3, background: "rgba(255,255,255,0.28)" }} />
            </div>
            {/* Left Arm */}
            <div style={{
              position: "absolute", left: 0, top: 26, width: 6, height: 16,
              background: "linear-gradient(to bottom, #FFDE7A, #F0C040)",
              border: "2px solid #C8971E", borderRadius: "2px",
              transformOrigin: "top center",
              transform: !isJumping && walkFrame === 1 ? "rotate(-15deg)" : !isJumping ? "rotate(15deg)" : "rotate(0deg)",
            }} />
            {/* Right Arm */}
            <div style={{
              position: "absolute", left: 26, top: 26, width: 6, height: 16,
              background: "linear-gradient(to bottom, #FFDE7A, #F0C040)",
              border: "2px solid #C8971E", borderRadius: "2px",
              transformOrigin: "top center",
              transform: !isJumping && walkFrame === 1 ? "rotate(15deg)" : !isJumping ? "rotate(-15deg)" : "rotate(0deg)",
            }} />
            {/* Left Leg */}
            <div style={{
              position: "absolute", left: 7, top: 34, width: 8, height: 14,
              background: "linear-gradient(to bottom, #3A7A3A, #1E5A1E)",
              border: "2px solid #0E3A0E", borderRadius: "2px",
              transformOrigin: "top center",
              transform: !isJumping && walkFrame === 0 ? "rotate(-10deg)" : !isJumping ? "rotate(10deg)" : "rotate(-20deg)",
            }} />
            {/* Right Leg */}
            <div style={{
              position: "absolute", left: 17, top: 34, width: 8, height: 14,
              background: "linear-gradient(to bottom, #3A7A3A, #1E5A1E)",
              border: "2px solid #0E3A0E", borderRadius: "2px",
              transformOrigin: "top center",
              transform: !isJumping && walkFrame === 0 ? "rotate(10deg)" : !isJumping ? "rotate(-10deg)" : "rotate(20deg)",
            }} />
          </div>

          {/* Finish line */}
          <div style={{
            position: "absolute", left: LEVEL_LENGTH - scrollOffset, top: 0,
            width: 60, height: GAME_HEIGHT,
            background: "linear-gradient(to right, #FFD700, #FFA500)",
            borderLeft: "4px solid #CC8800",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ color: "white", fontWeight: "900", fontSize: "18px", writingMode: "vertical-rl", textShadow: "1px 1px 0 rgba(0,0,0,0.3)" }}>
              FINISH
            </div>
          </div>

          {/* Jump instruction (shown when no word challenge) */}
          {!currentWord && (
            <div style={{ position: "absolute", top: 14, left: 0, right: 0, textAlign: "center", pointerEvents: "none" }}>
              <div style={{
                display: "inline-block", background: "rgba(255,255,255,0.9)",
                padding: "5px 16px", borderRadius: "20px",
                fontSize: "13px", fontWeight: "700", color: "#333",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              }}>
                Press SPACE or tap to jump
              </div>
            </div>
          )}

          {/* ── Word Challenge Overlay (on canvas) ── */}
          {currentWord && (
            <div style={{
              position: "absolute", inset: 0,
              background: "rgba(0,0,0,0.65)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 10,
            }}>
              <div style={{
                background: "white", borderRadius: "20px", padding: "28px",
                width: "360px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                textAlign: "center",
              }}>
                <div style={{ fontSize: "22px", marginBottom: "8px" }}>🪙 Word Collected!</div>
                <h3 style={{ fontSize: "20px", fontWeight: "900", color: "#1A1A2E", marginBottom: "16px" }}>
                  Spell the word you heard!
                </h3>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (currentWord) speak(currentWord); }}
                    style={{
                      background: "#7C3AED", color: "white", fontWeight: "700",
                      padding: "10px 20px", borderRadius: "12px", border: "none",
                      cursor: "pointer", display: "flex", alignItems: "center",
                      gap: "8px", fontSize: "15px",
                    }}
                  >
                    <Volume2 size={18} /> Hear Again
                  </button>
                </div>
                <form onSubmit={handleSpellingSubmit}>
                  <input
                    type="text"
                    value={userSpelling}
                    onChange={(e) => setUserSpelling(e.target.value)}
                    placeholder="Type the word here"
                    autoFocus
                    disabled={showFeedback}
                    style={{
                      width: "100%", padding: "12px 16px", fontSize: "24px",
                      textAlign: "center", border: "2px solid #D1D5DB",
                      borderRadius: "12px", outline: "none", fontWeight: "700",
                      marginBottom: "12px", boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!userSpelling.trim() || showFeedback}
                    style={{
                      width: "100%",
                      background: "linear-gradient(to right, #EC4899, #7C3AED)",
                      color: "white", fontWeight: "900", padding: "12px",
                      borderRadius: "12px", border: "none", fontSize: "16px",
                      cursor: !userSpelling.trim() || showFeedback ? "not-allowed" : "pointer",
                      opacity: !userSpelling.trim() || showFeedback ? 0.5 : 1,
                    }}
                  >
                    Check Spelling ✓
                  </button>
                </form>
                {showFeedback && (
                  <div style={{
                    marginTop: "12px", padding: "12px", borderRadius: "12px",
                    background: feedbackCorrect ? "#D1FAE5" : "#FEE2E2",
                    border: `2px solid ${feedbackCorrect ? "#6EE7B7" : "#FCA5A5"}`,
                    color: feedbackCorrect ? "#065F46" : "#991B1B",
                    fontWeight: "700", fontSize: "16px",
                  }}>
                    {feedbackCorrect ? "✓ Correct! +10 points" : `✗ Not quite. The word is "${currentWord}"`}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

/* ============================== Boss Fight Modal ============================== */
const BossFightModal = ({ zoneId, sentence, targetWord, onVictory, onDismiss }) => {
  const [userInput, setUserInput] = useState("");
  const [wrongCount, setWrongCount] = useState(0);
  const [stage, setStage] = useState("fight"); // "fight" | "win" | "miss"

  const BOSS_EMOJIS = { sight: "🤖", phonics: "🦉", math: "🐉", spelling: "🐊" };
  const bossEmoji = BOSS_EMOJIS[zoneId] || "👾";

  useEffect(() => {
    const t = setTimeout(() => speak(sentence), 400);
    return () => clearTimeout(t);
  }, [sentence]);

  const renderSentence = () => {
    const parts = sentence.split(new RegExp(`(${targetWord})`, "i"));
    return parts.map((part, i) =>
      part.toLowerCase() === targetWord.toLowerCase()
        ? <strong key={i} className="text-purple-800 underline">{part}</strong>
        : <span key={i}>{part}</span>
    );
  };

  const handleSubmit = () => {
    if (userInput.trim().toLowerCase() === targetWord.toLowerCase()) {
      setStage("win");
    } else {
      const next = wrongCount + 1;
      setWrongCount(next);
      if (next >= 2) {
        setStage("miss");
      } else {
        setUserInput("");
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl text-center">
        <div className="text-6xl mb-3">{bossEmoji}</div>

        {stage === "fight" && (
          <>
            <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Boss Fight!</h2>
            <p className="text-gray-600 mb-4">Type the highlighted word to defeat the boss!</p>

            <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 mb-6 text-lg text-gray-800 leading-relaxed">
              {renderSentence()}
            </div>

            <button
              onClick={() => speak(sentence)}
              className="w-full bg-purple-100 hover:bg-purple-200 text-purple-800 font-extrabold py-2 rounded-xl mb-4 flex items-center justify-center gap-2"
            >
              <Volume2 size={18} /> Hear Again
            </button>

            <input
              type="text"
              value={userInput}
              onChange={e => setUserInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              placeholder="Type the bold word..."
              autoFocus
              className="w-full border-2 border-gray-300 rounded-2xl px-4 py-3 text-xl text-center font-bold focus:outline-none focus:border-purple-500 mb-4"
            />

            {wrongCount > 0 && (
              <p className="text-red-600 font-bold text-sm mb-3">Wrong! {2 - wrongCount} attempt{2 - wrongCount === 1 ? "" : "s"} left.</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={!userInput.trim()}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 disabled:opacity-50 text-white font-extrabold py-4 rounded-2xl mb-3"
            >
              Attack! ⚔️
            </button>

            <button onClick={onDismiss} className="text-sm text-gray-400 hover:text-gray-600 underline">
              Retreat (skip)
            </button>
          </>
        )}

        {stage === "win" && (
          <>
            <h2 className="text-3xl font-extrabold text-green-700 mb-2">Victory! 🎉</h2>
            <p className="text-gray-700 mb-4 text-lg">You defeated the boss!</p>
            <div className="bg-yellow-100 border border-yellow-300 rounded-2xl p-4 mb-6">
              <p className="text-2xl font-extrabold text-yellow-800">⭐ +1 Star!</p>
              <p className="text-xl font-bold text-yellow-700">+25 Points!</p>
            </div>
            <button
              onClick={onVictory}
              className="w-full bg-gradient-to-r from-yellow-400 to-orange-500 hover:opacity-90 text-white font-extrabold py-4 rounded-2xl"
            >
              Claim Reward!
            </button>
          </>
        )}

        {stage === "miss" && (
          <>
            <h2 className="text-3xl font-extrabold text-red-700 mb-2">Boss Escaped! 😤</h2>
            <p className="text-gray-600 mb-3">The word was:</p>
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6">
              <p className="text-2xl font-extrabold text-red-800">{targetWord}</p>
            </div>
            <button
              onClick={onDismiss}
              className="w-full bg-gray-700 hover:opacity-90 text-white font-extrabold py-4 rounded-2xl"
            >
              Try Again Next Time
            </button>
          </>
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
const HomeworkGamesApp = ({ uid, childId, childName, childEmoji, onSwitchChild, parentsOnly = false } = {}) => {
  const LS_KEY = childId ? `haydens_homework_${childId}_v6` : DEFAULT_LS_KEY;
  const [currentView, setCurrentView] = useState(parentsOnly ? "parents" : "home"); // home | parents | flashcards | today | game | loot
  const [localChildName, setLocalChildName] = useState(childName || "");
  const [childNameInput, setChildNameInput] = useState(childName || "");
  const [savingChildName, setSavingChildName] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);
  const [points, setPoints] = useState(0);
  const [keys, setKeys] = useState(0);
  const [inventory, setInventory] = useState([]);

  const [showChestModal, setShowChestModal] = useState(false);
  const [selectedChest, setSelectedChest] = useState(null);
  const [completedGamesThisSession, setCompletedGamesThisSession] = useState([]);

  const [worldProgress, setWorldProgress] = useState({ sight: 0, phonics: 0, math: 0, spelling: 0 });
  const [syncCode, setSyncCode] = useState("");
  const [activeChildId, setActiveChildId] = useState("hayden");
  const [syncStatus, setSyncStatus] = useState("disconnected");
  const [syncCodeInput, setSyncCodeInput] = useState("");
  const [activeChildInput, setActiveChildInput] = useState("hayden");
  const [gameSource, setGameSource] = useState("home"); // "home" | "worldmap"
  const [pendingBossFight, setPendingBossFight] = useState(null); // {zoneId, sentence, targetWord} | null
  const [activeBossZone, setActiveBossZone] = useState(null);

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
  const [aiImportStatus, setAiImportStatus] = useState("idle"); // idle | parsing | preview | error
  const [aiImportPreview, setAiImportPreview] = useState(null);
  const [aiImportError, setAiImportError] = useState(null);

  /* ----------------------------- Load / Save ----------------------------- */
  const applyData = useCallback((data) => {
    if (typeof data.points === "number") setPoints(data.points);
    if (typeof data.keys === "number") setKeys(data.keys);
    if (Array.isArray(data.inventory)) setInventory(data.inventory);
    if (Array.isArray(data.customSightWords)) setCustomSightWords(data.customSightWords);
    if (Array.isArray(data.customSpellingWords)) setCustomSpellingWords(data.customSpellingWords);
    if (Array.isArray(data.customVocabWords)) setCustomVocabWords(data.customVocabWords);
    if (Array.isArray(data.customPhonicsWords)) setCustomPhonicsWords(data.customPhonicsWords);
    if (Array.isArray(data.upcomingTests)) setUpcomingTests(data.upcomingTests);
    if (data.weeklyGames && typeof data.weeklyGames === "object") setWeeklyGames({ ...DEFAULT_WEEKLY_GAMES, ...data.weeklyGames });
    if (typeof data.teacherNotes === "string") setTeacherNotes(data.teacherNotes);
    if (data.progress && typeof data.progress === "object") setProgress({ ...DEFAULT_PROGRESS, ...data.progress });
    if (data.worldProgress) setWorldProgress({ sight: 0, phonics: 0, math: 0, spelling: 0, ...data.worldProgress });
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
  }, []); // state setters are stable refs

  useEffect(() => {
    try {
      const sc = localStorage.getItem("haydens_homework_sync_code");
      const cid = localStorage.getItem("haydens_homework_child_id");
      if (sc) { setSyncCode(sc); setSyncCodeInput(sc); }
      if (cid) { setActiveChildId(cid); setActiveChildInput(cid); }
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      applyData(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, [applyData]);

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
      worldProgress,
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
    worldProgress,
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

  /* ----------------------------- Firestore Sync (lazy-loaded) ----------------------------- */
  const firestoreRef = useRef(null); // { db, doc, onSnapshot, setDoc, serverTimestamp }

  const getFirestore = useCallback(async () => {
    if (firestoreRef.current) return firestoreRef.current;
    const [{ db }, firestoreMod] = await Promise.all([
      import("./Firebase.js"),
      import("firebase/firestore"),
    ]);
    firestoreRef.current = { db, ...firestoreMod };
    return firestoreRef.current;
  }, []);

  useEffect(() => {
    if (!syncCode && !uid) { setSyncStatus("disconnected"); return; }
    let unsub = null;
    setSyncStatus("connecting");
    getFirestore().then(({ db, doc, onSnapshot }) => {
      if (!db) { setSyncStatus("error"); return; }
      const ref = uid
        ? doc(db, "users", uid, "children", childId)
        : doc(db, "families", syncCode, "children", activeChildId);
      unsub = onSnapshot(ref, (snap) => {
        setSyncStatus("connected");
        if (!snap.exists()) return;
        const data = snap.data();
        if (data._deviceId === DEVICE_ID) return;
        applyData(data);
      }, () => setSyncStatus("error"));
    }).catch(() => setSyncStatus("error"));
    return () => { if (unsub) unsub(); };
  }, [syncCode, activeChildId, applyData, getFirestore]);

  useEffect(() => {
    if (!syncCode && !uid) return;
    localStorage.setItem("haydens_homework_sync_code", syncCode);
    localStorage.setItem("haydens_homework_child_id", activeChildId);
    const payload = {
      points, keys, inventory, customSightWords, customSpellingWords,
      customVocabWords, customPhonicsWords, upcomingTests, weeklyGames,
      teacherNotes, progress, worldProgress,
      drafts: { newSightWord, newSpellingWord, newVocabWord, newVocabDef,
                newPhonicsWord, newPhonicsPattern, newTestName, newTestSubject, newTestDate },
      _deviceId: DEVICE_ID,
    };
    const t = setTimeout(async () => {
      try {
        const { db, doc, setDoc, serverTimestamp } = await getFirestore();
        if (!db) return;
        const ref = uid
          ? doc(db, "users", uid, "children", childId)
          : doc(db, "families", syncCode, "children", activeChildId);
        await setDoc(ref, { ...payload, _updatedAt: serverTimestamp() });
        setSyncStatus("connected");
      } catch {
        setSyncStatus("error");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [syncCode, activeChildId, points, keys, inventory, customSightWords, customSpellingWords,
      customVocabWords, customPhonicsWords, upcomingTests, weeklyGames, teacherNotes, progress, worldProgress,
      newSightWord, newSpellingWord, newVocabWord, newVocabDef, newPhonicsWord, newPhonicsPattern,
      newTestName, newTestSubject, newTestDate, getFirestore]);

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

  const deleteTest = (test) => setUpcomingTests((prev) => prev.filter((t) => t !== test));

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

  const handleZoneLaunch = (zoneId) => {
    setActiveBossZone(zoneId);
    setGameSource("worldmap");
    const MAP = { sight: "Sight Word Obby", phonics: "Phonics is Falling", math: "Math Race", spelling: "Spelling Swamp" };
    if (zoneId === "vocab") {
      setCurrentView("flashcards");
      return;
    }
    setSelectedGame(MAP[zoneId]);
    setCurrentView("game");
  };

  const handleWorldGameComplete = () => {
    const { sentence, targetWord } = generateAdventureSentence(customSpellingWords, customSightWords, customVocabWords);
    setPendingBossFight({ zoneId: activeBossZone, sentence, targetWord });
    setCurrentView("worldmap");
  };

  const handleBossVictory = () => {
    setWorldProgress(prev => ({ ...prev, [pendingBossFight.zoneId]: Math.min(3, (prev[pendingBossFight.zoneId] || 0) + 1) }));
    setPoints(p => p + 25);
    setPendingBossFight(null);
    setActiveBossZone(null);
    setGameSource("home");
  };

  const handleBossDismiss = () => {
    setPendingBossFight(null);
    setActiveBossZone(null);
    setGameSource("home");
    setCurrentView("worldmap");
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

  /* ------------------------- AI Document Import ------------------------- */
  // Requires a real, signed-in Firebase Auth session — /api/parse-homework
  // verifies the ID token server-side and rejects anything else (Phase 0
  // security remediation). Guest/local-demo mode (no Firebase Auth session)
  // can't use this feature, since there's no real identity to authenticate.
  const handleAiDocumentUpload = async (file) => {
    if (!file) return;
    setAiImportStatus("parsing");
    setAiImportPreview(null);
    setAiImportError(null);

    if (!auth?.currentUser) {
      setAiImportError("AI document import requires a signed-in account. Sign in with Google or email to use this — it isn't available in guest/demo mode.");
      setAiImportStatus("error");
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      const idToken = await auth.currentUser.getIdToken();

      const res = await fetch("/api/parse-homework", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ fileData: base64, mimeType: file.type || "text/plain", fileName: file.name }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Parsing failed");

      setAiImportPreview(json.data);
      setAiImportStatus("preview");
    } catch (err) {
      setAiImportError(err.message);
      setAiImportStatus("error");
    }
  };

  const applyAiImport = () => {
    if (!aiImportPreview) return;
    const { sightWords = [], spellingWords = [], vocabWords = [], phonicsWords = [], tests = [] } = aiImportPreview;

    if (sightWords.length) {
      setCustomSightWords(prev => {
        const existing = new Set(prev.map(x => x.toLowerCase()));
        const toAdd = sightWords.filter(w => w && !existing.has(w.toLowerCase()));
        return [...prev, ...toAdd];
      });
    }
    if (spellingWords.length) {
      setCustomSpellingWords(prev => {
        const existing = new Set(prev.map(x => x.toLowerCase()));
        const toAdd = spellingWords.filter(w => w && !existing.has(w.toLowerCase()));
        return [...prev, ...toAdd];
      });
    }
    if (vocabWords.length) {
      setCustomVocabWords(prev => {
        const existing = new Set(prev.map(x => (x.word || x).toLowerCase()));
        const toAdd = vocabWords.filter(v => v?.word && !existing.has(v.word.toLowerCase()));
        return [...prev, ...toAdd.map(v => ({ word: v.word, def: v.definition || "" }))];
      });
    }
    if (phonicsWords.length) {
      setCustomPhonicsWords(prev => {
        const existing = new Set(prev.map(x => (x.word || x).toLowerCase()));
        const toAdd = phonicsWords.filter(p => p?.word && !existing.has(p.word.toLowerCase()));
        return [...prev, ...toAdd];
      });
    }
    if (tests.length) {
      setUpcomingTests(prev => {
        const existing = new Set(prev.map(t => `${t.name}|${t.date}`));
        const toAdd = tests.filter(t => t?.name && !existing.has(`${t.name}|${t.date}`));
        return [...prev, ...toAdd.map(t => ({ id: Date.now() + Math.random(), name: t.name, subject: t.subject || "General", date: t.date || "" }))];
      });
    }

    setAiImportStatus("idle");
    setAiImportPreview(null);
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
    if (gameKey === "phonics") return "Phonics is Falling";
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
              <h1 className="text-3xl font-display text-gray-900">Today's Quest</h1>
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

    const renameChild = async () => {
      const name = childNameInput.trim();
      if (!name || savingChildName) return;
      setSavingChildName(true);
      try {
        const { db, doc, getDoc, setDoc } = await getFirestore();
        if (!db) throw new Error("no db");
        const profileRef = doc(db, "users", uid);
        const snap = await getDoc(profileRef);
        const data = snap.exists() ? snap.data() : {};
        const updatedChildren = (data.children || []).map(c =>
          c.id === childId ? { ...c, name } : c
        );
        await setDoc(profileRef, { children: updatedChildren }, { merge: true });
        setLocalChildName(name);
      } catch (e) {
        console.error("Rename learner failed:", e);
      } finally {
        setSavingChildName(false);
      }
    };

    return (
      <div className="max-w-6xl mx-auto">
        <BackButton onClick={onSwitchChild} label="Back to Parent Page" className="mb-6" />

        <h1 className="text-4xl font-extrabold text-gray-900 mb-6 text-center">
          {localChildName ? `${localChildName}'s Parent's Page` : "Parent's Page"}
        </h1>

        {/* Learner Name */}
        <div className="bg-white rounded-3xl shadow-md p-6 border border-indigo-200 mb-6">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-3">👤 Learner Name</h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={childNameInput}
              onChange={e => setChildNameInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && renameChild()}
              className="flex-1 rounded-2xl px-4 py-3 text-lg font-semibold border border-gray-300 focus:outline-none focus:border-indigo-400"
            />
            <button
              onClick={renameChild}
              disabled={savingChildName || !childNameInput.trim() || childNameInput.trim() === localChildName}
              className="px-5 py-3 rounded-2xl font-extrabold text-white disabled:opacity-50"
              style={{ background: "#5B2D8E" }}
            >
              {savingChildName ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {/* Cloud Sync */}
        <div className="bg-white rounded-3xl shadow-md p-6 border border-indigo-200 mb-6">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-1">☁️ Cloud Sync</h2>
          <p className="text-gray-600 mb-4">Enter the same sync code on every device to keep {localChildName || "this learner"}'s data in sync automatically.</p>

          <div className="flex items-center gap-2 mb-4">
            <span className={`w-3 h-3 rounded-full flex-shrink-0 ${syncStatus === "connected" ? "bg-green-500" : syncStatus === "connecting" ? "bg-yellow-400" : syncStatus === "error" ? "bg-red-500" : "bg-gray-300"}`} />
            <span className="font-semibold text-gray-700 capitalize">{syncStatus}</span>
            {syncCode && <span className="ml-2 text-gray-500 text-sm">Code: <strong className="font-mono">{syncCode}</strong> · Child: <strong>{activeChildId}</strong></span>}
          </div>

          <div className="flex gap-2 mb-3">
            <input
              value={syncCodeInput}
              onChange={e => setSyncCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              onKeyDown={e => e.key === "Enter" && syncCodeInput.length >= 4 && (setSyncCode(syncCodeInput), setActiveChildId(activeChildInput || "hayden"))}
              placeholder="e.g. HAY123"
              maxLength={8}
              className="flex-1 border border-gray-300 rounded-2xl px-4 py-2 font-mono text-lg font-bold focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => { if (syncCodeInput.length >= 4) { setSyncCode(syncCodeInput); setActiveChildId(activeChildInput || "hayden"); } }}
              disabled={syncCodeInput.length < 4}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-extrabold px-6 py-2 rounded-2xl"
            >
              Connect
            </button>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <label className="text-sm font-bold text-gray-700 whitespace-nowrap">Child name/ID:</label>
            <input
              value={activeChildInput}
              onChange={e => setActiveChildInput(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))}
              placeholder="hayden"
              className="flex-1 border border-gray-300 rounded-2xl px-4 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
            <span className="text-xs text-gray-400">(for siblings, use different IDs)</span>
          </div>

          {syncCode && (
            <button
              onClick={() => { setSyncCode(""); setSyncCodeInput(""); setSyncStatus("disconnected"); }}
              className="text-sm text-red-500 hover:text-red-700 underline"
            >
              Disconnect
            </button>
          )}
        </div>

        {/* AI Document Import */}
        <div className="rounded-3xl shadow-md p-6 border border-purple-300 mb-6" style={{ background: 'linear-gradient(135deg, #5B2D8E, #3d1d61)' }}>
          <h2 className="text-2xl font-display text-white mb-1">✨ Smart Homework Import</h2>
          <p className="text-purple-200 mb-4">Upload any homework sheet, teacher letter, or newsletter — AI will extract the word lists automatically.</p>

          {aiImportStatus === "idle" || aiImportStatus === "error" ? (
            <div>
              <label className="block w-full cursor-pointer">
                <div className="w-full rounded-2xl py-4 px-6 text-center font-extrabold transition hover:opacity-90" style={{ background: '#A8FF3E', color: '#1C1C1E' }}>
                  📄 Upload Document
                </div>
                <input
                  type="file"
                  accept=".pdf,.txt,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={e => { handleAiDocumentUpload(e.target.files?.[0]); e.target.value = ""; }}
                />
              </label>
              <p className="text-purple-300 text-xs mt-2 text-center">Supports PDF, images (PNG/JPG), and text files</p>
              {aiImportStatus === "error" && (
                <div className="mt-3 bg-red-100 text-red-800 rounded-2xl px-4 py-3 text-sm font-semibold">
                  ⚠️ {aiImportError}
                </div>
              )}
            </div>
          ) : aiImportStatus === "parsing" ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-3 animate-pulse">🔍</div>
              <p className="text-white font-extrabold">Reading document...</p>
              <p className="text-purple-300 text-sm mt-1">Claude is extracting the homework</p>
            </div>
          ) : aiImportStatus === "preview" && aiImportPreview ? (
            <div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label: "Sight Words", items: aiImportPreview.sightWords, emoji: "👁️" },
                  { label: "Spelling Words", items: aiImportPreview.spellingWords, emoji: "✏️" },
                  { label: "Vocab Words", items: (aiImportPreview.vocabWords || []).map(v => v.word), emoji: "📖" },
                  { label: "Phonics Words", items: (aiImportPreview.phonicsWords || []).map(p => p.word), emoji: "🔤" },
                ].map(({ label, items, emoji }) => items?.length > 0 && (
                  <div key={label} className="bg-white bg-opacity-10 rounded-2xl p-3">
                    <div className="text-white font-extrabold text-sm mb-1">{emoji} {label} ({items.length})</div>
                    <div className="text-purple-200 text-xs">{items.slice(0, 6).join(", ")}{items.length > 6 ? ` +${items.length - 6} more` : ""}</div>
                  </div>
                ))}
                {aiImportPreview.tests?.length > 0 && (
                  <div className="bg-white bg-opacity-10 rounded-2xl p-3 col-span-2">
                    <div className="text-white font-extrabold text-sm mb-1">📅 Tests ({aiImportPreview.tests.length})</div>
                    <div className="text-purple-200 text-xs">{aiImportPreview.tests.map(t => t.name).join(", ")}</div>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={applyAiImport}
                  className="flex-1 font-extrabold py-3 rounded-2xl hover:opacity-90"
                  style={{ background: '#A8FF3E', color: '#1C1C1E' }}
                >
                  ✅ Apply to App
                </button>
                <button
                  onClick={() => { setAiImportStatus("idle"); setAiImportPreview(null); }}
                  className="px-5 py-3 rounded-2xl font-extrabold text-white bg-white bg-opacity-20 hover:bg-opacity-30"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>

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
                      onClick={() => deleteTest(test)}
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

  const renderWorldMap = () => (
    <WorldMapScreen
      onBack={() => setCurrentView("home")}
      onLaunchZone={handleZoneLaunch}
      worldProgress={worldProgress}
      customSightWords={customSightWords}
      customSpellingWords={customSpellingWords}
      customVocabWords={customVocabWords}
      customPhonicsWords={customPhonicsWords}
      weeklyGames={weeklyGames}
    />
  );

  const renderHome = () => (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-4xl md:text-5xl font-display text-white">Crestly</h1>
          <p className="text-crestly-lime font-semibold mt-1">
            {childName ? `${childEmoji || "⭐"} ${childName}'s Adventure` : "Rise. Learn. Conquer."}
          </p>
        </div>

        {onSwitchChild && (
          <button
            onClick={onSwitchChild}
            className="text-sm text-white hover:opacity-80 font-extrabold flex items-center gap-2 px-4 py-2 rounded-full border border-gray-600"
          >
            ⇄ Switch
          </button>
        )}
      </div>

      <div className="mb-6 flex gap-3 flex-wrap items-center">
        <IconPill icon={Star} label={`${points} Stars`} className="text-yellow-700" />
        <IconPill icon={Key} label={`${keys} Keys`} className="text-yellow-700" />
        {syncCode && (
          <span className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-extrabold border ${
            syncStatus === "connected" ? "bg-green-50 border-green-200 text-green-800"
            : syncStatus === "error" ? "bg-red-50 border-red-200 text-red-800"
            : "bg-gray-100 border-gray-200 text-gray-600"
          }`}>
            <span className={`w-2 h-2 rounded-full ${syncStatus === "connected" ? "bg-green-500" : syncStatus === "error" ? "bg-red-500" : "bg-yellow-400"}`} />
            {syncStatus === "connected" ? "Synced" : syncStatus === "error" ? "Sync Error" : "Syncing..."}
          </span>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">{renderStudentPlanner()}</div>

        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-3xl p-6 text-white shadow-md" style={{ background: 'linear-gradient(135deg, #5B2D8E, #3d1d61)' }}>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl">🗺️</span>
              <div className="text-2xl font-display">This weeks adventures!</div>
            </div>
            <p className="text-purple-200 mb-4">Explore 4 zones, defeat bosses, earn stars!</p>
            <button
              onClick={() => { setGameSource("home"); setCurrentView("worldmap"); }}
              className="w-full font-extrabold py-4 rounded-2xl transition hover:opacity-90"
              style={{ background: '#A8FF3E', color: '#1C1C1E' }}
            >
              🗺️ Enter World
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <Package style={{ color: '#5B2D8E' }} />
              <div className="text-2xl font-display text-gray-900">Open Chests</div>
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
              className="w-full font-extrabold py-3 rounded-2xl hover:opacity-90"
              style={{ background: '#F3ECF9', color: '#5B2D8E' }}
            >
              View My Loot ({inventory.length} items)
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-6">
            <div className="flex items-center gap-3 mb-2">
              <BookOpen style={{ color: '#5B2D8E' }} />
              <div className="text-2xl font-display text-gray-900">Flashcards</div>
            </div>
            <p className="text-gray-600 mb-4">Unlock your word power — sight words, spelling, and vocab.</p>
            <button
              onClick={() => {
                setCurrentView("flashcards");
                setFlashcardMode(null);
                setCurrentFlashcard(0);
                setShowFlashcardAnswer(false);
              }}
              className="w-full hover:opacity-95 text-white font-extrabold py-4 rounded-2xl"
              style={{ background: '#1C1C1E' }}
            >
              Open Flashcards
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <Gamepad2 style={{ color: '#5B2D8E' }} />
              <div className="text-2xl font-display text-gray-900">Games</div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { name: "Math Race", icon: Trophy },
                { name: "Phonics is Falling", icon: Zap },
                { name: "Sight Word Obby", icon: Shield },
                { name: "Spelling Swamp", icon: Sparkles },
              ].map((game) => (
                <button
                  key={game.name}
                  onClick={() => {
                    setSelectedGame(game.name);
                    setCurrentView("game");
                  }}
                  className="bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl p-4 font-extrabold text-gray-900 text-left"
                >
                  <game.icon className="mb-2" style={{ color: '#5B2D8E' }} />
                  <div>{game.name}</div>
                </button>
              ))}
            </div>

            <div className="mt-4 text-sm text-gray-500">Tip: Start "Today's Quest" for your full guided adventure with adaptive learning.</div>
          </div>
        </div>
      </div>
    </div>
  );

  /* ---------------------------------- Game --------------------------------- */
  const renderGame = () => {
    const backDest = gameSource === "worldmap" ? "worldmap" : "home";
    const completeFn = gameSource === "worldmap" ? handleWorldGameComplete : () => setCurrentView("today");

    if (selectedGame === "Spelling Swamp") {
      return (
        <SpellingSwampGame
          spellingWords={customSpellingWords}
          wordsPerSession={weeklyGames.spellingPerDay}
          setPoints={setPoints}
          onBack={() => setCurrentView(backDest)}
          onComplete={completeFn}
          onEvent={handleGameEvent}
          recordAttempt={recordAttempt}
        />
      );
    }

    if (selectedGame === "Sound Jumper") {
      return (
        <SoundJumperGame
          phonicsWords={customPhonicsWords}
          wordsPerSession={weeklyGames.phonicsPerDay}
          smartMode={!!weeklyGames.smartPhonicsMode}
          setPoints={setPoints}
          onBack={() => setCurrentView(backDest)}
          onComplete={completeFn}
          onEvent={handleGameEvent}
        />
      );
    }

    if (selectedGame === "Phonics is Falling") {
      return (
        <PhonicsIsFallingGame
          customPhonicsWords={customPhonicsWords}
          wordsPerSession={weeklyGames.phonicsPerDay}
          setPoints={setPoints}
          onBack={() => setCurrentView(backDest)}
          onComplete={completeFn}
          onEvent={handleGameEvent}
          recordAttempt={recordAttempt}
        />
      );
    }

    if (selectedGame === "Math Race") {
      return (
        <MathRaceGame
          onBack={() => setCurrentView(backDest)}
          onDone={completeFn}
          setPoints={setPoints}
          initialTopicId={weeklyGames.mathTopic}
          numProblems={weeklyGames.mathProblemsPerDay}
          autoStart={true}
          onEvent={handleGameEvent}
        />
      );
    }

    if (selectedGame === "Sight Word Obby") {
      return (
        <SightWordObbyGame
          onBack={() => setCurrentView(backDest)}
          onComplete={completeFn}
          setPoints={setPoints}
          onEvent={handleGameEvent}
          customSightWords={customSightWords}
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
    <div className="min-h-screen bg-crestly-charcoal p-4 md:p-8">
      {currentView === "home" && renderHome()}
      {currentView === "worldmap" && renderWorldMap()}
      {currentView === "parents" && renderParentsPage()}
      {currentView === "flashcards" && renderFlashcards()}
      {currentView === "today" && renderTodaysGames()}
      {currentView === "game" && renderGame()}
      {currentView === "loot" && renderMyLoot()}

      {pendingBossFight && (
        <BossFightModal
          zoneId={pendingBossFight.zoneId}
          sentence={pendingBossFight.sentence}
          targetWord={pendingBossFight.targetWord}
          onVictory={handleBossVictory}
          onDismiss={handleBossDismiss}
        />
      )}

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
