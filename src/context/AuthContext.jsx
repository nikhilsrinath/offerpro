import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { auth, db, googleProvider } from '../lib/firebase';

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
          const userOrgsRef = ref(db, `users/${firebaseUser.uid}/organizations`);
          const snapshot = await get(userOrgsRef);
          setNeedsOnboarding(!snapshot.exists());
        } catch (err) {
          console.warn("Could not check onboarding status:", err.message);
          // If DB read fails, assume needs onboarding
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
      completeOnboarding
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
