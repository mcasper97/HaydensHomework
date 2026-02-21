import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Calendar,
  Check,
  Gamepad2,
  Plus,
  Settings,
  Star,
  Trophy,
  Volume2,
} from "lucide-react";

/* ============================== Local Storage ============================== */
const LS_KEY = "haydens_homework_app_v5";

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
  mathProblemsPerDay: 5,
  mathTopic: "addition-double",
  sequence: ["sight", "spelling", "vocab", "math"], // Today’s Games flow
};

const DEFAULT_PROGRESS = {
  sight: {},
  spelling: {},
  vocab: {},
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

/* ============================== Math Race Game ============================== */
const MathRaceGame = ({
  onBack,
  onDone,
  points,
  setPoints,
  initialTopicId,
  numProblems = 10,
  autoStart = false,
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
      setScore((s) => s + 10);
      setPoints(points + 10);
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
        <button
          onClick={() => (onDone ? onDone() : onBack())}
          className="mb-6 text-purple-800 hover:text-purple-900 font-bold bg-white px-4 py-2 rounded-full shadow-sm border border-gray-200"
        >
          ← Back
        </button>

        <h1 className="text-4xl font-extrabold text-gray-900 mb-2 text-center">Choose Your Math Topic</h1>
        <p className="text-center text-gray-600 mb-8">Pick a mode. You’ve got this.</p>

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
              Back to Today’s Games
            </button>
          </div>
        </div>
      </div>
    );
  }

  const problem = problems[currentProblem];

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={resetGame} className="mb-6 text-purple-800 hover:text-purple-900 font-semibold">
        ← Choose Different Topic
      </button>

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
          <div className={`mt-5 p-5 rounded-2xl border ${isCorrect ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
            <p className={`text-xl font-extrabold ${isCorrect ? "text-green-800" : "text-red-800"}`}>
              {isCorrect ? "✓ Correct. Nice job." : "✗ Not this time. Try again."}
            </p>
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

/* ============================== Main App ============================== */
const HomeworkGamesApp = () => {
  const [currentView, setCurrentView] = useState("home"); // home | parents | flashcards | today | game
  const [selectedGame, setSelectedGame] = useState(null);
  const [points, setPoints] = useState(0);

  // Flashcards
  const [flashcardMode, setFlashcardMode] = useState(null); // sight | spelling | vocab
  const [currentFlashcard, setCurrentFlashcard] = useState(0);
  const [showFlashcardAnswer, setShowFlashcardAnswer] = useState(false);

  // Parent-managed lists
  const [customSightWords, setCustomSightWords] = useState([]);
  const [customSpellingWords, setCustomSpellingWords] = useState([]);
  const [customVocabWords, setCustomVocabWords] = useState([]); // {word, def}

  // Draft inputs (persist)
  const [newSightWord, setNewSightWord] = useState("");
  const [newSpellingWord, setNewSpellingWord] = useState("");
  const [newVocabWord, setNewVocabWord] = useState("");
  const [newVocabDef, setNewVocabDef] = useState("");

  // Tests & Quizzes
  const [upcomingTests, setUpcomingTests] = useState([]);
  const [newTestName, setNewTestName] = useState("");
  const [newTestSubject, setNewTestSubject] = useState("Math");
  const [newTestDate, setNewTestDate] = useState("");

  // Weekly games config + notes + mastery
  const [weeklyGames, setWeeklyGames] = useState(DEFAULT_WEEKLY_GAMES);
  const [teacherNotes, setTeacherNotes] = useState("");
  const [progress, setProgress] = useState(DEFAULT_PROGRESS);

  // Today’s Games runtime
  const [todayGameIndex, setTodayGameIndex] = useState(0);
  const [todayItems, setTodayItems] = useState({ sight: [], spelling: [], vocab: [] });
  const [todayCardIndex, setTodayCardIndex] = useState(0);

  // Import success summary (persist in memory)
  const [lastImportSummary, setLastImportSummary] = useState(null);

  /* ----------------------------- Load / Save ----------------------------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);

      if (typeof data.points === "number") setPoints(data.points);

      if (Array.isArray(data.customSightWords)) setCustomSightWords(data.customSightWords);
      if (Array.isArray(data.customSpellingWords)) setCustomSpellingWords(data.customSpellingWords);
      if (Array.isArray(data.customVocabWords)) setCustomVocabWords(data.customVocabWords);

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
      customSightWords,
      customSpellingWords,
      customVocabWords,
      upcomingTests,
      weeklyGames,
      teacherNotes,
      progress,
      drafts: {
        newSightWord,
        newSpellingWord,
        newVocabWord,
        newVocabDef,
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
    customSightWords,
    customSpellingWords,
    customVocabWords,
    upcomingTests,
    weeklyGames,
    teacherNotes,
    progress,
    newSightWord,
    newSpellingWord,
    newVocabWord,
    newVocabDef,
    newTestName,
    newTestSubject,
    newTestDate,
  ]);

  /* ---------------------- Tests & Quizzes helpers ---------------------- */
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
      setUpcomingTests((prev) => [
        ...prev,
        { name: newTestName.trim(), subject: newTestSubject, date: newTestDate },
      ]);
      setNewTestName("");
      setNewTestSubject("Math");
      setNewTestDate("");
    }
  };

  const deleteTest = (index) => {
    setUpcomingTests((prev) => prev.filter((_, i) => i !== index));
  };

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

  /* -------------------------- CSV Import: structured ------------------------- */
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

    const testNameIdx = idxAny(["test_name", "quiz_name", "assessment_name", "name"]);
    const testSubjectIdx = idxAny(["test_subject", "subject", "class"]);
    const testDateIdx = idxAny(["test_date", "date", "due_date"]);

    const settingKeyIdx = idxAny(["setting_key", "key"]);
    const settingValueIdx = idxAny(["setting_value", "value"]);

    const notesIdx = idxAny(["notes", "teacher_notes", "note"]);

    let nextWeekly = { ...weeklyGames };
    let nextNotes = teacherNotes;

    const nextSight = [...customSightWords];
    const nextSpell = [...customSpellingWords];
    const nextVocab = [...customVocabWords];
    const nextTests = [...upcomingTests];

    const sightSet = new Set(nextSight.map((x) => x.toLowerCase()));
    const spellSet = new Set(nextSpell.map((x) => x.toLowerCase()));
    const vocabSet = new Set(nextVocab.map((x) => (x.word || "").toLowerCase()));

    const testKey = (t) =>
      `${(t.name || "").trim().toLowerCase()}|${(t.subject || "").trim().toLowerCase()}|${(t.date || "").trim()}`;
    const testSet = new Set(nextTests.map(testKey));

    const summary = {
      processedRows: 0,
      byType: { ITEM: 0, TEST: 0, SETTING: 0, NOTES: 0, UNKNOWN: 0 },
      added: { sight: 0, spelling: 0, vocab: 0, tests: 0, settings: 0, notes: 0 },
      skipped: { itemDup: 0, testDup: 0, missingFields: 0, unknownType: 0 },
    };

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      summary.processedRows += 1;

      const recordType = normalize(getCell(row, recordTypeIdx)).toUpperCase();
      const listType = normalize(getCell(row, listTypeIdx)).toLowerCase();
      const term = normalize(getCell(row, termIdx));
      const def = normalize(getCell(row, defIdx));

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
        } else {
          summary.skipped.missingFields += 1;
        }
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
    setUpcomingTests(nextTests);

    const message =
      "Import complete.\n\n" +
      `Rows processed: ${summary.processedRows}\n` +
      `Records: ITEM ${summary.byType.ITEM}, TEST ${summary.byType.TEST}, SETTING ${summary.byType.SETTING}, NOTES ${summary.byType.NOTES}\n\n` +
      "Added:\n" +
      `  Sight: ${summary.added.sight}\n` +
      `  Spelling: ${summary.added.spelling}\n` +
      `  Vocab: ${summary.added.vocab}\n` +
      `  Tests: ${summary.added.tests}\n` +
      `  Settings applied: ${summary.added.settings}\n` +
      `  Notes updated: ${summary.added.notes}\n\n` +
      "Skipped:\n" +
      `  Duplicate items: ${summary.skipped.itemDup}\n` +
      `  Duplicate tests: ${summary.skipped.testDup}\n` +
      `  Missing required fields: ${summary.skipped.missingFields}\n` +
      `  Unknown/invalid rows: ${summary.skipped.unknownType}`;

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

  const deleteFromList = (type, index) => {
    if (type === "sight") setCustomSightWords((prev) => prev.filter((_, i) => i !== index));
    if (type === "spelling") setCustomSpellingWords((prev) => prev.filter((_, i) => i !== index));
    if (type === "vocab") setCustomVocabWords((prev) => prev.filter((_, i) => i !== index));
  };

  /* ------------------------------ Today’s Games ------------------------------ */
  const startTodaysGames = () => {
    const sightSource = customSightWords.length ? customSightWords : DEFAULT_SIGHT_DECK.map((x) => x.word);
    const spellingSource = customSpellingWords;
    const vocabSource = customVocabWords.map((x) => x.word);

    const pickedSight = pickAdaptive("sight", sightSource, clampInt(weeklyGames.sightPerDay, 1, 50, 5));
    const pickedSpell = pickAdaptive("spelling", spellingSource, clampInt(weeklyGames.spellingPerDay, 1, 50, 5));
    const pickedVocab = pickAdaptive("vocab", vocabSource, clampInt(weeklyGames.vocabPerDay, 1, 50, 3));

    setTodayItems({ sight: pickedSight, spelling: pickedSpell, vocab: pickedVocab });
    setTodayGameIndex(0);
    setTodayCardIndex(0);
    setShowFlashcardAnswer(false);
    setCurrentView("today");
  };

  const gameTitle = (gameKey) => {
    if (gameKey === "sight") return "Sight Word Sprint";
    if (gameKey === "spelling") return "Spelling Challenge";
    if (gameKey === "vocab") return "Vocabulary Builder";
    if (gameKey === "math") return "Math Race";
    return "Game";
  };

  const renderTodaysGames = () => {
    const seq = weeklyGames.sequence || ["sight", "spelling", "vocab", "math"];
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
      if (gameKey === "math") return `Game ${todayGameIndex + 1} of ${seq.length}`;
      return `Card ${todayCardIndex + 1} of ${deck.length} • Game ${todayGameIndex + 1} of ${seq.length}`;
    };

    return (
      <div className="max-w-4xl mx-auto">
        <button onClick={() => setCurrentView("home")} className="mb-6 text-purple-800 hover:text-purple-900 font-semibold">
          ← Back to Home
        </button>

        <div className="bg-white rounded-3xl shadow-md border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="text-3xl font-extrabold text-gray-900">Today’s Games</h1>
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
            </div>
          </div>

          {gameKey === "math" ? (
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
          <button onClick={() => setCurrentView("home")} className="mb-6 text-purple-800 hover:text-purple-900 font-semibold">
            ← Back to Home
          </button>

          <h1 className="text-3xl font-extrabold text-gray-900 mb-6 text-center">Choose Flashcards</h1>

          <div className="grid md:grid-cols-3 gap-4">
            <button
              onClick={() => {
                setFlashcardMode("sight");
                setCurrentFlashcard(0);
                setShowFlashcardAnswer(false);
              }}
              className="bg-white rounded-3xl border border-gray-200 shadow-md p-6 text-left hover:bg-purple-50"
            >
              <div className="flex items-center gap-3 mb-2">
                <BookOpen className="text-purple-800" />
                <div className="text-xl font-extrabold text-gray-900">Sight Words</div>
              </div>
              <div className="text-gray-600 text-sm">Quick, high-frequency practice.</div>
            </button>

            <button
              onClick={() => {
                setFlashcardMode("spelling");
                setCurrentFlashcard(0);
                setShowFlashcardAnswer(false);
              }}
              className="bg-white rounded-3xl border border-gray-200 shadow-md p-6 text-left hover:bg-purple-50"
            >
              <div className="flex items-center gap-3 mb-2">
                <BookOpen className="text-purple-800" />
                <div className="text-xl font-extrabold text-gray-900">Spelling</div>
              </div>
              <div className="text-gray-600 text-sm">Weekly list review.</div>
            </button>

            <button
              onClick={() => {
                setFlashcardMode("vocab");
                setCurrentFlashcard(0);
                setShowFlashcardAnswer(false);
              }}
              className="bg-white rounded-3xl border border-gray-200 shadow-md p-6 text-left hover:bg-purple-50"
            >
              <div className="flex items-center gap-3 mb-2">
                <BookOpen className="text-purple-800" />
                <div className="text-xl font-extrabold text-gray-900">Vocabulary</div>
              </div>
              <div className="text-gray-600 text-sm">Word plus definition.</div>
            </button>
          </div>
        </div>
      );
    }

    const deck = flashcardDeck;
    const card = deck[currentFlashcard];

    if (!deck.length) {
      return (
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => {
              setFlashcardMode(null);
              setCurrentFlashcard(0);
              setShowFlashcardAnswer(false);
            }}
            className="mb-6 text-purple-800 hover:text-purple-900 font-semibold"
          >
            ← Back
          </button>

          <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-6 text-gray-800">
            No cards found. Add items on the Parents Page or import a CSV.
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => {
            setFlashcardMode(null);
            setCurrentFlashcard(0);
            setShowFlashcardAnswer(false);
          }}
          className="mb-6 text-purple-800 hover:text-purple-900 font-semibold"
        >
          ← Back
        </button>

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

  /* ------------------------------- Parents Page ------------------------------ */
  const renderParentsPage = () => (
    <div className="max-w-6xl mx-auto">
      <button onClick={() => setCurrentView("home")} className="mb-6 text-purple-800 hover:text-purple-900 font-semibold">
        ← Back to Home
      </button>

      <h1 className="text-4xl font-extrabold text-gray-900 mb-6 text-center">Parents Page</h1>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* CSV Import */}
        <div className="bg-white rounded-3xl shadow-md p-6 border border-gray-200">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Import Teacher Plan (CSV)</h2>
          <p className="text-gray-600 mb-4">
            Import a structured CSV to update tests, lists, weekly games, and notes.
          </p>

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
              <li><strong>ITEM</strong>: list_type = sight | spelling | vocab (term, definition for vocab)</li>
              <li><strong>TEST</strong>: test_name (or name), test_subject (or subject), test_date (or date)</li>
              <li><strong>SETTING</strong>: setting_key, setting_value</li>
              <li><strong>NOTES</strong>: notes</li>
            </ul>
          </div>

          {lastImportSummary && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-2xl p-4 text-sm text-green-900">
              <div className="font-extrabold mb-2">Last import summary</div>
              <div className="grid grid-cols-2 gap-2">
                <div>Rows: <strong>{lastImportSummary.processedRows}</strong></div>
                <div>Added tests: <strong>{lastImportSummary.added.tests}</strong></div>
                <div>Added sight: <strong>{lastImportSummary.added.sight}</strong></div>
                <div>Added spelling: <strong>{lastImportSummary.added.spelling}</strong></div>
                <div>Added vocab: <strong>{lastImportSummary.added.vocab}</strong></div>
                <div>Settings applied: <strong>{lastImportSummary.added.settings}</strong></div>
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
                onChange={(e) => setWeeklyGames((p) => ({ ...p, spellingPerDay: clampInt(e.target.value, 1, 50, 5) }))}
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
              Math rounds per day
              <input
                type="number"
                value={weeklyGames.mathProblemsPerDay}
                min={1}
                max={50}
                onChange={(e) => setWeeklyGames((p) => ({ ...p, mathProblemsPerDay: clampInt(e.target.value, 1, 50, 5) }))}
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
              <button onClick={addSightWord} className="px-4 py-2 rounded-2xl bg-purple-700 hover:bg-purple-800 text-white font-extrabold">
                <Plus size={18} />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {customSightWords.map((w, i) => (
                <span key={`${w}-${i}`} className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-full text-sm">
                  {w}
                  <button onClick={() => deleteFromList("sight", i)} className="text-gray-500 hover:text-gray-900" aria-label="remove">
                    ×
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
              <button onClick={addSpellingWord} className="px-4 py-2 rounded-2xl bg-purple-700 hover:bg-purple-800 text-white font-extrabold">
                <Plus size={18} />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {customSpellingWords.map((w, i) => (
                <span key={`${w}-${i}`} className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-full text-sm">
                  {w}
                  <button onClick={() => deleteFromList("spelling", i)} className="text-gray-500 hover:text-gray-900" aria-label="remove">
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Vocab */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="font-extrabold text-gray-900">Vocabulary</div>
              <div className="text-sm text-gray-600">{customVocabWords.length} items</div>
            </div>

            <div className="grid md:grid-cols-2 gap-2">
              <input value={newVocabWord} onChange={(e) => setNewVocabWord(e.target.value)} placeholder="Vocab word" className="px-4 py-2 border border-gray-200 rounded-2xl" />
              <input value={newVocabDef} onChange={(e) => setNewVocabDef(e.target.value)} placeholder="Definition" className="px-4 py-2 border border-gray-200 rounded-2xl" />
            </div>

            <button onClick={addVocabWord} className="mt-2 w-full px-4 py-2 rounded-2xl bg-purple-700 hover:bg-purple-800 text-white font-extrabold">
              Add Vocabulary
            </button>

            <div className="mt-3 space-y-2">
              {customVocabWords.map((v, i) => (
                <div key={`${v.word}-${i}`} className="bg-gray-50 border border-gray-200 rounded-2xl p-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-extrabold text-gray-900">{v.word}</div>
                    <div className="text-sm text-gray-700">{v.def || <span className="text-gray-400">No definition</span>}</div>
                  </div>
                  <button onClick={() => deleteFromList("vocab", i)} className="text-gray-500 hover:text-gray-900" aria-label="remove">
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tests */}
        <div className="bg-white rounded-3xl shadow-md p-6 border border-gray-200">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-4 flex items-center gap-2">
            <Calendar size={22} className="text-purple-800" />
            Tests & Quizzes
          </h2>

          <div className="space-y-2 mb-4">
            <input type="text" value={newTestName} onChange={(e) => setNewTestName(e.target.value)} placeholder="Test / Quiz name" className="w-full px-4 py-2 border border-gray-200 rounded-2xl" />

            <select value={newTestSubject} onChange={(e) => setNewTestSubject(e.target.value)} className="w-full px-4 py-2 border border-gray-200 rounded-2xl">
              <option value="Math">Math</option>
              <option value="Language Arts - Spelling">Language Arts - Spelling</option>
              <option value="Language Arts - Reading/Comprehension">Language Arts - Reading/Comprehension</option>
              <option value="Science">Science</option>
              <option value="Social Studies">Social Studies</option>
            </select>

            <input type="date" value={newTestDate} onChange={(e) => setNewTestDate(e.target.value)} className="w-full px-4 py-2 border border-gray-200 rounded-2xl" />

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
                  <button onClick={() => deleteTest(i)} className="absolute top-2 right-2 text-gray-400 hover:text-gray-900" aria-label="delete">
                    ×
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
                    {new Date(test.date).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
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
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900">Hayden’s Homework</h1>
          <p className="text-gray-700 font-semibold mt-1">A simple routine that turns practice into progress.</p>
        </div>

        <button
          onClick={() => setCurrentView("parents")}
          className="text-sm text-purple-900 hover:text-purple-950 font-extrabold flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-gray-200"
        >
          <Settings size={16} /> Parents
        </button>
      </div>

      {/* Stars below title */}
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 bg-white border border-gray-200 px-5 py-2 rounded-full shadow-sm">
          <Star className="text-yellow-600" size={22} />
          <span className="font-extrabold text-gray-900">{points} Stars</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Student Planner */}
        <div className="lg:col-span-1">{renderStudentPlanner()}</div>

        {/* Right */}
        <div className="lg:col-span-2 space-y-6">
          {/* Today’s Games */}
          <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-6">
            <div className="flex items-center gap-3 mb-2">
              <Check className="text-purple-800" />
              <div className="text-2xl font-extrabold text-gray-900">Today’s Games</div>
            </div>
            <p className="text-gray-600 mb-4">A guided set of mini-games based on your weekly settings.</p>
            <button
              onClick={startTodaysGames}
              className="w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:opacity-95 text-white font-extrabold py-4 rounded-2xl"
            >
              Start Today’s Games
            </button>
          </div>

          {/* Flashcards */}
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

          {/* Games */}
          <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <Gamepad2 className="text-purple-800" />
              <div className="text-2xl font-extrabold text-gray-900">Games</div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { name: "Math Race", emoji: "🔢" },
                { name: "Vocabulary Match", emoji: "📚" },
                { name: "Phonics Match", emoji: "🎵" },
                { name: "Memory Game", emoji: "🧠" },
              ].map((game) => (
                <button
                  key={game.name}
                  onClick={() => {
                    setSelectedGame(game.name);
                    setCurrentView("game");
                  }}
                  className="bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl p-4 font-extrabold text-gray-900 text-left"
                >
                  <div className="text-2xl mb-2">{game.emoji}</div>
                  <div>{game.name}</div>
                </button>
              ))}
            </div>

            <div className="mt-4 text-sm text-gray-600">
              Tip: Start “Today’s Games” for a guided flow with adaptive review.
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  /* ---------------------------------- Game --------------------------------- */
  const renderGame = () => {
    if (selectedGame === "Math Race") {
      return (
        <MathRaceGame
          onBack={() => setCurrentView("home")}
          onDone={() => setCurrentView("today")}
          points={points}
          setPoints={setPoints}
          initialTopicId={weeklyGames.mathTopic}
          numProblems={weeklyGames.mathProblemsPerDay}
          autoStart={true}
        />
      );
    }

    return (
      <div className="max-w-4xl mx-auto text-center">
        <button onClick={() => setCurrentView("home")} className="mb-6 text-purple-800 hover:text-purple-900 font-semibold">
          ← Back to Home
        </button>

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
    </div>
  );
};

export default HomeworkGamesApp;
