import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const signupInProgressRef = useRef(false);

  // A user belongs to an organization iff they have a membership row. Under
  // Firebase this needed three fallback round-trips (Firestore `memberships`,
  // the `users/{uid}.organizations` map, and the legacy RTDB path) because the
  // sources disagreed. Postgres has one source of truth, and RLS scopes the
  // query to the caller automatically.
  const userHasOrganization = async () => {
    const { data, error } = await supabase
      .from('memberships')
      .select('org_id')
      .limit(1);

    if (error) {
      console.warn('Could not check memberships:', error.message);
      return false;
    }
    return (data?.length ?? 0) > 0;
  };

  const applySession = async (session) => {
    const nextUser = session?.user ?? null;
    setUser(nextUser);

    if (nextUser) {
      // Previously the result of this check was awaited and then discarded, so
      // setNeedsOnboarding(false) ran unconditionally and the gate never fired.
      const hasOrg = await userHasOrganization();
      setNeedsOnboarding(!hasOrg);
    } else {
      setNeedsOnboarding(false);
    }
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;

    // getSession() resolves from local storage first, so a reload does not
    // flash the logged-out tree while the token is revalidated.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || signupInProgressRef.current) return;
      applySession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // During email signup, skip — signup() owns the state transition so that
      // the organization exists before the app re-renders around the new user.
      if (cancelled || signupInProgressRef.current) return;
      applySession(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  };

  // signup accepts an optional callback that runs AFTER user creation but BEFORE
  // React state update, so Registration can create the organization before the
  // app re-renders and briefly shows the onboarding gate.
  const signup = async (email, password, onUserCreated) => {
    signupInProgressRef.current = true;
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      // With "Confirm email" enabled in the Supabase project, signUp returns a
      // user but no session — there is no auth.uid() yet, so create_organization
      // would fail its `authentication required` guard. Fail loudly rather than
      // stranding the user in a half-registered state.
      if (!data.session) {
        throw new Error(
          'Account created, but email confirmation is required before signing in. ' +
          'Disable "Confirm email" in Supabase Auth settings to complete onboarding in one step.'
        );
      }

      if (onUserCreated) {
        await onUserCreated(data.user.id);
      }
      setUser(data.user);
      setNeedsOnboarding(false);
      setLoading(false);
      return data.user;
    } finally {
      signupInProgressRef.current = false;
    }
  };

  // Redirect-based, unlike Firebase's popup. The browser leaves the page here
  // and returns to `redirectTo`, where onAuthStateChange picks the session up —
  // so this does not resolve with a user, and callers must not expect one.
  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/hub` },
    });
    if (error) throw error;
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const updatePassword = async (newPassword) => {
    if (!user) throw new Error('No user logged in');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  };

  // Supabase has no reauthenticate-with-credential primitive. Re-running the
  // password sign-in verifies the current password and refreshes the session,
  // which is what the callers actually want before a sensitive change.
  const reauthenticate = async (currentPassword) => {
    if (!user?.email) throw new Error('No user logged in');
    const { error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (error) throw error;
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
