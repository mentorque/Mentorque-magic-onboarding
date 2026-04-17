import { Router, Request, Response } from 'express';
import { authenticateFirebaseToken } from '../middlewares/auth'; 

const router = Router();

// Endpoint: POST /api/auth/sync
// Purpose: Called by the frontend immediately after a successful Firebase login
router.post('/sync', authenticateFirebaseToken, (req: Request, res: Response) => {
  // If the middleware passes, the user is synced in the Postgres DB
  res.status(200).json({
    success: true,
    message: 'User authenticated and synced',
    user: req.user, 
  });
});

// Endpoint: GET /api/auth/me
// Purpose: Fetch the current user's profile using their token
router.get('/me', authenticateFirebaseToken, (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    user: req.user
  });
});

export default router;