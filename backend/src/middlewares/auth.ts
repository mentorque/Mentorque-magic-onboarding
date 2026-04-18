import { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { eq } from 'drizzle-orm';
import { db, resumeReviewersTable } from '@workspace/db';
import { getOrCreateUser } from '../utils/userSync.js'; // Note: ESM often requires .js extensions in imports depending on your esbuild config

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: any; // Replace 'any' with your inferred Drizzle User type later
      firebaseUid?: string;
      authMode?: 'firebase' | 'mentor';
      mentorAccess?: {
        payload: {
          onboardingId: string;
          role: string;
          reviewerId?: string;
          userId?: string;
        };
        reviewer: typeof resumeReviewersTable.$inferSelect;
      };
    }
  }
}

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKeyRaw) {
    console.error('❌ Missing FIREBASE env variables.');
  } else {
    try {
      // Normalize private key into a valid PEM string.
      // Expected env formats:
      // - Single-line value with literal "\n" sequences
      // - Multiline value with real newlines
      let privateKey = privateKeyRaw.replace(/\r\n/g, '\n');
      privateKey = privateKey.replace(/\\n/g, '\n');
      privateKey = privateKey.replace(/\r/g, '').trim();

      const looksLikePem =
        privateKey.includes('-----BEGIN PRIVATE KEY-----') &&
        privateKey.includes('-----END PRIVATE KEY-----');

      if (!looksLikePem) throw new Error('FIREBASE_PRIVATE_KEY does not look like a valid PEM after normalization');

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      console.log('✅ Firebase Admin initialized successfully');
    } catch (err: any) {
      console.error('❌ Firebase Init Error:', err.message);
    }
  }
}

export async function authenticateFirebaseToken(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authorization required', message: 'Provide a valid Firebase token' });
      return;
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    const email = decodedToken.email?.trim() ? decodedToken.email : null;
    const name = decodedToken.name || decodedToken.displayName || null;
    
    let user;
    try {
      user = await getOrCreateUser(decodedToken.uid, email, name);
    } catch (dbError) {
      console.error('Database sync error (allowing auth to continue):', dbError);
      user = { firebaseUid: decodedToken.uid, email, name };
    }
    
    req.user = user;
    req.firebaseUid = decodedToken.uid;
    
    next();
  } catch (error: any) {
    console.error('Firebase authentication error:', error.message);
    res.status(401).json({ error: 'Invalid token', message: 'Token invalid or expired' });
    return;
  }
}

/**
 * Firebase ID token (JWT) or mentor wildcard access token (base64url JSON from `/mentor/claim`).
 */
export async function authenticateFirebaseOrMentorAccess(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authorization required.' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];
  const looksLikeJwt = token.split('.').length === 3;

  if (looksLikeJwt && admin.apps.length) {
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      const email = decodedToken.email?.trim() ? decodedToken.email : null;
      const name = decodedToken.name || decodedToken.displayName || null;
      let user;
      try {
        user = await getOrCreateUser(decodedToken.uid, email, name);
      } catch (dbError) {
        console.error('Database sync error (allowing auth to continue):', dbError);
        user = { firebaseUid: decodedToken.uid, email, name };
      }
      req.user = user;
      req.firebaseUid = decodedToken.uid;
      req.authMode = 'firebase';
      next();
      return;
    } catch (error: any) {
      console.error('Firebase authentication error:', error.message);
      res.status(401).json({ success: false, message: 'Token invalid or expired.' });
      return;
    }
  }

  try {
    const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as {
      onboardingId?: string;
      reviewerId?: string;
      role?: string;
      userId?: string;
    };
    if (!payload?.onboardingId || !payload?.reviewerId) {
      res.status(401).json({ success: false, message: 'Invalid access token.' });
      return;
    }

    const [reviewer] = await db
      .select()
      .from(resumeReviewersTable)
      .where(eq(resumeReviewersTable.id, payload.reviewerId));

    if (!reviewer || reviewer.onboardingId !== payload.onboardingId) {
      res.status(403).json({ success: false, message: 'Invalid reviewer access.' });
      return;
    }

    req.authMode = 'mentor';
    req.mentorAccess = {
      payload: {
        onboardingId: payload.onboardingId,
        role: payload.role ?? reviewer.role,
        reviewerId: payload.reviewerId,
        userId: payload.userId,
      },
      reviewer,
    };
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid access token.' });
  }
}