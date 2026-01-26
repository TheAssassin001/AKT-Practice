/*
============================================================
  AKT PRACTICE - QUESTION MANAGEMENT SYSTEM
============================================================
  PHASE 1 COMPLETE
  - Supabase integration is complete
  - Question fetching is stable and robust
  - No further frontend logic changes should be made before authentication
  - This marks the end of Phase 1
============================================================
*/

// === CONSTANTS ===
const SECONDS_PER_QUESTION = 60;
const AUTO_SAVE_INTERVAL = 5; // Save every 5 seconds during exam
const STORAGE_KEY = 'quizStateV3';
const WEAK_TOPICS_KEY = 'weakTopics';
const FLAGGED_QUESTIONS_KEY = 'akt-flagged-questions';
const DISTINCTION_THRESHOLD = 0.8;
const WEAK_TOPIC_THRESHOLD = 0.7;
const SMART_REVISION_LIMIT = 20;

// === AUTHENTICATION PLACEHOLDERS ===
// The following routes/functions will require login in the future.
// TODO: Implement authentication and user session management.

// --- Allow safe reload of questions while app is running ---
// This can be called to refresh questions from Supabase at any time.
async function reloadQuestions() {
  await loadQuestionsFromSupabase();

  // Re-filter questions based on current selection
  if (selectedType === 'sba') {
    questions = allQuestions.filter(q => q.type === 'sba');
  } else if (selectedType === 'emq') {
    questions = allQuestions.filter(q => q.type === 'emq');
  } else {
    questions = [...allQuestions];
  }

  // Re-initialize state if new questions are added or order changes
  questionStates = questions.map(q => ({
    status: 'not-attempted',
    flagged: false,
    answer:
      q.type === 'sba' ? null :
        q.type === 'emq' ? (q.stems ? Array(q.stems.length).fill(null) : []) :
          q.type === 'numeric' ? null : null
  }));
  examDuration = 60 * questions.length;
  currentQuestion = 0;
  currentEmqStem = 0;
  testEnded = false;
  totalScore = 0;
  totalPossible = 0;
  // Optionally, rerender or reset UI here if needed
  if (questions.length === 0) {
    const section = document.getElementById('question-section');
    if (section) {
      section.innerHTML = '<div class="error-message">No questions are available at this time for the selected type.</div>';
    }
    console.error('No questions loaded after reload.');
    return;
  }
  renderQuestion();
}
// === DATA SOURCE: Supabase ===
// All question data is loaded from Supabase and normalized here.
// Backend changes to data structure do NOT affect frontend exam behaviour logic.
import { supabase } from './supabase.js';

let allQuestions = [];
let questions = [];
let questionsLoading = true;

// --- State variables ---
let questionStates = [];
let testEnded = false;
let currentQuestion = 0;
let currentEmqStem = 0;
let totalScore = 0;
let totalPossible = 0;
let quizMode = null;
let selectedType = 'mixed';
let examDuration = 0;
let timeLeft = null;
let timerInterval = null;
let reviewMode = false;
let currentQuestionCleanup = null;
let quizCleared = false; // Lock flag to prevent re-saving after clear

// Standard Fisher-Yates shuffle
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// --- Supabase fetch and normalization ---
// This function ONLY loads and normalizes data. It does NOT control exam behaviour.
async function loadQuestionsFromSupabase() {
  // TODO: Restrict this query to authenticated users only in the future.
  questionsLoading = true;
  try {
    const { data, error } = await supabase
      .from('questions')
      .select('*');
    if (error) {
      console.error('Supabase fetch error:', error);
      handleError('loadQuestionsFromSupabase', error, 'Failed to load questions from database');
      questions = [];
    } else {
      // Normalize each row to the expected question object format
      const questions_data = data.map((row, idx) => {
        let q = { ...row };
        if (q.type) q.type = q.type.toLowerCase();

        // Helper for safe JSON parsing
        const safeParse = (val, fallback = []) => {
          if (!val) return fallback;
          if (typeof val !== 'string') return val;
          // Simple check: Valid JSON collections start with { or [
          const trimmed = val.trim();
          if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            // If it's not a JSON collection, return it as a string instead of trying to parse
            return val;
          }
          try {
            return JSON.parse(val);
          } catch (e) {
            // Final fallback: if it failed to parse but looks like it should have been JSON
            console.warn(`Question ${idx}: Failed to parse JSON string: "${val.substring(0, 20)}..."`, e);
            return val;
          }
        };

        // 1. Handle potential nesting in 'stem' field (Assumption A)
        if (q.type === 'emq' && q.stem) {
          let stemData = q.stem;
          if (typeof q.stem === 'string') {
            stemData = safeParse(q.stem, null);
          }

          if (stemData && typeof stemData === 'object') {
            q.theme = q.theme || stemData.theme;
            q.options = q.options || stemData.options;
            q.stems = q.stems || stemData.stems;
          }
        }

        // 2. Normalize and Parse core fields
        q.options = safeParse(q.options, []);
        q.stems = safeParse(q.stems, []);
        q.furtherReading = safeParse(q.furtherReading, []);

        // Normalize correct_answer
        if (typeof q.correct_answer === 'string') {
          const trimmed = q.correct_answer.trim();
          // Case 1: "0", "1", "2" (Numeric string)
          if (/^\d+$/.test(trimmed)) {
            q.correct = parseInt(trimmed, 10);
          }
          // Case 2: "A", "B", "C" (Letter)
          else if (/^[A-Ei]$/i.test(trimmed)) {
            // 'i' might be used for latin? mostly A-E
            const code = trimmed.toUpperCase().charCodeAt(0);
            q.correct = code - 65; // A=0, B=1...
          }
          // Case 3: JSON Array/Object (old logic)
          else {
            q.correct = safeParse(q.correct_answer, null);
          }

          // Case 4: Text Match (Fallback)
          // If q.correct is still null/invalid, try to match text against options
          if ((q.correct === null || typeof q.correct !== 'number') && Array.isArray(q.options)) {
            const lowerCorrect = trimmed.toLowerCase();
            const matchIdx = q.options.findIndex(opt => opt.trim().toLowerCase() === lowerCorrect);
            if (matchIdx !== -1) {
              q.correct = matchIdx;
            }
          }
        } else {
          q.correct = q.correct_answer !== undefined ? q.correct_answer : null;
        }

        // Numeric specific normalization
        if (q.type === 'numeric') {
          // Map to the expected property name
          let rawCorrect = q.correct !== null ? q.correct : q.correct_answer;

          if (typeof rawCorrect === 'object' && rawCorrect !== null) {
            // Handle if answer is wrapped in an object { value: 20 } or { answer: 20 }
            q.correctAnswer = parseFloat(rawCorrect.value || rawCorrect.answer || rawCorrect.correct || 0);
          } else {
            q.correctAnswer = parseFloat(rawCorrect) || 0;
          }

          q.tolerance = parseFloat(q.tolerance) || 0;
        } else if (q.type === 'numeric' && q.tolerance) {
          // Keep existing tolerance parsing just in case
          q.tolerance = parseFloat(q.tolerance) || 0;
        }

        // MBA Specific normalization
        if (q.type === 'mba') {
          console.log(`MBA Question ${idx} - Before normalization:`, {
            correct: q.correct,
            correct_answer: q.correct_answer,
            type: typeof q.correct,
            isArray: Array.isArray(q.correct)
          });

          // Ensure correct is an array
          if (!Array.isArray(q.correct)) {
            if (typeof q.correct === 'string') {
              // Try comma separation if not JSON
              if (q.correct.includes(',')) {
                q.correct = q.correct.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
              } else {
                const parsed = parseInt(q.correct);
                q.correct = isNaN(parsed) ? [] : [parsed];
              }
            } else if (typeof q.correct === 'number') {
              q.correct = [q.correct];
            } else {
              q.correct = [];
            }
          }

          console.log(`MBA Question ${idx} - After normalization:`, {
            correct: q.correct,
            length: q.correct.length
          });

          if (q.correct.length === 0) {
            console.warn(`MBA Question ${idx} has no correct answers after normalization. Raw data:`, row);
          }
        }

        // 3. Defensive checks (Assumption B)
        if (q.type === 'emq') {
          q.theme = q.theme || 'Clinical Case'; // Fallback instead of skipping
          if (!Array.isArray(q.stems) || q.stems.length === 0) {
            console.warn(`EMQ question ${idx} has no stems and will be skipped. Raw data:`, row);
            q._skip = true;
          }
          if (!Array.isArray(q.options) || q.options.length === 0) {
            console.warn(`EMQ question ${idx} has no options and will be skipped. Raw data:`, row);
            q._skip = true;
          }
        }

        if (q.type === 'sba' && !q.stem) {
          console.warn(`SBA question ${idx} is missing a stem. Proceeding with caution.`);
          q.stem = '(No clinical stem provided)';
        }

        // Ensure topic and explanation are strings
        q.topic = q.topic || '';
        q.explanation = q.explanation || '';

        return q;
      });

      // Filter out skipped EMQs before rendering
      const initialCount = questions_data.length;
      allQuestions = questions_data.filter(q => !q._skip);
      const skippedCount = initialCount - allQuestions.length;

      if (skippedCount > 0) {
        console.warn(`Skipped ${skippedCount} questions due to missing/invalid data.`);
        showToast(`Loaded ${allQuestions.length} questions. ${skippedCount} skipped (invalid data).`);
      }
    }
  } catch (err) {
    console.error('Unexpected Supabase error:', err);
    handleError('loadQuestionsFromSupabase', err, 'Unexpected error loading questions');
    allQuestions = [];
  }
  questionsLoading = false;
}

// === FRONTEND EXAM LOGIC ===
// All exam behaviour, scoring, navigation, and timed-out logic is owned by the frontend below.
// Backend changes do NOT affect scoring rules or timed-out behaviour.

// --- Global Keyboard Navigation ---
function setupKeyboardNavigation() {
  if (window.keyboardNavSetup) return; // Guard against double registration
  window.keyboardNavSetup = true;

  document.addEventListener('keydown', (e) => {
    // Ignore if modal is open
    if (document.getElementById('mode-modal') && document.getElementById('mode-modal').style.display === 'flex') return;
    if (document.getElementById('lab-modal') && document.getElementById('lab-modal').style.display === 'block') return;

    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

    // 1. Navigation (Arrows)
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !isInput) {
      // Prevent default scrolling
      e.preventDefault();

      if (e.key === 'ArrowRight') {
        if (currentQuestion < questions.length - 1) {
          currentQuestion++;
          saveQuizState();
          renderQuestion();
        }
      } else if (e.key === 'ArrowLeft') {
        if (currentQuestion > 0) {
          currentQuestion--;
          saveQuizState();
          renderQuestion();
        }
      }
      return;
    }

    // 2. Submit / Next (Enter)
    if (e.key === 'Enter') {
      // If we are on a button/input that handles enter naturally, let it be (unless it's our submit button)
      // But we want to override default form submission if it's the main form

      if (testEnded) return;

      const currentStatus = questionStates[currentQuestion]?.status;

      if (currentStatus === 'not-attempted') {
        // If focusing a specific input (like numeric or textarea), let natural submit happen if form handles it
        // Or trigger the submit button click
        const submitBtn = document.querySelector('.submit-btn');
        if (submitBtn && !submitBtn.disabled) {
          e.preventDefault();
          submitBtn.click();
        }
      } else {
        // Already answered -> Go to next
        e.preventDefault();
        const nextBtn = document.querySelector('.next-btn');
        if (nextBtn) {
          nextBtn.click();
        } else if (currentQuestion < questions.length - 1) {
          // Fallback if button isn't found for some reason
          currentQuestion++;
          saveQuizState();
          renderQuestion();
        }
      }
    }
  });
}

