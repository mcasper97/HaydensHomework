import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCU9VXdjCbRxH36B6aLRDrHCCAg52dRhnw",
  authDomain: "haydens-homwork.firebaseapp.com",
  projectId: "haydens-homwork",
  storageBucket: "haydens-homwork.firebasestorage.app",
  messagingSenderId: "160070433943",
  appId: "1:160070433943:web:674a6a9c80ac90f5987dd2",
  measurementId: "G-YS1E0W5E2B"
};

let db = null;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (e) {
  console.warn("Firebase init failed:", e);
}

export { db };
