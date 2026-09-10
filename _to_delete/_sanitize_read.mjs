import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCU9VXdjCbRxH36B6aLRDrHCCAg52dRhnw",
  authDomain: "haydens-homwork.firebaseapp.com",
  projectId: "haydens-homwork",
  storageBucket: "haydens-homwork.firebasestorage.app",
  messagingSenderId: "160070433943",
  appId: "1:160070433943:web:674a6a9c80ac90f5987dd2",
  measurementId: "G-YS1E0W5E2B"
};

const UID = "O1b10rk4P9Sz8vUtSNr8Ucrp3ni1";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const snap = await getDoc(doc(db, "users", UID));
if (!snap.exists()) {
  console.log("NO DOC");
} else {
  console.log(JSON.stringify(snap.data(), null, 2));
}
process.exit(0);