async function initializeApp() {
  setupKeyboardNavigation();
  // Show a loading indicator in the main section
  const section = document.getElementById('question-section');
  if (section) {
    section.innerHTML = '<div class="loading-message" style="text-align:center; padding: 2rem; color: #666; font-style: italic;">Loading clinical questions from Supabase...</div>';
  }

  // TEMPORARY: Clear old quiz state after schema change
  localStorage.removeItem("quizStateV1");
  localStorage.removeItem("quizStateV2"); // Clear V2 after upgrade


  questionsLoading = true;
  await loadQuestionsFromSupabase();

  if (!allQuestions || allQuestions.length === 0) {
    if (section) {
      section.innerHTML = '<div class="error-message">No questions are available at this time. Please try again later.</div>';
    }
    console.error('No questions loaded from Supabase.');
    return;
  }

  // Prevent accidental refresh/leaving during an active test
  window.addEventListener('beforeunload', (e) => {
    if (quizMode && !testEnded) {
      e.preventDefault();
      e.returnValue = ''; // Standard for showing the confirmation dialog
      saveQuizState(); // Final save attempt
    }
  });

  // Now safe to proceed with quiz logic
  // Now safe to proceed with quiz logic
  // Check for URL parameters to enforce type consistency
  const params = new URLSearchParams(window.location.search);
  const typeParam = params.get('type');
  const expectedType = typeParam ? typeParam.toLowerCase() : null;

  if (!loadQuizState(expectedType)) {
    // Clear loading message before showing modal
    if (section) section.innerHTML = '';

    // Check for URL parameters
    const params = new URLSearchParams(window.location.search);
    const typeParam = params.get('type');
    if (typeParam && ['sba', 'emq', 'mba', 'mixed', 'smart'].includes(typeParam.toLowerCase())) {
      selectedType = typeParam.toLowerCase();
    }

    const topicParam = params.get('topic');
    const modeParam = params.get('mode');
    const examId = params.get('examId');

    const topicIdParam = params.get('topic_id'); // Add this

    if (modeParam === 'study') {
      // Force study mode
      reviewMode = true;
      quizMode = 'practice';
    }

    if (topicParam) {
      selectedType = 'mixed';
      quizMode = 'exam';
      startTest();
      startExamTimer();
    } else if (topicIdParam) { // NEW Check
      selectedType = 'mixed';
      quizMode = 'practice'; // Ensure practice mode for study
      startTest();
      // No timer for study mode
    } else if (modeParam === 'mock') {
      selectedType = 'mixed';
      quizMode = 'exam';

      // If examId is provided, select specific mock exam questions
      if (examId) {
        const mockQuestions = selectMockExamQuestions(allQuestions, examId);
        if (mockQuestions.length < 20) {
          alert(`Mock Exam ${examId} doesn't have enough questions (found ${mockQuestions.length}). Please try another mock.`);
          window.location.href = 'mocks.html';
          return;
        }
        // Override allQuestions with mock exam questions
        allQuestions = mockQuestions;
      }

      startTest();
      startExamTimer();
    } else {
      showModeModal();
    }
  } else {
    // State was restored
    showToast('Test progress restored');

    // Guard: if timeLeft <= 0 on load, immediately end test, clear state, and show end screen
    if (quizMode === 'exam' && (typeof timeLeft === 'number') && timeLeft <= 0) {
      clearQuizState();
      renderEndScreen();
      // Do not render any question
    } else {
      if (quizMode === 'exam' && timeLeft > 0) {
        startExamTimer();
      }
      renderQuestion();
    }
  }

  // Setup global keyboard navigation
  setupKeyboardNavigation();

  setupLabModal();
  setupExitBtn();
}

function setupExitBtn() {
  const exitBtn = document.getElementById('exit-btn');
  const container = document.getElementById('back-btn-container');
  if (!exitBtn || !container) return;

  // Only show back button if we are in a test session
  if (quizMode) {
    container.style.display = 'block';
  }

  exitBtn.onclick = () => {
    if (confirm("Are you sure you want to exit? Your progress will be saved.")) {
      saveQuizState(true); // Immediate save

      // Determine where to redirect based on context
      const params = new URLSearchParams(window.location.search);
      const modeParam = params.get('mode');
      const topicParam = params.get('topic');

      if (modeParam === 'mock') {
        window.location.href = 'mocks.html';
      } else if (topicParam) {
        window.location.href = `categories.html${selectedType ? '?type=' + selectedType : ''}`;
      } else if (selectedType === 'sba' || selectedType === 'emq') {
        window.location.href = `categories.html?type=${selectedType}`;
      } else {
        window.location.href = 'practice.html';
      }
    }
  };
}

function setupLabModal() {
  const modal = document.getElementById('lab-modal');
  const btn = document.getElementById('lab-ref-fab');
  const close = document.getElementById('close-lab-modal');

  if (!modal || !btn) return;

  btn.onclick = () => modal.style.display = 'block';
  close.onclick = () => modal.style.display = 'none';

  window.onclick = (event) => {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  };
}

// --- UI Helpers ---
function showToast(message) {
  let toast = document.getElementById('toast-notification');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.className = 'toast-notification';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Centralized error handling
function handleError(context, error, userMessage = 'An error occurred. Please try again.') {
  console.error(`Error in ${context}:`, error);
  showToast(userMessage);

  // Log to a monitoring service in production
  // Example: Sentry.captureException(error, { tags: { context } });
}

// Start the app after DOM is ready
window.addEventListener('DOMContentLoaded', initializeApp);

// --- Persistence helpers ---
let saveQuizStateTimeout = null;

function saveQuizState(immediate = false) {
  if (quizCleared) return; // Block saving if quiz was explicitly cleared
  if (testEnded) return; // Block saving if test is already ended (redundant safety)
  // TODO: Store quiz state per user after authentication is implemented.
  const doSave = () => {
    const params = new URLSearchParams(window.location.search);
    const topicParam = params.get('topic');
    const examId = params.get('examId');

    const state = {
      quizMode,
      examId: examId || null,
      selectedType,
      selectedCategory: topicParam || null,
      questionIds: questions.map(q => q.id),
      questionStates,
      currentQuestion,
      timeLeft,
      totalScore,
      totalPossible,
      testEnded,
      reviewMode
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save quiz state:', e);
      if (e.name === 'QuotaExceededError') {
        handleError('saveQuizState', e, 'Storage quota exceeded. Some progress may not be saved.');
      }
    }
  };

  if (immediate) {
    // Clear any pending save and save immediately
    if (saveQuizStateTimeout) clearTimeout(saveQuizStateTimeout);
    doSave();
  } else {
    // Debounce: wait 500ms before saving
    if (saveQuizStateTimeout) clearTimeout(saveQuizStateTimeout);
    saveQuizStateTimeout = setTimeout(doSave, 500);
  }
}
function loadQuizState(requiredType = null) {
  // TODO: Load quiz state per user after authentication is implemented.
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const state = JSON.parse(raw);
    if (!state || !Array.isArray(state.questionStates)) return false;
    if (state.testEnded) return false; // Ignore finished tests (Start Fresh)

    // Check if category matches (if we're on a category page)
    const params = new URLSearchParams(window.location.search);
    const currentCategory = params.get('topic');

    if (currentCategory && state.selectedCategory !== currentCategory) {
      console.log(`Saved state category (${state.selectedCategory}) does not match current category (${currentCategory}). Starting fresh.`);
      return false;
    }

    // Check Exam ID match (prevents resuming Mock 1 when starting Mock 2)
    const currentExamId = params.get('examId');
    const savedExamId = state.examId || null;

    console.log(`Debug LoadQuizState: CurrentID=${currentExamId}, SavedID=${savedExamId}`);

    if (currentExamId !== savedExamId) {
      console.log(`Exam ID mismatch (Current: ${currentExamId}, Saved: ${savedExamId}). Starting fresh.`);
      return false;
    }

    // Check Mode intent (prevents resuming Practice when starting Mock)
    const urlMode = params.get('mode');

    console.log(`Debug LoadQuizState: UrlMode=${urlMode}, SavedMode=${state.quizMode}`);

    if (urlMode === 'mock' && state.quizMode !== 'exam') {
      console.log('Mode mismatch (URL implies Mock/Exam, State is not Exam). Starting fresh.');
      return false;
    }

    // Enforce type match if requested
    if (requiredType && state.selectedType !== requiredType) {
      console.log(`Saved state type (${state.selectedType}) does not match requested type (${requiredType}). Starting fresh.`);
      return false;
    }

    selectedType = state.selectedType || 'mixed';

    // Use saved question IDs to restore the shuffled order
    if (state.questionIds && Array.isArray(state.questionIds)) {
      questions = state.questionIds.map(id => allQuestions.find(q => q.id === id)).filter(Boolean);
    } else {
      // Fallback for older states
      if (selectedType === 'sba') {
        questions = allQuestions.filter(q => q.type === 'sba');
      } else if (selectedType === 'emq') {
        questions = allQuestions.filter(q => q.type === 'emq');
      } else {
        questions = [...allQuestions];
      }
    }

    // Validate that the saved states match restored questions length
    if (state.questionStates.length !== questions.length) {
      console.warn("Saved quiz state is incompatible with current question set. Clearing.");
      clearQuizState();
      return false;
    }

    quizMode = state.quizMode;
    questionStates = state.questionStates;
    currentQuestion = state.currentQuestion || 0;
    currentEmqStem = state.currentEmqStem || 0;
    timeLeft = state.timeLeft;
    totalScore = state.totalScore || 0;
    totalPossible = state.totalPossible || 0;
    testEnded = state.testEnded || false;
    reviewMode = state.reviewMode || false;
    return true;
  } catch {
    return false;
  }
}
function clearQuizState() {
  quizCleared = true; // Engage lock
  // Prevent any pending save from overwriting the clear
  if (saveQuizStateTimeout) clearTimeout(saveQuizStateTimeout);

  // TODO: Clear user-specific quiz state after authentication is implemented.
  localStorage.removeItem(STORAGE_KEY);
}

// Update flagged question status when question is answered
function updateFlaggedQuestionStatus(questionId, status) {
  const flaggedData = JSON.parse(localStorage.getItem(FLAGGED_QUESTIONS_KEY) || '{}');
  if (flaggedData[questionId]) {
    flaggedData[questionId].status = status;
    localStorage.setItem(FLAGGED_QUESTIONS_KEY, JSON.stringify(flaggedData));
  }
}



// --- Mode selection modal logic ---
function showModeModal() {
  let modal = document.getElementById('mode-modal');
  if (!modal) {
    fetch('mode-modal.html').then(r => r.text()).then(html => {
      document.body.insertAdjacentHTML('beforeend', html);
      setupModeModal();
    });
  } else {
    modal.style.display = 'flex';
  }
}

