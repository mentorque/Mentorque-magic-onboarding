import { Router, type IRouter } from "express";
import healthRouter from "./health";
import resumeRevampRouter from "./resumeRevamp";
import authRouter from "./auth"

const router: IRouter = Router();

router.use(healthRouter);
router.use("/resume-revamp", resumeRevampRouter);
router.use("/auth", authRouter);

export default router;
