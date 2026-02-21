// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCU9VXdjCbRxH36B6aLRDrHCCAg52dRhnw",
  authDomain: "haydens-homwork.firebaseapp.com",
  projectId: "haydens-homwork",
  storageBucket: "haydens-homwork.firebasestorage.app",
  messagingSenderId: "160070433943",
  appId: "1:160070433943:web:674a6a9c80ac90f5987dd2",
  measurementId: "G-YS1E0W5E2B"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);