function setupModeModal() {
  const modal = document.getElementById('mode-modal');
  const typeBtns = document.getElementById('type-select-btns');
  const simpleBtns = document.getElementById('simple-mode-btns');
  const title = document.getElementById('modal-title');
  const subtitle = document.getElementById('modal-subtitle');

  modal.style.display = 'flex';

  const startWithType = (mode, type) => {
    quizMode = mode;
    selectedType = type || selectedType;
    modal.style.display = 'none';
    startTest();
    if (mode === 'exam') startExamTimer();
  };

  // If type is already pre-selected (via URL), show simple buttons
  const isPreSelected = new URLSearchParams(window.location.search).has('type');

  if (isPreSelected) {
    if (typeBtns) typeBtns.style.display = 'none';
    if (simpleBtns) {
      simpleBtns.style.display = 'grid';
      simpleBtns.style.gap = '1rem';
    }
    if (title) title.textContent = `Start ${selectedType.toUpperCase() === 'MIXED' ? 'Mixed' : selectedType.toUpperCase()} Test`;
    if (subtitle) subtitle.textContent = "Choose your preferred test format";

    document.getElementById('simple-exam-btn').onclick = () => startWithType('exam');
    document.getElementById('simple-practice-btn').onclick = () => startWithType('practice');
  } else {
    if (typeBtns) typeBtns.style.display = 'grid';
    if (simpleBtns) simpleBtns.style.display = 'none';

    document.getElementById('sba-exam-btn').onclick = () => startWithType('exam', 'sba');
    document.getElementById('emq-exam-btn').onclick = () => startWithType('exam', 'emq');
    document.getElementById('mba-exam-btn').onclick = () => startWithType('exam', 'mba');
    document.getElementById('mixed-exam-btn').onclick = () => startWithType('exam', 'mixed');

    document.getElementById('sba-practice-btn').onclick = () => startWithType('practice', 'sba');
    document.getElementById('emq-practice-btn').onclick = () => startWithType('practice', 'emq');
    document.getElementById('mba-practice-btn').onclick = () => startWithType('practice', 'mba');
    document.getElementById('mixed-practice-btn').onclick = () => startWithType('practice', 'mixed');
  }
}

// --- Timer logic helpers ---
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

// --- Timer logic for Exam Mode ---
// [FRONTEND-FINAL] Timed-out handling is fixed here
function startExamTimer() {
  if (timerInterval) clearInterval(timerInterval);

  // Show the side-panel timer container
  const timerContainer = document.getElementById('exam-timer-container');
  if (timerContainer) timerContainer.style.display = 'block';

  timerInterval = setInterval(() => {
    timeLeft--;
    const display = document.getElementById('timer-display');
    if (display) display.textContent = formatTime(timeLeft);

    // Save state periodically to persist timer
    if (timeLeft % AUTO_SAVE_INTERVAL === 0) {
      saveQuizState(true); // Immediate save for timer
    }

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      renderEndScreen();
      saveQuizState(); // Ensure final state is saved
    }
  }, 1000);
}

function stopExamTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// [FRONTEND-FINAL] Navigation and question rendering logic is fixed here
// --- Helper to get consistent question codes ---
function getQuestionCode(type, index) {
  // Use Question Code from database if available
  const q = questions[index];
  if (q && q['Question Code']) {
    return q['Question Code'];
  }
  // Fallback to generated code
  const prefixMap = {
    'sba': 'Q',
    'emq': 'EMQ',
    'mba': 'MBA',
    'numeric': 'Q'
  };
  return `${prefixMap[type] || 'Q'}${index + 1}`;
}

// --- Helper to render question image if present ---
function renderQuestionImage(imageUrl) {
  console.log('renderQuestionImage called with:', imageUrl);
  if (!imageUrl) return '';
  return `<div class="question-image" style="margin: 1rem 0; text-align: center;">
    <img src="${imageUrl}" alt="Question image" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
  </div>`;
}

// Clean theme/topic strings for display
function cleanThemeString(str) {
  if (!str) return "";
  // Remove prefixes like "EMQ: ", "SBA: ", etc.
  return str.replace(/^(EMQ|SBA|MBA|Numeric):\s*/i, "").trim();
}

// --- Mock Exam Question Selection ---
function selectMockExamQuestions(allQuestions, examId) {
  // Deterministically select 20 questions for each mock exam
  // Uses modulo to distribute questions evenly across 3 mocks
  const examGroup = parseInt(examId);
  if (isNaN(examGroup) || examGroup < 1 || examGroup > 3) {
    console.error('Invalid examId:', examId);
    return [];
  }

  // Filter questions by exam group (1, 2, or 3) and take first 20
  const mockQuestions = allQuestions.filter((q, idx) => {
    return (idx % 3) === (examGroup - 1);
  }).slice(0, 20);

  console.log(`Mock Exam ${examId}: Selected ${mockQuestions.length} questions`);
  return mockQuestions;
}

