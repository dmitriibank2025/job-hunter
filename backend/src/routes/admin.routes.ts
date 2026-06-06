import { Router } from "express";
import { getAdminUser, listAdminUsers } from "../services/user-workspace.service";
import { requireAdmin } from "../middleware/auth.middleware";

export function createAdminRouter() {
    const router = Router();

    router.get("/users", async (req, res) => {
        await requireAdmin(req);
        const users = await listAdminUsers();

        res.json({
            success: true,
            count: users.length,
            users,
        });
    });

    router.get("/users/:id", async (req, res) => {
        await requireAdmin(req);
        const user = await getAdminUser(req.params.id);

        res.json({
            success: true,
            user,
        });
    });

    return router;
}
