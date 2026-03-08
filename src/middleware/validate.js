/**
 * Lightweight request validation middleware.
 * Takes a schema object and validates req.body against it.
 *
 * Schema format:
 * {
 *   fieldName: { required: boolean, type: string, enum: string[] }
 * }
 */
function validate(schema) {
    return (req, res, next) => {
        const errors = [];

        for (const [field, rules] of Object.entries(schema)) {
            const value = req.body[field];

            if (rules.required && (value === undefined || value === null || value === '')) {
                errors.push(`'${field}' is required`);
                continue;
            }

            if (value === undefined || value === null) continue;

            if (rules.type === 'array') {
                if (!Array.isArray(value)) {
                    errors.push(`'${field}' must be an array`);
                    continue;
                }
            } else if (rules.type && typeof value !== rules.type) {
                errors.push(`'${field}' must be of type ${rules.type}`);
                continue;
            }

            if (rules.enum && !rules.enum.includes(value)) {
                errors.push(`'${field}' must be one of: ${rules.enum.join(', ')}`);
            }
        }

        if (errors.length > 0) {
            const err = new Error(errors.join('; '));
            err.type = 'validation';
            err.fields = errors;
            return next(err);
        }

        next();
    };
}

module.exports = { validate };