// --- Question rendering flow --- 
function renderQuestion() {
  // Cleanup any previous question handlers
  if (currentQuestionCleanup) {
    currentQuestionCleanup();
    currentQuestionCleanup = null;
  }

  // If no questions, show a friendly message and return
  if (!questions || questions.length === 0) {
    const section = document.getElementById('question-section');
    if (section) {
      section.innerHTML = '<div class="error-message">No questions available. Please try again later.</div>';
    }
    console.warn('No questions to display.');
    return;
  }
  // Guard: out-of-bounds index (e.g., new questions added or order changed)
  if (currentQuestion < 0 || currentQuestion >= questions.length) {
    const section = document.getElementById('question-section');
    if (section) {
      section.innerHTML = '<div class="error-message">Question index out of range. Please reload or restart the test.</div>';
    }
    console.error('Current question index out of range:', currentQuestion, questions.length);
    return;
  }
  const q = questions[currentQuestion];
  if (!q || !q.type) {
    const section = document.getElementById('question-section');
    if (section) {
      section.innerHTML = '<div class="error-message">Invalid question data. Please contact support.</div>';
    }
    console.error('Invalid or missing question data:', q);
    return;
  }
  // Only reset numeric input and explanation if not answered yet
  if (q.type === 'numeric' && questionStates[currentQuestion].status === 'not-attempted') {
    setTimeout(() => {
      const input = document.getElementById('numeric-answer');
      if (input) {
        input.value = '';
        input.disabled = false;
        input.classList.remove('option-correct', 'option-wrong');
      }
      const explanationBox = document.getElementById('explanation');
      if (explanationBox) {
        explanationBox.innerHTML = '';
        explanationBox.style.display = 'none';
      }
    }, 0);
  }
  const section = document.getElementById('question-section');
  section.innerHTML = '';

  // Render right panel with status squares
  renderStatusPanel();

  // Question code (e.g., Q1, EMQ2, MBA3, ...)
  let code = getQuestionCode(q.type, currentQuestion);

  // Guard: avoid accessing undefined questionStates[currentQuestion]
  if (!questionStates || !questionStates[currentQuestion]) {
    const section = document.getElementById('question-section');
    if (section) {
      section.innerHTML = '<div class="error-message">No questions to display.</div>';
    }
    console.warn('No questions to display.');
    return;
  }
  let flagIconSvg = questionStates[currentQuestion].flagged
    ? '<svg width="18" height="18" viewBox="0 0 13 13" style="vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 2.5V10.5" stroke="#1976d2" stroke-width="2" stroke-linecap="round"/><path d="M3 2.5L10 3.5L7.5 6L10 8.5L3 9.5" fill="#1976d2" stroke="#1976d2" stroke-width="1.5"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 13 13" style="vertical-align:middle;opacity:0.5;" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 2.5V10.5" stroke="#1976d2" stroke-width="2" stroke-linecap="round"/><path d="M3 2.5L10 3.5L7.5 6L10 8.5L3 9.5" fill="#1976d2" stroke="#1976d2" stroke-width="1.5"/></svg>';
  let flagBtn = `<button id="flag-btn" class="flag-btn" title="Flag for review" aria-label="${questionStates[currentQuestion].flagged ? 'Unflag this question' : 'Flag this question for review'}">${flagIconSvg}</button>`;

  // Build header parts
  const questionCounter = `Q${currentQuestion + 1}`;
  const categoryName = q.Category || '';
  const displayCode = q['Display Code'] || '';
  const questionCode = q['Question Code'] || '';
  const codeText = displayCode && questionCode ? `${displayCode} ${questionCode}` : (displayCode || questionCode || '');

  const sharedHeader = `
    <div class="question-header">
      <span class="question-counter" style="color: #1565c0; font-weight: bold; font-size: 1.1rem;">${questionCounter}</span>
      ${flagBtn}
      ${categoryName ? `<span class="question-category" style="color: #1565c0; font-weight: bold; font-size: 1rem; margin-left: 0.8rem; border-left: 2px solid #e0e0e0; padding-left: 0.8rem;">${categoryName}</span>` : ''}
      ${codeText ? `<span class="question-codes" style="color: #1565c0; font-size: 0.85rem; margin-left: 0.8rem;">${codeText}</span>` : ''}
      
      <div class="nav-arrows">
          <button id="nav-prev" title="Previous Question (Left Arrow)" aria-label="Previous Question">❮</button>
          <button id="nav-next" title="Next Question (Right Arrow)" aria-label="Next Question">❯</button>
      </div>
    </div>
  `;

  // Ensure correct timer visibility
  const timerContainer = document.getElementById('exam-timer-container');
  if (timerContainer) {
    timerContainer.style.display = (quizMode === 'exam' && !testEnded) ? 'block' : 'none';
    const display = document.getElementById('timer-display');
    if (display && timeLeft !== null) display.textContent = formatTime(timeLeft);
  }

  // Handle known question types, else fail gracefully
  if (q.type === 'sba') {
    const saved = questionStates[currentQuestion].answer;
    section.innerHTML = `
      ${sharedHeader}
      ${renderQuestionImage(q.images)}
      <form class="question-form" id="mcq-form" aria-label="Single best answer question">
        <fieldset id="mcq-fieldset">
          <legend>${q.stem}</legend>
          ${(questionStates[currentQuestion].shuffledOptions || q.options).map((opt, i) => {
      const isStruck = questionStates[currentQuestion].struckOutOptions?.includes(i);
      return `
            <div class="option ${isStruck ? 'struck-out' : ''}" data-idx="${i}">
              <input type="radio" id="option${i + 1}" name="answer" value="${i}"${saved !== null && parseInt(saved) === i ? ' checked' : ''}>
              <label for="option${i + 1}">${String.fromCharCode(65 + i)}. ${opt}</label>
            </div>
          `}).join('')}
        </fieldset>
        
        <button type="submit" class="submit-btn" aria-label="Submit your answer">Submit</button>
        <p style="font-size: 0.8rem; color: #999; text-align: center; margin-top: 0.5rem;">Tip: Right-click an option to cross it out</p>
      </form>
      <div id="explanation" class="explanation-box" style="display:none;"></div>
    `;
    attachSbaHandlers(q);
    // If already answered, re-apply highlights and show explanation
    if (questionStates[currentQuestion].status !== 'not-attempted' && saved !== null) {
      const form = document.getElementById('mcq-form');
      const fieldset = document.getElementById('mcq-fieldset');
      const explanationBox = document.getElementById('explanation');
      const correctIdx = questionStates[currentQuestion].shuffledCorrectIndex !== undefined
        ? questionStates[currentQuestion].shuffledCorrectIndex
        : q.correct;
      const isCorrect = parseInt(saved) === correctIdx;
      Array.from(fieldset.querySelectorAll('input[type=radio]')).forEach((el, idx) => {
        el.disabled = true;
        const label = fieldset.querySelector(`label[for="option${idx + 1}"]`);
        if (parseInt(saved) === idx && isCorrect) {
          label.classList.add('option-correct');
        } else if (parseInt(saved) === idx && !isCorrect) {
          label.classList.add('option-wrong');
        }
        if (correctIdx === idx) {
          label.classList.add('option-correct');
        }
      });
      // Show explanation
      explanationBox.innerHTML = renderExplanation({
        isCorrect,
        correctLabel: String.fromCharCode(65 + correctIdx),
        correctText: (questionStates[currentQuestion].shuffledOptions || q.options)[correctIdx],
        explanation: q.explanation,
        furtherReading: q.furtherReading,
        topicBtn: q.topicBtn || (q.topic ? { text: q.topic, url: '#' } : null)
      });
      explanationBox.style.display = 'block';
      // Remove submit, add next/end button
      const submitBtn = form.querySelector('.submit-btn');
      if (submitBtn) submitBtn.remove();
      const oldNextBtn = form.querySelector('.next-btn');
      if (oldNextBtn) oldNextBtn.remove();
      const nextBtn = document.createElement('button');
      nextBtn.textContent = (currentQuestion < questions.length - 1) ? 'Next Question' : 'End Test';
      nextBtn.className = 'submit-btn next-btn';
      nextBtn.style.display = 'block';
      nextBtn.style.margin = '1rem auto 0 auto';
      nextBtn.onclick = function (ev) {
        ev.preventDefault();
        if (currentQuestion < questions.length - 1) {
          currentQuestion++;
          currentEmqStem = 0;
          renderQuestion();
        } else {
          renderEndScreen();
          clearQuizState();
        }
      };
      form.appendChild(nextBtn);
    }
    // FORCE STUDY MODE DISPLAY if enabled and not already answered/rendered above
    if (reviewMode && questionStates[currentQuestion].status === 'not-attempted') {
      // Auto-Select correct answer visually
      const correctIdx = q.correct;
      const radios = fieldset.querySelectorAll('input[type=radio]');
      if (radios[correctIdx]) radios[correctIdx].checked = true;

      const label = fieldset.querySelector(`label[for="option${correctIdx + 1}"]`);
      if (label) label.classList.add('option-correct');

      Array.from(radios).forEach(r => r.disabled = true);

      explanationBox.innerHTML = renderExplanation({
        isCorrect: true, // pretend correct for display
        correctLabel: String.fromCharCode(65 + correctIdx),
        correctText: (questionStates[currentQuestion].shuffledOptions || q.options)[correctIdx],
        explanation: q.explanation,
        furtherReading: q.furtherReading,
        topicBtn: q.topicBtn || (q.topic ? { text: q.topic, url: '#' } : null)
      });
      explanationBox.style.display = 'block';

      const submitBtn = form.querySelector('.submit-btn');
      if (submitBtn) submitBtn.remove();

      const nextBtn = document.createElement('button');
      nextBtn.textContent = (currentQuestion < questions.length - 1) ? 'Next Question' : 'Back to Guide';
      nextBtn.className = 'submit-btn next-btn';
      nextBtn.style.display = 'block';
      nextBtn.style.margin = '1rem auto 0 auto';
      nextBtn.onclick = function (ev) {
        ev.preventDefault();
        if (currentQuestion < questions.length - 1) {
          currentQuestion++;
          renderQuestion();
        } else {
          // In study mode linked from guide, maybe go back? 
          // unique behavior: go back to study page if topic_id present
          const topicId = new URLSearchParams(window.location.search).get('topic_id');
          if (topicId) {
            window.location.href = `study.html?topic_id=${topicId}`;
          } else {
            renderEndScreen();
          }
        }
      };
      form.appendChild(nextBtn);
    }
    // FORCE STUDY MODE DISPLAY if enabled and not already answered/rendered above

    // Check if we are in forced study mode (reviewMode is true, but status is not-attempted/clean)
    if (reviewMode && questionStates[currentQuestion].status === 'not-attempted') {
      // Auto-Select correct answer visually
      const correctIdx = q.correct;
      const radios = fieldset.querySelectorAll('input[type=radio]');
      if (radios[correctIdx]) radios[correctIdx].checked = true;

      const label = fieldset.querySelector(`label[for="option${correctIdx + 1}"]`);
      if (label) label.classList.add('option-correct');

      Array.from(radios).forEach(r => r.disabled = true);

      explanationBox.innerHTML = renderExplanation({
        isCorrect: true, // pretend correct for display
        correctLabel: String.fromCharCode(65 + correctIdx),
        correctText: (questionStates[currentQuestion].shuffledOptions || q.options)[correctIdx],
        explanation: q.explanation,
        furtherReading: q.furtherReading,
        topicBtn: q.topicBtn || (q.topic ? { text: q.topic, url: '#' } : null)
      });
      explanationBox.style.display = 'block';

      const submitBtn = form.querySelector('.submit-btn');
      if (submitBtn) submitBtn.remove();

      const nextBtn = document.createElement('button');
      nextBtn.textContent = (currentQuestion < questions.length - 1) ? 'Next Question' : 'Back to Guide';
      nextBtn.className = 'submit-btn next-btn';
      nextBtn.style.display = 'block';
      nextBtn.style.margin = '1rem auto 0 auto';
      nextBtn.onclick = function (ev) {
        ev.preventDefault();
        if (currentQuestion < questions.length - 1) {
          currentQuestion++;
          renderQuestion();
        } else {
          // In study mode linked from guide, maybe go back? 
          // unique behavior: go back to study page if topic_id present
          const topicId = new URLSearchParams(window.location.search).get('topic_id');
          if (topicId) {
            window.location.href = `study.html?topic_id=${topicId}`;
          } else {
            renderEndScreen();
          }
        }
      };
      form.appendChild(nextBtn);
    }
  } else if (q.type === 'emq') {
    // ...EMQ block...
    const saved = Array.isArray(questionStates[currentQuestion].answer)
      ? questionStates[currentQuestion].answer
      : (q.stems ? Array(q.stems.length).fill(null) : []);
    section.innerHTML = `
      ${sharedHeader}
      ${renderQuestionImage(q.images)}
      <div class="emq-options-box">
        <strong>Options:</strong>
        <div class="emq-options-list">
          ${q.options.map((opt, i) => `<div class="emq-option-item"><strong>${String.fromCharCode(65 + i)}.</strong> ${opt}</div>`).join('')}
        </div>
      </div>
      <form class="question-form" id="emq-form" aria-label="Extended matching question">
        <fieldset id="emq-fieldset">
          ${q.stems.map((stemObj, idx) => `
            <div class="emq-stem-block">
              <legend>${stemObj.stem}</legend>
              <select name="answer${idx}" id="emq-answer-${idx}" aria-label="Answer for stem ${idx + 1}">
                <option value="">Select an answer</option>
                ${(questionStates[currentQuestion].shuffledOptions || q.options).map((opt, i) => `<option value="${i}"${saved && saved[idx] !== null && parseInt(saved[idx]) === i ? ' selected' : ''}>${String.fromCharCode(65 + i)}. ${opt}</option>`).join('')}
              </select>
            </div>
          `).join('')}
        </fieldset>
        <button type="submit" class="submit-btn" style="display:block; margin: 1.5rem auto 0 auto;">Submit</button>
      </form>
      <div id="explanation" class="explanation-box" style="display:none;"></div>
    `;
    attachEmqDropdownHandlers(q);
    // Disable submit initially until all are answered
    const submitBtn = document.querySelector('#emq-form .submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      const selects = document.querySelectorAll('#emq-form select');
      const checkCompletion = () => {
        const allSelected = Array.from(selects).every(s => s.value !== "");
        submitBtn.disabled = !allSelected;
        submitBtn.title = allSelected ? "Submit your answer" : "Please answer all parts to submit";
      };
      selects.forEach(s => s.addEventListener('change', checkCompletion));
    }
    // If already answered, re-apply highlights and show explanation
    if (questionStates[currentQuestion].status !== 'not-attempted' && saved && Array.isArray(saved)) {
      const form = document.getElementById('emq-form');
      const fieldset = document.getElementById('emq-fieldset');
      const explanationBox = document.getElementById('explanation');
      // Defensive: ensure q.correct and saved are arrays of correct length
      const correctArr = questionStates[currentQuestion].shuffledStemCorrectIndices
        ? questionStates[currentQuestion].shuffledStemCorrectIndices
        : (Array.isArray(q.correct) && q.correct.length === q.stems.length
          ? q.correct
          : q.stems.map(stem => stem.correct));
      const savedArr = Array.isArray(saved) && saved.length === q.stems.length
        ? saved
        : Array(q.stems.length).fill(null);
      // Disable selects and highlight answers
      Array.from(fieldset.querySelectorAll('select')).forEach((selectEl, idx) => {
        selectEl.value = savedArr[idx];
        selectEl.disabled = true;
        if (parseInt(savedArr[idx]) === correctArr[idx]) {
          selectEl.classList.add('option-correct');
        } else if (savedArr[idx] !== null) {
          selectEl.classList.add('option-wrong');
        }
      });
      // Show explanation
      let feedbackHtml = '';
      q.stems.forEach((stemObj, idx) => {
        const isCorrect = parseInt(savedArr[idx]) === correctArr[idx];
        feedbackHtml += renderExplanation({
          isCorrect,
          correctLabel: String.fromCharCode(65 + stemObj.correct),
          correctText: q.options[stemObj.correct],
          explanation: stemObj.explanation,
          furtherReading: q.furtherReading,
          topicBtn: q.topicBtn || (q.topic ? { text: q.topic, url: '#' } : null)
        }) + '<hr style="margin:1.5rem 0;">';
      });
      explanationBox.innerHTML = feedbackHtml;
      explanationBox.style.display = 'block';
      // Remove submit, add next/end button
      const submitBtn = form.querySelector('.submit-btn');
      if (submitBtn) submitBtn.remove();
      const oldNextBtn = form.querySelector('.next-btn');
      if (oldNextBtn) oldNextBtn.remove();
      const nextBtn = document.createElement('button');
      nextBtn.textContent = (currentQuestion < questions.length - 1) ? 'Next Question' : 'End Test';
      nextBtn.className = 'submit-btn next-btn';
      nextBtn.style.display = 'block';
      nextBtn.style.margin = '1rem auto 0 auto';
      nextBtn.onclick = function (ev) {
        ev.preventDefault();
        currentQuestion++;
        currentEmqStem = 0;
        if (currentQuestion < questions.length) {
          renderQuestion();
        } else {
          renderEndScreen();
          clearQuizState();
        }
        saveQuizState();
      };
      form.appendChild(nextBtn);
    }
  } else if (q.type === 'numeric') {
    // ...existing numeric code...
    const numericSaved = questionStates[currentQuestion].answer;
    section.innerHTML = `
      ${sharedHeader}
      ${renderQuestionImage(q.images)}
      <form class="question-form" id="numeric-form">
        <fieldset id="numeric-fieldset">
          <legend>${q.stem}</legend>
          <input type="number" id="numeric-answer" name="numeric-answer" step="any" required value="${numericSaved !== null && numericSaved !== undefined ? numericSaved : ''}" style="width:8em;">
          ${q.unit ? `<span class="numeric-unit">${q.unit}</span>` : ''}
        </fieldset>
        <button type="submit" class="submit-btn">Submit</button>
      </form>
      <div id="explanation" class="explanation-box" style="display:none;"></div>
    `;
    attachNumericHandlers(q);
    // If already answered, re-apply feedback and show explanation
    if (questionStates[currentQuestion].status !== 'not-attempted' && numericSaved !== null && numericSaved !== undefined) {
      const form = document.getElementById('numeric-form');
      const fieldset = document.getElementById('numeric-fieldset');
      const explanationBox = document.getElementById('explanation');
      const userVal = parseFloat(numericSaved);

      // Validate correctAnswer exists and is a number
      if (typeof q.correctAnswer !== 'number' || isNaN(q.correctAnswer)) {
        console.error('Invalid correctAnswer for numeric question:', q);
        explanationBox.innerHTML = '<div class="error-message">Error: Invalid question data</div>';
        explanationBox.style.display = 'block';
        return;
      }

      const isCorrect = Math.abs(userVal - q.correctAnswer) <= (q.tolerance || 0);
      const input = document.getElementById('numeric-answer');
      input.disabled = true;
      if (isCorrect) {
        input.classList.add('option-correct');
      } else {
        input.classList.add('option-wrong');
      }
      explanationBox.innerHTML = renderExplanation({
        isCorrect,
        correctLabel: '',
        correctText: `${q.correctAnswer}${q.unit ? ' ' + q.unit : ''} (±${q.tolerance})`,
        explanation: q.explanation,
        furtherReading: q.furtherReading || [],
        topicBtn: q.topicBtn || (q.topic ? { text: q.topic, url: '#' } : null)
      });
      explanationBox.style.display = 'block';
      // Remove submit, add next/end button
      const submitBtn = form.querySelector('.submit-btn');
      if (submitBtn) submitBtn.remove();
      const oldNextBtn = form.querySelector('.next-btn');
      if (oldNextBtn) oldNextBtn.remove();
      const nextBtn = document.createElement('button');
      nextBtn.textContent = (currentQuestion < questions.length - 1) ? 'Next Question' : 'End Test';
      nextBtn.className = 'submit-btn next-btn';
      nextBtn.style.display = 'block';
      nextBtn.style.margin = '1rem auto 0 auto';
      nextBtn.onclick = function (ev) {
        ev.preventDefault();
        if (currentQuestion < questions.length - 1) {
          currentQuestion++;
          saveQuizState();
          renderQuestion();
        } else {
          renderEndScreen();
          clearQuizState();
        }
      };
      form.appendChild(nextBtn);
    }
  } else if (q.type === 'mba') {
    // MBA (Multiple Best Answer) question type - Full implementation
    const saved = questionStates[currentQuestion].answer || [];
    const requiredCount = Array.isArray(q.correct) ? q.correct.length : 0;

    if (requiredCount === 0) {
      section.innerHTML = '<div class="error-message">Error: This MBA question is missing correct answer data. Please skip or report it.</div>';
      return;
    }

    section.innerHTML = `
      ${sharedHeader}
      ${renderQuestionImage(q.images)}
      <form class="question-form" id="mba-form" aria-label="Multiple best answer question">
        <fieldset id="mba-fieldset">
          <legend>${q.stem}</legend>
          <div class="mba-instruction" style="background: #e3f2fd; padding: 0.8rem 1rem; border-radius: 6px; margin-bottom: 1rem; color: #1565c0; font-weight: 500;">
            Select ${requiredCount} answer${requiredCount !== 1 ? 's' : ''} (minimum 2 to submit)
            <span id="mba-counter" style="float: right; font-weight: 700;">0 / ${requiredCount}</span>
          </div>
          ${q.options.map((opt, i) => {
      const isChecked = saved.includes(i);
      return `
            <div class="option mba-option" data-idx="${i}">
              <input type="checkbox" id="mba-option${i + 1}" name="answer" value="${i}"${isChecked ? ' checked' : ''}>
              <label for="mba-option${i + 1}">${String.fromCharCode(65 + i)}. ${opt}</label>
            </div>
          `}).join('')}
        </fieldset>
        
        <button type="submit" class="submit-btn" aria-label="Submit your answers" disabled>Submit</button>
        <p style="font-size: 0.8rem; color: #999; text-align: center; margin-top: 0.5rem;">Tip: Select at least 2 options to enable submit (${requiredCount} needed for full credit)</p>
      </form>
      <div id="explanation" class="explanation-box" style="display:none;"></div>
    `;
    attachMbaHandlers(q);

    // If already answered, re-apply highlights and show explanation
    if (questionStates[currentQuestion].status !== 'not-attempted' && saved.length > 0) {
      const form = document.getElementById('mba-form');
      const fieldset = document.getElementById('mba-fieldset');
      const explanationBox = document.getElementById('explanation');
      const correctIndices = Array.isArray(q.correct) ? q.correct : [];

      // Determine correctness
      const allCorrectSelected = correctIndices.every(idx => saved.includes(idx));
      const noIncorrectSelected = saved.every(idx => correctIndices.includes(idx));
      const isCorrect = allCorrectSelected && noIncorrectSelected;
      const isPartial = !isCorrect && saved.some(idx => correctIndices.includes(idx));

      // Disable checkboxes and apply styling
      Array.from(fieldset.querySelectorAll('input[type=checkbox]')).forEach((el, idx) => {
        el.disabled = true;
        const label = fieldset.querySelector(`label[for="mba-option${idx + 1}"]`);

        // Highlight correct answers
        if (correctIndices.includes(idx)) {
          label.classList.add('option-correct');
        }

        // Highlight incorrect selections
        if (saved.includes(idx) && !correctIndices.includes(idx)) {
          label.classList.add('option-wrong');
        }
      });

      // Show explanation
      const correctLabels = correctIndices.map(i => String.fromCharCode(65 + i)).join(', ');
      const correctTexts = correctIndices.map(i => q.options[i]).join('; ');

      explanationBox.innerHTML = renderExplanation({
        isCorrect,
        correctLabel: correctLabels,
        correctText: correctTexts,
        explanation: q.explanation,
        furtherReading: q.furtherReading,
        topicBtn: q.topicBtn || (q.topic ? { text: q.topic, url: '#' } : null)
      });

      if (isPartial) {
        explanationBox.innerHTML = `
          <span class="incorrect">Partial Answer</span>
          <div style="background: #fff3e0; border: 1px solid #ff9800; padding: 0.8rem; border-radius: 6px; margin-bottom: 1rem; color: #e65100;">
            <strong>⚠️ Partial Credit Not Awarded</strong><br>
            You selected some correct answers, but MBA questions require ALL correct answers with NO incorrect selections for credit.
          </div>
        ` + explanationBox.innerHTML;
      }

      explanationBox.style.display = 'block';

      // Remove submit, add next/end button
      const submitBtn = form.querySelector('.submit-btn');
      if (submitBtn) submitBtn.remove();
      const oldNextBtn = form.querySelector('.next-btn');
      if (oldNextBtn) oldNextBtn.remove();
      const nextBtn = document.createElement('button');
      nextBtn.textContent = (currentQuestion < questions.length - 1) ? 'Next Question' : 'End Test';
      nextBtn.className = 'submit-btn next-btn';
      nextBtn.style.display = 'block';
      nextBtn.style.margin = '1rem auto 0 auto';
      nextBtn.onclick = function (ev) {
        ev.preventDefault();
        if (currentQuestion < questions.length - 1) {
          currentQuestion++;
          saveQuizState();
          renderQuestion();
        } else {
          renderEndScreen();
          clearQuizState();
        }
      };
      form.appendChild(nextBtn);
    }
  } else {
    // Unknown question type
    section.innerHTML = '<div class="error-message">Unknown question type. Please contact support.</div>';
    console.error('Unknown question type:', q.type, q);
  }
  // Attach Navigation Arrow Handlers
  const prevBtn = document.getElementById('nav-prev');
  const nextBtn = document.getElementById('nav-next');

  if (prevBtn) {
    prevBtn.onclick = () => {
      if (currentQuestion > 0) {
        currentQuestion--;
        saveQuizState();
        renderQuestion();
      }
    };
    if (currentQuestion === 0) prevBtn.style.opacity = '0.3'; // Visual disable
  }

  if (nextBtn) {
    nextBtn.onclick = () => {
      if (currentQuestion < questions.length - 1) {
        currentQuestion++;
        saveQuizState();
        renderQuestion();
      }
    };
    if (currentQuestion === questions.length - 1) nextBtn.style.opacity = '0.3'; // Visual disable
  }

  // Flag button handler
  document.getElementById('flag-btn').onclick = function (e) {
    e.preventDefault();
    questionStates[currentQuestion].flagged = !questionStates[currentQuestion].flagged;

    // Save to persistent flagged questions storage
    const questionId = questions[currentQuestion]?.id;

    if (!questionId || questionId === 'NaN') {
      console.warn('Attempted to flag a question with an invalid ID:', questionId);
      saveQuizState();
      renderQuestion();
      return;
    }

    const flaggedData = JSON.parse(localStorage.getItem(FLAGGED_QUESTIONS_KEY) || '{}');

    if (questionStates[currentQuestion].flagged) {
      // Add to flagged questions
      flaggedData[questionId] = {
        status: questionStates[currentQuestion].status || 'not-attempted',
        flaggedAt: new Date().toISOString()
      };
    } else {
      // Remove from flagged questions
      delete flaggedData[questionId];
    }

    localStorage.setItem(FLAGGED_QUESTIONS_KEY, JSON.stringify(flaggedData));
    saveQuizState();
    renderQuestion();
  };
  // Numeric question handler
  function attachNumericHandlers(q) {
    const form = document.getElementById('numeric-form');
    const fieldset = document.getElementById('numeric-fieldset');
    const explanationBox = document.getElementById('explanation');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (questionStates[currentQuestion].status !== 'not-attempted') return;
      const val = form['numeric-answer'].value;
      let userVal = null;
      let isValid = true;

      // Validate correctAnswer exists and is a number
      if (typeof q.correctAnswer !== 'number' || isNaN(q.correctAnswer)) {
        console.error('Invalid correctAnswer for numeric question:', q);
        questionStates[currentQuestion].status = 'incorrect';
        questionStates[currentQuestion].answer = val;
        saveQuizState();

        const input = document.getElementById('numeric-answer');
        input.disabled = true;
        input.classList.add('option-wrong');

        explanationBox.innerHTML = '<div class="error-message">Error: Invalid question data. Please report this issue.</div>';
        explanationBox.style.display = 'block';
        return;
      }

      if (val === '' || isNaN(val)) {
        isValid = false;
      } else {
        userVal = parseFloat(val);
      }
      questionStates[currentQuestion].answer = val;
      totalPossible++;
      let isCorrect = false;
      if (isValid) {
        isCorrect = Math.abs(userVal - q.correctAnswer) <= (q.tolerance || 0);
      }
      if (isValid && isCorrect) {
        totalScore++;
        questionStates[currentQuestion].status = 'correct';
      } else {
        questionStates[currentQuestion].status = 'incorrect';
      }
      saveQuizState(); // <--- Save immediately after answer
      renderStatusPanel();
      const input = document.getElementById('numeric-answer');
      input.disabled = true;
      let feedbackHtml = '';
      if (!isValid) {
        input.classList.add('option-wrong');
        feedbackHtml = renderExplanation({
          isCorrect: false,
          correctLabel: '',
          correctText: `${q.correctAnswer}${q.unit ? ' ' + q.unit : ''} (±${q.tolerance})`,
          explanation: 'Please enter a valid number. ' + q.explanation,
          furtherReading: q.furtherReading || [],
          topicBtn: q.topicBtn || (q.topic ? { text: q.topic, url: '#' } : null)
        });
      } else {
        if (isCorrect) {
          input.classList.add('option-correct');
        } else {
          input.classList.add('option-wrong');
        }
        feedbackHtml = renderExplanation({
          isCorrect,
          correctLabel: '',
          correctText: `${q.correctAnswer}${q.unit ? ' ' + q.unit : ''} (±${q.tolerance})`,
          explanation: q.explanation,
          furtherReading: q.furtherReading || [],
          topicBtn: q.topicBtn || (q.topic ? { text: q.topic, url: '#' } : null)
        });
      }
      explanationBox.innerHTML = feedbackHtml;
      explanationBox.style.display = 'block';
      // Remove the submit button
      const submitBtn = form.querySelector('.submit-btn');
      if (submitBtn) submitBtn.remove();
      // Remove any previous next button
      const oldNextBtn = form.querySelector('.next-btn');
      if (oldNextBtn) oldNextBtn.remove();
      // Add Next Question button or end test directly under submit
      const nextBtn = document.createElement('button');
      nextBtn.textContent = (currentQuestion < questions.length - 1) ? 'Next Question' : 'End Test';
      nextBtn.className = 'submit-btn next-btn';
      nextBtn.style.display = 'block';
      nextBtn.style.margin = '1rem auto 0 auto';
      nextBtn.onclick = function (ev) {
        ev.preventDefault();
        if (currentQuestion < questions.length - 1) {
          currentQuestion++;
          saveQuizState(); // Save new position
          renderQuestion();
        } else {
          // 1. Stop timer immediately to prevent auto-saves
          if (timerInterval) clearInterval(timerInterval);
          // 2. Set flag to block any pending saves
          testEnded = true;
          // 3. Clear storage
          clearQuizState();
          // 4. Render UI
          renderEndScreen();
        }
      };
      form.appendChild(nextBtn);
    });
  }
  // Save state after UI is fully rendered
  // Check for revision guides (async)
  checkAndRenderRevisionGuide(q);

  saveQuizState();
}

