import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
];

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

const TOKEN_KEY = 'kcs_google_access_token';
const TOKEN_EXPIRY_KEY = 'kcs_google_token_expiry';
const USER_KEY = 'kcs_google_user_profile';

let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Initialize cached token from localStorage if not expired
try {
  const savedToken = localStorage.getItem(TOKEN_KEY);
  const savedExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (savedToken && savedExpiry) {
    const expiryTime = parseInt(savedExpiry, 10);
    if (Date.now() < expiryTime) {
      cachedAccessToken = savedToken;
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_EXPIRY_KEY);
    }
  }
} catch (e) {
  console.warn('Storage read note:', e);
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    const token = await getAccessToken();

    if (user) {
      if (token) {
        cachedAccessToken = token;
        if (onAuthSuccess) onAuthSuccess(user, token);
      } else {
        // Firebase user exists, token might need fresh grant on action
        if (onAuthSuccess) onAuthSuccess(user, '');
      }
    } else {
      // Check if we have saved user profile in localStorage and valid token
      const savedUserStr = localStorage.getItem(USER_KEY);
      if (savedUserStr && token) {
        try {
          const parsedUser = JSON.parse(savedUserStr);
          if (onAuthSuccess) onAuthSuccess(parsedUser as unknown as User, token);
          return;
        } catch {}
      }

      if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google Auth');
    }
    cachedAccessToken = credential.accessToken;

    // Cache token for 55 minutes to allow automatic reconnect
    const expiresInMs = 55 * 60 * 1000;
    try {
      localStorage.setItem(TOKEN_KEY, credential.accessToken);
      localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + expiresInMs));
      if (result.user) {
        localStorage.setItem(
          USER_KEY,
          JSON.stringify({
            uid: result.user.uid,
            email: result.user.email,
            displayName: result.user.displayName,
            photoURL: result.user.photoURL,
          })
        );
      }
    } catch (e) {
      console.warn('Storage write note:', e);
    }

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Google Sign-in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken) return cachedAccessToken;

  try {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (savedToken && savedExpiry) {
      const expiryTime = parseInt(savedExpiry, 10);
      if (Date.now() < expiryTime) {
        cachedAccessToken = savedToken;
        return cachedAccessToken;
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(TOKEN_EXPIRY_KEY);
        cachedAccessToken = null;
      }
    }
  } catch (e) {
    console.warn('Storage read note:', e);
  }

  return null;
};

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
  if (token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + 55 * 60 * 1000));
    } catch {}
  } else {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_EXPIRY_KEY);
    } catch {}
  }
};

export const logoutGoogle = async () => {
  try {
    await signOut(auth);
  } catch {}
  cachedAccessToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {}
};
