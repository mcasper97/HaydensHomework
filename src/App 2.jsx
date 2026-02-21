import React, { useEffect, useMemo, useState } from 'react';
import {
  Upload,
  BookOpen,
  Brain,
  Gamepad2,
  Sparkles,
  Star,
  Trophy,
  Volume2,
  Check,
  X,
  Settings,
  Plus,
  Calendar,
  Bell,
} from 'lucide-react';

/* ----------------------------- Math Race Game ----------------------------- */
const MathRaceGame = ({ onBack, points, setPoints }) => {
  const [mathTopic, setMathTopic] = useState(null);
  const [currentProblem, setCurrentProblem] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [problems, setProblems] = useState([]);

  const mathTopics = [
    { id: 'addition-double', name: 'Addition (2-digit)', active: true },
    { id: 'subtraction-double', name: 'Subtraction (2-digit)', active: true },
    { id: 'addition-triple', name: 'Addition (3-digit)', active: true },
    { id: 'subtraction-triple', name: 'Subtraction (3-digit)', active: true },
    { id: 'line-graphing', name: 'Line Graphing', active: true },
    { id: 'multiplication-single', name: 'Multiplication (1-digit)', active: false },
    { id: 'multiplication-double', name: 'Multiplication (2-digit)', active: false },
    { id: 'division-single', name: 'Division (1-digit)', active: false },
  ];

  const generateProblems = (topicId) => {
    const probs = [];
    for (let i = 0; i < 10; i++) {
      if (topicId === 'addition-double') {
        const a = Math.floor(Math.random() * 90) + 10;
        const b = Math.floor(Math.random() * 90) + 10;
        probs.push({ num1: a, num2: b, operator: '+', answer: a + b, type: 'vertical' });
      } else if (topicId === 'subtraction-double') {
        const a = Math.floor(Math.random() * 90) + 10;
        const b = Math.floor(Math.random() * a);
        probs.push({ num1: a, num2: b, operator: '-', answer: a - b, type: 'vertical' });
      } else if (topicId === 'addition-triple') {
        const a = Math.floor(Math.random() * 900) + 100;
        const b = Math.floor(Math.random() * 900) + 100;
        probs.push({ num1: a, num2: b, operator: '+', answer: a + b, type: 'vertical' });
      } else if (topicId === 'subtraction-triple') {
        const a = Math.floor(Math.random() * 900) + 100;
        const b = Math.floor(Math.random() * a);
        probs.push({ num1: a, num2: b, operator: '-', answer: a - b, type: 'vertical' });
      } else if (topicId === 'line-graphing') {
        const x = Math.floor(Math.random() * 10) - 5;
        const y = Math.floor(Math.random() * 10) - 5;
        probs.push({
          question: 'What are the coordinates of this point?',
          x,
          y,
          answer: `${x},${y}`,
          type: 'graph',
        });
      }
    }
    return probs;
  };

  const startGame = (topicId) => {
    setMathTopic(topicId);
    setProblems(generateProblems(topicId));
    setCurrentProblem(0);
    setUserAnswer('');
    setShowResult(false);
    setScore(0);
    setGameOver(false);
  };

  const handleSubmit = () => {
    let correct;
    if (problems[currentProblem].type === 'graph') {
      const userCoords = userAnswer.replace(/\s/g, '').split(',');
      correct =
        userCoords.length === 2 &&
        parseInt(userCoords[0], 10) === problems[currentProblem].x &&
        parseInt(userCoords[1], 10) === problems[currentProblem].y;
    } else {
      correct = parseInt(userAnswer, 10) === problems[currentProblem].answer;
    }
    setIsCorrect(correct);
    setShowResult(true);
    if (correct) {
      setScore((s) => s + 10);
      setPoints((p) => p + 10);
    }
    setTimeout(() => {
      if (currentProblem < problems.length - 1) {
        setCurrentProblem((n) => n + 1);
        setUserAnswer('');
        setShowResult(false);
      } else {
        setGameOver(true);
      }
    }, 1500);
  };

  const resetGame = () => {
    setMathTopic(null);
    setProblems([]);
    setCurrentProblem(0);
    setUserAnswer('');
    setShowResult(false);
    setScore(0);
    setGameOver(false);
  };

  if (!mathTopic) {
    return (
      <div className="max-w-4xl mx-auto">
        <button
          onClick={onBack}
          className="mb-6 text-purple-700 hover:text-purple-800 font-bold bg-white px-4 py-2 rounded-full shadow"
        >
          ← Back to Home
        </button>
        <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-500 to-pink-500 mb-8 text-center drop-shadow-lg">
          Choose Your Math Topic! 🔢
        </h1>
        <div className="bg-white rounded-3xl shadow-xl p-6 border-4 border-pink-300">
          <div className="space-y-3">
            {mathTopics.map((topic) => (
              <button
                key={topic.id}
                onClick={() => topic.active && startGame(topic.id)}
                disabled={!topic.active}
                className={`w-full text-left px-6 py-4 rounded-2xl font-bold text-lg transition ${
                  topic.active
                    ? 'bg-gradient-to-r from-pink-400 to-purple-400 text-white hover:from-pink-500 hover:to-purple-500 shadow-lg hover:scale-105'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {topic.name} {!topic.active && '(Coming Soon)'}
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
        <div className="bg-white rounded-2xl shadow-lg p-12 border-4 border-yellow-200">
          <Trophy className="text-yellow-500 mx-auto mb-6" size={80} />
          <h2 className="text-4xl font-bold text-gray-800 mb-4">Amazing Math Skills!</h2>
          <p className="text-3xl text-purple-600 font-bold mb-6">Final Score: {score} points</p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={resetGame}
              className="bg-purple-500 hover:bg-purple-600 text-white font-bold py-3 px-8 rounded-xl"
            >
              Try Another Topic
            </button>
            <button
              onClick={onBack}
              className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-3 px-8 rounded-xl"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const problem = problems[currentProblem];

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={resetGame} className="mb-6 text-purple-600 hover:text-purple-700 font-semibold">
        ← Choose Different Topic
      </button>
      <div className="bg-white rounded-2xl shadow-lg p-8 border-4 border-pink-200">
        <div className="flex justify-between items-center mb-4">
          <div className="text-2xl font-bold text-pink-600">Score: {score}</div>
          <div className="text-lg text-gray-600">
            Problem {currentProblem + 1} of {problems.length}
          </div>
        </div>

        {problem.type === 'graph' ? (
          <div className="bg-gradient-to-r from-pink-100 to-purple-100 rounded-xl p-8 mb-6">
            <h2 className="text-2xl font-bold text-purple-700 mb-6 text-center">{problem.question}</h2>
            <div className="bg-white p-6 rounded-xl mb-6">
              <svg viewBox="-6 -6 12 12" className="w-full max-w-md mx-auto" style={{ transform: 'scaleY(-1)' }}>
                <line x1="-6" y1="0" x2="6" y2="0" stroke="#888" strokeWidth="0.05" />
                <line x1="0" y1="-6" x2="0" y2="6" stroke="#888" strokeWidth="0.05" />
                {[-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].map((n) => (
                  <g key={`x${n}`}>
                    <line x1={n} y1="-0.1" x2={n} y2="0.1" stroke="#888" strokeWidth="0.03" />
                    <text
                      x={n}
                      y="-0.3"
                      fontSize="0.4"
                      textAnchor="middle"
                      fill="#666"
                      transform="scale(1,-1)"
                    >
                      {n}
                    </text>
                  </g>
                ))}
                {[-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].map((n) => (
                  <g key={`y${n}`}>
                    <line x1="-0.1" y1={n} x2="0.1" y2={n} stroke="#888" strokeWidth="0.03" />
                    <text
                      x="-0.4"
                      y={n}
                      fontSize="0.4"
                      textAnchor="middle"
                      fill="#666"
                      transform="scale(1,-1)"
                    >
                      {n}
                    </text>
                  </g>
                ))}
                <circle cx={problem.x} cy={problem.y} r="0.3" fill="#e91e63" stroke="#c2185b" strokeWidth="0.1" />
              </svg>
            </div>
            <div className="text-center mb-4">
              <p className="text-gray-700 font-semibold mb-2">Enter coordinates as: x,y</p>
              <input
                type="text"
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !showResult && userAnswer && handleSubmit()}
                placeholder="Example: 3,4"
                disabled={showResult}
                className="w-48 px-6 py-3 text-2xl text-center border-4 border-pink-300 rounded-xl focus:outline-none focus:border-pink-500 font-bold"
              />
            </div>
          </div>
        ) : problem.type === 'vertical' ? (
          <div className="bg-gradient-to-r from-pink-100 to-purple-100 rounded-xl p-12 mb-6 flex flex-col items-center">
            <div className="bg-white rounded-xl p-8 shadow-lg mb-8">
              <div className="text-right font-mono">
                <div className="text-6xl font-bold text-purple-700 mb-2">{problem.num1}</div>
                <div className="flex items-center justify-end gap-4 text-6xl font-bold text-purple-700 mb-2">
                  <span>{problem.operator}</span>
                  <span>{problem.num2}</span>
                </div>
                <div className="border-t-4 border-purple-700 mb-3"></div>
                <input
                  type="number"
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !showResult && userAnswer && handleSubmit()}
                  placeholder="?"
                  disabled={showResult}
                  className="w-full text-6xl text-right font-bold border-4 border-pink-300 rounded-xl focus:outline-none focus:border-pink-500 px-4 py-2 bg-yellow-50"
                />
              </div>
            </div>
          </div>
        ) : null}

        <button
          onClick={handleSubmit}
          disabled={showResult || !userAnswer}
          className="w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:from-gray-300 disabled:to-gray-400 text-white font-bold py-4 px-6 rounded-xl text-xl"
        >
          Check Answer ✨
        </button>

        {showResult && (
          <div className={`mt-6 p-6 rounded-xl ${isCorrect ? 'bg-green-100' : 'bg-red-100'}`}>
            <p className={`text-2xl font-bold ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
              {isCorrect ? '✓ Correct! Great job!' : '✗ Not quite!'}
            </p>
            {!isCorrect && (
              <p className="text-xl text-gray-700 mt-2">
                The answer was:{' '}
                <strong>{problem.type === 'graph' ? `(${problem.x}, ${problem.y})` : problem.answer}</strong>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ----------------------------- Main App ----------------------------- */
const STORAGE_KEY = 'haydens_homework_app_v1';

const HomeworkGamesApp = () => {
  const [currentView, setCurrentView] = useState('home');
  const [selectedGame, setSelectedGame] = useState(null);
  const [points, setPoints] = useState(0);

  // Flashcards
  const [currentFlashcard, setCurrentFlashcard] = useState(0);
  const [showFlashcardAnswer, setShowFlashcardAnswer] = useState(false);
  const [flashcardMode, setFlashcardMode] = useState(null);

  // Custom lists
  const [customSightWords, setCustomSightWords] = useState([]);
  const [newSightWord, setNewSightWord] = useState('');

  const [customSpellingWords, setCustomSpellingWords] = useState([]);
  const [newSpellingWord, setNewSpellingWord] = useState('');

  const [customVocabWords, setCustomVocabWords] = useState([]); // {word, def}
  const [newVocabWord, setNewVocabWord] = useState('');
  const [newVocabDef, setNewVocabDef] = useState('');

  // Tests
  const [upcomingTests, setUpcomingTests] = useState([]);
  const [newTestName, setNewTestName] = useState('');
  const [newTestSubject, setNewTestSubject] = useState('Math');
  const [newTestDate, setNewTestDate] = useState('');

  /* ------------------------- Persistence (localStorage) ------------------------- */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const data = JSON.parse(saved);

      if (typeof data.points === 'number') setPoints(data.points);
      if (Array.isArray(data.customSightWords)) setCustomSightWords(data.customSightWords);
      if (Array.isArray(data.customSpellingWords)) setCustomSpellingWords(data.customSpellingWords);
      if (Array.isArray(data.customVocabWords)) setCustomVocabWords(data.customVocabWords);
      if (Array.isArray(data.upcomingTests)) setUpcomingTests(data.upcomingTests);
    } catch (e) {
      // If storage is corrupted, we just start fresh.
      console.warn('Storage load failed:', e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          points,
          customSightWords,
          customSpellingWords,
          customVocabWords,
          upcomingTests,
        })
      );
    } catch (e) {
      console.warn('Storage save failed:', e);
    }
  }, [points, customSightWords, customSpellingWords, customVocabWords, upcomingTests]);

  /* ---------------------------- Upcoming reminders ---------------------------- */
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

    if (diffDays === 0) return 'Today!';
    if (diffDays === 1) return 'Tomorrow!';
    return `in ${diffDays} days`;
  };

  /* --------------------------------- Tests --------------------------------- */
  const addTest = () => {
    if (newTestName.trim() && newTestDate) {
      setUpcomingTests((prev) => [
        ...prev,
        { name: newTestName.trim(), subject: newTestSubject, date: newTestDate },
      ]);
      setNewTestName('');
      setNewTestSubject('Math');
      setNewTestDate('');
    }
  };

  const deleteTest = (index) => {
    setUpcomingTests((prev) => prev.filter((_, i) => i !== index));
  };

  /* ------------------------------ Word management ------------------------------ */
  const normalizeWord = (w) => w.trim().replace(/\s+/g, ' ');

  const addSightWord = () => {
    const w = normalizeWord(newSightWord);
    if (!w) return;
    setCustomSightWords((prev) => {
      const set = new Set(prev.map((x) => x.toLowerCase()));
      if (set.has(w.toLowerCase())) return prev; // prevent duplicates
      return [...prev, w];
    });
    setNewSightWord('');
  };

  const deleteSightWord = (index) => setCustomSightWords((prev) => prev.filter((_, i) => i !== index));

  const addSpellingWord = () => {
    const w = normalizeWord(newSpellingWord);
    if (!w) return;
    setCustomSpellingWords((prev) => {
      const set = new Set(prev.map((x) => x.toLowerCase()));
      if (set.has(w.toLowerCase())) return prev;
      return [...prev, w];
    });
    setNewSpellingWord('');
  };

  const deleteSpellingWord = (index) => setCustomSpellingWords((prev) => prev.filter((_, i) => i !== index));

  const addVocabWord = () => {
    const w = normalizeWord(newVocabWord);
    const d = normalizeWord(newVocabDef);
    if (!w) return;
    setCustomVocabWords((prev) => {
      const set = new Set(prev.map((x) => x.word.toLowerCase()));
      if (set.has(w.toLowerCase())) return prev;
      return [...prev, { word: w, def: d }];
    });
    setNewVocabWord('');
    setNewVocabDef('');
  };

  const deleteVocabWord = (index) => setCustomVocabWords((prev) => prev.filter((_, i) => i !== index));

  /* ------------------------------ Flashcard data ------------------------------ */
  const fallbackSightWords = useMemo(
    () => ['the', 'and', 'is', 'you', 'to', 'was', 'said', 'they', 'have', 'from'],
    []
  );

  const sightWordDeck = useMemo(() => {
    const base = customSightWords.length > 0 ? customSightWords : fallbackSightWords;
    return base.map((w) => ({ word: w, sentence: `Use "${w}" in a sentence.` }));
  }, [customSightWords, fallbackSightWords]);

  const spellingDeck = useMemo(() => customSpellingWords.map((w) => ({ word: w })), [customSpellingWords]);

  const vocabDeck = useMemo(() => customVocabWords.map((v) => ({ word: v.word, def: v.def })), [customVocabWords]);

  const playSound = (text) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.85;
    u.pitch = 1.1;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  };

  const resetFlashcards = (mode) => {
    setFlashcardMode(mode);
    setCurrentFlashcard(0);
    setShowFlashcardAnswer(false);
  };

  const nextCard = (deckLength) => {
    if (currentFlashcard < deckLength - 1) {
      setCurrentFlashcard((n) => n + 1);
      setShowFlashcardAnswer(false);
      setPoints((p) => p + 2);
    }
  };

  const prevCard = () => {
    setCurrentFlashcard((n) => Math.max(0, n - 1));
    setShowFlashcardAnswer(false);
  };

  /* -------------------------------- Parents page -------------------------------- */
  const renderParentsPage = () => (
    <div className="max-w-6xl mx-auto">
      <button onClick={() => setCurrentView('home')} className="mb-6 text-purple-600 hover:text-purple-700 font-semibold">
        ← Back to Home
      </button>

      <h1 className="text-4xl font-bold text-purple-600 mb-8 text-center">Parents Page</h1>

      <div className="space-y-6">
        {/* Tests */}
        <div className="bg-white rounded-2xl shadow-lg p-6 border-4 border-orange-200">
          <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Calendar size={24} className="text-orange-500" />
            Upcoming Tests & Quizzes
          </h2>

          <div className="space-y-2 mb-4">
            <input
              type="text"
              value={newTestName}
              onChange={(e) => setNewTestName(e.target.value)}
              placeholder="Test/Quiz/Assessment name"
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg"
            />
            <select
              value={newTestSubject}
              onChange={(e) => setNewTestSubject(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg"
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
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg"
            />
            <button onClick={addTest} className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-6 rounded-lg w-full">
              Add Test/Quiz
            </button>
          </div>

          <div className="space-y-2">
            {upcomingTests
              .slice()
              .sort((a, b) => new Date(a.date) - new Date(b.date))
              .map((test, i) => (
                <div key={i} className="relative group bg-orange-50 p-3 rounded-lg">
                  <button
                    onClick={() => deleteTest(i)}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition"
                    aria-label="Delete test"
                  >
                    ×
                  </button>
                  <p className="font-bold text-orange-700">{test.name}</p>
                  <p className="text-sm text-gray-600">{test.subject}</p>
                  <p className="text-sm text-orange-600 font-semibold">
                    {new Date(test.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </p>
                </div>
              ))}
            {upcomingTests.length === 0 && <p className="text-gray-500">No tests added yet.</p>}
          </div>
        </div>

        {/* Word lists */}
        <div className="grid md:grid-cols-3 gap-6">
          {/* Sight words */}
          <div className="bg-white rounded-2xl shadow-lg p-6 border-4 border-blue-200">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Sparkles size={24} className="text-blue-500" />
              Sight Words
            </h2>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newSightWord}
                onChange={(e) => setNewSightWord(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSightWord()}
                placeholder="Add a sight word"
                className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-lg"
              />
              <button
                onClick={addSightWord}
                className="bg-blue-500 hover:bg-blue-600 text-white font-bold px-4 rounded-lg"
                aria-label="Add sight word"
              >
                <Plus size={18} />
              </button>
            </div>

            <div className="space-y-2">
              {customSightWords.map((w, i) => (
                <div key={i} className="relative group bg-blue-50 p-3 rounded-lg">
                  <button
                    onClick={() => deleteSightWord(i)}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition"
                    aria-label="Delete sight word"
                  >
                    ×
                  </button>
                  <p className="font-bold text-blue-700">{w}</p>
                </div>
              ))}
              {customSightWords.length === 0 && <p className="text-gray-500">No custom sight words yet.</p>}
            </div>
          </div>

          {/* Weekly spelling */}
          <div className="bg-white rounded-2xl shadow-lg p-6 border-4 border-green-200">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <BookOpen size={24} className="text-green-600" />
              Weekly Spelling
            </h2>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newSpellingWord}
                onChange={(e) => setNewSpellingWord(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSpellingWord()}
                placeholder="Add a spelling word"
                className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-lg"
              />
              <button
                onClick={addSpellingWord}
                className="bg-green-500 hover:bg-green-600 text-white font-bold px-4 rounded-lg"
                aria-label="Add spelling word"
              >
                <Plus size={18} />
              </button>
            </div>

            <div className="space-y-2">
              {customSpellingWords.map((w, i) => (
                <div key={i} className="relative group bg-green-50 p-3 rounded-lg">
                  <button
                    onClick={() => deleteSpellingWord(i)}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition"
                    aria-label="Delete spelling word"
                  >
                    ×
                  </button>
                  <p className="font-bold text-green-700">{w}</p>
                </div>
              ))}
              {customSpellingWords.length === 0 && <p className="text-gray-500">No spelling words yet.</p>}
            </div>
          </div>

          {/* Vocabulary */}
          <div className="bg-white rounded-2xl shadow-lg p-6 border-4 border-purple-200">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Brain size={24} className="text-purple-600" />
              Vocabulary
            </h2>

            <div className="space-y-2 mb-4">
              <input
                type="text"
                value={newVocabWord}
                onChange={(e) => setNewVocabWord(e.target.value)}
                placeholder="Word"
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg"
              />
              <input
                type="text"
                value={newVocabDef}
                onChange={(e) => setNewVocabDef(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addVocabWord()}
                placeholder="Definition (optional)"
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg"
              />
              <button
                onClick={addVocabWord}
                className="bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-6 rounded-lg w-full"
              >
                Add Vocabulary
              </button>
            </div>

            <div className="space-y-2">
              {customVocabWords.map((item, i) => (
                <div key={i} className="relative group bg-purple-50 p-3 rounded-lg">
                  <button
                    onClick={() => deleteVocabWord(i)}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition"
                    aria-label="Delete vocabulary"
                  >
                    ×
                  </button>
                  <p className="font-bold text-purple-700">{item.word}</p>
                  {item.def && <p className="text-sm text-gray-600">{item.def}</p>}
                </div>
              ))}
              {customVocabWords.length === 0 && <p className="text-gray-500">No vocabulary words yet.</p>}
            </div>
          </div>
        </div>

        {/* Quick governance: view health */}
        <div className="bg-white rounded-2xl shadow-lg p-6 border-4 border-gray-200">
          <h3 className="text-xl font-bold text-gray-800 mb-2">System Status</h3>
          <p className="text-gray-600">
            Sight Words: <strong>{customSightWords.length}</strong> • Spelling: <strong>{customSpellingWords.length}</strong> • Vocabulary: <strong>{customVocabWords.length}</strong>
          </p>
          <p className="text-gray-500 text-sm mt-2">
            These lists are saved in your browser (localStorage). If you clear browser data, the lists will reset.
          </p>
        </div>
      </div>
    </div>
  );

  /* --------------------------------- Home --------------------------------- */
  const renderHome = () => {
    const upcomingReminders = getUpcomingReminders();

    return (
      <div className="max-w-4xl mx-auto">
        <div className="text-right mb-4">
          <button
            onClick={() => setCurrentView('parents')}
            className="text-sm text-purple-700 hover:text-purple-800 font-bold flex items-center gap-1 ml-auto bg-white px-3 py-1 rounded-full shadow"
          >
            <Settings size={16} />
            Parents
          </button>
        </div>

        {upcomingReminders.length > 0 && (
          <div className="mb-6 bg-gradient-to-r from-yellow-100 to-orange-100 border-4 border-yellow-400 rounded-2xl p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="text-orange-600" size={24} />
              <h3 className="text-xl font-bold text-orange-800">Upcoming Tests & Quizzes!</h3>
            </div>
            <div className="space-y-2">
              {upcomingReminders.map((test, i) => {
                const daysUntil = getDaysUntil(test.date);
                return (
                  <div
                    key={i}
                    className={`p-3 rounded-lg ${
                      daysUntil === 'Tomorrow!'
                        ? 'bg-red-100 border-2 border-red-400'
                        : daysUntil === 'Today!'
                        ? 'bg-red-200 border-2 border-red-500'
                        : 'bg-white border-2 border-yellow-300'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold text-gray-800">{test.name}</p>
                        <p className="text-sm text-gray-600">{test.subject}</p>
                      </div>
                      <span
                        className={`font-bold px-3 py-1 rounded-full text-sm ${
                          daysUntil === 'Tomorrow!'
                            ? 'bg-red-500 text-white'
                            : daysUntil === 'Today!'
                            ? 'bg-red-600 text-white'
                            : 'bg-orange-500 text-white'
                        }`}
                      >
                        {daysUntil}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-gradient-to-r from-yellow-200 to-yellow-300 px-6 py-3 rounded-full mb-6 shadow-lg">
            <Star className="text-yellow-600" size={28} />
            <span className="font-bold text-yellow-800 text-xl">{points} Stars!</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-500 to-pink-500 mb-3 drop-shadow-lg">
            ✨ Hayden&apos;s Homework ✨
          </h1>
          <p className="text-purple-700 text-xl font-semibold">Let&apos;s learn and have fun!</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-gradient-to-br from-pink-100 to-pink-200 rounded-3xl shadow-xl p-6 border-4 border-pink-300 relative">
            <div className="absolute inset-0 bg-gray-300 bg-opacity-60 rounded-3xl flex items-center justify-center z-10">
              <span className="text-3xl font-bold text-purple-600 transform -rotate-12 bg-white px-6 py-3 rounded-xl shadow-lg">
                Coming Soon! 🎀
              </span>
            </div>
            <div className="flex items-center gap-3 mb-4 opacity-40">
              <Upload className="text-pink-600" size={36} />
              <h2 className="text-2xl font-bold text-gray-800">Upload Homework</h2>
            </div>
          </div>

          <div
            onClick={() => {
              setCurrentView('flashcards');
              setFlashcardMode(null);
              setCurrentFlashcard(0);
              setShowFlashcardAnswer(false);
            }}
            className="bg-gradient-to-br from-purple-100 to-purple-200 rounded-3xl shadow-xl p-6 border-4 border-purple-300 cursor-pointer hover:scale-105 transition"
          >
            <div className="flex items-center gap-3 mb-4">
              <BookOpen className="text-purple-600" size={36} />
              <h2 className="text-2xl font-bold text-gray-800">Flashcards 📚</h2>
            </div>
            <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-4 px-6 rounded-2xl text-center text-lg shadow-lg">
              Start Practice! ✨
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-pink-100 to-purple-100 rounded-3xl shadow-xl p-6 border-4 border-pink-300">
          <div className="flex items-center gap-3 mb-6">
            <Gamepad2 className="text-pink-600" size={36} />
            <h2 className="text-3xl font-bold text-gray-800">Fun Games! 🎮</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: 'Math Race', emoji: '🔢', colors: 'from-pink-400 to-pink-600' },
              { name: 'Vocabulary Match', emoji: '📚', colors: 'from-purple-400 to-purple-600' },
              { name: 'Phonics Match', emoji: '🎵', colors: 'from-pink-500 to-purple-500' },
              { name: 'Memory Game', emoji: '🧠', colors: 'from-purple-500 to-pink-500' },
            ].map((game) => (
              <button
                key={game.name}
                onClick={() => {
                  setSelectedGame(game.name);
                  setCurrentView('game');
                }}
                className={`bg-gradient-to-br ${game.colors} text-white font-bold py-6 px-4 rounded-2xl hover:scale-105 transition shadow-lg text-lg`}
              >
                <div className="text-3xl mb-2">{game.emoji}</div>
                {game.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  /* ------------------------------ Flashcards UI ------------------------------ */
  const renderFlashcards = () => {
    if (!flashcardMode) {
      return (
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => setCurrentView('home')}
            className="mb-6 text-purple-600 hover:text-purple-700 font-semibold"
          >
            ← Back to Home
          </button>

          <h1 className="text-4xl font-bold text-purple-600 mb-8 text-center">Choose Flashcards</h1>

          <div className="grid md:grid-cols-3 gap-6">
            <div
              onClick={() => resetFlashcards('sight')}
              className="bg-white rounded-2xl shadow-lg p-8 border-4 border-blue-200 cursor-pointer hover:scale-105 transition"
            >
              <Sparkles className="text-blue-500 mb-4" size={48} />
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Sight Words</h2>
              <p className="text-gray-600">Practice quick reading words</p>
              <p className="text-sm text-gray-500 mt-3">
                Deck size: <strong>{sightWordDeck.length}</strong>
              </p>
            </div>

            <div
              onClick={() => resetFlashcards('spelling')}
              className="bg-white rounded-2xl shadow-lg p-8 border-4 border-green-200 cursor-pointer hover:scale-105 transition"
            >
              <BookOpen className="text-green-600 mb-4" size={48} />
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Weekly Spelling</h2>
              <p className="text-gray-600">Spell and say each word</p>
              <p className="text-sm text-gray-500 mt-3">
                Deck size: <strong>{spellingDeck.length}</strong>
              </p>
              {spellingDeck.length === 0 && (
                <p className="text-xs text-orange-600 mt-2 font-semibold">Add words on Parents Page</p>
              )}
            </div>

            <div
              onClick={() => resetFlashcards('vocab')}
              className="bg-white rounded-2xl shadow-lg p-8 border-4 border-purple-200 cursor-pointer hover:scale-105 transition"
            >
              <Brain className="text-purple-600 mb-4" size={48} />
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Vocabulary</h2>
              <p className="text-gray-600">Learn word meanings</p>
              <p className="text-sm text-gray-500 mt-3">
                Deck size: <strong>{vocabDeck.length}</strong>
              </p>
              {vocabDeck.length === 0 && <p className="text-xs text-orange-600 mt-2 font-semibold">Add words on Parents Page</p>}
            </div>
          </div>
        </div>
      );
    }

    const deck =
      flashcardMode === 'sight' ? sightWordDeck : flashcardMode === 'spelling' ? spellingDeck : vocabDeck;

    const card = deck[currentFlashcard];

    return (
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => {
            setFlashcardMode(null);
            setCurrentFlashcard(0);
            setShowFlashcardAnswer(false);
          }}
          className="mb-6 text-purple-600 hover:text-purple-700 font-semibold"
        >
          ← Back
        </button>

        <div className="text-center mb-4">
          <p className="text-gray-600">
            Card {Math.min(currentFlashcard + 1, deck.length)} of {deck.length}
          </p>
        </div>

        <div
          onClick={() => setShowFlashcardAnswer((s) => !s)}
          className="bg-white rounded-3xl shadow-2xl p-10 border-8 border-purple-200 cursor-pointer hover:scale-105 transition min-h-[360px] flex flex-col items-center justify-center"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              playSound(card.word);
            }}
            className="mb-6 bg-purple-500 text-white p-4 rounded-full hover:bg-purple-600"
            aria-label="Speak"
          >
            <Volume2 size={32} />
          </button>

          <h2 className="text-6xl font-bold text-purple-700 mb-6 text-center">{card.word}</h2>

          {showFlashcardAnswer && (
            <div className="text-center">
              {flashcardMode === 'sight' && <p className="text-xl text-gray-700 italic">{card.sentence}</p>}
              {flashcardMode === 'spelling' && (
                <p className="text-xl text-gray-700 italic">Spell it out loud, then write it on paper.</p>
              )}
              {flashcardMode === 'vocab' && (
                <p className="text-xl text-gray-700 italic">{card.def ? card.def : 'Tap to add a definition on Parents Page.'}</p>
              )}
            </div>
          )}

          <p className="text-sm text-gray-500 mt-6">Tap the card to show or hide the answer.</p>
        </div>

        <div className="flex gap-4 mt-6">
          <button
            onClick={prevCard}
            disabled={currentFlashcard === 0}
            className="flex-1 bg-gray-300 hover:bg-gray-400 disabled:bg-gray-200 text-gray-800 font-bold py-3 px-6 rounded-xl"
          >
            Previous
          </button>
          <button
            onClick={() => nextCard(deck.length)}
            disabled={currentFlashcard >= deck.length - 1}
            className="flex-1 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 text-white font-bold py-3 px-6 rounded-xl"
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  /* -------------------------------- Render -------------------------------- */
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-200 via-purple-200 to-pink-300 p-4 md:p-8">
      {currentView === 'home' && renderHome()}
      {currentView === 'parents' && renderParentsPage()}
      {currentView === 'flashcards' && renderFlashcards()}

      {currentView === 'game' && selectedGame === 'Math Race' && (
        <MathRaceGame onBack={() => setCurrentView('home')} points={points} setPoints={setPoints} />
      )}

      {currentView === 'game' && selectedGame !== 'Math Race' && (
        <div className="max-w-4xl mx-auto text-center">
          <button onClick={() => setCurrentView('home')} className="mb-6 text-purple-600 hover:text-purple-700 font-semibold">
            ← Back to Home
          </button>
          <div className="bg-white rounded-2xl shadow-lg p-12 border-4 border-green-200">
            <Trophy className="text-yellow-500 mx-auto mb-6" size={64} />
            <h2 className="text-3xl font-bold text-gray-800 mb-4">{selectedGame}</h2>
            <p className="text-xl text-gray-600 mb-8">Game coming soon!</p>
            <p className="text-gray-500">We can wire this up next using your custom word lists.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomeworkGamesApp;