// --- Revision Guide Helper ---
async function checkAndRenderRevisionGuide(q) {
  // --- MOVED TO FURTHER READING (New Logic) ---
  if (!q.topic_id) return;

  try {
    const currentQIndex = currentQuestion;

    // 1. Fetch
    let { data, error } = await supabase
      .from('topic_revision_guides')
      .select('revision_guides(title)')
      .eq('topic_id', q.topic_id);

    let guides = [];
    if (!error && data) {
      guides = data.map(i => ({ title: i.revision_guides?.title || 'Revision Guide', topic_id: q.topic_id }));
    }

    // 2. Fallback
    if (!data || data.length === 0) {
      const dr = await supabase.from('revision_guides').select('title').eq('topic_id', q.topic_id);
      if (dr.data) guides = dr.data.map(g => ({ title: g.title || 'Revision Guide', topic_id: q.topic_id }));
    }

    // Capture
    q.revisionGuides = guides;

    // 3. Render
    if (currentQuestion !== currentQIndex) return;

    const renderButtons = () => {
      const container = document.querySelector('.revision-guides-section');
      if (container && guides.length > 0) {
        container.innerHTML = guides.map(g => `
                <a href="study.html?topic_id=${g.topic_id}" target="_blank" class="revision-guide-btn" 
                   style="display: inline-block; margin: 4px 8px 4px 0; padding: 6px 12px; background: #e8f5e9; color: #2e7d32; text-decoration: none; border-radius: 4px; font-weight: 500; font-size: 0.9em; border: 1px solid #c8e6c9;">
                   📖 ${g.title}
                </a>
            `).join('');
      }
    };
    renderButtons();
  } catch (e) { console.error(e); }

  // DISABLE OLD LOGIC
  return;

  // If no topic_id, do nothing
  if (!q.topic_id) return;

  const currentQIndex = currentQuestion; // Capture current index

  try {
    let { count, error } = await supabase
      .from('topic_revision_guides')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', q.topic_id);

    // Fallback: Check old table if new table has no matches
    if (!error && count === 0) {
      const directRes = await supabase
        .from('revision_guides')
        .select('id', { count: 'exact', head: true })
        .eq('topic_id', q.topic_id);

      if (!directRes.error) {
        count = directRes.count;
      }
    }

    if (error) {
      console.error('Error checking revision guides:', error);
      return;
    }

    // Ensure we are still on the same question
    if (currentQuestion !== currentQIndex) return;

    if (count > 0) {
      const header = document.querySelector('.question-header');
      if (header && !header.querySelector('.revision-guide-btn')) {
        const btn = document.createElement('a');
        btn.className = 'revision-guide-btn';
        // Assuming study.html can handle topic_id or just general link for now
        btn.href = `study.html?topic_id=${q.topic_id}`;
        btn.target = '_blank';
        btn.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; margin-left: 0.8rem; padding: 4px 8px; background: #e3f2fd; color: #1565c0; border-radius: 4px; text-decoration: none; font-size: 0.85rem; font-weight: 500; border: 1px solid #90caf9; transition: all 0.2s;';
        btn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
          </svg>
          Revision Guide
        `;
        btn.onmouseover = () => btn.style.background = '#bbdefb';
        btn.onmouseout = () => btn.style.background = '#e3f2fd';

        // Insert after category or at the end
        const categorySpan = header.querySelector('.question-category');
        if (categorySpan) {
          categorySpan.after(btn);
        } else {
          // If no category, append after flag button (or wherever fits)
          const flagBtn = header.querySelector('.flag-btn');
          if (flagBtn) {
            flagBtn.after(btn);
          } else {
            header.appendChild(btn);
          }
        }
      }
    }
  } catch (err) {
    console.error('Unexpected error checking revision guides:', err);
  }
}

// Render right panel with status squares
function renderStatusPanel() {
  let panel = document.getElementById('status-panel');
  if (!panel) return;

  // Guard: avoid accessing undefined questionStates
  if (!Array.isArray(questions) || !Array.isArray(questionStates) || questions.length === 0 || questionStates.length !== questions.length) {
    panel.innerHTML = '<div class="error-message">No questions to display.</div>';
    console.warn('No questions to display.');
    return;
  }

  // Check if panel needs full rebuild (first render or question count changed)
  const needsRebuild = panel.children.length !== questions.length;

  if (needsRebuild) {
    // Full rebuild
    panel.innerHTML = '';
    questions.forEach((q, idx) => {
      const square = createStatusSquare(q, idx);
      panel.appendChild(square);
    });
  } else {
    // Update existing squares
    questions.forEach((q, idx) => {
      const square = panel.children[idx];
      if (square) {
        updateStatusSquare(square, q, idx);
      }
    });
  }
}

// Create a new status square element
function createStatusSquare(q, idx) {
  let code = getQuestionCode(q.type, idx);
  let state = questionStates[idx]?.status;
  let flagged = questionStates[idx]?.flagged;
  let color = state === 'correct' ? '#4caf50' : state === 'incorrect' ? '#e53935' : state === 'partial' ? '#ff9800' : '#fff';

  let square = document.createElement('div');
  square.className = 'status-square';
  square.setAttribute('role', 'button');
  square.setAttribute('tabindex', '0');
  square.setAttribute('aria-label', `${code}${flagged ? ' (flagged)' : ''} - ${state === 'not-attempted' ? 'Not attempted' : state}`);
  square.title = code + (flagged ? ' (flagged)' : '');
  square.style.background = color;
  if (idx === currentQuestion) square.classList.add('active');

  square.onclick = function () {
    currentQuestion = idx;
    saveQuizState(); // Save new position
    renderQuestion();
  };

  // Keyboard navigation
  square.onkeydown = function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      currentQuestion = idx;
      saveQuizState();
      renderQuestion();
    }
  };

  // Add number in the center
  let numSpan = document.createElement('span');
  numSpan.className = 'status-square-num';
  numSpan.textContent = (idx + 1);
  square.appendChild(numSpan);

  // Add blue flag marker overlay if flagged
  if (flagged) {
    let flag = document.createElement('span');
    flag.className = 'status-flag-marker';
    flag.setAttribute('aria-hidden', 'true');
    flag.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" style="display:block" xmlns="http://www.w3.org/2000/svg"><path d="M3 2.5V10.5" stroke="#1976d2" stroke-width="2" stroke-linecap="round"/><path d="M3 2.5L10 3.5L7.5 6L10 8.5L3 9.5" fill="#1976d2" stroke="#1976d2" stroke-width="1.5"/></svg>';
    square.appendChild(flag);
  }

  return square;
}

// Update an existing status square
function updateStatusSquare(square, q, idx) {
  let code = getQuestionCode(q.type, idx);
  let state = questionStates[idx]?.status;
  let flagged = questionStates[idx]?.flagged;
  let color = state === 'correct' ? '#4caf50' : state === 'incorrect' ? '#e53935' : state === 'partial' ? '#ff9800' : '#fff';

  square.style.background = color;
  square.setAttribute('aria-label', `${code}${flagged ? ' (flagged)' : ''} - ${state === 'not-attempted' ? 'Not attempted' : state}`);
  square.title = code + (flagged ? ' (flagged)' : '');

  // Update active state
  if (idx === currentQuestion) {
    square.classList.add('active');
  } else {
    square.classList.remove('active');
  }

  // Update flag marker
  const existingFlag = square.querySelector('.status-flag-marker');
  if (flagged && !existingFlag) {
    let flag = document.createElement('span');
    flag.className = 'status-flag-marker';
    flag.setAttribute('aria-hidden', 'true');
    flag.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" style="display:block" xmlns="http://www.w3.org/2000/svg"><path d="M3 2.5V10.5" stroke="#1976d2" stroke-width="2" stroke-linecap="round"/><path d="M3 2.5L10 3.5L7.5 6L10 8.5L3 9.5" fill="#1976d2" stroke="#1976d2" stroke-width="1.5"/></svg>';
    square.appendChild(flag);
  } else if (!flagged && existingFlag) {
    existingFlag.remove();
  }
}

function renderEndScreen() {
  // Stop the timer if running
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  testEnded = true;
  reviewMode = true;
  // Disable or remove all submit buttons in the DOM
  document.querySelectorAll('button[type="submit"], .submit-btn').forEach(btn => {
    btn.disabled = true;
    btn.style.opacity = 0.5;
    btn.style.pointerEvents = 'none';
  });
  const section = document.getElementById('question-section');
  // Calculate total possible as sum of all SBA and EMQ stems
  let totalQuestions = 0;

  // Topic-based analytics
  const topicStats = {};

  questions.forEach((q, idx) => {
    const topic = q.topic || 'General';
    if (!topicStats[topic]) {
      topicStats[topic] = { score: 0, possible: 0 };
    }

    if (q.type === 'sba') {
      totalQuestions++;
      topicStats[topic].possible++;
      if (questionStates[idx].status === 'correct') {
        topicStats[topic].score++;
      }
    } else if (q.type === 'emq') {
      const stemsPossible = q.stems.length;
      totalQuestions += stemsPossible;
      topicStats[topic].possible += stemsPossible;

      const stemAnswers = questionStates[idx].answer;
      if (Array.isArray(stemAnswers)) {
        q.stems.forEach((stem, sIdx) => {
          const correctIdx = (questionStates[idx].shuffledStemCorrectIndices && questionStates[idx].shuffledStemCorrectIndices[sIdx] !== undefined)
            ? questionStates[idx].shuffledStemCorrectIndices[sIdx]
            : stem.correct;
          if (parseInt(stemAnswers[sIdx]) === correctIdx) {
            topicStats[topic].score++;
          }
        });
      }
    } else if (q.type === 'mba') {
      totalQuestions++;
      topicStats[topic].possible++;
      if (questionStates[idx].status === 'correct') {
        topicStats[topic].score++;
      }
    } else if (q.type === 'numeric') {
      totalQuestions++;
      topicStats[topic].possible++;
      if (questionStates[idx].status === 'correct') {
        topicStats[topic].score++;
      }
    }
  });

  let topicBreakdownHtml = `
    <div class="topic-breakdown" style="margin-top: 2rem; border-top: 1px solid #eee; padding-top: 1.5rem; text-align: left;">
      <h3 style="color: #2563a6; margin-bottom: 1rem;">Topic Breakdown</h3>
      <div style="display: grid; gap: 0.8rem;">
  `;

  for (const topic in topicStats) {
    const stat = topicStats[topic];
    const percentage = ((stat.score / stat.possible) * 100).toFixed(0);
    topicBreakdownHtml += `
      <div class="topic-stat-row" style="display: flex; justify-content: space-between; align-items: center; background: #f8f9fa; padding: 0.8rem 1.2rem; border-radius: 8px;">
        <span style="font-weight: 500;">${topic}</span>
        <span style="color: #666;">${stat.score}/${stat.possible} (${percentage}%)</span>
      </div>
    `;
  }
  topicBreakdownHtml += '</div></div>';

  section.innerHTML = `
    <div class="end-test-box">
      ${totalScore / totalQuestions >= DISTINCTION_THRESHOLD ? '<div class="distinction-badge">Distinction Performance</div>' : ''}
      <h2 style="color: #2563a6;">Test Complete</h2>
      <p style="font-size: 1.25rem; margin-bottom: 0.5rem;">Your final score:</p>
      <div style="font-size: 3rem; font-weight: 800; color: #1565c0; margin-bottom: 1rem;">${totalScore} / ${totalQuestions}</div>
      
      ${topicBreakdownHtml}
      
      <a href="practice.html" class="cta-btn" style="margin-top:2.5rem; display: inline-block;">Return to Dashboard</a>
    </div>
  `;

  // Trigger Confetti for high scores
  if (totalScore / totalQuestions >= DISTINCTION_THRESHOLD && typeof confetti === 'function') {
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 }
    });
  }

  // Update SRS - Track weak topics
  const weakTopics = JSON.parse(localStorage.getItem(WEAK_TOPICS_KEY) || '{}');
  for (const topic in topicStats) {
    const stat = topicStats[topic];
    if (stat.score / stat.possible < WEAK_TOPIC_THRESHOLD) {
      weakTopics[topic] = (weakTopics[topic] || 0) + 1;
    } else {
      weakTopics[topic] = Math.max(0, (weakTopics[topic] || 0) - 1);
    }
  }
  localStorage.setItem(WEAK_TOPICS_KEY, JSON.stringify(weakTopics));

  clearQuizState();
}


function renderExplanation({
  isCorrect,
  correctLabel,
  correctText,
  explanation,
  furtherReading,
  topicBtn
}) {
  return `
    <span class="${isCorrect ? 'correct' : 'incorrect'}">${isCorrect ? 'Correct' : 'Incorrect'}</span>
    <div class="correct-answer"><strong>Correct answer:</strong> ${correctLabel}. ${correctText}</div>
    <div class="explanation-text"><strong>Explanation:</strong> ${explanation}</div>
    <div class="further-reading">
      <strong>Further Reading:</strong>
      <ul class="reading-links">
        ${furtherReading.map(link => `<li><a href="${link.url}" target="_blank" rel="noopener">${link.text}</a></li>`).join('')}
      </ul>
    </div>
    ${topicBtn ? `<div class="topic-btn-row"><a href="${topicBtn.url}" target="_blank" rel="noopener" class="topic-btn">${topicBtn.text}</a></div>` : ''}
    <div id="revision-guides-section-${new Date().getTime()}" class="revision-guides-section" style="margin-top: 10px;">
      <!-- Revision guides will be injected here -->
    </div>
  `;
}

function attachSbaHandlers(q) {
  const form = document.getElementById('mcq-form');
  const fieldset = document.getElementById('mcq-fieldset');
  const explanationBox = document.getElementById('explanation');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    // Prevent answering more than once
    if (questionStates[currentQuestion].status !== 'not-attempted') return;
    const selected = form.answer.value;
    if (selected === '') return;
    questionStates[currentQuestion].answer = selected;

    // Correct answer index (shuffled)
    const correctIdx = questionStates[currentQuestion].shuffledCorrectIndex !== undefined
      ? questionStates[currentQuestion].shuffledCorrectIndex
      : q.correct;

    const isCorrect = parseInt(selected) === correctIdx;
    totalPossible++;
    if (isCorrect) {
      totalScore++;
      questionStates[currentQuestion].status = 'correct';
    } else {
      questionStates[currentQuestion].status = 'incorrect';
    }
    saveQuizState(); // <--- Save immediately after answer
    renderStatusPanel();

    // Visual feedback animation
    const formEl = document.getElementById('mcq-form');
    if (isCorrect) {
      formEl.classList.add('correct-pulse');
      setTimeout(() => formEl.classList.remove('correct-pulse'), 500);
    } else {
      formEl.classList.add('shake');
      setTimeout(() => formEl.classList.remove('shake'), 400);
    }

    explanationBox.innerHTML = renderExplanation({
      isCorrect,
      correctLabel: correctIdx >= 0 ? String.fromCharCode(65 + correctIdx) : '?',
      correctText: (correctIdx >= 0 && (questionStates[currentQuestion].shuffledOptions || q.options)[correctIdx]) || 'Unknown',
      explanation: q.explanation,
      furtherReading: q.furtherReading,
      topicBtn: q.topicBtn || (q.topic ? { text: q.topic, url: '#' } : null)
    });
    explanationBox.style.display = 'block';
    Array.from(fieldset.querySelectorAll('input[type=radio]')).forEach((el, idx) => {
      el.disabled = true;
      const label = fieldset.querySelector(`label[for="option${idx + 1}"]`);
      if (parseInt(selected) === idx && isCorrect) {
        label.classList.add('option-correct');
      } else if (parseInt(selected) === idx && !isCorrect) {
        label.classList.add('option-wrong');
      }
      if (correctIdx === idx) {
        label.classList.add('option-correct');
      }
    });
    // Remove the submit button
    const submitBtn = form.querySelector('.submit-btn');
    if (submitBtn) submitBtn.remove();
    // Remove any previous next button
    const oldNextBtn = form.querySelector('.next-btn');
    if (oldNextBtn) oldNextBtn.remove();
    // Add Next Question button or end test directly under submit
    const nextBtn = document.createElement('button');
    nextBtn.textContent = (currentQuestion < questions.length - 1) ? 'Next Question' : 'End Test';
    nextBtn.className = 'submit-btn next-btn';
    nextBtn.style.display = 'block';
    nextBtn.style.margin = '1rem auto 0 auto';
    nextBtn.onclick = function (ev) {
      ev.preventDefault();
      if (currentQuestion < questions.length - 1) {
        currentQuestion++;
        saveQuizState(); // Save new position
        renderQuestion();
      } else {
        renderEndScreen();
        clearQuizState();
      }
    };
    form.appendChild(nextBtn);
  });

  const setupSbaInteractions = () => {

    // Right click strikethrough
    form.querySelectorAll('.option').forEach(opt => {
      opt.oncontextmenu = (e) => {
        e.preventDefault();
        const idx = parseInt(opt.dataset.idx);
        if (!questionStates[currentQuestion].struckOutOptions) {
          questionStates[currentQuestion].struckOutOptions = [];
        }
        if (questionStates[currentQuestion].struckOutOptions.includes(idx)) {
          questionStates[currentQuestion].struckOutOptions = questionStates[currentQuestion].struckOutOptions.filter(i => i !== idx);
          opt.classList.remove('struck-out');
        } else {
          questionStates[currentQuestion].struckOutOptions.push(idx);
          opt.classList.add('struck-out');
        }
        saveQuizState();
      };
    });
  };

  setupSbaInteractions();

  // Keyboard shortcuts for SBA
  const keyHandler = function (e) {
    if (questionStates[currentQuestion].status !== 'not-attempted') return;

    // A-E keys to select options
    if (e.key >= 'a' && e.key <= 'e') {
      const index = e.key.charCodeAt(0) - 97;
      if (index < (questionStates[currentQuestion].shuffledOptions || q.options).length) {
        const radio = document.getElementById(`option${index + 1}`);
        if (radio) {
          radio.checked = true;
        }
      }
    }
    // Enter to submit
    // GLOBAL HANDLER NOW TAKES CARE OF THIS
    // if (e.key === 'Enter' && form.answer && form.answer.value) {
    //   e.preventDefault();
    //   form.requestSubmit();
    // }
  };
  document.addEventListener('keydown', keyHandler);

  // Cleanup
  const cleanup = () => document.removeEventListener('keydown', keyHandler);
  currentQuestionCleanup = cleanup;
  form.addEventListener('submit', () => { setTimeout(cleanup, 100); currentQuestionCleanup = null; }, { once: true });
}


function attachEmqDropdownHandlers(q) {
  const form = document.getElementById('emq-form');
  const fieldset = document.getElementById('emq-fieldset');
  const explanationBox = document.getElementById('explanation');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    // Prevent answering more than once
    if (questionStates[currentQuestion].status !== 'not-attempted') return;

    // Validate EMQ has stems and options
    if (!Array.isArray(q.stems) || q.stems.length === 0) {
      console.error('EMQ question missing stems:', q);
      explanationBox.innerHTML = '<div class="error-message">Error: Invalid question data</div>';
      explanationBox.style.display = 'block';
      return;
    }

    if (!Array.isArray(q.options) || q.options.length === 0) {
      console.error('EMQ question missing options:', q);
      explanationBox.innerHTML = '<div class="error-message">Error: Invalid question data</div>';
      explanationBox.style.display = 'block';
      return;
    }

    let allAnswered = true;
    let feedbackHtml = '';
    let correctCount = 0;
    let allCorrect = true;
    let anyCorrect = false;
    let answers = [];
    q.stems.forEach((stemObj, idx) => {
      const selected = form[`answer${idx}`].value;
      answers[idx] = selected;
      if (selected === '') allAnswered = false;

      const correctIdx = (questionStates[currentQuestion].shuffledStemCorrectIndices && questionStates[currentQuestion].shuffledStemCorrectIndices[idx] !== undefined)
        ? questionStates[currentQuestion].shuffledStemCorrectIndices[idx]
        : stemObj.correct;

      const isCorrect = parseInt(selected) === correctIdx;
      if (isCorrect) {
        correctCount++;
        anyCorrect = true;
      } else {
        allCorrect = false;
      }

      // Add Dangerous Knowledge warning if Confident but wrong
      let extraNote = "";
      if (questionStates[currentQuestion].confidence === 'confident' && !isCorrect) {
        extraNote = `<div style="color: #ef4444; font-weight: bold; margin-top: 0.5rem; border: 1px solid #ef4444; padding: 0.5rem; border-radius: 4px;">⚠️ Dangerous Knowledge: You were confident but incorrect. Review this topic carefully.</div>`;
      }

      // Add color class to dropdown only (no icon)
      const selectEl = form.querySelector(`#emq-answer-${idx}`);
      selectEl.classList.remove('option-correct', 'option-wrong');
      if (selected !== '') {
        selectEl.classList.add(isCorrect ? 'option-correct' : 'option-wrong');
      }
      feedbackHtml += renderExplanation({
        isCorrect,
        correctLabel: String.fromCharCode(65 + correctIdx),
        correctText: (questionStates[currentQuestion].shuffledOptions || q.options)[correctIdx],
        explanation: stemObj.explanation,
        furtherReading: q.furtherReading,
        topicBtn: q.topicBtn || (q.topic ? { text: q.topic, url: '#' } : null)
      }) + extraNote + '<hr style="margin:1.5rem 0;">';
    });
    // Button is disabled until all answered, so we don't need the check here in theory,
    // but good to keep a safety check or just proceed.
    if (!allAnswered) return;

    questionStates[currentQuestion].answer = answers;
    totalPossible += q.stems.length;
    totalScore += correctCount;
    if (allCorrect) {
      questionStates[currentQuestion].status = 'correct';
    } else if (anyCorrect) {
      questionStates[currentQuestion].status = 'partial';
    } else {
      questionStates[currentQuestion].status = 'incorrect';
    }
    saveQuizState(); // <--- Save immediately after answer
    renderStatusPanel();
    explanationBox.innerHTML = feedbackHtml;
    explanationBox.style.display = 'block';
    Array.from(fieldset.querySelectorAll('select')).forEach(el => el.disabled = true);
    // Remove the submit button
    const submitBtn = form.querySelector('.submit-btn');
    if (submitBtn) submitBtn.remove();
    // Remove any previous next button
    const oldNextBtn = form.querySelector('.next-btn');
    if (oldNextBtn) oldNextBtn.remove();
    // Add Next Question button or end test directly under submit
    const nextBtn = document.createElement('button');
    nextBtn.textContent = (currentQuestion < questions.length - 1) ? 'Next Question' : 'End Test';
    nextBtn.className = 'submit-btn next-btn';
    nextBtn.style.display = 'block';
    nextBtn.style.margin = '1rem auto 0 auto';
    nextBtn.onclick = function (ev) {
      ev.preventDefault();
      if (currentQuestion < questions.length - 1) {
        currentQuestion++;
        saveQuizState(); // Save new position
        renderQuestion();
      } else {
        renderEndScreen();
        clearQuizState();
      }
    };
    form.appendChild(nextBtn);
  });
}

