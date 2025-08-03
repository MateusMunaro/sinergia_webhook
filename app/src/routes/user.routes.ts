import { Router } from 'express';
import { UserService } from '../services/user.services';

export const createUserRoutes = (userService: UserService): Router => {
  const router = Router();

  // POST /api/v1/users 
  router.post('/', async (req, res) => {
    try {
      const { name, email, githubUsername, password } = req.body;
      const user = await userService.createUser({ name, email, githubUsername, password });

      res.status(201).json({
        message: 'User created successfully',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          githubUsername: user.githubUsername,
          createdAt: user.createdAt
        }
      });
    } catch (error: any) {
      res.status(400).json({
        message: 'Failed to create user',
        error: error.message
      });
    }
  });
  
  return router;
};
