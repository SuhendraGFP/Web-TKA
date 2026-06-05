// ============================================================
//  ADMIN.JS — TKA Prep Admin Panel
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, getDocs,
  collection, query, orderBy, where, onSnapshot,
  serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import firebaseConfig from "./firebase-config.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── State ───────────────────────────────────────────────────
let adminUser    = null;
let allUsers     = [];
let allPacks     = [];
let allSessions  = [];
let allMessages  = [];
let usersUnsub   = null;

let pendingJson     = null;   // parsed JSON from file upload
let adminModeChart  = null;
let adminTrendChart = null;
let adminScoreDist  = null;
let adminDailyChart = null;
let adminPackChart  = null;

// ── Expose globals ─────────────────────────────────────────
// Expose immediately (before DOMContentLoaded) so onclick= attributes work
window.handleAdminLogin   = handleAdminLogin;
window.handleAdminLogout  = handleAdminLogout;
window.adminNavigate      = adminNavigate;
window.handleJsonUpload   = handleJsonUpload;
window.savePack           = savePack;
window.cancelUpload       = cancelUpload;
window.deletePack         = deletePack;
window.sendMessage        = sendMessage;
window.useTemplate        = useTemplate;
window.filterUsers        = filterUsers;
window.closeModal         = closeModal;
window.sendPhotoRequest   = sendPhotoRequest;
window.loadPhotoGallery   = loadPhotoGallery;
window.downloadPhoto      = downloadPhoto;
window.deletePhoto        = deletePhoto;

// ============================================================
//  INIT
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists() && snap.data().role === "admin") {
          adminUser = user;
          adminUser._displayName = snap.data().displayName || user.displayName || "Admin";
          await initAdminApp();
        } else {
          // Logged in but not admin — sign out and show auth page with message
          await signOut(auth);
          showAdminPage("auth");
          const errEl = document.getElementById("admin-login-error");
          if (errEl) errEl.textContent = "Akun ini bukan akun admin.";
          const btn = document.getElementById("btn-admin-login");
          if (btn) { btn.disabled = false; btn.textContent = "Masuk sebagai Admin"; }
        }
      } catch (e) {
        // Firestore read failed (e.g. permission-denied) — sign out and show auth
        console.error("Auth check error:", e);
        await signOut(auth);
        showAdminPage("auth");
        const errEl = document.getElementById("admin-login-error");
        if (errEl) {
          if (e.code === "permission-denied") {
            errEl.textContent = "Akses ditolak. Pastikan akun terdaftar sebagai admin di Firestore.";
          } else {
            errEl.textContent = "Gagal memverifikasi role: " + e.message;
          }
        }
        const btn = document.getElementById("btn-admin-login");
        if (btn) { btn.disabled = false; btn.textContent = "Masuk sebagai Admin"; }
      }
    } else {
      showAdminPage("auth");
    }
    hideLoading();
  });

  // Drag and drop on upload zone
  const zone = document.getElementById("upload-zone");
  if (zone) {
    zone.addEventListener("dragover",  e => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", e => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const file = e.dataTransfer.files[0];
      if (file) processJsonFile(file);
    });
  }
});

async function initAdminApp() {
  showAdminPage("app");
  document.getElementById("admin-nav-name").textContent =
    adminUser._displayName.split(" ")[0];

  await Promise.all([loadAllData()]);
  renderOverview();
  listenUsers();
  populateRecipientSelect();
  loadMessageLog();
}

// ============================================================
//  AUTH
// ============================================================
async function handleAdminLogin() {
  const email = document.getElementById("admin-email").value.trim();
  const pass  = document.getElementById("admin-password").value;
  const errEl = document.getElementById("admin-login-error");
  errEl.textContent = "";
  if (!email || !pass) { errEl.textContent = "Email dan kata sandi wajib diisi."; return; }
  const btn = document.getElementById("btn-admin-login");
  btn.disabled = true; btn.textContent = "Memproses...";
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    // Role check happens in onAuthStateChanged — if we get here auth succeeded
    // onAuthStateChanged will handle the redirect/error display
  } catch (e) {
    const map = {
      "auth/invalid-credential":   "Email atau kata sandi salah.",
      "auth/invalid-email":        "Format email tidak valid.",
      "auth/user-not-found":       "Email atau kata sandi salah.",
      "auth/wrong-password":       "Email atau kata sandi salah.",
      "auth/too-many-requests":    "Terlalu banyak percobaan. Coba lagi nanti.",
      "auth/user-disabled":        "Akun ini telah dinonaktifkan.",
    };
    errEl.textContent = map[e.code] || ("Terjadi kesalahan: " + e.message);
    btn.disabled = false; btn.textContent = "Masuk sebagai Admin";
  }
}