function attachMbaHandlers(q) {
  const form = document.getElementById('mba-form');
  const fieldset = document.getElementById('mba-fieldset');
  const explanationBox = document.getElementById('explanation');
  const counter = document.getElementById('mba-counter');
  const submitBtn = form.querySelector('.submit-btn');
  const requiredCount = Array.isArray(q.correct) ? q.correct.length : 0;

  // Update counter and enable/disable submit button
  const updateCounter = () => {
    const checked = Array.from(fieldset.querySelectorAll('input[type=checkbox]:checked'));
    const count = checked.length;
    counter.textContent = `${count} / ${requiredCount}`;
    // Enable submit when at least 2 options are selected (early submission allowed)
    submitBtn.disabled = (count < 2);
    if (count < 2) {
      submitBtn.title = "Select at least 2 options to submit";
    } else if (count === requiredCount) {
      submitBtn.title = "Submit your answers";
    } else {
      submitBtn.title = `Submit early (${count}/${requiredCount} selected)`;
    }
  };

  // Attach change listeners to checkboxes
  fieldset.querySelectorAll('input[type=checkbox]').forEach(checkbox => {
    checkbox.addEventListener('change', updateCounter);
  });

  // Initialize counter
  updateCounter();

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    // Prevent answering more than once
    if (questionStates[currentQuestion].status !== 'not-attempted') return;

    // Get selected answers
    const selected = Array.from(fieldset.querySelectorAll('input[type=checkbox]:checked'))
      .map(cb => parseInt(cb.value));

    // Allow early submission with at least 2 selections
    if (selected.length < 2) return;

    questionStates[currentQuestion].answer = selected;
    const correctIndices = Array.isArray(q.correct) ? q.correct : [];

    // Strict scoring: ALL correct AND NO incorrect
    const allCorrectSelected = correctIndices.every(idx => selected.includes(idx));
    const noIncorrectSelected = selected.every(idx => correctIndices.includes(idx));
    const isCorrect = allCorrectSelected && noIncorrectSelected;
    const isPartial = !isCorrect && selected.some(idx => correctIndices.includes(idx));

    totalPossible++;
    if (isCorrect) {
      totalScore++;
      questionStates[currentQuestion].status = 'correct';
    } else if (isPartial) {
      questionStates[currentQuestion].status = 'partial';
    } else {
      questionStates[currentQuestion].status = 'incorrect';
    }

    saveQuizState(true); // Immediate save
    renderStatusPanel();

    // Visual feedback animation
    const formEl = document.getElementById('mba-form');
    if (isCorrect) {
      formEl.classList.add('correct-pulse');
      setTimeout(() => formEl.classList.remove('correct-pulse'), 500);
    } else {
      formEl.classList.add('shake');
      setTimeout(() => formEl.classList.remove('shake'), 400);
    }

    // Disable checkboxes and apply styling
    Array.from(fieldset.querySelectorAll('input[type=checkbox]')).forEach((el, idx) => {
      el.disabled = true;
      const label = fieldset.querySelector(`label[for="mba-option${idx + 1}"]`);

      // Highlight correct answers
      if (correctIndices.includes(idx)) {
        label.classList.add('option-correct');
      }

      // Highlight incorrect selections
      if (selected.includes(idx) && !correctIndices.includes(idx)) {
        label.classList.add('option-wrong');
      }
    });

    // Show explanation
    const correctLabels = correctIndices.map(i => String.fromCharCode(65 + i)).join(', ');
    const correctTexts = correctIndices.map(i => q.options[i]).join('; ');

    explanationBox.innerHTML = renderExplanation({
      isCorrect,
      correctLabel: correctLabels,
      correctText: correctTexts,
      explanation: q.explanation,
      furtherReading: q.furtherReading,
      topicBtn: q.topicBtn || (q.topic ? { text: q.topic, url: '#' } : null)
    });

    if (isPartial) {
      explanationBox.innerHTML = `
        <span class="incorrect">Partial Answer</span>
        <div style="background: #fff3e0; border: 1px solid #ff9800; padding: 0.8rem; border-radius: 6px; margin-bottom: 1rem; color: #e65100;">
          <strong>⚠️ Partial Credit Not Awarded</strong><br>
          You selected some correct answers, but MBA questions require ALL correct answers with NO incorrect selections for credit.
        </div>
      ` + explanationBox.innerHTML;
    }

    explanationBox.style.display = 'block';

    // Remove the submit button
    const submitBtn = form.querySelector('.submit-btn');
    if (submitBtn) submitBtn.remove();

    // Remove any previous next button
    const oldNextBtn = form.querySelector('.next-btn');
    if (oldNextBtn) oldNextBtn.remove();

    // Add Next Question button or end test
    const nextBtn = document.createElement('button');
    nextBtn.textContent = (currentQuestion < questions.length - 1) ? 'Next Question' : 'End Test';
    nextBtn.className = 'submit-btn next-btn';
    nextBtn.style.display = 'block';
    nextBtn.style.margin = '1rem auto 0 auto';
    nextBtn.onclick = function (ev) {
      ev.preventDefault();
      if (currentQuestion < questions.length - 1) {
        currentQuestion++;
        saveQuizState(); // Save new position
        renderQuestion();
      } else {
        renderEndScreen();
        clearQuizState();
      }
    };
    form.appendChild(nextBtn);
  });

  // Keyboard shortcuts for MBA
  const keyHandler = function (e) {
    if (questionStates[currentQuestion].status !== 'not-attempted') return;

    // Space to toggle checkbox
    if (e.key === ' ' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      const firstUnchecked = fieldset.querySelector('input[type=checkbox]:not(:checked)');
      if (firstUnchecked) firstUnchecked.click();
    }

    // Enter to submit if correct count selected
    // GLOBAL HANDLER NOW TAKES CARE OF THIS
    // if (e.key === 'Enter' && !submitBtn.disabled) {
    //   e.preventDefault();
    //   form.requestSubmit();
    // }
  };
  document.addEventListener('keydown', keyHandler);

  // Cleanup
  const cleanup = () => document.removeEventListener('keydown', keyHandler);
  currentQuestionCleanup = cleanup;
  form.addEventListener('submit', () => { setTimeout(cleanup, 100); currentQuestionCleanup = null; }, { once: true });
}

