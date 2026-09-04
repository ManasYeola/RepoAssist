/**
 * Global error handling middleware
 */
const errorMiddleware = (err, req, res, next) => {
  console.error('[Error]', err.message, err.stack);

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Always expose stack in dev for easier debugging
  res.status(status).json({
    error: {
      message,
      stack: err.stack,
    },
  });
};

module.exports = errorMiddleware;
