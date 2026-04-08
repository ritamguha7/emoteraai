import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyA0b-pNH4DqQJ7fA5EV8PPfkxVpKLD0FBk",
  authDomain: "emotera--ai.firebaseapp.com",
  projectId: "emotera--ai",
  storageBucket: "emotera--ai.firebasestorage.app",
  messagingSenderId: "916151563658",
  appId: "1:916151563658:web:8a2df04e26c0a31f65c473",
  measurementId: "G-V3PGB0DWKY"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth and Firestore
export const auth = getAuth(app);
export const db = getFirestore(app);
