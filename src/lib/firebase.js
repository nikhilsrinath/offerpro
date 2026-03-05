import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCqe28dSIfjzI9Ra7lgVlZpiHVnWTD1wk8",
  authDomain: "offerpro-892b9.firebaseapp.com",
  databaseURL: "https://offerpro-892b9-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "offerpro-892b9",
  storageBucket: "offerpro-892b9.firebasestorage.app",
  messagingSenderId: "881939498050",
  appId: "1:881939498050:web:b53cc4c683e356d28719db",
  measurementId: "G-NJ2EKT3FH3"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const googleProvider = new GoogleAuthProvider();