async function handleAdminLogout() {
  if (usersUnsub) usersUnsub();
  await signOut(auth);
  window.location.href = "index.html";
}

// ============================================================
//  LOAD DATA
// ============================================================
async function loadAllData() {
  try {
    const [usersSnap, packsSnap, sessionsSnap] = await Promise.all([
      getDocs(query(collection(db, "users"), where("role", "==", "user"))),
      getDocs(collection(db, "questionPacks")),
      getDocs(query(collection(db, "sessions"), orderBy("completedAt", "desc"), limit(200)))
    ]);
    allUsers    = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    allPacks    = packsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    allSessions = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.status === "completed");
  } catch (e) {
    console.error("Load data:", e);
  }
}

// ============================================================
//  NAVIGATION
// ============================================================
function adminNavigate(view) {
  document.querySelectorAll(".admin-view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".admin-sidebar-item").forEach(s => s.classList.remove("active"));
  document.getElementById("aview-" + view)?.classList.add("active");
  document.getElementById("asb-" + view)?.classList.add("active");

  if (view === "overview") renderOverview();
  if (view === "packs")    renderPacksTable();
  if (view === "monitor")  renderUserMonitor(allUsers);
  if (view === "messages") loadMessageLog();
  if (view === "stats")    renderStats();
  if (view === "photos")   { loadPhotoGallery(); populatePhotoRecipientSelect(); }
}

// ============================================================
//  OVERVIEW
// ============================================================
function renderOverview() {
  document.getElementById("ov-total-users").textContent   = allUsers.length;
  document.getElementById("ov-total-packs").textContent   = allPacks.length;
  document.getElementById("ov-total-sessions").textContent = allSessions.length;

  const activeUsers = allUsers.filter(u => {
    if (!u.lastSeen) return false;
    const d = u.lastSeen.toDate ? u.lastSeen.toDate() : new Date(u.lastSeen);
    return (Date.now() - d.getTime()) < 2 * 60 * 1000;
  });
  document.getElementById("ov-active-users").textContent = activeUsers.length;

  const scores = allSessions.map(s => s.score || 0).filter(s => s > 0);
  const avg = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0;
  document.getElementById("ov-avg-score").textContent = avg || "–";

  // Recent activity
  const actContainer = document.getElementById("ov-recent-activity");
  const recent = allSessions.slice(0, 8);
  if (!recent.length) {
    actContainer.innerHTML = `<div class="empty-state" style="padding:16px;"><div class="empty-state-sub">Belum ada aktivitas</div></div>`;
  } else {
    actContainer.innerHTML = recent.map(s => {
      const user = allUsers.find(u => u.id === s.userId);
      const name = user?.displayName || "Siswa";
      const date = s.completedAt ? formatDate(s.completedAt.toDate ? s.completedAt.toDate() : new Date(s.completedAt)) : "–";
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--pink-50);">
        <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--pink-300),var(--pink-500));
          display:flex;align-items:center;justify-content:center;color:#fff;font-size:.78rem;font-weight:700;flex-shrink:0;">
          ${escHtml(name[0]?.toUpperCase()||"S")}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:.86rem;font-weight:600;color:var(--neutral-700);">${escHtml(name)}</div>
          <div style="font-size:.78rem;color:var(--neutral-400);">Selesai ${s.mode} &middot; ${escHtml(s.packTitle||"Custom")} &middot; Skor: ${s.score||0}</div>
        </div>
        <div style="font-size:.75rem;color:var(--neutral-300);flex-shrink:0;">${date}</div>
      </div>`;
    }).join("");
  }

  // Charts
  renderOverviewCharts();
}

function renderOverviewCharts() {
  // Mode pie
  const modeCount = { simulasi: 0, latihan: 0, custom: 0 };
  allSessions.forEach(s => { if (modeCount[s.mode] !== undefined) modeCount[s.mode]++; });
  const ctx1 = document.getElementById("admin-mode-chart")?.getContext("2d");
  if (ctx1) {
    if (adminModeChart) adminModeChart.destroy();
    adminModeChart = new Chart(ctx1, {
      type: "doughnut",
      data: {
        labels: ["Simulasi","Latihan","Custom"],
        datasets: [{ data: Object.values(modeCount),
          backgroundColor:["#ff9ab9","#34c97e","#6c8ef5"], borderWidth: 0, hoverOffset: 4 }]
      },
      options: { responsive:true, maintainAspectRatio:false,
        plugins: { legend: { position:"bottom", labels:{ font:{size:11}, padding:12, usePointStyle:true } } }
      }
    });
  }

  // 7-day trend
  const days7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days7.push(d.toDateString());
  }
  const dayLabels = days7.map(d => new Date(d).toLocaleDateString("id-ID",{day:"numeric",month:"short"}));
  const dayScores = days7.map(day => {
    const daySessions = allSessions.filter(s => {
      if (!s.completedAt) return false;
      const sd = s.completedAt.toDate ? s.completedAt.toDate() : new Date(s.completedAt);
      return sd.toDateString() === day;
    });
    const sc = daySessions.map(s=>s.score||0).filter(s=>s>0);
    return sc.length ? Math.round(sc.reduce((a,b)=>a+b,0)/sc.length) : null;
  });

  const ctx2 = document.getElementById("admin-trend-chart")?.getContext("2d");
  if (ctx2) {
    if (adminTrendChart) adminTrendChart.destroy();
    adminTrendChart = new Chart(ctx2, {
      type:"line",
      data:{
        labels: dayLabels,
        datasets:[{ label:"Rata-rata Skor", data: dayScores,
          borderColor:"#f43f6a", backgroundColor:"rgba(244,63,106,.08)",
          tension:.4, fill:true, pointBackgroundColor:"#f43f6a", pointRadius:4,
          spanGaps:true }]
      },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false} },
        scales:{ y:{min:0,max:100,grid:{color:"rgba(0,0,0,.05)"},ticks:{font:{size:10}}},
          x:{grid:{display:false},ticks:{font:{size:10}}} }
      }
    });
  }
}

// ============================================================
//  PACKS
// ============================================================
function renderPacksTable() {
  const tbody = document.getElementById("packs-tbody");
  if (!allPacks.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--neutral-400);padding:24px;">Belum ada paket soal.</td></tr>`;
    return;
  }
  tbody.innerHTML = allPacks.map(p => {
    const date = p.createdAt ? formatDate(p.createdAt.toDate ? p.createdAt.toDate() : new Date(p.createdAt)) : "–";
    return `<tr>
      <td><strong>${escHtml(p.title)}</strong></td>
      <td>${escHtml(p.subject||"–")}</td>
      <td>${(p.questions||[]).length}</td>
      <td>${p.duration ? p.duration + " menit" : "Tidak dibatasi"}</td>
      <td>${date}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deletePack('${p.id}', '${escHtml(p.title).replace(/'/g,"\\'")}')">Hapus</button>
      </td>
    </tr>`;
  }).join("");
}

function handleJsonUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  processJsonFile(file);
}

function processJsonFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      let parsed = JSON.parse(e.target.result);
      if (!Array.isArray(parsed)) { showToast("Format JSON tidak valid. Harus berupa array soal.", "error"); return; }
      pendingJson = parsed;
      // Pre-fill fields from data
      const first = parsed[0] || {};
      document.getElementById("pack-subject").value  = first.subject  || "";
      document.getElementById("pack-category").value = first.category || "";
      document.getElementById("upload-preview").innerHTML =
        `<span style="color:var(--success)">&#10003;</span> ${parsed.length} soal berhasil dibaca dari <strong>${escHtml(file.name)}</strong>`;
      document.getElementById("pack-config-form").classList.add("show");
    } catch (err) {
      showToast("File bukan JSON yang valid.", "error");
    }
  };
  reader.readAsText(file);
}

async function savePack() {
  if (!pendingJson) return;
  const title    = document.getElementById("pack-title").value.trim();
  const subject  = document.getElementById("pack-subject").value.trim();
  const category = document.getElementById("pack-category").value.trim();
  const durStr   = document.getElementById("pack-duration").value.trim();
  const duration = durStr ? parseInt(durStr) : null;

  if (!title) { showToast("Nama paket wajib diisi.", "error"); return; }

  const btn = document.querySelector("#pack-config-form .btn-primary");
  btn.disabled = true; btn.textContent = "Menyimpan...";

  try {
    const ref = await addDoc(collection(db, "questionPacks"), {
      title, subject, category, duration,
      questions:      pendingJson,
      totalQuestions: pendingJson.length,
      createdAt:      serverTimestamp(),
      createdBy:      adminUser.uid
    });
    allPacks.push({ id: ref.id, title, subject, category, duration, questions: pendingJson, totalQuestions: pendingJson.length });
    showToast(`Paket "${title}" berhasil disimpan!`, "success");
    cancelUpload();
    renderPacksTable();
    // Update overview counts
    document.getElementById("ov-total-packs").textContent = allPacks.length;
  } catch (e) {
    showToast("Gagal menyimpan: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Simpan Paket";
  }
}

function cancelUpload() {
  pendingJson = null;
  document.getElementById("pack-config-form").classList.remove("show");
  document.getElementById("pack-title").value    = "";
  document.getElementById("pack-subject").value  = "";
  document.getElementById("pack-category").value = "";
  document.getElementById("pack-duration").value = "";
  document.getElementById("json-file-input").value = "";
}

function deletePack(packId, packTitle) {
  showModal(
    "Hapus Paket Soal",
    `Yakin ingin menghapus paket "${packTitle}"? Tindakan ini tidak bisa dibatalkan.`,
    async () => {
      try {
        await deleteDoc(doc(db, "questionPacks", packId));
        allPacks = allPacks.filter(p => p.id !== packId);
        showToast("Paket berhasil dihapus.", "success");
        renderPacksTable();
        document.getElementById("ov-total-packs").textContent = allPacks.length;
      } catch (e) {
        showToast("Gagal menghapus: " + e.message, "error");
      }
    }
  );
}

// ============================================================
//  USER MONITOR — Real-time
// ============================================================
function listenUsers() {
  if (usersUnsub) usersUnsub();
  usersUnsub = onSnapshot(
    query(collection(db, "users"), where("role", "==", "user")),
    snap => {
      allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderUserMonitor(allUsers);
      document.getElementById("ov-total-users").textContent = allUsers.length;
      const activeCount = allUsers.filter(u => {
        if (!u.lastSeen) return false;
        const d = u.lastSeen.toDate ? u.lastSeen.toDate() : new Date(u.lastSeen);
        return (Date.now() - d.getTime()) < 2 * 60 * 1000;
      }).length;
      document.getElementById("ov-active-users").textContent = activeCount;
    },
    err => console.error("Users listener:", err)
  );
}

function filterUsers(filter, btn) {
  document.querySelectorAll("#aview-monitor .filter-pill").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  let filtered = allUsers;
  if (filter === "active")  filtered = allUsers.filter(u => u.status === "active");
  if (filter === "online")  filtered = allUsers.filter(u => isOnline(u));
  if (filter === "offline") filtered = allUsers.filter(u => !isOnline(u));
  renderUserMonitor(filtered);
}

function isOnline(u) {
  if (!u.lastSeen) return false;
  const d = u.lastSeen.toDate ? u.lastSeen.toDate() : new Date(u.lastSeen);
  return (Date.now() - d.getTime()) < 3 * 60 * 1000;
}

function renderUserMonitor(users) {
  const list = document.getElementById("user-monitor-list");
  if (!list) return;
  if (!users.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-sub">Tidak ada siswa untuk ditampilkan</div></div>`;
    return;
  }
  // Sort: active first, then online, then offline
  const sorted = [...users].sort((a,b) => {
    const aScore = (a.status==="active"?2:isOnline(a)?1:0);
    const bScore = (b.status==="active"?2:isOnline(b)?1:0);
    return bScore - aScore;
  });

  list.innerHTML = sorted.map(u => {
    const online = isOnline(u);
    const active = u.status === "active";
    const statusClass = active ? "status-active" : online ? "status-online" : "status-offline";
    const statusLabel = active ? "Sedang Ujian" : online ? "Online" : "Offline";
    const lastSeen = u.lastSeen
      ? formatRelative(u.lastSeen.toDate ? u.lastSeen.toDate() : new Date(u.lastSeen))
      : "Tidak diketahui";

    return `<div class="user-monitor-card">
      <div class="user-monitor-header">
        <div class="user-monitor-avatar">${escHtml((u.displayName||"S")[0].toUpperCase())}</div>
        <div>
          <div class="user-monitor-name">${escHtml(u.displayName||"Siswa")}</div>
          <div class="user-monitor-email">${escHtml(u.email||"")}</div>
        </div>
        <div class="user-monitor-status ${statusClass}">
          <div class="status-dot"></div>
          ${statusLabel}
        </div>
      </div>
      ${u.currentActivity
        ? `<div class="user-monitor-activity">&#9201; ${escHtml(u.currentActivity)}</div>`
        : `<div class="user-monitor-activity" style="color:var(--neutral-300)">Tidak ada aktivitas aktif &middot; Terakhir: ${lastSeen}</div>`
      }
      <div class="user-monitor-action">
        <button class="btn btn-outline btn-sm" onclick="openSendTo('${u.id}', '${escHtml(u.displayName||"Siswa").replace(/'/g,"\\'")}')">
          Kirim Pesan
        </button>
        <button class="btn btn-ghost btn-sm" onclick="viewUserHistory('${u.id}')">
          Lihat Histori
        </button>
      </div>
    </div>`;
  }).join("");
}

window.openSendTo = function(userId, userName) {
  adminNavigate("messages");
  const sel = document.getElementById("msg-recipient");
  if (sel) {
    // ensure option exists
    let opt = sel.querySelector(`option[value="${userId}"]`);
    if (!opt) {
      opt = document.createElement("option");
      opt.value = userId;
      opt.textContent = userName;
      sel.appendChild(opt);
    }
    sel.value = userId;
  }
  document.getElementById("msg-text")?.focus();
};

window.viewUserHistory = async function(userId) {
  try {
    const q = query(
      collection(db, "sessions"),
      where("userId", "==", userId),
      where("status", "==", "completed"),
      orderBy("completedAt", "desc"),
      limit(10)
    );
    const snap = await getDocs(q);
    const userSessions = snap.docs.map(d => d.data());
    const user = allUsers.find(u => u.id === userId);
    showModal(
      `Histori: ${user?.displayName || "Siswa"}`,
      userSessions.length
        ? userSessions.map(s =>
            `[${s.mode}] ${s.packTitle||"Custom"} — Skor: ${s.score||0} — ${s.completedAt ? formatDate(s.completedAt.toDate ? s.completedAt.toDate() : new Date(s.completedAt)) : "–"}`
          ).join("\n")
        : "Belum ada sesi yang selesai.",
      () => {}
    );
  } catch (e) {
    showToast("Gagal memuat histori: " + e.message, "error");
  }
};

// ============================================================
//  MESSAGES
// ============================================================
function populateRecipientSelect() {
  const sel = document.getElementById("msg-recipient");
  if (!sel) return;
  sel.innerHTML = `<option value="all">Semua Siswa (Broadcast)</option>` +
    allUsers.map(u => `<option value="${u.id}">${escHtml(u.displayName||u.email)}</option>`).join("");
}

function useTemplate(text) {
  document.getElementById("msg-text").value = text;
}

async function sendMessage() {
  const recipient = document.getElementById("msg-recipient").value;
  const text      = document.getElementById("msg-text").value.trim();
  if (!text) { showToast("Isi pesan tidak boleh kosong.", "error"); return; }

  const btn = document.querySelector("#aview-messages .btn-primary");
  btn.disabled = true; btn.textContent = "Mengirim...";

  try {
    if (recipient === "all") {
      // Send to all users
      const promises = allUsers.map(u =>
        addDoc(collection(db, "messages"), {
          fromAdmin: adminUser.uid,
          toUser: u.id,
          text, read: false, createdAt: serverTimestamp()
        })
      );
      // Also store one broadcast record
      promises.push(addDoc(collection(db, "messages"), {
        fromAdmin: adminUser.uid,
        toUser: "all",
        text, read: false, createdAt: serverTimestamp(),
        isBroadcast: true
      }));
      await Promise.all(promises);
      showToast(`Pesan terkirim ke ${allUsers.length} siswa!`, "success");
    } else {
      await addDoc(collection(db, "messages"), {
        fromAdmin: adminUser.uid,
        toUser: recipient,
        text, read: false, createdAt: serverTimestamp()
      });
      const user = allUsers.find(u => u.id === recipient);
      showToast(`Pesan terkirim ke ${user?.displayName || "siswa"}!`, "success");
    }
    document.getElementById("msg-text").value = "";
    await loadMessageLog();
  } catch (e) {
    showToast("Gagal mengirim: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Kirim Pesan";
  }
}

async function loadMessageLog() {
  const logEl = document.getElementById("msg-log");
  if (!logEl) return;
  try {
    const q = query(
      collection(db, "messages"),
      where("fromAdmin", "==", adminUser.uid),
      orderBy("createdAt", "desc"),
      limit(30)
    );
    const snap = await getDocs(q);
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!msgs.length) {
      logEl.innerHTML = `<div class="empty-state" style="padding:16px;"><div class="empty-state-sub">Belum ada pesan terkirim</div></div>`;
      return;
    }
    logEl.innerHTML = msgs.map(m => {
      const date = m.createdAt ? formatDate(m.createdAt.toDate ? m.createdAt.toDate() : new Date(m.createdAt)) : "–";
      const toLabel = m.isBroadcast || m.toUser === "all" ? "Semua Siswa" :
        allUsers.find(u => u.id === m.toUser)?.displayName || m.toUser;
      return `<div style="padding:12px 14px;border-radius:var(--radius-md);background:var(--neutral-50);border:1px solid var(--neutral-200);">
        <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
          <span style="font-size:.75rem;font-weight:700;color:var(--pink-500);">Kepada: ${escHtml(toLabel)}</span>
          <span style="font-size:.72rem;color:var(--neutral-300);">${date}</span>
        </div>
        <div style="font-size:.88rem;color:var(--neutral-700);">${escHtml(m.text)}</div>
      </div>`;
    }).join("");
  } catch (e) { console.error("Load messages:", e); }
}

// ============================================================
//  STATS
// ============================================================
function renderStats() {
  // Score distribution
  const buckets = [0,0,0,0,0]; // 0-20, 21-40, 41-60, 61-80, 81-100
  allSessions.forEach(s => {
    const sc = s.score || 0;
    if (sc <= 20) buckets[0]++;
    else if (sc <= 40) buckets[1]++;
    else if (sc <= 60) buckets[2]++;
    else if (sc <= 80) buckets[3]++;
    else buckets[4]++;
  });

  const ctx1 = document.getElementById("admin-score-dist-chart")?.getContext("2d");
  if (ctx1) {
    if (adminScoreDist) adminScoreDist.destroy();
    adminScoreDist = new Chart(ctx1, {
      type:"bar",
      data:{
        labels:["0–20","21–40","41–60","61–80","81–100"],
        datasets:[{ label:"Jumlah Sesi", data:buckets,
          backgroundColor:["#ffc2d4","#ff9ab9","#f43f6a","#d42155","#a00040"],
          borderWidth:0, borderRadius:8 }]
      },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false} },
        scales:{ y:{grid:{color:"rgba(0,0,0,.05)"},ticks:{font:{size:11}}},
          x:{grid:{display:false},ticks:{font:{size:11}}} }
      }
    });
  }

  // Daily sessions (30 days)
  const days30 = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days30.push(d.toDateString());
  }
  const dayCounts = days30.map(day => allSessions.filter(s => {
    if (!s.completedAt) return false;
    const sd = s.completedAt.toDate ? s.completedAt.toDate() : new Date(s.completedAt);
    return sd.toDateString() === day;
  }).length);
  const ctx2 = document.getElementById("admin-daily-chart")?.getContext("2d");
  if (ctx2) {
    if (adminDailyChart) adminDailyChart.destroy();
    adminDailyChart = new Chart(ctx2, {
      type:"bar",
      data:{
        labels: days30.map((_,i) => i % 5 === 0 ? new Date(days30[i]).toLocaleDateString("id-ID",{day:"numeric",month:"short"}) : ""),
        datasets:[{ data: dayCounts,
          backgroundColor:"rgba(244,63,106,.3)", borderColor:"#f43f6a", borderWidth:1.5, borderRadius:4 }]
      },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false} },
        scales:{ y:{grid:{color:"rgba(0,0,0,.05)"},ticks:{font:{size:10}}},
          x:{grid:{display:false},ticks:{font:{size:10}}} }
      }
    });
  }

  // Top packs
  const packCount = {};
  allSessions.forEach(s => {
    if (!s.packId) return;
    packCount[s.packId] = (packCount[s.packId] || 0) + 1;
  });
  const topPacks = Object.entries(packCount)
    .sort((a,b) => b[1]-a[1]).slice(0,6)
    .map(([packId, count]) => ({
      label: allPacks.find(p=>p.id===packId)?.title || packId,
      count
    }));
  const ctx3 = document.getElementById("admin-pack-chart")?.getContext("2d");
  if (ctx3) {
    if (adminPackChart) adminPackChart.destroy();
    adminPackChart = new Chart(ctx3, {
      type:"bar", // horizontal
      data:{
        labels: topPacks.map(p => p.label.length > 20 ? p.label.slice(0,18)+"…" : p.label),
        datasets:[{ data: topPacks.map(p=>p.count),
          backgroundColor:"rgba(108,142,245,.35)", borderColor:"#6c8ef5", borderWidth:1.5, borderRadius:4 }]
      },
      options:{ responsive:true, maintainAspectRatio:false, indexAxis:"y",
        plugins:{ legend:{display:false} },
        scales:{ x:{grid:{color:"rgba(0,0,0,.05)"},ticks:{font:{size:10}}},
          y:{grid:{display:false},ticks:{font:{size:10}}} }
      }
    });
  }
}

// ============================================================
//  PHOTOS
// ============================================================
function populatePhotoRecipientSelect() {
  const sel = document.getElementById("photo-req-recipient");
  if (!sel) return;
  sel.innerHTML = `<option value="all">Semua Siswa</option>` +
    allUsers.map(u => `<option value="${u.id}">${escHtml(u.displayName || u.email)}</option>`).join("");
}

async function sendPhotoRequest() {
  const recipient = document.getElementById("photo-req-recipient").value;
  const msg = document.getElementById("photo-req-msg").value.trim() || "Haii say, senyum dong! 😊";
  const btn = document.querySelector("#aview-photos .btn-primary");
  btn.disabled = true; btn.textContent = "Mengirim...";

  try {
    if (recipient === "all") {
      const promises = allUsers.map(u =>
        addDoc(collection(db, "photoRequests"), {
          fromAdmin: adminUser.uid,
          toUser: u.id,
          title: "Admin minta foto kamu! 📸",
          message: msg,
          status: "pending",
          createdAt: serverTimestamp()
        })
      );
      await Promise.all(promises);
      showToast(`Permintaan foto terkirim ke ${allUsers.length} siswa!`, "success");
    } else {
      await addDoc(collection(db, "photoRequests"), {
        fromAdmin: adminUser.uid,
        toUser: recipient,
        title: "Admin minta foto kamu! 📸",
        message: msg,
        status: "pending",
        createdAt: serverTimestamp()
      });
      const user = allUsers.find(u => u.id === recipient);
      showToast(`Permintaan foto terkirim ke ${user?.displayName || "siswa"}!`, "success");
    }
    document.getElementById("photo-req-msg").value = "";
  } catch (e) {
    showToast("Gagal kirim permintaan: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "📸 Minta Foto";
  }
}

async function loadPhotoGallery() {
  const gallery = document.getElementById("photo-gallery");
  if (!gallery) return;
  gallery.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--neutral-400);">Memuat foto...</div>`;

  try {
    const snap = await getDocs(
      query(collection(db, "photos"), orderBy("takenAt", "desc"), limit(50))
    );
    const photos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!photos.length) {
      gallery.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:40px;">
        <div style="font-size:2rem;margin-bottom:8px;">📭</div>
        <div class="empty-state-sub">Belum ada foto masuk. Kirim permintaan ke siswa dulu!</div>
      </div>`;
      return;
    }

    gallery.innerHTML = photos.map(p => {
      const date = p.takenAt ? formatDate(p.takenAt.toDate ? p.takenAt.toDate() : new Date(p.takenAt)) : "–";
      return `<div class="photo-card">
        <img src="${p.imageData}" alt="Foto ${escHtml(p.userName)}"
          style="cursor:pointer;" onclick="viewPhotoFull('${p.id}')" />
        <div class="photo-card-info">
          <div class="photo-card-name">${escHtml(p.userName || "Siswa")}</div>
          <div class="photo-card-date">${date}</div>
        </div>
        <div class="photo-card-actions">
          <button class="btn btn-primary btn-sm" style="flex:1;" onclick="downloadPhoto('${p.id}', '${escHtml(p.userName || "foto")}')">
            ⬇️ Download
          </button>
          <button class="btn btn-danger btn-sm" onclick="deletePhoto('${p.id}')">🗑️</button>
        </div>
      </div>`;
    }).join("");
  } catch (e) {
    gallery.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:30px;">
      <div class="empty-state-sub">Gagal memuat foto: ${escHtml(e.message)}</div>
    </div>`;
    console.error("Load photos:", e);
  }
}

// Store photos in memory for full view
const _photoCache = {};
window.viewPhotoFull = function(photoId) {
  // find from current gallery img src
  const imgs = document.querySelectorAll("#photo-gallery .photo-card img");
  let src = "";
  imgs.forEach(img => {
    if (img.getAttribute("onclick")?.includes(photoId)) src = img.src;
  });
  if (!src) return;
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;cursor:pointer;";
  overlay.innerHTML = `<img src="${src}" style="max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.6);" />`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
};

function downloadPhoto(photoId, userName) {
  const imgs = document.querySelectorAll("#photo-gallery .photo-card img");
  let src = "";
  imgs.forEach(img => {
    if (img.getAttribute("onclick")?.includes(photoId)) src = img.src;
  });
  if (!src) return;
  const a = document.createElement("a");
  a.href = src;
  a.download = `foto-${userName}-${Date.now()}.jpg`;
  a.click();
}

async function deletePhoto(photoId) {
  showModal("Hapus Foto", "Yakin ingin menghapus foto ini?", async () => {
    try {
      await deleteDoc(doc(db, "photos", photoId));
      showToast("Foto dihapus.", "success");
      loadPhotoGallery();
    } catch (e) {
      showToast("Gagal hapus: " + e.message, "error");
    }
  });
}

// ============================================================
//  MODAL
// ============================================================
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
//  UTILS
// ============================================================
function showAdminPage(page) {
  document.getElementById("admin-auth-page").style.display = page === "auth" ? "flex" : "none";
  document.getElementById("admin-app").style.display       = page === "app"  ? "flex" : "none";
}

function hideLoading() {
  document.getElementById("loading-screen").classList.add("hidden");
}

function escHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function formatDate(d) {
  if (!d) return "–";
  return d.toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"});
}

function formatRelative(d) {
  if (!d) return "–";
  const diff = Math.round((Date.now() - d.getTime()) / 1000);
  if (diff < 60)  return `${diff} detik lalu`;
  if (diff < 3600) return `${Math.round(diff/60)} menit lalu`;
  if (diff < 86400) return `${Math.round(diff/3600)} jam lalu`;
  return `${Math.round(diff/86400)} hari lalu`;
}