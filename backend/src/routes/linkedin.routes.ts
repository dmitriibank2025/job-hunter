import { Router } from "express";
import { requireAuthUser } from "../middleware/auth.middleware";
import {
    disconnectLinkedInAccount,
    getLinkedInConnectionStatus,
    startLinkedInConnection,
} from "../services/linkedin-account.service";

export function createLinkedInRouter() {
    const router = Router();

    router.post("/connect", async (req, res) => {
        const authUser = await requireAuthUser(req);
        const connection = await startLinkedInConnection(authUser.id);

        res.status(202).json({
            success: true,
            connectionId: connection.connectionId,
        });
    });

    router.get("/status", async (req, res) => {
        const authUser = await requireAuthUser(req);
        const connectionId = typeof req.query.connectionId === "string"
            ? req.query.connectionId
            : undefined;
        const status = await getLinkedInConnectionStatus(authUser.id, connectionId);

        res.json(status);
    });

    router.delete("/disconnect", async (req, res) => {
        const authUser = await requireAuthUser(req);
        await disconnectLinkedInAccount(authUser.id);

        res.json({
            success: true,
        });
    });

    return router;
}
