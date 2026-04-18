import { Router, Request, Response } from "express";
import { authenticateFirebaseToken } from "../middlewares/auth";

const router = Router();

/** Stable API shape for clients (aligned with Platform user profile: id, email, name). */
function publicUser(u: Record<string, unknown>) {
  return {
    id: u.id,
    mentorqueUserId: u.mentorqueUserId ?? u.id,
    email: u.email,
    fullName: u.fullName ?? null,
    name: u.name,
    firebaseUid: u.firebaseUid,
  };
}

// Endpoint: POST /api/auth/sync
// Purpose: Called by the frontend immediately after a successful Firebase login
router.post("/sync", authenticateFirebaseToken, (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "User authenticated and synced to Mentorque User table",
    user: publicUser(req.user as Record<string, unknown>),
  });
});

// Endpoint: GET /api/auth/me
// Purpose: Fetch the current user's profile using their token
router.get("/me", authenticateFirebaseToken, (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    user: publicUser(req.user as Record<string, unknown>),
  });
});

export default router;