import express, { Router, Request, Response } from 'express';
import passport from './googleAuth.service'; // Adjust path as necessary

export const googleAuthRouter: Router = (() => {
  const router = express.Router();

  // Initiates the Google OAuth 2.0 authentication flow
  router.get(
    '/google',
    passport.authenticate('google', {
      accessType: 'offline',
      prompt: 'consent', // Force consent screen every time for refresh token
    })
  );

  // Google OAuth 2.0 callback URL
  router.get(
    '/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth/google/error' }),
    (req: Request, res: Response) => {
      // Successful authentication, redirect to a success page or return a success message.
      // The user object (req.user) contains profile, accessToken, refreshToken.
      res.send('<script>window.close();</script><p>Authentication successful! You can close this window.</p>');
    }
  );

  // Route for authentication errors
  router.get('/google/error', (req: Request, res: Response) => {
    res.status(401).send('Authentication failed. Please try again.');
  });

  // Route to check authentication status (useful for client-side checks)
  router.get('/check', (req: Request, res: Response) => {
    if (req.isAuthenticated()) {
      res.status(200).json({ authenticated: true, user: req.user });
    } else {
      res.status(200).json({ authenticated: false });
    }
  });

  // Logout route
  router.get('/logout', (req: Request, res: Response, next) => {
    req.logout((err) => {
      if (err) { return next(err); }
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          return res.status(500).send('Failed to destroy session during logout.');
        }
        res.clearCookie('connect.sid'); // Clear the session cookie
        res.status(200).json({ message: 'Logout successful' });
      });
    });
  });

  return router;
})(); 