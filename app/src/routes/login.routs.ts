import { Router } from 'express';


export const createLoginRoutes = (dependencies: AppDependencies) => {
  const { authService } = dependencies;

  const router = Router();

  router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
      const token = await authService.login(email, password);
      res.json({ token });
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  });

  return router;
};