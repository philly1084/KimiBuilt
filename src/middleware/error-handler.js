/**
 * Global error handler middleware.
 * Catches all unhandled errors and returns consistent JSON responses.
 */
function errorHandler(err, req, res, _next) {
    console.error(`[Error] ${err.message}`, err.stack);

    // OpenAI API errors
    if (err.constructor?.name === 'APIError' || err.status) {
        return res.status(err.status || 502).json({
            error: {
                type: 'openai_error',
                message: err.message,
                code: err.code || null,
            },
        });
    }

    // Validation errors
    if (err.type === 'validation') {
        return res.status(400).json({
            error: {
                type: 'validation_error',
                message: err.message,
                fields: err.fields || null,
            },
        });
    }

    // Generic errors
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        error: {
            type: 'internal_error',
            message:
                process.env.NODE_ENV === 'production'
                    ? 'An internal error occurred'
                    : err.message,
        },
    });
}

module.exports = { errorHandler };
