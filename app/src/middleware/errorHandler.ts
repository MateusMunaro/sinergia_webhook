// src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('❌ Error:', error);

  // Se a resposta já foi enviada, delegar para o error handler padrão
  if (res.headersSent) {
    return next(error);
  }

  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(500).json({
    error: 'Internal Server Error',
    message: error.message,
    ...(isDevelopment && { stack: error.stack }),
    timestamp: new Date().toISOString()
  });
};

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  // Log da requisição
  console.log(`📝 ${req.method} ${req.path} - ${req.ip} - ${new Date().toISOString()}`);
  
  // Interceptar o fim da resposta para log do tempo
  const originalSend = res.send;
  res.send = function(body) {
    const duration = Date.now() - start;
    console.log(`📤 ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
    return originalSend.call(this, body);
  };
  
  next();
};