function startTest() {
  // Filter questions based on selection
  const params = new URLSearchParams(window.location.search);
  const topicParam = params.get('topic');
  const topicIdParam = params.get('topic_id');

  if (topicIdParam) {
    questions = allQuestions.filter(q => q.topic_id === topicIdParam);
    if (questions.length === 0) {
      // Fallback: try filtering by topic name if we can match it, or just show warning
      // For now, just show toast
      showToast(`No questions found for this topic ID.`);
    } else {
      showToast(`Loaded ${questions.length} questions for this topic.`);
    }
  } else if (topicParam) {
    questions = allQuestions.filter(q => q.Category === topicParam);
    showToast(`Category: ${topicParam}`);
  } else if (selectedType === 'sba') {
    questions = allQuestions.filter(q => q.type === 'sba');
  } else if (selectedType === 'emq') {
    questions = allQuestions.filter(q => q.type === 'emq');
  } else if (selectedType === 'mba') {
    questions = allQuestions.filter(q => q.type === 'mba');
  } else if (selectedType === 'smart') {
    // SRS Logic: Prioritize subjects with higher failure count in localStorage
    const weakTopics = JSON.parse(localStorage.getItem(WEAK_TOPICS_KEY) || '{}');

    // Create a weighted list
    questions = [...allQuestions].sort((a, b) => {
      const weightA = weakTopics[a.topic] || 0;
      const weightB = weakTopics[b.topic] || 0;
      return weightB - weightA; // Higher weight (more failures) comes first
    });

    // Take top questions or all if less
    questions = questions.slice(0, SMART_REVISION_LIMIT);
    showToast(`Smart Revision: Focus on ${Object.keys(weakTopics).length > 0 ? 'your weak areas' : 'all topics'}`);
  } else {
    questions = [...allQuestions];
  }

  if (questions.length === 0) {
    alert("No questions found for the selected type.");
    showModeModal();
    return;
  }

  totalScore = 0;
  totalPossible = 0;
  currentQuestion = 0;
  testEnded = false;
  // quizCleared reset moved to end of function
  testEnded = false;

  // Check for study mode again to ensure reviewMode is set correctly
  const modeParam = new URLSearchParams(window.location.search).get('mode');
  if (modeParam === 'study') {
    reviewMode = true;
  } else {
    reviewMode = false;
  }

  examDuration = SECONDS_PER_QUESTION * questions.length;
  if (quizMode === 'exam') timeLeft = examDuration;
  else timeLeft = null;

  // Shuffle questions array
  shuffleArray(questions);

  questionStates = questions.map(q => {
    const state = {
      status: 'not-attempted',
      flagged: false,
      answer: q.type === 'sba' ? null :
        q.type === 'emq' ? (q.stems ? Array(q.stems.length).fill(null) : []) :
          q.type === 'mba' ? [] :
            null
    };

    // SBA Option Randomization
    if (q.type === 'sba' && Array.isArray(q.options)) {
      const opts = q.options.map((opt, i) => ({ text: opt, originalIndex: i }));
      shuffleArray(opts);
      state.shuffledOptions = opts.map(o => o.text);
      state.shuffledCorrectIndex = opts.findIndex(o => o.originalIndex === q.correct);
    }

    // EMQ Option Randomization
    if (q.type === 'emq' && Array.isArray(q.options)) {
      const opts = q.options.map((opt, i) => ({ text: opt, originalIndex: i }));
      shuffleArray(opts);
      state.shuffledOptions = opts.map(o => o.text);
      // Map EACH stem's correct index to the new shuffled index
      state.shuffledStemCorrectIndices = q.stems.map(stem =>
        opts.findIndex(o => o.originalIndex === stem.correct)
      );
    }

    state.struckOutOptions = [];
    state.confidence = null;

    return state;
  });

  // Clear any loading/error messages before rendering
  const section = document.getElementById('question-section');
  if (section) section.innerHTML = '';

  renderQuestion();
}

// End of file. Initialization is handled by initializeApp() on DOMContentLoaded.
// ...existing code for normal mode...
