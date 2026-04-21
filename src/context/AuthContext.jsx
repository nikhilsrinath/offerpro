import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword as firebaseUpdatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, firestore, googleProvider } from '../lib/firebase';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const signupInProgressRef = useRef(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // During email signup, skip — the signup function handles state updates
      if (signupInProgressRef.current) return;

      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          // Check onboarding status via Firestore users collection
          const userDocRef = doc(firestore, 'users', firebaseUser.uid);
          const snapshot = await getDoc(userDocRef);
          
          const userData = snapshot.exists() ? snapshot.data() : null;
          const userOrgs = userData?.organizations || {};
          setNeedsOnboarding(Object.keys(userOrgs).length === 0);
        } catch (err) {
          console.warn("Could not check onboarding status via Firestore:", err.message);
          // Fallback check to RTDB for robustness during migration if needed, 
          // but user requested Firestore primary.
          setNeedsOnboarding(true);
        }
      } else {
        setUser(null);
        setNeedsOnboarding(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (email, password) => {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  };

  // signup accepts an optional callback that runs AFTER user creation but BEFORE React state update
  // This allows Registration to store org data before the app re-renders
  const signup = async (email, password, onUserCreated) => {
    signupInProgressRef.current = true;
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      if (onUserCreated) {
        await onUserCreated(result.user.uid);
      }
      setUser(result.user);
      setNeedsOnboarding(false);
      setLoading(false);
      return result.user;
    } finally {
      signupInProgressRef.current = false;
    }
  };

  const loginWithGoogle = async () => {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  };

  const logout = async () => {
    await signOut(auth);
  };

  const updatePassword = async (newPassword) => {
    if (!user) throw new Error('No user logged in');
    await firebaseUpdatePassword(user, newPassword);
  };

  const reauthenticate = async (currentPassword) => {
    if (!user || !user.email) throw new Error('No user logged in');
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
  };

  const completeOnboarding = () => {
    setNeedsOnboarding(false);
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      needsOnboarding,
      login,
      signup,
      loginWithGoogle,
      logout,
      completeOnboarding,
      updatePassword,
      reauthenticate
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
