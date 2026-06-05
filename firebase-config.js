// ============================================================
//  FIREBASE CONFIGURATION
//  Ganti nilai-nilai di bawah dengan konfigurasi project Firebase kamu
//  Bisa diambil dari: Firebase Console > Project Settings > Your Apps
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyDXSFlmTll5ZLJsC9Ow2VV5MyTP0IqXsdw",
  authDomain: "tkamyhoney.firebaseapp.com",
  databaseURL: "https://tkamyhoney-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "tkamyhoney",
  storageBucket: "tkamyhoney.firebasestorage.app",
  messagingSenderId: "953695262893",
  appId: "1:953695262893:web:7e0cbddb1b668fb3ad0e24",
  measurementId: "G-3RKS2N77Z7"
};
// ============================================================
//  FIRESTORE STRUCTURE (referensi)
//
//  users/{uid}
//    - email, displayName, role ("user"|"admin"), createdAt, lastSeen
//
//  questionPacks/{packId}
//    - title, subject, category, totalQuestions, duration (menit)
//    - createdAt, createdBy (adminUid)
//    - questions: [ { id, question, options, correctAnswer, ... } ]
//
//  sessions/{sessionId}
//    - userId, packId, packTitle
//    - mode: "simulasi" | "latihan" | "custom"
//    - status: "ongoing" | "completed"
//    - startedAt, completedAt
//    - currentQuestionIndex
//    - answers: { [questionId]: selectedOption }
//    - score, totalQuestions, correctCount
//    - subject, category (untuk mode custom)
//
//  messages/{messageId}
//    - fromAdmin (uid), toUser (uid | "all")
//    - text, createdAt, read: false
// ============================================================

export default firebaseConfig;