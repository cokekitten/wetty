import helmet from 'helmet';
import type { Request, Response } from 'express';

export const policies =
  (allowIframe: boolean) =>
  (req: Request, res: Response, next: (err?: unknown) => void): void => {
    helmet({
      referrerPolicy: { policy: ['no-referrer-when-downgrade'] },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          connectSrc: [
            "'self'",
            `${req.protocol === 'http' ? 'ws://' : 'wss://'}${req.get('host') ?? ''}`,
          ],
          // helmet's default CSP adds upgrade-insecure-requests, which breaks
          // plain-HTTP access from non-localhost origins (browser upgrades all
          // asset requests to https). Disable it since we serve over LAN HTTP.
          upgradeInsecureRequests: null,
        },
      },
      xFrameOptions: allowIframe ? false : { action: 'sameorigin' },
    })(req, res, next);
  };
